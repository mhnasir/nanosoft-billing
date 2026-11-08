export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const badReq = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validates 'YYYY-MM-DD' and returns it unchanged (used as a ::date parameter in SQL). */
export function ymd(s, what = 'date') {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badReq(`Invalid ${what} (expected YYYY-MM-DD)`);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw badReq(`Invalid ${what}`);
  return s;
}

export const num = (v, d = 0) => {
  if (v === '' || v === null || v === undefined) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const int = (v, d = 0) => Math.trunc(num(v, d));
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const str = (v, max = 50) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

/** Indian financial year (1 Apr - 31 Mar) containing the given YYYY-MM-DD date, as an ISO date pair. */
export function fyRange(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

export const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
