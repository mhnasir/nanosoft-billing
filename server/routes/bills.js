import { Router } from 'express';
import { query, withTx, refreshBalance } from '../db.js';
import { wrap, badReq, notFound, HttpError, ymd, num, int, r2, str } from '../util.js';
import { GROSS } from '../gross.js';

export const billsRouter = Router();

// B = customer bill (debits the party in the ledger), S = supplier/farmer bill (credits the party).
const TYPES = ['B', 'S'];

// The old app's Format(x, "00"): whole rupees, halves round away from zero.
const whole = (x) => Math.sign(x) * Math.round(Math.abs(x));
const isKgs = (unit) => String(unit || '').trim().toUpperCase() === 'KGS';
const txt = (x) => String(Math.round(x * 1000) / 1000);

const CHARGE_KEYS = ['advAmt', 'coolyAmt', 'kCoolyAmt', 'basketAmt', 'gunnyAmt', 'commissionAmt', 'othersAddAmt'];

/**
 * gross / net from the amounts already on b. prevBal is the party's signed ledger balance before this bill.
 * Sales bill: charges are added and discounts taken off. Purchase bill: the two "added" amounts (disAmt, othersLessAmt)
 * are added and the charges (commission, cooly, lorry hire, gunny, advance ...) are deducted from the farmer.
 */
export function computeTotals(b, prevBal = 0) {
  b.billAmt = r2(b.lines.reduce((s, l) => s + l.amount, 0));
  const charges = CHARGE_KEYS.reduce((s, k) => s + b[k], 0);
  const sideAmts = b.disAmt + b.othersLessAmt;
  b.gross = r2(b.billType === 'B' ? b.billAmt + charges - sideAmts : b.billAmt + sideAmts - charges);
  // What the printed bill shows as the amount to settle: previous balance and this bill, less cash. For a supplier the
  // balance is stored negative when we owe them, so it is subtracted (same as the VB form).
  // A "non-balance" bill (VB NonBalanceStat) shows no previous balance: it stands alone on the printout.
  const pb = b.nonBalance ? 0 : prevBal;
  b.prevBal = r2(pb);
  b.netAmt = r2(b.billType === 'B' ? pb + b.gross - b.cashAmt : b.gross - pb - b.cashAmt);
  return b;
}

export function parseBill(body) {
  const billType = str(body.billType, 1).toUpperCase();
  if (!TYPES.includes(billType)) throw badReq('billType must be B or S');
  const supKey = int(body.supKey);
  if (!supKey) throw badReq('Select a party');
  const billDate = ymd(str(body.billDate, 10), 'bill date');
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw badReq('Add at least one item');
  if (rawLines.length > 250) throw badReq('Too many lines (max 250)');

  const lines = rawLines.map((l, i) => {
    const prodKey = int(l.prodKey);
    const qty = num(l.qty);
    const rate = num(l.rate);
    const nop = num(l.nop);
    const unit = str(l.unit, 10) || 'Kgs';
    if (!prodKey) throw badReq(`Line ${i + 1}: select an item`);
    // Same rule as the VB grid: Kgs items are weight x rate, every other unit (Nop ...) is number of bags x rate.
    if (isKgs(unit) && qty === 0) throw badReq(`Line ${i + 1}: quantity must not be 0`);
    if (!isKgs(unit) && nop === 0) throw badReq(`Line ${i + 1}: enter the number of bags (Nop)`);
    if (rate < 0) throw badReq(`Line ${i + 1}: rate cannot be negative`);
    return {
      prodKey, qty, rate, nop, unit, marks: str(l.marks, 50),
      weightTxt: str(l.weightTxt, 250), amount: whole(isKgs(unit) ? qty * rate : nop * rate), ord: i + 1,
    };
  });

  const b = {
    billType, supKey, billDate, lines,
    advAmt: r2(num(body.advAmt)), coolyAmt: r2(num(body.coolyAmt)), kCoolyAmt: r2(num(body.kCoolyAmt)),
    basketAmt: r2(num(body.basketAmt)), gunnyAmt: r2(num(body.gunnyAmt)), commissionAmt: r2(num(body.commissionAmt)),
    othersAddAmt: r2(num(body.othersAddAmt)), disAmt: r2(num(body.disAmt)), othersLessAmt: r2(num(body.othersLessAmt)),
    cashAmt: r2(num(body.cashAmt)),
    auto: { cooly: !!body.autoCooly, basket: !!body.autoBasket, gunny: !!body.autoGunny },
    othersAddStr: str(body.othersAddStr, 50),
    othersLessStr: str(body.othersLessStr, 50),
    lotNo: str(body.lotNo, 30),
    nonBalance: !!body.nonBalance,
    // Header totals as the VB form saves them: Nop = total weight, InOutPur = total bags.
    nop: txt(lines.reduce((s, l) => s + l.qty, 0)),
    inOutPur: txt(lines.reduce((s, l) => s + l.nop, 0)),
    billNo: body.billNo ? int(body.billNo) : 0,
  };
  computeTotals(b);
  if (b.gross < 0) throw badReq('Total cannot be negative');
  return b;
}

