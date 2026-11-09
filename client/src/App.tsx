import { Fragment, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getToken, setBrand, setToken, userKey, type Row } from './api';
import { useBrand } from './components';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Parties from './pages/Parties';
import { SimpleMaster } from './pages/SimpleMaster';
import BillList from './pages/BillList';
import BillEditor from './pages/BillEditor';
import BillPrint from './pages/BillPrint';
import Receipts from './pages/Receipts';
import Users from './pages/Users';
import Settings from './pages/Settings';
import { Ledger, Outstanding, DayBook, TrialBalance } from './pages/Reports';

export default function App() {
  const [user, setUser] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const { name: appName, logo } = useBrand();
  const logoImg = logo ? <img className="brand-logo" src={logo} alt="" /> : null;
  // The left menu can be folded away on a desktop screen to give the work area the full width (Ctrl+B too); remembered on this computer.
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem('nvs.menuFolded') === '1'; } catch { return false; } });
  // Menu groups (Transactions, Reports ...) can be opened and closed; remembered on this computer.
  const [shut, setShut] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('nvs.menuShut') || '{}'); } catch { return {}; } });
  const toggleGroup = (id: string) => setShut((s) => {
    const n = { ...s, [id]: !s[id] };
    try { localStorage.setItem('nvs.menuShut', JSON.stringify(n)); } catch { /* storage blocked */ }
    return n;
  });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem('nvs.menuFolded', v ? '1' : '0'); } catch { /* storage blocked */ } };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); fold(!folded); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [folded]);
  // the company name set in Settings (public, so the login page can show it too)
  useEffect(() => { api.get('/auth/brand').then((r) => setBrand(r), () => undefined); }, [user?.id]);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => { setMenu(false); setOpenMenu(null); }, [loc.pathname]);

  // Menu layout: the left menu or a top bar. The default is set in Settings; a user's own choice (button in the menu) wins.
  type Layout = 'left' | 'top' | 'right';
  const asLayout = (v: unknown): Layout | '' => (v === 'top' || v === 'right' || v === 'left' ? v : '');
  const [defaultLayout, setDefaultLayout] = useState<Layout>('left');
  const [override, setOverride] = useState<Layout | ''>('');
  const layout = override || defaultLayout;
  const chooseLayout = (m: Layout) => { setOverride(m); try { localStorage.setItem(`nvs.menuLayout.${userKey()}`, m); } catch { /* storage blocked */ } };
  useEffect(() => {
    if (!user) return;
    try { setOverride(asLayout(localStorage.getItem(`nvs.menuLayout.${userKey()}`))); } catch { /* storage blocked */ }
    api.get('/settings/ui').then((r) => setDefaultLayout(asLayout(r.menu) || 'left'), () => undefined);
  }, [user?.id]);
  // An owner/admin choosing the default in Settings applies at once on this screen (their own override is cleared so they see it).
  useEffect(() => {
    const h = (e: Event) => {
      setDefaultLayout(asLayout((e as CustomEvent).detail) || 'left');
      setOverride('');
      try { localStorage.removeItem(`nvs.menuLayout.${userKey()}`); } catch { /* storage blocked */ }
    };
    window.addEventListener('nb-layout-default', h);
    return () => window.removeEventListener('nb-layout-default', h);
  }, []);
  // top menu: which dropdown is open; it closes on a click elsewhere, Esc, or when the page changes
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenu) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.tn-group')) setOpenMenu(null); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(null);
    document.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [openMenu]);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('nb-logout', out);
    if (getToken()) {
      api.get('/auth/me').then((r) => setUser(r.user), () => setToken(null)).finally(() => setReady(true));
    } else setReady(true);
    return () => window.removeEventListener('nb-logout', out);
  }, []);

  // Label table cells from their column headings so "stack" tables can show as cards on phones.
  useEffect(() => {
    const label = () => {
      document.querySelectorAll('table.stack').forEach((t) => {
        const hs = [...t.querySelectorAll('thead th')].map((h) => h.textContent?.trim() || '');
        t.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
          let col = 0;
          [...tr.children].forEach((td) => {
            const cs = (td as HTMLTableCellElement).colSpan || 1;
            if (cs === 1 && hs[col]) td.setAttribute('data-label', hs[col]);
            else td.removeAttribute('data-label');
            col += cs;
          });
        });
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = menu ? 'hidden' : '';
    if (!menu) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [menu]);

  if (!ready) return null;
  if (!user) return <Login onLogin={(u) => { setUser(u); nav('/'); }} />;

  const logout = () => { setToken(null); setUser(null); };
  const can = (area: string) => !!user.perms?.[area];
  // One list of menu groups feeds both the left menu and the top menu.
  const groups = [
    { id: 'tx', title: 'Transactions', show: can('sales') || can('purchase') || can('receipts'), items: [
      { to: '/bills/B', label: 'Sales bills', show: can('sales') }, { to: '/bills/S', label: 'Purchase bills', show: can('purchase') },
      { to: '/receipts/R', label: 'Receipts', show: can('receipts') }, { to: '/receipts/P', label: 'Payments', show: can('receipts') },
    ] },
    { id: 'dp', title: 'Delivery & patti', show: can('sales') || can('purchase'), items: [
      { to: '/bills/D', label: 'Delivery chits', show: can('sales') }, { to: '/bills/O', label: 'Orders', show: can('sales') },
      { to: '/bills/F', label: 'Farmer commission bills', show: can('purchase') }, { to: '/bills/L', label: 'Patiyal bills (credit)', show: can('purchase') },
      { to: '/bills/C', label: 'Cash patiyal', show: can('purchase') },
    ] },
    { id: 'rp', title: 'Reports', show: can('reports'), items: [
      { to: '/ledger', label: 'Party ledger', show: true }, { to: '/outstanding', label: 'Outstanding', show: true },
      { to: '/daybook', label: 'Day book', show: true }, { to: '/trial-balance', label: 'Trial balance', show: true },
    ] },
    { id: 'ms', title: 'Masters', show: can('masters'), items: [
      { to: '/parties', label: 'Customers / suppliers', show: true }, { to: '/products', label: 'Products', show: true },
      { to: '/groups', label: 'Party groups', show: true }, { to: '/banks', label: 'Banks', show: true }, { to: '/marks', label: 'Marks', show: true },
    ] },
    { id: 'ad', title: 'Admin', show: can('users'), items: [
      { to: '/users', label: 'Users and roles', show: true }, { to: '/settings', label: 'Settings', show: true },
    ] },
  ];
  const head = (id: string, title: string, color: string) => (
    <button type="button" className={`grp c-${color}`} aria-expanded={!shut[id]} onClick={() => toggleGroup(id)}>
      <span>{title}</span><span className="chev">{shut[id] ? '▸' : '▾'}</span>
    </button>
  );
  // the Left | Top | Right switch, shown inside the menu itself (and kept for this user on this computer)
  const layoutSwitch = (
    <div className="seg lay" role="group" aria-label="Menu position" title="Where the menu sits">
      {(['left', 'top', 'right'] as const).map((m) => (
        <button key={m} type="button" className={layout === m ? 'on' : ''} onClick={() => chooseLayout(m)}>{m === 'left' ? 'Left' : m === 'top' ? 'Top' : 'Right'}</button>
      ))}
    </div>
  );
  const body = (id: string) => (shut[id] ? 'grp-body shut' : 'grp-body');
  const link = (to: string, label: string) => <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>;

  return (
    <div className={`shell${folded ? ' folded' : ''}${layout === 'top' ? ' topmenu' : layout === 'right' ? ' rightmenu' : ''}`}>
      <header className="topnav">
        <span className="tn-brand">{logoImg}{appName}</span>
        {can('dashboard') && link('/', 'Dashboard')}
        {groups.filter((g) => g.show).map((g) => (
          <div key={g.id} className="tn-group">
            <button type="button" className={`tn-btn${openMenu === g.id ? ' open' : ''}`} aria-expanded={openMenu === g.id} onClick={() => setOpenMenu(openMenu === g.id ? null : g.id)}>
              {g.title} <span>▾</span>
            </button>
            {openMenu === g.id && <div className="tn-panel">{g.items.filter((i) => i.show).map((i) => link(i.to, i.label))}</div>}
          </div>
        ))}
        <span className="grow" />
        <span className="tn-user">{user.name} <span className="muted">({user.role})</span></span>
        {layoutSwitch}
        <button type="button" className="sm" onClick={logout}>Sign out</button>
      </header>
      {folded && <button type="button" className="menu-open" title="Show the menu (Ctrl+B)" aria-label="Show the menu" onClick={() => fold(false)}>☰</button>}
      <header className="topbar">
        <span className="tb-brand">{logoImg}{appName}</span>
        <button className="burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span /><span /><span />
        </button>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <nav className={`side${menu ? ' open' : ''}`}>
        <div className="brand">
          {logoImg}<span className="grow">{appName}</span>
          <button type="button" className="menu-fold" title="Hide the menu (Ctrl+B)" aria-label="Hide the menu" onClick={() => fold(true)}>«</button>
        </div>
        {can('dashboard') && link('/', 'Dashboard')}
        {groups.filter((g) => g.show).map((g) => (
          <Fragment key={g.id}>
            {head(g.id, g.title, 'green')}
            <div className={body(g.id)}>{g.items.filter((i) => i.show).map((i) => link(i.to, i.label))}</div>
          </Fragment>
        ))}
        <div className="side-foot">
          <div className="muted" style={{ fontSize: '.72rem', margin: '0 0 3px' }}>Menu position</div>
          {layoutSwitch}
          <div className="user">
            Signed in as <b>{user.name}</b><br /><span className="muted">{user.role}</span><br />
            <button className="sm" onClick={logout} style={{ marginTop: 6 }}>Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={can('dashboard') ? <Dashboard /> : <Navigate to={can('sales') ? '/bills/B' : can('purchase') ? '/bills/S' : can('receipts') ? '/receipts/R' : '/parties'} />} />
          <Route path="/bills/:type" element={<BillList />} />
          <Route path="/bills/:type/new" element={<BillEditor />} />
          <Route path="/bills/:type/:id" element={<BillEditor />} />
          <Route path="/bills/:type/:id/print" element={<BillPrint />} />
          <Route path="/receipts/:type" element={<Receipts />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/outstanding" element={<Outstanding />} />
          <Route path="/daybook" element={<DayBook />} />
          <Route path="/trial-balance" element={<TrialBalance />} />
          <Route path="/parties" element={<Parties />} />
          <Route path="/products" element={<SimpleMaster kind="products" />} />
          <Route path="/groups" element={<SimpleMaster kind="groups" />} />
          <Route path="/banks" element={<SimpleMaster kind="banks" />} />
          <Route path="/users" element={<Users me={user} />} />
          <Route path="/settings" element={can('users') ? <Settings /> : <Navigate to="/" />} />
          <Route path="/marks" element={<SimpleMaster kind="marks" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
