import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken, type Row } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Parties from './pages/Parties';
import { SimpleMaster } from './pages/SimpleMaster';
import BillList from './pages/BillList';
import BillEditor from './pages/BillEditor';
import BillPrint from './pages/BillPrint';
import Receipts from './pages/Receipts';
import { Ledger, Outstanding, DayBook, TrialBalance } from './pages/Reports';

export default function App() {
  const [user, setUser] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('nb-logout', out);
    if (getToken()) {
      api.get('/auth/me').then((r) => setUser(r.user), () => setToken(null)).finally(() => setReady(true));
    } else setReady(true);
    return () => window.removeEventListener('nb-logout', out);
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={(u) => { setUser(u); nav('/'); }} />;

  const logout = () => { setToken(null); setUser(null); };
  const link = (to: string, label: string) => <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>;

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">NanoSoft Billing</div>
        {link('/', 'Dashboard')}
        <div className="grp">Transactions</div>
        {link('/bills/B', 'Customer bills')}
        {link('/bills/S', 'Supplier bills')}
        {link('/receipts/R', 'Receipts')}
        {link('/receipts/P', 'Payments')}
        <div className="grp">Reports</div>
        {link('/ledger', 'Party ledger')}
        {link('/outstanding', 'Outstanding')}
        {link('/daybook', 'Day book')}
        {link('/trial-balance', 'Trial balance')}
        <div className="grp">Masters</div>
        {link('/parties', 'Customers / suppliers')}
        {link('/products', 'Products')}
        {link('/groups', 'Party groups')}
        {link('/banks', 'Banks')}
        {link('/marks', 'Marks')}
        <div className="user">
          Signed in as <b>{user.name}</b><br />
          <button className="sm" onClick={logout} style={{ marginTop: 6 }}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
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
          <Route path="/marks" element={<SimpleMaster kind="marks" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
