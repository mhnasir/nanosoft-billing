import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { fdate, fmt, qs, todayISO } from '../api';
import { ErrorBox, Field, useLoad } from '../components';

import { BILL_TITLE, KIND } from '../billkinds';
export { BILL_TITLE };

export default function BillList() {
  const { type = 'B' } = useParams();
  const nav = useNavigate();
  const monthStart = todayISO().slice(0, 8) + '01';
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad<any[]>(BILL_TITLE[type] ? `/bills${qs({ type, from, to, q })}` : null);
  if (!BILL_TITLE[type]) return <Navigate to="/bills/B" />;

  const total = (data || []).reduce((s, r) => s + Number(r.Gross), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{BILL_TITLE[type]}</h1>
        <Link className="btn primary" to={`/bills/${type}/new`}>New {KIND[type]?.one || 'bill'}</Link>
      </div>
      <div className="card row">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Party name or bill no" className="grow"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>No</th><th>Date</th><th>{KIND[type]?.party || 'Party'}</th><th>City</th><th className="r">Total</th><th className="r">Cash</th><th className="r">Balance</th></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r.BillKey} className="click" onClick={() => nav(`/bills/${type}/${r.BillKey}`)}>
                <td>{r.BillNo}</td><td>{fdate(r.BillDate)}</td><td>{r.SupName}</td><td>{r.City}</td>
                <td className="r">{fmt(r.Gross)}</td><td className="r">{fmt(r.CashAmt)}</td><td className="r">{fmt(r.NetAmt)}</td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={7} className="muted">No bills in this period.</td></tr>}
          </tbody>
          {data && data.length > 0 && <tfoot><tr><td colSpan={4}>{data.length} bills{data.length === 500 ? ' (showing latest 500)' : ''}</td><td className="r">{fmt(total)}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      {loading && <p className="muted">Loading…</p>}
    </>
  );
}
