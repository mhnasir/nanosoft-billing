import { Link } from 'react-router-dom';
import { fdate, fmt } from '../api';
import { ErrorBox, useLoad } from '../components';

export default function Dashboard() {
  const { data, error, loading } = useLoad<any>('/reports/dashboard');
  const pick = (arr: any[] | undefined, k: string, key: string) => arr?.find((x) => x[key] === k);
  const b = pick(data?.bills, 'B', 'BillType');
  const s = pick(data?.bills, 'S', 'BillType');
  const r = pick(data?.receipts, 'R', 'RecType');
  const p = pick(data?.receipts, 'P', 'RecType');
  return (
    <>
      <h1>Dashboard</h1>
      <ErrorBox error={error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="k">Customer bills today ({b?.Cnt || 0})</div><div className="v">{fmt(b?.Total)}</div></div>
            <div className="stat"><div className="k">Supplier bills today ({s?.Cnt || 0})</div><div className="v">{fmt(s?.Total)}</div></div>
            <div className="stat"><div className="k">Receipts today ({r?.Cnt || 0})</div><div className="v">{fmt(r?.Total)}</div></div>
            <div className="stat"><div className="k">Payments today ({p?.Cnt || 0})</div><div className="v">{fmt(p?.Total)}</div></div>
            <div className="stat"><div className="k">Total receivable</div><div className="v">{fmt(data.receivable)}</div></div>
            <div className="stat"><div className="k">Total payable</div><div className="v">{fmt(data.payable)}</div></div>
          </div>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 className="grow" style={{ margin: 0 }}>Recent bills</h2>
              <Link className="btn primary" to="/bills/B/new">New customer bill</Link>
              <Link className="btn" to="/bills/S/new">New supplier bill</Link>
            </div>
            <table>
              <thead><tr><th>No</th><th>Date</th><th>Type</th><th>Party</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {data.recent.map((x: any) => (
                  <tr key={x.BillKey}>
                    <td><Link to={`/bills/${x.BillType}/${x.BillKey}`}>{x.BillNo}</Link></td>
                    <td>{fdate(x.BillDate)}</td><td><span className="pill">{x.BillType === 'B' ? 'Customer' : 'Supplier'}</span></td>
                    <td>{x.SupName}</td><td className="r">{fmt(x.Gross)}</td>
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
