import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Page, Student, Tablet, TabletStatus } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, Pager, TabletPill, useConfirm, useToast } from '../components/ui';
import { fmtAgo, TABLET_LABEL } from '../lib/format';

type Dlg = { kind: 'enroll' } | { kind: 'edit'; t: Tablet } | { kind: 'assign'; t: Tablet } | { kind: 'status'; t: Tablet } | null;

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
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ['tablets'] });
    void qc.invalidateQueries({ queryKey: ['students'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(msg);
    setDlg(null);
  };

  return (
    <>
      <PageHead
        title="Tablets"
        sub={q.data ? `${q.data.total} tablet${q.data.total === 1 ? '' : 's'}` : undefined}
        actions={write && <button className="btn btn-primary" onClick={() => setDlg({ kind: 'enroll' })}>Enroll tablet</button>}
      />
      <p className="muted narrow-text">
        This register tracks which college tablet each student uses. Locking tablets into the learning app is done through your MDM (Android Enterprise) in a later phase.
      </p>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setPage(1); }}>
        <input type="search" aria-label="Search tablets" placeholder="Serial, asset tag, model or student" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => { setApplied(search.trim()); setPage(1); }} />
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as TabletStatus | ''); setPage(1); }}>
          <option value="">Any status</option>
          {Object.entries(TABLET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </form>
      <ErrorNote error={error} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title={applied || status ? 'No tablets match' : 'No tablets enrolled yet'}>{write && !applied && !status && 'Enroll each tablet by its serial number before handing it to a student.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Serial number</th>
                <th>Model</th>
                <th>Assigned to</th>
                <th>Last seen</th>
                <th>Status</th>
                {write && <th className="num"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="mono">{t.serialNumber}</span>
                    {t.assetTag && <div className="muted small">Tag {t.assetTag}</div>}
                  </td>
                  <td>
                    {t.model}
                    {(t.androidVersion || t.appVersion) && (
                      <div className="muted small">
                        {t.androidVersion && `Android ${t.androidVersion}`}
                        {t.androidVersion && t.appVersion && ', '}
                        {t.appVersion && `app ${t.appVersion}`}
                      </div>
                    )}
                  </td>
                  <td>
                    {t.student ? (
                      <Link to={`/students/${t.student.id}`}>{t.student.fullName}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{t.status === 'ASSIGNED' ? fmtAgo(t.lastSeenAt) : <span className="muted">—</span>}</td>
                  <td><TabletPill status={t.status} /></td>
                  {write && (
                    <td className="num nowrap">
                      {t.status === 'IN_STOCK' && <button className="btn btn-quiet btn-sm" onClick={() => setDlg({ kind: 'assign', t })}>Assign</button>}
                      {t.status === 'ASSIGNED' && (
                        <button
                          className="btn btn-quiet btn-sm"
                          onClick={async () => {
                            if (!(await confirm('Unassign this tablet?', <>{t.student?.fullName} will be signed out and the tablet returns to stock.</>, 'Unassign'))) return;
                            setError(null);
                            try {
                              await api(`/tablets/${t.id}/unassign`, { method: 'POST' });
                              done('Tablet unassigned');
                            } catch (e) {
                              setError(e);
                            }
                          }}
                        >
                          Unassign
                        </button>
                      )}
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
      {q.data && q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}

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
    </>
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
      <Field label="Serial number" hint={t ? 'Serial numbers cannot be changed' : 'Settings → About tablet → Status'}>
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
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : t ? 'Save tablet' : 'Enroll tablet'}</button>
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
                <span className="muted small"><span className="mono">{s.studentCode}</span> · {s.classGroup.name}, {s.section.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={!picked || busy}>{busy ? 'Assigning…' : picked ? `Assign to ${picked.fullName}` : 'Assign'}</button>
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
        <button className={`btn ${status === 'RETIRED' || status === 'LOST' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'Saving…' : `Mark ${TABLET_LABEL[status].toLowerCase()}`}</button>
      </div>
    </form>
  );
}
