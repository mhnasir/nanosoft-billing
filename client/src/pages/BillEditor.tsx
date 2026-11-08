import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, dateOnly, fmt, r2, todayISO, type Row } from '../api';
import { ErrorBox, Field, Picker, useLoad } from '../components';
import { BILL_TITLE } from './BillList';

type Line = { prodKey: number; qty: string; unit: string; nop: string; rate: string; marks: string };
const blankLine = (): Line => ({ prodKey: 0, qty: '', unit: 'Kg', nop: '', rate: '', marks: '' });

const ADDS: [string, string][] = [
  ['commissionAmt', 'Commission'], ['coolyAmt', 'Cooly'], ['kCoolyAmt', 'K-Cooly'], ['basketAmt', 'Basket'],
  ['gunnyAmt', 'Gunny'], ['advAmt', 'Advance'], ['othersAddAmt', 'Other charges'],
];
const LESS: [string, string][] = [['disAmt', 'Discount'], ['othersLessAmt', 'Other deductions']];

export default function BillEditor() {
  const { type = 'B', id } = useParams();
  const nav = useNavigate();
  const isNew = !id;
  const partyType = type === 'B' ? 'C' : 'S';

  const parties = useLoad<Row[]>(BILL_TITLE[type] ? `/parties?type=${partyType}&limit=2000` : null);
  const products = useLoad<Row[]>('/products');
  const existing = useLoad<Row>(id ? `/bills/${id}` : null);

  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [supKey, setSupKey] = useState(0);
  const [lotNo, setLotNo] = useState('');
  const [amts, setAmts] = useState<Record<string, string>>({});
  const [othersAddStr, setAddStr] = useState('');
  const [othersLessStr, setLessStr] = useState('');
  const [cashAmt, setCash] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const partyOpts = useMemo(() => (parties.data || []).map((p) => ({ ...p, __id: p.SupKey })), [parties.data]);
  const prodOpts = useMemo(() => (products.data || []).map((p) => ({ ...p, __id: p.ProdKey })), [products.data]);

  // Load existing bill into the form
  useEffect(() => {
    const b = existing.data;
    if (!b) return;
    setBillNo(String(b.BillNo ?? ''));
    setBillDate(dateOnly(b.BillDate));
    setSupKey(b.SupKey);
    setLotNo(b.LotNo || '');
    setAddStr(b.OthersAddStr || '');
    setLessStr(b.OthersLessStr || '');
    setCash(String(b.CashAmt ?? ''));
    const a: Record<string, string> = {};
    const map: Record<string, string> = {
      commissionAmt: 'CommissionAmt', coolyAmt: 'CoolyAmt', kCoolyAmt: 'KCoolyAmt', basketAmt: 'BasketAmt',
      gunnyAmt: 'GunnyAmt', advAmt: 'AdvAmt', othersAddAmt: 'OthersAddAmt', disAmt: 'DisAmt', othersLessAmt: 'OthersLessAmt',
    };
    for (const [k, col] of Object.entries(map)) a[k] = b[col] ? String(b[col]) : '';
    setAmts(a);
    setLines(
      (b.lines as Row[]).map((l) => ({
        prodKey: l.ProdKey, qty: String(l.Qty), unit: l.Unit || 'Kg', nop: l.Nop ? String(l.Nop) : '', rate: String(l.Rate), marks: l.Marks || '',
      })),
    );
  }, [existing.data]);

  // Suggest next bill number for new bills
  useEffect(() => {
    if (!isNew || !BILL_TITLE[type]) return;
    api.get(`/bills/next-no?type=${type}&date=${billDate}`).then((r) => setBillNo(String(r.billNo)), () => undefined);
  }, [isNew, type, billDate]);

  if (!BILL_TITLE[type]) return <Navigate to="/bills/B" />;

  const n = (v: string) => Number(v) || 0;
  const lineAmt = (l: Line) => r2(n(l.qty) * n(l.rate));
  const billAmt = r2(lines.reduce((s, l) => s + lineAmt(l), 0));
  const adds = r2(ADDS.reduce((s, [k]) => s + n(amts[k] || ''), 0));
  const less = r2(LESS.reduce((s, [k]) => s + n(amts[k] || ''), 0));
  const gross = r2(billAmt + adds - less);
  const balance = r2(gross - n(cashAmt));

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        billType: type, billNo: n(billNo) || undefined, billDate, supKey, lotNo, othersAddStr, othersLessStr, cashAmt: n(cashAmt),
        ...Object.fromEntries(Object.entries(amts).map(([k, v]) => [k, n(v)])),
        lines: lines.filter((l) => l.prodKey || n(l.qty)).map((l) => ({ ...l, qty: n(l.qty), nop: n(l.nop), rate: n(l.rate) })),
      };
      const r = isNew ? await api.post('/bills', body) : await api.put(`/bills/${id}`, body);
      nav(`/bills/${type}/${r.billKey}/print`);
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0 });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this bill? The ledger entry is removed too.')) return;
    try { await api.del(`/bills/${id}`); nav(`/bills/${type}`); } catch (e) { setError((e as Error).message); }
  }

  const loading = parties.loading || products.loading || (!isNew && existing.loading);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{isNew ? 'New' : 'Edit'} {type === 'B' ? 'customer' : 'supplier'} bill</h1>
        <Link className="btn" to={`/bills/${type}`}>Back to list</Link>
      </div>
      <ErrorBox error={error || parties.error || products.error || existing.error} />
      {loading && <p className="muted">Loading…</p>}
      <div className="card">
        <div className="row">
          <Field label="Bill no"><input className="num" style={{ width: 90 }} value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
          <Field label="Date"><input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          <Field label={type === 'B' ? 'Customer' : 'Supplier / farmer'} className="grow">
            <Picker id="parties" options={partyOpts} value={supKey} onChange={(k) => setSupKey(k)} labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)} placeholder="Type to search…" />
          </Field>
          <Field label="Lot no"><input style={{ width: 110 }} value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr><th style={{ width: 36 }}>#</th><th>Item</th><th className="r" style={{ width: 90 }}>Nos</th><th className="r" style={{ width: 100 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th className="r" style={{ width: 110 }}>Rate</th><th>Mark</th><th className="r" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }} /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <Picker
                      id={`prod${i}`} options={prodOpts} value={l.prodKey} placeholder="Item…"
                      labelOf={(p) => p.ProdName + (p.BrandName ? ` (${p.BrandName})` : '')}
                      onChange={(k, row) => setLine(i, row ? { prodKey: k, unit: row.Unit || 'Kg', rate: l.rate || (row.CurPrice ? String(row.CurPrice) : '') } : { prodKey: 0 })}
                    />
                  </td>
                  <td><input className="num" inputMode="decimal" value={l.nop} onChange={(e) => setLine(i, { nop: e.target.value })} /></td>
                  <td><input className="num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: '100%' }} /></td>
                  <td>
                    <input
                      className="num" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); setLines((ls) => [...ls, blankLine()]); } }}
                    />
                  </td>
                  <td><input value={l.marks} onChange={(e) => setLine(i, { marks: e.target.value })} style={{ width: '100%' }} /></td>
                  <td className="r">{fmt(lineAmt(l))}</td>
                  <td><button className="sm danger" title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12 }}><button onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add line</button> <span className="muted">Press Enter in the rate field to add the next line.</span></div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'start' }}>
          <div className="grow form-grid" style={{ flex: '2 1 380px' }}>
            {[...ADDS, ...LESS].map(([k, label]) => (
              <Field key={k} label={`${LESS.some(([x]) => x === k) ? '− ' : '+ '}${label}`}>
                <input className="num" inputMode="decimal" value={amts[k] || ''} onChange={(e) => setAmts({ ...amts, [k]: e.target.value })} />
              </Field>
            ))}
            <Field label="Other charges note"><input value={othersAddStr} onChange={(e) => setAddStr(e.target.value)} /></Field>
            <Field label="Other deductions note"><input value={othersLessStr} onChange={(e) => setLessStr(e.target.value)} /></Field>
          </div>
          <div className="totals" style={{ flex: '1 1 300px' }}>
            <div><span>Items total</span><span>{fmt(billAmt)}</span></div>
            <div><span>Charges</span><span>{fmt(adds)}</span></div>
            <div><span>Deductions</span><span>{fmt(less)}</span></div>
            <div className="big"><span>Bill total</span><span>{fmt(gross)}</span></div>
            <div style={{ alignItems: 'center' }}><span>Cash received / paid</span><input className="num" style={{ width: 120 }} inputMode="decimal" value={cashAmt} onChange={(e) => setCash(e.target.value)} /></div>
            <div><span>Balance on bill</span><span>{fmt(balance)}</span></div>
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!isNew && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete bill</button>}
        <button className="primary" onClick={save} disabled={saving || !supKey || billAmt <= 0}>{saving ? 'Saving…' : 'Save and print'}</button>
      </div>
    </>
  );
}