/**
 * The "Yes" switches of the VB forms, worked out from the bags on each line and the product's rate per bag:
 *   sales bill    - autoBasket: commission (stored in AdvAmt, as the old form did) = bags x product Basket
 *                   autoCooly:  cooly = bags x product Cooly
 *   purchase bill - autoGunny:  unloading cooly = bags x product Gunny
 */
async function applyAuto(db, b) {
  const { cooly, basket, gunny } = b.auto;
  if (!cooly && !basket && !gunny) return b;
  const keys = [...new Set(b.lines.map((l) => l.prodKey))];
  const rows = await db.query('SELECT prodkey, cooly, basket, gunny FROM productmast WHERE prodkey = ANY(@k::int[])', { k: keys });
  const rate = new Map(rows.map((r) => [r.prodkey, r]));
  const sum = (col) => r2(b.lines.reduce((s, l) => s + l.nop * Number(rate.get(l.prodKey)?.[col] || 0), 0));
  if (b.billType === 'B') {
    if (basket) b.advAmt = sum('basket');
    if (cooly) b.coolyAmt = sum('cooly');
  } else if (gunny) {
    b.coolyAmt = sum('gunny');
  }
  return b;
}

/** Same rules as the VB MaxValueBillNo: sales bills (B/O) keep counting for ever, purchase bills (S) restart every day. */
async function nextBillNo(db, billType, dateISO) {
  const r =
    billType === 'B'
      ? await db.query("SELECT MAX(billno) AS m FROM bill01 WHERE billtype IN ('B','O')")
      : await db.query("SELECT MAX(billno) AS m FROM bill01 WHERE billtype='S' AND billdate >= @d::date AND billdate < @d::date + 1", { d: dateISO });
  return (r[0]?.m || 0) + 1;
}

/** Party balance excluding one ledger row (so an edited bill does not count itself). */
async function balanceBefore(db, supKey, exceptFatransKey) {
  const r = await db.query(
    `SELECT COALESCE(opnbal,0) + COALESCE((SELECT SUM(amount) FROM fatrans WHERE supkey=@s AND fatranskey<>@f),0) AS bal FROM supmast WHERE supkey=@s`,
    { s: supKey, f: exceptFatransKey || 0 },
  );
  return r[0]?.bal || 0;
}

const HEADER_COLS = `billno,cooly,basket,gunny,billdate,supkey,billamt,disamt,cashdate,dayamt,otherslessamt,otherslessstr,basketlessamt,baldate,balamt,
  advamt,coolyamt,kcoolyamt,basketamt,gunnyamt,commissionamt,englishamt,othersaddamt,othersaddstr,cashamt,dctype,netamt,billtype,multicashstat,
  nonbalancestat,inoutpur,lotno,nop,transportkey`;

