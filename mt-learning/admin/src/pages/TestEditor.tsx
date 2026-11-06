import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { isoToLocalInput, localInputToIso } from '../api/hooks';
import type { ExamCode, Question, TestAudience, TestDetail } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { BankPicker } from '../components/BankPicker';
import { ClassSubjectPicker } from '../components/ClassSubjectPicker';
import { Icon } from '../components/icons';
import { MathText } from '../components/MathText';
import { ErrorNote, Field, Loading, PageHead, Toggle, useConfirm, useToast } from '../components/ui';
import { STATE_PILL } from './Tests';

const KEYS = 'ABCDEF';
const blankQuestion = (subject: string | null = null, marks = 1): Question => ({ text: '', options: ['', '', '', ''], correctIndex: 0, marks, topic: null, explanation: null, subject });

/** What choosing an exam sets up: subjects, usual counts per subject, marking and time. */
export const EXAMS: Record<ExamCode, { subjects: string[]; usual: number[]; marks: number; negative: number; minutes: number; marking: string }> = {
  NEET: { subjects: ['Physics', 'Chemistry', 'Biology'], usual: [45, 45, 90], marks: 4, negative: 1, minutes: 180, marking: '+4 right, −1 wrong' },
  JEE: { subjects: ['Physics', 'Chemistry', 'Mathematics'], usual: [25, 25, 25], marks: 4, negative: 1, minutes: 180, marking: '+4 right, −1 wrong' },
  KCET: { subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'], usual: [60, 60, 60, 60], marks: 1, negative: 0, minutes: 240, marking: '+1 right, no negative marks' },
};
export const AUDIENCES: [TestAudience, string][] = [
  ['PUC_1', 'Class 11 (1st PUC)'],
  ['PUC_2', 'Class 12 (2nd PUC)'],
  ['BOTH', 'Both Class 11 and 12'],
];

function defaultWindow() {
  const open = new Date();
  open.setDate(open.getDate() + 1);
  open.setHours(9, 0, 0, 0);
  const close = new Date(open);
  close.setHours(21, 0, 0, 0);
  return { opensAt: isoToLocalInput(open.toISOString()), closesAt: isoToLocalInput(close.toISOString()) };
}

export function TestEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = useQuery({ queryKey: ['test', id], queryFn: () => api<TestDetail>(`/tests/${id}`), enabled: !isNew });

  const [pair, setPair] = useState({ classId: '', subjectId: '' });
  const [audience, setAudience] = useState<TestAudience | ''>('');
  const [examCode, setExamCode] = useState<ExamCode | ''>('');
  const [bankSubject, setBankSubject] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [durationMin, setDuration] = useState(30);
  const [win, setWin] = useState(defaultWindow);
  const [allowOffline, setOffline] = useState(false);
  const [negativeMarks, setNegative] = useState(0);
  const [instantResults, setInstant] = useState(true);
  // Questions from the bank show as students see them; their raw text opens only on request.
  const [rawEdit, setRawEdit] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<Question[]>(isNew ? [] : [blankQuestion()]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);

  useEffect(() => {
    const t = existing.data;
    if (!t) return;
    setPair({ classId: t.classId ?? '', subjectId: t.subjectId ?? '' });
    setAudience(t.audience ?? '');
    setExamCode(t.examCode ?? '');
    setTitle(t.title);
    setInstructions(t.instructions ?? '');
    setDuration(t.durationMin);
    setWin({ opensAt: isoToLocalInput(t.opensAt), closesAt: isoToLocalInput(t.closesAt) });
    setOffline(t.allowOffline);
    setNegative(t.negativeMarks);
    setInstant(t.instantResults);
    setQuestions(
      t.questions.length
        ? t.questions.map(({ text, options, correctIndex, marks, topic, explanation, bankQuestionId, subject }) => ({ text, options, correctIndex, marks, topic, explanation, bankQuestionId, subject }))
        : t.audience
          ? []
          : [blankQuestion()],
    );
  }, [existing.data]);

  if (!isNew && existing.isLoading) return <Loading />;
  if (!isNew && existing.error) return <ErrorNote error={existing.error} />;
  const t = existing.data;
  const locked = (t?.attemptCount ?? 0) > 0;
  const editable = can(P.TestsWrite);
  const totalMarks = questions.reduce((a, q) => a + (q.marks || 0), 0);
  // Older tests were for one class and one subject; everything new is an exam test.
  const legacy = !isNew && !!t?.classId && !t?.audience;
  const ex = examCode ? EXAMS[examCode] : null;
  const groups: { name: string | null; usual?: number }[] = ex
    ? [...ex.subjects.map((name, k) => ({ name, usual: ex.usual[k] })), ...(questions.some((q) => !q.subject || !ex.subjects.includes(q.subject)) ? [{ name: null }] : [])]
    : [{ name: null }];
  const inGroup = (q: Question, g: { name: string | null }) => (g.name ? q.subject === g.name : !ex || !q.subject || !ex.subjects.includes(q.subject));
  // Display (and save) order: subject by subject.
  const order = groups.flatMap((g) => questions.map((q, i) => (inGroup(q, g) ? i : -1)).filter((i) => i >= 0));

  const chooseExam = (code: ExamCode) => {
    setExamCode(code);
    setDuration(EXAMS[code].minutes);
    setNegative(EXAMS[code].negative);
    if (!title.trim() || /weekly test$/.test(title)) setTitle(`${audience ? AUDIENCES.find((a) => a[0] === audience)![1].split(' (')[0] + ' · ' : ''}${code} weekly test`);
  };

  const update = (i: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  /** Move a question up or down within its subject. */
  const move = (i: number, d: -1 | 1) =>
    setQuestions((qs) => {
      const pos = order.indexOf(i);
      const j = order[pos + d];
      if (j === undefined) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function validate(): string | null {
    if (!title.trim()) return 'Give the test a title.';
    if (legacy ? !pair.classId || !pair.subjectId : !audience || !examCode) return 'Choose the class and the exam.';
    for (const [i, q] of questions.entries()) {
      if (!q.text.trim()) return `Question ${i + 1} has no text.`;
      const opts = q.options.map((o) => o.trim());
      if (opts.some((o) => !o)) return `Question ${i + 1} has an empty option. Remove it or fill it in.`;
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return `Question ${i + 1} has two identical options.`;
    }
    return null;
  }

  async function save(andPublish = false) {
    setError(null);
    const problem = validate();
    if (problem) return setError(new Error(problem));
    setBusy(true);
    const cleanQs = order
      .map((i) => questions[i])
      .map((q) => ({ ...q, text: q.text.trim(), options: q.options.map((o) => o.trim()), topic: q.topic?.trim() || null, explanation: q.explanation?.trim() || null, subject: q.subject || null }));
    try {
      let testId = id;
      if (isNew) {
        const created = await api<TestDetail>('/tests', {
          method: 'POST',
          body: {
            audience,
            examCode,
            title,
            instructions: instructions || null,
            durationMin,
            opensAt: localInputToIso(win.opensAt),
            closesAt: localInputToIso(win.closesAt),
            allowOffline,
            negativeMarks,
            instantResults,
            questions: cleanQs,
          },
        });
        testId = created.id;
      } else if (locked) {
        await api(`/tests/${id}`, { method: 'PATCH', body: { title, instructions: instructions || null, closesAt: localInputToIso(win.closesAt) } });
      } else {
        await api(`/tests/${id}`, {
          method: 'PATCH',
          body: { title, instructions: instructions || null, durationMin, opensAt: localInputToIso(win.opensAt), closesAt: localInputToIso(win.closesAt), allowOffline, negativeMarks, instantResults },
        });
        await api(`/tests/${id}/questions`, { method: 'PUT', body: { questions: cleanQs } });
      }
      if (andPublish) await api(`/tests/${testId}/publish`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['tests'] });
      void qc.invalidateQueries({ queryKey: ['test', testId] });
      toast(andPublish ? 'Test published. Students see it under Tests.' : 'Test saved');
      if (isNew) nav(`/tests/${testId}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function simple(path: string, method: string, msg: string, after?: () => void) {
    setError(null);
    try {
      await api(path, { method });
      void qc.invalidateQueries({ queryKey: ['tests'] });
      void qc.invalidateQueries({ queryKey: ['test', id] });
      toast(msg);
      after?.();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <p className="crumb">
        <Link to="/tests">Live tests</Link>
      </p>
      <PageHead
        title={isNew ? 'Create live test' : t!.title}
        sub={
          t && (
            <>
              <span className={`pill ${STATE_PILL[t.state][1]}`}>{STATE_PILL[t.state][0]}</span>
              {t.className} · {t.subjectName}
              {t.attemptCount > 0 && ` · ${t.attemptCount} student${t.attemptCount === 1 ? '' : 's'} started`}
            </>
          )
        }
        actions={
          <>
            {t && t.state !== 'draft' && (
              <Link className={`btn ${t.state === 'open' ? 'btn-primary' : 'btn-quiet'}`} to={`/tests/${id}/monitor`}>
                {t.state === 'open' && <span className="live-dot" aria-hidden />} Live monitor
              </Link>
            )}
            {t && t.state !== 'draft' && can(P.TestsReview) && (
              <Link className="btn btn-quiet" to={`/tests/${id}/results`}>
                <Icon name="chart" /> Results
              </Link>
            )}
            {t && editable && t.publishedAt && !locked && (
              <button className="btn btn-quiet" onClick={() => void simple(`/tests/${id}/unpublish`, 'POST', 'Test withdrawn')}>
                Withdraw
              </button>
            )}
            {t && editable && !locked && (
              <button
                className="btn btn-quiet danger-text"
                onClick={async () => {
                  if (await confirm('Delete this test?', 'The test and its questions are deleted.', 'Delete test', true)) await simple(`/tests/${id}`, 'DELETE', 'Test deleted', () => nav('/tests'));
                }}
              >
                Delete
              </button>
            )}
          </>
        }
      />
      {locked && <p className="callout">Students have started this test, so its questions and timing are locked. You can still change the title, instructions and extend the closing time.</p>}

      {legacy ? null : (
        <section className="panel exam-setup">
          <div className="exam-step">
            <h2 className="panel-title">1. Who is writing this test?</h2>
            <div className="choice-row" role="radiogroup" aria-label="Who is writing this test">
              {AUDIENCES.map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={audience === v} className="choice" disabled={!isNew} onClick={() => setAudience(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="exam-step">
            <h2 className="panel-title">2. Which exam is it for?</h2>
            <div className="exam-cards" role="radiogroup" aria-label="Exam">
              {(Object.keys(EXAMS) as ExamCode[]).map((code) => (
                <button key={code} type="button" role="radio" aria-checked={examCode === code} className="exam-card" disabled={!isNew} onClick={() => chooseExam(code)}>
                  <b>{code}</b>
                  <span>{EXAMS[code].subjects.join(', ')}</span>
                  <small>{EXAMS[code].marking}</small>
                </button>
              ))}
            </div>
          </div>
          {ex && (
            <p className="exam-subjects">
              <b>Subjects in this test:</b>
              {ex.subjects.map((x) => (
                <span key={x} className="chip-plain">
                  {x}
                </span>
              ))}
              <span className="muted small">chosen automatically from the exam</span>
            </p>
          )}
          {!isNew && <p className="small muted">The class and exam can’t be changed after the test is created.</p>}
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">{legacy ? 'Details' : '3. Details'}</h2>
        <div className="grid-form">
          {legacy && <ClassSubjectPicker idPrefix="test" classId={pair.classId} subjectId={pair.subjectId} onChange={setPair} disabled />}
          <div className="span-2">
            <Field label="Title">
              <input id="test-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Class 12 · NEET weekly test" disabled={!editable} />
            </Field>
            <Field label="Instructions (optional)">
              <textarea id="test-instructions" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={!editable} />
            </Field>
          </div>
          <Field label="Opens">
            <input id="test-opens" type="datetime-local" value={win.opensAt} onChange={(e) => setWin({ ...win, opensAt: e.target.value })} disabled={locked || !editable} />
          </Field>
          <Field label="Closes" hint={locked ? 'Can only be extended now' : undefined}>
            <input id="test-closes" type="datetime-local" value={win.closesAt} onChange={(e) => setWin({ ...win, closesAt: e.target.value })} disabled={!editable} />
          </Field>
          <Field label="Time limit (minutes)">
            <input id="test-duration" type="number" min={1} max={300} value={durationMin} onChange={(e) => setDuration(Number(e.target.value))} disabled={locked || !editable} />
          </Field>
          <Field label="Negative marking" hint={ex ? `${examCode} usually: ${ex.marking}` : undefined}>
            <select id="test-negative" value={negativeMarks} onChange={(e) => setNegative(Number(e.target.value))} disabled={locked || !editable}>
              <option value={0}>None</option>
              <option value={0.25}>−0.25 per wrong answer</option>
              <option value={0.5}>−0.5 per wrong answer</option>
              <option value={1}>−1 per wrong answer</option>
            </select>
          </Field>
          <div className="span-2">
            <div className="toggle-row">
              <span>
                <b>Allow offline</b>
                <br />
                <span className="small muted">Students can download the paper and answer without Wi-Fi. Answers upload when the tablet reconnects; uploads after closing go to you for review.</span>
              </span>
              <Toggle checked={allowOffline} onChange={setOffline} label="Allow offline" disabled={locked || !editable} />
            </div>
            <div className="toggle-row">
              <span>
                <b>Show score straight after submitting</b>
                <br />
                <span className="small muted">Correct answers are only shown once the test closes, so they can’t be passed on.</span>
              </span>
              <Toggle checked={instantResults} onChange={setInstant} label="Show score straight away" disabled={locked || !editable} />
            </div>
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="panel-head">
          <h2 className="panel-title">
            {legacy ? 'Questions' : '4. Questions'} <span className="muted small">· {questions.length} questions, {totalMarks} marks</span>
          </h2>
        </div>
        {!legacy && !ex && <p className="muted">Choose the class and exam above, then add questions subject by subject.</p>}
        {(legacy || ex) &&
          groups.map((g) => {
            const count = questions.filter((q) => inGroup(q, g)).length;
            return (
              <div key={g.name ?? 'other'} className="subject-group">
                {ex && (
                  <div className="subject-head">
                    <div>
                      <b>{g.name ?? 'Other questions'}</b>
                      <span className="small muted">
                        {count} added{g.usual ? ` · ${examCode} usually has ${g.usual}` : ''}
                      </span>
                    </div>
                    {g.usual ? (
                      <div className="subject-bar" aria-hidden>
                        <div style={{ width: `${Math.min(100, Math.round((count / g.usual) * 100))}%` }} />
                      </div>
                    ) : null}
                    {g.name && !locked && editable && (
                      <span className="btn-row">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setBankSubject(g.name)}>
                          Add {g.name} questions
                        </button>
                        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setQuestions((qs) => [...qs, blankQuestion(g.name, ex.marks)])}>
                          Type one
                        </button>
                      </span>
                    )}
                  </div>
                )}
        {questions.map((q, i) => !inGroup(q, g) ? null : (
          <fieldset key={i} className="qcard" disabled={locked || !editable} style={{ margin: 0 }}>
            <div className="qcard-head">
              <b>
                Question {order.indexOf(i) + 1}
                {q.bankQuestionId && <span className="pill pill-board" style={{ marginLeft: 8 }}>From question bank</span>}
              </b>
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="icon-btn" aria-label="Move up" disabled={!inGroup(questions[order[order.indexOf(i) - 1]] ?? ({} as Question), g)} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={!inGroup(questions[order[order.indexOf(i) + 1]] ?? ({} as Question), g)} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete question ${i + 1}`} disabled={legacy && questions.length === 1} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              </span>
            </div>
            {q.bankQuestionId && !rawEdit.has(q.bankQuestionId) ? (
              <div className="bank-view">
                <MathText text={q.text} className="bank-view-q" />
                <ol className="bank-view-opts">
                  {q.options.map((o, j) => (
                    <li key={j} className={q.correctIndex === j ? 'right' : undefined}>
                      <span className="opt-key">{KEYS[j]}</span>
                      <MathText text={o} />
                      {q.correctIndex === j && <span className="pill pill-ok">Correct answer</span>}
                    </li>
                  ))}
                </ol>
                {q.explanation && (
                  <details className="bank-view-sol">
                    <summary>Solution (shown to students after the test closes)</summary>
                    <MathText text={q.explanation} />
                  </details>
                )}
                {!locked && editable && (
                  <button type="button" className="link-btn justify-start small" onClick={() => setRawEdit((s) => new Set(s).add(q.bankQuestionId!))}>
                    Edit question
                  </button>
                )}
              </div>
            ) : (
              <>
              <textarea id={`q${i}-text`} rows={2} aria-label={`Question ${i + 1} text`} value={q.text} onChange={(e) => update(i, { text: e.target.value })} placeholder="Type the question" />
              {/[$]|\{\{IMG::/.test(q.text) && (
                <div className="q-preview">
                  <span className="tiny muted">How students see it</span>
                  <MathText text={q.text} />
                </div>
              )}
              <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label={`Correct answer for question ${i + 1}`}>
                {q.options.map((o, j) => (
                  <div key={j} className="opt-row">
                    <input type="radio" name={`q${i}-correct`} checked={q.correctIndex === j} onChange={() => update(i, { correctIndex: j })} aria-label={`Option ${KEYS[j]} is correct`} />
                    <span className="opt-key">{KEYS[j]}</span>
                    <input
                      id={`q${i}-opt${j}`}
                      aria-label={`Option ${KEYS[j]}`}
                      value={o}
                      onChange={(e) => update(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })}
                      placeholder={`Option ${KEYS[j]}`}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove option ${KEYS[j]}`}
                      disabled={q.options.length <= 2}
                      onClick={() =>
                        update(i, {
                          options: q.options.filter((_, k) => k !== j),
                          correctIndex: q.correctIndex === j ? 0 : q.correctIndex > j ? q.correctIndex - 1 : q.correctIndex,
                        })
                      }
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
                {q.options.length < 6 && (
                  <button type="button" className="link-btn justify-start small" onClick={() => update(i, { options: [...q.options, ''] })}>
                    Add option
                  </button>
                )}
                <span className="tiny muted">Tick the correct answer.</span>
              </div>
              </>
            )}
            <div className="grid-3">
              <Field label="Marks">
                <input id={`q${i}-marks`} type="number" min={0.25} max={20} step={0.25} value={q.marks} onChange={(e) => update(i, { marks: Number(e.target.value) })} />
              </Field>
              <Field label="Topic" hint="Used for “topics to revise”">
                <input id={`q${i}-topic`} value={q.topic ?? ''} onChange={(e) => update(i, { topic: e.target.value })} placeholder="Optional, e.g. Ohm’s law" />
              </Field>
              {(!q.bankQuestionId || rawEdit.has(q.bankQuestionId)) && (
                <Field label="Explanation" hint="Shown after the test closes">
                  <input id={`q${i}-expl`} value={q.explanation ?? ''} onChange={(e) => update(i, { explanation: e.target.value })} />
                </Field>
              )}
            </div>
          </fieldset>
        ))}
              </div>
            );
          })}
        {legacy && !locked && editable && (
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => setBankOpen(true)}>
              <Icon name="book" /> Add from question bank
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
              <Icon name="plus" /> Type a question
            </button>
          </div>
        )}
        <BankPicker
          open={bankOpen || !!bankSubject}
          onClose={() => {
            setBankOpen(false);
            setBankSubject(null);
          }}
          examCode={examCode || undefined}
          subjects={ex?.subjects}
          subject={bankSubject ?? undefined}
          level={audience === 'PUC_1' ? '11' : '12'}
          defaultMarks={ex?.marks}
          existing={new Set(questions.map((q) => q.bankQuestionId).filter((x): x is string => !!x))}
          onAdd={(added) => setQuestions((qs) => [...qs.filter((q) => q.text.trim() || q.options.some((o) => o.trim())), ...added])}
        />
      </section>

      <ErrorNote error={error} />
      {editable && (
        <div className="form-actions left">
          <button className="btn btn-quiet" disabled={busy} onClick={() => void save(false)}>
            {busy ? 'Saving…' : isNew ? 'Save as draft' : 'Save changes'}
          </button>
          {(isNew || !t?.publishedAt) && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>
              Save and publish
            </button>
          )}
        </div>
      )}
      {dialog}
    </>
  );
}
