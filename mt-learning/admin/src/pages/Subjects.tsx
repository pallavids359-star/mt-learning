import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useSubjects } from '../api/hooks';
import type { Subject } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, useToast } from '../components/ui';

export function SubjectsPage() {
  const { can } = useAuth();
  const write = can(P.AcademicWrite);
  const q = useSubjects();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);

  return (
    <>
      <PageHead
        title="Subjects"
        sub="Subjects are shared across years. Assign them to classes on the Classes & sections page."
        actions={write && <button className="btn btn-primary" onClick={() => setEditing('new')}>Add subject</button>}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.length ? (
        <Empty title="No subjects yet">Add subjects such as Physics, Chemistry, Mathematics and Biology.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Subject</th>
                <th>In use</th>
                {write && <th className="num"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {q.data!.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'row-muted'}>
                  <td className="mono">{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.isActive ? 'Yes' : 'Retired'}</td>
                  {write && (
                    <td className="num">
                      <button className="btn btn-quiet btn-sm" onClick={() => setEditing(s)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} title={editing === 'new' ? 'Add subject' : 'Edit subject'} onClose={() => setEditing(null)}>
        {editing && (
          <SubjectForm
            subject={editing === 'new' ? null : editing}
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ['subjects'] });
              void qc.invalidateQueries({ queryKey: ['classes'] });
              toast(editing === 'new' ? 'Subject added' : 'Subject saved');
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function SubjectForm({ subject, onDone, onCancel }: { subject: Subject | null; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(subject?.code ?? '');
  const [name, setName] = useState(subject?.name ?? '');
  const [isActive, setActive] = useState(subject?.isActive ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (subject) await api(`/subjects/${subject.id}`, { method: 'PATCH', body: { name, isActive } });
      else await api('/subjects', { method: 'POST', body: { code, name } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <Field label="Code" hint={subject ? 'Codes cannot be changed' : '2–12 letters or digits, e.g. PHY'}>
        <input required className="mono" value={code} disabled={!!subject} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {subject && (
        <label className="check">
          <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} /> In use (untick to retire the subject)
        </label>
      )}
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : subject ? 'Save subject' : 'Add subject'}</button>
      </div>
    </form>
  );
}
