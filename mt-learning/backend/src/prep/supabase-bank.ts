import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { poolConfig } from '../db/pg-config';
import { shuffle, type BankChapter, type BankExam, type BankOption, type BankQuestion, type BankSubject, type BankTopic, type FullQuestion, type OptionId, type QuestionBank, type SampleFilter } from './bank';

/**
 * Reads GenPrep's question bank from its Supabase (PostgreSQL) project: one flat `questions`
 * table with subject, klass, chapter, topic and an `exams` array. Read-only by design: every
 * session is set to read-only, nothing here writes, and the connection should use a database
 * role that has SELECT on `questions` only.
 *
 * GenPrep has no separate exam/subject/chapter tables, so their ids are made here:
 *   exam     NEET                      (the code itself)
 *   subject  NEET~s~<hash of subject>
 *   chapter  NEET~c~<hash of subject|class|chapter>
 *   topic    NEET~t~<hash of subject|class|chapter|topic>
 *   question NEET~<question uuid>      (the exam is part of the id, so a question shared by
 *                                       NEET and JEE is counted separately for each exam)
 */

/** Exams we know how to mark. Codes found in the data but not listed here get NEET-style marking. */
const EXAM_META: Record<string, { name: string; correct: number; incorrect: number; minutes: number; order: number }> = {
  NEET: { name: 'NEET (UG)', correct: 4, incorrect: -1, minutes: 180, order: 1 },
  JEE: { name: 'JEE Main', correct: 4, incorrect: -1, minutes: 180, order: 2 },
  KCET: { name: 'Karnataka CET', correct: 1, incorrect: 0, minutes: 240, order: 3 },
};

/**
 * Only these three exams are offered. GenPrep tags some questions with other names for the
 * same exam (JEE MAIN, JEE ADVANCED, NEET/JEE); those count towards the exams listed here,
 * and any other tag is not shown.
 */
const EXAM_TAGS: Record<string, string[]> = {
  NEET: ['NEET', 'NEET/JEE', 'NEET UG'],
  JEE: ['JEE', 'JEE MAIN', 'JEE MAINS', 'JEE ADVANCED', 'NEET/JEE'],
  KCET: ['KCET', 'CET', 'K-CET'],
};
const tagsOf = (exam: string) => EXAM_TAGS[exam] ?? [];

/** Subjects each exam has. Questions tagged for an exam in another subject (Maths for NEET) are not shown. */
const EXAM_SUBJECTS: Record<string, string[]> = {
  NEET: ['physics', 'chemistry', 'biology', 'botany', 'zoology'],
  JEE: ['physics', 'chemistry', 'mathematics', 'maths'],
  KCET: ['physics', 'chemistry', 'mathematics', 'maths', 'biology', 'botany', 'zoology'],
};
const subjectAllowed = (exam: string, subject: string) => (EXAM_SUBJECTS[exam] ?? []).includes(subject.trim().toLowerCase());
const TAG_VALUES = Object.entries(EXAM_TAGS)
  .flatMap(([exam, tags]) => tags.map((t) => `('${t}', '${exam}')`))
  .join(', ');

const LETTERS: OptionId[] = ['A', 'B', 'C', 'D'];
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_ORDER = ['physics', 'chemistry', 'biology', 'botany', 'zoology', 'mathematics', 'maths'];

/** All the text a student sees in a question. */
const SEEN = `concat_ws(' ', question, opt_a, opt_b, opt_c, opt_d, assertion, reason)`;
/** A field with LaTeX commands (like \\frac) but no $ around them, so they would show as code. */
const rawTex = (col: string) => `(coalesce(${col}, '') ~ '\\\\[a-zA-Z]{2,}' and coalesce(${col}, '') !~ '\\$')`;

/**
 * Leaves out questions students should not see:
 *  - placeholders such as "[DIAGRAM REQUIRED]" or "figure not available" (the picture is missing);
 *  - broken maths: an odd number of $ signs, or LaTeX commands outside $...$;
 *  - incomplete questions: very short text, or a multiple-choice question without all four options;
 *  - true / false questions.
 */
