import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ErrorNote, Kpi, Loading, PageHead } from '../components/ui';

export function DashboardPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardSummary>('/dashboard/summary'), refetchInterval: 60_000 });
  const bank = useQuery({ queryKey: ['bank-status'], queryFn: () => api<{ source: 'genprep' | 'sample' }>('/question-bank/status'), enabled: can(P.TestsRead) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const assigned = d.tablets.byStatus.ASSIGNED ?? 0;
  const enrolled = d.students.active;
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const alerts: { tone: 'bad' | 'warn'; icon: string; title: string; text: string; to: string; action: string }[] = [];
  if (d.tablets.staleAssigned > 0 && can(P.TabletsRead))
    alerts.push({ tone: 'bad', icon: '!', title: `${d.tablets.staleAssigned} tablet${d.tablets.staleAssigned === 1 ? '' : 's'} not seen for ${d.tablets.staleAfterDays}+ days`, text: 'Check the charging racks and hostel Wi-Fi.', to: '/tablets', action: 'View' });
  if (d.tests && d.tests.pendingReviews > 0)
    alerts.push({ tone: 'warn', icon: '?', title: `${d.tests.pendingReviews} test submission${d.tests.pendingReviews === 1 ? '' : 's'} to review`, text: 'Uploaded late from offline tablets or past the time limit.', to: '/results', action: 'Review' });
  if (d.students.activeWithoutTablet > 0 && can(P.TabletsRead))
    alerts.push({ tone: 'warn', icon: '#', title: `${d.students.activeWithoutTablet} student${d.students.activeWithoutTablet === 1 ? '' : 's'} without a tablet`, text: 'Assign one from stock.', to: '/students?hasTablet=false', action: 'View' });

  const actions = [
    { to: '/tests/new', label: 'Create a live test', text: 'Pick questions from the question bank', perm: P.TestsWrite },
    { to: '/results', label: 'See results & marks', text: 'Scores and late submissions', perm: P.TestsReview },
    { to: '/students/import', label: 'Add students', text: 'Import a class from a spreadsheet', perm: P.StudentsCredentials },
    { to: '/tablets', label: 'Manage tablets', text: 'Assign, track, mark lost', perm: P.TabletsRead },
  ].filter((a) => can(a.perm));
  if (bank.data?.source === 'sample')
    alerts.push({ tone: 'warn', icon: '?', title: 'Question bank not connected', text: 'Practice uses sample questions until the question bank is added to the server settings.', to: '/tests', action: 'Live tests' });

  return (
    <>
      <PageHead
        title="Dashboard"
        sub={
          <>
            Welcome, {me?.fullName} · {today}
            {d.academicYear ? <span className="current-chip">Academic year {d.academicYear.name}</span> : <Link to="/classes">Set up the academic year</Link>}
          </>
        }
      />

      <section className="kpis">
        <Kpi label="Students" value={enrolled} />
        <Kpi label="Tablets in use" value={assigned} />
        {d.tests && <Kpi label="Live tests open now" value={d.tests.openNow} />}
        {d.tests && <Kpi label="Tests submitted this week" value={d.tests.submittedThisWeek} />}
      </section>

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">Needs attention</h2>
          {alerts.length === 0 ? (
            <p className="ok-note">All good. Nothing needs attention right now.</p>
          ) : (
            alerts.map((a) => (
              <div key={a.title} className="alert">
                <span className="alert-icon" style={{ background: `var(--${a.tone}-soft)`, color: `var(--${a.tone})` }}>
                  {a.icon}
                </span>
                <div className="alert-body">
                  <b>{a.title}</b>
                  <span className="small muted">{a.text}</span>
                </div>
                <Link className="btn btn-quiet btn-sm" to={a.to}>
                  {a.action}
                </Link>
              </div>
            ))
          )}
        </section>

        {actions.length > 0 && (
          <section className="panel">
            <h2 className="panel-title">Quick actions</h2>
            <div className="quick">
              {actions.map((a) => (
                <Link key={a.to} to={a.to} className="quick-link">
                  <b>{a.label} →</b>
                  <span>{a.text}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
