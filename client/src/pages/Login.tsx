import { useState } from 'react';
import { api, setToken, type Row } from '../api';
import { ErrorBox, Field } from '../components';

export default function Login({ onLogin }: { onLogin: (u: Row) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/login', { username, password });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>NanoSoft Billing</h1>
        <ErrorBox error={error} />
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="User name"><input autoFocus value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></Field>
          <button className="primary" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
