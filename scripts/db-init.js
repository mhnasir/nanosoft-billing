// Creates the tables (db/schema.sql) in the database named in .env. Safe to run again (CREATE IF NOT EXISTS).
// Also creates the database itself if it does not exist yet and the PG user is allowed to.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
const e = process.env;

const base = e.DATABASE_URL
  ? { connectionString: e.DATABASE_URL }
  : { host: e.PG_HOST || 'localhost', port: Number(e.PG_PORT) || 5432, user: e.PG_USER || 'postgres', password: e.PG_PASSWORD || undefined };
const dbName = e.DATABASE_URL ? new URL(e.DATABASE_URL).pathname.slice(1) : e.PG_DATABASE || 'nvs';

async function ensureDatabase() {
  const admin = new pg.Client({ ...base, database: e.DATABASE_URL ? undefined : 'postgres' });
  try {
    await admin.connect();
  } catch (err) {
    if (err.code === '3D000') return; // maintenance db missing - assume the target exists
    throw err;
  }
  try {
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
    if (!r.rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}" ENCODING 'UTF8'`);
      console.log(`Created database "${dbName}".`);
    }
  } finally {
    await admin.end();
  }
}

try {
  await ensureDatabase();
  const c = new pg.Client({ ...base, database: e.DATABASE_URL ? undefined : dbName });
  await c.connect();
  await c.query(schema);
  const t = await c.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
  await c.end();
  console.log(`Schema ready in "${dbName}" (${t.rows[0].n} tables).`);
} catch (err) {
  console.error('db:init failed -', err.code === '28P01' ? 'wrong PG_USER / PG_PASSWORD in .env' : err.message);
  process.exit(1);
}
