import { useEffect, useState, type ReactNode } from 'react';
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

/** Text input with a datalist; resolves the typed text to a record id. */
export function Picker({
  options, value, onChange, labelOf, placeholder, id,
}: {
  options: Row[]; value: number; onChange: (id: number, row: Row | null) => void;
  labelOf: (r: Row) => string; placeholder?: string; id: string;
}) {
  const current = options.find((o) => o.__id === value);
  const [text, setText] = useState(current ? labelOf(current) : '');
  useEffect(() => { setText(current ? labelOf(current) : ''); /* eslint-disable-next-line */ }, [value, options.length]);
  return (
    <>
      <input
        list={id} value={text} placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const m = options.find((o) => labelOf(o) === e.target.value);
          onChange(m ? m.__id : 0, m || null);
        }}
      />
      <datalist id={id}>{options.slice(0, 400).map((o) => <option key={o.__id} value={labelOf(o)} />)}</datalist>
    </>
  );
}
