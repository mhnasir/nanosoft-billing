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

// Address of the API server. Empty = same site (normal PC install). On Netlify it is the tunnel address of the shop PC,
// set at build time (VITE_API_URL) or typed on the login page (kept in this browser).
const API_KEY = 'nb_api';
export function getApiBase(): string {
  let v = '';
  try {
    v = localStorage.getItem(API_KEY) || '';
  } catch {
    /* storage unavailable */
  }
  if (!v) v = ((import.meta as any).env?.VITE_API_URL as string) || '';
  return v.trim().replace(/\/+$/, '').replace(/\/api$/, '');
}
export function setApiBase(v: string) {
  try {
    if (v.trim()) localStorage.setItem(API_KEY, v.trim());
    else localStorage.removeItem(API_KEY);
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
    res = await fetch(`${getApiBase()}/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

// The company name and logo shown in the menu, the browser tab, the login page and (optionally) the printed bill. Set in Settings.
const DEFAULT_NAME = 'NanoSoft Billing';
const brand = { name: DEFAULT_NAME, logoVer: 0, logoOnPrint: true };
export const getAppName = () => brand.name;
/** Address of the logo picture ('' = no logo uploaded). The version changes on every upload, so a new logo shows at once. */
export const getLogoUrl = () => (brand.logoVer ? `${getApiBase()}/api/auth/logo?v=${brand.logoVer}` : '');
export const getLogoOnPrint = () => brand.logoOnPrint;
export function setBrand(b: { appName?: unknown; logoVersion?: unknown; logoOnPrint?: unknown }) {
  if (b.appName !== undefined) brand.name = String(b.appName ?? '').trim() || DEFAULT_NAME;
  if (b.logoVersion !== undefined) brand.logoVer = Number(b.logoVersion) || 0;
  if (b.logoOnPrint !== undefined) brand.logoOnPrint = b.logoOnPrint !== false;
  try { document.title = brand.name; } catch { /* no document */ }
  window.dispatchEvent(new Event('appname'));
}
export const setAppName = (v: unknown) => setBrand({ appName: v });

/** Who is signed in (from the login token), used to keep per-user defaults in this browser. */
export function userKey(): string {
  try {
    const p = JSON.parse(atob((getToken() || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return String(p.name || p.id || '');
  } catch {
    return '';
  }
}

export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const below1000 = (n: number) => `${n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : ''}${below100(n % 100)}`;

/** 1234.5 -> "Rupees One Thousand Two Hundred Thirty Four and Paise Fifty Only" (Indian grouping: lakh, crore). */
export function rupeesInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (!rupees && !paise) return 'Zero';
  const parts: string[] = [];
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as [number, string][]) {
    const q = Math.floor(rupees / div);
    if (q) parts.push(`${below1000(q)} ${name}`);
    rupees %= div;
  }
  if (rupees) parts.push(below1000(rupees));
  const r = parts.join(' ');
  return `Rupees ${r || 'Zero'}${paise ? ` and Paise ${below100(paise)}` : ''} Only`;
}
