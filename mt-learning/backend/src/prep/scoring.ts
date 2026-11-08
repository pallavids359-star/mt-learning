import type { PrepItem, PrepResult } from '../db/schema';
import type { FullQuestion, Marking } from './bank';

const VALID = ['A', 'B', 'C', 'D'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export interface GivenAnswer {
  questionId: string;
  selected?: string[];
  numerical?: number;
  marked?: boolean;
  timeSec?: number;
}

/** Copies what the student sent onto the attempt's items (only for questions in the attempt). */
export function applyAnswers(items: PrepItem[], given: GivenAnswer[] | undefined): PrepItem[] {
  if (!given?.length) return items;
  const byId = new Map(given.map((g) => [g.questionId, g]));
  return items.map((it) => {
    const g = byId.get(it.questionId);
    if (!g) return it;
    return {
      ...it,
      selected: [...new Set((g.selected ?? []).filter((x) => VALID.includes(x)))].sort(),
      numerical: typeof g.numerical === 'number' && Number.isFinite(g.numerical) ? g.numerical : undefined,
      marked: Boolean(g.marked),
      timeSec: Math.max(0, Math.round(g.timeSec ?? 0)),
    };
  });
}

/**
 * Marks every item, exactly as GenPrep does: a question's own marks override the exam's,
 * multi-correct questions need the exact set, numericals allow the stated tolerance, and a
 * question removed from the bank counts as unanswered.
 */
export function score(
  items: PrepItem[],
  questions: Map<string, FullQuestion>,
  marking: Marking,
  names: { subjects: Map<string, string>; chapters: Map<string, string> },
  elapsedSec: number,
): { items: PrepItem[]; result: PrepResult } {
  let total = 0;
  let max = 0;
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let time = 0;
  const subjects = new Map<string, PrepResult['subjects'][number]>();
  const chapters = new Map<string, PrepResult['chapters'][number]>();

  const scored = items.map((it) => {
    const q = questions.get(it.questionId);
    const plus = q?.marks?.correct ?? marking.correct;
    const minus = q?.marks?.incorrect ?? marking.incorrect;
    max += plus;
    time += it.timeSec;

    let isCorrect: boolean | null = null;
    let correctOptionIds: string[] = [];
    if (q?.type === 'numerical') {
      if (it.numerical !== undefined && q.numerical) isCorrect = Math.abs(it.numerical - q.numerical.value) <= q.numerical.tolerance + 1e-9;
    } else if (q) {
      correctOptionIds = [...q.correctOptionIds].sort();
      if (it.selected.length) isCorrect = sameSet(it.selected, correctOptionIds);
    }
    const marksAwarded = isCorrect === null ? marking.unanswered : isCorrect ? plus : minus;
    total += marksAwarded;
    if (isCorrect === null) unanswered++;
    else if (isCorrect) correct++;
    else incorrect++;

    const s = subjects.get(it.subjectId) ?? { subjectId: it.subjectId, name: names.subjects.get(it.subjectId) ?? 'Subject', score: 0, correct: 0, incorrect: 0, unanswered: 0 };
    s.score += marksAwarded;
    if (isCorrect === null) s.unanswered++;
    else if (isCorrect) s.correct++;
    else s.incorrect++;
    subjects.set(it.subjectId, s);

    const c = chapters.get(it.chapterId) ?? { chapterId: it.chapterId, name: names.chapters.get(it.chapterId) ?? 'Chapter', correct: 0, attempted: 0 };
    if (isCorrect !== null) c.attempted++;
    if (isCorrect) c.correct++;
    chapters.set(it.chapterId, c);

    return { ...it, correctOptionIds, isCorrect, marksAwarded };
  });

  const attempted = correct + incorrect;
  return {
    items: scored,
    result: {
      score: round2(total),
      maxScore: round2(max),
      percentage: max ? round2((total / max) * 100) : 0,
      accuracy: attempted ? round2((correct / attempted) * 100) : 0,
      correct,
      incorrect,
      unanswered,
      timeTakenSec: time || elapsedSec,
      subjects: [...subjects.values()].map((s) => ({ ...s, score: round2(s.score) })),
      chapters: [...chapters.values()],
    },
  };
}

/** Mock-test patterns, as in GenPrep: [subject key, question count], minutes. */
/** Mock papers: [subject, questions, at least this many with a diagram]. */
export const MOCK_PATTERNS: Record<string, { minutes: number; sections: [string, number, number][] }> = {
  NEET: { minutes: 180, sections: [['physics', 45, 7], ['chemistry', 45, 7], ['biology', 90, 12]] },
  JEE: { minutes: 180, sections: [['physics', 25, 12], ['chemistry', 25, 12], ['mathematics', 25, 12]] },
  KCET_PCM: { minutes: 240, sections: [['physics', 60, 15], ['chemistry', 60, 15], ['mathematics', 60, 15]] },
  KCET_PCB: { minutes: 240, sections: [['physics', 60, 15], ['chemistry', 60, 15], ['biology', 60, 15]] },
  KCET_PCMB: { minutes: 320, sections: [['physics', 60, 15], ['chemistry', 60, 15], ['mathematics', 60, 15], ['biology', 60, 15]] },
};

/** Practice: about a third of the questions have a diagram (10 -> 3, 15 -> 5). */
export const practiceImages = (count: number) => Math.ceil(count * 0.3);

export function mockPattern(code: string, stream?: 'PCM' | 'PCB' | 'PCMB'): { key: string; label: string } {
  if (code === 'KCET') {
    if (stream === 'PCB') return { key: 'KCET_PCB', label: 'KCET (PCB)' };
    if (stream === 'PCMB') return { key: 'KCET_PCMB', label: 'KCET (PCMB)' };
    return { key: 'KCET_PCM', label: 'KCET (PCM)' };
  }
  return { key: code, label: code };
}
