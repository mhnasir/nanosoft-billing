import { useEffect, useState } from 'react';
import { api, getAppName, setAppName, setBrand } from '../api';
import { ErrorBox, Field, useBrand, useLoad } from '../components';
import { KIND } from '../billkinds';
import { PAPERS, pageSize, type PrintCfg } from '../paper';

// The bill screens that have optional components (chits have none).
const SCREENS = ['B', 'S', 'F', 'L', 'C'];

type Item = { id: string; label: string };
type Group = { title: string; items: Item[] };

/** The components of a bill screen, in the order they appear under the item grid. */
function groupsOf(type: string): Group[] {
  const k = KIND[type];
  const g: Group[] = [];
  const extra: Item[] = [];
  if (k.commPct) extra.push({ id: 'commPct', label: 'COM % box (works out the commission)' });
  if (k.charges.length || extra.length) g.push({ title: k.chargesNote || 'Charges', items: [...extra, ...k.charges.map(([id, label]) => ({ id, label }))] });
  if (k.autos.length) g.push({ title: 'By-bag switches', items: k.autos.map(([id, label]) => ({ id, label })) });
  if (k.sides.length) g.push({ title: k.sidesNote || 'Other amounts', items: k.sides.map(([id, label]) => ({ id, label })) });
  return g;
}

