import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, dateOnly, fmt, r2, rupeesInWords, todayISO, type Row } from '../api';
import { ErrorBox, Field, Picker, useLoad } from '../components';
import { AMT_COL, KIND } from '../billkinds';

type Line = { prodKey: number; qty: string; unit: string; nop: string; rate: string; marks: string };
const blankLine = (): Line => ({ prodKey: 0, qty: '', unit: 'Kgs', nop: '', rate: '', marks: '' });


export default function BillEditor() {
  const { type = 'B', id } = useParams();
  const nav = useNavigate();
  const isNew = !id;
  const kind = KIND[type];
  const ADDS = kind?.charges || [];
  const LESS = kind?.sides || [];

  const parties = useLoad<Row[]>(kind ? `/parties?type=${kind.partyType}&limit=2000` : null);
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
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [nonBal, setNonBal] = useState(false);
  const [prevSaved, setPrevSaved] = useState<number | null>(null);
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
    for (const [k, col] of Object.entries(AMT_COL)) a[k] = b[col] ? String(b[col]) : '';
    setAmts(a);
    setAuto({ autoBasket: b.AutoBasket === 'Yes', autoCooly: b.AutoCooly === 'Yes', autoGunny: b.AutoGunny === 'Yes' });
    setPrevSaved(Number(b.BalAmt) || 0);
    setNonBal(!!b.NonBalance);
    setLines(
      (b.lines as Row[]).map((l) => ({
        prodKey: l.ProdKey, qty: String(l.Qty), unit: l.Unit || 'Kgs', nop: l.Nop ? String(l.Nop) : '', rate: String(l.Rate), marks: l.Marks || '',
      })),
    );
  }, [existing.data]);

  // Suggest next bill number for new bills
  useEffect(() => {
    if (!isNew || !kind) return;
    api.get(`/bills/next-no?type=${type}&date=${billDate}`).then((r) => setBillNo(String(r.billNo)), () => undefined);
  }, [isNew, type, billDate]);

  if (!kind) return <Navigate to="/bills/B" />;

  const n = (v: string) => Number(v) || 0;
  const isKgs = (u: string) => /^kg/i.test(u.trim());
  // Same rule as the VB grid: Kgs lines are weight x rate, other units are bags x rate, rounded to whole rupees.
  const whole = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
  const lineAmt = (l: Line) => whole(isKgs(l.unit) ? n(l.qty) * n(l.rate) : n(l.nop) * n(l.rate));
  const billAmt = r2(lines.reduce((s, l) => s + lineAmt(l), 0));
  const weight = r2(lines.reduce((s, l) => s + n(l.qty), 0));
  const bags = r2(lines.reduce((s, l) => s + n(l.nop), 0));
  // The "by bag" switches fill an amount from the product's rate per bag.
  const prodBy = new Map((products.data || []).map((p) => [p.ProdKey, p]));
  const autoAmt = (col: string) => r2(lines.reduce((s, l) => s + n(l.nop) * n(prodBy.get(l.prodKey)?.[col]), 0));
  const eff = (k: string) => {
    const a = kind.autos.find(([flag, , fills]) => auto[flag] && fills === k);
    return a ? autoAmt(a[3]) : n(amts[k] || '');
  };
  const adds = r2(ADDS.reduce((s, [k]) => s + eff(k), 0));
  const less = r2(LESS.reduce((s, [k]) => s + eff(k), 0));
  const gross = r2(kind.chargesSign === 1 ? billAmt + adds - less : billAmt + less - adds);
  const party: Row | undefined = partyOpts.find((p) => p.__id === supKey);
  // Balance before this bill: a new bill uses the party's current balance, a saved one the figure stored with it.
  const prev = nonBal ? 0 : r2(isNew || prevSaved === null ? Number(party?.Balance) || 0 : prevSaved);
  const balance = r2(type === 'B' ? prev + gross - n(cashAmt) : gross - prev - n(cashAmt));

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        nonBalance: nonBal, billType: type, billNo: n(billNo) || undefined, billDate, supKey, lotNo, othersAddStr, othersLessStr, cashAmt: n(cashAmt),
        ...Object.fromEntries(Object.entries(amts).map(([k, v]) => [k, n(v)])),
        autoBasket: !!auto.autoBasket, autoCooly: !!auto.autoCooly, autoGunny: !!auto.autoGunny,
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
        <h1 className="grow" style={{ margin: 0 }}>{isNew ? 'New' : 'Edit'} {kind.one}</h1>
        <Link className="btn" to={`/bills/${type}`}>Back to list</Link>
      </div>
      <ErrorBox error={error || parties.error || products.error || existing.error} />
      {loading && <p className="muted">Loading…</p>}
      <div className="card">
        <div className="row">
          <Field label="Bill no"><input className="num" style={{ width: 90 }} value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
          <Field label="Date"><input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          <Field label={kind.party} className="grow">
            <Picker id="parties" options={partyOpts} value={supKey} onChange={(k) => setSupKey(k)} labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)} placeholder="Type to search…" />
          </Field>
          {kind.lot && <Field label="Lot no"><input style={{ width: 110 }} value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap" style={{ border: 0 }}>
          <table className="lines">
            <thead>
              <tr><th style={{ width: 36 }}>#</th><th>Item</th><th className="r" style={{ width: 90 }}>Bags</th><th className="r" style={{ width: 100 }}>Weight</th><th style={{ width: 80 }}>Unit</th><th className="r" style={{ width: 110 }}>Rate</th><th>Mark</th><th className="r" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }} /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="muted c-no" data-label="Line">{i + 1}</td>
                  <td className="c-item" data-label="Item">
                    <Picker
                      id={`prod${i}`} options={prodOpts} value={l.prodKey} placeholder="Item…"
                      labelOf={(p) => p.ProdName + (p.BrandName ? ` (${p.BrandName})` : '')}
                      onChange={(k, row) => setLine(i, row ? { prodKey: k, unit: row.Unit || 'Kgs', rate: l.rate || (row.CurPrice ? String(row.CurPrice) : '') } : { prodKey: 0 })}
                    />
                  </td>
                  <td data-label="Bags"><input className="num" inputMode="decimal" value={l.nop} onChange={(e) => setLine(i, { nop: e.target.value })} /></td>
                  <td data-label="Weight"><input className="num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td data-label="Unit"><select value={isKgs(l.unit) ? 'Kgs' : 'Nop'} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: '100%' }}><option>Kgs</option><option>Nop</option></select></td>
                  <td data-label="Rate">
                    <input
                      className="num" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); setLines((ls) => [...ls, blankLine()]); } }}
                    />
                  </td>
                  <td data-label="Mark"><input value={l.marks} onChange={(e) => setLine(i, { marks: e.target.value })} style={{ width: '100%' }} /></td>
                  <td className="r c-amt" data-label="Amount">{fmt(lineAmt(l))}</td>
                  <td className="c-del"><button className="sm danger" title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12 }}><button onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add line</button> <span className="muted">Press Enter in the rate field to add the next line.</span></div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'start' }}>
          <div className="grow" style={{ flex: '2 1 380px' }}>
            <div className="muted" style={{ marginBottom: 4 }}>{kind.chargesNote}</div>
            <div className="form-grid">
              {ADDS.map(([k, label]) => {
                const a = kind.autos.find(([, , fills]) => fills === k);
                const on = !!(a && auto[a[0]]);
                return (
                  <Field key={k} label={label}>
                    <input className="num" inputMode="decimal" readOnly={on} value={on ? String(eff(k)) : amts[k] || ''} onChange={(e) => setAmts({ ...amts, [k]: e.target.value })} />
                  </Field>
                );
              })}
            </div>
            <div className="row" style={{ margin: '8px 0' }}>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={nonBal} onChange={(e) => setNonBal(e.target.checked)} /> Non-balance bill (no previous balance)</label>
              {kind.autos.map(([flag, label]) => (
                <label key={flag} className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!auto[flag]} onChange={(e) => setAuto({ ...auto, [flag]: e.target.checked })} /> {label}</label>
              ))}
            </div>
            <div className="muted" style={{ margin: '8px 0 4px' }}>{kind.sidesNote}</div>
            <div className="form-grid">
              {LESS.map(([k, label]) => (
                <Field key={k} label={label}><input className="num" inputMode="decimal" value={amts[k] || ''} onChange={(e) => setAmts({ ...amts, [k]: e.target.value })} /></Field>
              ))}
              <Field label="Others note"><input value={othersAddStr} onChange={(e) => setAddStr(e.target.value)} /></Field>
              <Field label="Others (taken off / added) note"><input value={othersLessStr} onChange={(e) => setLessStr(e.target.value)} /></Field>
            </div>
          </div>
          <div className="totals" style={{ flex: '1 1 300px' }}>
            <div><span>Total weight / bags</span><span>{weight} / {bags}</span></div>
            <div><span>Items total</span><span>{fmt(billAmt)}</span></div>
            <div><span>{kind.chargesSign === 1 ? 'Charges' : 'Deductions'}</span><span>{fmt(adds)}</span></div>
            <div><span>{kind.chargesSign === 1 ? 'Less' : 'Added'}</span><span>{fmt(less)}</span></div>
            <div className="big"><span>Bill total</span><span>{fmt(gross)}</span></div>
            <div><span>Previous balance</span><span>{fmt(prev)}</span></div>
            <div style={{ alignItems: 'center' }}><span>{kind.cash}</span><input className="num" style={{ width: 120 }} inputMode="decimal" value={cashAmt} onChange={(e) => setCash(e.target.value)} /></div>
            <div className="big"><span>Net balance</span><span>{fmt(balance)}</span></div>
            <div className="muted" style={{ fontSize: '.8rem' }}>{rupeesInWords(gross)}</div>
          </div>
        </div>
      </div>

      <div className="row actionbar" style={{ justifyContent: 'flex-end' }}>
        {!isNew && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete bill</button>}
        <button className="primary" onClick={save} disabled={saving || !supKey || billAmt <= 0}>{saving ? 'Saving…' : 'Save and print'}</button>
      </div>
    </>
  );
}
