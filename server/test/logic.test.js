import test from 'node:test';
import assert from 'node:assert/strict';
import { ymd, fyRange, r2, num } from '../util.js';
import { parseBill } from '../routes/bills.js';

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
