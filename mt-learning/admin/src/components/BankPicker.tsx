import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BankExam, BankLiveQuestion, BankSubjectTree, Question } from '../api/types';
import { MathText } from './MathText';
import { ErrorNote, Field, Loading, Modal } from './ui';

const KEYS = 'ABCDEF';

/**
 * Choose live-test questions from GenPrep's question bank: exam → subject → chapter, tick
 * questions, add them. Questions are copied into the test, so later edits in GenPrep do
 * not change a test students have already taken.
 */
const key = (name: string) => {
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  return k === 'maths' || k === 'math' ? 'mathematics' : k;
};

export function BankPicker({
  open,
  onClose,
  onAdd,
  existing,
  examCode,
  subjects: allowed,
  subject: startSubject,
  level: startLevel,
  defaultMarks,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (qs: Question[]) => void;
  existing: Set<string>;
  /** Exam tests: only this exam's questions. */
  examCode?: string;
  /** Exam tests: only these subjects, shown as tabs. */
  subjects?: string[];
  /** Subject to open on. */
  subject?: string;
  level?: '11' | '12';
  defaultMarks?: number;
}) {
  const [examId, setExam] = useState('');
  const [subjectId, setSubject] = useState('');
  const [level, setLevel] = useState<'' | '11' | '12'>('');
  const [chapterId, setChapter] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<BankLiveQuestion[]>([]);
  const [picked, setPicked] = useState<Map<string, BankLiveQuestion>>(new Map());
  const [marks, setMarks] = useState(1);

  const status = useQuery({ queryKey: ['bank-status'], queryFn: () => api<{ source: 'genprep' | 'sample' }>('/question-bank/status'), enabled: open });
  const exams = useQuery({ queryKey: ['bank-exams'], queryFn: () => api<BankExam[]>('/question-bank/exams'), enabled: open });
  const syllabus = useQuery({
    queryKey: ['bank-syllabus', examId],
    queryFn: () => api<BankSubjectTree[]>(`/question-bank/syllabus?examId=${encodeURIComponent(examId)}`),
    enabled: open && !!examId,
  });
  const questions = useQuery({
    queryKey: ['bank-questions', chapterId, page],
    queryFn: () => api<{ total: number; page: number; pageSize: number; items: BankLiveQuestion[] }>(`/question-bank/questions?chapterId=${encodeURIComponent(chapterId)}&page=${page}`),
    enabled: open && !!chapterId,
  });

  useEffect(() => {
    if (!exams.data?.length) return;
    const wanted = examCode ? exams.data.find((e) => e.code === examCode) : undefined;
    if (wanted && examId !== wanted.id) setExam(wanted.id);
    else if (!examId) setExam(exams.data[0].id);
  }, [exams.data, examId, examCode]);
  // Each time it opens: start on the subject and class it was opened for.
  useEffect(() => {
    if (!open) return;
    setLevel(startLevel ?? '');
    setChapter('');
    setPage(1);
    setItems([]);
    if (defaultMarks) setMarks(defaultMarks);
  }, [open, startLevel, defaultMarks]);
  useEffect(() => {
    if (!open || !startSubject || !syllabus.data) return;
    const s = syllabus.data.find((x) => key(x.name) === key(startSubject));
    setSubject(s?.id ?? '');
  }, [open, startSubject, syllabus.data]);
  useEffect(() => {
    if (questions.data) setItems((prev) => (page === 1 ? questions.data!.items : [...prev, ...questions.data!.items.filter((q) => !prev.some((p) => p.bankQuestionId === q.bankQuestionId))]));
  }, [questions.data, page]);

  const subjectList = (syllabus.data ?? []).filter((s) => !allowed || allowed.some((a) => key(a) === key(s.name)));
  const subject = subjectList.find((s) => s.id === subjectId);
  const subjectName = subject ? (allowed?.find((a) => key(a) === key(subject.name)) ?? subject.name) : null;
  const levels = [...new Set((subject?.chapters ?? []).map((c) => c.classLevel))];
  const chaptersInClass = (subject?.chapters ?? []).filter((c) => c.classLevel === level).sort((a, b) => a.name.localeCompare(b.name));
  const exam = exams.data?.find((e) => e.id === examId);
  const pickChapter = (id: string) => {
    setChapter(id);
    setPage(1);
    setItems([]);
  };
  const toggle = (q: BankLiveQuestion) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(q.bankQuestionId)) n.delete(q.bankQuestionId);
      else n.set(q.bankQuestionId, q);
      return n;
    });
  const add = () => {
    onAdd([...picked.values()].map(({ text, options, correctIndex, explanation, bankQuestionId }) => ({ text, options, correctIndex, marks, topic: null, explanation, bankQuestionId, subject: subjectName })));
    setPicked(new Map());
    onClose();
  };
  const more = questions.data && items.length < questions.data.total;

  return (
    <Modal open={open} title={subjectName && allowed ? `Add ${subjectName} questions` : 'Add questions from the question bank'} onClose={onClose} wide>
      <div className="stack">
        {status.data?.source === 'sample' && (
          <p className="callout small">The full question bank is not connected yet, so these are sample questions.</p>
        )}
        {examCode && <p className="small muted">Only {examCode} questions are shown.</p>}
        <div className="bank-filters">
          {!examCode && (
            <Field label="Exam">
              <select
                id="bank-exam"
                value={examId}
                onChange={(e) => {
                  setExam(e.target.value);
                  setSubject('');
                  setLevel('');
                  pickChapter('');
                }}
              >
                {exams.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Subject">
            <select
              id="bank-subject"
              value={subjectId}
              onChange={(e) => {
                setSubject(e.target.value);
                pickChapter('');
              }}
            >
              <option value="">Choose a subject</option>
              {subjectList.map((s) => (
                <option key={s.id} value={s.id}>
                  {allowed?.find((a) => key(a) === key(s.name)) ?? s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Class">
            <select
              id="bank-class"
              value={level}
              disabled={!subject}
              onChange={(e) => {
                setLevel(e.target.value as '' | '11' | '12');
                pickChapter('');
              }}
            >
              <option value="">Choose a class</option>
              {levels.includes('11') && <option value="11">Class 11</option>}
              {levels.includes('12') && <option value="12">Class 12</option>}
            </select>
          </Field>
          <Field label="Chapter">
            <select id="bank-chapter" value={chapterId} disabled={!level} onChange={(e) => pickChapter(e.target.value)}>
              <option value="">Choose a chapter</option>
              {chaptersInClass.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorNote error={exams.error ?? syllabus.error ?? questions.error} />
        {!chapterId ? (
          <p className="muted">Pick a subject, class and chapter to see its questions.</p>
        ) : questions.isLoading && page === 1 ? (
          <Loading label="Loading questions…" />
        ) : items.length === 0 ? (
          <p className="muted">This chapter has no single-answer questions to add.</p>
        ) : (
          <div className="bank-list">
            {items.map((q) => {
              const already = existing.has(q.bankQuestionId);
              const on = picked.has(q.bankQuestionId);
              return (
                <label key={q.bankQuestionId} className={`bank-q${on ? ' on' : ''}${already ? ' added' : ''}`}>
                  <input type="checkbox" checked={on || already} disabled={already} onChange={() => toggle(q)} aria-label="Add this question" />
                  <span className="bank-q-body">
                    <MathText text={q.text} className="bank-q-text" />
                    <span className="bank-opts">
                      {q.options.map((o, i) => (
                        <span key={i} className={i === q.correctIndex ? 'right' : ''}>
                          <b>{KEYS[i]}.</b> <MathText text={o} />
                        </span>
                      ))}
                    </span>
                    <span className="tiny muted">
                      {q.difficulty[0].toUpperCase() + q.difficulty.slice(1)}
                      {already ? ' · already in this test' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
            {more && (
              <button type="button" className="btn btn-quiet" disabled={questions.isFetching} aria-busy={questions.isFetching} onClick={() => setPage((p) => p + 1)}>
                Show more ({questions.data!.total - items.length} left)
              </button>
            )}
          </div>
        )}

        <div className="bank-foot">
          <Field label="Marks for each question" hint={exam ? `${exam.code} usually gives ${exam.marking.correct}` : undefined}>
            <input id="bank-marks" type="number" min={0.25} max={20} step={0.25} value={marks} onChange={(e) => setMarks(Number(e.target.value) || 1)} style={{ maxWidth: 120 }} />
          </Field>
          <button type="button" className="btn btn-primary" disabled={picked.size === 0} onClick={add}>
            Add {picked.size || ''} question{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
