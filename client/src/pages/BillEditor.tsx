import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, dateOnly, fmt, r2, rupeesInWords, todayISO, userKey, type Row } from '../api';
import { ErrorBox, Field, Picker, useLoad, useProductImages } from '../components';
import { AMT_COL, KIND } from '../billkinds';
import BagWeights from '../BagWeights';
import SubSplit, { subAmt, type Sub } from '../SubSplit';

// wts = the per-bag weights as the old app kept them ("55,65,55"); when set, bags = count and weight = sum.
// subs = the sub-customer parts of a patiyal line (bags / weight / rate each); when set the line is the sum of its parts.
type Line = { prodKey: number; qty: string; unit: string; nop: string; rate: string; marks: string; wts: string; subs: Sub[] };
const blankLine = (): Line => ({ prodKey: 0, qty: '', unit: 'Kgs', nop: '', rate: '', marks: '', wts: '', subs: [] });
const focusId = (id: string) => setTimeout(() => { const el = document.getElementById(id) as HTMLInputElement | null; el?.focus(); el?.select?.(); }, 30);
// Enter walks these boxes in page order (header boxes, then the amounts under the lines).
const focusNext = (from: HTMLElement) => {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => !(e as HTMLInputElement).disabled && !(e as HTMLInputElement).readOnly && e.offsetParent !== null);
  const k = all.indexOf(from);
  (all[k + 1] ?? document.getElementById('save-btn'))?.focus();
  (all[k + 1] as HTMLInputElement | undefined)?.select?.();
};


