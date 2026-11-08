// Integration tests: need a throw-away PostgreSQL database.
//   TEST_PG_URL=postgres://postgres@localhost:5432/nvs_test npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';

const URL_ = process.env.TEST_PG_URL;
const skip = URL_ ? false : 'set TEST_PG_URL to run database tests';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let server, base, token, adminClient;
const api = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.JWT_SECRET = 'test-secret';
  adminClient = new pg.Client({ connectionString: URL_ });
  await adminClient.connect();
  await adminClient.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await adminClient.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
  await adminClient.query(`INSERT INTO usermaster(username,pass,stat) VALUES('admin','pw1',1)`);
  await adminClient.query(`INSERT INTO companymaster(companname,propname,address,address1,phoneno,pass) VALUES('Demo Traders','Owner','Main Rd','Town','999','secret')`);
  const { app } = await import('../index.js');
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  token = jwt.sign({ id: 1, name: 'admin' }, 'test-secret');
});

after(async () => {
  if (skip) return;
  server?.close();
  const { closePool } = await import('../db.js');
  await closePool();
  await adminClient.end();
});

const T = (name, fn) => test(name, { skip }, fn);
const ids = {};

T('login works with USERMASTER and rejects bad passwords', async () => {
  const ok = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ADMIN', password: 'pw1' }) });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }) });
  assert.equal(bad.status, 401);
  const noauth = await fetch(base + '/api/bills');
  assert.equal(noauth.status, 401);
});

T('masters: group, product, parties CRUD', async () => {
  let r = await api('POST', '/api/groups', { CustType: 'Retail' });
  assert.equal(r.status, 201); ids.group = r.data.id;
  r = await api('POST', '/api/products', { ProdName: 'Onion', Unit: 'Kg', CurPrice: 22 });
  assert.equal(r.status, 201); ids.prod = r.data.id;
  r = await api('POST', '/api/parties', { SupName: 'Ravi Traders', City: 'Mettupalayam', SupType: 'C', CustKey: ids.group, Phone: '9876543210', OpnBal: 100 });
  assert.equal(r.status, 201); ids.cust = r.data.id;
  r = await api('POST', '/api/parties', { SupName: 'Farmer Muthu', City: 'Ooty', SupType: 'S', OpnBal: 0 });
  ids.sup = r.data.id;
  r = await api('GET', '/api/parties?type=C');
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].Phone, '9876543210');
  assert.equal(r.data[0].GroupName, 'Retail');
  assert.equal(r.data[0].Balance, 100);
  r = await api('PUT', `/api/products/${ids.prod}`, { ProdName: 'Onion (big)', Unit: 'Kg', CurPrice: 25 });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/products');
  assert.equal(r.data[0].ProdName, 'Onion (big)');
  assert.equal(r.data[0].CurPrice, 25);
  assert.equal((await api('POST', '/api/products', { ProdName: '' })).status, 400);
});

const bill = (over = {}) => ({
  billType: 'B', supKey: ids.cust, billDate: '2026-07-13', commissionAmt: 5, coolyAmt: 2.5, disAmt: 1, cashAmt: 50,
  lines: [{ prodKey: ids.prod, qty: 10, rate: 12.5, nop: 2 }, { prodKey: ids.prod, qty: 4, rate: 20 }], ...over,
});

T('customer bill posts a debit to the ledger and updates the balance', async () => {
  let r = await api('POST', '/api/bills', bill());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.billNo, 1);
  ids.bill = r.data.billKey;
  // items 125 + 80 = 205; + 5 + 2.5 - 1 = 211.5
  r = await api('GET', `/api/bills/${ids.bill}`);
  assert.equal(r.data.Gross, 211.5);
  assert.equal(r.data.NetAmt, 161.5);
  assert.equal(r.data.lines.length, 2);
  assert.equal(r.data.lines[0].ProdName, 'Onion (big)');
  assert.equal(r.data.SupName, 'Ravi Traders');
  const f = await adminClient.query('SELECT * FROM fatrans WHERE refkey=$1', [ids.bill]);
  assert.equal(f.rowCount, 1);
  assert.equal(Number(f.rows[0].amount), 211.5);
  assert.equal(f.rows[0].doctype, 'B');
  const s = await adminClient.query('SELECT balanceamt FROM supmast WHERE supkey=$1', [ids.cust]);
  assert.equal(Number(s.rows[0].balanceamt), 311.5); // 100 opening + 211.5
  // second bill gets the next number
  r = await api('POST', '/api/bills', bill());
  assert.equal(r.data.billNo, 2);
  ids.bill2 = r.data.billKey;
});

