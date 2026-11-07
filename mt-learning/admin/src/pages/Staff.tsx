import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { AccountStatus, DashboardSummary, Page, Staff, StaffRole } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { CredentialSlip, Empty, ErrorNote, Field, Loading, Modal, Pager, StatusPill, useConfirm, useToast } from '../components/ui';
import { fmtAgo, ROLE_LABEL } from '../lib/format';
import './AdminPages.css';

const ROLES = Object.keys(ROLE_LABEL) as StaffRole[];
const DASH = '\u2014';
const AVATAR = ['navy', 'blue', 'gold', 'plum'];
const ROLE_TONE = (r: StaffRole) => (r === 'SUPER_ADMIN' ? 'gold' : r.includes('ADMIN') ? 'navy' : 'blue');

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function StaffPage() {
  const { can, me } = useAuth();
  const write = can(P.StaffWrite);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [role, setRole] = useState<StaffRole | ''>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  const [secret, setSecret] = useState<{ who: string; code: string; password: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const manageable = (r: StaffRole) => me?.role === 'SUPER_ADMIN' || r !== 'SUPER_ADMIN';

  const q = useQuery({
    queryKey: ['staff', role, page],
    queryFn: () => api<Page<Staff>>('/staff', { query: { role, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardSummary>('/dashboard/summary'), enabled: can(P.DashboardView), staleTime: 60_000 });
  const byRole = summary.data?.staffByRole;
  const total = byRole ? Object.values(byRole).reduce((a, b) => a + (b ?? 0), 0) : undefined;
  // One card per role that has people, plus "All staff".
  const tabs: [StaffRole | '', string, number | undefined][] = [
    ['', 'All staff', total],
    ...ROLES.filter((r) => !byRole || (byRole[r] ?? 0) > 0 || r === role).map((r) => [r, ROLE_LABEL[r], byRole?.[r] ?? (byRole ? 0 : undefined)] as [StaffRole, string, number | undefined]),
  ];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff'] });

  async function changeStatus(s: Staff, status: AccountStatus) {
    const verb = status === 'ACTIVE' ? 'Reactivate' : 'Suspend';
    if (!(await confirm(`${verb} ${s.fullName}?`, status === 'ACTIVE' ? 'They will be able to sign in again.' : 'They are signed out now and cannot sign in until reactivated.', verb, status !== 'ACTIVE'))) return;
    setError(null);
    try {
      await api(`/staff/${s.id}/status`, { method: 'PATCH', body: { status } });
      refresh();
      toast(status === 'ACTIVE' ? 'Account reactivated' : 'Account suspended');
    } catch (e) {
      setError(e);
    }
  }

  async function reset(s: Staff) {
    if (!(await confirm(`Reset password for ${s.fullName}?`, 'A temporary password is created and they are signed out everywhere.', 'Reset password'))) return;
    setError(null);
    try {
      const r = await api<{ temporaryPassword: string }>(`/staff/${s.id}/reset-password`, { method: 'POST' });
      setSecret({ who: s.fullName, code: s.email, password: r.temporaryPassword });
      refresh();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="pg">
      <div className="pg-head">
        <div>
          <h1>Staff</h1>
          <p className="muted">Who can sign in to this portal, and what each person can do</p>
        </div>
        {write && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add staff member
          </button>
        )}
      </div>

      <div className="pg-tabs" role="group" aria-label="Role">
        {tabs.map(([r, label, n]) => (
          <button key={r || 'all'} type="button" aria-pressed={role === r} onClick={() => { setRole(r); setPage(1); }}>
            <span>{label}</span>
            <b>{n === undefined ? DASH : n.toLocaleString('en-IN')}</b>
          </button>
        ))}
      </div>

      <ErrorNote error={error} />

      <section className="pg-card">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="pg-pad"><ErrorNote error={q.error} /></div>
        ) : !q.data!.items.length ? (
          <div className="pg-pad"><Empty title="No staff accounts match" /></div>
        ) : (
          <div className="pg-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Phone</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  {write && <th className="num"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <div className="pg-person">
                        <span className={`pg-avatar ${AVATAR[i % AVATAR.length]}`} aria-hidden="true">{initials(s.fullName)}</span>
                        <span>
                          <span className="pg-strong">
                            {s.fullName}
                            {s.id === me?.id && <span className="pg-you">You</span>}
                          </span>
                          <span className="pg-sub">{s.email}</span>
                        </span>
                      </div>
                    </td>
                    <td><span className={`pg-pill ${ROLE_TONE(s.role)}`}>{ROLE_LABEL[s.role]}</span></td>
                    <td>{s.phone || <span className="muted">{DASH}</span>}</td>
                    <td>{s.mustChangePassword && !s.lastLoginAt ? <span className="muted">Not yet</span> : fmtAgo(s.lastLoginAt)}</td>
                    <td><StatusPill status={s.status} /></td>
                    {write && (
                      <td className="actions">
                        {manageable(s.role) && s.id !== me?.id && (
                          <>
                            <button className="btn btn-quiet btn-sm" onClick={() => setEditing(s)}>Edit</button>
                            <button className="btn btn-quiet btn-sm" onClick={() => void reset(s)}>Reset password</button>
                            {s.status === 'ACTIVE' ? (
                              <button className="btn btn-quiet btn-sm danger-text" onClick={() => void changeStatus(s, 'SUSPENDED')}>Suspend</button>
                            ) : (
                              <button className="btn btn-quiet btn-sm" onClick={() => void changeStatus(s, 'ACTIVE')}>Reactivate</button>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && q.data.total > 0 && (
          <div className="pg-foot">
            <span>{q.data.total} staff account{q.data.total === 1 ? '' : 's'}</span>
            {q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
          </div>
        )}
      </section>

      <Modal open={!!editing} title={editing === 'new' ? 'Add staff member' : 'Edit staff member'} onClose={() => setEditing(null)}>
        {editing && (
          <StaffForm
            staff={editing === 'new' ? null : editing}
            roles={ROLES.filter(manageable)}
            onCreated={(s, pw) => { refresh(); setEditing(null); setSecret({ who: s.fullName, code: s.email, password: pw }); }}
            onSaved={() => { refresh(); setEditing(null); toast('Staff member saved'); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={!!secret} title="Temporary password" onClose={() => setSecret(null)}>
        {secret && (
          <>
            <CredentialSlip who={secret.who} code={secret.code} password={secret.password} note="Share this securely. It is shown only once and must be changed at first sign-in." />
            <div className="form-actions"><button className="btn btn-primary" onClick={() => setSecret(null)}>Done</button></div>
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}

function StaffForm({
  staff,
  roles,
  onCreated,
  onSaved,
  onCancel,
}: {
  staff: Staff | null;
  roles: StaffRole[];
  onCreated: (s: Staff, pw: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({ email: staff?.email ?? '', fullName: staff?.fullName ?? '', phone: staff?.phone ?? '', role: staff?.role ?? ('TEACHER' as StaffRole) });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (staff) {
        await api(`/staff/${staff.id}`, { method: 'PATCH', body: { fullName: f.fullName, phone: f.phone || undefined, role: f.role } });
        onSaved();
      } else {
        const r = await api<{ staff: Staff; temporaryPassword: string }>('/staff', { method: 'POST', body: { ...f, phone: f.phone || undefined } });
        onCreated(r.staff, r.temporaryPassword);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <Field label="Full name"><input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
      <Field label="Email" hint={staff ? 'Email is the sign-in ID and cannot be changed' : 'Used to sign in'}>
        <input type="email" required value={f.email} disabled={!!staff} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Phone"><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Role" hint={staff ? 'Changing the role signs them out so new permissions apply' : undefined}>
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : staff ? 'Save changes' : 'Add staff member'}</button>
      </div>
    </form>
  );
}
