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
  token = jwt.sign({ id: 1, name: 'admin', role: 'owner', src: 'user' }, 'test-secret');
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
  assert.equal(r.data.NetAmt, 261.5); // previous balance 100 + 211.5 - cash 50
  assert.equal(r.data.BalAmt, 100); // previous balance, kept on the bill
  assert.equal(r.data.DcType.trim(), '1');
  assert.equal(r.data.Nop, '14'); // total weight (10 + 4 kg)
  assert.equal(r.data.InOutPur, '2'); // total bags
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

T('purchase bill: deductions, per-day numbering; sales numbering never restarts; auto cooly/commission', async () => {
  const farmer = (await api('POST', '/api/parties', { SupName: 'Farmer Raman', City: 'Ooty', SupType: 'S', OpnBal: 0 })).data.id;
  const shop = (await api('POST', '/api/parties', { SupName: 'Shop Two', City: 'Erode', SupType: 'C', OpnBal: 0 })).data.id;
  const veg = (await api('POST', '/api/products', { ProdName: 'Beans', Unit: 'Nop', CurPrice: 0, Cooly: 3, Basket: 2, Gunny: 4 })).data.id;
  // purchase: 5000 + added 50 - charges 450 = 4600 credited to the farmer
  let r = await api('POST', '/api/bills', {
    billType: 'S', supKey: farmer, billDate: '2026-09-10', lotNo: 'L1', commissionAmt: 250, coolyAmt: 40, basketAmt: 60, advAmt: 100, disAmt: 20, othersLessAmt: 30, cashAmt: 1000,
    lines: [{ prodKey: ids.prod, qty: 100, unit: 'Kgs', nop: 5, rate: 50 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.billNo, 1);
  const key = r.data.billKey;
  let g = (await api('GET', `/api/bills/${key}`)).data;
  assert.equal(g.Gross, 4600);
  assert.equal(g.NetAmt, 3600); // nothing owed before; 4600 - cash 1000
  assert.equal(g.DcType.trim(), '3');
  assert.equal(g.LotNo, 'L1');
  const f = await adminClient.query('SELECT amount, less FROM fatrans WHERE refkey=$1 AND doctype=$2', [key, 'S']);
  assert.equal(Number(f.rows[0].amount), -4600);
  assert.equal(Number(f.rows[0].less), 1000);
  // same day -> 2, next day -> back to 1
  r = await api('POST', '/api/bills', { billType: 'S', supKey: farmer, billDate: '2026-09-10', lines: [{ prodKey: ids.prod, qty: 10, unit: 'Kgs', rate: 10 }] });
  assert.equal(r.data.billNo, 2);
  const keyB = r.data.billKey;
  r = await api('POST', '/api/bills', { billType: 'S', supKey: farmer, billDate: '2026-09-11', lines: [{ prodKey: ids.prod, qty: 10, unit: 'Kgs', rate: 10 }] });
  assert.equal(r.data.billNo, 1);
  // we now owe the farmer 4600 + 100 + 100: the next purchase bill shows it on the bill
  g = (await api('GET', `/api/bills/${r.data.billKey}`)).data;
  assert.equal(g.BalAmt, -4700);
  assert.equal(g.NetAmt, 4800); // 100 + 4700
  // sales bill numbers keep counting in a new year
  const nextB = (await api('GET', '/api/bills/next-no?type=B&date=2027-05-01')).data.billNo;
  const sb = await api('POST', '/api/bills', { billType: 'B', supKey: shop, billDate: '2027-05-01', lines: [{ prodKey: ids.prod, qty: 1, unit: 'Kgs', rate: 10 }] });
  assert.equal(sb.data.billNo, nextB);
  assert.ok(nextB > 1);
  // auto switches: commission = bags x product Basket (2), cooly = bags x product Cooly (3)
  r = await api('POST', '/api/bills', {
    billType: 'B', supKey: shop, billDate: '2026-09-12', autoBasket: true, autoCooly: true, lines: [{ prodKey: veg, qty: 0, unit: 'Nop', nop: 10, rate: 25 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  g = (await api('GET', `/api/bills/${r.data.billKey}`)).data;
  assert.equal(g.BillAmt, 250);
  assert.equal(g.AdvAmt, 20); // commission shown in the Com cell of the old form
  assert.equal(g.CoolyAmt, 30);
  assert.equal(g.Gross, 300);
  assert.equal(g.AutoBasket, 'Yes');
  // purchase: unloading cooly = bags x product Gunny (4)
  r = await api('POST', '/api/bills', { billType: 'S', supKey: farmer, billDate: '2026-09-12', autoGunny: true, lines: [{ prodKey: veg, qty: 0, unit: 'Nop', nop: 10, rate: 25 }] });
  g = (await api('GET', `/api/bills/${r.data.billKey}`)).data;
  assert.equal(g.CoolyAmt, 40);
  assert.equal(g.Gross, 210); // 250 - 40
  // editing keeps the numbers and the flags this screen does not touch
  r = await api('PUT', `/api/bills/${keyB}`, { nonBalance: true, billType: 'S', supKey: farmer, billDate: '2026-09-10', lines: [{ prodKey: ids.prod, qty: 20, unit: 'Kgs', rate: 10 }] });
  assert.equal(r.status, 200);
  const kept = await adminClient.query('SELECT billno, nonbalancestat FROM bill01 WHERE billkey=$1', [keyB]);
  assert.equal(kept.rows[0].billno, 2);
  assert.equal(kept.rows[0].nonbalancestat, 1);
  g = (await api('GET', `/api/bills/${keyB}`)).data;
  assert.equal(g.NonBalance, true);
  assert.equal(Number(g.BalAmt), 0);
});

T('roles limit what each user can do', async () => {
  const mk = async (name, role) => { await api('POST', '/api/users', { username: name, password: 'pw12', role }); const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'pw12' }) }); return (await l.json()).token; };
  const call = async (tok, m, u, b) => { const r = await fetch(`${base}${u}`, { method: m, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.status; };
  const pos = await mk('cashier1', 'pos');
  const load = await mk('loader1', 'loading');
  const mgr = await mk('mgr1', 'manager');
  assert.equal(await call(pos, 'GET', '/api/bills?type=B'), 200);
  assert.equal(await call(pos, 'GET', '/api/bills?type=S'), 403);
  assert.equal(await call(pos, 'GET', '/api/reports/trial-balance'), 403);
  assert.equal(await call(pos, 'GET', '/api/users'), 403);
  assert.equal(await call(load, 'GET', '/api/bills?type=S'), 200);
  assert.equal(await call(load, 'POST', '/api/bills', { billType: 'B' }), 403);
  assert.equal(await call(load, 'GET', '/api/receipts'), 403);
  assert.equal(await call(mgr, 'GET', '/api/reports/trial-balance'), 200);
  assert.equal(await call(mgr, 'GET', '/api/users'), 403);
  assert.equal(await call(token, 'GET', '/api/users'), 200);
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