export default function Settings() {
  const { data, error, reload } = useLoad<Record<string, { hidden: string[] }>>('/settings/bill-fields');
  const [type, setType] = useState('B');
  const [name, setName] = useState(getAppName());
  const [nameMsg, setNameMsg] = useState('');
  useEffect(() => { api.get('/settings/app').then((r) => setName(r.appName || ''), () => undefined); }, []);
  // menu layout default for everyone (a user can still switch their own screen with the button in the menu)
  type Pos = 'left' | 'top' | 'right';
  const [menu, setMenu] = useState<Pos>('left');
  const [menuMsg, setMenuMsg] = useState('');
  useEffect(() => { api.get('/settings/ui').then((r) => setMenu(r.menu === 'top' || r.menu === 'right' ? r.menu : 'left'), () => undefined); }, []);
  async function saveMenu(m: Pos) {
    setMenu(m);
    setMenuMsg('');
    try {
      await api.put('/settings/ui', { menu: m });
      window.dispatchEvent(new CustomEvent('nb-layout-default', { detail: m })); // switch this screen straight away
      setMenuMsg('Saved. Your menu has changed now; other people see it the next time they open the app (unless they picked their own position).');
    } catch (e) {
      setMenuMsg((e as Error).message);
    }
  }

  // printed bill: paper size, orientation, margin, font size
  const [pr, setPr] = useState<PrintCfg>({ paper: 'A4', orientation: 'portrait', margin: 10, fontSize: 13, width: 210, height: 297 });
  const [prMsg, setPrMsg] = useState('');
  useEffect(() => { api.get('/settings/print').then((r) => { if (r && r.paper) setPr((p) => ({ ...p, ...r })); }, () => undefined); }, []);
  const setP = (patch: Partial<PrintCfg>) => { setPr((p) => ({ ...p, ...patch })); setPrMsg(''); };
  async function savePrint() {
    setPrMsg('');
    try {
      const r = await api.put('/settings/print', pr);
      setPr(r);
      setPrMsg('Saved.');
    } catch (e) {
      setPrMsg((e as Error).message);
    }
  }
  const size = pageSize(pr);
  const sizeFree = pr.paper === 'Custom';
  const heightFree = sizeFree || (pr.paper || '').startsWith('Roll');

  // company logo: shown left of the company name; optionally on the printed bill
  const brandNow = useBrand();
  const [logoMsg, setLogoMsg] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still triggers
    if (!f) return;
    setLogoMsg('');
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { setLogoMsg('Choose a PNG, JPG, GIF or WebP picture.'); return; }
    if (f.size > 300 * 1024) { setLogoMsg(`That picture is ${Math.round(f.size / 1024)} KB. Please use one under 300 KB.`); return; }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(f); });
      setBrand(await api.put('/settings/logo', { dataUrl }));
      setLogoMsg('Logo saved.');
    } catch (err) {
      setLogoMsg((err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }
  async function removeLogo() {
    setLogoMsg('');
    try { setBrand(await api.del('/settings/logo')); setLogoMsg('Logo removed.'); } catch (err) { setLogoMsg((err as Error).message); }
  }
  async function setLogoOnPrint(on: boolean) {
    setLogoMsg('');
    try { setBrand(await api.put('/settings/logo-print', { on })); } catch (err) { setLogoMsg((err as Error).message); }
  }

  async function saveName() {
    setNameMsg('');
    try {
      const r = await api.put('/settings/app', { appName: name });
      setAppName(r.appName);
      setNameMsg('Saved.');
    } catch (e) {
      setNameMsg((e as Error).message);
    }
  }
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setHidden(Object.fromEntries(SCREENS.map((t) => [t, data[t]?.hidden || []])));
  }, [data]);

  const off = (t: string, id: string) => (hidden[t] || []).includes(id);
  const toggle = (t: string, id: string) => {
    setMsg('');
    setHidden((h) => ({ ...h, [t]: off(t, id) ? h[t].filter((x) => x !== id) : [...(h[t] || []), id] }));
  };
  const setAll = (t: string, on: boolean) => {
    setMsg('');
    const all = groupsOf(t).flatMap((g) => g.items.map((i) => i.id));
    setHidden((h) => ({ ...h, [t]: on ? [] : all }));
  };

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await api.put('/settings/bill-fields', { settings: Object.fromEntries(SCREENS.map((t) => [t, { hidden: hidden[t] || [] }])) });
      setMsg('Saved. Open bill screens pick this up when they are next opened.');
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const groups = groupsOf(type);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Settings</h1>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>
      <div className="card row" style={{ alignItems: 'end' }}>
        <Field label="Company name (shown in the menu, the browser tab and the login page)" className="grow">
          <input value={name} maxLength={60} placeholder="NanoSoft Billing" onChange={(e) => { setName(e.target.value); setNameMsg(''); }} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
        </Field>
        <button onClick={saveName}>Save name</button>
        {nameMsg && <span className={nameMsg === 'Saved.' ? 'ok' : 'muted'}>{nameMsg}</span>}
      </div>
      <div className="card">
        <strong>Company logo</strong>
        <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 14 }}>
          <div style={{ width: 120, height: 70, display: 'grid', placeItems: 'center', border: '1px dashed var(--line)', borderRadius: 8, background: 'var(--bg)' }}>
            {brandNow.logo ? <img src={brandNow.logo} alt="Company logo" style={{ maxWidth: 110, maxHeight: 60, objectFit: 'contain' }} /> : <span className="muted">No logo</span>}
          </div>
          <label className="btn" style={{ cursor: logoBusy ? 'wait' : 'pointer' }}>
            {logoBusy ? 'Uploading…' : brandNow.logo ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onLogoFile} disabled={logoBusy} style={{ display: 'none' }} />
          </label>
          {brandNow.logo && <button onClick={removeLogo}>Remove</button>}
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={brandNow.logoOnPrint} onChange={(e) => setLogoOnPrint(e.target.checked)} /> Show the logo on printed bills
          </label>
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          PNG, JPG, GIF or WebP, up to 300 KB. A wide or square picture about 300 px across works best. It appears to the left of the company name in the menu and on the login page,
          and on the printed bill and PDF while the box above is ticked (it is ticked by default).
          {logoMsg && <> <b className={/saved|removed/i.test(logoMsg) ? 'ok' : ''}>{logoMsg}</b></>}
        </p>
      </div>
      <div className="card">
        <strong>Menu layout</strong>
        <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Menu layout">
            <button type="button" className={menu === 'left' ? 'on' : ''} onClick={() => saveMenu('left')}>Left menu</button>
            <button type="button" className={menu === 'top' ? 'on' : ''} onClick={() => saveMenu('top')}>Top menu</button>
            <button type="button" className={menu === 'right' ? 'on' : ''} onClick={() => saveMenu('right')}>Right menu</button>
          </div>
          <span className="muted grow">The default for everyone. Each person can also switch their own screen with the Left | Top | Right switch at the top of the menu. Phones always use the slide-out menu.</span>
        </div>
        {menuMsg && <p className={menuMsg.startsWith('Saved') ? 'ok' : 'muted'} style={{ marginBottom: 0 }}>{menuMsg}</p>}
      </div>
      <div className="card">
        <strong>Printed bill (paper)</strong>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <Field label="Paper">
            <select value={pr.paper || 'A4'} onChange={(e) => setP({ paper: e.target.value })}>
              {PAPERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
          <Field label="Width (mm)"><input className="num" inputMode="decimal" disabled={!sizeFree} value={sizeFree ? pr.width ?? '' : PAPERS.find(([k]) => k === pr.paper)?.[2] ?? ''} onChange={(e) => setP({ width: Number(e.target.value) })} /></Field>
          <Field label="Height (mm)"><input className="num" inputMode="decimal" disabled={!heightFree} value={heightFree ? pr.height ?? '' : PAPERS.find(([k]) => k === pr.paper)?.[3] ?? ''} onChange={(e) => setP({ height: Number(e.target.value) })} /></Field>
          <Field label="Layout">
            <select value={pr.orientation || 'portrait'} onChange={(e) => setP({ orientation: e.target.value as 'portrait' | 'landscape' })}>
              <option value="portrait">Portrait (tall)</option>
              <option value="landscape">Landscape (wide)</option>
            </select>
          </Field>
          <Field label="Margin (mm)"><input className="num" inputMode="decimal" value={pr.margin ?? 10} onChange={(e) => setP({ margin: Number(e.target.value) })} /></Field>
          <Field label="Text size (px)"><input className="num" inputMode="decimal" value={pr.fontSize ?? 13} onChange={(e) => setP({ fontSize: Number(e.target.value) })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
          <span className="muted grow">Page = {size.w} × {size.h} mm {pr.orientation === 'landscape' ? 'landscape' : 'portrait'}. In the print window choose the same paper, or &quot;Save as PDF&quot;. It applies to every bill print.</span>
          <button onClick={savePrint}>Save paper settings</button>
          {prMsg && <span className={prMsg === 'Saved.' ? 'ok' : 'muted'}>{prMsg}</span>}
        </div>
      </div>
      <ErrorBox error={error || (msg.startsWith('Saved') ? '' : msg)} />
      {msg.startsWith('Saved') && <p className="ok">{msg}</p>}
      <p className="muted" style={{ marginTop: 0 }}>
        Choose which boxes appear under the item grid on each bill screen. A ticked box is shown; untick the ones this business never uses and they disappear for everyone.
        A saved bill that already has a value in an unticked box still shows it. This applies on top of each customer&apos;s own &quot;Charges on bill screen&quot; setting.
      </p>
      <div className="tabs">
        {SCREENS.map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{KIND[t].title}</button>)}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong className="grow">{KIND[type].title}</strong>
          <button className="sm" onClick={() => setAll(type, true)}>Tick all</button>
          <button className="sm" onClick={() => setAll(type, false)}>Untick all</button>
        </div>
        {groups.map((g) => (
          <div key={g.title} style={{ marginBottom: 12 }}>
            <div className="muted" style={{ marginBottom: 4 }}>{g.title}</div>
            <div className="form-grid">
              {g.items.map((i) => (
                <label key={i.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={!off(type, i.id)} onChange={() => toggle(type, i.id)} /> {i.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
