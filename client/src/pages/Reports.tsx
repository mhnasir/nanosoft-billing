import { useMemo, useState } from 'react';
import { fdate, fmt, qs, todayISO, type Row } from '../api';
import { ErrorBox, Field, Picker, useLoad } from '../components';

const Bal = ({ v }: { v: number }) => <span className={v < 0 ? 'neg' : ''}>{fmt(Math.abs(v))} {v < 0 ? 'Cr' : v > 0 ? 'Dr' : ''}</span>;

function fyStart() {
  const d = new Date();
  return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01`;
}

export function Ledger() {
  const [supKey, setSupKey] = useState(0);
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayISO());
  const parties = useLoad<Row[]>('/parties?limit=2000');
  const opts = useMemo(() => (parties.data || []).map((p) => ({ ...p, __id: p.SupKey })), [parties.data]);
  const { data, error } = useLoad<any>(supKey ? `/reports/ledger${qs({ supKey, from, to })}` : null);
  return (
    <>
      <h1 className="noprint">Party ledger</h1>
      <div className="card row noprint">
        <Field label="Party" className="grow"><Picker id="lg-party" options={opts} value={supKey} onChange={setSupKey} labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)} placeholder="Type to search…" /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {data && <button onClick={() => window.print()}>Print</button>}
      </div>
      <ErrorBox error={error || parties.error} />
      {data && (
        <div className="tablewrap" style={{ maxHeight: 'none' }}>
          <table className="fit">
            <thead><tr><th>Date</th><th>Particulars</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
            <tbody>
              <tr><td>{fdate(from)}</td><td colSpan={3}><b>Opening balance</b></td><td className="r"><Bal v={data.opening} /></td></tr>
              {data.entries.map((e: any) => (
                <tr key={e.Id}>
                  <td>{fdate(e.Date)}</td><td>{({ B: 'Bill', S: 'Supplier bill', R: 'Receipt', P: 'Payment' } as Record<string, string>)[e.DocType] || e.DocType} {e.DocNo ? `[${e.DocNo}]` : ''}{e.Notes ? <div className="muted note">{e.Notes}</div> : null}</td>
                  <td className="r">{e.Debit ? fmt(e.Debit) : ''}</td><td className="r">{e.Credit ? fmt(e.Credit) : ''}</td><td className="r"><Bal v={e.Balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Closing</td><td className="r">{fmt(data.totalDebit)}</td><td className="r">{fmt(data.totalCredit)}</td><td className="r"><Bal v={data.closing} /></td></tr></tfoot>
          </table>
        </div>
      )}
      {!supKey && <p className="muted">Choose a party to see the ledger. Dr = party owes you, Cr = you owe the party.</p>}
    </>
  );
}

export function Outstanding() {
  const [type, setType] = useState('C');
  const { data, error } = useLoad<any>(`/reports/outstanding${qs({ type })}`);
  return (
    <>
      <h1>Outstanding</h1>
      <div className="tabs noprint">
        {[['C', 'Customers'], ['S', 'Suppliers'], ['O', 'Others'], ['B', 'Branches'], ['H', 'Legacy (H)']].map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}
        <button onClick={() => window.print()}>Print</button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <div className="tablewrap" style={{ maxHeight: 'none' }}>
          <table className="stack">
            <thead><tr><th>Party</th><th>City</th><th>Group</th><th>Phone</th><th>Last payment</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.SupKey}><td>{r.SupName}</td><td>{r.City}</td><td>{r.GroupName}</td><td>{r.Phone}</td><td>{fdate(r.LastPayment)}</td><td className="r"><Bal v={r.Balance} /></td></tr>
              ))}
              {!data.rows.length && <tr><td colSpan={6} className="muted">No outstanding balances.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={5}>{data.rows.length} parties - net</td><td className="r"><Bal v={data.total} /></td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

export function DayBook() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const { data, error } = useLoad<any>(`/reports/daybook${qs({ from, to })}`);
  const all: Row[] = data ? [...data.bills, ...data.receipts].sort((a, b) => String(a.Date).localeCompare(String(b.Date))) : [];
  return (
    <>
      <h1 className="noprint">Day book</h1>
      <div className="card row noprint">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="k">Customer bills</div><div className="v">{fmt(data.totals.billB)}</div></div>
            <div className="stat"><div className="k">Supplier bills</div><div className="v">{fmt(data.totals.billS)}</div></div>
            <div className="stat"><div className="k">Receipts</div><div className="v">{fmt(data.totals.receipts)}</div></div>
            <div className="stat"><div className="k">Payments</div><div className="v">{fmt(data.totals.payments)}</div></div>
          </div>
          <div className="tablewrap" style={{ maxHeight: 'none' }}>
            <table>
              <thead><tr><th>Date</th><th>Entry</th><th>No</th><th>Party</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {all.map((r, i) => <tr key={i}><td>{fdate(r.Date)}</td><td>{r.Kind}{r.Mode && r.Mode !== 'Cash' ? ` (${r.Mode})` : ''}</td><td>{r.No}</td><td>{r.SupName}</td><td className="r">{fmt(r.Amount)}</td></tr>)}
                {!all.length && <tr><td colSpan={5} className="muted">No entries.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function TrialBalance() {
  const { data, error } = useLoad<any>('/reports/trial-balance');
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Trial balance (by party group)</h1>
        <button className="noprint" onClick={() => window.print()}>Print</button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <div className="tablewrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Group</th><th className="r">Parties</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>{data.rows.map((r: any) => <tr key={r.GroupName}><td>{r.GroupName}</td><td className="r">{r.Parties}</td><td className="r">{fmt(r.Debit)}</td><td className="r">{fmt(r.Credit)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="r">{fmt(data.totalDebit)}</td><td className="r">{fmt(data.totalCredit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}
