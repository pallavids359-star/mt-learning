import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { localInputToIso, sectionOptions, useClasses, useHostels, useMyTeaching } from '../api/hooks';
import type { AudienceType, Notice, NoticeCategory, Page } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Icon } from '../components/icons';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, Pager, useConfirm, useToast } from '../components/ui';
import { fmtAgo, fmtWhen } from '../lib/format';

const CATEGORY: Record<NoticeCategory, [string, string]> = {
  GENERAL: ['General', 'pill-neutral'],
  EXAM: ['Exam', 'pill-board'],
  HOSTEL: ['Hostel', 'pill-warn'],
  HOLIDAY: ['Holiday', 'pill-ok'],
  EVENT: ['Event', 'pill-neutral'],
};

export function NoticesPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ['notices', page],
    queryFn: () => api<Page<Notice>>('/notices', { query: { page, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });
  const admin = me && ['SUPER_ADMIN', 'COLLEGE_ADMIN', 'PRINCIPAL'].includes(me.role);

  return (
    <>
      <PageHead
        title="Notices"
        sub="Sent to tablets straight away. Tablets that are offline receive them when they reconnect."
        actions={
          can(P.NoticesWrite) && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Post notice
            </button>
          )
        }
      />
      <ErrorNote error={error} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title="No notices yet">{can(P.NoticesWrite) && 'Post exam dates, hostel rules or holidays.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Notice</th>
                <th>Sent to</th>
                <th>From</th>
                <th>Posted</th>
                <th className="num">Read by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((n) => {
                const pct = n.audienceSize ? Math.round((n.readCount / n.audienceSize) * 100) : 0;
                const expired = n.expiresAt && new Date(n.expiresAt) < new Date();
                return (
                  <tr key={n.id} className={expired ? 'row-muted' : ''}>
                    <td style={{ maxWidth: 420 }}>
                      <span className={`pill ${CATEGORY[n.category][1]}`}>{CATEGORY[n.category][0]}</span> <b>{n.title}</b>
                      <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.body}
                      </div>
                      {n.expiresAt && <div className="tiny faint">{expired ? 'Expired' : 'Until'} {fmtWhen(n.expiresAt)}</div>}
                    </td>
                    <td className="small">{n.audienceName}</td>
                    <td className="small">{n.postedByLabel}</td>
                    <td className="small nowrap">{fmtAgo(n.publishedAt)}</td>
                    <td className="num" style={{ minWidth: 120 }}>
                      {n.readCount} / {n.audienceSize}
                      <div className="bar" aria-hidden>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="num">
                      {(admin || n.postedBy === me?.id) && can(P.NoticesWrite) && (
                        <button
                          className="icon-btn"
                          aria-label={`Withdraw ${n.title}`}
                          onClick={async () => {
                            if (!(await confirm('Withdraw this notice?', 'It disappears from every tablet the next time they sync.', 'Withdraw', true))) return;
                            setError(null);
                            try {
                              await api(`/notices/${n.id}`, { method: 'DELETE' });
                              void qc.invalidateQueries({ queryKey: ['notices'] });
                              toast('Notice withdrawn');
                            } catch (e) {
                              setError(e);
                            }
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
        title="Post a notice"
        onClose={() => {
          setAdding(false);
          if (params.get('new')) setParams({}, { replace: true });
        }}
      >
        {adding && (
          <NoticeForm
            role={me!.role}
            onDone={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ['notices'] });
              toast('Notice sent to tablets');
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Modal>
      {dialog}
    </>
  );
}

function NoticeForm({ role, onDone, onCancel }: { role: string; onDone: () => void; onCancel: () => void }) {
  const classes = useClasses();
  const hostels = useHostels();
  const mine = useMyTeaching();
  const teacher = role === 'TEACHER';
  const warden = role === 'HOSTEL_WARDEN';
  const audiences: [AudienceType, string][] = teacher
    ? [['CLASS', 'A class'], ['SECTION', 'A section']]
    : warden
      ? [['HOSTEL', 'A hostel']]
      : [['ALL', 'All students'], ['CLASS', 'A class'], ['SECTION', 'A section'], ['HOSTEL', 'A hostel']];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<NoticeCategory>(warden ? 'HOSTEL' : 'GENERAL');
  const [audienceType, setAudienceType] = useState<AudienceType>(audiences[0][0]);
  const [audienceId, setAudienceId] = useState('');
  const [expiresAt, setExpires] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const taughtClassIds = new Set(mine.data?.pairs.map((p) => p.classId));
  const classList = (classes.data ?? []).filter((c) => !teacher || taughtClassIds.has(c.id));
  const options =
    audienceType === 'CLASS'
      ? classList.map((c) => ({ id: c.id, label: c.name }))
      : audienceType === 'SECTION'
        ? sectionOptions(classList)
        : audienceType === 'HOSTEL'
          ? (hostels.data ?? []).map((h) => ({ id: h.id, label: h.name }))
          : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/notices', {
        method: 'POST',
        body: {
          title,
          body,
          category,
          audienceType,
          audienceId: audienceType === 'ALL' ? undefined : audienceId || options[0]?.id,
          expiresAt: expiresAt ? localInputToIso(expiresAt) : undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <Field label="Title">
        <input id="notice-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tablet charging check on Saturday" />
      </Field>
      <Field label="Message">
        <textarea id="notice-body" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="grid-form">
        <Field label="Category">
          <select id="notice-category" value={category} onChange={(e) => setCategory(e.target.value as NoticeCategory)}>
            {(Object.keys(CATEGORY) as NoticeCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY[c][0]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Send to">
          <select id="notice-audience" value={audienceType} onChange={(e) => { setAudienceType(e.target.value as AudienceType); setAudienceId(''); }}>
            {audiences.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {audienceType !== 'ALL' && (
          <Field label={audienceType === 'HOSTEL' ? 'Hostel' : audienceType === 'SECTION' ? 'Section' : 'Class'}>
            <select id="notice-target" required value={audienceId || options[0]?.id || ''} onChange={(e) => setAudienceId(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Remove after (optional)">
          <input id="notice-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Posting…' : 'Post notice'}
        </button>
      </div>
    </form>
  );
}