function headerValues(b, billNo) {
  const yes = (f) => (f ? 'Yes' : '');
  return {
    billno: billNo, cooly: yes(b.auto.cooly), basket: yes(b.auto.basket), gunny: yes(b.auto.gunny), billdate: b.billDate, supkey: b.supKey, billamt: b.billAmt, disamt: b.disAmt,
    cashdate: b.billDate, dayamt: 0, otherslessamt: b.othersLessAmt, otherslessstr: b.othersLessStr, basketlessamt: 0, baldate: b.billDate,
    balamt: b.prevBal, advamt: b.advAmt, coolyamt: b.coolyAmt, kcoolyamt: b.kCoolyAmt, basketamt: b.basketAmt, gunnyamt: b.gunnyAmt,
    commissionamt: b.commissionAmt,
    englishamt: 0, // like the VB proc: the gross total goes to the ledger, Bill01.EnglishAmt stays 0
    othersaddamt: b.othersAddAmt, othersaddstr: b.othersAddStr, cashamt: b.cashAmt, dctype: b.billType === 'S' ? '3' : '1', netamt: b.netAmt, billtype: b.billType,
    multicashstat: '', nonbalancestat: b.nonBalance ? 1 : 0, inoutpur: b.inOutPur, lotno: b.lotNo, nop: b.nop, transportkey: 0,
  };
}

async function insertLines(db, billKey, b) {
  for (const l of b.lines) {
    await db.query(
      `INSERT INTO bill02(billkey,prodkey,qty,unit,nop,rate,amount,ordkey,weighttxt,bsupkey,ordqty,lssupkey,billdate,lessstat,inout,marks,lotkey,markskey,prate,pratetot)
       VALUES(@billkey,@prodkey,@qty,@unit,@nop,@rate,@amount,@ordkey,@weighttxt,0,@nop,0,@billdate,0,'0',@marks,0,0,0,0)`,
      { billkey: billKey, prodkey: l.prodKey, qty: l.qty, unit: l.unit, nop: l.nop, rate: l.rate, amount: l.amount, ordkey: l.ord, weighttxt: l.weightTxt, billdate: b.billDate, marks: l.marks },
    );
  }
}

async function assertParty(db, supKey) {
  const p = await db.query('SELECT supkey FROM supmast WHERE supkey=@s AND stat=0', { s: supKey });
  if (!p[0]) throw badReq('Party not found');
}

/* ---------- list ---------- */
billsRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = ["b.billtype IN ('B','S')"];
    const p = {};
    const type = str(req.query.type, 1).toUpperCase();
    if (type) {
      if (!TYPES.includes(type)) throw badReq('Invalid type');
      where.push('b.billtype=@t');
      p.t = type;
    }
    if (req.query.from) { where.push('b.billdate >= @f::date'); p.f = ymd(String(req.query.from), 'from date'); }
    if (req.query.to) { where.push('b.billdate < @to::date + 1'); p.to = ymd(String(req.query.to), 'to date'); }
    if (req.query.supKey) { where.push('b.supkey=@s'); p.s = int(req.query.supKey); }
    const q = str(req.query.q, 60);
    if (q) {
      where.push('(s.supname ILIKE @q OR b.billno::text = @qn)');
      p.q = `%${q}%`;
      p.qn = q;
    }
    res.json(
      await query(
        `SELECT b.billkey AS "BillKey", b.billno AS "BillNo", b.billdate AS "BillDate", b.billtype AS "BillType", b.supkey AS "SupKey",
                s.supname AS "SupName", s.city AS "City", ${GROSS} AS "Gross", COALESCE(b.cashamt,0) AS "CashAmt", COALESCE(b.netamt,0) AS "NetAmt"
         FROM bill01 b LEFT JOIN supmast s ON s.supkey=b.supkey
         WHERE ${where.join(' AND ')}
         ORDER BY b.billdate DESC, b.billno DESC, b.billkey DESC LIMIT 500`,
        p,
      ),
    );
  }),
);

billsRouter.get(
  '/next-no',
  wrap(async (req, res) => {
    const type = str(req.query.type, 1).toUpperCase();
    if (!TYPES.includes(type)) throw badReq('Invalid type');
    res.json({ billNo: await nextBillNo({ query }, type, ymd(str(req.query.date, 10))) });
  }),
);

