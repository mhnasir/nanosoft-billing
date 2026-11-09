import { useState } from 'react';
import { api, qs, type Row } from '../api';
import { ErrorBox, Field, Modal, reloadProductImages, useLoad, useProductImages } from '../components';
import { squareThumb } from '../image';

type Col = { key: string; label: string; type?: 'text' | 'number'; r?: boolean };
const CONFIG: Record<string, { title: string; idKey: string; cols: Col[]; blank: Row }> = {
  products: {
    title: 'Products', idKey: 'ProdKey',
    cols: [
      { key: 'ProdName', label: 'Name' }, { key: 'BrandName', label: 'Brand' }, { key: 'ProdTamilName', label: 'Tamil name' },
      { key: 'ProdMalaName', label: 'Malayalam name' }, { key: 'Unit', label: 'Unit' },
      { key: 'CurPrice', label: 'Current price', type: 'number', r: true }, { key: 'Cooly', label: 'Cooly', type: 'number', r: true },
      { key: 'Basket', label: 'Basket', type: 'number', r: true }, { key: 'Gunny', label: 'Gunny', type: 'number', r: true },
      { key: 'OrderKey', label: 'Sort order', type: 'number', r: true }, { key: 'ProdNo', label: 'Code' },
    ],
    blank: { Unit: 'Kgs' },
  },
  groups: {
    title: 'Party groups', idKey: 'CustKey',
    cols: [{ key: 'CustType', label: 'Group name' }, { key: 'GroupKey', label: 'Parent group key', type: 'number', r: true }, { key: 'Display', label: 'Display (1/0)', type: 'number', r: true }],
    blank: { Display: 1, GroupKey: 0 },
  },
  banks: {
    title: 'Banks', idKey: 'BankKey',
    cols: [{ key: 'BankName', label: 'Bank name' }, { key: 'OpBalance', label: 'Opening balance', type: 'number', r: true }],
    blank: {},
  },
  marks: {
    title: 'Marks', idKey: 'MarkKey',
    cols: [{ key: 'MarkName', label: 'Mark' }, { key: 'ProdKey', label: 'Product key', type: 'number', r: true }],
    blank: {},
  },
};

export function SimpleMaster({ kind }: { kind: string }) {
  const cfg = CONFIG[kind];
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad<Row[]>(`/${kind}${qs({ q })}`);
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  // item pictures (Products only): undefined = unchanged, a data URL = new picture, null = remove it
  const imgs = useProductImages();
  const [pic, setPic] = useState<string | null | undefined>(undefined);
  async function pickPic(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg('');
    try { setPic(await squareThumb(f)); } catch (err) { setMsg((err as Error).message); }
  }

  async function save() {
    if (!edit) return;
    setSaving(true);
    setMsg('');
    try {
      let id = edit[cfg.idKey];
      if (id) await api.put(`/${kind}/${id}`, edit);
      else id = (await api.post(`/${kind}`, edit)).id;
      if (kind === 'products' && pic !== undefined && id) {
        if (pic) await api.put(`/products/${id}/image`, { dataUrl: pic });
        else await api.del(`/products/${id}/image`);
        reloadProductImages();
      }
      setEdit(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete "${r[cfg.cols[0].key]}"?`)) return;
    try { await api.del(`/${kind}/${r[cfg.idKey]}`); reload(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{cfg.title}</h1>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" onClick={() => { setMsg(''); setPic(undefined); setEdit({ ...cfg.blank }); }}>Add</button>
      </div>
      <ErrorBox error={error || (!edit ? msg : '')} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr>{kind === 'products' && <th style={{ width: 56 }}>Picture</th>}{cfg.cols.map((c) => <th key={c.key} className={c.r ? 'r' : ''}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r[cfg.idKey]}>
                {kind === 'products' && <td>{imgs[r.ProdKey] ? <img className="row-thumb" src={imgs[r.ProdKey]} alt="" /> : <span className="row-thumb blank" />}</td>}
                {cfg.cols.map((c) => <td key={c.key} className={c.r ? 'r' : ''}>{r[c.key]}</td>)}
                <td className="r">
                  <button className="sm" onClick={() => { setMsg(''); setPic(undefined); setEdit({ ...r }); }}>Edit</button>{' '}
                  <button className="sm danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={cfg.cols.length + 2} className="muted">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit[cfg.idKey] ? `Edit ${cfg.title.toLowerCase()}` : `Add ${cfg.title.toLowerCase()}`} onClose={() => setEdit(null)}>
          <ErrorBox error={msg} />
          {kind === 'products' && (
            <div className="row" style={{ alignItems: 'center', gap: 14, marginBottom: 12 }}>
              {(() => {
                const shown = pic === undefined ? imgs[edit.ProdKey] : pic;
                return shown ? <img className="row-thumb big" src={shown} alt="" /> : <span className="row-thumb big blank">No picture</span>;
              })()}
              <label className="btn" style={{ cursor: 'pointer' }}>
                {(pic === undefined ? imgs[edit.ProdKey] : pic) ? 'Change picture' : 'Add picture'}
                <input type="file" accept="image/*" onChange={pickPic} style={{ display: 'none' }} />
              </label>
              {(pic === undefined ? imgs[edit.ProdKey] : pic) && <button type="button" onClick={() => setPic(null)}>Remove</button>}
              <span className="muted">Shown beside the item on the bill screens. Never printed. On a phone this can take a photo.</span>
            </div>
          )}
          <div className="form-grid">
            {cfg.cols.map((c) => (
              <Field key={c.key} label={c.label}>
                <input type={c.type || 'text'} step="any" value={edit[c.key] ?? ''} onChange={(e) => setEdit({ ...edit, [c.key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
