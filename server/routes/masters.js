import { Router } from 'express';
import { query, run, withTx, refreshBalance } from '../db.js';
import { wrap, badReq, notFound, HttpError, int, num, str } from '../util.js';

export const mastersRouter = Router();

/* ---------- generic simple masters ---------- */
// col: [ApiName, kind, maxLen]  kind: s = string, n = number, i = integer. DB column = ApiName in lower case.
const SIMPLE = {
  groups: {
    table: 'custtypemast', key: 'CustKey', orderBy: 'custtype',
    cols: [['CustType', 's', 30], ['GroupKey', 'i'], ['Display', 'i']],
    defaults: { Display: 1, GroupKey: 0 },
    usedBy: 'SELECT COUNT(*)::int AS c FROM supmast WHERE custkey=@id',
    required: ['CustType'],
  },
  banks: {
    table: 'bankmast', key: 'BankKey', orderBy: 'bankname',
    cols: [['BankName', 's', 50], ['OpBalance', 'n']],
    defaults: { OpBalance: 0 },
    usedBy: 'SELECT COUNT(*)::int AS c FROM recpay02 WHERE bankkey=@id',
    required: ['BankName'],
  },
  marks: {
    table: 'markmaster', key: 'MarkKey', orderBy: 'markname',
    cols: [['ProdKey', 'i'], ['MarkName', 's', 15]],
    defaults: { ProdKey: 0 },
    usedBy: 'SELECT COUNT(*)::int AS c FROM bill02 WHERE markskey=@id',
    required: ['MarkName'],
  },
  products: {
    table: 'productmast', key: 'ProdKey', orderBy: 'prodname',
    cols: [
      ['ProdName', 's', 50], ['BrandName', 's', 50], ['ProdTamilName', 's', 50], ['ProdMalaName', 's', 50],
      ['Unit', 's', 10], ['Cooly', 'n'], ['CurPrice', 'n'], ['OrderKey', 'i'], ['Basket', 'i'], ['Gunny', 'i'], ['ProdNo', 's', 10],
    ],
    defaults: { Unit: 'Kg', Cooly: 0, CurPrice: 0, OrderKey: 0, Basket: 0, Gunny: 0 },
    usedBy: 'SELECT COUNT(*)::int AS c FROM bill02 WHERE prodkey=@id',
    required: ['ProdName'],
  },
};

const lc = (s) => s.toLowerCase();

function coerce(def, body) {
  const out = {};
  for (const [col, kind, max] of def.cols) {
    let v = body[col];
    if (v === undefined || v === null || v === '') v = def.defaults?.[col] ?? (kind === 's' ? '' : 0);
    if (kind === 's') out[col] = str(v, max);
    else if (kind === 'i') out[col] = int(v);
    else out[col] = num(v);
  }
  for (const r of def.required) if (!out[r]) throw badReq(`${r} is required`);
  return out;
}

for (const [name, def] of Object.entries(SIMPLE)) {
  const base = `/${name}`;
  const select = [`${lc(def.key)} AS "${def.key}"`, ...def.cols.map(([c]) => `${lc(c)} AS "${c}"`)].join(', ');

  mastersRouter.get(
    base,
    wrap(async (req, res) => {
      const q = str(req.query.q, 50);
      const nameCol = lc(def.cols[0][0]);
      const rows = q
        ? await query(`SELECT ${select} FROM ${def.table} WHERE ${nameCol} ILIKE @q ORDER BY ${def.orderBy}`, { q: `%${q}%` })
        : await query(`SELECT ${select} FROM ${def.table} ORDER BY ${def.orderBy}`);
      res.json(rows);
    }),
  );

  mastersRouter.post(
    base,
    wrap(async (req, res) => {
      const v = coerce(def, req.body || {});
      const cols = Object.keys(v);
      const rows = await query(
        `INSERT INTO ${def.table}(${cols.map(lc).join(',')}) VALUES(${cols.map((c) => '@' + c).join(',')}) RETURNING ${lc(def.key)} AS id`,
        v,
      );
      res.status(201).json({ id: rows[0].id });
    }),
  );

  mastersRouter.put(
    `${base}/:id`,
    wrap(async (req, res) => {
      const id = int(req.params.id);
      const v = coerce(def, req.body || {});
      const r = await run(`UPDATE ${def.table} SET ${Object.keys(v).map((c) => `${lc(c)}=@${c}`).join(',')} WHERE ${lc(def.key)}=@id`, { ...v, id });
      if (!r.rowCount) throw notFound();
      res.json({ ok: true });
    }),
  );

  mastersRouter.delete(
    `${base}/:id`,
    wrap(async (req, res) => {
      const id = int(req.params.id);
      const used = await query(def.usedBy, { id });
      if (used[0].c > 0) throw new HttpError(409, `Cannot delete: used in ${used[0].c} record(s)`);
      await query(`DELETE FROM ${def.table} WHERE ${lc(def.key)}=@id`, { id });
      res.json({ ok: true });
    }),
  );
}

