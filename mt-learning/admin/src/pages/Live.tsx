import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { localInputToIso, useClasses } from '../api/hooks';
import type { LiveClass, LiveQuestion } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ClassSubjectPicker } from '../components/ClassSubjectPicker';
import { Icon, SubjectChip } from '../components/icons';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, useConfirm, useToast } from '../components/ui';
import { fmtAgo } from '../lib/format';

const STATE: Record<LiveClass['state'], [string, string]> = {
  live: ['Live now', 'pill-live'],
  scheduled: ['Scheduled', 'pill-board'],
  ended: ['Ended', 'pill-neutral'],
  cancelled: ['Cancelled', 'pill-bad'],
};
const when = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export function LivePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<LiveClass | null>(null);
  const [error, setError] = useState<unknown>(null);
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const q = useQuery({ queryKey: ['live'], queryFn: () => api<LiveClass[]>('/live-classes', { query: { from } }), refetchInterval: 30_000 });
  const rows = q.data ?? [];
  const now = rows.filter((l) => l.state === 'live');
  const upcoming = rows.filter((l) => l.state === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = rows.filter((l) => l.state === 'ended' || l.state === 'cancelled');

  const table = (list: LiveClass[]) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Subject</th>
            <th>For</th>
            <th>When</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((l) => (
            <tr key={l.id}>
              <td>
                <b>{l.title}</b>
                <div className="tiny muted">{l.teacherName ?? 'No teacher set'}</div>
              </td>
              <td>
                <SubjectChip code={l.subjectCode} name={l.subjectName} />
              </td>
              <td className="small">
                {l.className}
                {l.sectionName && ` · ${l.sectionName}`}
              </td>
              <td className="small nowrap">
                {when.format(new Date(l.startsAt))}–{time.format(new Date(l.endsAt))}
              </td>
              <td>
                <span className={`pill ${STATE[l.state][1]}`}>{STATE[l.state][0]}</span>
              </td>
              <td className="num nowrap">
                {(l.state === 'live' || l.state === 'scheduled') && (
                  <a className="btn btn-quiet btn-sm" href={l.joinUrl} target="_blank" rel="noreferrer">
                    Open meeting
                  </a>
                )}
                <button className="btn btn-quiet btn-sm" onClick={() => setOpen(l)}>
                  Questions
                </button>
                {can(P.LiveWrite) && l.state === 'scheduled' && (
                  <button
                    className="btn btn-quiet btn-sm danger-text"
                    onClick={async () => {
                      if (!(await confirm(`Cancel “${l.title}”?`, 'Students see that the class is cancelled.', 'Cancel class', true))) return;
                      setError(null);
                      try {
                        await api(`/live-classes/${l.id}/cancel`, { method: 'POST' });
                        void qc.invalidateQueries({ queryKey: ['live'] });
                        toast('Live class cancelled');
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHead
        title="Live classes"
        sub="Students join from their tablet during the class (and up to 10 minutes before). Links must be on an approved meeting platform."
        actions={
          can(P.LiveWrite) && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Schedule live class
            </button>
          )
        }
      />
      <ErrorNote error={error} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !rows.length ? (
        <Empty title="No live classes in the last two weeks or coming up">{can(P.LiveWrite) && 'Schedule one with a Jitsi, Google Meet, Zoom or Teams link.'}</Empty>
      ) : (
        <>
          {now.length > 0 && (
            <section className="stack">
              <h2 className="panel-title">Live now</h2>
              {table(now)}
            </section>
          )}
          {upcoming.length > 0 && (
            <section className="stack">
              <h2 className="panel-title">Coming up</h2>
              {table(upcoming)}
            </section>
          )}
          {past.length > 0 && (
            <section className="stack">
              <h2 className="panel-title">Past two weeks</h2>
              {table(past.slice(0, 30))}
            </section>
          )}
        </>
      )}
      <Modal open={adding} title="Schedule a live class" onClose={() => setAdding(false)}>
        {adding && (
          <LiveForm
            onDone={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ['live'] });
              toast('Live class scheduled. Students see it on their tablets.');
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Modal>
      <Modal open={!!open} title={open ? `Questions · ${open.title}` : ''} onClose={() => setOpen(null)}>
        {open && <Questions live={open} canReply={can(P.LiveWrite)} />}
      </Modal>
      {dialog}
    </>
  );
}

function LiveForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const classes = useClasses();
  const [pair, setPair] = useState({ classId: '', subjectId: '' });
  const [sectionId, setSectionId] = useState('');
  const [title, setTitle] = useState('');
  const start = new Date(Date.now() + 3_600_000);
  start.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}`);
  const [from, setFrom] = useState(`${p(start.getHours())}:00`);
  const [to, setTo] = useState(`${p((start.getHours() + 1) % 24)}:00`);
  const [joinUrl, setJoinUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cls = classes.data?.find((c) => c.id === pair.classId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/live-classes', {
        method: 'POST',
        body: { ...pair, sectionId: sectionId || undefined, title, startsAt: localInputToIso(`${date}T${from}`), endsAt: localInputToIso(`${date}T${to}`), joinUrl },
      });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="grid-form">
        <ClassSubjectPicker idPrefix="live" classId={pair.classId} subjectId={pair.subjectId} onChange={(v) => { setPair(v); setSectionId(''); }} />
        <Field label="Section">
          <select id="live-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Whole class</option>
            {cls?.sections.map((s) => (
              <option key={s.id} value={s.id}>
                Section {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input id="live-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Electrochemistry — EMF of a cell" />
        </Field>
        <Field label="Date">
          <input id="live-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid-form">
          <Field label="Starts">
            <input id="live-from" type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Ends">
            <input id="live-to" type="time" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Meeting link" hint="Jitsi (meet.jit.si), Google Meet, Zoom or Microsoft Teams">
            <input id="live-url" type="url" required value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} placeholder="https://meet.jit.si/mt-2puc-chemistry" />
          </Field>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Scheduling…' : 'Schedule class'}
        </button>
      </div>
    </form>
  );
}

function Questions({ live, canReply }: { live: LiveClass; canReply: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['live-q', live.id], queryFn: () => api<LiveQuestion[]>(`/live-classes/${live.id}/questions`), refetchInterval: 10_000 });
  const open = live.state === 'live' || live.state === 'scheduled';
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    try {
      await api(`/live-classes/${live.id}/questions`, { method: 'POST', body: { body: body.trim() } });
      setBody('');
      void qc.invalidateQueries({ queryKey: ['live-q', live.id] });
    } catch (err) {
      setError(err);
    }
  }
  return (
    <div className="stack">
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <p className="muted">No questions yet. Students can ask from their tablet during the class.</p>
      ) : (
        <div className="chat">
          {q.data.map((m) => (
            <div key={m.id} className={`chat-msg ${m.authorType === 'STAFF' ? 'staff' : ''}`}>
              <span className="small">
                <b>{m.authorName}</b> <span className="faint tiny">{fmtAgo(m.createdAt)}</span>
              </span>
              <span>{m.body}</span>
            </div>
          ))}
        </div>
      )}
      {canReply && open && (
        <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
          <input id="live-reply" aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Answer for everyone in the class" />
          <button className="btn btn-primary">Send</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
