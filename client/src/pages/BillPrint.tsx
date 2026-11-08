import { Link, useParams } from 'react-router-dom';
import { fdate, fmt, rupeesInWords } from '../api';
import { AMT_COL, KIND } from '../billkinds';
import { ErrorBox, useLoad } from '../components';

export default function BillPrint() {
  const { type = 'B', id } = useParams();
  const bill = useLoad<any>(`/bills/${id}`);
  const company = useLoad<any>('/company');
  const b = bill.data;
  const c = company.data || {};
  const num = (k: string) => Number(b?.[k]) || 0;
  const kind = KIND[b?.BillType || type] || KIND.B;
  const pick = (fields: [string, string][]) =>
    fields.map(([k, label]) => [k === 'othersAddAmt' && b?.OthersAddStr ? b.OthersAddStr : k === 'othersLessAmt' && b?.OthersLessStr ? b.OthersLessStr : label, num(AMT_COL[k])] as [string, number]).filter(([, v]) => v);
  const charges = b ? pick(kind.charges) : [];
  const deductions = b ? pick(kind.sides) : [];
  const sign = kind.chargesSign === 1 ? ['+', '−'] : ['−', '+'];
  const weight = b ? b.lines.reduce((s: number, l: any) => s + Number(l.Qty), 0) : 0;
  const bags = b ? b.lines.reduce((s: number, l: any) => s + Number(l.Nop), 0) : 0;

  return (
    <>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Bill saved</h1>
        <Link className="btn" to={`/bills/${type}/${id}`}>Edit</Link>
        <Link className="btn" to={`/bills/${type}/new`}>New bill</Link>
        <Link className="btn" to={`/bills/${type}`}>List</Link>
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <ErrorBox error={bill.error} />
      {b && (
        <div className="print-sheet">
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{c.CompanName || 'NanoSoft Billing'}</div>
            {c.PropName && <div>{c.PropName}</div>}
            <div>{[c.Address, c.Address1].filter(Boolean).join(', ')}</div>
            {c.Phoneno && <div>Phone: {c.Phoneno}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '6px 0', margin: '8px 0' }}>
            <div>
              <b>{b.SupName}</b><br />
              {[b.Add1, b.Add2, b.Add3].filter((x) => x && x !== '-').join(', ')}<br />
              {[b.City, b.Pincode].filter(Boolean).join(' - ')} {b.Phone ? `· ${b.Phone}` : ''}
            </div>
            <div style={{ textAlign: 'right' }}>
              <b>{b.BillType === 'B' ? 'SALES BILL' : 'PURCHASE BILL'} No. {b.BillNo}</b><br />
              Date: {fdate(b.BillDate)}
              {b.LotNo ? <><br />Lot: {b.LotNo}</> : null}
            </div>
          </div>
          <table>
            <thead><tr><th>#</th><th>Item</th><th className="r">Bags</th><th className="r">Weight</th><th>Unit</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {b.lines.map((l: any, i: number) => (
                <tr key={l.Sal02Key}>
                  <td>{i + 1}</td><td>{l.ProdName}{l.Marks ? ` [${l.Marks}]` : ''}</td>
                  <td className="r">{Number(l.Nop) || ''}</td><td className="r">{Number(l.Qty)}</td><td>{l.Unit}</td>
                  <td className="r">{fmt(l.Rate)}</td><td className="r">{fmt(l.Amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals" style={{ marginTop: 10 }}>
            <div><span>Weight / bags</span><span>{weight} / {bags}</span></div>
            <div><span>Items total</span><span>{fmt(b.BillAmt)}</span></div>
            {charges.map(([k, v]) => <div key={k}><span>{sign[0]} {k}</span><span>{fmt(v)}</span></div>)}
            {deductions.map(([k, v]) => <div key={k}><span>{sign[1]} {k}</span><span>{fmt(v)}</span></div>)}
            <div className="big"><span>Bill total</span><span>{fmt(b.Gross)}</span></div>
            <div><span>Previous balance</span><span>{fmt(num('BalAmt'))}</span></div>
            {num('CashAmt') > 0 && <div><span>{kind.cash}</span><span>{fmt(b.CashAmt)}</span></div>}
            <div className="big"><span>Net balance</span><span>{fmt(num('NetAmt'))}</span></div>
            <div style={{ fontSize: '.85rem' }}>{rupeesInWords(b.Gross)}</div>
          </div>
        </div>
      )}
    </>
  );
}
