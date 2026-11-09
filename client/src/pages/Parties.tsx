import { useState } from 'react';
import { api, fmt, qs, type Row } from '../api';
import { ErrorBox, Field, Modal, useLoad } from '../components';

const TYPES: [string, string][] = [['', 'All'], ['C', 'Customers'], ['S', 'Suppliers'], ['O', 'Others'], ['B', 'Branches'], ['H', 'Legacy (H)']];

export default function Parties() {
  const [type, setType] = useState('');
  const [inactive, setInactive] = useState(false);
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad<Row[]>(`/parties${qs({ type, q, inactive: inactive ? '1' : '' })}`);
  const groups = useLoad<Row[]>('/groups');
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setEdit((e) => ({ ...e, [k]: v }));

  async function save() {
    if (!edit) return;
    setSaving(true);
    setMsg('');
    try {
      if (edit.SupKey) await api.put(`/parties/${edit.SupKey}`, edit);
      else await api.post('/parties', edit);
      setEdit(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete "${r.SupName}"?`)) return;
    try { await api.del(`/parties/${r.SupKey}`); reload(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Customers / suppliers</h1>
        <input placeholder="Search name or city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" onClick={() => { setMsg(''); setEdit({ SupType: type || 'C', CustKey: 0, OpnBal: 0, ShowCharges: 1 }); }}>Add</button>
      </div>
      <div className="tabs">
        {TYPES.map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}
      </div>
      <label className="row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive
      </label>
      <ErrorBox error={error || (!edit ? msg : '')} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>Name</th><th>Type</th><th>City</th><th>Group</th><th>Phone</th><th className="r">Balance</th><th /></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r.SupKey}>
                <td>{r.SupName}{r.Stat ? ' (inactive)' : ''}</td><td>{r.SupType}</td><td>{r.City}</td><td>{r.GroupName}</td><td>{r.Phone}</td>
                <td className={`r ${r.Balance > 0 ? 'due' : ''}`}>{fmt(r.Balance)}</td>
                <td className="r">
                  <button className="sm" onClick={() => { setMsg(''); setEdit({ ...r }); }}>Edit</button>{' '}
                  <button className="sm danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={7} className="muted">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.SupKey ? 'Edit party' : 'Add party'} onClose={() => setEdit(null)}>
          <ErrorBox error={msg} />
          <div className="form-grid">
            <Field label="Name *"><input value={edit.SupName ?? ''} onChange={(e) => set('SupName', e.target.value)} /></Field>
            <Field label="Type">
              <select value={edit.SupType} onChange={(e) => set('SupType', e.target.value)}>
                {TYPES.filter(([k]) => k).map(([k, l]) => <option key={k} value={k}>{l.replace(/s$/, '')}</option>)}
              </select>
            </Field>
            <Field label="Group">
              <select value={edit.CustKey ?? 0} onChange={(e) => set('CustKey', Number(e.target.value))}>
                <option value={0}>(none)</option>
                {(groups.data || []).map((g) => <option key={g.CustKey} value={g.CustKey}>{g.CustType}</option>)}
              </select>
            </Field>
            <Field label="Phone"><input value={edit.Phone ?? ''} onChange={(e) => set('Phone', e.target.value)} /></Field>
            <Field label="Address 1"><input value={edit.Add1 ?? ''} onChange={(e) => set('Add1', e.target.value)} /></Field>
            <Field label="Address 2"><input value={edit.Add2 ?? ''} onChange={(e) => set('Add2', e.target.value)} /></Field>
            <Field label="Address 3"><input value={edit.Add3 ?? ''} onChange={(e) => set('Add3', e.target.value)} /></Field>
            <Field label="City"><input value={edit.City ?? ''} onChange={(e) => set('City', e.target.value)} /></Field>
            <Field label="State"><input value={edit.State ?? ''} onChange={(e) => set('State', e.target.value)} /></Field>
            <Field label="Pincode"><input value={edit.Pincode ?? ''} onChange={(e) => set('Pincode', e.target.value)} /></Field>
            <Field label="Email"><input value={edit.Email ?? ''} onChange={(e) => set('Email', e.target.value)} /></Field>
            <Field label="GST no"><input value={edit.TNGSTNO ?? ''} onChange={(e) => set('TNGSTNO', e.target.value)} /></Field>
            <Field label="Charges on bill screen">
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={edit.ShowCharges !== 0} onChange={(e) => set('ShowCharges', e.target.checked ? 1 : 0)} />
                {edit.ShowCharges !== 0 ? 'Show (commission, cooly ...)' : 'Hidden'}
              </label>
            </Field>
            <Field label="Opening balance (+ owes us / − we owe)">
              <input type="number" step="0.01" value={edit.OpnBal ?? 0} onChange={(e) => set('OpnBal', e.target.value)} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save} disabled={saving || !edit.SupName}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
