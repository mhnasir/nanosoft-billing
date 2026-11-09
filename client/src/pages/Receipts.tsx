import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, dateOnly, fdate, fmt, qs, todayISO, type Row } from '../api';
import { ErrorBox, Field, Modal, Picker, useLoad } from '../components';

const TITLE: Record<string, string> = { R: 'Receipts', P: 'Payments' };

export default function Receipts() {
  const { type = 'R' } = useParams();
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01');
  const [to, setTo] = useState(todayISO());
  const { data, error, reload } = useLoad<Row[]>(TITLE[type] ? `/receipts${qs({ type, from, to })}` : null);
  // Receipts come from customers, payments go to suppliers - but allow any party type.
  const parties = useLoad<Row[]>('/parties?limit=2000');
  const banks = useLoad<Row[]>('/banks');
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const partyOpts = useMemo(
    () => (parties.data || []).map((p): Row => ({ ...p, __id: p.SupKey })).sort((a, b) => (a.SupType === (type === 'R' ? 'C' : 'S') ? -1 : 1) - (b.SupType === (type === 'R' ? 'C' : 'S') ? -1 : 1)),
    [parties.data, type],
  );
  if (!TITLE[type]) return <Navigate to="/receipts/R" />;

  const set = (k: string, v: unknown) => setEdit((e) => ({ ...e, [k]: v }));
  const blank = () => ({ Id: 0, recDate: todayISO(), supKey: 0, amount: '', lessAmt: '', mode: 'Cash', creditNo: '', creditDate: '', bankKey: 0, bankers: '', narration: '', shift: '' });
  const fromRow = (r: Row) => ({
    Id: r.Id, recDate: dateOnly(r.RecDate), supKey: r.SupKey, amount: String(r.Amount), lessAmt: r.LessAmt ? String(r.LessAmt) : '', mode: r.Mode || 'Cash',
    creditNo: r.CreditNo || '', creditDate: dateOnly(r.CreditDate), bankKey: r.BankKey || 0, bankers: r.Bankers || '', narration: r.Narration || '', shift: (r.Shift || '').trim(),
  });

  async function save() {
    if (!edit) return;
    setSaving(true);
    setMsg('');
    try {
      const body = { ...edit, recType: type, amount: Number(edit.amount), lessAmt: Number(edit.lessAmt) || 0 };
      if (edit.Id) await api.put(`/receipts/${edit.Id}`, body);
      else await api.post('/receipts', body);
      setEdit(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete this ${type === 'R' ? 'receipt' : 'payment'} of ${fmt(r.Amount)} for ${r.SupName}?`)) return;
    try { await api.del(`/receipts/${r.Id}`); reload(); } catch (e) { setMsg((e as Error).message); }
  }

  const total = (data || []).reduce((s, r) => s + Number(r.Amount), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{TITLE[type]}</h1>
        <button className="primary" onClick={() => { setMsg(''); setEdit(blank()); }}>New {type === 'R' ? 'receipt' : 'payment'}</button>
      </div>
      <div className="card row">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error || (!edit ? msg : '')} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>Date</th><th>Party</th><th>Mode</th><th>Ref</th><th>Narration</th><th className="r">Discount</th><th className="r">Amount</th><th /></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r.Id}>
                <td>{fdate(r.RecDate)}</td><td>{r.SupName}</td><td>{r.Mode}</td><td>{r.CreditNo}</td><td>{r.Narration}</td>
                <td className="r">{r.LessAmt ? fmt(r.LessAmt) : ''}</td><td className={`r ${type === 'R' ? 'got' : ''}`}>{fmt(r.Amount)}</td>
                <td className="r">
                  <button className="sm" onClick={() => { setMsg(''); setEdit(fromRow(r)); }}>Edit</button>{' '}
                  <button className="sm danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={8} className="muted">Nothing in this period.</td></tr>}
          </tbody>
          {data && data.length > 0 && <tfoot><tr><td colSpan={6}>{data.length} entries</td><td className={`r ${type === 'R' ? 'got' : ''}`}>{fmt(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
      {edit && (
        <Modal title={`${edit.Id ? 'Edit' : 'New'} ${type === 'R' ? 'receipt' : 'payment'}`} onClose={() => setEdit(null)}>
          <ErrorBox error={msg} />
          <div className="form-grid">
            <Field label="Date"><input type="date" value={edit.recDate} onChange={(e) => set('recDate', e.target.value)} /></Field>
            <Field label="Party">
              <Picker id="rp-party" options={partyOpts} value={edit.supKey} onChange={(k) => set('supKey', k)} labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)} placeholder="Type to search…" />
            </Field>
            <Field label="Amount"><input className="num" inputMode="decimal" value={edit.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
            <Field label="Discount / less"><input className="num" inputMode="decimal" value={edit.lessAmt} onChange={(e) => set('lessAmt', e.target.value)} /></Field>
            <Field label="Mode">
              <select value={edit.mode} onChange={(e) => set('mode', e.target.value)}><option>Cash</option><option>Cheque</option><option>DD</option></select>
            </Field>
            <Field label="Shift">
              <select value={edit.shift} onChange={(e) => set('shift', e.target.value)}><option value="">-</option><option>S1</option><option>S2</option><option>S3</option></select>
            </Field>
            {edit.mode !== 'Cash' && (
              <>
                <Field label="Cheque / DD no"><input value={edit.creditNo} onChange={(e) => set('creditNo', e.target.value)} /></Field>
                <Field label="Cheque date"><input type="date" value={edit.creditDate} onChange={(e) => set('creditDate', e.target.value)} /></Field>
                <Field label="Bank">
                  <select value={edit.bankKey} onChange={(e) => set('bankKey', Number(e.target.value))}>
                    <option value={0}>(none)</option>
                    {(banks.data || []).map((b) => <option key={b.BankKey} value={b.BankKey}>{b.BankName}</option>)}
                  </select>
                </Field>
                <Field label="Drawn on (bankers)"><input value={edit.bankers} onChange={(e) => set('bankers', e.target.value)} /></Field>
              </>
            )}
            <Field label="Narration" className="grow"><input value={edit.narration} onChange={(e) => set('narration', e.target.value)} /></Field>
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save} disabled={saving || !edit.supKey || !(Number(edit.amount) > 0)}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
