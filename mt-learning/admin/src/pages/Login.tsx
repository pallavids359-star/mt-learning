import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AuthFrame, ErrorNote, Field } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="stack">
        <p className="muted small">Sign in with the email address and password issued by the college office.</p>
        <Field label="Official email address">
          <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} aria-busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}
