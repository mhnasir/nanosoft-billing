import { Router } from 'express';
import { query } from '../db.js';
import { wrap, badReq, notFound, ymd, int, r2, str, todayISO } from '../util.js';
import { GROSS } from '../gross.js';

export const reportsRouter = Router();

// Party balance = opening balance + every ledger row (positive = party owes us, negative = we owe party).
const BAL = `COALESCE(s.opnbal,0) + COALESCE((SELECT SUM(f.amount) FROM fatrans f WHERE f.supkey=s.supkey),0)`;

/* ---------- dashboard ---------- */
reportsRouter.get(
  '/dashboard',
  wrap(async (_req, res) => {
    const today = todayISO();
    const [bills, rec, bal, recent] = await Promise.all([
      query(
        `SELECT b.billtype AS "BillType", COUNT(*)::int AS "Cnt", SUM(${GROSS}) AS "Total"
         FROM bill01 b WHERE b.billtype IN ('B','S') AND b.billdate >= @d::date AND b.billdate < @d::date + 1 GROUP BY b.billtype`,
        { d: today },
      ),
      query(
        `SELECT rectype AS "RecType", COUNT(*)::int AS "Cnt", SUM(amount) AS "Total" FROM recpay02
         WHERE rectype IN ('R','P') AND recdate >= @d::date AND recdate < @d::date + 1 GROUP BY rectype`,
        { d: today },
      ),
      query(
        `SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b ELSE 0 END),0) AS "Receivable", COALESCE(SUM(CASE WHEN b < 0 THEN -b ELSE 0 END),0) AS "Payable"
         FROM (SELECT ${BAL} AS b FROM supmast s WHERE s.stat=0) x`,
      ),
      query(
        `SELECT b.billkey AS "BillKey", b.billno AS "BillNo", b.billdate AS "BillDate", b.billtype AS "BillType", s.supname AS "SupName", ${GROSS} AS "Gross"
         FROM bill01 b LEFT JOIN supmast s ON s.supkey=b.supkey WHERE b.billtype IN ('B','S')
         ORDER BY b.billdate DESC, b.billkey DESC LIMIT 8`,
      ),
    ]);
    res.json({ today, bills, receipts: rec, receivable: bal[0]?.Receivable || 0, payable: bal[0]?.Payable || 0, recent });
  }),
);

/* ---------- party ledger (replaces Rpt_DebLedg, without its shared temp table) ---------- */
reportsRouter.get(
  '/ledger',
  wrap(async (req, res) => {
    const supKey = int(req.query.supKey);
    if (!supKey) throw badReq('supKey is required');
    const from = ymd(str(req.query.from, 10), 'from date');
    const to = ymd(str(req.query.to, 10), 'to date');
    const party = await query(
      'SELECT supkey AS "SupKey", supname AS "SupName", city AS "City", suptype AS "SupType", COALESCE(opnbal,0) AS "OpnBal" FROM supmast WHERE supkey=@s',
      { s: supKey },
    );
    if (!party[0]) throw notFound('Party not found');
    const before = await query('SELECT COALESCE(SUM(amount),0) AS t FROM fatrans WHERE supkey=@s AND docdate < @f::date', { s: supKey, f: from });
    const rows = await query(
      `SELECT fatranskey AS "Id", docdate AS "Date", doctype AS "DocType", docno AS "DocNo", COALESCE(notes,'') AS "Notes", amount AS "Amount", COALESCE(less,0) AS "Less"
       FROM fatrans WHERE supkey=@s AND docdate >= @f::date AND docdate < @t::date + 1 ORDER BY docdate, fatranskey`,
      { s: supKey, f: from, t: to },
    );
    const opening = r2(party[0].OpnBal + before[0].t);
    let run = opening;
    const entries = rows.map((r) => {
      run = r2(run + r.Amount);
      return { ...r, Debit: r.Amount > 0 ? r.Amount : 0, Credit: r.Amount < 0 ? -r.Amount : 0, Balance: run };
    });
    res.json({
      party: party[0], opening, entries,
      totalDebit: r2(entries.reduce((s, e) => s + e.Debit, 0)),
      totalCredit: r2(entries.reduce((s, e) => s + e.Credit, 0)),
      closing: run,
    });
  }),
);

