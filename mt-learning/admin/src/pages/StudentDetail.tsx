import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { sectionOptions, useClasses, useHostels } from '../api/hooks';
import type { AccountStatus, AuditEntry, Gender, Page, Student } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { CredentialSlip, ErrorNote, Field, Loading, Modal, PageHead, StatusPill, useToast } from '../components/ui';
import { fmtAction, fmtAgo, fmtDate, fmtDateTime } from '../lib/format';

type Dialog = 'edit' | 'transfer' | 'status' | 'reset' | null;

export function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api<Student>(`/students/${id}`) });
  const audit = useQuery({
    queryKey: ['audit', 'student', id],
    queryFn: () => api<Page<AuditEntry>>('/audit-logs', { query: { entityType: 'student', entityId: id, pageSize: 15 } }),
    enabled: can(P.AuditRead),
  });

  const refresh = (s?: Student) => {
    if (s) qc.setQueryData(['student', id], s);
    void qc.invalidateQueries({ queryKey: ['students'] });
    void qc.invalidateQueries({ queryKey: ['audit', 'student', id] });
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const s = q.data!;
  const locked = s.lockedUntil && new Date(s.lockedUntil) > new Date();

  return (
    <>
      <p className="crumb">
        <Link to="/students">Students</Link>
      </p>
      <PageHead
        title={s.fullName}
        sub={
          <>
            <span className="mono">{s.studentCode}</span> <StatusPill status={s.status} />
          </>
        }
        actions={
          <>
            {can(P.StudentsWrite) && (
              <>
                <button className="btn btn-quiet" onClick={() => setDialog('edit')}>
                  Edit details
                </button>
                <button className="btn btn-quiet" onClick={() => setDialog('transfer')}>
                  Transfer
                </button>
                <button className="btn btn-quiet" onClick={() => setDialog('status')}>
                  Change status
                </button>
              </>
            )}
            {can(P.StudentsCredentials) && (
              <button className="btn btn-primary" onClick={() => setDialog('reset')}>
                Reset password
              </button>
            )}
          </>
        }
      />

      {locked && <p className="callout">Sign-in is temporarily locked after repeated failed attempts. Resetting the password unlocks it.</p>}

      <div className="profile">
        <Photo student={s} canEdit={can(P.StudentsWrite)} onChanged={(x) => { refresh(x); toast('Photo updated'); }} />
        <section className="panel">
          <dl className="facts">
            <div><dt>Class</dt><dd>{s.classGroup.name}, section {s.section.name}</dd></div>
            <div><dt>Roll number</dt><dd>{s.rollNumber}</dd></div>
            <div><dt>Hostel</dt><dd>{s.hostel ? `${s.hostel.name}${s.roomNumber ? `, room ${s.roomNumber}` : ''}` : 'Day scholar'}</dd></div>
            <div><dt>Date of birth</dt><dd>{fmtDate(s.dateOfBirth)}</dd></div>
            <div><dt>Gender</dt><dd>{s.gender ? s.gender.charAt(0) + s.gender.slice(1).toLowerCase() : '—'}</dd></div>
            <div><dt>Parent / guardian</dt><dd>{s.guardianName ?? '—'}{s.guardianPhone && <span className="muted"> · {s.guardianPhone}</span>}</dd></div>
            <div><dt>Tablet</dt><dd>{s.tablet ? <><span className="mono">{s.tablet.serialNumber}</span> <span className="muted">· {s.tablet.model}, seen {fmtAgo(s.tablet.lastSeenAt).toLowerCase()}</span></> : 'Not assigned'}</dd></div>
            <div><dt>Sign-in</dt><dd>{s.mustChangePassword ? 'Waiting for first sign-in' : `Last signed in ${fmtAgo(s.lastLoginAt).toLowerCase()}`}{s.hasPin && <span className="muted"> · PIN set</span>}</dd></div>
          </dl>
        </section>
      </div>


      {audit.data && (
        <section className="panel">
          <h2 className="panel-title">History</h2>
          {audit.data.items.length === 0 ? (
            <p className="muted">No recorded actions yet.</p>
          ) : (
            <ul className="activity">
              {audit.data.items.map((a) => (
                <li key={a.id}>
                  <span>{fmtAction(a.action)}</span>
                  <span className="muted small">{a.actorLabel ?? 'System'}, {fmtDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={dialog === 'edit'} title="Edit details" onClose={() => setDialog(null)} wide>
        <EditForm s={s} onDone={(x) => { refresh(x); setDialog(null); toast('Details saved'); }} onCancel={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === 'transfer'} title="Transfer to another section" onClose={() => setDialog(null)}>
        <TransferForm s={s} onDone={(x) => { refresh(x); setDialog(null); toast('Student transferred'); }} onCancel={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === 'status'} title="Change account status" onClose={() => setDialog(null)}>
        <StatusForm s={s} onDone={(x) => { refresh(x); setDialog(null); toast('Status changed'); }} onCancel={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === 'reset'} title="Reset password" onClose={() => setDialog(null)}>
        <ResetForm s={s} onDone={() => refresh()} onClose={() => setDialog(null)} />
      </Modal>
    </>
  );
}

function Photo({ student, canEdit, onChanged }: { student: Student; canEdit: boolean; onChanged: (s: Student) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!student.hasPhoto) return setUrl(null);
    let objectUrl: string | null = null;
    api<Blob>(`/students/${student.id}/photo`, { raw: true })
      .then((b) => setUrl((objectUrl = URL.createObjectURL(b))))
      .catch(() => setUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [student.id, student.hasPhoto, student]);

  async function upload(file: File) {
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      onChanged(await api<Student>(`/students/${student.id}/photo`, { method: 'POST', form }));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="photo-box">
      {url ? <img src={url} alt={`Photograph of ${student.fullName}`} /> : <div className="photo-empty" aria-hidden>{student.fullName.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>}
      {canEdit && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <button className="btn btn-quiet btn-sm" onClick={() => input.current?.click()}>
            {student.hasPhoto ? 'Replace photo' : 'Upload photo'}
          </button>
          <ErrorNote error={error} />
        </>
      )}
    </section>
  );
}

function EditForm({ s, onDone, onCancel }: { s: Student; onDone: (s: Student) => void; onCancel: () => void }) {
  const hostels = useHostels();
  const [f, setF] = useState({
    fullName: s.fullName,
    rollNumber: s.rollNumber,
    dateOfBirth: s.dateOfBirth ?? '',
    gender: (s.gender ?? '') as Gender | '',
    guardianName: s.guardianName ?? '',
    guardianPhone: s.guardianPhone ?? '',
    hostelId: s.hostel?.id ?? '',
    roomNumber: s.roomNumber ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<Student>(`/students/${s.id}`, {
          method: 'PATCH',
          body: {
            fullName: f.fullName,
            rollNumber: f.rollNumber,
            dateOfBirth: f.dateOfBirth || null,
            gender: f.gender || null,
            guardianName: f.guardianName || null,
            guardianPhone: f.guardianPhone || null,
            hostelId: f.hostelId || null,
            roomNumber: f.hostelId ? f.roomNumber || null : null,
          },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid-form">
      <Field label="Full name"><input required value={f.fullName} onChange={upd('fullName')} /></Field>
      <Field label="Roll number"><input required value={f.rollNumber} onChange={upd('rollNumber')} /></Field>
      <Field label="Date of birth"><input type="date" value={f.dateOfBirth} onChange={upd('dateOfBirth')} /></Field>
      <Field label="Gender">
        <select value={f.gender} onChange={upd('gender')}>
          <option value="">Not recorded</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </Field>
      <Field label="Parent / guardian name"><input value={f.guardianName} onChange={upd('guardianName')} /></Field>
      <Field label="Parent / guardian phone"><input type="tel" value={f.guardianPhone} onChange={upd('guardianPhone')} /></Field>
      <Field label="Hostel">
        <select value={f.hostelId} onChange={upd('hostelId')}>
          <option value="">Day scholar (no hostel)</option>
          {hostels.data?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </Field>
      <Field label="Room number"><input value={f.roomNumber} onChange={upd('roomNumber')} disabled={!f.hostelId} /></Field>
      <div className="span-2">
        <ErrorNote error={error} />
        <div className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
        </div>
      </div>
    </form>
  );
}

function TransferForm({ s, onDone, onCancel }: { s: Student; onDone: (s: Student) => void; onCancel: () => void }) {
  const classes = useClasses();
  const [sectionId, setSectionId] = useState('');
  const [rollNumber, setRoll] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api<Student>(`/students/${s.id}/transfer`, { method: 'POST', body: { sectionId, rollNumber, reason: reason || undefined } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">Currently in {s.classGroup.name}, section {s.section.name}, roll {s.rollNumber}.</p>
      <Field label="Move to">
        <select required value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Choose…</option>
          {sectionOptions(classes.data).filter((o) => o.id !== s.section.id).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="New roll number"><input required value={rollNumber} onChange={(e) => setRoll(e.target.value)} /></Field>
      <Field label="Reason" hint="Kept in the audit log"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Transferring…' : 'Transfer student'}</button>
      </div>
    </form>
  );
}

const STATUS_HELP: Record<AccountStatus, string> = {
  ACTIVE: 'The student can sign in on their tablet.',
  SUSPENDED: 'Sign-in is blocked and the student is signed out now. Use for temporary restrictions.',
  DEACTIVATED: 'For students who have left the college. Sign-in is blocked and they are signed out now.',
};

function StatusForm({ s, onDone, onCancel }: { s: Student; onDone: (s: Student) => void; onCancel: () => void }) {
  const [status, setStatus] = useState<AccountStatus>(s.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api<Student>(`/students/${s.id}/status`, { method: 'PATCH', body: { status, reason: reason || undefined } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <fieldset className="radio-list">
        <legend className="field-label">Status</legend>
        {(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const).map((v) => (
          <label key={v} className="radio">
            <input type="radio" name="status" checked={status === v} onChange={() => setStatus(v)} />
            <span>
              <StatusPill status={v} />
              <span className="muted small">{STATUS_HELP[v]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Reason" hint="Kept in the audit log"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || status === s.status}>{busy ? 'Saving…' : 'Change status'}</button>
      </div>
    </form>
  );
}

function ResetForm({ s, onDone, onClose }: { s: Student; onDone: () => void; onClose: () => void }) {
  const [result, setResult] = useState<{ temporaryPassword: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (result) {
    return (
      <>
        <CredentialSlip who={s.fullName} code={s.studentCode} password={result.temporaryPassword} />
        <div className="form-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
      </>
    );
  }
  return (
    <div className="stack">
      <p>
        This creates a new temporary password for <strong>{s.fullName}</strong>, removes their PIN, unlocks sign-in and signs them out of their tablet.
      </p>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await api(`/students/${s.id}/reset-credentials`, { method: 'POST' }));
              onDone();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Resetting…' : 'Reset password'}
        </button>
      </div>
    </div>
  );
}