/* ---------- read one ---------- */
async function loadBill(id) {
  const h = await query(
    `SELECT b.billkey AS "BillKey", b.billno AS "BillNo", b.billdate AS "BillDate", b.billtype AS "BillType", b.supkey AS "SupKey",
            b.billamt AS "BillAmt", b.disamt AS "DisAmt", b.otherslessamt AS "OthersLessAmt", b.otherslessstr AS "OthersLessStr",
            b.advamt AS "AdvAmt", b.coolyamt AS "CoolyAmt", b.kcoolyamt AS "KCoolyAmt", b.basketamt AS "BasketAmt", b.gunnyamt AS "GunnyAmt",
            b.commissionamt AS "CommissionAmt", b.othersaddamt AS "OthersAddAmt", b.othersaddstr AS "OthersAddStr", b.cashamt AS "CashAmt",
            b.netamt AS "NetAmt", b.balamt AS "BalAmt", b.cooly AS "AutoCooly", b.basket AS "AutoBasket", b.gunny AS "AutoGunny", b.dctype AS "DcType", (b.nonbalancestat = 1) AS "NonBalance", b.lotno AS "LotNo", b.inoutpur AS "InOutPur", b.nop AS "Nop", b.fatranskey AS "FatransKey",
            ${GROSS} AS "Gross", s.supname AS "SupName", s.add1 AS "Add1", s.add2 AS "Add2", s.add3 AS "Add3", s.city AS "City",
            s.pincode AS "Pincode", s.state AS "State", s.tngstno AS "TNGSTNO",
            (SELECT p.phone FROM phonemast p WHERE p.supkey=s.supkey ORDER BY p.ordkey LIMIT 1) AS "Phone"
     FROM bill01 b LEFT JOIN supmast s ON s.supkey=b.supkey WHERE b.billkey=@id AND b.billtype IN ('B','S')`,
    { id },
  );
  if (!h[0]) return null;
  const lines = await query(
    `SELECT l.sal02key AS "Sal02Key", l.prodkey AS "ProdKey", p.prodname AS "ProdName", p.prodtamilname AS "ProdTamilName",
            p.prodmalaname AS "ProdMalaName", l.qty AS "Qty", l.unit AS "Unit", l.nop AS "Nop", l.rate AS "Rate", l.amount AS "Amount",
            l.marks AS "Marks", l.ordkey AS "OrdKey", l.weighttxt AS "WeightTxt"
     FROM bill02 l LEFT JOIN productmast p ON p.prodkey=l.prodkey WHERE l.billkey=@id ORDER BY l.ordkey, l.sal02key`,
    { id },
  );
  return { ...h[0], lines };
}

billsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const bill = await loadBill(int(req.params.id));
    if (!bill) throw notFound('Bill not found');
    res.json(bill);
  }),
);

/* ---------- create ---------- */
billsRouter.post(
  '/',
  wrap(async (req, res) => {
    const b = parseBill(req.body || {});
    const out = await withTx(async (db) => {
      await assertParty(db, b.supKey);
      const billNo = b.billNo || (await nextBillNo(db, b.billType, b.billDate));
      await applyAuto(db, b);
      computeTotals(b, await balanceBefore(db, b.supKey, 0));
      if (b.gross < 0) throw badReq('Total cannot be negative');
      const hv = headerValues(b, billNo);
      const cols = HEADER_COLS.split(',').map((c) => c.trim());
      const ins = await db.query(`INSERT INTO bill01(${cols.join(',')}) VALUES(${cols.map((c) => '@' + c).join(',')}) RETURNING billkey`, hv);
      const billKey = ins[0].billkey;
      // Ledger posting (what InsUp_Bill01 did): B debits the party, S credits it.
      const sign = b.billType === 'B' ? 1 : -1;
      const f = await db.query(
        `INSERT INTO fatrans(docno,docdate,doctype,supkey,amount,refkey,transdate,less)
         VALUES(@docno,@d,@t,@s,@amt,@ref,now(),@less) RETURNING fatranskey`,
        { docno: String(billNo), d: b.billDate, t: b.billType, s: b.supKey, amt: sign * b.gross, ref: billKey, less: b.cashAmt },
      );
      await db.query('UPDATE bill01 SET fatranskey=@f, btob=@n WHERE billkey=@b', { f: f[0].fatranskey, b: billKey, n: b.nonBalance ? 1 : 0 });
      await insertLines(db, billKey, b);
      await refreshBalance(db, b.supKey);
      return { billKey, billNo };
    });
    res.status(201).json(out);
  }),
);

