import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthFrame, ErrorNote, Field, PageHead, useToast } from '../components/ui';
import { ROLE_LABEL } from '../lib/format';

const RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

function PasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!RULE.test(next)) return setError(new Error('Use 8 or more characters with at least one letter and one number.'));
    if (next !== confirm) return setError(new Error('The new passwords do not match.'));
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack narrow">
      <Field label="Current password">
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" hint="At least 8 characters, with a letter and a number">
        <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
      <div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

export function ForcePasswordChange() {
  const { me, reload, logout } = useAuth();
  return (
    <AuthFrame title="Set your own password">
      <div className="stack">
        <p className="muted">
          {me?.fullName}, you signed in with a temporary password. Choose a new one to continue.
        </p>
        <PasswordForm onDone={reload} />
        <button className="btn btn-quiet btn-sm justify-start" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </AuthFrame>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  const toast = useToast();
  if (!me) return null;
  return (
    <>
      <PageHead title="Your account" sub={`${me.email} · ${ROLE_LABEL[me.role]}`} />
      <section className="panel">
        <h2 className="panel-title">Change password</h2>
        <p className="muted">Changing your password signs you out on every other browser.</p>
        <PasswordForm onDone={() => toast('Password changed')} />
      </section>
    </>
  );
}
