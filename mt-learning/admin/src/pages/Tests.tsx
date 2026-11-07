import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useClasses } from '../api/hooks';
import type { MonitorData, Page, TestState, TestSummary } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { SubjectChip } from '../components/icons';
import { Empty, ErrorNote, Loading, Pager } from '../components/ui';
import './Tests.css';

export const STATE_PILL: Record<TestState, [string, string]> = {
  draft: ['Draft', 'pill-neutral'],
  upcoming: ['Scheduled', 'pill-board'],
  open: ['Open now', 'pill-ok'],
  closed: ['Closed', 'pill-neutral'],
};

/** Card status labels, matching the tabs. */
const STATE_LABEL: Record<TestState, string> = { open: 'Live', upcoming: 'Scheduled', draft: 'Draft', closed: 'Finished' };

/** Questions in a full paper of each exam (the editor's suggested totals). */
const FULL_PAPER: Record<string, number> = { NEET: 180, JEE: 75, KCET: 240 };

/** On the All tab: live tests first, then scheduled, drafts, and finished. */
const ORDER: Record<TestState, number> = { open: 0, upcoming: 1, draft: 2, closed: 3 };

const DOT = ' \u00b7 ';
const DASH = '\u2014';
const TABS: [TestState | '', string][] = [
  ['', 'All'],
  ['open', 'Live'],
  ['upcoming', 'Scheduled'],
  ['draft', 'Drafts'],
  ['closed', 'Finished'],
];

const clock = (d: Date) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(d).replace(/\s?([ap])\.?m\.?/i, ' $1m');
const day = (d: Date) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);

/** "Today \u00b7 10:00 am - 1:30 pm" for today, otherwise "Mon, 9 Nov \u00b7 10:00 am". */
function whenLine(opensAt: string, closesAt: string) {
  const o = new Date(opensAt);
  const c = new Date(closesAt);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(o, today)) return `Today${DOT}${clock(o)} \u2013 ${same(o, c) ? clock(c) : `${day(c)}, ${clock(c)}`}`;
  return `${day(o)}${DOT}${clock(o)}`;
}

