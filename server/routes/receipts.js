import { Router } from 'express';
import { query, withTx, refreshBalance } from '../db.js';
import { wrap, badReq, notFound, ymd, num, int, r2, str } from '../util.js';

export const receiptsRouter = Router();

// R = receipt from a party (credits the ledger), P = payment to a party (debits the ledger)
const TYPES = ['R', 'P'];
const MODES = ['Cash', 'Cheque', 'DD'];

export function parseReceipt(body) {
  const recType = str(body.recType, 1).toUpperCase();
  if (!TYPES.includes(recType)) throw badReq('recType must be R or P');
  const supKey = int(body.supKey);
  if (!supKey) throw badReq('Select a party');
  const recDate = ymd(str(body.recDate, 10), 'date');
  const amount = r2(num(body.amount));
  const lessAmt = r2(num(body.lessAmt));
  if (amount <= 0) throw badReq('Amount must be greater than 0');
  if (lessAmt < 0) throw badReq('Discount cannot be negative');
  const mode = MODES.includes(body.mode) ? body.mode : 'Cash';
  const shift = ['S1', 'S2', 'S3'].includes(body.shift) ? body.shift : '';
  const creditDate = mode === 'Cash' || !body.creditDate ? null : ymd(String(body.creditDate), 'cheque date');
  return {
    recType, supKey, recDate, amount, lessAmt, mode, shift, creditDate,
    narration: str(body.narration, 200),
    creditNo: mode === 'Cash' ? '' : str(body.creditNo, 50),
    bankKey: int(body.bankKey),
    bankers: str(body.bankers, 50),
  };
}

// Ledger amount posted for the entry: receipts credit (negative), payments debit (positive); discount is included.
const ledgerAmount = (r) => (r.recType === 'R' ? -1 : 1) * r2(r.amount + r.lessAmt);

receiptsRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = ["r.rectype IN ('R','P')"];
    const p = {};
    const t = str(req.query.type, 1).toUpperCase();
    if (t) { if (!TYPES.includes(t)) throw badReq('Invalid type'); where.push('r.rectype=@t'); p.t = t; }
    if (req.query.from) { where.push('r.recdate >= @f::date'); p.f = ymd(String(req.query.from), 'from date'); }
    if (req.query.to) { where.push('r.recdate < @to::date + 1'); p.to = ymd(String(req.query.to), 'to date'); }
    if (req.query.supKey) { where.push('r.supkey=@s'); p.s = int(req.query.supKey); }
    res.json(
      await query(
        `SELECT r.recpay02key AS "Id", r.recpaykey AS "RecPayKey", r.recdate AS "RecDate", rtrim(r.rectype) AS "RecType", r.supkey AS "SupKey",
                s.supname AS "SupName", s.city AS "City", r.amount AS "Amount", COALESCE(r.lessamt,0) AS "LessAmt", r.narration AS "Narration",
                r.cash AS "Mode", r.creditno AS "CreditNo", r.creditdate AS "CreditDate", r.bankkey AS "BankKey", r.bankers AS "Bankers", r.shift AS "Shift"
         FROM recpay02 r LEFT JOIN supmast s ON s.supkey=r.supkey
         WHERE ${where.join(' AND ')} ORDER BY r.recdate DESC, r.recpay02key DESC LIMIT 500`,
        p,
      ),
    );
  }),
);

