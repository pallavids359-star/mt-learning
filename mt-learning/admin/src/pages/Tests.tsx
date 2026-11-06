import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useClasses } from '../api/hooks';
import type { Page, TestState, TestSummary } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Icon, SubjectChip } from '../components/icons';
import { Empty, ErrorNote, Loading, PageHead, Pager } from '../components/ui';
import { fmtWhen } from '../lib/format';

export const STATE_PILL: Record<TestState, [string, string]> = {
  draft: ['Draft', 'pill-neutral'],
  upcoming: ['Scheduled', 'pill-board'],
  open: ['Open now', 'pill-ok'],
  closed: ['Closed', 'pill-neutral'],
};

export function TestsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const classes = useClasses();
  const [status, setStatus] = useState<TestState | ''>('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['tests', status, classId, page],
    queryFn: () => api<Page<TestSummary>>('/tests', { query: { status, classId, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHead
        title="Live tests"
        sub="Create live tests, choose when they open, and decide whether they may be taken without Wi-Fi."
        actions={
          can(P.TestsWrite) && (
            <button className="btn btn-primary" onClick={() => nav('/tests/new')}>
              <Icon name="plus" /> Create live test
            </button>
          )
        }
      />
      <div className="filters">
        <div className="seg-tabs" role="group" aria-label="Status">
          {(['', 'open', 'upcoming', 'draft', 'closed'] as const).map((s) => (
            <button key={s || 'all'} aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
              {s ? STATE_PILL[s][0] : 'All'}
            </button>
          ))}
        </div>
        <select id="tests-class" aria-label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1); }}>
          <option value="">All classes</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title="No tests here">{can(P.TestsWrite) && 'Create a test and add its questions.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Class</th>
                <th className="num">Questions</th>
                <th>Window</th>
                <th>Mode</th>
                <th className="num">Submitted</th>
                <th className="num">Average</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/tests/${t.id}`} className="strong-link">
                      {t.title}
                    </Link>
                    <div className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SubjectChip code={t.subjectCode} name={t.subjectName} />
                      {t.durationMin} min{t.negativeMarks > 0 && ` · −${t.negativeMarks} per wrong answer`}
                    </div>
                  </td>
                  <td className="small">{t.className}</td>
                  <td className="num">{t.questionCount}</td>
                  <td className="small nowrap">
                    {fmtWhen(t.opensAt)}
                    <br />
                    <span className="faint">to {fmtWhen(t.closesAt)}</span>
                  </td>
                  <td>{t.allowOffline ? <span className="pill pill-board">Offline allowed</span> : <span className="pill pill-neutral">Online only</span>}</td>
                  <td className="num">
                    {t.state === 'draft' ? '—' : `${t.submittedCount} / ${t.studentCount}`}
                    {t.pendingReviewCount > 0 && <div className="tiny down">{t.pendingReviewCount} to review</div>}
                  </td>
                  <td className="num">{t.averagePercent === null ? '—' : `${t.averagePercent}%`}</td>
                  <td>
                    <span className={`pill ${STATE_PILL[t.state][1]}`}>{STATE_PILL[t.state][0]}</span>
                    {t.state === 'open' && (
                      <div>
                        <Link className="btn btn-primary btn-sm" to={`/tests/${t.id}/monitor`}>
                          <span className="live-dot" aria-hidden /> Monitor
                        </Link>
                      </div>
                    )}
                    {t.state !== 'draft' && can(P.TestsReview) && (
                      <div>
                        <Link className="tiny" to={`/tests/${t.id}/results`}>
                          Results
                        </Link>
                        {t.state !== 'open' && (
                          <>
                            {' · '}
                            <Link className="tiny" to={`/tests/${t.id}/monitor`}>
                              Monitor
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
    </>
  );
}
