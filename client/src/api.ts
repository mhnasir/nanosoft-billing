export type Row = Record<string, any>;

const KEY = 'nb_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Cannot reach the server');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/auth/login')) {
    setToken(null);
    window.dispatchEvent(new Event('nb-logout'));
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
};

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n: unknown) => money.format(Number(n) || 0);
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** ISO string from SQL Server -> dd/mm/yyyy (date part only, no timezone shift). */
export const fdate = (s: unknown) => {
  const t = typeof s === 'string' ? s.slice(0, 10) : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
export const dateOnly = (s: unknown) => (typeof s === 'string' ? s.slice(0, 10) : '');

export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
