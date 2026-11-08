import { useState } from 'react';
import { api, getApiBase, setApiBase, setToken, type Row } from '../api';
import { ErrorBox, Field } from '../components';

export default function Login({ onLogin }: { onLogin: (u: Row) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(getApiBase());
  const hosted = !['localhost', '127.0.0.1'].includes(window.location.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (hosted) setApiBase(server);
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
          {hosted && (
            <Field label="Server address"><input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://your-tunnel-address" inputMode="url" /></Field>
          )}
          <Field label="User name"><input autoFocus value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></Field>
          <button className="primary" disabled={busy || !username || !password || (hosted && !server.trim() && !getApiBase())}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
