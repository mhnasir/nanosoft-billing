import { Router } from 'express';
import { query, run } from '../db.js';
import { wrap, badReq, str } from '../util.js';
import { TYPES } from './bills.js';

export const settingsRouter = Router();

// Small key/value store for app-wide settings. The table is created on first use, so an upgrade needs no extra step.
let ready;
const ensure = () => {
  ready ??= run('CREATE TABLE IF NOT EXISTS appsetting (skey varchar(60) PRIMARY KEY, svalue text NOT NULL)').catch((e) => { ready = undefined; throw e; });
  return ready;
};
const FIELDS_KEY = 'bill.fields';

async function loadFields() {
  await ensure();
  const r = await query('SELECT svalue FROM appsetting WHERE skey=@k', { k: FIELDS_KEY });
  try { return JSON.parse(r[0]?.svalue || '{}'); } catch { return {}; }
}

/** Which components of each bill screen are switched off: { B: { hidden: ['kCoolyAmt', ...] }, S: { ... } }. Nothing listed = everything shown. */
settingsRouter.get('/bill-fields', wrap(async (_req, res) => res.json(await loadFields())));

settingsRouter.put(
  '/bill-fields',
  wrap(async (req, res) => {
    const input = req.body?.settings;
    if (!input || typeof input !== 'object') throw badReq('Nothing to save');
    const clean = {};
    for (const [t, v] of Object.entries(input)) {
      if (!TYPES.includes(t)) throw badReq(`Unknown bill type ${t}`);
      const hidden = Array.isArray(v?.hidden) ? [...new Set(v.hidden.map((x) => str(x, 30)).filter(Boolean))] : [];
      if (hidden.length > 40) throw badReq('Too many items');
      clean[t] = { hidden };
    }
    await ensure();
    await run(
      'INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue',
      { k: FIELDS_KEY, v: JSON.stringify(clean) },
    );
    res.json({ ok: true });
  }),
);

/* ---------- the name shown in the menu, the browser tab and the login page (instead of a hard-coded product name) ---------- */
const NAME_KEY = 'app.name';

export async function getAppName() {
  await ensure();
  const r = await query('SELECT svalue FROM appsetting WHERE skey=@k', { k: NAME_KEY });
  return r[0]?.svalue || '';
}

settingsRouter.get('/app', wrap(async (_req, res) => res.json({ appName: await getAppName() })));

settingsRouter.put(
  '/app',
  wrap(async (req, res) => {
    const appName = str(req.body?.appName, 60);
    await ensure();
    await run('INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue', { k: NAME_KEY, v: appName });
    res.json({ ok: true, appName });
  }),
);

/* ---------- printed bill: paper size, orientation, margin, font size ---------- */
const PRINT_KEY = 'print.page';
export const PAPERS = ['A4', 'A5', 'A6', 'Letter', 'Legal', 'Roll80', 'Roll58', 'Custom'];
const clamp = (v, lo, hi, d) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 10) / 10)) : d;
};

settingsRouter.get(
  '/print',
  wrap(async (_req, res) => {
    await ensure();
    const r = await query('SELECT svalue FROM appsetting WHERE skey=@k', { k: PRINT_KEY });
    try { res.json(JSON.parse(r[0]?.svalue || '{}')); } catch { res.json({}); }
  }),
);

settingsRouter.put(
  '/print',
  wrap(async (req, res) => {
    const b = req.body || {};
    const paper = PAPERS.includes(b.paper) ? b.paper : 'A4';
    const clean = {
      paper,
      width: clamp(b.width, 40, 1000, 210), // mm, used for Custom
      height: clamp(b.height, 40, 1500, 297), // mm, used for Custom and the roll papers
      orientation: b.orientation === 'landscape' ? 'landscape' : 'portrait',
      margin: clamp(b.margin, 0, 40, 10), // mm
      fontSize: clamp(b.fontSize, 8, 24, 13), // px
    };
    await ensure();
    await run('INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue', { k: PRINT_KEY, v: JSON.stringify(clean) });
    res.json(clean);
  }),
);

/* ---------- menu layout: the default for everyone is the left menu; a top menu bar is the alternative. Each user can still switch on their own screen. ---------- */
const UI_KEY = 'ui.menu';

settingsRouter.get(
  '/ui',
  wrap(async (_req, res) => {
    await ensure();
    const r = await query('SELECT svalue FROM appsetting WHERE skey=@k', { k: UI_KEY });
    res.json({ menu: ['top', 'right'].includes(r[0]?.svalue) ? r[0].svalue : 'left' });
  }),
);

settingsRouter.put(
  '/ui',
  wrap(async (req, res) => {
    const menu = ['top', 'right'].includes(req.body?.menu) ? req.body.menu : 'left';
    await ensure();
    await run('INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue', { k: UI_KEY, v: menu });
    res.json({ menu });
  }),
);

/* ---------- company logo (shown left of the company name; optionally on the printed bill) ---------- */
const LOGO_KEY = 'app.logo'; // the image as a data URL
const LOGO_VER = 'app.logo.ver'; // changes on every upload so browsers refetch it
const LOGO_PRINT = 'print.logo'; // '0' = leave the logo off the printed bill (anything else = on)
const MAX_LOGO = 300 * 1024; // bytes
const SIGNATURES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/gif': [0x47, 0x49, 0x46, 0x38], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

function parseLogo(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw badReq('Choose a PNG, JPG, GIF or WebP picture');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_LOGO) throw badReq(`The picture is too big (${Math.round(buf.length / 1024)} KB). Keep it under 300 KB.`);
  const sig = SIGNATURES[m[1]];
  if (!sig.every((b, i) => buf[i] === b)) throw badReq('That file is not a real picture of that type');
  return { mime: m[1], buf };
}

/** What every screen (and the public login page) needs to show the brand. */
export async function getBrand() {
  await ensure();
  const rows = await query("SELECT skey, svalue FROM appsetting WHERE skey IN ('app.name','app.logo.ver','print.logo')");
  const m = Object.fromEntries(rows.map((r) => [r.skey, r.svalue]));
  return { appName: m['app.name'] || '', logoVersion: Number(m[LOGO_VER]) || 0, logoOnPrint: m[LOGO_PRINT] !== '0' };
}

export async function getLogo() {
  await ensure();
  const r = await query('SELECT svalue FROM appsetting WHERE skey=@k', { k: LOGO_KEY });
  return r[0]?.svalue ? parseLogo(r[0].svalue) : null;
}

settingsRouter.put(
  '/logo',
  wrap(async (req, res) => {
    parseLogo(req.body?.dataUrl); // validates type, signature and size
    await ensure();
    const up = 'INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue';
    await run(up, { k: LOGO_KEY, v: req.body.dataUrl });
    await run(up, { k: LOGO_VER, v: String(Date.now()) });
    res.json(await getBrand());
  }),
);

settingsRouter.delete(
  '/logo',
  wrap(async (_req, res) => {
    await ensure();
    await run("DELETE FROM appsetting WHERE skey IN ('app.logo','app.logo.ver')");
    res.json(await getBrand());
  }),
);

settingsRouter.put(
  '/logo-print',
  wrap(async (req, res) => {
    await ensure();
    await run('INSERT INTO appsetting(skey, svalue) VALUES(@k, @v) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue', { k: LOGO_PRINT, v: req.body?.on === false ? '0' : '1' });
    res.json(await getBrand());
  }),
);