const QUALITY = `
  and ${SEEN} !~* '(diagram|figure|image|graph|picture|fig\\.?)\\s*(is\\s*)?(required|needed|missing|not\\s+(available|shown|given|provided))'
  and ${SEEN} !~* '\\[\\s*(diagram|figure|image|graph|picture|fig)'
  and (length(${SEEN}) - length(replace(${SEEN}, '$', ''))) % 2 = 0
  and not (${['question', 'opt_a', 'opt_b', 'opt_c', 'opt_d'].map(rawTex).join(' or ')})
  and (q_type = 'match' or length(trim(coalesce(question, '') || coalesce(assertion, ''))) >= 15)
  and not (q_type in ('mcq_single', 'mcq_multi', 'mcq') and (coalesce(trim(opt_c), '') = '' or coalesce(trim(opt_d), '') = ''))
  and not (lower(trim(coalesce(opt_a, ''))) in ('true', 'false', 't', 'f') and lower(trim(coalesce(opt_b, ''))) in ('true', 'false', 't', 'f'))
  and coalesce(question, '') !~* '^\\s*(state\\s+)?(whether\\s+)?(true\\s*(or|/)\\s*false)'
`;

/** Questions with a diagram or picture: a {{IMG::...}} marker, a Markdown or HTML image, or a picture link. */
const HAS_IMAGE = `${SEEN} ~* '\\{\\{IMG::|!\\[[^]]*\\]\\(|<img|https?://[^\\s)]+\\.(png|jpe?g|gif|webp|svg)|/storage/v1/object/'`;

/** Questions MT Learning can show and mark. Anything else (written answers, broken rows) is left out. */
const USABLE = `(
  coalesce(review_status, '') <> 'rejected'
  and coalesce(subject, '') <> '' and coalesce(chapter, '') <> '' and klass in ('11', '12')
  and (
    (q_type in ('mcq_single', 'mcq_multi', 'mcq') and coalesce(opt_a, '') <> '' and coalesce(opt_b, '') <> ''
      and upper(correct_option) ~ '^\\s*[A-D](\\s*,\\s*[A-D])*\\s*$')
    or (q_type = 'assertion_reason' and coalesce(assertion, '') <> '' and upper(correct_option) ~ '^\\s*[A-D]\\s*$')
    or (q_type = 'match' and match_options ? 'A' and match_options ? 'B' and upper(correct_option) ~ '^\\s*[A-D]\\s*$')
    or (q_type = 'numerical' and coalesce(nullif(trim(correct_option), ''), trim(num_answer)) ~ '^[\\$\\s]*-?[0-9]+(\\.[0-9]+)?(/[0-9]+)?[\\$\\s]*$')
  )
  ${QUALITY}
)`;

const COLUMNS = `id, subject, klass, chapter, topic, exams, q_type, question, opt_a, opt_b, opt_c, opt_d,
  assertion, reason, predef_options, column_a, column_b, match_options, num_answer, correct_option, solution_text, review_status`;

export interface GenPrepRow {
  id: string;
  subject: string | null;
  klass: string | null;
  chapter: string | null;
  topic: string | null;
  exams: string[] | null;
  q_type: string | null;
  question: string | null;
  opt_a: string | null;
  opt_b: string | null;
  opt_c: string | null;
  opt_d: string | null;
  assertion: string | null;
  reason: string | null;
  predef_options: string | null;
  column_a: string[] | null;
  column_b: string[] | null;
  match_options: Record<string, unknown> | null;
  num_answer: string | null;
  correct_option: string | null;
  solution_text: string | null;
  review_status: string | null;
}

/** Text cleaned for display. \AA (the angstrom sign) is not drawn by the maths renderers, so it becomes the letter. */
const clean = (v: unknown) =>
  v == null
    ? ''
    : String(v)
        .trim()
        .replace(/\\text\{\s*\\AA\s*\}/g, '\\text{\u00c5}')
        .replace(/\\AA(?![a-zA-Z])/g, '\\text{\u00c5}')
        // Pictures written as Markdown, HTML or a bare link become {{IMG::...}}, which the apps draw.
        .replace(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g, '{{IMG::$1}}')
        .replace(/<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi, '{{IMG::$1}}')
        .replace(/(?<!IMG::)(https?:\/\/[^\s)}]+\.(?:png|jpe?g|gif|webp|svg))(?![^\s]*\}\})/gi, '{{IMG::$1}}');
