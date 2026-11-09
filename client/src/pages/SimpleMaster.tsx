import { useState } from 'react';
import { api, qs, type Row } from '../api';
import { ErrorBox, Field, Modal, reloadProductImages, useLoad, useProductImages } from '../components';
import { shrinkToJpeg } from '../image';
import PictureCropper from '../PictureCropper';

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
  const [picSrc, setPicSrc] = useState<string | undefined>(undefined); // the larger original of a staged picture, kept so it can be re-cropped later
  // the enlarge / crop screen: keepSrc = the picture is a real original worth keeping; row = opened from the list (saved straight away)
  const [crop, setCrop] = useState<{ src: string; keepSrc: boolean; row?: Row; title: string } | null>(null);
  async function pickPic(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg('');
    try { setCrop({ src: await shrinkToJpeg(f, 640), keepSrc: true, title: edit?.ProdName || 'new item' }); } catch (err) { setMsg((err as Error).message); }
  }
  /** Click a picture to enlarge it: the stored original if there is one, else the small picture. */
  async function openCrop(row: Row) {
    setMsg('');
    try {
      const r = await api.get(`/products/${row.ProdKey}/image-source`);
      setCrop({ src: r.dataUrl, keepSrc: !!r.original, row, title: row.ProdName });
    } catch (err) { setMsg((err as Error).message); }
  }
  async function openCropInForm() {
    if (!edit) return;
    const title = edit.ProdName || 'item';
    if (pic && picSrc) setCrop({ src: picSrc, keepSrc: true, title });
    else if (pic) setCrop({ src: pic, keepSrc: false, title });
    else if (edit.ProdKey) { // the stored picture: changes are kept until the form is saved
      try {
        const r = await api.get(`/products/${edit.ProdKey}/image-source`);
        setCrop({ src: r.dataUrl, keepSrc: !!r.original, title });
      } catch (err) { setMsg((err as Error).message); }
    }
  }
  async function cropSaved(thumb: string) {
    const c = crop;
    if (!c) return;
    setCrop(null);
    if (c.row) { // opened from the list: save it for the item right away
      try {
        await api.put(`/products/${c.row.ProdKey}/image`, { dataUrl: thumb, source: c.keepSrc ? c.src : undefined });
        reloadProductImages();
      } catch (err) { setMsg((err as Error).message); }
    } else { // opened from the item form: kept until the form is saved
      setPic(thumb);
      setPicSrc(c.keepSrc ? c.src : undefined);
    }
  }
  async function cropRemoved() {
    const c = crop;
    setCrop(null);
    if (c?.row) {
      try { await api.del(`/products/${c.row.ProdKey}/image`); reloadProductImages(); } catch (err) { setMsg((err as Error).message); }
    } else { setPic(null); setPicSrc(undefined); }
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
        if (pic) await api.put(`/products/${id}/image`, { dataUrl: pic, source: picSrc });
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
        <button className="primary" onClick={() => { setMsg(''); setPic(undefined); setPicSrc(undefined); setEdit({ ...cfg.blank }); }}>Add</button>
      </div>
      <ErrorBox error={error || (!edit ? msg : '')} />
      <div className="tablewrap">
        <table className="stack">
          <thead><tr>{kind === 'products' && <th style={{ width: 56 }}>Picture</th>}{cfg.cols.map((c) => <th key={c.key} className={c.r ? 'r' : ''}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r[cfg.idKey]}>
                {kind === 'products' && <td>{imgs[r.ProdKey] ? <img className="row-thumb zoomable" src={imgs[r.ProdKey]} alt="" title="Click to enlarge and crop" onClick={() => openCrop(r)} /> : <span className="row-thumb blank" />}</td>}
                {cfg.cols.map((c) => <td key={c.key} className={c.r ? 'r' : ''}>{r[c.key]}</td>)}
                <td className="r">
                  <button className="sm" onClick={() => { setMsg(''); setPic(undefined); setPicSrc(undefined); setEdit({ ...r }); }}>Edit</button>{' '}
                  <button className="sm danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={cfg.cols.length + 2} className="muted">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
      {crop && <PictureCropper src={crop.src} title={crop.title} onSave={cropSaved} onCancel={() => setCrop(null)} onRemove={cropRemoved} saveLabel={crop.row ? 'Save picture' : 'Use this picture'} />}
      {edit && !crop && (
        <Modal title={edit[cfg.idKey] ? `Edit ${cfg.title.toLowerCase()}` : `Add ${cfg.title.toLowerCase()}`} onClose={() => setEdit(null)}>
          <ErrorBox error={msg} />
          {kind === 'products' && (
            <div className="row" style={{ alignItems: 'center', gap: 14, marginBottom: 12 }}>
              {(() => {
                const shown = pic === undefined ? imgs[edit.ProdKey] : pic;
                return shown ? <img className="row-thumb big zoomable" src={shown} alt="" title="Click to enlarge and crop" onClick={openCropInForm} /> : <span className="row-thumb big blank">No picture</span>;
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
