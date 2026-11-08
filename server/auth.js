import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { query } from './db.js';
import { HttpError, wrap, str } from './util.js';
import { permsOf, ROLES } from './access.js';

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set - using a temporary secret; logins reset on restart. Run "npm run init-env".');
}
const hours = Number(process.env.TOKEN_HOURS) || 12;

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Not signed in'));
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    next(new HttpError(401, 'Session expired - please sign in again'));
  }
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const authRouter = Router();

// Legacy users live in usermaster (username/pass) and staffmast (username/password).
// Passwords are stored in plain text by the VB6 app; we compare them as-is (see README: hardening).
authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const username = str(req.body?.username, 50);
    const password = str(req.body?.password, 50);
    if (!username || !password) throw new HttpError(400, 'Enter user name and password');

    let user = null;
    const um = await query('SELECT userkey AS id, username AS name, pass, role FROM usermaster WHERE lower(username)=lower(@u) LIMIT 1', { u: username });
    if (um[0] && safeEq(um[0].pass ?? '', password)) user = { id: um[0].id, name: um[0].name, role: ROLES[um[0].role] ? um[0].role : 'pos', src: 'user' };

    if (!user) {
      const sm = await query('SELECT stfkey AS id, username AS name, password AS pass, stat AS role FROM staffmast WHERE lower(username)=lower(@u) LIMIT 1', { u: username });
      if (sm[0] && sm[0].pass && safeEq(sm[0].pass, password)) user = { id: sm[0].id, name: sm[0].name, role: 'pos', src: 'staff' };
    }
    if (!user) throw new HttpError(401, 'Wrong user name or password');

    const token = jwt.sign(user, secret, { expiresIn: `${hours}h` });
    res.json({ token, user: { ...user, perms: permsOf(user.role) } });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: { ...req.user, perms: permsOf(req.user.role) } }));
