import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardSummary, Page, Student, Tablet, TabletStatus } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Field, Loading, Modal, Pager, TabletPill, useConfirm, useToast } from '../components/ui';
import { fmtAgo, TABLET_LABEL } from '../lib/format';
import './AdminPages.css';

type Dlg = { kind: 'enroll' } | { kind: 'edit'; t: Tablet } | { kind: 'assign'; t: Tablet } | { kind: 'status'; t: Tablet } | null;

const DASH = '\u2014';
const DAY = 86_400_000;
const TONE: Record<TabletStatus, string> = { ASSIGNED: 'green', IN_STOCK: 'blue', UNDER_REPAIR: 'orange', LOST: 'red', RETIRED: 'grey' };
const TABS: [TabletStatus | '', string][] = [
  ['', 'All tablets'],
  ['ASSIGNED', 'With students'],
  ['IN_STOCK', 'In stock'],
  ['UNDER_REPAIR', 'Under repair'],
  ['LOST', 'Lost'],
];

/** Green: checked in today; amber: this week; red: longer ago or never. */
function seenTone(t: Tablet) {
  if (t.status !== 'ASSIGNED') return 'none';
  const ago = t.lastSeenAt ? Date.now() - new Date(t.lastSeenAt).getTime() : Infinity;
  return ago <= DAY ? 'on' : ago <= 7 * DAY ? 'low' : 'off';
}

