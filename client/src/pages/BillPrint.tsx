import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fdate, fmt, getAppName, rupeesInWords } from '../api';
import { useBrand } from '../components';
import { AMT_COL, KIND } from '../billkinds';
import { ErrorBox, useLoad } from '../components';
import { pageSize, type PrintCfg } from '../paper';

/** Same rule as the VB WaCleanNumber: digits only, a 10-digit number gets the 91 country code, anything shorter than 11 digits is not a number. */
export function waNumber(s: unknown): string {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  return d.length < 11 ? '' : d;
}

export default function BillPrint() {
  const { type = 'B', id } = useParams();
  const bill = useLoad<any>(`/bills/${id}`);
  const company = useLoad<any>('/company');
  const brandInfo = useBrand();
  const printLogo = brandInfo.logo && brandInfo.logoOnPrint ? brandInfo.logo : ''; // the logo goes left of the company name when it is switched on in Settings
  const printCfg = useLoad<PrintCfg>('/settings/print'); // paper size etc. from Settings
  const cfg = printCfg.data || {};
  const page = cfg.paper ? pageSize(cfg) : null;
  const b = bill.data;
  const c = company.data || {};
  const num = (k: string) => Number(b?.[k]) || 0;
  const kind = KIND[b?.BillType || type] || KIND.B;
  const pick = (fields: [string, string][]) =>
    fields.map(([k, label]) => [k === 'othersAddAmt' && b?.OthersAddStr ? b.OthersAddStr : k === 'othersLessAmt' && b?.OthersLessStr ? b.OthersLessStr : label, num(AMT_COL[k])] as [string, number]).filter(([, v]) => v);
  const charges = b ? pick(kind.charges) : [];
  const deductions = b ? pick(kind.sides) : [];
  const sign = kind.chargesSign === 1 ? ['+', '−'] : ['−', '+'];
  // WhatsApp: opens a chat with the customer's saved mobile number and a ready message; the user presses Send.
  const waTo = b ? waNumber(b.Phone) || waNumber(b.Mobile) : '';
  const waText = b
    ? [
        `${c.CompanName || getAppName()}`,
        `${kind.one[0].toUpperCase()}${kind.one.slice(1)} No. ${b.BillNo} · ${fdate(b.BillDate)}`,
        `${b.SupName}`,
        ...(kind.chit
          ? [`Bags: ${b.lines.reduce((s: number, l: any) => s + Number(l.Nop), 0)}`]
          : [
              `Bill total: ₹${fmt(b.Gross)}`,
              ...(Number(b.CashAmt) > 0 ? [`${kind.cash}: ₹${fmt(b.CashAmt)}`] : []),
              `${kind.doc ? 'Net payable' : 'Balance'}: ₹${fmt(b.NetAmt)}`,
            ]),
        'Thank you.',
      ].join('\n')
    : '';
  const waHref = `https://wa.me/${waTo}?text=${encodeURIComponent(waText)}`;
  const weight = b ? b.lines.reduce((s: number, l: any) => s + Number(l.Qty), 0) : 0;
  const bags = b ? b.lines.reduce((s: number, l: any) => s + Number(l.Nop), 0) : 0;

  return (
    <>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Bill saved</h1>
        <Link className="btn" to={`/bills/${type}/${id}`}>Edit</Link>
        <Link className="btn" to={`/bills/${type}/new`}>New bill</Link>
        <Link className="btn" to={`/bills/${type}`}>List</Link>
        <a className="btn" href={waHref} target="_blank" rel="noopener noreferrer" title={waTo ? `Send to ${waTo} on WhatsApp` : 'No mobile number saved for this party: WhatsApp will ask who to send to'}>
          WhatsApp{!waTo && b ? ' (no number)' : ''}
        </a>
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <ErrorBox error={bill.error} />
      {page && <style>{`@page { size: ${page.w}mm ${page.h}mm; margin: ${cfg.margin ?? 10}mm; }`}</style>}
      {b && (
        <div className="print-sheet" style={page ? { maxWidth: `${page.w}mm`, fontSize: `${cfg.fontSize ?? 13}px` } : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 }}>
            {printLogo && <img className="print-logo" src={printLogo} alt="" />}
            <div style={{ textAlign: printLogo ? 'left' : 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{c.CompanName || getAppName()}</div>
              {c.PropName && <div>{c.PropName}</div>}
              <div>{[c.Address, c.Address1].filter(Boolean).join(', ')}</div>
              {c.Phoneno && <div>Phone: {c.Phoneno}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '6px 0', margin: '8px 0' }}>
            <div>
              <b>{b.SupName}</b><br />
              {[b.Add1, b.Add2, b.Add3].filter((x) => x && x !== '-').join(', ')}<br />
              {[b.City, b.Pincode].filter(Boolean).join(' - ')} {b.Phone ? `· ${b.Phone}` : ''}
            </div>
            <div style={{ textAlign: 'right' }}>
              <b>{b.BillType === 'B' ? 'SALES BILL' : b.BillType === 'S' ? 'PURCHASE BILL' : kind.one.toUpperCase()} No. {b.BillNo}</b><br />
              Date: {fdate(b.BillDate)}
              {b.LotNo ? <><br />Lot: {b.LotNo}</> : null}
            </div>
          </div>
          <table>
            <thead>
              {kind.chit
                ? <tr><th>#</th><th>Item</th><th className="r">Bags</th></tr>
                : <tr><th>#</th><th>Item</th><th className="r">Bags</th><th className="r">Weight</th><th>Unit</th><th className="r">Rate</th><th className="r">Amount</th></tr>}
            </thead>
            <tbody>
              {b.lines.map((l: any, i: number) => (
                <Fragment key={l.Sal02Key}>
                  <tr>
                    <td>{i + 1}</td><td>{l.ProdName}{l.Marks ? ` [${l.Marks}]` : ''}</td>
                    <td className="r">{Number(l.Nop) || ''}</td>
                    {!kind.chit && <><td className="r">{Number(l.Qty)}</td><td>{l.Unit}</td><td className="r">{fmt(l.Rate)}</td><td className="r">{fmt(l.Amount)}</td></>}
                  </tr>
                  {(l.Subs || []).map((s: any, j: number) => (
                    <tr key={j} style={{ fontSize: '.88em' }}>
                      <td />
                      <td style={{ paddingLeft: 18 }}>– {s.SupName}</td>
                      <td className="r">{Number(s.Nop) || ''}</td>
                      <td className="r">{Number(s.Qty) || ''}</td><td />
                      <td className="r">{fmt(s.Rate)}</td>
                      <td className="r">{fmt(Math.round((l.Unit && /^kg/i.test(l.Unit) ? Number(s.Qty) : Number(s.Nop)) * Number(s.Rate)))}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              {kind.chit
                ? <tr><td colSpan={2}>Total</td><td className="r">{bags}</td></tr>
                : <tr><td colSpan={2}>Total</td><td className="r">{bags}</td><td className="r">{weight}</td><td /><td /><td className="r">{fmt(b.BillAmt)}</td></tr>}
            </tfoot>
          </table>
          {kind.chit && <div className="totals" style={{ marginTop: 10 }}><div className="big"><span>Total bags</span><span>{bags}</span></div></div>}
          {!kind.chit && <div className="totals" style={{ marginTop: 10 }}>
            <div><span>Weight / bags</span><span>{weight} / {bags}</span></div>
            <div><span>Items total</span><span>{fmt(b.BillAmt)}</span></div>
            {charges.map(([k, v]) => <div key={k}><span>{sign[0]} {k}</span><span>{fmt(v)}</span></div>)}
            {deductions.map(([k, v]) => <div key={k}><span>{sign[1]} {k}</span><span>{fmt(v)}</span></div>)}
            <div className="big"><span>Bill total</span><span className={b.BillType === 'B' ? 'due' : ''}>{fmt(b.Gross)}</span></div>
            {!b.NonBalance && !kind.doc && <div><span>Previous balance</span><span className={b.BillType === 'B' && num('BalAmt') > 0 ? 'due' : ''}>{fmt(num('BalAmt'))}</span></div>}
            {num('CashAmt') > 0 && <div><span>{kind.cash}</span><span className={b.BillType === 'B' ? 'got' : ''}>{fmt(b.CashAmt)}</span></div>}
            <div className="big"><span>{kind.doc ? 'Net payable' : 'Net balance'}</span><span className={b.BillType === 'B' && num('NetAmt') > 0 ? 'due' : ''}>{fmt(num('NetAmt'))}</span></div>
            <div style={{ fontSize: '.85rem' }}>{rupeesInWords(b.Gross)}</div>
          </div>}
        </div>
      )}
    </>
  );
}