const hash = (s: string) => createHash('sha1').update(s).digest('base64url').slice(0, 12);
const examCode = (v: string) => v.trim().toUpperCase();

export const subjectIdOf = (exam: string, subject: string) => `${exam}~s~${hash(subject)}`;
export const chapterIdOf = (exam: string, subject: string, klass: string, chapter: string) => `${exam}~c~${hash(`${subject}|${klass}|${chapter}`)}`;
export const topicIdOf = (exam: string, subject: string, klass: string, chapter: string, topic: string) =>
  `${exam}~t~${hash(`${subject}|${klass}|${chapter}|${topic}`)}`;

/** "1/2", "$4$", "0.5" → number; anything else → null. */
export function parseNumber(raw: string | null): number | null {
  const s = clean(raw).replace(/\$/g, '').replace(/\s+/g, '');
  if (!/^-?\d+(\.\d+)?(\/\d+)?$/.test(s)) return null;
  const [a, b] = s.split('/');
  const v = b === undefined ? Number(a) : Number(a) / Number(b);
  return Number.isFinite(v) ? v : null;
}

/** "A: text\nB: text…" → options. Falls back to the standard assertion–reason choices. */
function assertionOptions(predef: string | null): BankOption[] {
  const found = new Map<OptionId, string>();
  for (const line of clean(predef).split(/\r?\n/)) {
    const m = /^\s*\(?([A-D])[).:\-]\s*(.+)$/.exec(line);
    if (m) found.set(m[1] as OptionId, m[2].trim());
  }
  if (found.size === 4) return LETTERS.map((id) => ({ id, text: found.get(id)! }));
  return [
    { id: 'A', text: 'Both A and R are true and R is the correct explanation of A.' },
    { id: 'B', text: 'Both A and R are true but R is not the correct explanation of A.' },
    { id: 'C', text: 'A is true but R is false.' },
    { id: 'D', text: 'A is false but R is true.' },
  ];
}

/** One GenPrep row as an MT Learning question for the given exam, or null if it can't be shown. */
export function toFullQuestion(r: GenPrepRow, exam: string): FullQuestion | null {
  const subject = clean(r.subject);
  const klass = clean(r.klass);
  const chapter = clean(r.chapter);
  const topic = clean(r.topic) || 'General';
  const type = clean(r.q_type);
  let text = clean(r.question);
  let options: BankOption[] = [];
  let correct: OptionId[] = [];
  let numerical: FullQuestion['numerical'];
  let kind: FullQuestion['type'] = 'mcq_single';

  const letters = clean(r.correct_option)
    .toUpperCase()
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is OptionId => (LETTERS as string[]).includes(x));

  if (type === 'mcq_single' || type === 'mcq_multi' || type === 'mcq') {
    options = LETTERS.map((id) => ({ id, text: clean(r[`opt_${id.toLowerCase()}` as 'opt_a']) })).filter((o) => o.text);
    correct = [...new Set(letters)];
    kind = correct.length > 1 || type === 'mcq_multi' ? 'mcq_multi' : 'mcq_single';
  } else if (type === 'assertion_reason') {
    text = [text, `**Assertion (A):** ${clean(r.assertion)}`, `**Reason (R):** ${clean(r.reason)}`].filter(Boolean).join('\n\n');
    options = assertionOptions(r.predef_options);
    correct = letters.slice(0, 1);
  } else if (type === 'match') {
    const a = (r.column_a ?? []).map(clean).filter(Boolean);
    const b = (r.column_b ?? []).map(clean).filter(Boolean);
    const colA = a.map((x, i) => `(${String.fromCharCode(97 + i)}) ${x}`).join('\n');
    const colB = b.map((x, i) => `(${ROMAN[i] ?? i + 1}) ${x}`).join('\n');
    text = [text || 'Match Column I with Column II.', colA && `**Column I**\n${colA}`, colB && `**Column II**\n${colB}`].filter(Boolean).join('\n\n');
    const m = r.match_options ?? {};
    options = LETTERS.map((id) => ({ id, text: clean(m[id]) })).filter((o) => o.text);
    correct = letters.slice(0, 1);
  } else if (type === 'numerical') {
    const v = parseNumber(clean(r.correct_option) || r.num_answer);
    if (v === null) return null;
    kind = 'numerical';
    numerical = { value: v, tolerance: Math.max(Math.abs(v) * 0.01, 0.01) };
  } else {
    return null;
  }

  if (kind !== 'numerical' && (options.length < 2 || !correct.length || correct.some((c) => !options.some((o) => o.id === c)))) return null;
  if (!text || !subject || !chapter || (klass !== '11' && klass !== '12')) return null;

  return {
    id: `${exam}~${r.id}`,
    examId: exam,
    subjectId: subjectIdOf(exam, subject),
    chapterId: chapterIdOf(exam, subject, klass, chapter),
    topicId: topicIdOf(exam, subject, klass, chapter, topic),
    type: kind,
    text,
    images: [],
    options: kind === 'numerical' ? [] : options,
    difficulty: 'medium',
    correctOptionIds: kind === 'numerical' ? [] : correct,
    numerical,
    explanation: { text: clean(r.solution_text), images: [] },
    status: clean(r.review_status) === 'rejected' ? 'archived' : 'published',
  };
}

