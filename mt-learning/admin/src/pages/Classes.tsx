import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useClasses, useSubjects, useYears } from '../api/hooks';
import type { ClassGroup, PucYear } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, useConfirm, useToast } from '../components/ui';
import { fmtDate, PUC_LABEL } from '../lib/format';
import { HolidaysPanel, TeachersEditor, TimetableEditor } from '../components/TimetableEditor';
import { useQuery } from '@tanstack/react-query';
import type { Assignment } from '../api/types';

type Dlg = { kind: 'year' } | { kind: 'class' } | { kind: 'subjects'; c: ClassGroup } | { kind: 'section'; c: ClassGroup } | { kind: 'teachers'; c: ClassGroup } | { kind: 'timetable'; c: ClassGroup; sectionId: string; sectionName: string } | null;

export function ClassesPage() {
  const { can } = useAuth();
  const write = can(P.AcademicWrite);
  const years = useYears();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [yearId, setYearId] = useState<string>('');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!yearId && years.data?.length) setYearId(years.data.find((y) => y.isCurrent)?.id ?? years.data[0].id);
  }, [years.data, yearId]);

  const classes = useClasses(yearId || undefined);
  const year = years.data?.find((y) => y.id === yearId);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['classes'] });
    void qc.invalidateQueries({ queryKey: ['years'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  async function act(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try {
      await fn();
      invalidate();
      toast(msg);
    } catch (e) {
      setError(e);
    }
  }

  if (years.isLoading) return <Loading />;

  return (
    <>
      <PageHead
        title="Classes & timetable"
        actions={
          write && (
            <>
              <button className="btn btn-quiet" onClick={() => setDlg({ kind: 'year' })}>
                Add academic year
              </button>
              <button className="btn btn-primary" disabled={!yearId} onClick={() => setDlg({ kind: 'class' })}>
                Add class
              </button>
            </>
          )
        }
      />

      {!years.data?.length ? (
        <Empty title="No academic years yet">
          {write ? (
            <button className="btn btn-primary" onClick={() => setDlg({ kind: 'year' })}>
              Add the first academic year
            </button>
          ) : (
            'A College Administrator needs to set up the academic year.'
          )}
        </Empty>
      ) : (
        <>
          <div className="year-tabs" role="tablist" aria-label="Academic year">
            {years.data.map((y) => (
              <button key={y.id} role="tab" aria-selected={y.id === yearId} className="year-tab" onClick={() => setYearId(y.id)}>
                {y.name}
                {y.isCurrent && <span className="current-dot" title="Current year" />}
              </button>
            ))}
          </div>
          {year && (
            <p className="muted year-line">
              {fmtDate(year.startDate)} to {fmtDate(year.endDate)}.{' '}
              {year.isCurrent ? (
                'This is the current year; students and tablets use its classes.'
              ) : write ? (
                <button
                  className="link-btn"
                  onClick={async () => {
                    if (await confirm('Make this the current year?', `The portal and student app will use ${year.name} as the current academic year.`, 'Make current'))
                      await act(() => api(`/academic-years/${year.id}/set-current`, { method: 'POST' }), `${year.name} is now the current year`);
                  }}
                >
                  Make this the current year
                </button>
              ) : null}
            </p>
          )}
          <ErrorNote error={error} />

          {classes.isLoading ? (
            <Loading />
          ) : !classes.data?.length ? (
            <Empty title={`No classes in ${year?.name ?? 'this year'}`}>Add a class such as “1st PUC Science (PCMB)” with its sections.</Empty>
          ) : (
            <div className="class-list">
              {classes.data.map((c) => (
                <section key={c.id} className="panel class-card">
                  <div className="panel-head">
                    <div>
                      <h2 className="panel-title">{c.name}</h2>
                      <p className="muted small">
                        {PUC_LABEL[c.pucYear]} · {c.stream} · {c.studentCount} students
                      </p>
                    </div>
                    {write && (
                      <button
                        className="btn btn-quiet btn-sm danger-text"
                        onClick={async () => {
                          if (await confirm(`Delete ${c.name}?`, 'The class and its empty sections are removed. Classes with students cannot be deleted.', 'Delete class', true))
                            await act(() => api(`/classes/${c.id}`, { method: 'DELETE' }), 'Class deleted');
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <div className="class-row">
                    <span className="field-label">Sections</span>
                    <div className="chips">
                      {c.sections.map((s) => (
                        <span key={s.id} className="chip">
                          {s.name} <span className="muted">{s.studentCount}</span>
                          {write && s.studentCount === 0 && (
                            <button
                              className="chip-x"
                              aria-label={`Remove section ${s.name}`}
                              onClick={() => void act(() => api(`/sections/${s.id}`, { method: 'DELETE' }), `Section ${s.name} removed`)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {write && (
                        <button className="chip chip-add" onClick={() => setDlg({ kind: 'section', c })}>
                          Add section
                        </button>
                      )}
                    </div>
                  </div>
                  <ClassTeachers c={c} canEdit={write} onEdit={() => setDlg({ kind: 'teachers', c })} onTimetable={(sectionId, sectionName) => setDlg({ kind: 'timetable', c, sectionId, sectionName })} />
                  <div className="class-row">
                    <span className="field-label">Subjects</span>
                    <div className="chips">
                      {c.subjects.length ? c.subjects.map((s) => <span key={s.id} className="chip">{s.name}</span>) : <span className="muted">None assigned</span>}
                      {write && (
                        <button className="chip chip-add" onClick={() => setDlg({ kind: 'subjects', c })}>
                          Edit subjects
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={dlg?.kind === 'year'} title="Add academic year" onClose={() => setDlg(null)}>
        <YearForm onDone={(id) => { invalidate(); setYearId(id); setDlg(null); toast('Academic year added'); }} onCancel={() => setDlg(null)} />
      </Modal>
      <Modal open={dlg?.kind === 'class'} title={`Add class to ${year?.name ?? ''}`} onClose={() => setDlg(null)}>
        {yearId && <ClassForm yearId={yearId} onDone={() => { invalidate(); setDlg(null); toast('Class added'); }} onCancel={() => setDlg(null)} />}
      </Modal>
      <Modal open={dlg?.kind === 'subjects'} title="Subjects taught in this class" onClose={() => setDlg(null)}>
        {dlg?.kind === 'subjects' && <SubjectsForm c={dlg.c} onDone={() => { invalidate(); setDlg(null); toast('Subjects saved'); }} onCancel={() => setDlg(null)} />}
      </Modal>
      <Modal open={dlg?.kind === 'section'} title="Add section" onClose={() => setDlg(null)}>
        {dlg?.kind === 'section' && <SectionForm c={dlg.c} onDone={() => { invalidate(); setDlg(null); toast('Section added'); }} onCancel={() => setDlg(null)} />}
      </Modal>
      <Modal open={dlg?.kind === 'teachers'} title="Who teaches each subject" onClose={() => setDlg(null)}>
        {dlg?.kind === 'teachers' && <TeachersEditor cls={dlg.c} onDone={() => { void qc.invalidateQueries({ queryKey: ['assignments'] }); setDlg(null); toast('Teachers saved'); }} onCancel={() => setDlg(null)} />}
      </Modal>
      <Modal open={dlg?.kind === 'timetable'} title={dlg?.kind === 'timetable' ? `Timetable · ${dlg.c.name}, section ${dlg.sectionName}` : ''} onClose={() => setDlg(null)} wide>
        {dlg?.kind === 'timetable' && <TimetableEditor cls={dlg.c} sectionId={dlg.sectionId} onDone={() => { void qc.invalidateQueries({ queryKey: ['timetable'] }); setDlg(null); toast('Timetable saved'); }} onCancel={() => setDlg(null)} />}
      </Modal>
      {year && <HolidaysPanel canWrite={write} from={year.startDate} to={year.endDate} />}
      {dialog}
    </>
  );
}

function ClassTeachers({ c, canEdit, onEdit, onTimetable }: { c: ClassGroup; canEdit: boolean; onEdit: () => void; onTimetable: (sectionId: string, sectionName: string) => void }) {
  const q = useQuery({ queryKey: ['assignments', c.id], queryFn: () => api<Assignment[]>(`/classes/${c.id}/teachers`) });
  return (
    <>
      <div className="class-row">
        <span className="field-label">Teachers</span>
        <div className="chips">
          {q.data?.length ? q.data.map((a) => <span key={`${a.subjectId}${a.teacherId}`} className="chip">{a.subjectName} <span className="muted">{a.teacherName}</span></span>) : <span className="muted small">None assigned</span>}
          {canEdit && (
            <button className="chip chip-add" onClick={onEdit}>
              Assign teachers
            </button>
          )}
        </div>
      </div>
      <div className="class-row">
        <span className="field-label">Timetable</span>
        <div className="chips">
          {c.sections.map((s) => (
            <button key={s.id} className="chip chip-add" onClick={() => onTimetable(s.id, s.name)}>
              {canEdit ? 'Edit' : 'View'} section {s.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy };
}

function Actions({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="form-actions">
      <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

function YearForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const y = new Date().getFullYear();
  const [name, setName] = useState(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  const [startDate, setStart] = useState(`${y}-06-01`);
  const [endDate, setEnd] = useState(`${y + 1}-03-31`);
  const [isCurrent, setCurrent] = useState(true);
  const { submit, error, busy } = useSubmit(
    () => api<{ id: string }>('/academic-years', { method: 'POST', body: { name, startDate, endDate, isCurrent } }),
    (r) => onDone(r.id),
  );
  return (
    <form onSubmit={submit} className="stack">
      <Field label="Name" hint="Format 2026-27"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid-form">
        <Field label="Starts"><input type="date" required value={startDate} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ends"><input type="date" required value={endDate} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={isCurrent} onChange={(e) => setCurrent(e.target.checked)} /> Make this the current year</label>
      <ErrorNote error={error} />
      <Actions busy={busy} label="Add academic year" onCancel={onCancel} />
    </form>
  );
}

function ClassForm({ yearId, onDone, onCancel }: { yearId: string; onDone: () => void; onCancel: () => void }) {
  const subjects = useSubjects();
  const [pucYear, setPuc] = useState<PucYear>('PUC_1');
  const [stream, setStream] = useState('');
  const [name, setName] = useState('');
  const [sections, setSections] = useState('A, B');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const { submit, error, busy } = useSubmit(
    () =>
      api('/classes', {
        method: 'POST',
        body: {
          academicYearId: yearId,
          pucYear,
          stream,
          name: name || `${PUC_LABEL[pucYear]} ${stream}`,
          sectionNames: sections.split(',').map((s) => s.trim()).filter(Boolean),
          subjectIds,
        },
      }),
    onDone,
  );
  return (
    <form onSubmit={submit} className="stack">
      <div className="grid-form">
        <Field label="Year">
          <select value={pucYear} onChange={(e) => setPuc(e.target.value as PucYear)}>
            <option value="PUC_1">1st PUC</option>
            <option value="PUC_2">2nd PUC</option>
          </select>
        </Field>
        <Field label="Stream / combination" hint="e.g. PCMB, PCMC, EBAC"><input required value={stream} onChange={(e) => setStream(e.target.value)} /></Field>
      </div>
      <Field label="Class name" hint={`Leave blank for “${PUC_LABEL[pucYear]} ${stream || '…'}”`}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${PUC_LABEL[pucYear]} Science (${stream || 'PCMB'})`} />
      </Field>
      <Field label="Sections" hint="Separate with commas"><input value={sections} onChange={(e) => setSections(e.target.value)} /></Field>
      <SubjectPicker all={subjects.data ?? []} value={subjectIds} onChange={setSubjectIds} />
      <ErrorNote error={error} />
      <Actions busy={busy} label="Add class" onCancel={onCancel} />
    </form>
  );
}

function SubjectPicker({ all, value, onChange }: { all: { id: string; name: string; code: string; isActive: boolean }[]; value: string[]; onChange: (v: string[]) => void }) {
  const active = all.filter((s) => s.isActive || value.includes(s.id));
  return (
    <fieldset className="check-grid">
      <legend className="field-label">Subjects</legend>
      {active.length === 0 && <p className="muted small">No subjects yet. Add them on the Subjects page.</p>}
      {active.map((s) => (
        <label key={s.id} className="check">
          <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
          {s.name} <span className="muted mono small">{s.code}</span>
        </label>
      ))}
    </fieldset>
  );
}

function SubjectsForm({ c, onDone, onCancel }: { c: ClassGroup; onDone: () => void; onCancel: () => void }) {
  const subjects = useSubjects();
  const [ids, setIds] = useState(c.subjects.map((s) => s.id));
  const { submit, error, busy } = useSubmit(() => api(`/classes/${c.id}/subjects`, { method: 'PUT', body: { subjectIds: ids } }), onDone);
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">{c.name}</p>
      <SubjectPicker all={subjects.data ?? []} value={ids} onChange={setIds} />
      <ErrorNote error={error} />
      <Actions busy={busy} label="Save subjects" onCancel={onCancel} />
    </form>
  );
}

function SectionForm({ c, onDone, onCancel }: { c: ClassGroup; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(() => api(`/classes/${c.id}/sections`, { method: 'POST', body: { name } }), onDone);
  return (
    <form onSubmit={submit} className="stack">
      <Field label={`New section in ${c.name}`}><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="C" /></Field>
      <ErrorNote error={error} />
      <Actions busy={busy} label="Add section" onCancel={onCancel} />
    </form>
  );
}
