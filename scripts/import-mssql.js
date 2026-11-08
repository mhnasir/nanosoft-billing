// One-time import of the data exported by export-from-mssql.cmd (bcp files in ./migrate) into PostgreSQL.
//   npm run import                 import into empty tables
//   npm run import -- --replace    wipe the imported tables first (re-run after a fresh export)
//   npm run import -- --dir=path   use another export folder
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const replace = args.includes('--replace');
const dirArg = args.find((a) => a.startsWith('--dir='));
const dir = path.resolve(dirArg ? dirArg.slice(6) : path.join(root, 'migrate'));
const FS = '~|~';
const RS = '~#~';
const NUL = '~NULL~';
const meta = JSON.parse(fs.readFileSync(path.join(root, 'db', 'schema-meta.json'), 'utf8'));

export function readTable(file) {
  let txt = fs.readFileSync(file).toString('utf16le');
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  const rows = txt.split(RS);
  if (rows.length && rows[rows.length - 1].replace(/[\r\n]+/g, '') === '') rows.pop();
  return rows.map((r) => r.replace(/^[\r\n]+/, '').split(FS));
}

function convert(col, v, where) {
  if (v === NUL) return null;
  const t = col.pg;
  if (t === 'integer' || t === 'smallint' || t === 'bigint' || t.startsWith('numeric')) {
    if (v.trim() === '' || Number.isNaN(Number(v))) throw new Error(`${where}: "${v}" is not a number`);
    return v.trim();
  }
  return v;
}

async function main() {
  if (!fs.existsSync(dir)) throw new Error(`Export folder not found: ${dir}\nRun export-from-mssql.cmd first.`);
  const e = process.env;
  const client = new pg.Client(
    e.DATABASE_URL
      ? { connectionString: e.DATABASE_URL }
      : { host: e.PG_HOST || 'localhost', port: Number(e.PG_PORT) || 5432, database: e.PG_DATABASE || 'nvs', user: e.PG_USER || 'postgres', password: e.PG_PASSWORD || undefined },
  );
  await client.connect();

  // Expected counts straight from SQL Server (if the exporter wrote them)
  const expected = {};
  const cf = path.join(dir, '_counts.dat');
  if (fs.existsSync(cf)) for (const [t, c] of readTable(cf)) expected[t] = Number(c);

  const todo = Object.entries(meta).filter(([name]) => fs.existsSync(path.join(dir, `${name}.dat`)));
  if (!todo.length) throw new Error(`No .dat files found in ${dir}`);

  const report = [];
  await client.query('BEGIN');
  try {
    if (!replace) {
      for (const [name, t] of todo) {
        const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t.pg}`);
        if (r.rows[0].n > 0) throw new Error(`Table ${t.pg} already has data. Use "npm run import -- --replace" to overwrite it.`);
      }
    } else {
      await client.query(`TRUNCATE ${todo.map(([, t]) => t.pg).join(', ')} RESTART IDENTITY`);
    }

    for (const [name, t] of todo) {
      const rows = readTable(path.join(dir, `${name}.dat`));
      const cols = t.cols;
      const hasIdentity = cols.some((c) => c.identity);
      const perBatch = Math.max(1, Math.floor(60000 / cols.length));
      for (let i = 0; i < rows.length; i += perBatch) {
        const chunk = rows.slice(i, i + perBatch);
        const values = [];
        const ph = chunk.map((row, ri) => {
          if (row.length !== cols.length) throw new Error(`${name} row ${i + ri + 1}: expected ${cols.length} fields, found ${row.length} (text containing the separator?)`);
          return `(${row.map((v, ci) => {
            values.push(convert(cols[ci], v, `${name} row ${i + ri + 1} ${cols[ci].name}`));
            return `$${values.length}`;
          }).join(',')})`;
        });
        await client.query(`INSERT INTO ${t.pg}(${cols.map((c) => c.name.toLowerCase()).join(',')}) ${hasIdentity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES ${ph.join(',')}`, values);
      }
      for (const c of cols.filter((x) => x.identity)) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${t.pg}','${c.name.toLowerCase()}'), COALESCE((SELECT MAX(${c.name.toLowerCase()}) FROM ${t.pg}),0)+1, false)`);
      }
      const n = (await client.query(`SELECT COUNT(*)::int AS n FROM ${t.pg}`)).rows[0].n;
      const exp = expected[name];
      const ok = n === rows.length && (exp === undefined || exp === n);
      report.push({ table: name, exported: exp ?? '-', imported: n, ok });
      if (!ok) throw new Error(`Row count mismatch for ${name}: SQL Server ${exp ?? '?'}, file ${rows.length}, PostgreSQL ${n}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
  const w = Math.max(...report.map((r) => r.table.length));
  for (const r of report) console.log(`${r.table.padEnd(w)}  sqlserver=${String(r.exported).padStart(7)}  postgres=${String(r.imported).padStart(7)}  ${r.ok ? 'OK' : 'MISMATCH'}`);
  console.log(`\nImported ${report.length} tables, ${report.reduce((s, r) => s + r.imported, 0)} rows. All counts match.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('\nImport failed (nothing was changed):', err.message);
    process.exit(1);
  });
}