/* ---------- outstanding ---------- */
reportsRouter.get(
  '/outstanding',
  wrap(async (req, res) => {
    const type = str(req.query.type, 1).toUpperCase() || 'C';
    if (!['C', 'S', 'O', 'B', 'H'].includes(type)) throw badReq('Invalid party type');
    const rows = await query(
      `SELECT * FROM (
         SELECT s.supkey AS "SupKey", s.supname AS "SupName", s.city AS "City", g.custtype AS "GroupName", ${BAL} AS "Balance",
                (SELECT MAX(f.docdate) FROM fatrans f WHERE f.supkey=s.supkey AND f.doctype IN ('R','P')) AS "LastPayment",
                (SELECT p.phone FROM phonemast p WHERE p.supkey=s.supkey ORDER BY p.ordkey LIMIT 1) AS "Phone"
         FROM supmast s LEFT JOIN custtypemast g ON g.custkey=s.custkey
         WHERE s.stat=0 AND s.suptype=@t) x
       WHERE ABS("Balance") >= 0.005 ORDER BY "Balance" DESC`,
      { t: type },
    );
    res.json({ rows, total: r2(rows.reduce((s, r) => s + r.Balance, 0)) });
  }),
);

/* ---------- day book ---------- */
reportsRouter.get(
  '/daybook',
  wrap(async (req, res) => {
    const from = ymd(str(req.query.from, 10), 'from date');
    const to = ymd(str(req.query.to, 10) || str(req.query.from, 10), 'to date');
    const p = { f: from, t: to };
    const bills = await query(
      `SELECT b.billdate AS "Date", 'Bill ' || b.billtype AS "Kind", b.billno AS "No", s.supname AS "SupName", ${GROSS} AS "Amount"
       FROM bill01 b LEFT JOIN supmast s ON s.supkey=b.supkey
       WHERE b.billtype IN ('B','S') AND b.billdate >= @f::date AND b.billdate < @t::date + 1 ORDER BY b.billdate, b.billkey`,
      p,
    );
    const recs = await query(
      `SELECT r.recdate AS "Date", CASE r.rectype WHEN 'R' THEN 'Receipt' ELSE 'Payment' END AS "Kind", r.recpay02key AS "No",
              s.supname AS "SupName", r.amount AS "Amount", r.cash AS "Mode"
       FROM recpay02 r LEFT JOIN supmast s ON s.supkey=r.supkey
       WHERE r.rectype IN ('R','P') AND r.recdate >= @f::date AND r.recdate < @t::date + 1 ORDER BY r.recdate, r.recpay02key`,
      p,
    );
    const sum = (arr, k) => r2(arr.filter((x) => x.Kind === k).reduce((s, x) => s + x.Amount, 0));
    res.json({
      bills, receipts: recs,
      totals: { billB: sum(bills, 'Bill B'), billS: sum(bills, 'Bill S'), receipts: sum(recs, 'Receipt'), payments: sum(recs, 'Payment') },
    });
  }),
);

/* ---------- trial balance by party group ---------- */
reportsRouter.get(
  '/trial-balance',
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT COALESCE(g.custtype,'(No group)') AS "GroupName",
              COALESCE(SUM(CASE WHEN x.bal > 0 THEN x.bal ELSE 0 END),0) AS "Debit",
              COALESCE(SUM(CASE WHEN x.bal < 0 THEN -x.bal ELSE 0 END),0) AS "Credit",
              COUNT(*)::int AS "Parties"
       FROM (SELECT s.supkey, s.custkey, ${BAL} AS bal FROM supmast s WHERE s.stat=0) x
       LEFT JOIN custtypemast g ON g.custkey=x.custkey
       WHERE ABS(x.bal) >= 0.005
       GROUP BY g.custtype ORDER BY g.custtype NULLS LAST`,
    );
    res.json({
      rows,
      totalDebit: r2(rows.reduce((s, r) => s + r.Debit, 0)),
      totalCredit: r2(rows.reduce((s, r) => s + r.Credit, 0)),
    });
  }),
);
