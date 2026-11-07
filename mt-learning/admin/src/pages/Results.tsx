import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useClasses } from '../api/hooks';
import type { MarksSheet, PendingReview, PucYear } from '../api/types';
import { Empty, ErrorNote, Loading } from '../components/ui';
import './Results.css';

/**
 * Results & marks: pick Class 11 or 12, the stream and a section to see every student's marks
 * across the term's live tests, ranked from the top, and download them for Bridge.
 */

const DOT = ' \u00b7 ';
const DASH = '\u2014';
const fmt = (n: number) => n.toLocaleString('en-IN');

type Row = MarksSheet['students'][number];

/** Change between the student's last two tests, in percentage points. */
function change(sheet: MarksSheet, p: Row): number | null {
  const taken = sheet.tests.filter((t) => p.marks[t.id] !== null && p.marks[t.id] !== undefined && t.maxScore > 0);
  if (taken.length < 2) return null;
  const [a, b] = taken.slice(-2);
  const pa = (p.marks[a.id]! / a.maxScore) * 100;
  const pb = (p.marks[b.id]! / b.maxScore) * 100;
  return Math.round((pb - pa) * 10) / 10;
}

function csvCell(v: unknown) {
  const t = v === null || v === undefined ? '' : String(v);
  // Quote everything, and stop spreadsheet formulas from text that starts with = + - @
  return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
}