/* ---------- company (print header) ---------- */
mastersRouter.get(
  '/company',
  wrap(async (_req, res) => {
    const r = await query(
      `SELECT companname AS "CompanName", propname AS "PropName", address AS "Address", address1 AS "Address1", phoneno AS "Phoneno"
       FROM companymaster ORDER BY companykey LIMIT 1`,
    );
    res.json(r[0] || {});
  }),
);

/* ---------- parties (supmast): C customer, S supplier/farmer, O others, B branch ---------- */
const PARTY_TYPES = ['C', 'S', 'O', 'B'];

const PARTY_SELECT = `
  SELECT s.supkey AS "SupKey", s.supcode AS "SupCode", s.supname AS "SupName", s.add1 AS "Add1", s.add2 AS "Add2", s.add3 AS "Add3",
         s.city AS "City", s.pincode AS "Pincode", s.state AS "State", s.email AS "Email", s.tngstno AS "TNGSTNO",
         s.suptype AS "SupType", s.custkey AS "CustKey", g.custtype AS "GroupName",
         COALESCE(s.opnbal,0) AS "OpnBal",
         COALESCE(s.opnbal,0) + COALESCE((SELECT SUM(f.amount) FROM fatrans f WHERE f.supkey=s.supkey),0) AS "Balance",
         (SELECT p.phone FROM phonemast p WHERE p.supkey=s.supkey ORDER BY p.ordkey LIMIT 1) AS "Phone"
  FROM supmast s LEFT JOIN custtypemast g ON g.custkey = s.custkey`;

mastersRouter.get(
  '/parties',
  wrap(async (req, res) => {
    const type = str(req.query.type, 1).toUpperCase();
    const q = str(req.query.q, 60);
    const where = ['s.stat = 0'];
    const p = {};
    if (type) {
      if (!PARTY_TYPES.includes(type)) throw badReq('Invalid party type');
      where.push('s.suptype = @t');
      p.t = type;
    }
    if (q) {
      where.push('(s.supname ILIKE @q OR s.city ILIKE @q OR s.supcode ILIKE @q)');
      p.q = `%${q}%`;
    }
    p.lim = Math.min(int(req.query.limit, 500) || 500, 2000);
    res.json(await query(`${PARTY_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.supname LIMIT @lim`, p));
  }),
);

mastersRouter.get(
  '/parties/:id',
  wrap(async (req, res) => {
    const rows = await query(`${PARTY_SELECT} WHERE s.supkey=@id`, { id: int(req.params.id) });
    if (!rows[0]) throw notFound('Party not found');
    res.json(rows[0]);
  }),
);

function partyBody(b) {
  const type = str(b.SupType, 1).toUpperCase() || 'C';
  if (!PARTY_TYPES.includes(type)) throw badReq('Invalid party type');
  const name = str(b.SupName, 100);
  if (!name) throw badReq('Name is required');
  return {
    supcode: str(b.SupCode, 50), supname: name, add1: str(b.Add1, 100) || '-', add2: str(b.Add2, 100), add3: str(b.Add3, 100),
    city: str(b.City, 40), pincode: str(b.Pincode, 8), state: str(b.State, 40), email: str(b.Email, 100), tngstno: str(b.TNGSTNO, 50),
    suptype: type, custkey: int(b.CustKey), opnbal: num(b.OpnBal),
  };
}

async function savePhone(db, supKey, phone) {
  const p = str(phone, 15);
  await db.query('DELETE FROM phonemast WHERE supkey=@s AND ordkey=1', { s: supKey });
  if (p) await db.query('INSERT INTO phonemast(supkey,phone,ordkey) VALUES(@s,@p,1)', { s: supKey, p });
}

mastersRouter.post(
  '/parties',
  wrap(async (req, res) => {
    const v = partyBody(req.body || {});
    const id = await withTx(async (db) => {
      const cols = Object.keys(v);
      const rows = await db.query(
        `INSERT INTO supmast(${cols.join(',')},stat,accessdate) VALUES(${cols.map((c) => '@' + c).join(',')},0,now()) RETURNING supkey AS id`,
        v,
      );
      await savePhone(db, rows[0].id, req.body?.Phone);
      await refreshBalance(db, rows[0].id);
      return rows[0].id;
    });
    res.status(201).json({ id });
  }),
);

mastersRouter.put(
  '/parties/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const v = partyBody(req.body || {});
    await withTx(async (db) => {
      const r = await db.run(`UPDATE supmast SET ${Object.keys(v).map((c) => `${c}=@${c}`).join(',')} WHERE supkey=@id AND stat=0`, { ...v, id });
      if (!r.rowCount) throw notFound('Party not found');
      await savePhone(db, id, req.body?.Phone);
      await refreshBalance(db, id);
    });
    res.json({ ok: true });
  }),
);

// Soft delete, like the VB app (stat = 1 hides the party). Refused while the party has bills/receipts.
mastersRouter.delete(
  '/parties/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const used = await query('SELECT COUNT(*)::int AS c FROM fatrans WHERE supkey=@id', { id });
    if (used[0].c > 0) throw new HttpError(409, `Cannot delete: ${used[0].c} ledger entr${used[0].c === 1 ? 'y' : 'ies'} exist for this party`);
    await query('UPDATE supmast SET stat=1 WHERE supkey=@id', { id });
    res.json({ ok: true });
  }),
);
