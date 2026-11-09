import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fdate, fmt, qs, todayISO, userKey } from '../api';
import { ErrorBox, Field, useLoad } from '../components';

type Period = 'today' | 'month' | 'fy' | 'custom';
const PERIODS: [Period, string][] = [['today', 'Today'], ['month', 'This month'], ['fy', 'Fiscal year'], ['custom', 'From – To']];

/** Date range of a period, ending today (or the end of the financial year, 1 Apr - 31 Mar). */
function rangeOf(p: Period, cFrom: string, cTo: string): { from: string; to: string; label: string } {
  const t = todayISO();
  const [y, m] = t.split('-').map(Number);
  if (p === 'month') return { from: `${t.slice(0, 8)}01`, to: t, label: 'this month' };
  if (p === 'fy') {
    const s = m >= 4 ? y : y - 1;
    return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` };
  }
  if (p === 'custom') return { from: cFrom || t, to: cTo || cFrom || t, label: `${fdate(cFrom || t)} – ${fdate(cTo || cFrom || t)}` };
  return { from: t, to: t, label: 'today' };
}

export default function Dashboard() {
  // Shortcuts on this screen: Ctrl+S = new sales bill, Ctrl+P = new purchase bill (instead of the browser's Save / Print)
  const nav = useNavigate();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const c = e.key.toLowerCase();
      if (c === 's') { e.preventDefault(); nav('/bills/B/new'); }
      else if (c === 'p') { e.preventDefault(); nav('/bills/S/new'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [nav]);
  const key = `nvs.dashPeriod.${userKey()}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(key) || 'null') as { p: Period; from?: string; to?: string } | null; } catch { return null; } })();
  const [period, setPeriod] = useState<Period>(saved?.p || 'today'); // each user's saved default, else today
  const [cFrom, setCFrom] = useState(saved?.from || todayISO());
  const [cTo, setCTo] = useState(saved?.to || todayISO());
  const [def, setDef] = useState<{ p: Period; from?: string; to?: string } | null>(saved);
  useEffect(() => { if (cTo < cFrom) setCTo(cFrom); }, [cFrom, cTo]);

  const range = rangeOf(period, cFrom, cTo);
  const { data, error, loading } = useLoad<any>(`/reports/dashboard${qs({ from: range.from, to: range.to })}`);
  const pick = (arr: any[] | undefined, k: string, field: string) => arr?.find((x) => x[field] === k);
  const b = pick(data?.bills, 'B', 'BillType');
  const s = pick(data?.bills, 'S', 'BillType');
  const r = pick(data?.receipts, 'R', 'RecType');
  const p = pick(data?.receipts, 'P', 'RecType');

  const isDefault = !!def && def.p === period && (period !== 'custom' || (def.from === cFrom && def.to === cTo));
  const makeDefault = () => {
    const v = { p: period, ...(period === 'custom' ? { from: cFrom, to: cTo } : {}) };
    setDef(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: only lasts this session */ }
  };

  return (
    <>
      <h1>Dashboard</h1>
      <div className="row" style={{ marginBottom: 14, alignItems: 'center' }}>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>
              {label}{def?.p === k ? ' ★' : ''}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <>
            <Field label="From"><input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} /></Field>
          </>
        )}
        <span className="muted">{period === 'today' || period === 'custom' && range.from === range.to ? fdate(range.from) : `${fdate(range.from)} – ${fdate(range.to)}`}</span>
        <button type="button" className="sm" onClick={makeDefault} disabled={isDefault} title="Open the dashboard on this period every time (kept for your login on this computer)">
          {isDefault ? '★ My default' : '☆ Make this my default'}
        </button>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="k">Sales, {range.label} ({b?.Cnt || 0})</div><div className="v">{fmt(b?.Total)}</div></div>
            <div className="stat"><div className="k">Purchases, {range.label} ({s?.Cnt || 0})</div><div className="v">{fmt(s?.Total)}</div></div>
            <div className="stat"><div className="k">Receipts, {range.label} ({r?.Cnt || 0})</div><div className="v got">{fmt(r?.Total)}</div></div>
            <div className="stat"><div className="k">Payments, {range.label} ({p?.Cnt || 0})</div><div className="v">{fmt(p?.Total)}</div></div>
            <div className="stat"><div className="k">Total receivable (now)</div><div className="v due">{fmt(data.receivable)}</div></div>
            <div className="stat"><div className="k">Total payable (now)</div><div className="v">{fmt(data.payable)}</div></div>
          </div>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 className="grow" style={{ margin: 0 }}>Recent bills</h2>
              <Link className="btn primary" to="/bills/B/new" title="Shortcut: Ctrl+S">New sales bill <small>(Ctrl+S)</small></Link>
              <Link className="btn" to="/bills/S/new" title="Shortcut: Ctrl+P">New purchase bill <small>(Ctrl+P)</small></Link>
            </div>
            <table className="stack">
              <thead><tr><th>No</th><th>Date</th><th>Type</th><th>Party</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {data.recent.map((x: any) => (
                  <tr key={x.BillKey}>
                    <td><Link to={`/bills/${x.BillType}/${x.BillKey}`}>{x.BillNo}</Link></td>
                    <td>{fdate(x.BillDate)}</td><td><span className="pill">{x.BillType === 'B' ? 'Sales' : 'Purchase'}</span></td>
                    <td>{x.SupName}</td><td className={`r ${x.BillType === 'B' ? 'due' : ''}`}>{fmt(x.Gross)}</td>
                  </tr>
                ))}
                {!data.recent.length && <tr><td colSpan={5} className="muted">No bills yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
