import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useTeachers } from '../api/hooks';
import type { Assignment, ClassGroup, Holiday, TimetableSlot } from '../api/types';
import { Icon } from './icons';
import { ErrorNote, Field, Loading } from './ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type Row = Omit<TimetableSlot, 'id' | 'subjectCode' | 'subjectName' | 'teacherName'>;

export function TimetableEditor({ cls, sectionId, onDone, onCancel }: { cls: ClassGroup; sectionId: string; onDone: () => void; onCancel: () => void }) {
  const teachers = useTeachers();
  const q = useQuery({ queryKey: ['timetable', sectionId], queryFn: () => api<TimetableSlot[]>(`/sections/${sectionId}/timetable`) });
  const assignments = useQuery({ queryKey: ['assignments', cls.id], queryFn: () => api<Assignment[]>(`/classes/${cls.id}/teachers`) });
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) setRows(q.data.map(({ dayOfWeek, startTime, endTime, subjectId, teacherId, topic, room }) => ({ dayOfWeek, startTime, endTime, subjectId, teacherId, topic, room })));
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  const defaultTeacher = (subjectId: string) => assignments.data?.find((a) => a.subjectId === subjectId)?.teacherId ?? null;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (day: number) => {
    const same = rows.filter((r) => r.dayOfWeek === day).sort((a, b) => a.endTime.localeCompare(b.endTime));
    const start = same.at(-1)?.endTime ?? '08:30';
    const [h, m] = start.split(':').map(Number);
    const end = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const subjectId = cls.subjects[0]?.id ?? '';
    setRows((rs) => [...rs, { dayOfWeek: day, startTime: start, endTime: end, subjectId, teacherId: defaultTeacher(subjectId), topic: null, room: null }]);
  };
  const copyMonday = () => {
    const monday = rows.filter((r) => r.dayOfWeek === 1);
    setRows([...monday, ...[2, 3, 4, 5, 6].flatMap((d) => monday.map((r) => ({ ...r, dayOfWeek: d })))]);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sections/${sectionId}/timetable`, { method: 'PUT', body: { slots: rows } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="small muted">
        Periods appear on students’ home screens as “Today’s classes”. Use the college’s local time.{' '}
        {rows.some((r) => r.dayOfWeek === 1) && (
          <button type="button" className="link-btn" onClick={copyMonday}>
            Copy Monday to Tuesday–Saturday
          </button>
        )}
      </p>
      <div className="tt-grid">
        {DAYS.map((name, idx) => {
          const day = idx + 1;
          const list = rows.map((r, i) => [r, i] as const).filter(([r]) => r.dayOfWeek === day);
          if (day === 7 && !list.length) return null;
          return (
            <div key={day} className="tt-day">
              <b className="small">{name}</b>
              {list.map(([r, i]) => (
                <div key={i} className="tt-row">
                  <input type="time" aria-label="Start" value={r.startTime} onChange={(e) => set(i, { startTime: e.target.value })} />
                  <input type="time" aria-label="End" value={r.endTime} onChange={(e) => set(i, { endTime: e.target.value })} />
                  <select aria-label="Subject" value={r.subjectId} onChange={(e) => set(i, { subjectId: e.target.value, teacherId: defaultTeacher(e.target.value) ?? r.teacherId })}>
                    {cls.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Teacher" value={r.teacherId ?? ''} onChange={(e) => set(i, { teacherId: e.target.value || null })}>
                    <option value="">No teacher</option>
                    {teachers.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName}
                      </option>
                    ))}
                  </select>
                  <input aria-label="Room" placeholder="Room" value={r.room ?? ''} onChange={(e) => set(i, { room: e.target.value || null })} />
                  <button type="button" className="icon-btn" aria-label="Remove period" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              ))}
              <button type="button" className="link-btn justify-start small" onClick={() => add(day)}>
                Add period
              </button>
            </div>
          );
        })}
      </div>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save timetable'}
        </button>
      </div>
    </div>
  );
}

export function TeachersEditor({ cls, onDone, onCancel }: { cls: ClassGroup; onDone: () => void; onCancel: () => void }) {
  const teachers = useTeachers();
  const q = useQuery({ queryKey: ['assignments', cls.id], queryFn: () => api<Assignment[]>(`/classes/${cls.id}/teachers`) });
  const [map, setMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setMap(Object.fromEntries(q.data.map((a) => [a.subjectId, a.teacherId])));
  }, [q.data]);
  if (q.isLoading || teachers.isLoading) return <Loading />;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/classes/${cls.id}/teachers`, {
        method: 'PUT',
        body: { assignments: Object.entries(map).filter(([, t]) => t).map(([subjectId, teacherId]) => ({ subjectId, teacherId })) },
      });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="small muted">Teachers can publish materials, tests and live classes only for the subjects they’re assigned here.</p>
      {!teachers.data?.items.length && <p className="callout">There are no staff with the Teacher role yet. Add them under Staff accounts.</p>}
      {cls.subjects.map((s) => (
        <Field key={s.id} label={s.name}>
          <select id={`teach-${s.id}`} value={map[s.id] ?? ''} onChange={(e) => setMap({ ...map, [s.id]: e.target.value })}>
            <option value="">Not assigned</option>
            {teachers.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save teachers'}
        </button>
      </div>
    </div>
  );
}

export function HolidaysPanel({ canWrite, from, to }: { canWrite: boolean; from: string; to: string }) {
  const q = useQuery({ queryKey: ['holidays', from, to], queryFn: () => api<Holiday[]>('/holidays', { query: { from, to } }) });
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  async function add() {
    setError(null);
    try {
      await api('/holidays', { method: 'POST', body: { date, name } });
      setDate('');
      setName('');
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  }
  async function remove(id: string) {
    setError(null);
    try {
      await api(`/holidays/${id}`, { method: 'DELETE' });
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  }
  const fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section className="panel">
      <h2 className="panel-title">Holidays</h2>
      <p className="small muted">Holidays are shown to students, and no classes are scheduled on them.</p>
      {q.data?.length ? (
        <div className="chips">
          {q.data.map((h) => (
            <span key={h.id} className="chip">
              <b>{fmt.format(new Date(`${h.date}T00:00:00`))}</b> {h.name}
              {canWrite && (
                <button className="chip-x" aria-label={`Remove ${h.name}`} onClick={() => void remove(h.id)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="faint small">No holidays added for this year.</p>
      )}
      {canWrite && (
        <div className="filters">
          <input id="hol-date" type="date" aria-label="Holiday date" value={date} min={from} max={to} onChange={(e) => setDate(e.target.value)} />
          <input id="hol-name" aria-label="Holiday name" placeholder="Kannada Rajyotsava" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} />
          <button className="btn btn-quiet" disabled={!date || name.trim().length < 2} onClick={() => void add()}>
            Add holiday
          </button>
        </div>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
