import { useEffect, useRef, useState } from 'react';
import { r2 } from './api';
import { ErrorBox, Modal } from './components';

/** Per-bag weights popup (the VB "CalcPack" screen). Two ways to use it:
 *  - know the count: type the bags, Enter, then each weight; Enter on the last bag finishes.
 *  - don't know it: leave Bags empty, press Enter and just keep typing weights - a new bag opens after each one and the
 *    count follows; Enter on an empty bag finishes. */
export default function BagWeights({ title, initial, bags, onDone, onCancel }: {
  title: string; initial: string; bags: number; onDone: (weights: number[]) => void; onCancel: () => void;
}) {
  const start = initial.split(',').map((s) => s.trim()).filter(Boolean);
  const [count, setCount] = useState(String(start.length || bags || ''));
  const [rows, setRows] = useState<string[]>(start.length ? start : Array.from({ length: Math.max(0, Math.round(bags)) }, () => ''));
  const [err, setErr] = useState('');
  // fixed = the user stated how many bags there are; otherwise the list grows as weights are entered
  const [fixed, setFixed] = useState(start.length === 0 && bags > 0);
  const countRef = useRef<HTMLInputElement>(null);
  const focusRow = (k: number) => setTimeout(() => { const el = document.getElementById(`bw-${k}`) as HTMLInputElement | null; el?.focus(); el?.select(); }, 0);
  useEffect(() => { countRef.current?.focus(); countRef.current?.select(); }, []);

  const filled = rows.map((v) => v.trim()).filter((v) => v !== '');
  const nums = filled.map(Number);
  const total = r2(nums.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0));

  // while the count is open-ended, the Bags box just shows how many weights are in
  useEffect(() => { if (!fixed) setCount(filled.length ? String(filled.length) : ''); /* eslint-disable-next-line */ }, [fixed, filled.length]);

  function resize(nStr: string) {
    const n = Math.max(0, Math.min(200, Math.floor(Number(nStr) || 0)));
    setRows((r) => (n <= r.length ? r.slice(0, n) : [...r, ...Array.from({ length: n - r.length }, () => '')]));
    return n;
  }
  function finish() {
    if (!nums.length) { setErr('Enter at least one bag weight'); return; }
    if (nums.some((x) => !Number.isFinite(x) || x <= 0)) { setErr('Each bag weight must be a number above 0'); return; }
    if (nums.map(String).join(',').length > 250) { setErr('Too many bags to store (the weight list is limited to 250 characters)'); return; }
    onDone(nums);
  }
  function setRow(k: number, v: string) {
    // pasting or typing "55,65,55" fills the next bags in one go
    if (/[,\s]/.test(v.trim())) {
      const parts = v.split(/[,\s]+/).filter(Boolean);
      setRows((r) => {
        const out = [...r];
        parts.forEach((p, j) => { out[k + j] = p; });
        for (let j = 0; j < out.length; j++) if (out[j] === undefined) out[j] = '';
        setCount(String(out.length));
        return out;
      });
      return;
    }
    setRows((r) => r.map((x, j) => (j === k ? v : x)));
  }

  return (
    <Modal title={`Bag weights - ${title}`} onClose={onCancel}>
      <div onKeyDown={(e) => e.stopPropagation()}>
        <ErrorBox error={err} />
        <div className="row" style={{ alignItems: 'end', marginBottom: 12 }}>
          <label className="f">Bags <span style={{ fontSize: '.7rem' }}>(optional)</span>
            <input ref={countRef} className="num" inputMode="numeric" style={{ width: 90 }} value={count}
              onChange={(e) => { setCount(e.target.value); const n = resize(e.target.value); setFixed(n > 0); setErr(''); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const n = resize(count);
                if (n) { setFixed(true); focusRow(0); }
                else { setFixed(false); if (!rows.length) setRows(['']); focusRow(0); } // no count: just start with the weights
              }} />
          </label>
          <div className="grow muted" style={{ textAlign: 'right', fontSize: '.8rem' }}>Enter = next bag<br />Enter on empty = done</div>
        </div>
        <div className="bw-grid">
          <table className="sheet bw-table">
            <thead><tr><th style={{ width: 44 }}>Bag</th><th className="r">Weight (kg)</th></tr></thead>
            <tbody>
              {rows.map((v, k) => (
                <tr key={k}>
                  <td className="bw-no">{k + 1}</td>
                  <td>
                    <input
                      id={`bw-${k}`} className="num" inputMode="decimal" value={v}
                      onChange={(e) => { setRow(k, e.target.value); setErr(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (v.trim() === '' && k > 0) { setRows((r) => r.slice(0, k).concat(r.slice(k + 1).filter((x) => x.trim() !== ''))); finish(); return; }
                          if (k < rows.length - 1) focusRow(k + 1);
                          else if (fixed || rows.length >= 200) finish();
                          else { setRows((r) => [...r, '']); focusRow(k + 1); } // count not fixed: open the next bag
                        } else if (e.key === 'Backspace' && v === '' && k > 0) { e.preventDefault(); setRows((r) => r.filter((_, j) => j !== k)); setCount(String(rows.length - 1)); focusRow(k - 1); }
                        else if (e.key === 'ArrowDown' && k < rows.length - 1) { e.preventDefault(); focusRow(k + 1); }
                        else if (e.key === 'ArrowUp' && k > 0) { e.preventDefault(); focusRow(k - 1); }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row bw-total" style={{ marginTop: 14 }}>
          <div className="grow"><strong>{filled.length}</strong> bags &nbsp;·&nbsp; total <strong>{total}</strong> kg</div>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={finish}>OK</button>
        </div>
      </div>
    </Modal>
  );
}
