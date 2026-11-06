import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { sectionOptions, useClasses, useHostels } from '../api/hooks';
import type { Gender, Page, Student } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { CredentialSlip, Empty, ErrorNote, Field, Loading, Modal, PageHead, Pager, StatusPill } from '../components/ui';

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

  const q = useQuery({
    queryKey: ['students', filters, page],
    queryFn: () => api<Page<Student>>('/students', { query: { ...filters, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const selectedClass = classes.data?.find((c) => c.id === filters.classId);

  return (
    <>
      <PageHead
        title="Students"
        sub={q.data ? `${q.data.total} student${q.data.total === 1 ? '' : 's'}` : undefined}
        actions={
          can(P.StudentsCredentials) && (
            <>
              <Link to="/students/import" className="btn btn-quiet">
                Import from CSV
              </Link>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                Add student
              </button>
            </>
          )
        }
      />

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          set('search', search.trim());
        }}
      >
        <input
          type="search"
          placeholder="Search name, student ID or roll no."
          aria-label="Search students"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => search.trim() !== filters.search && set('search', search.trim())}
        />
        <select aria-label="Class" value={filters.classId} onChange={(e) => set('classId', e.target.value)}>
          <option value="">All classes</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Section" value={filters.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
          <option value="">All sections</option>
          {selectedClass
            ? selectedClass.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Section {s.name}
                </option>
              ))
            : sectionOptions(classes.data).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
        </select>
        <select
          aria-label="Hostel or day scholar"
          value={filters.hostelId ? `h:${filters.hostelId}` : filters.residence}
          onChange={(e) => {
            const v = e.target.value;
            const next = new URLSearchParams(params);
            next.delete('page');
            next.delete('hostelId');
            next.delete('residence');
            if (v.startsWith('h:')) next.set('hostelId', v.slice(2));
            else if (v) next.set('residence', v);
            setParams(next, { replace: true });
          }}
        >
          <option value="">Hostel and day scholars</option>
          <option value="hostel">Hostel students</option>
          <option value="day">Day scholars (non-hostel)</option>
        </select>
        <select aria-label="Boys or girls" value={filters.gender} onChange={(e) => set('gender', e.target.value)}>
          <option value="">Boys and girls</option>
          <option value="MALE">Boys</option>
          <option value="FEMALE">Girls</option>
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <select aria-label="Tablet" value={filters.hasTablet} onChange={(e) => set('hasTablet', e.target.value)}>
          <option value="">With or without tablet</option>
          <option value="true">Has a tablet</option>
          <option value="false">No tablet</option>
        </select>
      </form>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="No students match these filters">
          {Object.values(filters).some(Boolean) ? 'Clear a filter to see more.' : 'Add students one at a time or import a class list.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th className="num">Roll</th>
                <th>Hostel</th>
                <th>Tablet</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/students/${s.id}`} className="strong-link">
                      {s.fullName}
                    </Link>
                    <div className="mono small muted">{s.studentCode}</div>
                  </td>
                  <td>
                    {s.classGroup.name}
                    <span className="muted"> · {s.section.name}</span>
                  </td>
                  <td className="num">{s.rollNumber}</td>
                  <td>{s.hostel ? `${s.hostel.name}${s.roomNumber ? `, room ${s.roomNumber}` : ''}` : <span className="muted">Day scholar</span>}</td>
                  <td className="mono small">{s.tablet?.serialNumber ?? <span className="muted">None</span>}</td>
                  <td>
                    <StatusPill status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} />}

      <Modal open={adding} title="Add student" onClose={() => setAdding(false)} wide>
        <AddStudentForm onClose={() => setAdding(false)} />
      </Modal>
    </>
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
          <option value="">Choose…</option>
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
            {busy ? 'Adding…' : 'Add student'}
          </button>
        </div>
      </div>
    </form>
  );
}