export default function BillEditor() {
  const { type = 'B', id } = useParams();
  const nav = useNavigate();
  const isNew = !id;
  const kind = KIND[type];
  const ADDS = kind?.charges || [];
  const LESS = kind?.sides || [];

  const parties = useLoad<Row[]>(kind ? `/parties?limit=2000` : null);
  const products = useLoad<Row[]>('/products');
  const existing = useLoad<Row>(id ? `/bills/${id}` : null);

  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [supKey, setSupKey] = useState(0);
  const [lotNo, setLotNo] = useState('');
  const [amts, setAmts] = useState<Record<string, string>>({});
  const [othersAddStr, setAddStr] = useState('');
  const [othersLessStr, setLessStr] = useState('');
  const [cashAmt, setCash] = useState('');
  // On a cash bill the cash is normally the full bill total: it follows the total until the user types a different amount.
  const [cashManual, setCashManual] = useState(false);
  // Credit bill = nothing is received / paid with it, so the cash box is switched off. Each user's last choice is the default for every bill.
  const payKey = `nvs.payMode.${userKey()}`;
  const [payMode, setPayMode] = useState<'credit' | 'cash'>(() => { try { return localStorage.getItem(payKey) === 'credit' ? 'credit' : 'cash'; } catch { return 'cash'; } });
  const choosePay = (m: 'credit' | 'cash') => { setPayMode(m); setCashManual(false); try { localStorage.setItem(payKey, m); } catch { /* storage blocked: still works this session */ } };
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [nonBal, setNonBal] = useState(false);
  const [prevSaved, setPrevSaved] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // how weights are entered on Kgs lines: a bag-by-bag popup, or typed straight into Bags / Weight. Remembered on this device.
  const [wMode, setWMode] = useState<'popup' | 'direct'>(() => { try { return localStorage.getItem('nvs.weightMode') === 'direct' ? 'direct' : 'popup'; } catch { return 'popup'; } });
  const chooseMode = (m: 'popup' | 'direct') => { setWMode(m); try { localStorage.setItem('nvs.weightMode', m); } catch { /* storage blocked: still works this session */ } };
  // the added-charges section (commission, cooly ...) follows the customer's setting; the button flips it for this bill
  const [showCharges, setShowCharges] = useState(true);
  const [wtLine, setWtLine] = useState<number | null>(null); // line whose bag weights are being entered
  const [splitLine, setSplitLine] = useState<number | null>(null); // patiyal line whose sub-customers are being entered
  const [comPct, setComPct] = useState(''); // commission as a % of the items total (farmer / patiyal bills)
  const [refBill, setRefBill] = useState(0); // farmer commission bill: the purchase bill (chitta) it settles
  const chittas = useLoad<Row[]>(kind?.chitta && supKey ? `/bills?type=S&supKey=${supKey}` : null);
  const imgs = useProductImages(); // item pictures: shown beside the item here, never printed
  const fieldSettings = useLoad<Record<string, { hidden?: string[] }>>(kind ? '/settings/bill-fields' : null); // components switched off in Settings

  const partyOpts = useMemo(() => (parties.data || []).map((p): Row => ({ ...p, __id: p.SupKey })).sort((x, y) => Number(y.SupType === kind?.partyType) - Number(x.SupType === kind?.partyType)), [parties.data, kind]);
  const prodOpts = useMemo(() => (products.data || []).map((p) => ({ ...p, __id: p.ProdKey })), [products.data]);

  // Load existing bill into the form
  useEffect(() => {
    const b = existing.data;
    if (!b) return;
    setBillNo(String(b.BillNo ?? ''));
    setBillDate(dateOnly(b.BillDate));
    setSupKey(b.SupKey);
    setLotNo(b.LotNo || '');
    setAddStr(b.OthersAddStr || '');
    setLessStr(b.OthersLessStr || '');
    setCash(String(b.CashAmt ?? ''));
    setCashManual(true); // a saved bill keeps its own cash figure
    setPayMode(Number(b.CashAmt) > 0 ? 'cash' : 'credit'); // a saved bill shows how it was settled; this does not change the user's default
    const a: Record<string, string> = {};
    for (const [k, col] of Object.entries(AMT_COL)) a[k] = b[col] ? String(b[col]) : '';
    setAmts(a);
    setAuto({ autoBasket: b.AutoBasket === 'Yes', autoCooly: b.AutoCooly === 'Yes', autoGunny: b.AutoGunny === 'Yes' });
    setPrevSaved(Number(b.BalAmt) || 0);
    setNonBal(!!b.NonBalance);
    setRefBill(Number(b.RefBillKey) || 0);
    setLines(
      (b.lines as Row[]).map((l) => {
        // keep the saved bag weights only when they still agree with the bag count and weight
        const parts = String(l.WeightTxt || '').split(',').map((s) => s.trim()).filter(Boolean);
        const sum = parts.reduce((s, x) => s + (Number(x) || 0), 0);
        const ok = parts.length > 0 && parts.length === Number(l.Nop) && Math.abs(sum - Number(l.Qty)) < 0.01;
        const subs: Sub[] = ((l.Subs as Row[]) || []).map((x) => ({ supKey: x.SupKey, nop: x.Nop ? String(x.Nop) : '', qty: x.Qty ? String(x.Qty) : '', rate: String(x.Rate), remarks: x.Remarks || '' }));
        return { prodKey: l.ProdKey, qty: String(l.Qty), unit: l.Unit || 'Kgs', nop: l.Nop ? String(l.Nop) : '', rate: String(l.Rate), marks: l.Marks || '', wts: ok ? parts.join(',') : '', subs };
      }),
    );
  }, [existing.data]);

  // Suggest next bill number for new bills
  useEffect(() => {
    if (!isNew || !kind) return;
    api.get(`/bills/next-no?type=${type}&date=${billDate}`).then((r) => setBillNo(String(r.billNo)), () => undefined);
  }, [isNew, type, billDate]);

  useEffect(() => {
    const pr = (parties.data || []).find((p) => p.SupKey === supKey);
    if (!pr) return;
    const eb = existing.data;
    const used = !!eb && (ADDS.some(([k]) => Number(eb[AMT_COL[k]]) > 0) || eb.AutoBasket === 'Yes' || eb.AutoCooly === 'Yes' || eb.AutoGunny === 'Yes');
    setShowCharges(pr.ShowCharges !== 0 || used); // a saved bill that has charges always shows them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey, parties.data, existing.data]);

  // a new bill opens with the cursor on the customer box
  useEffect(() => { if (isNew) focusId('party-box'); }, [isNew, type]);

  if (!kind) return <Navigate to="/bills/B" />;

  const n = (v: string) => Number(v) || 0;
  const isKgs = (u: string) => /^kg/i.test(u.trim());
  // Same rule as the VB grid: Kgs lines are weight x rate, other units are bags x rate, rounded to whole rupees.
  const whole = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
  const lineAmt = (l: Line) => (kind.chit ? 0 : l.subs.length ? l.subs.reduce((s, x) => s + subAmt(isKgs(l.unit), x), 0) : whole(isKgs(l.unit) ? n(l.qty) * n(l.rate) : n(l.nop) * n(l.rate)));
  const billAmt = r2(lines.reduce((s, l) => s + lineAmt(l), 0));
  const weight = r2(lines.reduce((s, l) => s + n(l.qty), 0));
  const bags = r2(lines.reduce((s, l) => s + n(l.nop), 0));
  // The "by bag" switches fill an amount from the product's rate per bag.
  const prodBy = new Map((products.data || []).map((p) => [p.ProdKey, p]));
  const autoAmt = (col: string) => r2(lines.reduce((s, l) => s + n(l.nop) * n(prodBy.get(l.prodKey)?.[col]), 0));
  // A box switched off in Settings is not shown - unless it already holds a value, which must never be hidden.
  const hid: string[] = fieldSettings.data?.[type]?.hidden || [];
  const amtShown = (k: string) => !hid.includes(k) || n(amts[k] || '') > 0;
  const autoShown = (flag: string) => !hid.includes(flag) || !!auto[flag];
  const comShown = !hid.includes('commPct') || n(comPct) > 0;
  const pctOn = (k: string) => !!kind.commPct && k === 'commissionAmt' && n(comPct) > 0;
  const eff = (k: string) => {
    if (pctOn(k)) return r2((billAmt * n(comPct)) / 100);
    const a = kind.autos.find(([flag, , fills]) => auto[flag] && fills === k);
    return a ? autoAmt(a[3]) : n(amts[k] || '');
  };
  const adds = r2(ADDS.reduce((s, [k]) => s + eff(k), 0));
  const less = r2(LESS.reduce((s, [k]) => s + eff(k), 0));
  const gross = r2(kind.chargesSign === 1 ? billAmt + adds - less : billAmt + less - adds);
  const party: Row | undefined = partyOpts.find((p) => p.__id === supKey);
  // Balance before this bill: a new bill uses the party's current balance, a saved one the figure stored with it.
  const prev = nonBal || kind.doc ? 0 : r2(isNew || prevSaved === null ? Number(party?.Balance) || 0 : prevSaved);
  const credit = payMode === 'credit';
  const cashEff = credit ? 0 : cashManual ? n(cashAmt) : gross; // a credit bill carries no cash; a cash bill defaults to the full total
  const cashShown = credit ? '' : cashManual ? cashAmt : gross ? String(gross) : '';
  const balance = r2(type === 'B' ? prev + gross - cashEff : gross - prev - cashEff);

  const canSave = !!supKey && (kind.chit ? bags > 0 : billAmt > 0);
  const custOpts = (parties.data || []).map((p): Row => ({ ...p, __id: p.SupKey })).sort((x, y) => Number(y.SupType === 'C') - Number(x.SupType === 'C'));
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // ---- keyboard flow (like the VB grid): Enter = next box, item -> bag weights -> rate -> next line ----
  const afterItem = (i: number, unit: string) => {
    if (kind.chit) focusId(`ln-${i}-bags`); // chits: items and bags only
    else if (kind.split) setSplitLine(i); // patiyal: who bought it
    else if (isKgs(unit) && wMode === 'popup') setWtLine(i);
    else focusId(`ln-${i}-bags`);
  };
  const nextLine = (i: number) => {
    if (i >= lines.length - 1) { setLines((ls) => [...ls, blankLine()]); }
    focusId(`ln-${i + 1}-item`);
  };
  const toAmounts = () => (document.querySelector('[data-nav="f"]') as HTMLElement | null)?.focus();
  function onKeys(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === 's') { e.preventDefault(); if (!saving && canSave) save(); return; }
    const m = /^ln-(\d+)-(\w+)$/.exec(t.id || '');
    const i = m ? Number(m[1]) : -1;
    if (m && e.ctrlKey && key === 'd') { e.preventDefault(); setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()])); focusId(`ln-${Math.max(0, i - 1)}-item`); return; }
    if (m && e.key === 'F2' && !kind.chit && !kind.split) { e.preventDefault(); setWtLine(i); return; }
    if (m && e.key === 'F3' && kind.split) { e.preventDefault(); setSplitLine(i); return; }
    if (m && e.key === 'F1' && m[2] === 'item' && i > 0 && lines[i - 1].prodKey) { // repeat the item above
      e.preventDefault();
      const above = prodBy.get(lines[i - 1].prodKey);
      if (above) { setLine(i, { prodKey: above.ProdKey, unit: lines[i - 1].unit, rate: lines[i - 1].rate }); afterItem(i, lines[i - 1].unit); }
      return;
    }
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (m) {
      e.preventDefault();
      const f = m[2];
      if (f === 'item') {
        if (lines[i].prodKey) afterItem(i, lines[i].unit);
        else if (i > 0 && i === lines.length - 1) toAmounts(); // empty last line: done with items
      } else if (f === 'bags') focusId(kind.chit ? `ln-${i}-marks` : isKgs(lines[i].unit) && !lines[i].wts && !lines[i].subs.length ? `ln-${i}-weight` : `ln-${i}-rate`);
      else if (f === 'weight' || f === 'unit') focusId(`ln-${i}-rate`);
      else if (f === 'rate') { if (lines[i].prodKey) focusId(`ln-${i}-marks`); }
      else if (f === 'marks') { if (lines[i].prodKey) nextLine(i); }
      return;
    }
    if (t.dataset.nav === 'h') { e.preventDefault(); focusNext(t); }
    else if (t.dataset.nav === 'f') {
      e.preventDefault();
      // an empty amount box on Enter jumps to Cash; Enter on Cash goes to Save and print
      if (t.id !== 'cash-box' && !(t as HTMLInputElement).value.trim()) focusId(credit ? 'save-btn' : 'cash-box'); else focusNext(t);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        nonBalance: nonBal, billType: type, billNo: n(billNo) || undefined, billDate, supKey, lotNo, othersAddStr, othersLessStr, cashAmt: cashEff,
        refBillKey: refBill,
        ...Object.fromEntries(Object.entries(amts).map(([k, v]) => [k, n(v)])),
        ...(pctOn('commissionAmt') ? { commissionAmt: eff('commissionAmt') } : {}),
        autoBasket: !!auto.autoBasket, autoCooly: !!auto.autoCooly, autoGunny: !!auto.autoGunny,
        lines: lines.filter((l) => l.prodKey).map(({ wts, subs, ...l }) => ({
          ...l, weightTxt: wts, qty: n(l.qty), nop: n(l.nop), rate: n(l.rate),
          subs: subs.map((s) => ({ supKey: s.supKey, nop: n(s.nop), qty: n(s.qty), rate: n(s.rate), remarks: s.remarks })),
        })),
      };
      const r = isNew ? await api.post('/bills', body) : await api.put(`/bills/${id}`, body);
      nav(`/bills/${type}/${r.billKey}/print`);
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0 });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(kind.doc ? 'Delete this document?' : 'Delete this bill? The ledger entry is removed too.')) return;
    try { await api.del(`/bills/${id}`); nav(`/bills/${type}`); } catch (e) { setError((e as Error).message); }
  }

  const loading = parties.loading || products.loading || (!isNew && existing.loading);
  return (
    <div className="bill-screen" onKeyDown={onKeys}>
      <div className={`row bs-title tint ${["S", "F", "L", "C"].includes(type) ? "is-purchase" : "is-sales"}`} style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{isNew ? 'New' : 'Edit'} {kind.one}</h1>
        {!kind.chit && (
          <div className="seg" role="group" aria-label="Bill type" title="Credit bill: nothing received or paid with it. Cash bill: enter the cash. Your choice is remembered as your default.">
            <button type="button" tabIndex={-1} className={credit ? 'on' : ''} onClick={() => choosePay('credit')}>Credit</button>
            <button type="button" tabIndex={-1} className={!credit ? 'on' : ''} onClick={() => choosePay('cash')}>Cash</button>
          </div>
        )}
        <Link className="btn" to={`/bills/${type}`}>Back to list</Link>
      </div>
      <ErrorBox error={error || parties.error || products.error || existing.error} />
      {loading && <p className="muted">Loading…</p>}
      <div className="card bs-head">
        <div className="row">
          <Field label="Bill no"><input data-nav="h" className="num" style={{ width: 90 }} value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
          <Field label="Date"><input data-nav="h" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          <Field label={kind.party} className="grow">
            <Picker id="parties" inputId="party-box" onPick={() => (kind.lot ? focusId('lot-no') : focusId('ln-0-item'))} options={partyOpts} value={supKey} onChange={(k) => setSupKey(k)} labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)} placeholder="Type to search…" />
          </Field>
          {kind.lot && <Field label={kind.chit ? 'Lot / name' : 'Lot no'}><input id="lot-no" data-nav="h" style={{ width: 110 }} value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field>}
          {kind.chitta && (
            <Field label="Purchase bill (chitta)">
              <select data-nav="h" value={refBill} onChange={(e) => { const v = Number(e.target.value); setRefBill(v); const c = (chittas.data || []).find((x) => x.BillKey === v); if (c?.LotNo && !lotNo) setLotNo(c.LotNo); }} style={{ minWidth: 170 }}>
                <option value={0}>{supKey ? '(none)' : 'pick the farmer first'}</option>
                {(chittas.data || []).map((c) => <option key={c.BillKey} value={c.BillKey}>{`No ${c.BillNo} · ${dateOnly(c.BillDate)}${c.LotNo ? ` · ${c.LotNo}` : ''}`}</option>)}
              </select>
            </Field>
          )}
        </div>
      </div>

      <div className="card bs-lines" style={{ padding: 0 }}>
        {!kind.chit && !kind.split && <div className="row bs-bar" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>Weight entry
            <select value={wMode} onChange={(e) => chooseMode(e.target.value as 'popup' | 'direct')} title="Remembered on this computer">
              <option value="popup">Bag-by-bag popup</option>
              <option value="direct">Direct (type bags and weight)</option>
            </select>
          </label>
          <span className="muted">F2 on a line always opens the bag list.</span>
        </div>}
        <div className="tablewrap" style={{ border: 0 }}>
          <table className="lines sheet">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th><th style={{ width: 54 }}>Pic</th><th>Item</th><th className="r" style={{ width: 90 }}>Bags</th>
                {!kind.chit && <><th className="r" style={{ width: 110 }}>Weight</th><th style={{ width: 80 }}>Unit</th><th className="r" style={{ width: 110 }}>Rate</th></>}
                <th>Mark</th>{!kind.chit && <th className="r" style={{ width: 120 }}>Amount</th>}<th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="muted c-no" data-label="Line">{i + 1}</td>
                  <td className="c-pic" data-label="Pic">{imgs[l.prodKey] ? <img className="line-thumb" src={imgs[l.prodKey]} alt="" /> : <span className="line-thumb blank" />}</td>
                  <td className="c-item" data-label="Item">
                    <Picker
                      id={`prod${i}`} inputId={`ln-${i}-item`} thumbOf={(p) => imgs[p.ProdKey]} onPick={(row) => afterItem(i, row.Unit || 'Kgs')} options={prodOpts} value={l.prodKey} placeholder="Item…"
                      labelOf={(p) => p.ProdName + (p.BrandName ? ` (${p.BrandName})` : '')}
                      onChange={(k, row) => setLine(i, row ? { prodKey: k, unit: kind.chit ? 'Nop' : row.Unit || 'Kgs', rate: l.rate || (row.CurPrice ? String(row.CurPrice) : '') } : { prodKey: 0 })}
                    />
                  </td>
                  <td data-label="Bags"><input id={`ln-${i}-bags`} className="num" inputMode="decimal" readOnly={!!l.wts || !!l.subs.length} value={l.nop} onChange={(e) => setLine(i, { nop: e.target.value })} /></td>
                  {!kind.chit && <>
                    <td data-label="Weight">
                      <div className="weight-cell">
                        <input id={`ln-${i}-weight`} className="num" inputMode="decimal" readOnly={!!l.wts || !!l.subs.length} title={l.wts ? `Bags: ${l.wts}` : ''} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                        {kind.split
                          ? <button type="button" className="sm" tabIndex={-1} title="Who bought it: sub-customers (F3)" onClick={() => setSplitLine(i)}>{l.subs.length ? `👥${l.subs.length}` : '👥'}</button>
                          : isKgs(l.unit) && <button type="button" className="sm" tabIndex={-1} title="Enter each bag's weight (F2)" onClick={() => setWtLine(i)}>⚖</button>}
                      </div>
                    </td>
                    <td data-label="Unit"><select id={`ln-${i}-unit`} value={isKgs(l.unit) ? 'Kgs' : 'Nop'} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: '100%' }}><option>Kgs</option><option>Nop</option></select></td>
                    <td data-label="Rate">
                      <input id={`ln-${i}-rate`} className="num" inputMode="decimal" readOnly={!!l.subs.length} title={l.subs.length ? 'Average of the sub-customer rates' : ''} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                    </td>
                  </>}
                  <td data-label="Mark"><input id={`ln-${i}-marks`} value={l.marks} onChange={(e) => setLine(i, { marks: e.target.value })} style={{ width: '100%' }} /></td>
                  {!kind.chit && <td className="r c-amt" data-label="Amount">{fmt(lineAmt(l))}</td>}
                  <td className="c-del"><button className="sm danger" title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bs-foot" style={{ padding: 12 }}><button onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add line</button> <span className="muted">Enter = next box · Enter on mark = next line · F1 = repeat item above · {kind.split ? 'F3 = sub-customers' : kind.chit ? '' : 'F2 = bag weights'} · Ctrl+D = delete line · Ctrl+S = save</span></div>
      </div>

      {kind.chit && <div className="card bs-bottom"><strong>{bags}</strong> bags in {lines.filter((l) => l.prodKey).length} items. <span className="muted">A chit has no amounts and does not touch the ledger.</span></div>}
      {!kind.chit && <div className="card bs-bottom">
        <div className="row" style={{ alignItems: 'start' }}>
          <div className="grow" style={{ flex: '2 1 380px' }}>
            <div className="row" style={{ marginBottom: 4, alignItems: 'center' }}>
              <span className="muted">{kind.chargesNote}</span>
              <button type="button" className="sm" tabIndex={-1} onClick={() => setShowCharges((v) => !v)} title="Show or hide the charges boxes for this bill (the customer's saved setting is in Customers)">{showCharges ? 'Charges: shown' : 'Charges: hidden'}</button>
              {!showCharges && adds > 0 && <span className="muted">({fmt(adds)} added)</span>}
            </div>
            {showCharges && <div className="form-grid">
              {kind.commPct && comShown && <Field label="COM % (of items total)"><input data-nav="f" className="num" inputMode="decimal" value={comPct} onChange={(e) => setComPct(e.target.value)} /></Field>}
              {ADDS.filter(([k]) => amtShown(k)).map(([k, label]) => {
                const a = kind.autos.find(([, , fills]) => fills === k);
                const on = !!(a && auto[a[0]]) || pctOn(k);
                return (
                  <Field key={k} label={label}>
                    <input data-nav="f" className="num" inputMode="decimal" readOnly={on} value={on ? String(eff(k)) : amts[k] || ''} onChange={(e) => setAmts({ ...amts, [k]: e.target.value })} />
                  </Field>
                );
              })}
            </div>}
            <div className="row" style={{ margin: '8px 0' }}>
              {!kind.doc && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={nonBal} onChange={(e) => setNonBal(e.target.checked)} /> Non-balance bill (no previous balance)</label>}
              {showCharges && kind.autos.filter(([flag]) => autoShown(flag)).map(([flag, label]) => (
                <label key={flag} className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!auto[flag]} onChange={(e) => setAuto({ ...auto, [flag]: e.target.checked })} /> {label}</label>
              ))}
            </div>
            <div className="muted" style={{ margin: '8px 0 4px' }}>{kind.sidesNote}</div>
            <div className="form-grid">
              {LESS.filter(([k]) => amtShown(k)).map(([k, label]) => (
                <Field key={k} label={label}><input data-nav="f" className="num" inputMode="decimal" value={amts[k] || ''} onChange={(e) => setAmts({ ...amts, [k]: e.target.value })} /></Field>
              ))}
              {amtShown('othersAddAmt') && <Field label="Others note"><input data-nav="f" value={othersAddStr} onChange={(e) => setAddStr(e.target.value)} /></Field>}
              {amtShown('othersLessAmt') && <Field label="Others (taken off / added) note"><input data-nav="f" value={othersLessStr} onChange={(e) => setLessStr(e.target.value)} /></Field>}
            </div>
          </div>
          <div className="totals" style={{ flex: '1 1 300px' }}>
            <div><span>Total weight / bags</span><span>{weight} / {bags}</span></div>
            <div><span>Items total</span><span>{fmt(billAmt)}</span></div>
            <div><span>{kind.chargesSign === 1 ? 'Charges' : 'Deductions'}</span><span>{fmt(adds)}</span></div>
            <div><span>{kind.chargesSign === 1 ? 'Less' : 'Added'}</span><span>{fmt(less)}</span></div>
            <div className="big"><span>Bill total</span><span className={type === 'B' ? 'due' : ''}>{fmt(gross)}</span></div>
            {!kind.doc && <div><span>Previous balance</span><span className={type === 'B' && prev > 0 ? 'due' : ''}>{fmt(prev)}</span></div>}
            <div style={{ alignItems: 'center' }}><span>{kind.cash}</span><input id="cash-box" data-nav="f" className={`num ${type === 'B' && cashEff > 0 ? 'got' : ''}`} style={{ width: 120 }} inputMode="decimal" disabled={credit} title={credit ? 'Credit bill: switch to Cash to enter an amount' : ''} value={cashShown} onChange={(e) => { setCash(e.target.value); setCashManual(true); }} /></div>
            <div className="big"><span>{kind.doc ? 'Net payable' : 'Net balance'}</span><span className={type === 'B' && balance > 0 ? 'due' : ''}>{fmt(balance)}</span></div>
            <div className="muted" style={{ fontSize: '.8rem' }}>{rupeesInWords(gross)}</div>
          </div>
        </div>
      </div>}

      <div className="row actionbar bs-actions" style={{ justifyContent: 'flex-end' }}>
        {!isNew && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete bill</button>}
        <button id="save-btn" className="primary" onClick={save} disabled={saving || !canSave}>{saving ? 'Saving…' : 'Save and print'}</button>
      </div>
      {splitLine !== null && lines[splitLine] && (
        <SubSplit
          title={prodBy.get(lines[splitLine].prodKey)?.ProdName || 'item'}
          kgs={isKgs(lines[splitLine].unit)}
          initial={lines[splitLine].subs} parties={custOpts}
          onCancel={() => { const i = splitLine; setSplitLine(null); focusId(`ln-${i}-marks`); }}
          onDone={(subs) => {
            const i = splitLine;
            const kgs = isKgs(lines[i].unit);
            const tNop = r2(subs.reduce((s, x) => s + n(x.nop), 0));
            const tQty = r2(subs.reduce((s, x) => s + n(x.qty), 0));
            const amount = subs.reduce((s, x) => s + subAmt(kgs, x), 0);
            const base = kgs ? tQty : tNop;
            setLine(i, { subs, nop: String(tNop), qty: String(tQty), rate: base ? String(r2(amount / base)) : '', wts: '' });
            setSplitLine(null);
            focusId(`ln-${i}-marks`);
          }}
        />
      )}
      {wtLine !== null && lines[wtLine] && (
        <BagWeights
          title={prodBy.get(lines[wtLine].prodKey)?.ProdName || 'item'}
          initial={lines[wtLine].wts} bags={n(lines[wtLine].nop)}
          onCancel={() => { const i = wtLine; setWtLine(null); focusId(`ln-${i}-rate`); }}
          onDone={(w) => {
            const i = wtLine;
            setLine(i, { wts: w.join(','), nop: String(w.length), qty: String(r2(w.reduce((s, x) => s + x, 0))), unit: 'Kgs' });
            setWtLine(null);
            focusId(`ln-${i}-rate`);
          }}
        />
      )}
    </div>
  );
}
