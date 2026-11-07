import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ErrorNote, Loading } from '../components/ui';
import './Dashboard.css';

/** What /dashboard/overview sends: the live test, score trend, upcoming tests and sections. */
interface Overview {
  live: {
    id: string;
    title: string;
    className: string;
    subjectName: string;
    closesAt: string;
    total: number;
    started: number;
    writing: number;
    submitted: number;
    needHelp: number;
    notStarted: number;
  } | null;
  testsThisMonth: number;
  upcomingCount: number;
  averageThisMonth: number | null;
  averageLastMonth: number | null;
  weekly: { week: string; puc1: number | null; puc2: number | null }[];
  upcoming: { id: string; title: string; className: string; examCode: string | null; opensAt: string; durationMin: number }[];
  sections: {
    sectionId: string;
    className: string;
    sectionName: string;
    students: number;
    average: number | null;
    topper: { name: string; percent: number } | null;
  }[];
}

const DOT = ' \u00b7 ';
const DASH = '\u2014';
const fmt = (n: number) => n.toLocaleString('en-IN');
const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const shortDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(iso));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function minutesLeft(iso: string) {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  return m >= 120 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

export function DashboardPage() {
  const { me, can } = useAuth();
  const canTests = can(P.TestsRead);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardSummary>('/dashboard/summary'), refetchInterval: 60_000 });
  const o = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api<Overview>('/dashboard/overview'),
    enabled: canTests,
    refetchInterval: 30_000,
  });
  const bank = useQuery({ queryKey: ['bank-status'], queryFn: () => api<{ source: 'genprep' | 'sample' }>('/question-bank/status'), enabled: canTests });

  if (q.isLoading || (canTests && o.isLoading)) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const v = o.data ?? null;
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const firstName = (me?.fullName ?? '').split(' ')[0];
  const assigned = d.tablets.byStatus.ASSIGNED ?? 0;

  // Number cards
  const delta = v && v.averageThisMonth !== null && v.averageLastMonth !== null ? Math.round((v.averageThisMonth - v.averageLastMonth) * 10) / 10 : null;
  const kpis = [
    {
      label: 'Students',
      value: fmt(d.students.active),
      badge: 'ST',
      tone: 'navy',
      chip: d.students.activeWithoutTablet > 0 ? fmt(d.students.activeWithoutTablet) : '\u2713',
      note: d.students.activeWithoutTablet > 0 ? 'without a tablet' : 'all have a tablet',
    },
    {
      label: 'Tablets online',
      value: fmt(d.tabletsOnlineToday),
      badge: 'TB',
      tone: 'blue',
      chip: assigned ? `${Math.round((d.tabletsOnlineToday / assigned) * 100)}%` : '0%',
      note: `of ${fmt(assigned)} tablets, last 24 h`,
    },
    ...(v
      ? [
          { label: 'Tests this month', value: fmt(v.testsThisMonth), badge: 'LT', tone: 'orange', chip: fmt(v.upcomingCount), note: 'still to come' },
          {
            label: 'Average score',
            value: v.averageThisMonth === null ? DASH : `${v.averageThisMonth}%`,
            badge: 'AV',
            tone: 'gold',
            chip: delta === null ? DASH : `${delta >= 0 ? '+' : ''}${delta}`,
            note: delta === null ? 'this month' : 'vs last month',
          },
        ]
      : []),
  ];

  // Needs your attention
  const alerts: { tone: 'bad' | 'warn' | 'info'; title: string; text: string; to: string }[] = [];
  if (v?.live && v.live.needHelp > 0)
    alerts.push({ tone: 'bad', title: `${v.live.needHelp} student${v.live.needHelp === 1 ? ' needs' : 's need'} help now`, text: `Stuck in ${v.live.title}. Open the monitor to revive their test.`, to: `/tests/${v.live.id}/monitor` });
  if (d.tablets.staleAssigned > 0 && can(P.TabletsRead))
    alerts.push({ tone: 'warn', title: `${d.tablets.staleAssigned} tablet${d.tablets.staleAssigned === 1 ? '' : 's'} offline for ${d.tablets.staleAfterDays}+ days`, text: 'Check charging and hostel Wi-Fi.', to: '/tablets' });
  if (d.tests && d.tests.pendingReviews > 0)
    alerts.push({ tone: 'info', title: `${d.tests.pendingReviews} submission${d.tests.pendingReviews === 1 ? '' : 's'} to review`, text: 'Uploaded late from offline tablets or after the time limit.', to: '/results' });
  if (d.students.activeWithoutTablet > 0 && can(P.TabletsRead))
    alerts.push({ tone: 'info', title: `${d.students.activeWithoutTablet} student${d.students.activeWithoutTablet === 1 ? '' : 's'} without a tablet`, text: 'Assign one from stock on the Tablets page.', to: '/students?hasTablet=false' });
  if (bank.data?.source === 'sample')
    alerts.push({ tone: 'warn', title: 'Question bank not connected', text: 'Tests use sample questions until the question bank is added to the server settings.', to: '/tests' });

  // Chart: 0% to 100%; weeks with no tests show no bar.
  const barHeight = (p: number | null) => (p === null ? '0%' : `${Math.max(2, Math.min(100, p))}%`);

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <span className="dash-date">{today}</span>
          <h1>
            {greeting()}, {firstName}
          </h1>
        </div>
        <div className="dash-actions">
          {can(P.TestsReview) && (
            <Link to="/results" className="btn btn-quiet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />
              </svg>
              Export marks
            </Link>
          )}
          {can(P.TestsWrite) && (
            <Link to="/tests/new" className="btn btn-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create live test
            </Link>
          )}
        </div>
      </div>

      {v?.live && (
        <section className="dash-live" aria-label="Live now">
          <div className="dash-live-main">
            <span className="dash-live-tag">
              <i aria-hidden="true" />
              LIVE NOW
            </span>
            <h2>{v.live.title}</h2>
            <span className="dash-live-sub">
              {v.live.className}{DOT}{v.live.subjectName}{DOT}closes at {time(v.live.closesAt)}
            </span>
            <div className="dash-live-bar">
              <i style={{ width: `${v.live.total ? Math.round((v.live.started / v.live.total) * 100) : 0}%` }} />
            </div>
            <span className="dash-live-sub small">
              {v.live.started} of {v.live.total} students have started{DOT}{minutesLeft(v.live.closesAt)}
            </span>
          </div>
          <div className="dash-live-stats">
            <div>
              <b>{v.live.writing}</b>
              <span>Writing</span>
            </div>
            <div>
              <b className="gold">{v.live.submitted}</b>
              <span>Submitted</span>
            </div>
            <div>
              <b className="red">{v.live.needHelp}</b>
              <span>Need help</span>
            </div>
            <div>
              <b className="amber">{v.live.notStarted}</b>
              <span>Not started</span>
            </div>
          </div>
          <Link to={`/tests/${v.live.id}/monitor`} className="btn btn-gold">
            Open monitor
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </section>
      )}

      <section className="dash-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="dash-kpi">
            <div className="dash-kpi-top">
              <span>{k.label}</span>
              <span className={`dash-badge ${k.tone}`} aria-hidden="true">
                {k.badge}
              </span>
            </div>
            <b>{k.value}</b>
            <div className="dash-kpi-note">
              <span className={`dash-chip ${k.tone}`}>{k.chip}</span>
              <span>{k.note}</span>
            </div>
          </div>
        ))}
      </section>

      {v && (
        <div className="dash-row">
          <section className="panel dash-wide">
            <div className="dash-panel-head">
              <div>
                <h2 className="panel-title">Average score by week</h2>
                <span className="small muted">Live tests, last 8 weeks</span>
              </div>
              <div className="dash-legend">
                <span>
                  <i className="gold" />
                  Class 11
                </span>
                <span>
                  <i className="navy" />
                  Class 12
                </span>
              </div>
            </div>
            <div className="dash-chart">
              <div className="dash-axis" aria-hidden="true">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              <div className="dash-bars">
                {v.weekly.map((w) => (
                  <div key={w.week} className="dash-week">
                    <div className="dash-pair">
                      <i className="gold" style={{ height: barHeight(w.puc1) }} title={w.puc1 === null ? 'Class 11: no tests' : `Class 11: ${w.puc1}%`} />
                      <i className="navy" style={{ height: barHeight(w.puc2) }} title={w.puc2 === null ? 'Class 12: no tests' : `Class 12: ${w.puc2}%`} />
                    </div>
                    <span>{shortDay(w.week)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel dash-narrow">
            <div className="dash-panel-head">
              <h2 className="panel-title">Coming up</h2>
              <Link to="/tests" className="dash-link">
                See all
              </Link>
            </div>
            {v.upcoming.length === 0 ? (
              <p className="muted">No tests scheduled yet.</p>
            ) : (
              <ul className="dash-upcoming">
                {v.upcoming.map((u) => {
                  const at = new Date(u.opensAt);
                  return (
                    <li key={u.id}>
                      <span className="dash-cal">
                        <small>{at.toLocaleString('en-IN', { month: 'short' }).toUpperCase()}</small>
                        <b>{at.getDate()}</b>
                      </span>
                      <Link to={`/tests/${u.id}`} className="dash-up-text">
                        <b>{u.title}</b>
                        <span>
                          {u.className.split(DOT)[0]}{DOT}{time(u.opensAt)}{DOT}{u.durationMin} min
                        </span>
                      </Link>
                      {u.examCode && <span className={`exam-tag ${u.examCode}`}>{u.examCode}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <div className="dash-row">
        {v && (
          <section className="panel dash-wide">
            <div className="dash-panel-head">
              <h2 className="panel-title">Sections at a glance</h2>
              {can(P.TestsReview) && (
                <Link to="/results" className="dash-link">
                  Open results
                </Link>
              )}
            </div>
            {v.sections.length === 0 ? (
              <p className="muted">No classes set up for this academic year yet.</p>
            ) : (
              <div className="dash-table">
                <table>
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Students</th>
                      <th>Average</th>
                      <th className="dash-score-col">Score</th>
                      <th>Topper</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.sections.map((s) => (
                      <tr key={s.sectionId}>
                        <td className="strong">
                          {s.className}{DOT}{s.sectionName}
                        </td>
                        <td>{s.students}</td>
                        <td className="strong">{s.average === null ? DASH : `${s.average}%`}</td>
                        <td>
                          <div className="dash-meter">
                            <i
                              className={s.average === null ? '' : s.average >= 70 ? 'navy' : s.average >= 55 ? 'gold' : 'orange'}
                              style={{ width: `${s.average ?? 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="muted">{s.topper ? `${s.topper.name} (${s.topper.percent}%)` : DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className={`panel ${v ? 'dash-narrow' : 'dash-wide'}`}>
          <h2 className="panel-title">Needs your attention</h2>
          {alerts.length === 0 ? (
            <p className="dash-alert ok">
              <i aria-hidden="true" />
              <span>
                <b>All good</b>
                <span>Nothing needs attention right now.</span>
              </span>
            </p>
          ) : (
            alerts.map((a) => (
              <Link key={a.title} to={a.to} className={`dash-alert ${a.tone}`}>
                <i aria-hidden="true" />
                <span>
                  <b>{a.title}</b>
                  <span>{a.text}</span>
                </span>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