receiptsRouter.post(
  '/',
  wrap(async (req, res) => {
    const r = parseReceipt(req.body || {});
    const id = await withTx(async (db) => {
      const p = await db.query('SELECT supkey FROM supmast WHERE supkey=@s AND stat=0', { s: r.supKey });
      if (!p[0]) throw badReq('Party not found');
      const h = await db.query('INSERT INTO recpay01(recpaydate,recpaytype) VALUES(@d::date,@t) RETURNING recpaykey', { d: r.recDate, t: r.recType });
      const ins = await db.query(
        `INSERT INTO recpay02(recpaykey,recdate,supkey,amount,lessamt,narration,cash,creditno,creditdate,bankkey,bankers,billkey,rectype,shift)
         VALUES(@k,@d::date,@s,@amount,@less,@narr,@mode,@cno,@cdate::date,@bank,@bankers,0,@t,@shift) RETURNING recpay02key`,
        { k: h[0].recpaykey, d: r.recDate, s: r.supKey, amount: r.amount, less: r.lessAmt, narr: r.narration, mode: r.mode, cno: r.creditNo, cdate: r.creditDate, bank: r.bankKey, bankers: r.bankers, t: r.recType, shift: r.shift },
      );
      const id2 = ins[0].recpay02key;
      const f = await db.query(
        `INSERT INTO fatrans(docno,docdate,doctype,supkey,amount,refkey,transdate,recpay02stat,less,notes)
         VALUES(@docno,@d::date,@t,@s,@amt,@ref,now(),1,@less,@notes) RETURNING fatranskey`,
        { docno: r.creditNo, d: r.recDate, t: r.recType, s: r.supKey, amt: ledgerAmount(r), ref: id2, less: r.recType === 'R' ? r.lessAmt : 0, notes: r.narration.slice(0, 50) },
      );
      await db.query('UPDATE recpay02 SET fatranskey=@f WHERE recpay02key=@id', { f: f[0].fatranskey, id: id2 });
      await db.query('UPDATE supmast SET cashdate=@d WHERE supkey=@s', { d: r.recDate, s: r.supKey });
      return id2;
    });
    res.status(201).json({ id });
  }),
);

receiptsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const r = parseReceipt(req.body || {});
    await withTx(async (db) => {
      const cur = await db.query('SELECT recpaykey, rectype, supkey, fatranskey FROM recpay02 WHERE recpay02key=@id FOR UPDATE', { id });
      if (!cur[0] || !TYPES.includes(cur[0].rectype.trim())) throw notFound('Entry not found');
      if (cur[0].rectype.trim() !== r.recType) throw badReq('Type cannot be changed');
      await db.query(
        `UPDATE recpay02 SET supkey=@s, amount=@amount, lessamt=@less, narration=@narr, billkey=0, cash=@mode, creditno=@cno,
           creditdate=@cdate::date, bankkey=@bank, bankers=@bankers, shift=@shift, recdate=@d::date WHERE recpay02key=@id`,
        { id, s: r.supKey, amount: r.amount, less: r.lessAmt, narr: r.narration, mode: r.mode, cno: r.creditNo, cdate: r.creditDate, bank: r.bankKey, bankers: r.bankers, shift: r.shift, d: r.recDate },
      );
      if (cur[0].fatranskey) {
        await db.query(
          'UPDATE fatrans SET amount=@amt, less=@less, notes=@notes, supkey=@s, docdate=@d::date, docno=@docno WHERE fatranskey=@f',
          { amt: ledgerAmount(r), less: r.lessAmt, notes: r.narration.slice(0, 50), s: r.supKey, d: r.recDate, docno: r.creditNo, f: cur[0].fatranskey },
        );
      }
      await db.query('UPDATE supmast SET cashdate=@d WHERE supkey=@s', { d: r.recDate, s: r.supKey });
      await refreshBalance(db, r.supKey);
      if (cur[0].supkey !== r.supKey) await refreshBalance(db, cur[0].supkey);
    });
    res.json({ ok: true });
  }),
);

receiptsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    await withTx(async (db) => {
      const cur = await db.query('SELECT recpaykey, rectype, supkey, fatranskey FROM recpay02 WHERE recpay02key=@id FOR UPDATE', { id });
      if (!cur[0] || !TYPES.includes(cur[0].rectype.trim())) throw notFound('Entry not found');
      if (cur[0].fatranskey) await db.query('DELETE FROM fatrans WHERE fatranskey=@f', { f: cur[0].fatranskey });
      await db.query('DELETE FROM recpay02 WHERE recpay02key=@id', { id });
      const left = await db.query('SELECT COUNT(*)::int AS c FROM recpay02 WHERE recpaykey=@k', { k: cur[0].recpaykey });
      if (!left[0].c) await db.query('DELETE FROM recpay01 WHERE recpaykey=@k', { k: cur[0].recpaykey });
      await refreshBalance(db, cur[0].supkey);
    });
    res.json({ ok: true });
  }),
);