T('supplier bill credits the party', async () => {
  const r = await api('POST', '/api/bills', bill({ billType: 'S', supKey: ids.sup, commissionAmt: 0, coolyAmt: 0, disAmt: 0, cashAmt: 0, lines: [{ prodKey: ids.prod, qty: 100, rate: 10 }] }));
  assert.equal(r.status, 201);
  assert.equal(r.data.billNo, 1);
  const f = await adminClient.query('SELECT amount FROM fatrans WHERE refkey=$1 AND doctype=$2', [r.data.billKey, 'S']);
  assert.equal(Number(f.rows[0].amount), -1000);
});

T('bill list, validation and edit', async () => {
  let r = await api('GET', '/api/bills?type=B&from=2026-07-01&to=2026-07-31');
  assert.equal(r.data.length, 2);
  assert.equal(r.data[0].Gross, 211.5);
  r = await api('GET', '/api/bills?q=Ravi');
  assert.equal(r.data.length, 2);
  assert.equal((await api('POST', '/api/bills', bill({ lines: [] }))).status, 400);
  assert.equal((await api('POST', '/api/bills', bill({ supKey: 99999 }))).status, 400);
  // edit: change a rate
  r = await api('PUT', `/api/bills/${ids.bill}`, bill({ lines: [{ prodKey: ids.prod, qty: 10, rate: 30 }], coolyAmt: 0, commissionAmt: 0, disAmt: 0, cashAmt: 0 }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await api('GET', `/api/bills/${ids.bill}`);
  assert.equal(r.data.Gross, 300);
  assert.equal(r.data.lines.length, 1);
  const f = await adminClient.query('SELECT amount FROM fatrans WHERE refkey=$1 AND doctype=$2', [ids.bill, 'B']);
  assert.equal(f.rowCount, 1);
  assert.equal(Number(f.rows[0].amount), 300);
});

T('receipt credits the ledger; ledger report runs the balance', async () => {
  let r = await api('POST', '/api/receipts', { recType: 'R', supKey: ids.cust, recDate: '2026-07-14', amount: 100, lessAmt: 5, mode: 'Cheque', creditNo: '123456', creditDate: '2026-07-20', narration: 'part payment' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.rec = r.data.id;
  const f = await adminClient.query('SELECT amount, less, doctype FROM fatrans WHERE refkey=$1 AND doctype=$2', [ids.rec, 'R']);
  assert.equal(Number(f.rows[0].amount), -105);
  r = await api('GET', `/api/receipts?type=R&from=2026-07-01&to=2026-07-31`);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].Amount, 100);
  assert.equal(r.data[0].Mode, 'Cheque');
  assert.equal(r.data[0].SupName, 'Ravi Traders');
  // ledger: opening 100, bill1 300 (07-13), bill2 211.5 (07-13), receipt -105 (07-14) => 506.5
  r = await api('GET', `/api/reports/ledger?supKey=${ids.cust}&from=2026-07-01&to=2026-07-31`);
  assert.equal(r.data.opening, 100);
  assert.equal(r.data.entries.length, 3);
  assert.equal(r.data.closing, 506.5);
  assert.equal(r.data.totalCredit, 105);
  // narrower window moves earlier rows into the opening balance
  r = await api('GET', `/api/reports/ledger?supKey=${ids.cust}&from=2026-07-14&to=2026-07-31`);
  assert.equal(r.data.opening, 611.5);
  assert.equal(r.data.closing, 506.5);
  // edit the receipt amount
  r = await api('PUT', `/api/receipts/${ids.rec}`, { recType: 'R', supKey: ids.cust, recDate: '2026-07-14', amount: 200, lessAmt: 0, mode: 'Cash' });
  assert.equal(r.status, 200);
  const f2 = await adminClient.query('SELECT amount FROM fatrans WHERE refkey=$1 AND doctype=$2', [ids.rec, 'R']);
  assert.equal(Number(f2.rows[0].amount), -200);
  assert.equal((await api('POST', '/api/receipts', { recType: 'R', supKey: ids.cust, recDate: '2026-07-14', amount: 0 })).status, 400);
});

T('payment to supplier debits the ledger', async () => {
  const r = await api('POST', '/api/receipts', { recType: 'P', supKey: ids.sup, recDate: '2026-07-15', amount: 400, mode: 'Cash' });
  assert.equal(r.status, 201);
  const f = await adminClient.query('SELECT amount FROM fatrans WHERE refkey=$1 AND doctype=$2', [r.data.id, 'P']);
  assert.equal(Number(f.rows[0].amount), 400);
});

T('reports: outstanding, trial balance, day book, dashboard', async () => {
  let r = await api('GET', '/api/reports/outstanding?type=C');
  assert.equal(r.data.rows.length, 1);
  assert.equal(r.data.rows[0].Balance, 411.5); // 100 + 300 + 211.5 - 200
  assert.equal(r.data.rows[0].Phone, '9876543210');
  r = await api('GET', '/api/reports/outstanding?type=S');
  assert.equal(r.data.rows[0].Balance, -600); // -1000 + 400
  r = await api('GET', '/api/reports/trial-balance');
  assert.equal(r.data.totalDebit, 411.5);
  assert.equal(r.data.totalCredit, 600);
  r = await api('GET', '/api/reports/daybook?from=2026-07-13&to=2026-07-15');
  assert.equal(r.data.totals.billB, 511.5);
  assert.equal(r.data.totals.billS, 1000);
  assert.equal(r.data.totals.receipts, 200);
  assert.equal(r.data.totals.payments, 400);
  r = await api('GET', '/api/reports/dashboard');
  assert.equal(r.status, 200);
  assert.equal(r.data.receivable, 411.5);
  assert.equal(r.data.payable, 600);
  assert.ok(r.data.recent.length >= 3);
  r = await api('GET', '/api/company');
  assert.equal(r.data.CompanName, 'Demo Traders');
  assert.equal(r.data.pass, undefined);
  assert.equal(r.data.Pass, undefined);
});

T('delete bill removes ledger entry; used masters are protected', async () => {
  let r = await api('DELETE', `/api/bills/${ids.bill2}`);
  assert.equal(r.status, 200);
  const f = await adminClient.query('SELECT COUNT(*)::int AS n FROM fatrans WHERE refkey=$1 AND doctype=$2', [ids.bill2, 'B']);
  assert.equal(f.rows[0].n, 0);
  const l = await adminClient.query('SELECT COUNT(*)::int AS n FROM bill02 WHERE billkey=$1', [ids.bill2]);
  assert.equal(l.rows[0].n, 0);
  assert.equal((await api('GET', `/api/bills/${ids.bill2}`)).status, 404);
  assert.equal((await api('DELETE', `/api/products/${ids.prod}`)).status, 409);
  assert.equal((await api('DELETE', `/api/parties/${ids.cust}`)).status, 409);
  r = await api('DELETE', `/api/receipts/${ids.rec}`);
  assert.equal(r.status, 200);
  // party with no ledger rows can be removed (soft delete)
  const p = await api('POST', '/api/parties', { SupName: 'Temp', SupType: 'C' });
  assert.equal((await api('DELETE', `/api/parties/${p.data.id}`)).status, 200);
  assert.equal((await api('GET', '/api/parties?type=C')).data.some((x) => x.SupName === 'Temp'), false);
});

T('DRY_RUN rolls bill writes back', async () => {
  process.env.DRY_RUN = '1';
  try {
    const r = await api('POST', '/api/bills', bill());
    assert.equal(r.status, 201);
    const n = await adminClient.query('SELECT COUNT(*)::int AS n FROM bill01 WHERE billkey=$1', [r.data.billKey]);
    assert.equal(n.rows[0].n, 0);
  } finally {
    delete process.env.DRY_RUN;
  }
});
