import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditEntry, Page } from '../api/types';
import { Empty, ErrorNote, Loading, Pager } from '../components/ui';
import { fmtAction, fmtDateTime } from '../lib/format';
import './AdminPages.css';

const ENTITY_TYPES = ['student', 'staff', 'tablet', 'test', 'class', 'section', 'subject', 'hostel', 'academic_year'];
const DOT = ' \u00b7 ';

/** Colour and icon for each kind of action: sign-ins, things added, changes, removals. */
function kindOf(action: string): 'signin' | 'create' | 'change' | 'remove' | 'other' {
  const a = action.toLowerCase();
  if (/^auth\.|login|logout/.test(a)) return 'signin';
  if (/delete|remove|revoke|wipe|lost|retire|suspend/.test(a)) return 'remove';
  if (/create|import|enroll|add|publish/.test(a)) return 'create';
  if (/update|status|reset|transfer|assign|change|edit|photo|revive|restart|force|review/.test(a)) return 'change';
  return 'other';
}

const ICON: Record<ReturnType<typeof kindOf>, string> = {
  signin: 'M15 4h4v16h-4M10 8l4 4-4 4M14 12H3',
  create: 'M12 5v14M5 12h14',
  change: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  remove: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  other: 'M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

function entityLink(a: AuditEntry) {
  if (!a.entityId) return null;
  if (a.entityType === 'student') return <Link className="pg-link" to={`/students/${a.entityId}`}>Open student</Link>;
  if (a.entityType === 'test') return <Link className="pg-link" to={`/tests/${a.entityId}`}>Open test</Link>;
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
    <div className="pg">
      <div className="pg-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every sign-in and change to students, staff, tablets, tests and classes</p>
        </div>
      </div>

      <section className="pg-card">
        <form className="pg-filters" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setPage(1); }}>
          <label className="pg-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" aria-label="Search" placeholder="Who or what action" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => { setApplied(search.trim()); setPage(1); }} />
          </label>
          <label className="pg-select">
            Record
            <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
              <option value="">All records</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}</option>)}
            </select>
          </label>
          <label className="pg-select">
            From
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="pg-select">
            To
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </label>
        </form>

        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="pg-pad"><ErrorNote error={q.error} /></div>
        ) : !q.data!.items.length ? (
          <div className="pg-pad"><Empty title="No entries match these filters" /></div>
        ) : (
          <div className="pg-table">
            <table>
              <thead>
                <tr>
                  <th>What happened</th>
                  <th>Who</th>
                  <th>When</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((a) => {
                  const kind = kindOf(a.action);
                  return (
                    <tr key={a.id}>
                      <td>
                        <span className="pg-action">
                          <i className={kind} aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[kind]} /></svg>
                          </i>
                          <span className="pg-strong">{fmtAction(a.action)}</span>
                        </span>
                      </td>
                      <td>
                        <span className="pg-strong">{a.actorLabel ?? 'System'}</span>
                        <div className="pg-sub">
                          {a.actorType === 'STUDENT' ? 'Student' : a.actorType === 'STAFF' ? 'Staff' : a.actorId ? '' : 'Not signed in'}
                          {a.ip && `${DOT}${a.ip}`}
                        </div>
                      </td>
                      <td className="nowrap">{fmtDateTime(a.createdAt)}</td>
                      <td>
                        {entityLink(a)}
                        {a.metadata && (
                          <>
                            {entityLink(a) && DOT}
                            <button className="pg-link" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                              {open === a.id ? 'Hide details' : 'Show details'}
                            </button>
                            {open === a.id && <pre className="pg-meta">{JSON.stringify(a.metadata, null, 2)}</pre>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {q.data && q.data.total > 0 && (
          <div className="pg-foot">
            <span>{q.data.total.toLocaleString('en-IN')} entr{q.data.total === 1 ? 'y' : 'ies'}</span>
            {q.data.total > q.data.pageSize && <Pager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
          </div>
        )}
      </section>
    </div>
  );
}
