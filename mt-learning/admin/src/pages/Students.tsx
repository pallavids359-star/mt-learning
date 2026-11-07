import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { sectionOptions, useClasses, useHostels } from '../api/hooks';
import type { Gender, Page, Student } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { CredentialSlip, Empty, ErrorNote, Field, Loading, Modal, Pager, StatusPill } from '../components/ui';
import { fmtAgo } from '../lib/format';
import './Students.css';

type ListedStudent = Student & { averagePercent: number | null };
type StudentList = Page<ListedStudent> & { counts: { all: number; hostel: number; day: number; noTablet: number } };
type Tab = 'all' | 'hostel' | 'day' | 'noTablet';

const DOT = ' \u00b7 ';
const DASH = '\u2014';
const DAY = 86_400_000;
const AVATAR = ['navy', 'blue', 'gold', 'plum'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** The later of the last sign-in and the tablet's last check-in. */
function lastActive(s: Student) {
  const times = [s.lastLoginAt, s.tablet?.lastSeenAt].filter((x): x is string => !!x).map((x) => new Date(x).getTime());
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/** Green: seen in the last day; amber: this week; red: longer; grey: no tablet. */
function tabletTone(s: Student) {
  if (!s.tablet) return 'none';
  const seen = s.tablet.lastSeenAt ? Date.now() - new Date(s.tablet.lastSeenAt).getTime() : Infinity;
  return seen <= DAY ? 'on' : seen <= 7 * DAY ? 'low' : 'off';
}

export function StudentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const classes = useClasses();

  const page = Number(params.get('page') ?? 1);
  const filters = {
    search: params.get('search') ?? '',
    classId: params.get('classId') ?? '',
    sectionId: params.get('sectionId') ?? '',
    hostelId: params.get('hostelId') ?? '',
    residence: params.get('residence') ?? '',
    gender: params.get('gender') ?? '',
    status: params.get('status') ?? '',
    hasTablet: params.get('hasTablet') ?? '',
  };
  const [search, setSearch] = useState(filters.search);
  useEffect(() => setSearch(filters.search), [filters.search]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    if (k === 'classId') next.delete('sectionId');
    setParams(next, { replace: true });
  };

  const tab: Tab = filters.hasTablet === 'false' ? 'noTablet' : filters.residence === 'hostel' ? 'hostel' : filters.residence === 'day' ? 'day' : 'all';
  const pickTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    for (const k of ['page', 'residence', 'hostelId', 'hasTablet']) next.delete(k);
    if (t === 'hostel' || t === 'day') next.set('residence', t);
    if (t === 'noTablet') next.set('hasTablet', 'false');
    setParams(next, { replace: true });
  };

  const q = useQuery({
    queryKey: ['students', filters, page],
    queryFn: () => api<StudentList>('/students', { query: { ...filters, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const selectedClass = classes.data?.find((c) => c.id === filters.classId);
  const counts = q.data?.counts;
  const tabs: [Tab, string, number | undefined][] = [
    ['all', 'All students', counts?.all],
    ['hostel', 'Hostel', counts?.hostel],
    ['day', 'Day scholars', counts?.day],
    ['noTablet', 'No tablet yet', counts?.noTablet],
  ];
  const from = q.data ? (q.data.total === 0 ? 0 : (page - 1) * q.data.pageSize + 1) : 0;
  const to = q.data ? Math.min(page * q.data.pageSize, q.data.total) : 0;

  return (
    <div className="stu">
      <div className="stu-head">
        <div>
          <h1>Students</h1>
          <p className="muted">Everyone enrolled this year, with their tablet and scores</p>
        </div>
        {can(P.StudentsCredentials) && (
          <div className="stu-actions">
            <Link to="/students/import" className="btn btn-quiet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 15V4M7 9l5-5 5 5M4 20h16" />
              </svg>
              Import from Excel
            </Link>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add student
            </button>
          </div>
        )}
      </div>

      <div className="stu-tabs" role="group" aria-label="Show">
        {tabs.map(([id, label, n]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => pickTab(id)}>
            <span>{label}</span>
            <b>{n === undefined ? DASH : n.toLocaleString('en-IN')}</b>
          </button>
        ))}
      </div>

      <section className="stu-card">
        <form
          className="stu-filters"
          onSubmit={(e) => {
            e.preventDefault();
            set('search', search.trim());
          }}
        >
          <label className="stu-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search name or ID"
              aria-label="Search students"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => search.trim() !== filters.search && set('search', search.trim())}
            />
          </label>
          <label className="stu-select">
            Class
            <select value={filters.classId} onChange={(e) => set('classId', e.target.value)}>
              <option value="">All classes</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="stu-select">
            Section
            <select value={filters.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
              <option value="">All</option>
              {selectedClass
                ? selectedClass.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                : sectionOptions(classes.data).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
            </select>
          </label>
          <label className="stu-select">
            Gender
            <select value={filters.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">Everyone</option>
              <option value="MALE">Boys</option>
              <option value="FEMALE">Girls</option>
            </select>
          </label>
          <label className="stu-select">
            Status
            <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </label>
        </form>

        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="stu-pad">
            <ErrorNote error={q.error} />
          </div>
        ) : q.data!.items.length === 0 ? (
          <div className="stu-pad">
            <Empty title="No students match these filters">
              {Object.values(filters).some(Boolean) ? 'Clear a filter to see more.' : 'Add students one at a time or import a class list.'}
            </Empty>
          </div>
        ) : (
          <div className="stu-table">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Stays</th>
                  <th>Tablet</th>
                  <th>Last active</th>
                  <th className="stu-score-col">Average score</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((s, i) => {
                  const seen = lastActive(s);
                  const avg = s.averagePercent;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="stu-person">
                          <span className={`stu-avatar ${AVATAR[i % AVATAR.length]}`} aria-hidden="true">
                            {initials(s.fullName)}
                          </span>
                          <span>
                            <Link to={`/students/${s.id}`} className="stu-name">
                              {s.fullName}
                            </Link>
                            <span className="stu-code">{s.studentCode}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {s.classGroup.name}
                        {DOT}
                        {s.section.name}
                      </td>
                      <td>{s.hostel ? s.hostel.name : 'Day scholar'}</td>
                      <td>
                        <span className="stu-tablet">
                          <i className={tabletTone(s)} aria-hidden="true" />
                          {s.tablet ? s.tablet.serialNumber : <span className="muted">Not assigned</span>}
                        </span>
                      </td>
                      <td>{seen ? fmtAgo(seen) : <span className="muted">Never</span>}</td>
                      <td>
                        <div className="stu-score">
                          <div className="stu-meter">
                            <i className={avg === null ? '' : avg >= 80 ? 'navy' : avg >= 60 ? 'gold' : 'orange'} style={{ width: `${avg ?? 0}%` }} />
                          </div>
                          <b>{avg === null ? DASH : `${Math.round(avg)}%`}</b>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={s.status} />
                      </td>
                      <td className="stu-open">
                        <Link to={`/students/${s.id}`} aria-label={`Open ${s.fullName}`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {q.data && q.data.total > 0 && (
          <div className="stu-foot">
            <span>
              Showing {from}&ndash;{to} of {q.data.total.toLocaleString('en-IN')}
            </span>
            {q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} />}
          </div>
        )}
      </section>

      <Modal open={adding} title="Add student" onClose={() => setAdding(false)} wide>
        <AddStudentForm onClose={() => setAdding(false)} />
      </Modal>
    </div>
  );
}

function AddStudentForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const classes = useClasses();
  const hostels = useHostels();
  const [f, setF] = useState({
    studentCode: '',
    fullName: '',
    sectionId: '',
    rollNumber: '',
    dateOfBirth: '',
    gender: '' as Gender | '',
    guardianName: '',
    guardianPhone: '',
    hostelId: '',
    roomNumber: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ student: Student; temporaryPassword: string } | null>(null);
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ student: Student; temporaryPassword: string }>('/students', {
        method: 'POST',
        body: {
          studentCode: f.studentCode,
          fullName: f.fullName,
          sectionId: f.sectionId,
          rollNumber: f.rollNumber,
          dateOfBirth: f.dateOfBirth || null,
          gender: f.gender || null,
          guardianName: f.guardianName || null,
          guardianPhone: f.guardianPhone || null,
          hostelId: f.hostelId || null,
          roomNumber: f.roomNumber || null,
        },
      });
      setCreated(res);
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <>
        <CredentialSlip who={created.student.fullName} code={created.student.studentCode} password={created.temporaryPassword} />
        <div className="form-actions">
          <button className="btn btn-quiet" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-primary" onClick={() => nav(`/students/${created.student.id}`)}>
            Open student record
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="grid-form">
      <Field label="Student ID" hint="College-issued ID used to sign in">
        <input required value={f.studentCode} onChange={upd('studentCode')} className="mono" autoFocus />
      </Field>
      <Field label="Full name">
        <input required value={f.fullName} onChange={upd('fullName')} />
      </Field>
      <Field label="Class and section">
        <select required value={f.sectionId} onChange={upd('sectionId')}>
          <option value="">Choose...</option>
          {sectionOptions(classes.data).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Roll number">
        <input required value={f.rollNumber} onChange={upd('rollNumber')} />
      </Field>
      <Field label="Date of birth">
        <input type="date" value={f.dateOfBirth} onChange={upd('dateOfBirth')} />
      </Field>
      <Field label="Gender">
        <select value={f.gender} onChange={upd('gender')}>
          <option value="">Not recorded</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </Field>
      <Field label="Parent / guardian name">
        <input value={f.guardianName} onChange={upd('guardianName')} />
      </Field>
      <Field label="Parent / guardian phone">
        <input type="tel" value={f.guardianPhone} onChange={upd('guardianPhone')} />
      </Field>
      <Field label="Hostel">
        <select value={f.hostelId} onChange={upd('hostelId')}>
          <option value="">Day scholar (no hostel)</option>
          {hostels.data?.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Room number">
        <input value={f.roomNumber} onChange={upd('roomNumber')} disabled={!f.hostelId} />
      </Field>
      <div className="span-2">
        <ErrorNote error={error} />
        <div className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding...' : 'Add student'}
          </button>
        </div>
      </div>
    </form>
  );
}
