// Role-based access. A role gets a level per area: 'r' = view, 'w' = add/edit, 'd' = also delete, missing = no access.
import { query } from './db.js';
import { HttpError, int } from './util.js';

export const ROLES = {
  owner: { label: 'Owner', all: 'd', users: 'd' },
  admin: { label: 'Admin', all: 'd', users: 'd' },
  manager: { label: 'Manager', all: 'd' },
  pos: { label: 'POS / counter', dashboard: 'r', sales: 'w', receipts: 'w', masters: 'w' },
  loading: { label: 'Loading staff', sales: 'r', purchase: 'r', masters: 'r' },
  stock: { label: 'Stock keeper', dashboard: 'r', sales: 'r', purchase: 'w', masters: 'w' },
};
export const ROLE_NAMES = Object.keys(ROLES);
const RANK = { r: 1, w: 2, d: 3 };

export const levelOf = (role, area) => {
  const r = ROLES[role] || ROLES.pos; // unknown role: least-privileged useful default
  return r[area] || (area === 'users' ? undefined : r.all);
};
export const permsOf = (role) =>
  Object.fromEntries(['dashboard', 'sales', 'purchase', 'receipts', 'reports', 'masters', 'users'].map((a) => [a, levelOf(role, a) || '']));

const MASTER_PATHS = new Set(['parties', 'products', 'groups', 'banks', 'marks', 'company']);

/** Which area a request touches (sales and purchase bills are told apart by bill type). */
async function areaOf(req) {
  const seg = req.path.split('/').filter(Boolean);
  const [a, b] = seg;
  if (a === 'bills') {
    let t = String(req.query.type || req.body?.billType || '').toUpperCase();
    if (!t && int(b)) {
      const r = await query('SELECT billtype FROM bill01 WHERE billkey=@id', { id: int(b) });
      t = (r[0]?.billtype || '').trim();
    }
    return t === 'S' ? 'purchase' : 'sales';
  }
  if (a === 'receipts') return 'receipts';
  if (a === 'reports') return b === 'dashboard' ? 'dashboard' : 'reports';
  if (a === 'users') return 'users';
  if (MASTER_PATHS.has(a)) return 'masters';
  return 'masters';
}

export async function requirePermission(req, _res, next) {
  try {
    if (req.path.startsWith('/auth')) return next();
    const area = await areaOf(req);
    const need = req.method === 'GET' ? 'r' : req.method === 'DELETE' ? 'd' : 'w';
    const have = levelOf(req.user?.role, area);
    if (!have || RANK[have] < RANK[need]) throw new HttpError(403, 'Your role does not allow this');
    next();
  } catch (e) {
    next(e);
  }
}