interface ChapterMeta extends BankChapter {
  subject: string;
  klass: string;
  chapter: string;
}
interface TopicMeta extends BankTopic {
  examId: string;
  subject: string;
  klass: string;
  chapter: string;
  topic: string;
}
interface Syllabus {
  exams: BankExam[];
  subjects: Map<string, BankSubject[]>;
  subjectNames: Map<string, string>;
  chapters: Map<string, ChapterMeta[]>;
  chapterById: Map<string, ChapterMeta>;
  topics: Map<string, TopicMeta[]>;
  topicById: Map<string, TopicMeta>;
}

export class SupabaseQuestionBank implements QuestionBank {
  readonly source = 'genprep' as const;
  private readonly log = new Logger('QuestionBank');
  private readonly pool: Pool;
  private syllabusCache?: { at: number; value: Promise<Syllabus> };

  constructor(url: string) {
    this.pool = new Pool({ ...poolConfig(url, 5), statement_timeout: 15_000, idleTimeoutMillis: 30_000 });
    // Belt and braces: even if the role could write, these sessions cannot.
    this.pool.on('connect', (c) => void c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY').catch(() => undefined));
    this.pool.on('error', (e) => this.log.warn(`Question bank connection error: ${e.message}`));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---------------------------------------------------------------- syllabus

  private syllabus(): Promise<Syllabus> {
    const hit = this.syllabusCache;
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
    const value = this.loadSyllabus().catch((e: unknown) => {
      this.syllabusCache = undefined; // try again on the next request
      throw e;
    });
    this.syllabusCache = { at: Date.now(), value };
    return value;
  }

  private async loadSyllabus(): Promise<Syllabus> {
    const { rows } = await this.pool.query<{ exam: string; subject: string; klass: string; chapter: string; topic: string; n: number }>(
      `select m.exam, trim(subject) as subject, klass, trim(chapter) as chapter,
              coalesce(nullif(trim(topic), ''), 'General') as topic, count(distinct questions.id)::int as n
         from questions
         join (values ${TAG_VALUES}) as m(tag, exam)
           on m.tag = any(array(select upper(trim(x)) from unnest(exams) as x))
        where ${USABLE}
        group by 1, 2, 3, 4, 5`,
    );
    this.log.log(`Question bank loaded: ${rows.reduce((s, r) => s + r.n, 0)} usable questions`);

    const s: Syllabus = { exams: [], subjects: new Map(), subjectNames: new Map(), chapters: new Map(), chapterById: new Map(), topics: new Map(), topicById: new Map() };
    const examCodes = [...new Set(rows.map((r) => r.exam).filter(Boolean))];
    s.exams = examCodes
      .map((code) => {
        const m = EXAM_META[code] ?? { name: code, correct: 4, incorrect: -1, minutes: 180, order: 99 };
        return { id: code, code, name: m.name, durationMinutes: m.minutes, marking: { correct: m.correct, incorrect: m.incorrect, unanswered: 0 }, order: m.order };
      })
      .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
      .map(({ order: _o, ...e }) => e);

    for (const r of rows) {
      const exam = r.exam;
      if (!subjectAllowed(exam, r.subject)) continue;
      const sid = subjectIdOf(exam, r.subject);
      const cid = chapterIdOf(exam, r.subject, r.klass, r.chapter);
      const tid = topicIdOf(exam, r.subject, r.klass, r.chapter, r.topic);
      if (!s.subjectNames.has(sid)) {
        s.subjectNames.set(sid, r.subject);
        const order = SUBJECT_ORDER.indexOf(r.subject.toLowerCase());
        const list = s.subjects.get(exam) ?? [];
        list.push({ id: sid, examId: exam, name: r.subject, order: order < 0 ? 50 : order });
        s.subjects.set(exam, list);
      }
      let ch = s.chapterById.get(cid);
      if (!ch) {
        ch = { id: cid, examId: exam, subjectId: sid, name: r.chapter, classLevel: r.klass === '11' ? '11' : '12', weightage: 0, order: 0, questionCount: 0, subject: r.subject, klass: r.klass, chapter: r.chapter };
        s.chapterById.set(cid, ch);
        const list = s.chapters.get(exam) ?? [];
        list.push(ch);
        s.chapters.set(exam, list);
      }
      ch.questionCount += r.n;
      let tp = s.topicById.get(tid);
      if (!tp) {
        tp = { id: tid, chapterId: cid, name: r.topic, order: 0, questionCount: 0, examId: exam, subject: r.subject, klass: r.klass, chapter: r.chapter, topic: r.topic };
        s.topicById.set(tid, tp);
        const list = s.topics.get(cid) ?? [];
        list.push(tp);
        s.topics.set(cid, list);
      }
      tp.questionCount += r.n;
    }
    for (const list of s.subjects.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const list of s.chapters.values()) list.sort((a, b) => a.classLevel.localeCompare(b.classLevel) || a.name.localeCompare(b.name));
    for (const list of s.topics.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }

  async exams(): Promise<BankExam[]> {
    return (await this.syllabus()).exams;
  }

  async subjects(examId: string): Promise<BankSubject[]> {
    return (await this.syllabus()).subjects.get(examId) ?? [];
  }

  async chapters(examId: string): Promise<BankChapter[]> {
    return ((await this.syllabus()).chapters.get(examId) ?? []).map(({ subject: _s, klass: _k, chapter: _c, ...c }) => c);
  }

  async topics(chapterId: string): Promise<BankTopic[]> {
    return ((await this.syllabus()).topics.get(chapterId) ?? []).map((t) => ({ id: t.id, chapterId: t.chapterId, name: t.name, order: t.order, questionCount: t.questionCount }));
  }

  async topicsByIds(ids: string[]): Promise<BankTopic[]> {
    const s = await this.syllabus();
    return ids.map((id) => s.topicById.get(id)).filter((t): t is TopicMeta => !!t).map((t) => ({ id: t.id, chapterId: t.chapterId, name: t.name, order: t.order, questionCount: t.questionCount }));
  }

  // ---------------------------------------------------------------- questions

  /** SQL conditions for a filter, with parameters starting at $2 ($1 is the exam's tags). */
  private async where(filter: SampleFilter): Promise<{ sql: string; params: unknown[] } | null> {
    const s = await this.syllabus();
    const tags = tagsOf(filter.examId);
    if (!tags.length) return null;
    const params: unknown[] = [tags];
    const conds = [`array(select upper(trim(x)) from unnest(exams) as x) && $1::text[]`, USABLE];
    params.push(EXAM_SUBJECTS[filter.examId] ?? []);
    conds.push(`lower(trim(subject)) = any($${params.length}::text[])`);
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filter.subjectId) {
      const name = s.subjectNames.get(filter.subjectId);
      if (!name) return null;
      conds.push(`trim(subject) = ${p(name)}`);
    }
    if (filter.parts?.length) {
      const ors: string[] = [];
      for (const part of filter.parts) {
        const ch = s.chapterById.get(part.chapterId);
        if (!ch || ch.examId !== filter.examId) continue;
        let c = `(trim(subject) = ${p(ch.subject)} and klass = ${p(ch.klass)} and trim(chapter) = ${p(ch.chapter)}`;
        const topics = (part.topicIds ?? []).map((id) => s.topicById.get(id)).filter((t): t is TopicMeta => !!t && t.chapterId === ch.id);
        if (topics.length) c += ` and coalesce(nullif(trim(topic), ''), 'General') = any(${p(topics.map((t) => t.topic))})`;
        ors.push(`${c})`);
      }
      if (!ors.length) return null;
      conds.push(`(${ors.join(' or ')})`);
    }
    return { sql: conds.join(' and '), params };
  }

  async sample(filter: SampleFilter, size: number): Promise<BankQuestion[]> {
    const w = await this.where(filter);
    if (!w || size <= 0) return [];
    const convert = (rows: GenPrepRow[]) =>
      rows
        .map((r) => toFullQuestion(r, filter.examId))
        .filter((q): q is FullQuestion => !!q)
        .map(({ correctOptionIds: _c, numerical: _n, explanation: _e, status: _s, ...q }) => q);
    // First the questions with diagrams the paper needs, then the rest (a few extra in case some rows can't be used).
    const want = Math.min(Math.max(0, filter.minImages ?? 0), size);
    const withImages = want
      ? convert((await this.pool.query<GenPrepRow>(`select ${COLUMNS} from questions where ${w.sql} and ${HAS_IMAGE} order by random() limit ${want + 5}`, w.params)).rows).slice(0, want)
      : [];
    const taken = withImages.map((q) => q.id.slice(q.id.indexOf('~') + 1));
    const { rows } = await this.pool.query<GenPrepRow>(
      `select ${COLUMNS} from questions where ${w.sql} and not (id = any($${w.params.length + 1}::uuid[])) order by random() limit ${Math.min(size + 10, 400)}`,
      [...w.params, taken],
    );
    const rest = convert(rows).slice(0, size - withImages.length);
    return withImages.length ? shuffle([...withImages, ...rest]) : rest;
  }

  async questions(ids: string[]): Promise<FullQuestion[]> {
    const parsed = ids.map((id) => {
      const i = id.indexOf('~');
      return i > 0 ? { id, exam: id.slice(0, i), uuid: id.slice(i + 1) } : null;
    });
    const valid = parsed.filter((p): p is { id: string; exam: string; uuid: string } => !!p && UUID.test(p.uuid));
    if (!valid.length) return [];
    const { rows } = await this.pool.query<GenPrepRow>(`select ${COLUMNS} from questions where id = any($1::uuid[])`, [[...new Set(valid.map((v) => v.uuid))]]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: FullQuestion[] = [];
    for (const v of valid) {
      const row = byId.get(v.uuid);
      if (!row || !(row.exams ?? []).some((e) => tagsOf(v.exam).includes(examCode(e)))) continue;
      const q = toFullQuestion(row, v.exam);
      if (q) out.push(q);
    }
    return out;
  }

  async browse(chapterId: string, page: number, pageSize: number): Promise<{ items: FullQuestion[]; total: number }> {
    const ch = (await this.syllabus()).chapterById.get(chapterId);
    if (!ch) return { items: [], total: 0 };
    const w = await this.where({ examId: ch.examId, parts: [{ chapterId }] });
    if (!w) return { items: [], total: 0 };
    const [{ rows }, { rows: count }] = await Promise.all([
      this.pool.query<GenPrepRow>(`select ${COLUMNS} from questions where ${w.sql} order by created_at, id limit ${pageSize} offset ${(page - 1) * pageSize}`, w.params),
      this.pool.query<{ n: number }>(`select count(*)::int as n from questions where ${w.sql}`, w.params),
    ]);
    return { items: rows.map((r) => toFullQuestion(r, ch.examId)).filter((q): q is FullQuestion => !!q), total: count[0]?.n ?? 0 };
  }
}
