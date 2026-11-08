import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { isoToLocalInput, localInputToIso } from "../api/hooks";
import type {
  BankExam,
  BankLiveQuestion,
  BankSubjectTree,
  ExamCode,
  Question,
  TestAudience,
  TestDetail,
} from "../api/types";
import { P, useAuth } from "../auth/AuthContext";
import { BankPicker } from "../components/BankPicker";
import { MathText } from "../components/MathText";
import {
  ErrorNote,
  Loading,
  Toggle,
  useConfirm,
  useToast,
} from "../components/ui";
import { TestEditorPage } from "./TestEditor";
import { STATE_PILL } from "./Tests";
import "./TestBuilder.css";

/**
 * Create a live test in a few simple steps: exam, class, syllabus (all chapters or chosen
 * chapters and topics), how many questions per subject. The paper is then built from the
 * question bank and can be checked, swapped or trimmed before publishing.
 */

const DOT = " \u00b7 ";
const DASH = "\u2014";
const MINUS = "\u2212";
const KEYS = "ABCDEF";
const MAX_QUESTIONS = 400;
type Stream = "PCM" | "PCB" | "PCMB";
/** KCET streams: which subjects each one writes. */
const STREAMS: [Stream, string[]][] = [
  ["PCM", ["Physics", "Chemistry", "Mathematics"]],
  ["PCB", ["Physics", "Chemistry", "Biology"]],
  ["PCMB", ["Physics", "Chemistry", "Mathematics", "Biology"]],
];
const streamOf = (qs: Question[]): Stream => {
  const m = qs.some((q) => q.subject === "Mathematics");
  const b = qs.some((q) => q.subject === "Biology");
  return m && !b ? "PCM" : b && !m ? "PCB" : "PCMB";
};
const MAX_MINUTES = 400;
/** Time limit for a paper: the exam's pace times the number of questions. */
const minutesFor = (p: Paper, total: number) =>
  Math.max(1, Math.min(MAX_MINUTES, Math.round(total * p.perQuestion)));

type Level = "11" | "12";
type Paper = {
  subjects: string[];
  counts: number[];
  marks: number;
  negative: number;
  perQuestion: number;
  timing: string;
  marking: string;
  blurb: string;
};

export const PAPERS: Record<ExamCode, Paper> = {
  NEET: {
    subjects: ["Physics", "Chemistry", "Biology"],
    counts: [45, 45, 90],
    marks: 4,
    negative: 1,
    perQuestion: 1,
    timing: "1 minute per question",
    marking: `+4 right, ${MINUS}1 wrong`,
    blurb: "Physics, Chemistry, Biology",
  },
  JEE: {
    subjects: ["Physics", "Chemistry", "Mathematics"],
    counts: [25, 25, 25],
    marks: 4,
    negative: 1,
    perQuestion: 2.4,
    timing: "180 minutes for 75 questions",
    marking: `+4 right, ${MINUS}1 wrong`,
    blurb: "Physics, Chemistry, Mathematics",
  },
  KCET: {
    subjects: ["Physics", "Chemistry", "Mathematics", "Biology"],
    counts: [60, 60, 60, 60],
    marks: 1,
    negative: 0,
    perQuestion: 80 / 60,
    timing: "80 minutes per 60 questions",
    marking: "+1 right, no negative marks",
    blurb: "Physics, Chemistry, Maths, Biology",
  },
};

const CLASSES: [TestAudience, string, string][] = [
  ["PUC_1", "Class 11", "1st PUC chapters"],
  ["PUC_2", "Class 12", "2nd PUC chapters"],
  ["BOTH", "Class 11 + 12", "Chapters of both years"],
];

const levelOf = (a: TestAudience | ""): Level | undefined =>
  a === "PUC_1" ? "11" : a === "PUC_2" ? "12" : undefined;
const subjectKey = (name: string) => {
  const k = name.toLowerCase().replace(/[^a-z]/g, "");
  return k === "maths" || k === "math" ? "mathematics" : k;
};
const blank = (subject: string, marks: number): Question => ({
  text: "",
  options: ["", "", "", ""],
  correctIndex: 0,
  marks,
  topic: null,
  explanation: null,
  subject,
});
const fromBank = (
  q: BankLiveQuestion,
  subject: string,
  marks: number,
): Question => ({
  text: q.text,
  options: q.options,
  correctIndex: q.correctIndex,
  marks,
  topic: q.topic,
  explanation: q.explanation,
  bankQuestionId: q.bankQuestionId,
  subject,
});

function defaultWindow() {
  const open = new Date();
  open.setDate(open.getDate() + 1);
  open.setHours(9, 0, 0, 0);
  const close = new Date(open);
  close.setHours(21, 0, 0, 0);
  return {
    opensAt: isoToLocalInput(open.toISOString()),
    closesAt: isoToLocalInput(close.toISOString()),
  };
}

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Old one-class, one-subject tests keep the previous editor. */
export function TestBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const existing = useQuery({
    queryKey: ["test", id],
    queryFn: () => api<TestDetail>(`/tests/${id}`),
    enabled: !isNew,
  });
  if (!isNew && existing.isLoading) return <Loading />;
  if (!isNew && existing.error) return <ErrorNote error={existing.error} />;
  const t = existing.data;
  if (t && t.classId && !t.audience) return <TestEditorPage />;
  return <Builder key={id ?? "new"} test={t} />;
}

