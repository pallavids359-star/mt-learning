import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useClasses } from '../api/hooks';
import type { AttemptRow, MarksSheet, Page, PendingReview, ReviewStatus, TestResults, TestSummary } from '../api/types';
import { HBar } from '../components/LineChart';
import { Empty, ErrorNote, Field, Kpi, Loading, Modal, PageHead, useToast } from '../components/ui';
import { fmtDateTime, fmtDuration, fmtWhen } from '../lib/format';
import { STATE_PILL } from './Tests';

const REVIEW: Record<ReviewStatus, [string, string]> = {
  NONE: ['Counted', 'pill-ok'],
  PENDING: ['Needs review', 'pill-warn'],
  ACCEPTED: ['Accepted', 'pill-ok'],
  REJECTED: ['Not counted', 'pill-bad'],
};

/** Results hub: pick Class 11 or 12, a class and a section to see every student's marks, ranked, and export them. */
export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const classes = useClasses();
  const year = (params.get('year') ?? '') as '' | 'PUC_1' | 'PUC_2';
  const sectionId = params.get('sectionId') ?? '';
  const [find, setFind] = useState('');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const inYear = (classes.data ?? []).filter((c) => !year || c.pucYear === year);
  // Only one class in the chosen year: pick it without asking.
  const classId = params.get('classId') ?? (year && inYear.length === 1 ? inYear[0].id : '');
  const cls = classes.data?.find((c) => c.id === classId);

  const pending = useQuery({ queryKey: ['reviews'], queryFn: () => api<PendingReview[]>('/tests/reviews/pending') });
  const sheet = useQuery({
    queryKey: ['marks', classId, sectionId],
    queryFn: () => api<MarksSheet>('/tests/marks', { query: { classId, sectionId } }),
    enabled: !!classId,
    placeholderData: keepPreviousData,
  });
  const tests = useQuery({
    queryKey: ['tests', 'results'],
    queryFn: () => api<Page<TestSummary>>('/tests', { query: { pageSize: 100 } }),
    placeholderData: keepPreviousData,
  });

  const term = find.trim().toLowerCase();
  const yearOf = new Map((classes.data ?? []).map((c) => [c.id, c.pucYear]));
  const testList = (tests.data?.items ?? []).filter(
    (t) =>
      t.state !== 'draft' &&
      t.submittedCount > 0 &&
      // Exam tests are for a year (or both); older tests for one class.
      (!year || (t.audience ? t.audience === 'BOTH' || t.audience === year : yearOf.get(t.classId ?? '') === year)) &&
      (!classId || t.classId === classId || (!!t.audience && (t.audience === 'BOTH' || t.audience === cls?.pucYear))) &&
      (!term || t.title.toLowerCase().includes(term) || t.subjectName.toLowerCase().includes(term)),
  );
  const people = (sheet.data?.students ?? []).filter((p) => !term || p.studentName.toLowerCase().includes(term) || p.studentCode.toLowerCase().includes(term));
  const sectionName = cls?.sections.find((x) => x.id === sectionId)?.name;

  return (
    <>
      <PageHead title="Results & marks" sub="Choose a class and section to see every student’s marks, highest first, and download them." />

      {!!pending.data?.length && (
        <section className="panel">
          <h2 className="panel-title">Submissions to review</h2>
          <p className="small muted">These were answered offline and uploaded after the test closed, or submitted past the time limit. Decide whether each one counts.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Test</th>
                <th>Why</th>
                <th className="num">Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.data.map((p) => (
                <tr key={p.attemptId}>
                  <td>
                    <b>{p.studentName}</b>
                    <div className="tiny muted mono">{p.studentCode}</div>
                  </td>
                  <td className="small">{p.testTitle}</td>
                  <td className="small">{p.reviewReason}</td>
                  <td className="num">
                    {p.score}/{p.maxScore}
                  </td>
                  <td className="num">
                    <Link className="btn btn-quiet btn-sm" to={`/tests/${p.testId}/results`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="filters marks-filters">
        <label className="marks-field">
          <span>Class</span>
          <select value={year} onChange={(e) => set({ year: e.target.value, classId: '', sectionId: '' })}>
            <option value="">Class 11 and 12</option>
            <option value="PUC_1">Class 11 (1st PUC)</option>
            <option value="PUC_2">Class 12 (2nd PUC)</option>
          </select>
        </label>
        {(!year || inYear.length > 1) && (
          <label className="marks-field">
            <span>Stream</span>
            <select value={classId} onChange={(e) => set({ classId: e.target.value, sectionId: '' })}>
              <option value="">Choose…</option>
              {inYear.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="marks-field">
          <span>Section</span>
          <select value={sectionId} onChange={(e) => set({ classId, sectionId: e.target.value })} disabled={!cls}>
            <option value="">All sections</option>
            {cls?.sections.map((x) => (
              <option key={x.id} value={x.id}>
                Section {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="marks-field marks-search">
          <span>Search</span>
          <input type="search" placeholder={classId ? 'Student name or ID' : 'Test or subject'} value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <button className="btn btn-primary marks-export" disabled={!sheet.data?.students.length} onClick={() => sheet.data && exportSheet(sheet.data, sectionName)}>
          Export CSV
        </button>
      </div>

      {!classId ? (
        <p className="mon-foot">Choose a class{year ? '' : ' (Class 11 or 12)'} to see the marks sheet. Tests with results are listed below.</p>
      ) : sheet.isLoading ? (
        <Loading />
      ) : sheet.error ? (
        <ErrorNote error={sheet.error} />
      ) : !sheet.data!.tests.length ? (
        <Empty title="No live tests for this class yet" />
      ) : (
        <section className="mon-section">
          <h2>
            {sheet.data!.className}
            {sectionName ? ` · Section ${sectionName}` : ' · all sections'}
            <span className="muted" style={{ fontWeight: 400 }}>
              {' '}
              — {people.length} student{people.length === 1 ? '' : 's'}, highest marks first
            </span>
          </h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Student</th>
                  <th>Section</th>
                  {sheet.data!.tests.map((t) => (
                    <th key={t.id} className="num" title={`${t.title} · ${t.subjectName}`}>
                      <Link to={`/tests/${t.id}/results`} className="marks-test">
                        {t.title}
                      </Link>
                      <div className="tiny muted">out of {t.maxScore}</div>
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Percent</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.studentId}>
                    <td className="num">{p.rank === null ? <span className="faint">—</span> : <b>{p.rank}</b>}</td>
                    <td>
                      <Link to={`/students/${p.studentId}`} className="strong-link">
                        {p.studentName}
                      </Link>
                      <div className="tiny muted mono">{p.studentCode}</div>
                    </td>
                    <td>{p.sectionName}</td>
                    {sheet.data!.tests.map((t) => (
                      <td key={t.id} className="num">
                        {p.marks[t.id] ?? <span className="faint">—</span>}
                      </td>
                    ))}
                    <td className="num">{p.testsTaken ? `${p.total} / ${p.outOf}` : '—'}</td>
                    <td className="num">
                      <b>{p.percent === null ? '—' : `${p.percent}%`}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mon-foot">“—” means the student did not take that test, or it is waiting for review. Rank is by percentage across the tests each student took.</p>
        </section>
      )}

      <section className="mon-section">
        <h2>Tests{cls ? ` for ${cls.name}` : year ? ` for Class ${year === 'PUC_1' ? '11' : '12'}` : ''}</h2>
        {tests.isLoading ? (
          <Loading />
        ) : !testList.length ? (
          <Empty title="No tests with results here" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Class</th>
                  <th>Closes</th>
                  <th className="num">Submitted</th>
                  <th className="num">Average</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {testList.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/tests/${t.id}/results`} className="strong-link">
                        {t.title}
                      </Link>
                      <div className="small muted">{t.subjectName}</div>
                    </td>
                    <td className="small">{t.className}</td>
                    <td className="small">{fmtWhen(t.closesAt)}</td>
                    <td className="num">
                      {t.submittedCount} / {t.studentCount}
                    </td>
                    <td className="num">{t.averagePercent === null ? '—' : `${t.averagePercent}%`}</td>
                    <td>
                      <span className={`pill ${STATE_PILL[t.state][1]}`}>{STATE_PILL[t.state][0]}</span>
                      {t.resultsReleasedAt && <span className="pill pill-board">Released</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function csvCell(v: unknown) {
  const t = v === null || v === undefined ? '' : String(v);
  // Quote everything, and stop spreadsheet formulas from text that starts with = + - @
  return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
}

function saveCsv(rows: unknown[][], fileName: string) {
  const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.replace(/[^\w\- ().]+/g, '').trim() || 'marks.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSheet(m: MarksSheet, sectionName?: string) {
  const head = ['Rank', 'Student ID', 'Name', 'Roll no.', 'Class', 'Section', ...m.tests.map((t) => `${t.title} (out of ${t.maxScore})`), 'Total', 'Out of', 'Percent'];
  const body = m.students.map((p) => [p.rank, p.studentCode, p.studentName, p.rollNumber, m.className, p.sectionName, ...m.tests.map((t) => p.marks[t.id]), p.testsTaken ? p.total : '', p.testsTaken ? p.outOf : '', p.percent]);
  saveCsv([head, ...body], `${m.className}${sectionName ? ` - Section ${sectionName}` : ''} - marks.csv`);
}

export function TestResultsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [reviewing, setReviewing] = useState<AttemptRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['results', id], queryFn: () => api<TestResults>(`/tests/${id}/results`), refetchInterval: 30_000 });
  const [section, setSection] = useState('');
  const [who, setWho] = useState('');
  const sections = useMemo(() => [...new Set((q.data?.attempts ?? []).map((a) => a.sectionName))].sort(), [q.data]);
  const ranked = useMemo(() => {
    const term = who.trim().toLowerCase();
    const inSection = (q.data?.attempts ?? []).filter((a) => !section || a.sectionName === section);
    return rankAttempts(inSection).filter((x) => !term || x.a.studentName.toLowerCase().includes(term) || x.a.studentCode.toLowerCase().includes(term));
  }, [q.data, section, who]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const r = q.data!;
  const s = r.summary;
  const hardest = [...r.perQuestion].filter((p) => p.correctPercent !== null).sort((a, b) => a.correctPercent! - b.correctPercent!)[0];

  async function release() {
    setError(null);
    try {
      await api(`/tests/${id}/release-results`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['results', id] });
      void qc.invalidateQueries({ queryKey: ['tests'] });
      toast('Results released. Students see their scores on their tablets.');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <p className="crumb">
        <Link to="/results">Results &amp; marks</Link>
      </p>
      <PageHead
        title={r.test.title}
        sub={
          <>
            <span className={`pill ${STATE_PILL[r.test.state][1]}`}>{STATE_PILL[r.test.state][0]}</span>
            {r.test.questionCount} questions · {r.test.durationMin} min · closes {fmtWhen(r.test.closesAt)}
          </>
        }
        actions={
          <>
            <Link className="btn btn-quiet" to={`/tests/${id}`}>
              View test
            </Link>
            {!r.test.instantResults && !r.test.resultsReleasedAt && (
              <button className="btn btn-primary" onClick={() => void release()}>
                Release results
              </button>
            )}
          </>
        }
      />
      <ErrorNote error={error} />
      <section className="kpis">
        <Kpi label="Submitted" value={s.submitted} note={`of ${s.eligible} students${s.started > s.submitted ? ` · ${s.started - s.submitted} in progress` : ''}`} />
        <Kpi label="Average score" value={s.averagePercent === null ? '—' : `${s.averagePercent}%`} note={s.highestPercent === null ? undefined : `Highest ${s.highestPercent}%`} />
        <Kpi
          label="Hardest question"
          value={hardest ? `Q${hardest.position}` : '—'}
          note={hardest ? `${hardest.correctPercent}% correct${hardest.topic ? ` · ${hardest.topic}` : ''}` : undefined}
          tone={hardest && hardest.correctPercent! < 50 ? 'down' : undefined}
        />
        <Kpi label="Median time" value={fmtDuration(s.medianSeconds)} note={`of ${r.test.durationMin}:00 · online attempts`} />
      </section>

      {!r.attempts.length ? (
        <Empty title="No submissions yet" />
      ) : (
        <section className="mon-section">
          <div className="mon-section-head">
            <h2>Students, highest marks first</h2>
            <button className="btn btn-primary" onClick={() => downloadMarks(r, ranked, section)}>
              Download {section ? `Section ${section}` : 'all sections'} (CSV)
            </button>
          </div>
          <div className="filters">
            <div className="seg-tabs" role="group" aria-label="Section">
              <button aria-pressed={section === ''} onClick={() => setSection('')}>
                All sections
              </button>
              {sections.map((x) => (
                <button key={x} aria-pressed={section === x} onClick={() => setSection(x)}>
                  Section {x}
                </button>
              ))}
            </div>
            <input type="search" placeholder="Search student name or ID" aria-label="Search students" value={who} onChange={(e) => setWho(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Student</th>
                  <th className="num">Score</th>
                  <th className="num">Percent</th>
                  <th>Submitted</th>
                  <th className="num">Time</th>
                  <th>Counts?</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No students match.
                    </td>
                  </tr>
                )}
                {ranked.map(({ a, rank }) => (
                  <tr key={a.id}>
                    <td className="num">{rank === null ? <span className="faint">—</span> : <b>{rank}</b>}</td>
                    <td>
                      <Link to={`/students/${a.studentId}`} className="strong-link">
                        {a.studentName}
                      </Link>
                      <div className="tiny muted">
                        <span className="mono">{a.studentCode}</span> · Section {a.sectionName}
                        {a.mode === 'OFFLINE' && ' · offline'}
                      </div>
                    </td>
                    <td className="num">{a.score === null ? '—' : `${a.score} / ${a.maxScore}`}</td>
                    <td className="num">{a.percent === null ? '—' : `${a.percent}%`}</td>
                    <td className="small">
                      {a.submittedAt ? fmtDateTime(a.submittedAt) : <span className="muted">In progress</span>}
                      {a.mode === 'OFFLINE' && a.clientSubmittedAt && <div className="tiny faint">Tablet: {fmtDateTime(a.clientSubmittedAt)}</div>}
                    </td>
                    <td className="num">{fmtDuration(a.elapsedSec)}</td>
                    <td>
                      {a.submittedAt && <span className={`pill ${REVIEW[a.reviewStatus][1]}`}>{REVIEW[a.reviewStatus][0]}</span>}
                      {a.reviewReason && <div className="tiny muted">{a.reviewReason}</div>}
                    </td>
                    <td className="num">
                      {a.submittedAt && a.reviewStatus !== 'NONE' && (
                        <button className={`btn btn-sm ${a.reviewStatus === 'PENDING' ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setReviewing(a)}>
                          {a.reviewStatus === 'PENDING' ? 'Review' : 'Change'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mon-foot">Rank is within the section you pick. Students with the same marks share a rank. Unfinished or not-counted tests have no rank and appear at the end.</p>
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">Correct answers by question</h2>
          {r.perQuestion.map((p) => (
            <HBar key={p.questionId} label={`Q${p.position}${p.topic ? ` · ${p.topic}` : ''}`} value={p.correctPercent} color={p.correctPercent !== null && p.correctPercent < 50 ? 'var(--bad)' : 'var(--board)'} />
          ))}
          <p className="tiny faint">Counted submissions only. Questions under 50% are worth re-teaching.</p>
        </section>
        <section className="panel">
          <h2 className="panel-title">Most common wrong answers</h2>
          {r.perQuestion
            .filter((p) => p.optionCounts.some((n, i) => i !== p.correctIndex && n > 0))
            .slice(0, 6)
            .map((p) => {
              const [wrongIdx] = p.optionCounts.map((n, i) => [i, n] as const).filter(([i]) => i !== p.correctIndex).sort((a, b) => b[1] - a[1])[0];
              return (
                <div key={p.questionId} className="alert">
                  <span className="alert-icon" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                    Q{p.position}
                  </span>
                  <div className="alert-body">
                    <span className="small">{p.text}</span>
                    <span className="tiny muted">
                      {p.optionCounts[wrongIdx]} chose {'ABCDEF'[wrongIdx]} · correct is {'ABCDEF'[p.correctIndex]}
                    </span>
                  </div>
                </div>
              );
            })}
          {!r.perQuestion.some((p) => p.optionCounts.some((n, i) => i !== p.correctIndex && n > 0)) && <p className="muted">No wrong answers yet.</p>}
        </section>
      </div>

      <Modal open={!!reviewing} title="Review submission" onClose={() => setReviewing(null)}>
        {reviewing && (
          <ReviewForm
            attempt={reviewing}
            testId={id!}
            onDone={(d) => {
              setReviewing(null);
              void qc.invalidateQueries({ queryKey: ['results', id] });
              void qc.invalidateQueries({ queryKey: ['reviews'] });
              void qc.invalidateQueries({ queryKey: ['dashboard'] });
              toast(d === 'ACCEPTED' ? 'Counted in results' : 'Marked as not counted');
            }}
          />
        )}
      </Modal>
    </>
  );
}

function ReviewForm({ attempt, testId, onDone }: { attempt: AttemptRow; testId: string; onDone: (d: 'ACCEPTED' | 'REJECTED') => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function decide(decision: 'ACCEPTED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    try {
      await api(`/tests/${testId}/attempts/${attempt.id}/review`, { method: 'PATCH', body: { decision, note: note || null } });
      onDone(decision);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <p>
        <b>{attempt.studentName}</b> scored {attempt.score}/{attempt.maxScore}.
      </p>
      {attempt.reviewReason && <p className="callout">{attempt.reviewReason}</p>}
      <dl className="facts">
        <div>
          <dt>Received by the server</dt>
          <dd>{fmtDateTime(attempt.submittedAt)}</dd>
        </div>
        <div>
          <dt>Tablet says answered at</dt>
          <dd>{fmtDateTime(attempt.clientSubmittedAt)}</dd>
        </div>
        <div>
          <dt>Time on tablet</dt>
          <dd>{fmtDuration(attempt.elapsedSec)}</dd>
        </div>
      </dl>
      <Field label="Note (kept in the audit log)">
        <input id="review-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Hostel Wi-Fi was down that evening" />
      </Field>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn btn-quiet danger-text" disabled={busy} onClick={() => void decide('REJECTED')}>
          Don’t count it
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void decide('ACCEPTED')}>
          Count it
        </button>
      </div>
    </div>
  );
}

/**
 * Marks as a CSV sheet (opens in Excel). One row per student who submitted; the same
 * columns will be sent to the Bridge app once that link is set up.
 */
type Attempt = TestResults['attempts'][number];

/** Highest score first. Only counted, submitted tests get a rank; equal scores share one. */
function rankAttempts(list: Attempt[]): { a: Attempt; rank: number | null }[] {
  const counted = (a: Attempt) => !!a.submittedAt && a.score !== null && (a.reviewStatus === 'NONE' || a.reviewStatus === 'ACCEPTED');
  const ranked = list.filter(counted).sort((x, y) => y.score! - x.score! || x.studentName.localeCompare(y.studentName));
  const rest = list.filter((a) => !counted(a)).sort((x, y) => x.studentName.localeCompare(y.studentName));
  let rank = 0;
  let prev: number | null = null;
  const out = ranked.map((a, i) => {
    if (a.score !== prev) rank = i + 1;
    prev = a.score;
    return { a, rank: rank as number | null };
  });
  return [...out, ...rest.map((a) => ({ a, rank: null }))];
}

function downloadMarks(r: TestResults, rows: { a: Attempt; rank: number | null }[], section: string) {
  const counts = (a: Attempt) => (!a.submittedAt ? 'In progress' : a.reviewStatus === 'PENDING' ? 'Awaiting review' : a.reviewStatus === 'REJECTED' ? 'Not counted' : 'Yes');
  saveCsv(
    [
      ['Rank', 'Student ID', 'Name', 'Section', 'Test', 'Score', 'Out of', 'Percent', 'Correct', 'Submitted at', 'Counts'],
      ...rows.map(({ a, rank }) => [rank, a.studentCode, a.studentName, a.sectionName, r.test.title, a.score, a.maxScore, a.percent, a.correctCount, a.submittedAt ? new Date(a.submittedAt).toLocaleString('en-IN') : '', counts(a)]),
    ],
    `${r.test.title}${section ? ` - Section ${section}` : ''} - marks.csv`,
  );
}
