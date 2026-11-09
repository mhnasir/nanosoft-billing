import { useEffect, useState } from 'react';
import { fmt, r2, type Row } from './api';
import { ErrorBox, Modal, Picker } from './components';

export type Sub = { supKey: number; nop: string; qty: string; rate: string; remarks: string };
export const blankSub = (): Sub => ({ supKey: 0, nop: '', qty: '', rate: '', remarks: '' });
const num = (v: string) => Number(v) || 0;
const whole = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
/** Amount of one part, same rule as a bill line: Kgs = weight x rate, any other unit = bags x rate, whole rupees. */
export const subAmt = (kgs: boolean, s: Sub) => whole(kgs ? num(s.qty) * num(s.rate) : num(s.nop) * num(s.rate));

const focusId = (id: string) => setTimeout(() => { const el = document.getElementById(id) as HTMLInputElement | null; el?.focus(); el?.select?.(); }, 20);

/** The VB "sub customer" list of a patiyal line: who bought how many bags / kg at what rate.
 *  Enter walks Customer > Bags > Weight > Rate and opens the next row; Enter on an empty customer finishes. */
export default function SubSplit({ title, kgs, initial, parties, onDone, onCancel }: {
  title: string; kgs: boolean; initial: Sub[]; parties: Row[]; onDone: (subs: Sub[]) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState<Sub[]>(initial.length ? initial : [blankSub()]);
  const [err, setErr] = useState('');
  useEffect(() => { focusId('sp-0-c'); }, []);

  const set = (k: number, patch: Partial<Sub>) => { setRows((r) => r.map((x, j) => (j === k ? { ...x, ...patch } : x))); setErr(''); };
  const kept = rows.filter((r) => r.supKey);
  const tNop = r2(kept.reduce((s, x) => s + num(x.nop), 0));
  const tQty = r2(kept.reduce((s, x) => s + num(x.qty), 0));
  const total = kept.reduce((s, x) => s + subAmt(kgs, x), 0);

  function finish() {
    if (!kept.length) { setErr('Add at least one customer'); return; }
    const bad = kept.findIndex((x) => (kgs ? num(x.qty) <= 0 : num(x.nop) <= 0) || num(x.rate) < 0);
    if (bad >= 0) { setErr(`Row ${rows.indexOf(kept[bad]) + 1}: enter the ${kgs ? 'weight' : 'bags'} and rate`); return; }
    onDone(kept);
  }
  const nextRow = (k: number) => {
    if (k >= rows.length - 1) setRows((r) => [...r, blankSub()]);
    focusId(`sp-${k + 1}-c`);
  };
  const key = (k: number, f: 'n' | 'q' | 'r') => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (f === 'n') focusId(kgs ? `sp-${k}-q` : `sp-${k}-r`);
    else if (f === 'q') focusId(`sp-${k}-r`);
    else if (rows[k].supKey) nextRow(k);
  };

  return (
    <Modal title={`Sub-customers - ${title}`} onClose={onCancel}>
      <div onKeyDown={(e) => e.stopPropagation()}>
        <ErrorBox error={err} />
        <div className="bw-grid sp-grid">
          <table className="sheet">
            <thead><tr><th style={{ width: 34 }}>#</th><th>Customer</th><th className="r" style={{ width: 80 }}>Bags</th><th className="r" style={{ width: 100 }}>Weight</th><th className="r" style={{ width: 90 }}>Rate</th><th className="r" style={{ width: 100 }}>Amount</th><th style={{ width: 34 }} /></tr></thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  <td className="bw-no">{k + 1}</td>
                  <td>
                    <Picker
                      id={`sp-list-${k}`} inputId={`sp-${k}-c`} options={parties} value={r.supKey} placeholder="Customer…"
                      labelOf={(p) => (p.City ? `${p.SupName} - ${p.City}` : p.SupName)}
                      onChange={(id) => set(k, { supKey: id })}
                      onPick={() => focusId(`sp-${k}-n`)}
                    />
                  </td>
                  <td><input id={`sp-${k}-n`} className="num" inputMode="decimal" value={r.nop} onChange={(e) => set(k, { nop: e.target.value })} onKeyDown={key(k, 'n')} /></td>
                  <td><input id={`sp-${k}-q`} className="num" inputMode="decimal" value={r.qty} onChange={(e) => set(k, { qty: e.target.value })} onKeyDown={key(k, 'q')} /></td>
                  <td><input id={`sp-${k}-r`} className="num" inputMode="decimal" value={r.rate} onChange={(e) => set(k, { rate: e.target.value })} onKeyDown={key(k, 'r')} /></td>
                  <td className="r">{r.supKey ? fmt(subAmt(kgs, r)) : ''}</td>
                  <td><button type="button" className="sm danger" tabIndex={-1} title="Remove" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== k) : [blankSub()]))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row bw-total" style={{ marginTop: 12 }}>
          <div className="grow"><strong>{kept.length}</strong> customers · {tNop} bags · {tQty} kg · <strong>{fmt(total)}</strong></div>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={finish}>OK</button>
        </div>
        <div className="muted" style={{ fontSize: '.78rem', marginTop: 6 }}>Enter = next box · Enter on an empty customer = done</div>
      </div>
    </Modal>
  );
}