/** One chapter with its topics (loaded when opened). No topic ticked means the whole chapter. */
function ChapterRow({
  chapter,
  on,
  topics,
  onToggle,
  onTopics,
}: {
  chapter: BankSubjectTree["chapters"][number];
  on: boolean;
  topics: Set<string>;
  onToggle: () => void;
  onTopics: (t: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ["bank-topics", chapter.id],
    queryFn: () =>
      api<{ id: string; name: string; questionCount: number }[]>(
        `/question-bank/chapters/${encodeURIComponent(chapter.id)}/topics`,
      ),
    enabled: open,
    staleTime: 10 * 60_000,
  });
  return (
    <li className={`tb-ch${on ? " on" : ""}`}>
      <div className="tb-ch-row">
        <button
          type="button"
          className="tb-tick"
          role="checkbox"
          aria-checked={on}
          onClick={onToggle}
        >
          <span className="tb-box">{on && <Check />}</span>
          <span className="tb-ch-name">{chapter.name}</span>
        </button>
        <button
          type="button"
          className="tb-topics-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {topics.size
            ? `${topics.size} topic${topics.size === 1 ? "" : "s"}`
            : "Topics"}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </button>
      </div>
      {open && (
        <div className="tb-topics">
          {list.isLoading ? (
            <span className="tb-muted">Loading topics...</span>
          ) : !list.data?.length ? (
            <span className="tb-muted">No topics listed for this chapter.</span>
          ) : (
            <>
              <span className="tb-muted">
                {topics.size
                  ? "Only the ticked topics are used."
                  : "All topics are used. Tick some to use only those."}
              </span>
              <div className="tb-topic-list">
                {list.data.map((tp) => {
                  const ticked = topics.has(tp.id);
                  return (
                    <button
                      key={tp.id}
                      type="button"
                      role="checkbox"
                      aria-checked={ticked}
                      className={`tb-topic${ticked ? " on" : ""}`}
                      onClick={() => {
                        const next = new Set(topics);
                        if (ticked) next.delete(tp.id);
                        else next.add(tp.id);
                        onTopics(next);
                        if (!on && next.size) onToggle();
                      }}
                    >
                      {tp.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Builder({ test: t }: { test?: TestDetail }) {
  const isNew = !t;
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [examCode, setExamCode] = useState<ExamCode | "">(t?.examCode ?? "");
  const [audience, setAudience] = useState<TestAudience | "">(
    t?.audience ?? "",
  );
  const [scope, setScope] = useState<"full" | "chapters">("full");
  const [chapters, setChapters] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<Map<string, Set<string>>>(new Map());
  const [tab, setTab] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [title, setTitle] = useState(t?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!t);
  const [instructions, setInstructions] = useState(t?.instructions ?? "");
  const [durationMin, setDuration] = useState(t?.durationMin ?? 60);
  const [timeTouched, setTimeTouched] = useState(!!t);
  const [stream, setStream] = useState<Stream>(() =>
    t ? streamOf(t.questions) : "PCMB",
  );
  const [closesTouched, setClosesTouched] = useState(!!t);
  const [win, setWin] = useState(
    t
      ? {
          opensAt: isoToLocalInput(t.opensAt),
          closesAt: isoToLocalInput(t.closesAt),
        }
      : defaultWindow(),
  );
  const [negativeMarks, setNegative] = useState(t?.negativeMarks ?? 0);
  const [allowOffline, setOffline] = useState(t?.allowOffline ?? false);
  const [instantResults, setInstant] = useState(t?.instantResults ?? true);
  const [questions, setQuestions] = useState<Question[]>(
    t
      ? t.questions.map(
          ({
            text,
            options,
            correctIndex,
            marks,
            topic,
            explanation,
            bankQuestionId,
            subject,
          }) => ({
            text,
            options,
            correctIndex,
            marks,
            topic,
            explanation,
            bankQuestionId,
            subject,
          }),
        )
      : [],
  );
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [editQ, setEditQ] = useState<number | null>(null);
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const paper = examCode ? PAPERS[examCode] : null;
  const level = levelOf(audience);
  const locked = (t?.attemptCount ?? 0) > 0;
  const editable = can(P.TestsWrite) && !locked;
  const canEdit = can(P.TestsWrite);

  const exams = useQuery({
    queryKey: ["bank-exams"],
    queryFn: () => api<BankExam[]>("/question-bank/exams"),
    enabled: editable,
  });
  const exam = exams.data?.find((e) => e.code === examCode);
  const syllabus = useQuery({
    queryKey: ["bank-syllabus", exam?.id],
    queryFn: () =>
      api<BankSubjectTree[]>(
        `/question-bank/syllabus?examId=${encodeURIComponent(exam!.id)}`,
      ),
    enabled: editable && !!exam,
  });
  const treeOf = (name: string) =>
    syllabus.data?.find((s) => subjectKey(s.name) === subjectKey(name));
  const chaptersOf = (name: string) =>
    (treeOf(name)?.chapters ?? []).filter(
      (c) => !level || c.classLevel === level,
    );

  // Counts start from the exam's usual paper.
  useEffect(() => {
    if (!paper) return;
    setCounts((c) =>
      Object.fromEntries(
        paper.subjects.map((s, k) => [
          s,
          c[s] ??
            (t
              ? questions.filter((q) => q.subject === s).length ||
                paper.counts[k]
              : paper.counts[k]),
        ]),
      ),
    );
    if (!paper.subjects.includes(tab)) setTab(paper.subjects[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examCode]);

  // A suggested title until the teacher types their own.
  useEffect(() => {
    if (titleTouched || !examCode) return;
    const cls = CLASSES.find((c) => c[0] === audience)?.[1];
    setTitle(
      [
        cls,
        examCode === "KCET" ? `KCET ${stream}` : examCode,
        scope === "full" ? "Full syllabus test" : "Chapter test",
      ]
        .filter(Boolean)
        .join(DOT),
    );
  }, [examCode, audience, scope, stream, titleTouched]);

  const chooseExam = (code: ExamCode) => {
    if (!isNew || code === examCode) return;
    setExamCode(code);
    setNegative(PAPERS[code].negative);
    setTimeTouched(false);
    setCounts(
      Object.fromEntries(
        PAPERS[code].subjects.map((s, k) => [s, PAPERS[code].counts[k]]),
      ),
    );
    setChapters(new Set());
    setTopics(new Map());
    setTab(PAPERS[code].subjects[0]);
  };

  const toggleChapter = (cid: string) =>
    setChapters((s) => {
      const next = new Set(s);
      if (next.has(cid)) {
        next.delete(cid);
        setTopics((m) => {
          const n = new Map(m);
          n.delete(cid);
          return n;
        });
      } else next.add(cid);
      return next;
    });

  const subjects = !paper
    ? []
    : examCode === "KCET"
      ? paper.subjects.filter((s) =>
          STREAMS.find((x) => x[0] === stream)![1].includes(s),
        )
      : paper.subjects;

  const chooseStream = (v: Stream) => {
    if (v === stream) return;
    const keep = STREAMS.find((x) => x[0] === v)![1];
    setStream(v);
    setTimeTouched(false);
    setQuestions((qs) =>
      qs.filter((q) => !q.subject || keep.includes(q.subject)),
    );
    if (!keep.includes(tab)) setTab(keep[0]);
  };
  const inSubject = (s: string) =>
    questions.map((q, i) => (q.subject === s ? i : -1)).filter((i) => i >= 0);
  const others = questions
    .map((q, i) => (!q.subject || !subjects.includes(q.subject) ? i : -1))
    .filter((i) => i >= 0);
  const plannedTotal = subjects.reduce((a, s) => a + (counts[s] || 0), 0);

  // Time follows the number of questions (NEET: 1 minute each) until the teacher types their own.
  useEffect(() => {
    if (paper && !timeTouched && plannedTotal > 0)
      setDuration(minutesFor(paper, plannedTotal));
  }, [paper, plannedTotal, timeTouched]);

  // Closing time = opening time + time limit, until the teacher picks their own.
  useEffect(() => {
    if (closesTouched || !win.opensAt) return;
    const open = new Date(localInputToIso(win.opensAt));
    if (Number.isNaN(open.getTime())) return;
    const closesAt = isoToLocalInput(
      new Date(open.getTime() + durationMin * 60_000).toISOString(),
    );
    if (closesAt !== win.closesAt) setWin((w) => ({ ...w, closesAt }));
  }, [win.opensAt, win.closesAt, durationMin, closesTouched]);
  const totalMarks = questions.reduce((a, q) => a + (q.marks || 0), 0);
  const pickedIn = (s: string) =>
    chaptersOf(s).filter((c) => chapters.has(c.id)).length;

  /** What to send for one subject when picking questions. */
  function request(s: string, count: number, exclude: string[]) {
    const tree = treeOf(s);
    if (!exam || !tree)
      throw new Error(
        `The question bank has no ${s} questions for ${examCode}.`,
      );
    const ids =
      scope === "chapters"
        ? chaptersOf(s)
            .filter((c) => chapters.has(c.id))
            .map((c) => c.id)
        : [];
    if (scope === "chapters" && !ids.length)
      throw new Error(
        `Tick at least one ${s} chapter, or set ${s} to 0 questions.`,
      );
    const topicIds = ids.flatMap((cid) => [...(topics.get(cid) ?? [])]);
    return {
      examId: exam.id,
      subjectId: tree.id,
      chapterIds: ids.length ? ids : undefined,
      topicIds: topicIds.length ? topicIds : undefined,
      classLevel: level,
      count,
      exclude,
    };
  }

  async function build() {
    setError(null);
    setNotes([]);
    if (!examCode || !audience)
      return setError(new Error("Choose the exam and the class first."));
    if (!plannedTotal)
      return setError(
        new Error("Set how many questions each subject should have."),
      );
    if (plannedTotal > MAX_QUESTIONS)
      return setError(
        new Error(
          `A test can have at most ${MAX_QUESTIONS} questions. You asked for ${plannedTotal}.`,
        ),
      );
    if (
      questions.length &&
      !(await confirm(
        "Build a new question paper?",
        "The questions already in this test are replaced with new ones from the question bank.",
        "Build new paper",
      ))
    )
      return;
    setBuilding(true);
    try {
      const wanted = subjects.filter((s) => (counts[s] || 0) > 0);
      const bodies = wanted.map((s) => request(s, counts[s], []));
      const results = await Promise.all(
        bodies.map((b) =>
          api<{ items: BankLiveQuestion[] }>("/question-bank/pick", {
            method: "POST",
            body: b,
          }),
        ),
      );
      const next: Question[] = [];
      const short: string[] = [];
      results.forEach((r, k) => {
        const s = wanted[k];
        next.push(...r.items.map((q) => fromBank(q, s, paper!.marks)));
        if (r.items.length < counts[s])
          short.push(
            `Only ${r.items.length} ${s} questions were found for these chapters (you asked for ${counts[s]}).`,
          );
      });
      setQuestions(next);
      setNotes(short);
      setOpenQ(null);
      setEditQ(null);
      toast(`Question paper ready: ${next.length} questions`);
      setTimeout(
        () =>
          document
            .getElementById("tb-paper")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBuilding(false);
    }
  }

  async function swap(i: number) {
    const q = questions[i];
    if (!q.subject) return;
    setError(null);
    try {
      const used = questions
        .map((x) => x.bankQuestionId)
        .filter((x): x is string => !!x);
      const r = await api<{ items: BankLiveQuestion[] }>(
        "/question-bank/pick",
        { method: "POST", body: request(q.subject, 1, used) },
      );
      if (!r.items.length)
        return toast("No other question is left for these chapters");
      setQuestions((qs) =>
        qs.map((x, j) =>
          j === i ? fromBank(r.items[0], q.subject!, x.marks) : x,
        ),
      );
      toast("Question swapped");
    } catch (e) {
      setError(e);
    }
  }

  const update = (i: number, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const remove = (i: number) => {
    setQuestions((qs) => qs.filter((_, j) => j !== i));
    setOpenQ(null);
    setEditQ(null);
  };

  function validate(): string | null {
    if (!examCode || !audience) return "Choose the exam and the class.";
    if (!title.trim()) return "Give the test a title.";
    if (!questions.length) return "Build the question paper first.";
    if (questions.length > MAX_QUESTIONS)
      return `A test can have at most ${MAX_QUESTIONS} questions.`;
    for (const [i, q] of order.entries()) {
      const x = questions[q];
      if (!x.text.trim()) return `Question ${i + 1} has no text.`;
      const opts = x.options.map((o) => o.trim());
      if (opts.some((o) => !o)) return `Question ${i + 1} has an empty option.`;
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length)
        return `Question ${i + 1} has two identical options.`;
    }
    if (
      new Date(localInputToIso(win.closesAt)) <=
      new Date(localInputToIso(win.opensAt))
    )
      return "The closing time must be after the opening time.";
    return null;
  }

  // Saved and shown subject by subject.
  const order = useMemo(
    () => [...subjects.flatMap((s) => inSubject(s)), ...others],
    [questions, subjects],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(andPublish: boolean) {
    setError(null);
    const problem = validate();
    if (problem) return setError(new Error(problem));
    setBusy(true);
    const cleanQs = order
      .map((i) => questions[i])
      .map((q) => ({
        ...q,
        text: q.text.trim(),
        options: q.options.map((o) => o.trim()),
        topic: q.topic?.trim() || null,
        explanation: q.explanation?.trim() || null,
        subject: q.subject || null,
      }));
    try {
      let testId = t?.id;
      if (isNew) {
        const created = await api<TestDetail>("/tests", {
          method: "POST",
          body: {
            audience,
            examCode,
            title: title.trim(),
            instructions: instructions.trim() || null,
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
        await api(`/tests/${testId}`, {
          method: "PATCH",
          body: {
            title: title.trim(),
            instructions: instructions.trim() || null,
            closesAt: localInputToIso(win.closesAt),
          },
        });
      } else {
        await api(`/tests/${testId}`, {
          method: "PATCH",
          body: {
            title: title.trim(),
            instructions: instructions.trim() || null,
            durationMin,
            opensAt: localInputToIso(win.opensAt),
            closesAt: localInputToIso(win.closesAt),
            allowOffline,
            negativeMarks,
            instantResults,
          },
        });
        await api(`/tests/${testId}/questions`, {
          method: "PUT",
          body: { questions: cleanQs },
        });
      }
      if (andPublish) await api(`/tests/${testId}/publish`, { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["tests"] });
      void qc.invalidateQueries({ queryKey: ["test", testId] });
      toast(
        andPublish
          ? "Test published. Students see it on their tablets."
          : "Test saved",
      );
      if (isNew) nav(`/tests/${testId}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function simple(
    path: string,
    method: string,
    msg: string,
    after?: () => void,
  ) {
    setError(null);
    try {
      await api(path, { method });
      void qc.invalidateQueries({ queryKey: ["tests"] });
      void qc.invalidateQueries({ queryKey: ["test", t?.id] });
      toast(msg);
      after?.();
    } catch (e) {
      setError(e);
    }
  }

  const step = (n: number, done: boolean) => (
    <span className={`tb-num${done ? " done" : ""}`}>
      {done ? <Check /> : n}
    </span>
  );

  /** One question of the paper (a plain function, not a component, so typing keeps focus). */
  function row(i: number, n: number) {
    const q = questions[i];
    const isOpen = openQ === i || editQ === i;
    return (
      <li key={i} className={`tb-q${isOpen ? " open" : ""}`}>
        <div className="tb-q-row">
          <span className="tb-q-n">{n}</span>
          <button
            type="button"
            className="tb-q-text"
            onClick={() => setOpenQ(isOpen ? null : i)}
            aria-expanded={isOpen}
          >
            {q.text.trim() ? (
              <MathText
                text={
                  isOpen
                    ? q.text
                    : q.text.replace(/\{\{IMG::[^}]+\}\}/g, " [picture] ")
                }
              />
            ) : (
              <em>New question</em>
            )}
          </button>
          {q.topic && <span className="tb-q-topic">{q.topic}</span>}
          {editable && (
            <span className="tb-q-acts">
              {q.bankQuestionId && (
                <button
                  type="button"
                  onClick={() => void swap(i)}
                  title="Swap for another question"
                  aria-label={`Swap question ${n}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 8h13l-3-3M20 16H7l3 3" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove"
                aria-label={`Remove question ${n}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          )}
        </div>
        {isOpen &&
          (editQ === i ? (
            <div className="tb-q-edit">
              <textarea
                rows={3}
                value={q.text}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder="Type the question"
                aria-label={`Question ${n} text`}
              />
              {q.options.map((o, j) => (
                <label key={j} className="tb-opt-edit">
                  <input
                    type="radio"
                    name={`tbq${i}`}
                    checked={q.correctIndex === j}
                    onChange={() => update(i, { correctIndex: j })}
                    aria-label={`Option ${KEYS[j]} is correct`}
                  />
                  <span className="tb-key">{KEYS[j]}</span>
                  <input
                    value={o}
                    onChange={(e) =>
                      update(i, {
                        options: q.options.map((x, k) =>
                          k === j ? e.target.value : x,
                        ),
                      })
                    }
                    placeholder={`Option ${KEYS[j]}`}
                  />
                </label>
              ))}
              <span className="tb-muted">Tick the correct answer.</span>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setEditQ(null)}
              >
                Done
              </button>
            </div>
          ) : (
            <div className="tb-q-view">
              <ol className="tb-opts">
                {q.options.map((o, j) => (
                  <li
                    key={j}
                    className={q.correctIndex === j ? "right" : undefined}
                  >
                    <span className="tb-key">{KEYS[j]}</span>
                    <MathText text={o} />
                  </li>
                ))}
              </ol>
              {q.explanation && (
                <details className="tb-sol">
                  <summary>Solution</summary>
                  <MathText text={q.explanation} />
                </details>
              )}
              {editable && (
                <button
                  type="button"
                  className="tb-link"
                  onClick={() => setEditQ(i)}
                >
                  Edit this question
                </button>
              )}
            </div>
          ))}
      </li>
    );
  }

  return (
    <div className="tb">
      <p className="crumb">
        <Link to="/tests">Live tests</Link>
      </p>
      <div className="tb-head">
        <div>
          <h1>{isNew ? "Create test" : t!.title}</h1>
          {t ? (
            <p className="tb-sub">
              <span className={`pill ${STATE_PILL[t.state][1]}`}>
                {STATE_PILL[t.state][0]}
              </span>
              {t.attemptCount > 0 &&
                `${t.attemptCount} student${t.attemptCount === 1 ? "" : "s"} started`}
            </p>
          ) : (
            <p className="tb-sub">
              Pick the exam, class and chapters. The question paper is made for
              you.
            </p>
          )}
        </div>
        {t && (
          <div className="tb-head-acts">
            {t.state !== "draft" && (
              <Link className="btn btn-quiet" to={`/tests/${t.id}/monitor`}>
                Live monitor
              </Link>
            )}
            {t.state !== "draft" && can(P.TestsReview) && (
              <Link className="btn btn-quiet" to={`/tests/${t.id}/results`}>
                Results
              </Link>
            )}
            {canEdit && t.publishedAt && !locked && (
              <button
                className="btn btn-quiet"
                onClick={() =>
                  void simple(
                    `/tests/${t.id}/unpublish`,
                    "POST",
                    "Test withdrawn",
                  )
                }
              >
                Withdraw
              </button>
            )}
            {canEdit && !locked && (
              <button
                className="btn btn-quiet danger-text"
                onClick={async () => {
                  if (
                    await confirm(
                      "Delete this test?",
                      "The test and its questions are deleted.",
                      "Delete test",
                      true,
                    )
                  )
                    await simple(
                      `/tests/${t.id}`,
                      "DELETE",
                      "Test deleted",
                      () => nav("/tests"),
                    );
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {locked && (
        <p className="tb-note">
          Students have started this test, so its questions and timing are
          locked. You can still change the title, instructions and closing time.
        </p>
      )}

      <div className="tb-layout">
        <div className="tb-main">
          {/* 1. Exam */}
          <section className="tb-card">
            <h2>{step(1, !!examCode)} Exam</h2>
            <div className="tb-exams" role="radiogroup" aria-label="Exam">
              {(Object.keys(PAPERS) as ExamCode[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={examCode === code}
                  className="tb-exam"
                  disabled={!isNew}
                  onClick={() => chooseExam(code)}
                >
                  <span className={`tb-exam-tag ${code}`}>{code}</span>
                  <span className="tb-exam-sub">{PAPERS[code].blurb}</span>
                  <span className="tb-exam-mark">{PAPERS[code].marking}</span>
                  {examCode === code && (
                    <span className="tb-exam-check">
                      <Check />
                    </span>
                  )}
                </button>
              ))}
            </div>
            {examCode === "KCET" && (
              <div className="tb-stream">
                <span>Stream</span>
                <div role="radiogroup" aria-label="KCET stream">
                  {STREAMS.map(([v, subs]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={stream === v}
                      disabled={!editable}
                      onClick={() => chooseStream(v)}
                    >
                      <b>{v}</b>
                      <small>
                        {subs
                          .map((x) => (x === "Mathematics" ? "Maths" : x))
                          .join(", ")}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 2. Class */}
          <section className="tb-card">
            <h2>{step(2, !!audience)} Class</h2>
            <div className="tb-seg" role="radiogroup" aria-label="Class">
              {CLASSES.map(([v, label, sub]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={audience === v}
                  disabled={!isNew}
                  onClick={() => setAudience(v)}
                >
                  <b>{label}</b>
                  <span>{sub}</span>
                </button>
              ))}
            </div>
            {!isNew && (
              <p className="tb-muted">
                The exam and class can't be changed after the test is created.
              </p>
            )}
          </section>

          {/* 3. Syllabus */}
          {editable && (
            <section className="tb-card">
              <h2>
                {step(
                  3,
                  !!examCode &&
                    !!audience &&
                    (scope === "full" || chapters.size > 0),
                )}{" "}
                Syllabus
              </h2>
              <div className="tb-scope" role="radiogroup" aria-label="Syllabus">
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === "full"}
                  onClick={() => setScope("full")}
                >
                  <span className="tb-radio" />
                  <span>
                    <b>Full syllabus</b>
                    <span>
                      Questions from every chapter
                      {level
                        ? ` of Class ${level}`
                        : audience === "BOTH"
                          ? " of Class 11 and 12"
                          : ""}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === "chapters"}
                  onClick={() => setScope("chapters")}
                >
                  <span className="tb-radio" />
                  <span>
                    <b>Choose chapters</b>
                    <span>
                      Pick chapters, and topics inside them if you like
                    </span>
                  </span>
                </button>
              </div>

              {scope === "chapters" &&
                (!examCode || !audience ? (
                  <p className="tb-muted">Choose the exam and class first.</p>
                ) : syllabus.isLoading || exams.isLoading ? (
                  <Loading label="Loading chapters..." />
                ) : syllabus.error ? (
                  <ErrorNote error={syllabus.error} />
                ) : (
                  <div className="tb-chapters">
                    <div className="tb-tabs" role="tablist">
                      {subjects.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="tab"
                          aria-selected={tab === s}
                          onClick={() => setTab(s)}
                        >
                          {s}
                          {pickedIn(s) > 0 && <span>{pickedIn(s)}</span>}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const list = chaptersOf(tab);
                      if (!list.length)
                        return (
                          <p className="tb-muted tb-pad">
                            No {tab} chapters in the question bank for this
                            class.
                          </p>
                        );
                      const allOn = list.every((c) => chapters.has(c.id));
                      const groups: [string, typeof list][] = level
                        ? [[`Class ${level}`, list]]
                        : [
                            [
                              "Class 11",
                              list.filter((c) => c.classLevel === "11"),
                            ],
                            [
                              "Class 12",
                              list.filter((c) => c.classLevel === "12"),
                            ],
                          ];
                      return (
                        <>
                          <div className="tb-ch-bar">
                            <span>
                              {pickedIn(tab)} of {list.length} chapters ticked
                            </span>
                            <button
                              type="button"
                              className="tb-link"
                              onClick={() =>
                                setChapters((s) => {
                                  const next = new Set(s);
                                  list.forEach((c) =>
                                    allOn ? next.delete(c.id) : next.add(c.id),
                                  );
                                  return next;
                                })
                              }
                            >
                              {allOn ? "Clear all" : "Tick all"}
                            </button>
                          </div>
                          {groups
                            .filter(([, g]) => g.length)
                            .map(([name, g]) => (
                              <div key={name} className="tb-ch-group">
                                {!level && <h3>{name}</h3>}
                                <ul>
                                  {g.map((c) => (
                                    <ChapterRow
                                      key={c.id}
                                      chapter={c}
                                      on={chapters.has(c.id)}
                                      topics={topics.get(c.id) ?? new Set()}
                                      onToggle={() => toggleChapter(c.id)}
                                      onTopics={(ts) =>
                                        setTopics((m) => {
                                          const n = new Map(m);
                                          n.set(c.id, ts);
                                          return n;
                                        })
                                      }
                                    />
                                  ))}
                                </ul>
                              </div>
                            ))}
                        </>
                      );
                    })()}
                  </div>
                ))}
            </section>
          )}

          {/* 4. Questions per subject */}
          {editable && (
            <section className="tb-card">
              <h2>{step(4, plannedTotal > 0 && !!paper)} Questions</h2>
              {!paper ? (
                <p className="tb-muted">Choose the exam first.</p>
              ) : (
                <>
                  <div className="tb-counts">
                    {subjects.map((s) => (
                      <label key={s} className="tb-count">
                        <span>{s}</span>
                        <input
                          type="number"
                          min={0}
                          max={300}
                          value={counts[s] ?? 0}
                          onChange={(e) =>
                            setCounts((c) => ({
                              ...c,
                              [s]: Math.max(
                                0,
                                Math.min(
                                  300,
                                  Math.round(Number(e.target.value) || 0),
                                ),
                              ),
                            }))
                          }
                          aria-label={`${s} questions`}
                        />
                        <small>{(counts[s] || 0) * paper.marks} marks</small>
                      </label>
                    ))}
                  </div>
                  <div className="tb-summary">
                    <span>
                      <b>{plannedTotal}</b> questions
                    </span>
                    <span>
                      <b>{plannedTotal * paper.marks}</b> marks
                    </span>
                    <span>
                      <b>+{paper.marks}</b> right
                    </span>
                    <span>
                      <b>{negativeMarks ? `${MINUS}${negativeMarks}` : "0"}</b>{" "}
                      wrong
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-gold tb-build"
                    disabled={building || !audience}
                    onClick={() => void build()}
                  >
                    {building
                      ? "Building the paper..."
                      : questions.length
                        ? "Build a new question paper"
                        : "Build question paper"}
                  </button>
                </>
              )}
            </section>
          )}

          {/* 5. Details */}
          <section className="tb-card">
            <h2>{step(5, !!title.trim())} Details</h2>
            <div className="tb-form">
              <label className="tb-field span-2">
                <span>Title</span>
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleTouched(true);
                  }}
                  placeholder="Class 12 . NEET . Full syllabus test"
                  disabled={!canEdit}
                />
              </label>
              <label className="tb-field">
                <span>Opens</span>
                <input
                  type="datetime-local"
                  value={win.opensAt}
                  onChange={(e) => setWin({ ...win, opensAt: e.target.value })}
                  disabled={!editable}
                />
                {editable && (
                  <button
                    type="button"
                    className="tb-link tb-now"
                    onClick={() => {
                      const now = new Date();
                      now.setSeconds(0, 0);
                      setWin({ ...win, opensAt: isoToLocalInput(now.toISOString()) });
                    }}
                  >
                    Start now
                  </button>
                )}
              </label>
              <label className="tb-field">
                <span>Closes</span>
                <input
                  type="datetime-local"
                  value={win.closesAt}
                  onChange={(e) => {
                    setWin({ ...win, closesAt: e.target.value });
                    setClosesTouched(true);
                  }}
                  disabled={!canEdit}
                />
                {!closesTouched && (
                  <small className="tb-hint">Opening time + time limit</small>
                )}
              </label>
              <label className="tb-field">
                <span>Time limit (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_MINUTES}
                  value={durationMin}
                  onChange={(e) => {
                    setDuration(
                      Math.max(
                        1,
                        Math.min(MAX_MINUTES, Number(e.target.value) || 1),
                      ),
                    );
                    setTimeTouched(true);
                  }}
                  disabled={!editable}
                />
                {paper && (
                  <small className="tb-hint">
                    {examCode}: {paper.timing}
                  </small>
                )}
              </label>
              <label className="tb-field">
                <span>Negative marking</span>
                <select
                  value={negativeMarks}
                  onChange={(e) => setNegative(Number(e.target.value))}
                  disabled={!editable}
                >
                  <option value={0}>None</option>
                  <option value={0.25}>{MINUS}0.25 per wrong answer</option>
                  <option value={0.5}>{MINUS}0.5 per wrong answer</option>
                  <option value={1}>{MINUS}1 per wrong answer</option>
                </select>
              </label>
            </div>
            <details className="tb-more">
              <summary>More options</summary>
              <label className="tb-field">
                <span>Instructions for students (optional)</span>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
              <div className="tb-toggle">
                <span>
                  <b>Allow offline</b>
                  <span>
                    Students can write without Wi-Fi. Answers upload when the
                    tablet reconnects.
                  </span>
                </span>
                <Toggle
                  checked={allowOffline}
                  onChange={setOffline}
                  label="Allow offline"
                  disabled={!editable}
                />
              </div>
              <div className="tb-toggle">
                <span>
                  <b>Show score straight after submitting</b>
                  <span>
                    Correct answers are shown only after the test closes.
                  </span>
                </span>
                <Toggle
                  checked={instantResults}
                  onChange={setInstant}
                  label="Show score straight away"
                  disabled={!editable}
                />
              </div>
            </details>
          </section>

          {/* The paper */}
          {(questions.length > 0 || !isNew) && paper && (
            <section className="tb-card" id="tb-paper">
              <h2 className="tb-paper-title">
                Question paper
                <span>
                  {questions.length} questions{DOT}
                  {totalMarks} marks
                </span>
              </h2>
              {notes.map((n) => (
                <p key={n} className="tb-note warn">
                  {n}
                </p>
              ))}
              {[
                ...subjects.map((s) => [s, inSubject(s)] as const),
                ...(others.length
                  ? [["Other questions", others] as const]
                  : []),
              ].map(([s, idx]) => {
                const all = showAll.has(s);
                const shown = all ? idx : idx.slice(0, 5);
                return (
                  <div key={s} className="tb-subject">
                    <div className="tb-subject-head">
                      <b>{s}</b>
                      <span>
                        {idx.length} question{idx.length === 1 ? "" : "s"}
                      </span>
                      {editable && subjects.includes(s) && (
                        <span className="tb-subject-acts">
                          <button
                            type="button"
                            className="tb-link"
                            onClick={() => setPickFor(s)}
                          >
                            Pick questions yourself
                          </button>
                          <button
                            type="button"
                            className="tb-link"
                            onClick={() => {
                              setQuestions((qs) => [
                                ...qs,
                                blank(s, paper.marks),
                              ]);
                              const i = questions.length;
                              setShowAll((x) => new Set(x).add(s));
                              setOpenQ(i);
                              setEditQ(i);
                            }}
                          >
                            Type a question
                          </button>
                        </span>
                      )}
                    </div>
                    {idx.length > 0 && (
                      <ol className="tb-qs">
                        {shown.map((i) => row(i, order.indexOf(i) + 1))}
                      </ol>
                    )}
                    {idx.length > 5 && (
                      <button
                        type="button"
                        className="tb-more-btn"
                        onClick={() =>
                          setShowAll((x) => {
                            const n = new Set(x);
                            if (all) n.delete(s);
                            else n.add(s);
                            return n;
                          })
                        }
                      >
                        {all
                          ? "Show fewer"
                          : `Show all ${idx.length} ${s} questions`}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <ErrorNote error={error} />

          {canEdit && (
            <div className="tb-bar">
              <span className="tb-bar-info">
                <b>{questions.length}</b> questions{DOT}
                <b>{totalMarks}</b> marks{DOT}
                {durationMin} min
              </span>
              <span className="tb-bar-acts">
                <button
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  {busy
                    ? "Saving..."
                    : isNew
                      ? "Save as draft"
                      : "Save changes"}
                </button>
                {(isNew || !t?.publishedAt) && (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void save(true)}
                  >
                    Save and publish
                  </button>
                )}
              </span>
            </div>
          )}
        </div>

        <aside className="tb-aside" aria-label="Test summary">
          <div className="tb-sum-card">
            <h2>Test summary</h2>
            <dl className="tb-sum-list">
              <div>
                <dt>Exam</dt>
                <dd>
                  {examCode ? (
                    examCode === "KCET" ? (
                      `KCET ${stream}`
                    ) : (
                      examCode
                    )
                  ) : (
                    <span className="tb-sum-empty">Not chosen</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Class</dt>
                <dd>
                  {audience ? (
                    CLASSES.find((c) => c[0] === audience)![1]
                  ) : (
                    <span className="tb-sum-empty">Not chosen</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Syllabus</dt>
                <dd>
                  {scope === "full"
                    ? "Full syllabus"
                    : `${chapters.size} chapter${chapters.size === 1 ? "" : "s"}`}
                </dd>
              </div>
              <div>
                <dt>Marking</dt>
                <dd>
                  {paper ? (
                    `+${paper.marks}, ${negativeMarks ? `${MINUS}${negativeMarks}` : "no negative"}`
                  ) : (
                    <span className="tb-sum-empty">{DASH}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{durationMin} min</dd>
              </div>
            </dl>
            {paper && (
              <div className="tb-sum-subjects">
                {subjects.map((s) => {
                  const have = questions.filter((q) => q.subject === s).length;
                  const want = counts[s] || 0;
                  return (
                    <div key={s} className="tb-sum-subject">
                      <span>{s}</span>
                      <b>{questions.length ? `${have} / ${want}` : want}</b>
                      <i aria-hidden="true">
                        <em
                          style={{
                            width: `${want ? Math.min(100, Math.round((have / want) * 100)) : 0}%`,
                          }}
                        />
                      </i>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="tb-sum-total">
              <div>
                <b>{questions.length || plannedTotal}</b>
                <span>questions</span>
              </div>
              <div>
                <b>
                  {questions.length
                    ? totalMarks
                    : paper
                      ? plannedTotal * paper.marks
                      : 0}
                </b>
                <span>marks</span>
              </div>
            </div>
            <p className={`tb-sum-state${questions.length ? " ready" : ""}`}>
              {questions.length
                ? "Question paper ready. Check it, then publish."
                : "Question paper not built yet."}
            </p>
            {editable && paper && (
              <button
                type="button"
                className="btn btn-gold tb-sum-build"
                disabled={building || !audience}
                onClick={() => void build()}
              >
                {building
                  ? "Building..."
                  : questions.length
                    ? "Build a new paper"
                    : "Build question paper"}
              </button>
            )}
          </div>
        </aside>
      </div>

      {paper && (
        <BankPicker
          open={!!pickFor}
          onClose={() => setPickFor(null)}
          examCode={examCode || undefined}
          subjects={subjects}
          subject={pickFor ?? undefined}
          level={level ?? "12"}
          defaultMarks={paper.marks}
          existing={
            new Set(
              questions
                .map((q) => q.bankQuestionId)
                .filter((x): x is string => !!x),
            )
          }
          onAdd={(added) => setQuestions((qs) => [...qs, ...added])}
        />
      )}
      {dialog}
    </div>
  );
}
