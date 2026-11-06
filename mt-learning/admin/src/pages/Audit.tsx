import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditEntry, Page } from '../api/types';
import { Empty, ErrorNote, Loading, PageHead, Pager } from '../components/ui';
import { fmtAction, fmtDateTime } from '../lib/format';

const ENTITY_TYPES = ['student', 'staff', 'tablet', 'class', 'section', 'subject', 'hostel', 'academic_year'];

function entityLink(a: AuditEntry) {
  if (!a.entityId) return null;
  if (a.entityType === 'student') return <Link to={`/students/${a.entityId}`}>Open student</Link>;
  return null;
}

export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['audit', entityType, applied, from, to, page],
    queryFn: () =>
      api<Page<AuditEntry>>('/audit-logs', {
        query: {
          entityType,
          search: applied,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          pageSize: 50,
        },
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHead title="Audit log" sub="Every sign-in and change to students, staff, tablets and academic records." />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setPage(1); }}>
        <input type="search" aria-label="Search" placeholder="Who or what action" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => { setApplied(search.trim()); setPage(1); }} />
        <select aria-label="Record type" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
          <option value="">All records</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <label className="inline-field">From <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="inline-field">To <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      </form>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty title="No entries match these filters" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmtDateTime(a.createdAt)}</td>
                  <td>
                    {a.actorLabel ?? 'System'}
                    <div className="muted small">{a.actorType === 'STUDENT' ? 'Student' : a.actorType === 'STAFF' ? 'Staff' : a.actorId ? '' : 'Not signed in'}{a.ip && ` · ${a.ip}`}</div>
                  </td>
                  <td>{fmtAction(a.action)}</td>
                  <td>
                    {entityLink(a)}
                    {a.metadata && (
                      <>
                        {' '}
                        <button className="link-btn" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                          {open === a.id ? 'Hide data' : 'Show data'}
                        </button>
                        {open === a.id && <pre className="meta">{JSON.stringify(a.metadata, null, 2)}</pre>}
                      </>
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
