import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type Row } from './api';

export function ErrorBox({ error }: { error: string }) {
  return error ? <div className="err" role="alert">{error}</div> : null;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`f ${className || ''}`}>{label}{children}</label>;
}

/** Load data from the API with simple error handling. */
export function useLoad<T = Row[]>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setLoading(true);
    setError('');
    api.get<T>(url).then(
      (d) => live && setData(d),
      (e) => live && setError(e.message),
    ).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Searchable pick-list (works with touch): type to filter, tap an entry to choose. Resolves to a record id. */
export function Picker({
  options, value, onChange, labelOf, placeholder, id,
}: {
  options: Row[]; value: number; onChange: (id: number, row: Row | null) => void;
  labelOf: (r: Row) => string; placeholder?: string; id: string;
}) {
  const current = options.find((o) => o.__id === value);
  const [text, setText] = useState(current ? labelOf(current) : '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(current ? labelOf(current) : ''); /* eslint-disable-next-line */ }, [value, options.length]);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const all = options.map((o) => ({ o, l: labelOf(o) }));
    const hit = q ? all.filter((x) => x.l.toLowerCase().includes(q)) : all;
    if (q) hit.sort((a, b) => Number(b.l.toLowerCase().startsWith(q)) - Number(a.l.toLowerCase().startsWith(q)));
    return hit.slice(0, 60);
    // eslint-disable-next-line
  }, [text, options]);

  // The list is position:fixed so tables that scroll cannot clip it.
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const below = vh - r.bottom - 8;
    const up = below < 170 && r.top > below;
    setPos(up
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 2, maxHeight: Math.min(280, r.top - 8) }
      : { left: r.left, width: r.width, top: r.bottom + 2, maxHeight: Math.max(120, Math.min(280, below)) });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const h = () => place();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    window.visualViewport?.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
      window.visualViewport?.removeEventListener('resize', h);
    };
  }, [open]);

  const choose = (o: Row) => {
    setText(labelOf(o));
    onChange(o.__id, o);
    setOpen(false);
    setHi(-1);
    ref.current?.blur();
  };

  return (
    <>
      <input
        ref={ref} value={text} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={id}
        onFocus={(e) => { setOpen(true); setHi(-1); e.target.select(); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(-1);
          const m = options.find((o) => labelOf(o) === e.target.value);
          onChange(m ? m.__id : 0, m || null);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && hi >= 0 && matches[hi]) { e.preventDefault(); choose(matches[hi].o); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="picker-list" id={id} role="listbox" style={pos}>
          {matches.map((m, i) => (
            <li
              key={m.o.__id} role="option" aria-selected={m.o.__id === value} className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.preventDefault(); choose(m.o); }}
            >{m.l}</li>
          ))}
          {!matches.length && <li className="none">No match</li>}
        </ul>
      )}
    </>
  );
}