/* ---------- update ---------- */
billsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const b = parseBill(req.body || {});
    const out = await withTx(async (db) => {
      const cur = await db.query('SELECT billno, supkey, billtype, fatranskey FROM bill01 WHERE billkey=@id FOR UPDATE', { id });
      if (!cur[0] || !TYPES.includes(cur[0].billtype)) throw notFound('Bill not found');
      if (cur[0].billtype !== b.billType) throw badReq('Bill type cannot be changed');
      await assertParty(db, b.supKey);
      const billNo = b.billNo || cur[0].billno;
      await applyAuto(db, b);
      computeTotals(b, await balanceBefore(db, b.supKey, cur[0].fatranskey));
      if (b.gross < 0) throw badReq('Total cannot be negative');
      const hv = headerValues(b, billNo);
      // Flags this screen does not edit (multi-cash, transport) stay as they were.
      const KEEP = ['multicashstat', 'transportkey'];
      const cols = HEADER_COLS.split(',').map((c) => c.trim()).filter((c) => !KEEP.includes(c));
      await db.query(`UPDATE bill01 SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE billkey=@id`, { ...hv, id });
      const sign = b.billType === 'B' ? 1 : -1;
      if (cur[0].fatranskey) {
        await db.query(
          'UPDATE fatrans SET amount=@amt, less=@less, supkey=@s, docno=@docno, docdate=@d WHERE fatranskey=@f',
          { amt: sign * b.gross, less: b.cashAmt, s: b.supKey, docno: String(billNo), d: b.billDate, f: cur[0].fatranskey },
        );
      } else {
        const f = await db.query(
          `INSERT INTO fatrans(docno,docdate,doctype,supkey,amount,refkey,transdate,less) VALUES(@docno,@d,@t,@s,@amt,@ref,now(),@less) RETURNING fatranskey`,
          { docno: String(billNo), d: b.billDate, t: b.billType, s: b.supKey, amt: sign * b.gross, ref: id, less: b.cashAmt },
        );
        await db.query('UPDATE bill01 SET fatranskey=@f WHERE billkey=@id', { f: f[0].fatranskey, id });
      }
      await db.query('UPDATE bill01 SET btob=@n WHERE billkey=@id', { id, n: b.nonBalance ? 1 : 0 });
      await db.query('DELETE FROM bill02 WHERE billkey=@id', { id });
      await insertLines(db, id, b);
      await refreshBalance(db, b.supKey);
      if (cur[0].supkey !== b.supKey) await refreshBalance(db, cur[0].supkey);
      return { billKey: id, billNo };
    });
    res.json(out);
  }),
);

/* ---------- delete ---------- */
billsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    await withTx(async (db) => {
      const cur = await db.query('SELECT supkey, billtype, fatranskey FROM bill01 WHERE billkey=@id FOR UPDATE', { id });
      if (!cur[0] || !TYPES.includes(cur[0].billtype)) throw notFound('Bill not found');
      const settled = await db.query('SELECT COUNT(*)::int AS c FROM recpay02 WHERE billkey=@id', { id });
      if (settled[0].c > 0) throw new HttpError(409, 'Cannot delete: receipts/payments are linked to this bill');
      if (cur[0].fatranskey) await db.query('DELETE FROM fatrans WHERE fatranskey=@f', { f: cur[0].fatranskey });
      await db.query('DELETE FROM bill03 WHERE billkey=@id', { id });
      await db.query('DELETE FROM bill02 WHERE billkey=@id', { id });
      await db.query('DELETE FROM bill01 WHERE billkey=@id', { id });
      await refreshBalance(db, cur[0].supkey);
    });
    res.json({ ok: true });
  }),
);