function minutesLeft(iso: string) {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  return m >= 120 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

export function TestsPage() {
  const { can } = useAuth();
  const classes = useClasses();
  const [status, setStatus] = useState<TestState | ''>('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['tests', status, classId, page],
    queryFn: () => api<Page<TestSummary>>('/tests', { query: { status, classId, page, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });

  // How many tests are in each tab.
  const counts = useQueries({
    queries: TABS.map(([s]) => ({
      queryKey: ['tests-count', s, classId],
      queryFn: () => api<Page<TestSummary>>('/tests', { query: { status: s, classId, page: 1, pageSize: 1 } }),
      staleTime: 30_000,
    })),
  });

  // Live tests: how many students have started, from the live monitor.
  const open = (q.data?.items ?? []).filter((t) => t.state === 'open');
  const live = useQueries({
    queries: open.map((t) => ({
      queryKey: ['monitor', t.id],
      queryFn: () => api<MonitorData>(`/tests/${t.id}/monitor`),
      refetchInterval: 30_000,
    })),
  });
  const startedOf = new Map(open.map((t, i) => [t.id, live[i]?.data?.summary]));

  return (
    <div className="lt">
      <div className="lt-head">
        <div>
          <h1>Live tests</h1>
          <p className="muted">Tests students write on their tablets, at a set time</p>
        </div>
        {can(P.TestsWrite) && (
          <Link to="/tests/new" className="btn btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create live test
          </Link>
        )}
      </div>

      <div className="lt-bar">
        <div className="lt-tabs" role="group" aria-label="Test status">
          {TABS.map(([s, label], i) => (
            <button
              key={s || 'all'}
              type="button"
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {label}
              <span>{counts[i]?.data ? counts[i].data!.total : DASH}</span>
            </button>
          ))}
        </div>
        <label className="lt-class">
          Class
          <select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All classes</option>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title="No tests here">{can(P.TestsWrite) && 'Create a test and add its questions.'}</Empty>
      ) : (
        <div className="lt-grid">
          {[...q.data!.items].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map((t) => {
            const exam = t.examCode;
            const who = t.className.split(DOT)[0];
            const sum = startedOf.get(t.id);
            const needed = exam ? FULL_PAPER[exam] : undefined;
            let third: [string, string] = ['Students', String(t.studentCount)];
            if (t.state === 'closed') third = ['Average', t.averagePercent === null ? DASH : `${t.averagePercent}%`];
            if (t.state === 'draft' && needed) third = ['Needed', String(needed)];

            let bar: { pct: number; tone: string; text: string } | null = null;
            if (t.state === 'open' && sum) {
              const started = sum.total - sum.notStarted;
              bar = { pct: sum.total ? (started / sum.total) * 100 : 0, tone: 'red', text: `${started} of ${sum.total} have started${DOT}${minutesLeft(t.closesAt)}` };
            } else if (t.state === 'open') {
              bar = { pct: t.studentCount ? (t.submittedCount / t.studentCount) * 100 : 0, tone: 'red', text: `${t.submittedCount} of ${t.studentCount} submitted${DOT}${minutesLeft(t.closesAt)}` };
            } else if (t.state === 'draft' && needed) {
              bar = { pct: Math.min(100, (t.questionCount / needed) * 100), tone: 'grey', text: `${t.questionCount} of ${needed} questions added` };
            } else if (t.state === 'closed' && t.studentCount) {
              bar = { pct: (t.submittedCount / t.studentCount) * 100, tone: 'navy', text: `${t.submittedCount} of ${t.studentCount} submitted` };
            }

            const main =
              t.state === 'open'
                ? { to: `/tests/${t.id}/monitor`, label: 'Open live monitor', primary: true }
                : t.state === 'closed' && can(P.TestsReview)
                  ? { to: `/tests/${t.id}/results`, label: 'See results', primary: false }
                  : t.state === 'draft'
                    ? { to: `/tests/${t.id}`, label: 'Continue editing', primary: false }
                    : { to: `/tests/${t.id}`, label: can(P.TestsWrite) ? 'Edit test' : 'View test', primary: false };

            const more = [
              { to: `/tests/${t.id}`, label: t.state === 'draft' || t.state === 'upcoming' ? 'Edit test' : 'View test' },
              ...(t.state !== 'draft' ? [{ to: `/tests/${t.id}/monitor`, label: 'Live monitor' }] : []),
              ...(t.state !== 'draft' && can(P.TestsReview) ? [{ to: `/tests/${t.id}/results`, label: 'Results' }] : []),
            ].filter((m) => m.to !== main.to);

            return (
              <article key={t.id} className={`lt-card${t.state === 'open' ? ' live' : ''}`}>
                <div className="lt-card-top">
                  <span className="lt-who">
                    {exam ? <span className={`exam-tag ${exam}`}>{exam}</span> : <SubjectChip code={t.subjectCode} name={t.subjectName} />}
                    <span>{who}</span>
                  </span>
                  <span className={`lt-state ${t.state}`}>
                    <i aria-hidden="true" />
                    {STATE_LABEL[t.state]}
                  </span>
                </div>
                <div className="lt-title">
                  <h2>
                    <Link to={`/tests/${t.id}`}>{t.title}</Link>
                  </h2>
                  <span>
                    {t.state === 'draft' ? 'Not published yet' : whenLine(t.opensAt, t.closesAt)}
                  </span>
                </div>
                <div className="lt-stats">
                  <div>
                    <span>Questions</span>
                    <b>{t.questionCount}</b>
                  </div>
                  <div>
                    <span>Time</span>
                    <b>{t.durationMin} min</b>
                  </div>
                  <div>
                    <span>{third[0]}</span>
                    <b>{third[1]}</b>
                  </div>
                </div>
                {bar && (
                  <div className="lt-progress">
                    <div className="lt-meter">
                      <i className={bar.tone} style={{ width: `${bar.pct}%` }} />
                    </div>
                    <span>{bar.text}</span>
                  </div>
                )}
                {t.pendingReviewCount > 0 && <span className="lt-review">{t.pendingReviewCount} submission{t.pendingReviewCount === 1 ? '' : 's'} to review</span>}
                <div className="lt-actions">
                  <Link to={main.to} className={`btn ${main.primary ? 'btn-primary' : 'btn-quiet'}`}>
                    {main.label}
                  </Link>
                  {more.length > 0 && (
                    <details className="lt-more">
                      <summary aria-label={`More for ${t.title}`}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </summary>
                      <div className="lt-menu">
                        {more.map((m) => (
                          <Link key={m.to} to={m.to}>
                            {m.label}
                          </Link>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {q.data && q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
    </div>
  );
}
