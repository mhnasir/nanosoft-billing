import test from 'node:test';
import assert from 'node:assert/strict';
import { ymd, fyRange, r2, num } from '../util.js';
import { parseBill, computeTotals } from '../routes/bills.js';

test('ymd validates dates', () => {
  assert.equal(ymd('2026-07-13'), '2026-07-13');
  assert.throws(() => ymd('13/07/2026'));
  assert.throws(() => ymd('2026-02-31'));
});

test('financial year range follows 1 Apr - 31 Mar', () => {
  assert.deepEqual(fyRange('2026-07-13'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(fyRange('2027-02-01'), { from: '2026-04-01', to: '2027-03-31' });
});

test('num/r2 helpers', () => {
  assert.equal(num('abc', 5), 5);
  assert.equal(r2(1.005 + 1.005), 2.01);
});

const base = { billType: 'B', supKey: 3, billDate: '2026-07-13', lines: [{ prodKey: 1, qty: 10, rate: 12.5, nop: 2 }] };

test('parseBill computes totals like the VB gross formula', () => {
  const b = parseBill({ ...base, commissionAmt: 5, coolyAmt: 2.5, disAmt: 1, cashAmt: 50 });
  assert.equal(b.billAmt, 125);
  assert.equal(b.gross, 131.5); // 125 + 5 + 2.5 - 1
  assert.equal(b.netAmt, 81.5); // gross - cash
  assert.equal(b.billDate, '2026-07-13');
});

test('parseBill rejects bad input', () => {
  assert.throws(() => parseBill({ ...base, billType: 'X' }), /billType/);
  assert.throws(() => parseBill({ ...base, supKey: 0 }), /party/i);
  assert.throws(() => parseBill({ ...base, lines: [] }), /item/i);
  assert.throws(() => parseBill({ ...base, lines: [{ prodKey: 1, qty: 0, rate: 1 }] }), /quantity/i);
  assert.throws(() => parseBill({ ...base, disAmt: 9999 }), /negative/i);
});

test('line amount follows the unit like the VB grid: Kgs = weight x rate, other units = bags x rate, whole rupees', () => {
  const b = parseBill({
    ...base,
    lines: [
      { prodKey: 1, qty: 40, unit: 'Kgs', nop: 1, rate: 55.5 }, // 2220
      { prodKey: 2, qty: 40, unit: 'Nop', nop: 3, rate: 54.4 }, // 3 x 54.4 = 163.2 -> 163 (weight ignored)
      { prodKey: 3, qty: 7, unit: 'KGS', nop: 0, rate: 10.07 }, // 70.49 -> 70
    ],
  });
  assert.deepEqual(b.lines.map((l) => l.amount), [2220, 163, 70]);
  assert.equal(b.billAmt, 2453);
  assert.equal(b.nop, '87'); // header Nop = total weight, as the VB form saves it
  assert.equal(b.inOutPur, '4'); // InOutPur = total bags
  assert.throws(() => parseBill({ ...base, lines: [{ prodKey: 1, qty: 5, unit: 'Nop', nop: 0, rate: 1 }] }), /bags/i);
});

test('half rupees round away from zero like Format(x,"00")', () => {
  const b = parseBill({ ...base, lines: [{ prodKey: 1, qty: 1, unit: 'Kgs', rate: 10.5 }, { prodKey: 1, qty: -1, unit: 'Kgs', rate: 10.5 }, { prodKey: 1, qty: 3, unit: 'Kgs', rate: 10.5 }] });
  assert.deepEqual(b.lines.map((l) => l.amount), [11, -11, 32]); // 10.5 -> 11, -10.5 -> -11, 31.5 -> 32
});

test('sales bill: net = previous balance + bill - cash', () => {
  const b = computeTotals(parseBill({ ...base, commissionAmt: 5, cashAmt: 30 }), 7914);
  assert.equal(b.gross, 130);
  assert.equal(b.prevBal, 7914);
  assert.equal(b.netAmt, 8014); // 7914 + 130 - 30
});

test('purchase bill: charges are deducted from the farmer, added amounts are added', () => {
  const p = parseBill({
    ...base, billType: 'S', lines: [{ prodKey: 1, qty: 100, unit: 'Kgs', nop: 5, rate: 50 }], // 5000
    commissionAmt: 250, coolyAmt: 40, basketAmt: 60, advAmt: 100, // charges 450
    disAmt: 20, othersLessAmt: 30, // added 50
    cashAmt: 1000,
  });
  assert.equal(p.billAmt, 5000);
  assert.equal(p.gross, 4600); // 5000 + 50 - 450
  // we already owed this farmer 800 (stored negative): 4600 + 800 - 1000
  assert.equal(computeTotals(p, -800).netAmt, 4400);
});

test('delivery chit (D) and order (O) carry bags only: no rate, no money', () => {
  const b = parseBill({ billType: 'D', supKey: 2, billDate: '2026-07-13', lotNo: 'MN', lines: [{ prodKey: 7, nop: 3 }, { prodKey: 15, nop: 0.5, marks: 'AA' }] });
  assert.equal(b.billAmt, 0);
  assert.equal(b.gross, 0);
  assert.equal(b.netAmt, 0);
  assert.equal(b.inOutPur, '3.5'); // total bags
  assert.deepEqual(b.lines.map((l) => [l.rate, l.amount, l.unit]), [[0, 0, 'Nop'], [0, 0, 'Nop']]);
  assert.throws(() => parseBill({ billType: 'D', supKey: 2, billDate: '2026-07-13', lines: [{ prodKey: 7 }] }), /bags/i);
});

test('farmer commission bill (F): charges are deducted like a purchase bill and no previous balance is shown', () => {
  const b = parseBill({ billType: 'F', supKey: 9, billDate: '2026-07-13', commissionAmt: 100, coolyAmt: 20, kCoolyAmt: 30, lines: [{ prodKey: 1, qty: 100, rate: 20, nop: 2, unit: 'Kgs' }], cashAmt: 500, refBillKey: 44 });
  assert.equal(b.billAmt, 2000);
  assert.equal(b.gross, 1850); // 2000 - 100 - 20 - 30
  computeTotals(b, 777); // a ledger balance is passed but documents ignore it
  assert.equal(b.prevBal, 0);
  assert.equal(b.netAmt, 1350); // gross - cash paid
  assert.equal(b.refBillKey, 44);
});

test('patiyal (L/C): a line split among sub-customers adds up its parts, each with its own rate', () => {
  const b = parseBill({
    billType: 'L', supKey: 9, billDate: '2026-07-13', commissionAmt: 50,
    lines: [{ prodKey: 1, unit: 'Kgs', subs: [{ supKey: 3, nop: 2, qty: 100, rate: 20 }, { supKey: 4, nop: 1, qty: 40, rate: 25 }] }],
  });
  const l = b.lines[0];
  assert.equal(l.amount, 3000); // 100x20 + 40x25
  assert.equal(l.qty, 140);
  assert.equal(l.nop, 3);
  assert.equal(l.rate, 21.43); // average, 3000 / 140
  assert.equal(b.gross, 2950);
  assert.equal(l.subs.length, 2);
  assert.throws(() => parseBill({ billType: 'C', supKey: 9, billDate: '2026-07-13', lines: [{ prodKey: 1, unit: 'Kgs', subs: [{ supKey: 0, qty: 5, rate: 1 }] }] }), /customer/i);
  assert.throws(() => parseBill({ billType: 'C', supKey: 9, billDate: '2026-07-13', lines: [{ prodKey: 1, unit: 'Kgs', subs: [{ supKey: 3, qty: 0, rate: 1 }] }] }), /weight/i);
});
