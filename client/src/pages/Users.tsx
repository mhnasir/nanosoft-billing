import { useState } from 'react';
import { api, type Row } from '../api';
import { ErrorBox, Field, Modal, useLoad } from '../components';

const BLANK = { username: '', password: '', role: 'pos' };

export default function Users({ me }: { me: Row }) {
  const { data, error, reload } = useLoad<Row[]>('/users');
  const roles = useLoad<Row[]>('/users/roles');
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const label = (k: string) => roles.data?.find((r) => r.key === k)?.label || k;
  // Only an owner may hand out the owner / admin roles.
  const choices = (roles.data || []).filter((r) => me.role === 'owner' || !['owner', 'admin'].includes(r.key));

  async function save() {
    if (!edit) return;
    setMsg('');
    try {
      if (edit.Id) await api.put(`/users/${edit.Id}`, edit);
      else await api.post('/users', edit);
      setEdit(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete login "${r.UserName}"?`)) return;
    try { await api.del(`/users/${r.Id}`); reload(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Users and roles</h1>
        <button className="primary" onClick={() => { setMsg(''); setEdit({ ...BLANK }); }}>New user</button>
      </div>
      <ErrorBox error={error || msg} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>User name</th><th>Role</th><th /></tr></thead>
          <tbody>
            {(data || []).map((u) => (
              <tr key={u.Id}>
                <td>{u.UserName}</td><td>{label(u.Role)}</td>
                <td className="r">
                  <button className="sm" onClick={() => { setMsg(''); setEdit({ Id: u.Id, username: u.UserName, password: '', role: u.Role }); }}>Edit</button>{' '}
                  <button className="sm danger" onClick={() => remove(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card muted" style={{ marginTop: 12 }}>
        Owner and Admin: everything, including users. Manager: everything except users. POS: sales bills, receipts, customers. Stock keeper: purchase bills and products, view sales. Loading staff: view sales and purchase bills only.
      </div>
      {edit && (
        <Modal title={edit.Id ? 'Edit user' : 'New user'} onClose={() => setEdit(null)}>
          <ErrorBox error={msg} />
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="User name"><input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} autoComplete="off" /></Field>
            <Field label={edit.Id ? 'New password (leave empty to keep)' : 'Password'}><input type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="off" /></Field>
            <Field label="Role">
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {choices.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" onClick={save}>Save</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
