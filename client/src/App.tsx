import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getToken, setToken, type Row } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Parties from './pages/Parties';
import { SimpleMaster } from './pages/SimpleMaster';
import BillList from './pages/BillList';
import BillEditor from './pages/BillEditor';
import BillPrint from './pages/BillPrint';
import Receipts from './pages/Receipts';
import Users from './pages/Users';
import { Ledger, Outstanding, DayBook, TrialBalance } from './pages/Reports';

export default function App() {
  const [user, setUser] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => setMenu(false), [loc.pathname]);

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
  const link = (to: string, label: string) => <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="tb-brand">NanoSoft Billing</span>
        <button className="burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span /><span /><span />
        </button>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <nav className={`side${menu ? ' open' : ''}`}>
        <div className="brand">NanoSoft Billing</div>
        {can('dashboard') && link('/', 'Dashboard')}
        {(can('sales') || can('purchase') || can('receipts')) && <div className="grp">Transactions</div>}
        {can('sales') && link('/bills/B', 'Sales bills')}
        {can('purchase') && link('/bills/S', 'Purchase bills')}
        {can('receipts') && link('/receipts/R', 'Receipts')}
        {can('receipts') && link('/receipts/P', 'Payments')}
        {(can('sales') || can('purchase')) && <div className="grp">Delivery &amp; patti</div>}
        {can('sales') && link('/bills/D', 'Delivery chits')}
        {can('sales') && link('/bills/O', 'Orders')}
        {can('purchase') && link('/bills/F', 'Farmer commission bills')}
        {can('purchase') && link('/bills/L', 'Patiyal bills (credit)')}
        {can('purchase') && link('/bills/C', 'Cash patiyal')}
        {can('reports') && <div className="grp">Reports</div>}
        {can('reports') && link('/ledger', 'Party ledger')}
        {can('reports') && link('/outstanding', 'Outstanding')}
        {can('reports') && link('/daybook', 'Day book')}
        {can('reports') && link('/trial-balance', 'Trial balance')}
        {can('masters') && <div className="grp">Masters</div>}
        {can('masters') && link('/parties', 'Customers / suppliers')}
        {can('masters') && link('/products', 'Products')}
        {can('masters') && link('/groups', 'Party groups')}
        {can('masters') && link('/banks', 'Banks')}
        {can('masters') && link('/marks', 'Marks')}
        {can('users') && <div className="grp">Admin</div>}
        {can('users') && link('/users', 'Users and roles')}
        <div className="user">
          Signed in as <b>{user.name}</b><br /><span className="muted">{user.role}</span><br />
          <button className="sm" onClick={logout} style={{ marginTop: 6 }}>Sign out</button>
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
          <Route path="/marks" element={<SimpleMaster kind="marks" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
