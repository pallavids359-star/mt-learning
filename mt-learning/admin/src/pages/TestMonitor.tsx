import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { MonitorData, MonitorRow } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ErrorNote, Field, Loading, Modal, useConfirm, useToast } from '../components/ui';

const REFRESH_MS = 5000;

type Filter = 'all' | 'writing' | 'not_started' | 'done';

const STATE: Record<MonitorRow['status'], { label: string; cls: string }> = {
  active: { label: 'Writing', cls: 'mon-state-ok' },
  inactive: { label: 'Not responding', cls: 'mon-state-warn' },
  time_over: { label: 'Time over', cls: 'mon-state-bad' },
  not_started: { label: 'Not started', cls: 'mon-state-muted' },
  submitted: { label: 'Done', cls: 'mon-state-done' },
};

function clock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function minutesAgo(iso: string | null, now: number) {
  if (!iso) return '';
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  return min <= 0 ? 'just now' : min === 1 ? '1 minute ago' : `${min} minutes ago`;
}

function timeOfDay(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function battery(r: MonitorRow) {
  if (r.battery === null) return null;
  return `${r.battery}%${r.charging ? ', charging' : ''}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Live view of a test while students take it: who needs help first, then everyone else. */
export function TestMonitorPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [reviving, setReviving] = useState<MonitorRow | null>(null);
  const [error, setError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => api<MonitorData>(`/tests/${id}/monitor`),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  // Count time down every second between refreshes.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ticked = q.dataUpdatedAt ? Math.floor((now - q.dataUpdatedAt) / 1000) : 0;

  const all = q.data?.students ?? [];
  const help = all.filter((r) => r.status === 'inactive' || r.status === 'time_over');
  const others = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (r.status === 'inactive' || r.status === 'time_over') return false;
      if (filter === 'writing' && r.status !== 'active') return false;
      if (filter === 'not_started' && r.status !== 'not_started') return false;
      if (filter === 'done' && r.status !== 'submitted') return false;
      return !term || r.studentName.toLowerCase().includes(term) || r.studentCode.toLowerCase().includes(term) || (r.tablet ?? '').toLowerCase().includes(term);
    });
  }, [all, filter, search]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const s = d.summary;
  const canAct = can(P.TestsReview);
  const closesIn = Math.max(0, Math.round((new Date(d.test.closesAt).getTime() - now) / 60000));
  const left = (r: MonitorRow) => (r.remainingSec === null ? null : Math.max(0, r.remainingSec - ticked));

  async function act(r: MonitorRow, kind: 'force-submit' | 'restart') {
    const ok =
      kind === 'force-submit'
        ? await confirm(
            `Submit ${r.studentName}'s test now?`,
            <p>
              The {r.attended} answer{r.attended === 1 ? '' : 's'} saved so far will be marked. Their tablet will show that the test was submitted by a teacher. You can still revive it later if needed.
            </p>,
            'Submit now',
          )
        : await confirm(
            `Start ${r.studentName}'s test again?`,
            <p>
              Their {r.attended} saved answer{r.attended === 1 ? '' : 's'}
              {r.submission !== 'not_submitted' ? ' and score' : ''} will be deleted. They start again from question 1 with the full time.
            </p>,
            'Delete and start again',
            true,
          );
    if (!ok) return;
    setError(null);
    try {
      await api(`/tests/${id}/attempts/${r.attemptId}/${kind}`, { method: 'POST' });
      toast(kind === 'force-submit' ? `${r.studentName}'s test was submitted` : `${r.studentName} can start again`);
      void qc.invalidateQueries({ queryKey: ['monitor', id] });
      void qc.invalidateQueries({ queryKey: ['tests'] });
    } catch (e) {
      setError(e);
    }
  }

  const live = d.test.state === 'open';

  return (
    <>
      <div className="mon-head">
        <div>
          <Link to="/tests" className="crumb">
            Live tests
          </Link>
          <h1>{d.test.title}</h1>
          <p className="page-sub">
            {d.test.questionCount} questions · {d.test.durationMin} minutes · ends at {timeOfDay(d.test.closesAt)}
          </p>
        </div>
        <div className="mon-head-side">
          <span className={`mon-live${live ? '' : ' off'}`}>
            <span className="mon-dot" aria-hidden />
            {live ? `Test running · ${closesIn} min left` : d.test.state === 'closed' ? 'Test has ended' : 'Not open yet'}
          </span>
          <div className="mon-head-links">
            <Link to={`/tests/${id}`}>Test details</Link>
            {can(P.TestsReview) && <Link to={`/tests/${id}/results`}>Results</Link>}
          </div>
        </div>
      </div>

      {error ? <ErrorNote error={error} /> : null}

      <div className="mon-big">
        <div className="mon-big-card">
          <b className="mon-ok">{s.active}</b>
          <span>writing now</span>
        </div>
        <div className={`mon-big-card${help.length ? ' warn' : ''}`}>
          <b className={help.length ? 'mon-warn' : ''}>{help.length}</b>
          <span>{help.length === 1 ? 'needs your help' : 'need your help'}</span>
        </div>
        <div className="mon-big-card">
          <b>
            {s.submitted} <small>of {s.total} done</small>
          </b>
          <span>{s.notStarted === 0 ? 'Everyone has started' : `${s.notStarted} ${s.notStarted === 1 ? 'has' : 'have'} not started`}</span>
        </div>
      </div>

      {help.length > 0 && (
        <section className="mon-section">
          <h2>Needs your help</h2>
          {help.map((r) => (
            <div key={r.studentId} className="mon-help">
              <span className="mon-avatar" aria-hidden>
                {initials(r.studentName)}
              </span>
              <div className="mon-help-text">
                <span className="mon-name">
                  {r.studentName}
                  <span>
                    {' '}
                    · {r.studentCode}
                    {r.tablet ? ` · ${r.tablet}` : ''}
                  </span>
                </span>
                <span className="mon-problem">
                  {r.status === 'time_over' ? 'Time ran out and the tablet has not submitted' : `Tablet stopped responding ${minutesAgo(r.lastActivity, now)}`}
                </span>
                <span className="mon-detail">
                  Was on question {r.currentQuestion ?? 1} · {r.attended} answered · {r.skipped} skipped
                  {battery(r) ? ` · battery ${battery(r)}` : ''}
                </span>
              </div>
              {canAct && (
                <div className="mon-actions">
                  <button className="btn btn-primary" onClick={() => setReviving(r)}>
                    Revive
                  </button>
                  <button className="btn btn-quiet" onClick={() => void act(r, 'force-submit')}>
                    Submit for them
                  </button>
                  <button className="btn btn-quiet danger-text" onClick={() => void act(r, 'restart')}>
                    Start again
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="mon-section">
        <div className="mon-section-head">
          <h2>Everyone{help.length ? ' else' : ''}</h2>
          <div className="mon-tools">
            <div className="seg-tabs" role="group" aria-label="Show">
              {(
                [
                  ['all', 'All'],
                  ['writing', 'Writing'],
                  ['not_started', 'Not started'],
                  ['done', 'Done'],
                ] as const
              ).map(([f, label]) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            <input type="search" placeholder="Find a student or tablet" aria-label="Find a student or tablet" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="mon-list">
          {others.length === 0 && <p className="mon-empty">No students here.</p>}
          {others.map((r) => {
            const t = left(r);
            const pct = d.test.questionCount ? Math.round((r.attended / d.test.questionCount) * 100) : 0;
            return (
              <div key={r.studentId} className="mon-row">
                <div className="mon-who">
                  <Link to={`/students/${r.studentId}`} className="mon-name">
                    {r.studentName}
                  </Link>
                  <span className="mon-sub">
                    {r.studentCode} · {r.tablet ?? 'no tablet yet'}
                  </span>
                </div>
                <div className="mon-progress">
                  <span>
                    {r.status === 'not_started'
                      ? 'Has not opened the test'
                      : r.status === 'submitted'
                        ? `Submitted at ${timeOfDay(r.submittedAt)}${r.score !== null ? ` · scored ${r.score} / ${r.maxScore}` : ''}${r.submittedByStaff ? ' · by staff' : ''}`
                        : `On Q${r.currentQuestion ?? 1} · ${r.attended} answered · ${r.left} left · ${r.skipped} skipped`}
                  </span>
                  <div className="mon-bar">
                    <div className={r.status === 'submitted' ? 'done' : ''} style={{ width: `${r.status === 'not_started' ? 0 : pct}%` }} />
                  </div>
                </div>
                <span className="mon-cell">{battery(r) ? `Battery ${battery(r)}` : ''}</span>
                <span className="mon-cell mono">{r.status === 'active' && t !== null ? `${clock(t)} left` : ''}</span>
                <span className={`mon-state ${STATE[r.status].cls}`}>
                  {STATE[r.status].label}
                  {r.revived && r.status === 'active' ? ' (revived)' : ''}
                </span>
                {canAct && (
                  <span className="mon-more">
                    {r.attemptId && (
                      <details>
                        <summary className="btn btn-quiet btn-sm">More</summary>
                        <div className="mon-menu">
                          <button onClick={() => setReviving(r)}>Revive (more time)</button>
                          {r.status !== 'submitted' && <button onClick={() => void act(r, 'force-submit')}>Submit for them</button>}
                          <button className="danger-text" onClick={() => void act(r, 'restart')}>
                            Start again
                          </button>
                        </div>
                      </details>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mon-foot">
          Updates every 5 seconds. “Not responding” means the tablet hasn’t checked in for a minute: the app was closed, the tablet is off, or Wi-Fi dropped. Students taking the test
          fully offline show as “Not started” until their answers upload.
        </p>
      </section>

      <Modal open={!!reviving} title={reviving ? `Revive ${reviving.studentName}'s test` : ''} onClose={() => setReviving(null)}>
        {reviving && (
          <ReviveForm
            row={reviving}
            testId={id!}
            onDone={() => {
              toast(`${reviving.studentName} can continue from question ${reviving.currentQuestion ?? 1}`);
              setReviving(null);
              void qc.invalidateQueries({ queryKey: ['monitor', id] });
            }}
            onCancel={() => setReviving(null)}
          />
        )}
      </Modal>
      {dialog}
    </>
  );
}

function ReviveForm({ row, testId, onDone, onCancel }: { row: MonitorRow; testId: string; onDone: () => void; onCancel: () => void }) {
  const [minutes, setMinutes] = useState(row.remainingSec && row.remainingSec > 60 ? Math.ceil(row.remainingSec / 60) : 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/tests/${testId}/attempts/${row.attemptId}/revive`, { method: 'POST', body: { minutes } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p>
        {row.studentName} continues from <b>question {row.currentQuestion ?? 1}</b> with their <b>{row.attended}</b> saved answer{row.attended === 1 ? '' : 's'}.
        {row.submission !== 'not_submitted' && ' Their submission and score are cleared until they submit again.'} They open the test again from Live tests, on this or another tablet.
      </p>
      {error ? <ErrorNote error={error} /> : null}
      <Field label="Minutes they get from now" hint="Works even if the test has ended for everyone else.">
        <input type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} />
      </Field>
      <div className="form-actions">
        <button className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Reviving…' : 'Revive test'}
        </button>
      </div>
    </div>
  );
}
