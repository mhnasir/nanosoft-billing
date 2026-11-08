// Round-trip test of the SQL Server -> PostgreSQL importer using files laid out like the bcp export.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const URL_ = process.env.TEST_PG_URL;
const skip = URL_ ? false : 'set TEST_PG_URL to run database tests';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'db', 'schema-meta.json'), 'utf8'));

const write = (dir, name, cols, rows) => {
  // rows: objects keyed by column name; missing keys become NULL
  const lines = rows.map((r) => cols.map((c) => (c.name in r ? String(r[c.name]) : '~NULL~')).join('~|~')).join('~#~') + '~#~';
  fs.writeFileSync(path.join(dir, `${name}.dat`), Buffer.from(lines, 'utf16le'));
};

test('importer loads bcp-style files, keeps identity values and verifies counts', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));

  write(dir, 'SUPMAST', meta.SUPMAST.cols, [
    { SupKey: 7, SUPNAME: 'Rāvi\nTraders', ADD1: 'Main Rd', city: 'Mettupalayam', SUPTYPE: 'C', STAT: 0, CUSTKEY: 1, OpnBal: '150.50', NonBill: 0, Companykey: 1, AccessDate: '2026-01-27 09:16:48.000' },
    { SupKey: 12, SUPNAME: 'Muthu', ADD1: '-', SUPTYPE: 'S', STAT: 0, NonBill: 0, Companykey: 1 },
  ]);
  write(dir, 'FATRANS', meta.FATRANS.cols, [
    { FATRANSKEY: 40, DOCNO: '1', DOCDATE: '2026-07-13 00:00:00.000', DOCTYPE: 'B', Supkey: 7, AMOUNT: '211.50', REFKEY: 3, RECPAY02STAT: 0, NOTES: '', BTOP: '0' },
  ]);
  fs.writeFileSync(path.join(dir, '_counts.dat'), Buffer.from('SUPMAST~|~2~#~FATRANS~|~1~#~', 'utf16le'));

  const run = (extra = []) => spawnSync('node', [path.join(root, 'scripts', 'import-mssql.js'), `--dir=${dir}`, ...extra], { env: { ...process.env, DATABASE_URL: URL_ }, encoding: 'utf8' });
  let r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SUPMAST\s+sqlserver=\s+2\s+postgres=\s+2\s+OK/);

  const s = await c.query('SELECT supkey, supname, opnbal, accessdate, custkey FROM supmast ORDER BY supkey');
  assert.deepEqual(s.rows.map((x) => x.supkey), [7, 12]);
  assert.equal(s.rows[0].supname, 'Rāvi\nTraders');
  assert.equal(Number(s.rows[0].opnbal), 150.5);
  assert.equal(s.rows[1].custkey, null);
  // the identity sequence continues after the imported ids
  const n = await c.query(`INSERT INTO supmast(supname,add1,stat) VALUES('New','x',0) RETURNING supkey`);
  assert.equal(n.rows[0].supkey, 13);

  // second run without --replace is refused and changes nothing
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already has data/);
  // --replace works, and a count mismatch aborts without touching data
  r = run(['--replace']);
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(dir, '_counts.dat'), Buffer.from('SUPMAST~|~5~#~', 'utf16le'));
  r = run(['--replace']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /mismatch/i);
  assert.equal((await c.query('SELECT COUNT(*)::int AS n FROM supmast')).rows[0].n, 2);
  await c.end();
});
