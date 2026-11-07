import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote } from '../components/ui';
import './Login.css';

const FEATURES = [
  {
    title: 'Live tests',
    text: 'Set a NEET, JEE or KCET paper and follow every tablet as students write.',
    icon: 'M4 4h16v12H4zM8 20h8M12 16v4M8 9l2.5 2.5L16 7',
  },
  {
    title: 'Practice and mock tests',
    text: 'Thousands of questions, chapter by chapter, on every student tablet.',
    icon: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z',
  },
  {
    title: 'Results and marks',
    text: 'Ranked marks for every class and section, ready to download.',
    icon: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
    <div className="lg">
      <section className="lg-art" aria-hidden="true">
        <div className="lg-brand">
          <span className="lg-logo">MT</span>
          <span>
            <strong>MT Learning</strong>
            <em>Manchester Technologies</em>
          </span>
        </div>

        <div className="lg-pitch">
          <span className="lg-eyebrow">College admin portal</span>
          <h2>
            Every test. Every tablet.
            <br />
            <span>One place.</span>
          </h2>
          <p>Create live tests, watch students write them in real time, and share ranked marks with the college.</p>
        </div>

        <ul className="lg-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <i>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </i>
              <span>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="lg-foot">Manchester Technologies &middot; Innovate, Develop, Dominate</p>
      </section>

      <main className="lg-side">
        <form className="lg-card" onSubmit={submit}>
          <span className="lg-logo small" aria-hidden="true">
            MT
          </span>
          <div className="lg-title">
            <h1>Welcome back</h1>
            <p>Sign in with the email and password from the college office.</p>
          </div>

          <label className="lg-field">
            <span>Email address</span>
            <span className="lg-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="M4 7l8 6 8-6" />
              </svg>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                required
                placeholder="name@college.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </span>
          </label>

          <label className="lg-field">
            <span>Password</span>
            <span className="lg-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <input
                id="login-password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="lg-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          <ErrorNote error={error} />

          <button className="btn btn-primary lg-submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
            {!busy && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>

          <p className="lg-help">Forgot your password? Ask the college administrator to reset it.</p>
          <p className="lg-secure">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            For college staff only. Every sign-in is recorded.
          </p>
        </form>
      </main>
    </div>
  );
}
