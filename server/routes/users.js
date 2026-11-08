import { Router } from 'express';
import { query } from '../db.js';
import { wrap, badReq, notFound, int, str } from '../util.js';
import { ROLES, ROLE_NAMES } from '../access.js';

export const usersRouter = Router();

usersRouter.get('/roles', (_req, res) => res.json(ROLE_NAMES.map((k) => ({ key: k, label: ROLES[k].label }))));

usersRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await query('SELECT userkey AS "Id", username AS "UserName", role AS "Role" FROM usermaster ORDER BY lower(username)'));
  }),
);

function body(b, needPass) {
  const username = str(b.username, 50);
  const password = str(b.password, 50);
  const role = str(b.role, 20);
  if (!username) throw badReq('Enter a user name');
  if (needPass && password.length < 4) throw badReq('Password must be at least 4 characters');
  if (!needPass && password && password.length < 4) throw badReq('Password must be at least 4 characters');
  if (!ROLE_NAMES.includes(role)) throw badReq('Choose a role');
  return { username, password, role };
}

// Only an owner may create or change owners/admins; an admin manages everyone below.
const guard = (req, role) => {
  if (['owner', 'admin'].includes(role) && req.user.role !== 'owner') throw badReq('Only an owner can manage owner and admin users');
};

usersRouter.post(
  '/',
  wrap(async (req, res) => {
    const u = body(req.body || {}, true);
    guard(req, u.role);
    const dup = await query('SELECT 1 FROM usermaster WHERE lower(username)=lower(@u)', { u: u.username });
    if (dup[0]) throw badReq('That user name is already used');
    const r = await query('INSERT INTO usermaster(username,pass,stat,role) VALUES(@u,@p,0,@r) RETURNING userkey AS id', { u: u.username, p: u.password, r: u.role });
    res.status(201).json({ id: r[0].id });
  }),
);

usersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const u = body(req.body || {}, false);
    const cur = await query('SELECT role FROM usermaster WHERE userkey=@id', { id });
    if (!cur[0]) throw notFound('User not found');
    guard(req, cur[0].role);
    guard(req, u.role);
    if (id === req.user.id && req.user.src === 'user' && u.role !== cur[0].role) throw badReq('You cannot change your own role');
    const dup = await query('SELECT 1 FROM usermaster WHERE lower(username)=lower(@u) AND userkey<>@id', { u: u.username, id });
    if (dup[0]) throw badReq('That user name is already used');
    await query('UPDATE usermaster SET username=@u, role=@r, pass=COALESCE(NULLIF(@p,\'\'), pass) WHERE userkey=@id', { u: u.username, r: u.role, p: u.password, id });
    res.json({ ok: true });
  }),
);

usersRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    if (id === req.user.id && req.user.src === 'user') throw badReq('You cannot delete your own login');
    const cur = await query('SELECT role FROM usermaster WHERE userkey=@id', { id });
    if (!cur[0]) throw notFound('User not found');
    guard(req, cur[0].role);
    const owners = await query("SELECT count(*)::int AS n FROM usermaster WHERE role='owner' AND userkey<>@id", { id });
    if (cur[0].role === 'owner' && !owners[0].n) throw badReq('Keep at least one owner');
    await query('DELETE FROM usermaster WHERE userkey=@id', { id });
    res.json({ ok: true });
  }),
);