export function TabletsPage() {
  const { can } = useAuth();
  const write = can(P.TabletsWrite);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState<TabletStatus | ''>('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ['tablets', status, applied, page],
    queryFn: () => api<Page<Tablet>>('/tablets', { query: { status, search: applied, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardSummary>('/dashboard/summary'), enabled: can(P.DashboardView), staleTime: 60_000 });
  const byStatus = summary.data?.tablets.byStatus;
  const countOf = (s: TabletStatus | '') => (byStatus ? (s ? (byStatus[s] ?? 0) : summary.data!.tablets.total) : undefined);

  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ['tablets'] });
    void qc.invalidateQueries({ queryKey: ['students'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(msg);
    setDlg(null);
  };

  async function unassign(t: Tablet) {
    if (!(await confirm('Unassign this tablet?', <>{t.student?.fullName} will be signed out and the tablet returns to stock.</>, 'Unassign'))) return;
    setError(null);
    try {
      await api(`/tablets/${t.id}/unassign`, { method: 'POST' });
      done('Tablet unassigned');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="pg">
      <div className="pg-head">
        <div>
          <h1>Tablets</h1>
          <p className="muted">Which college tablet each student uses, and when it last checked in</p>
        </div>
        {write && (
          <button className="btn btn-primary" onClick={() => setDlg({ kind: 'enroll' })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Enroll tablet
          </button>
        )}
      </div>

      <div className="pg-tabs" role="group" aria-label="Show">
        {TABS.map(([s, label]) => {
          const n = countOf(s);
          return (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
              <span>{label}</span>
              <b>{n === undefined ? DASH : n.toLocaleString('en-IN')}</b>
            </button>
          );
        })}
      </div>

      <ErrorNote error={error} />

      <section className="pg-card">
        <form className="pg-filters" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setPage(1); }}>
          <label className="pg-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" aria-label="Search tablets" placeholder="Serial, asset tag, model or student" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => { setApplied(search.trim()); setPage(1); }} />
          </label>
          <label className="pg-select">
            Status
            <select value={status} onChange={(e) => { setStatus(e.target.value as TabletStatus | ''); setPage(1); }}>
              <option value="">Any</option>
              {Object.entries(TABLET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </form>

        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="pg-pad"><ErrorNote error={q.error} /></div>
        ) : !q.data!.items.length ? (
          <div className="pg-pad">
            <Empty title={applied || status ? 'No tablets match' : 'No tablets enrolled yet'}>{write && !applied && !status && 'Enroll each tablet by its serial number before handing it to a student.'}</Empty>
          </div>
        ) : (
          <div className="pg-table">
            <table>
              <thead>
                <tr>
                  <th>Tablet</th>
                  <th>Model</th>
                  <th>Student</th>
                  <th>Last check-in</th>
                  <th>Status</th>
                  {write && <th className="num"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="pg-person">
                        <span className={`pg-avatar sq ${t.status === 'ASSIGNED' ? 'navy' : 'grey'}`} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
                        </span>
                        <span>
                          <span className="pg-strong pg-mono">{t.serialNumber}</span>
                          {t.assetTag && <span className="pg-sub">Tag {t.assetTag}</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      {t.model}
                      {(t.androidVersion || t.appVersion) && (
                        <div className="pg-sub">
                          {t.androidVersion && `Android ${t.androidVersion}`}
                          {t.androidVersion && t.appVersion && ', '}
                          {t.appVersion && `app ${t.appVersion}`}
                        </div>
                      )}
                    </td>
                    <td>{t.student ? <Link className="pg-strong" to={`/students/${t.student.id}`}>{t.student.fullName}</Link> : <span className="muted">{DASH}</span>}</td>
                    <td>
                      {t.status === 'ASSIGNED' ? (
                        <span className={`pg-dot ${seenTone(t)}`}><i aria-hidden="true" />{t.lastSeenAt ? fmtAgo(t.lastSeenAt) : 'Never'}</span>
                      ) : (
                        <span className="muted">{DASH}</span>
                      )}
                    </td>
                    <td><span className={`pg-pill ${TONE[t.status]}`}>{TABLET_LABEL[t.status]}</span></td>
                    {write && (
                      <td className="actions">
                        {t.status === 'IN_STOCK' && <button className="btn btn-primary btn-sm" onClick={() => setDlg({ kind: 'assign', t })}>Assign</button>}
                        {t.status === 'ASSIGNED' && <button className="btn btn-quiet btn-sm" onClick={() => void unassign(t)}>Unassign</button>}
                        {t.status !== 'RETIRED' && <button className="btn btn-quiet btn-sm" onClick={() => setDlg({ kind: 'status', t })}>Status</button>}
                        <button className="btn btn-quiet btn-sm" onClick={() => setDlg({ kind: 'edit', t })}>Edit</button>
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
            <span>{q.data.total.toLocaleString('en-IN')} tablet{q.data.total === 1 ? '' : 's'}</span>
            {q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
          </div>
        )}
      </section>

      <Modal open={dlg?.kind === 'enroll' || dlg?.kind === 'edit'} title={dlg?.kind === 'edit' ? 'Edit tablet' : 'Enroll tablet'} onClose={() => setDlg(null)}>
        {(dlg?.kind === 'enroll' || dlg?.kind === 'edit') && (
          <TabletForm t={dlg.kind === 'edit' ? dlg.t : null} onDone={() => done(dlg.kind === 'edit' ? 'Tablet saved' : 'Tablet enrolled')} onCancel={() => setDlg(null)} />
        )}
      </Modal>
      <Modal open={dlg?.kind === 'assign'} title="Assign tablet" onClose={() => setDlg(null)}>
        {dlg?.kind === 'assign' && <AssignForm t={dlg.t} onDone={() => done('Tablet assigned')} onCancel={() => setDlg(null)} />}
      </Modal>
      <Modal open={dlg?.kind === 'status'} title="Change tablet status" onClose={() => setDlg(null)}>
        {dlg?.kind === 'status' && <StatusForm t={dlg.t} onDone={() => done('Tablet status changed')} onCancel={() => setDlg(null)} />}
      </Modal>
      {dialog}
    </div>
  );
}

function TabletForm({ t, onDone, onCancel }: { t: Tablet | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ serialNumber: t?.serialNumber ?? '', assetTag: t?.assetTag ?? '', model: t?.model ?? '', androidVersion: t?.androidVersion ?? '', notes: t?.notes ?? '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const common = { assetTag: f.assetTag || null, model: f.model, androidVersion: f.androidVersion || null, notes: f.notes || null };
      if (t) await api(`/tablets/${t.id}`, { method: 'PATCH', body: common });
      else await api('/tablets', { method: 'POST', body: { serialNumber: f.serialNumber, ...common } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <Field label="Serial number" hint={t ? 'Serial numbers cannot be changed' : 'Settings -> About tablet -> Status'}>
        <input required className="mono" value={f.serialNumber} disabled={!!t} onChange={upd('serialNumber')} autoFocus={!t} />
      </Field>
      <div className="grid-form">
        <Field label="Model"><input required value={f.model} onChange={upd('model')} placeholder="Samsung Galaxy Tab A9+" /></Field>
        <Field label="Asset tag"><input value={f.assetTag} onChange={upd('assetTag')} /></Field>
      </div>
      <Field label="Android version"><input value={f.androidVersion} onChange={upd('androidVersion')} placeholder="14" /></Field>
      <Field label="Notes"><textarea rows={2} value={f.notes} onChange={upd('notes')} /></Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : t ? 'Save tablet' : 'Enroll tablet'}</button>
      </div>
    </form>
  );
}

function AssignForm({ t, onDone, onCancel }: { t: Tablet; onDone: () => void; onCancel: () => void }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Student | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const results = useQuery({
    queryKey: ['students', 'assign', search],
    queryFn: () => api<Page<Student>>('/students', { query: { search, hasTablet: false, status: 'ACTIVE', pageSize: 8 } }),
    enabled: search.trim().length >= 2,
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tablets/${t.id}/assign`, { method: 'POST', body: { studentId: picked.id } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">Tablet <span className="mono">{t.serialNumber}</span>, {t.model}</p>
      <Field label="Find student" hint="Active students without a tablet">
        <input type="search" autoFocus value={search} onChange={(e) => { setSearch(e.target.value); setPicked(null); }} placeholder="Name or student ID" />
      </Field>
      {results.data && (
        <ul className="pick-list" role="listbox" aria-label="Students">
          {results.data.items.length === 0 && <li className="muted">No matching students without a tablet.</li>}
          {results.data.items.map((s) => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected={picked?.id === s.id} className="pick" onClick={() => setPicked(s)}>
                <strong>{s.fullName}</strong>
                <span className="muted small"><span className="mono">{s.studentCode}</span> - {s.classGroup.name}, {s.section.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={!picked || busy}>{busy ? 'Assigning...' : picked ? `Assign to ${picked.fullName}` : 'Assign'}</button>
      </div>
    </form>
  );
}

const STATUS_HELP: Partial<Record<TabletStatus, string>> = {
  IN_STOCK: 'Ready to be assigned.',
  UNDER_REPAIR: 'Out for repair. Any student using it is signed out.',
  LOST: 'Reported lost or stolen. The student is signed out at once.',
  RETIRED: 'Permanently out of service. This cannot be undone.',
};

function StatusForm({ t, onDone, onCancel }: { t: Tablet; onDone: () => void; onCancel: () => void }) {
  const options = (['IN_STOCK', 'UNDER_REPAIR', 'LOST', 'RETIRED'] as const).filter((s) => s !== t.status);
  const [status, setStatus] = useState<(typeof options)[number]>(options[0]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/tablets/${t.id}/status`, { method: 'PATCH', body: { status, reason: reason || undefined } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">
        Tablet <span className="mono">{t.serialNumber}</span>
        {t.student && <>, currently with {t.student.fullName}. Changing the status removes the assignment.</>}
      </p>
      <fieldset className="radio-list">
        <legend className="field-label">New status</legend>
        {options.map((s) => (
          <label key={s} className="radio">
            <input type="radio" name="tstatus" checked={status === s} onChange={() => setStatus(s)} />
            <span><TabletPill status={s} /><span className="muted small">{STATUS_HELP[s]}</span></span>
          </label>
        ))}
      </fieldset>
      <Field label="Reason" hint="Kept in the audit log"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className={`btn ${status === 'RETIRED' || status === 'LOST' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'Saving...' : `Mark ${TABLET_LABEL[status].toLowerCase()}`}</button>
      </div>
    </form>
  );
}
