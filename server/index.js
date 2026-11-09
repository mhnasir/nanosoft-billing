import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authRouter, requireAuth } from './auth.js';
import { mastersRouter } from './routes/masters.js';
import { billsRouter } from './routes/bills.js';
import { receiptsRouter } from './routes/receipts.js';
import { reportsRouter } from './routes/reports.js';
import { getPool, query } from './db.js';
import { requirePermission } from './access.js';
import { usersRouter } from './routes/users.js';
import { settingsRouter } from './routes/settings.js';
import { productImagesRouter } from './routes/productimages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '..', 'dist');

export const app = express();
app.disable('x-powered-by');

// Optional CORS for a front end hosted elsewhere (e.g. Netlify). CORS_ORIGIN = comma-separated site addresses, or * for any.
// Logins use a Bearer token (no cookies), so this only decides which sites may call the API from a browser.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
if (corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, ngrok-skip-browser-warning');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const r = await query('SELECT current_database() AS db');
    res.json({ ok: true, db: r[0].db });
  } catch (e) {
    res.status(503).json({ ok: false, error: dbHint(e) });
  }
});

app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api', requirePermission);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', productImagesRouter);
app.use('/api', mastersRouter);
app.use('/api/bills', billsRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

function dbHint(e) {
  const m = String(e?.message || e);
  if (e?.code === '28P01' || e?.code === '28000') return 'PostgreSQL login failed - check PG_USER / PG_PASSWORD in .env';
  if (e?.code === '3D000') return 'Database not found - create it (see README) or fix PG_DATABASE in .env';
  if (e?.code === '42P01') return 'Tables are missing - run "npm run db:init" (and "npm run import" to load the old NVS data)';
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.code === 'ETIMEDOUT' || /timeout|ECONNREFUSED/i.test(m)) return 'Cannot reach PostgreSQL - check PG_HOST / PG_PORT in .env and that the PostgreSQL service is running';
  return m;
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // SQL errors: surface a friendly message, never raw stack traces
  const msg = status >= 500 ? dbHint(err) : err.message;
  res.status(status).json({ error: msg });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`NanoSoft Billing running on http://localhost:${port}`);
    getPool().query('SELECT 1').then(
      () => console.log('PostgreSQL connected'),
      (e) => console.warn('PostgreSQL not reachable yet:', dbHint(e)),
    );
  });
}
