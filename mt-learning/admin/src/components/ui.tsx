import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AccountStatus, TabletStatus } from '../api/types';
import { STATUS_LABEL, TABLET_LABEL } from '../lib/format';

// ---------------------------------------------------------------- toasts

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- modal

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- form bits

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error-note" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

// ---------------------------------------------------------------- status pills

export function StatusPill({ status }: { status: AccountStatus }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function TabletPill({ status }: { status: TabletStatus }) {
  return <span className={`pill tab-${status.toLowerCase()}`}>{TABLET_LABEL[status]}</span>;
}

// ---------------------------------------------------------------- pagination

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <button className="btn btn-quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button className="btn btn-quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------- page scaffolding

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------- credential slip

/** Shows a one-time temporary password with copy and print. */
export function CredentialSlip({ who, code, password, note }: { who: string; code: string; password: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="slip">
      <div className="slip-row">
        <span>Name</span>
        <strong>{who}</strong>
      </div>
      <div className="slip-row">
        <span>Sign-in ID</span>
        <strong className="mono">{code}</strong>
      </div>
      <div className="slip-row">
        <span>Temporary password</span>
        <strong className="mono slip-secret">{password}</strong>
      </div>
      <p className="slip-note">
        {note ?? 'This password is shown only once. It must be changed at first sign-in.'}
      </p>
      <div className="slip-actions">
        <button
          className="btn btn-quiet"
          onClick={async () => {
            await navigator.clipboard.writeText(`${code}\t${password}`);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn btn-quiet" onClick={() => window.print()}>
          Print slip
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- confirm

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; action: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = (title: string, body: ReactNode, action: string, danger = false) =>
    new Promise<boolean>((resolve) => setState({ title, body, action, danger, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const dialog = (
    <Modal open={!!state} title={state?.title ?? ''} onClose={() => close(false)}>
      <div className="confirm-body">{state?.body}</div>
      <div className="form-actions">
        <button className="btn btn-quiet" onClick={() => close(false)}>
          Cancel
        </button>
        <button className={`btn ${state?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
          {state?.action}
        </button>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}

// ---------------------------------------------------------------- sign-in layout

export function AuthFrame({ children, title = 'Staff sign-in' }: { children: ReactNode; title?: string }) {
  return (
    <div className="auth">
      <section className="auth-art" aria-hidden="true">
        <div className="auth-brand">
          <span className="side-logo">MT</span>
          <strong>MT Learning</strong>
        </div>
        <div className="auth-pitch">
          <h2>Practice, live tests and marks for every student tablet.</h2>
          <p>Follow each live test as it happens and help any student who gets stuck.</p>
        </div>
        <ul className="auth-points">
          <li>
            <b>Live tests</b>
            <span>Set a paper from the question bank and watch it live</span>
          </li>
          <li>
            <b>Practice</b>
            <span>NEET, JEE and KCET questions on every tablet</span>
          </li>
          <li>
            <b>Marks</b>
            <span>Results ready to download for Bridge</span>
          </li>
        </ul>
        <p className="auth-foot">Manchester Technologies · Innovate, Develop, Dominate</p>
      </section>
      <main className="auth-side">
        <div className="auth-card">
          <h1 className="auth-title">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- KPI card

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {note && <span className={`kpi-note ${tone ?? ''}`}>{note}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}