function exportSheet(m: MarksSheet, sectionName?: string) {
  const head = ['Rank', 'Student ID', 'Name', 'Roll no.', 'Class', 'Section', ...m.tests.map((t) => `${t.title} (out of ${t.maxScore})`), 'Total', 'Out of', 'Percent'];
  const body = m.students.map((p) => [p.rank, p.studentCode, p.studentName, p.rollNumber, m.className, p.sectionName, ...m.tests.map((t) => p.marks[t.id]), p.testsTaken ? p.total : '', p.testsTaken ? p.outOf : '', p.percent]);
  const csv = '\ufeff' + [head, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${m.className}${sectionName ? ` - Section ${sectionName}` : ''} - marks.csv`.replace(/[^\w\- ().]+/g, '').trim() || 'marks.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const classes = useClasses();
  const [find, setFind] = useState('');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const all = classes.data ?? [];
  const hasYear = (y: PucYear) => all.some((c) => c.pucYear === y);
  // Default to Class 12 (or Class 11 if there is no Class 12 yet), and its first stream.
  const year = ((params.get('year') as PucYear | null) ?? (hasYear('PUC_2') ? 'PUC_2' : 'PUC_1')) as PucYear;
  const inYear = all.filter((c) => c.pucYear === year);
  const classId = params.get('classId') && inYear.some((c) => c.id === params.get('classId')) ? params.get('classId')! : (inYear[0]?.id ?? '');
  const cls = inYear.find((c) => c.id === classId);
  const sectionId = params.get('sectionId') ?? '';
  const sectionName = cls?.sections.find((s) => s.id === sectionId)?.name;

  const pending = useQuery({ queryKey: ['reviews'], queryFn: () => api<PendingReview[]>('/tests/reviews/pending') });
  const sheet = useQuery({
    queryKey: ['marks', classId, sectionId],
    queryFn: () => api<MarksSheet>('/tests/marks', { query: { classId, sectionId } }),
    enabled: !!classId,
    placeholderData: keepPreviousData,
  });

  const s = sheet.data;
  const ranked = useMemo(() => (s ? s.students.filter((p) => p.rank !== null).sort((a, b) => a.rank! - b.rank!) : []), [s]);
  const unranked = s ? s.students.filter((p) => p.rank === null) : [];
  const term = find.trim().toLowerCase();
  const rows = [...ranked, ...unranked].filter((p) => !term || p.studentName.toLowerCase().includes(term) || p.studentCode.toLowerCase().includes(term));
  const podium = ranked.slice(0, 3);
  const outOf = s ? s.tests.reduce((t, x) => t + x.maxScore, 0) : 0;

  if (classes.isLoading) return <Loading />;

  return (
    <div className="res">
      <div className="res-head">
        <div>
          <h1>Results &amp; marks</h1>
          <p className="muted">Ranked from the top, for every live test this term</p>
        </div>
        <button className="btn btn-primary" disabled={!s?.students.length} onClick={() => s && exportSheet(s, sectionName)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />
          </svg>
          Export CSV
        </button>
      </div>

      {!!pending.data?.length && (
        <section className="res-review">
          <div>
            <b>
              {pending.data.length} submission{pending.data.length === 1 ? '' : 's'} to review
            </b>
            <span>Answered offline and uploaded late, or submitted after the time limit. Decide whether each one counts.</span>
          </div>
          <div className="res-review-list">
            {pending.data.slice(0, 4).map((p) => (
              <Link key={p.attemptId} to={`/tests/${p.testId}/results`}>
                {p.studentName}
                {DOT}
                {p.testTitle}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="res-filters">
        <div className="res-field">
          <span>Class</span>
          <div className="res-seg" role="group" aria-label="Class">
            {(['PUC_1', 'PUC_2'] as const).map((y) => (
              <button key={y} type="button" aria-pressed={year === y} disabled={!hasYear(y)} onClick={() => set({ year: y, classId: '', sectionId: '' })}>
                {y === 'PUC_1' ? 'Class 11' : 'Class 12'}
              </button>
            ))}
          </div>
        </div>
        <label className="res-field">
          <span>Stream</span>
          <select value={classId} onChange={(e) => set({ year, classId: e.target.value, sectionId: '' })} disabled={inYear.length < 2}>
            {inYear.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="res-field">
          <span>Section</span>
          <div className="res-seg" role="group" aria-label="Section">
            <button type="button" aria-pressed={!sectionId} onClick={() => set({ year, classId, sectionId: '' })}>
              All sections
            </button>
            {cls?.sections.map((x) => (
              <button key={x.id} type="button" aria-pressed={sectionId === x.id} onClick={() => set({ year, classId, sectionId: x.id })}>
                Section {x.name}
              </button>
            ))}
          </div>
        </div>
        <label className="res-field res-search">
          <span>Search</span>
          <input type="search" placeholder="Student name or ID" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
      </div>

      {!classId ? (
        <Empty title="No classes yet">Set up Class 11 or Class 12 for this academic year first.</Empty>
      ) : sheet.isLoading ? (
        <Loading />
      ) : sheet.error ? (
        <ErrorNote error={sheet.error} />
      ) : !s!.tests.length ? (
        <Empty title="No live tests for this class yet">Marks appear here once students submit a live test.</Empty>
      ) : (
        <>
          {podium.length > 0 && (
            <div className="res-podium">
              {podium.map((p, i) => (
                <div key={p.studentId} className={`res-top r${i + 1}`}>
                  <span className="res-medal">{i + 1}</span>
                  <span className="res-top-name">
                    <Link to={`/students/${p.studentId}`}>{p.studentName}</Link>
                    <span>
                      {s!.className}
                      {DOT}
                      {p.sectionName}
                    </span>
                  </span>
                  <span className="res-top-score">
                    <b>{fmt(p.total)}</b>
                    <span>of {fmt(p.outOf)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <section className="res-card">
            <div className="res-card-head">
              <h2>
                {s!.className}
                {DOT}
                {sectionName ? `Section ${sectionName}` : 'all sections'}
              </h2>
              <span>
                {s!.tests.length} test{s!.tests.length === 1 ? '' : 's'}
                {DOT}
                {s!.students.length} student{s!.students.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="res-table">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    {s!.tests.map((t) => (
                      <th key={t.id} className="num" title={`${t.title}${DOT}${t.subjectName}`}>
                        <Link to={`/tests/${t.id}/results`}>{t.title}</Link>
                        <small>/ {fmt(t.maxScore)}</small>
                      </th>
                    ))}
                    <th className="num">
                      Total
                      <small>/ {fmt(outOf)}</small>
                    </th>
                    <th className="res-pct-col">Percentage</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const d = change(s!, p);
                    return (
                      <tr key={p.studentId}>
                        <td>
                          <span className={`res-rank${p.rank !== null && p.rank <= 3 ? ` r${p.rank}` : ''}`}>{p.rank ?? DASH}</span>
                        </td>
                        <td>
                          <Link to={`/students/${p.studentId}`} className="res-name">
                            {p.studentName}
                          </Link>
                          <span className="res-code">{p.studentCode}</span>
                        </td>
                        {s!.tests.map((t) => (
                          <td key={t.id} className="num">
                            {p.marks[t.id] ?? <span className="muted">{DASH}</span>}
                          </td>
                        ))}
                        <td className="num strong">{p.testsTaken ? fmt(p.total) : DASH}</td>
                        <td>
                          <div className="res-pct">
                            <div className="res-meter">
                              <i
                                className={p.percent === null ? '' : p.percent >= 90 ? 'navy' : p.percent >= 60 ? 'gold' : 'orange'}
                                style={{ width: `${p.percent ?? 0}%` }}
                              />
                            </div>
                            <b>{p.percent === null ? DASH : `${p.percent}%`}</b>
                          </div>
                        </td>
                        <td className="num">
                          {d === null ? (
                            <span className="muted">{DASH}</span>
                          ) : (
                            <span className={`res-change ${d >= 0 ? 'up' : 'down'}`}>
                              {d >= 0 ? '+' : ''}
                              {d}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="res-note">
              {DASH} means the student did not take that test, or it is waiting for review. Rank is by percentage across the tests each student took. Change compares their last two tests.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
