import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, uploadFile } from '../api/client';
import { useClasses } from '../api/hooks';
import type { Material, MaterialKind, Page } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ClassSubjectPicker } from '../components/ClassSubjectPicker';
import { Icon, SubjectChip } from '../components/icons';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, Pager, Toggle, useConfirm, useToast } from '../components/ui';
import { fmtBytes, fmtDate } from '../lib/format';

const KIND_LABEL: Record<MaterialKind, string> = { PDF: 'Notes (PDF)', SLIDES: 'Slides (PDF)', VIDEO: 'Video', LINK: 'Web link' };

export function MaterialsPage() {
  const { can } = useAuth();
  const write = can(P.MaterialsWrite);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const classes = useClasses();
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [error, setError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ['materials', classId, applied, page],
    queryFn: () => api<Page<Material>>('/materials', { query: { classId, search: applied, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['materials'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  async function act(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try {
      await fn();
      refresh();
      toast(msg);
    } catch (e) {
      setError(e);
    }
  }

  async function openFile(m: Material) {
    try {
      const blob = await api<Blob>(`/materials/${m.id}/file`, { raw: true });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <PageHead
        title="Study materials"
        sub="Notes, slides and videos appear on students’ tablets once published. Downloadable items work without Wi-Fi."
        actions={
          write && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Publish material
            </button>
          )
        }
      />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
          setPage(1);
        }}
      >
        <input id="mat-search" type="search" aria-label="Search materials" placeholder="Search title or chapter" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setApplied(search.trim())} />
        <select id="mat-class" aria-label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1); }}>
          <option value="">All classes</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </form>
      <ErrorNote error={error} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title={applied || classId ? 'No materials match' : 'No study materials yet'}>{write && !applied && 'Publish notes, slides or a video for a class.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Subject</th>
                <th>Class</th>
                <th>Type</th>
                <th>Studied by</th>
                <th>Status</th>
                <th className="num">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((m) => {
                const pct = m.studentCount ? Math.round((m.completedCount / m.studentCount) * 100) : 0;
                return (
                  <tr key={m.id}>
                    <td>
                      <b>{m.title}</b>
                      <div className="small muted">
                        {m.chapter}
                        {m.createdByName && ` · ${m.createdByName}`}
                      </div>
                    </td>
                    <td>
                      <SubjectChip code={m.subjectCode} name={m.subjectName} />
                    </td>
                    <td className="small">{m.className}</td>
                    <td className="small">
                      {KIND_LABEL[m.kind]}
                      <div className="faint tiny">
                        {m.sizeBytes ? fmtBytes(m.sizeBytes) : ''}
                        {m.kind !== 'LINK' && (m.allowOffline ? ' · offline allowed' : ' · stream only')}
                      </div>
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <div className="bar" aria-hidden>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <span className="tiny muted">
                        {m.completedCount} of {m.studentCount} students
                      </span>
                    </td>
                    <td>
                      {m.publishedAt ? <span className="pill pill-ok">Published {fmtDate(m.publishedAt)}</span> : <span className="pill pill-neutral">Draft</span>}
                      {!m.hasFile && m.kind !== 'LINK' && <div className="tiny down">File missing</div>}
                    </td>
                    <td className="num nowrap">
                      {m.hasFile && (
                        <button className="btn btn-quiet btn-sm" onClick={() => void openFile(m)}>
                          Open
                        </button>
                      )}
                      {m.kind === 'LINK' && m.externalUrl && (
                        <a className="btn btn-quiet btn-sm" href={m.externalUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      )}
                      {write &&
                        (m.publishedAt ? (
                          <button className="btn btn-quiet btn-sm" onClick={() => void act(() => api(`/materials/${m.id}/unpublish`, { method: 'POST' }), 'Material withdrawn from tablets')}>
                            Withdraw
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => void act(() => api(`/materials/${m.id}/publish`, { method: 'POST' }), 'Published to students')}>
                            Publish
                          </button>
                        ))}
                      {write && (
                        <button
                          className="btn btn-quiet btn-sm danger-text"
                          aria-label={`Delete ${m.title}`}
                          onClick={async () => {
                            if (await confirm(`Delete “${m.title}”?`, 'It is removed from every tablet the next time they sync. Progress records are deleted too.', 'Delete', true))
                              await act(() => api(`/materials/${m.id}`, { method: 'DELETE' }), 'Material deleted');
                          }}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}

      <Modal
        open={adding}
        title="Publish study material"
        onClose={() => {
          setAdding(false);
          if (params.get('new')) setParams({}, { replace: true });
        }}
        wide
      >
        {adding && (
          <MaterialForm
            onDone={(published) => {
              refresh();
              toast(published ? 'Published. Students see it on their tablets.' : 'Saved as a draft.');
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Modal>
      {dialog}
    </>
  );
}

function MaterialForm({ onDone, onCancel }: { onDone: (published: boolean) => void; onCancel: () => void }) {
  const [pair, setPair] = useState({ classId: '', subjectId: '' });
  const [kind, setKind] = useState<MaterialKind>('PDF');
  const [chapter, setChapter] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [durationMin, setDuration] = useState('');
  const [allowOffline, setOffline] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind === 'LINK') setOffline(false);
  }, [kind]);

  const accept = kind === 'VIDEO' ? 'video/mp4,video/webm' : 'application/pdf';

  async function save(publish: boolean, e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (kind !== 'LINK' && !file) return setError(new Error(kind === 'VIDEO' ? 'Choose an MP4 or WebM video file.' : 'Choose a PDF file.'));
    if (kind === 'LINK' && !url) return setError(new Error('Enter the https:// link.'));
    setBusy(true);
    let created: Material | null = null;
    try {
      created = await api<Material>('/materials', {
        method: 'POST',
        body: {
          ...pair,
          kind,
          chapter,
          title,
          description: description || null,
          externalUrl: kind === 'LINK' ? url : null,
          durationMin: durationMin ? Number(durationMin) : null,
          allowOffline,
        },
      });
      if (file) {
        setProgress(0);
        await uploadFile(`/materials/${created.id}/file`, file, setProgress);
      }
      if (publish) await api(`/materials/${created.id}/publish`, { method: 'POST' });
      onDone(publish);
    } catch (err) {
      // Don't leave a half-made draft behind if the upload failed.
      if (created && file) await api(`/materials/${created.id}`, { method: 'DELETE' }).catch(() => undefined);
      setError(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(e) => void save(true, e)} className="stack">
      <div className="grid-form">
        <ClassSubjectPicker idPrefix="mat" classId={pair.classId} subjectId={pair.subjectId} onChange={setPair} />
        <Field label="Chapter">
          <input id="mat-chapter" required value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Electrostatic Potential and Capacitance" />
        </Field>
        <Field label="Title">
          <input id="mat-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Revision notes" />
        </Field>
        <Field label="Type">
          <select id="mat-kind" value={kind} onChange={(e) => { setKind(e.target.value as MaterialKind); setFile(null); }}>
            {(Object.keys(KIND_LABEL) as MaterialKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'VIDEO' && (
          <Field label="Length (minutes)">
            <input id="mat-duration" type="number" min={1} max={600} value={durationMin} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        )}
        <div className="span-2">
          {kind === 'LINK' ? (
            <Field label="Link" hint="An https:// page students open on the tablet">
              <input id="mat-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </Field>
          ) : (
            <Field label="File" hint={kind === 'VIDEO' ? 'MP4 or WebM' : kind === 'SLIDES' ? 'Export slides to PDF first' : 'PDF'}>
              <input id="mat-file" type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          )}
          <Field label="Description (optional)">
            <textarea id="mat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {kind !== 'LINK' && (
            <div className="toggle-row">
              <span>
                <b>Allow download for offline study</b>
                <br />
                <span className="small muted">Stored on the tablet so it opens without Wi-Fi.</span>
              </span>
              <Toggle checked={allowOffline} onChange={setOffline} label="Allow offline" />
            </div>
          )}
          {progress !== null && (
            <div>
              <div className="progress" aria-label="Upload progress">
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="tiny muted">Uploading {Math.round(progress * 100)}%</span>
            </div>
          )}
          <ErrorNote error={error} />
          <div className="form-actions">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void save(false)}>
              Save as draft
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Publish to students'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
