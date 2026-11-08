/**
 * The question bank: exams → subjects → chapters → topics → questions.
 *
 * The real bank lives in GenPrep's MongoDB and is only ever READ from here; GenPrep's own
 * admin stays the place where questions are written. When GENPREP_MONGO_URI is not set, a
 * small built-in sample bank is used so the app can be tried end to end.
 *
 * Question text uses GenPrep's conventions: maths in $...$ or $$...$$, pictures as
 * {{IMG::https://...}}, and **bold**. Apps render these; the server passes them through.
 */

export type OptionId = 'A' | 'B' | 'C' | 'D';
export type QuestionType = 'mcq_single' | 'mcq_multi' | 'numerical';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Marking {
  correct: number;
  incorrect: number;
  unanswered: number;
}

export interface BankExam {
  id: string;
  code: string;
  name: string;
  marking: Marking;
  durationMinutes: number;
}

export interface BankSubject {
  id: string;
  examId: string;
  name: string;
  order: number;
}

export interface BankChapter {
  id: string;
  examId: string;
  subjectId: string;
  name: string;
  classLevel: '11' | '12';
  weightage: number;
  order: number;
  questionCount: number;
}

export interface BankTopic {
  id: string;
  chapterId: string;
  name: string;
  order: number;
  questionCount: number;
}

export interface BankOption {
  id: OptionId;
  text: string;
  image?: string;
}

/** What a student may see before submitting: no answers. */
export interface BankQuestion {
  id: string;
  examId: string;
  subjectId: string;
  chapterId: string;
  topicId: string;
  type: QuestionType;
  text: string;
  images: string[];
  options: BankOption[];
  difficulty: Difficulty;
  marks?: { correct?: number; incorrect?: number };
}

export interface FullQuestion extends BankQuestion {
  correctOptionIds: OptionId[];
  numerical?: { value: number; tolerance: number };
  explanation: { text: string; images: string[]; videoUrl?: string };
  status: 'draft' | 'published' | 'archived';
}

/** Where to draw questions from. Each part is a chapter, optionally narrowed to some topics. */
export interface SampleFilter {
  examId: string;
  parts?: { chapterId: string; topicIds?: string[] }[];
  subjectId?: string;
  difficulty?: Difficulty;
  /** At least this many questions with a diagram or picture, when the bank has them. */
  minImages?: number;
}

export interface QuestionBank {
  readonly source: 'genprep' | 'sample';
  exams(): Promise<BankExam[]>;
  subjects(examId: string): Promise<BankSubject[]>;
  chapters(examId: string): Promise<BankChapter[]>;
  topics(chapterId: string): Promise<BankTopic[]>;
  topicsByIds(ids: string[]): Promise<BankTopic[]>;
  /** Random published questions matching the filter (up to `size`). */
  sample(filter: SampleFilter, size: number): Promise<BankQuestion[]>;
  /** Questions by id, with answers. Missing ids are left out. */
  questions(ids: string[]): Promise<FullQuestion[]>;
  /** Published questions of a chapter, for staff choosing live-test questions. */
  browse(chapterId: string, page: number, pageSize: number): Promise<{ items: FullQuestion[]; total: number }>;
}

export const QUESTION_BANK = Symbol('QUESTION_BANK');

/** Strip what a student must not see before submitting. */
export function studentView(q: BankQuestion): BankQuestion {
  return {
    id: q.id,
    examId: q.examId,
    subjectId: q.subjectId,
    chapterId: q.chapterId,
    topicId: q.topicId,
    type: q.type,
    text: q.text,
    images: q.images,
    options: q.options,
    difficulty: q.difficulty,
    marks: q.marks,
  };
}

export function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Lower-case letters only, so "Maths" and "Mathematics" match one mock-test section. */
export function subjectKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  return k === 'maths' || k === 'math' ? 'mathematics' : k;
}
