import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { StudentPrincipal } from '../common/auth-principal';
import { CollegeClock, ScopeService } from '../common/scope.service';
import { loadEnv } from '../config/env';
import { InjectDb, type Database } from '../db/db.module';
import { prepAnswers, prepAttempts, prepBookmarks, students, type PrepItem } from '../db/schema';
import { type BankExam, type BankQuestion, type FullQuestion, QUESTION_BANK, type QuestionBank, shuffle, studentView, subjectKey } from './bank';
import type { AnswersDto, MockDto, PickDto, PracticeDto, ReviseDto } from './prep.dto';
import { applyAnswers, MOCK_PATTERNS, mockPattern, practiceImages, score } from './scoring';

type AttemptRow = typeof prepAttempts.$inferSelect;

/** Extra time after a mock test's deadline, for slow Wi-Fi when submitting. */
const GRACE_MS = 60_000;
const MIN_ATTEMPTS = 3;
const WEAK_BELOW = 50;
const STRONG_FROM = 80;
const pct = (correct: number, attempted: number) => (attempted ? Math.round((correct / attempted) * 100) : 0);
const MODE_LABEL: Record<AttemptRow['mode'], string> = { practice: 'Practice', mock: 'Mock test', wrong: 'Wrong answers', bookmark: 'Bookmarks' };

@Injectable()
export class PrepService {
  private readonly tz = loadEnv().COLLEGE_TIMEZONE;

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(QUESTION_BANK) private readonly bank: QuestionBank,
    private readonly scope: ScopeService,
  ) {}

  // ================================================================ syllabus

  async exams(me: StudentPrincipal) {
    const [exams, [s]] = await Promise.all([this.bank.exams(), this.db.select({ target: students.targetExamId }).from(students).where(eq(students.id, me.id))]);
    const target = exams.some((e) => e.id === s?.target) ? s!.target : null;
    return { source: this.bank.source, targetExamId: target, exams: exams.map((e) => ({ id: e.id, code: e.code, name: e.name, durationMinutes: e.durationMinutes, marking: e.marking })) };
  }

  async setTarget(me: StudentPrincipal, examId: string) {
    await this.exam(examId);
    await this.db.update(students).set({ targetExamId: examId, updatedAt: new Date() }).where(eq(students.id, me.id));
    return this.exams(me);
  }

  /** Subjects and chapters of an exam, with the student's own accuracy per chapter. */
  async syllabus(me: StudentPrincipal, examId: string) {
    await this.exam(examId);
    const [subjects, chapters, stats] = await Promise.all([this.bank.subjects(examId), this.bank.chapters(examId), this.statsBy(me.id, examId, 'chapter')]);
    return {
      subjects: subjects.map((s) => {
        const list = chapters.filter((c) => c.subjectId === s.id);
        return {
          id: s.id,
          name: s.name,
          questionCount: list.reduce((n, c) => n + c.questionCount, 0),
          chapters: list.map((c) => {
            const st = stats.get(c.id);
            return { id: c.id, name: c.name, classLevel: c.classLevel, weightage: c.weightage, questionCount: c.questionCount, attempted: st?.attempted ?? 0, accuracy: st ? pct(st.correct, st.attempted) : null };
          }),
        };
      }),
    };
  }

  topics(chapterId: string) {
    return this.bank.topics(chapterId).then((ts) => ts.map((t) => ({ id: t.id, name: t.name, questionCount: t.questionCount })));
  }

  // ================================================================ starting

  async startPractice(me: StudentPrincipal, dto: PracticeDto) {
    const exam = await this.exam(dto.examId);
    const all = await this.bank.chapters(exam.id);
    const wanted = new Set(dto.chapterIds);
    const chosen = all.filter((c) => wanted.has(c.id));
    if (!chosen.length) throw new BadRequestException('Choose at least one chapter of this exam');
    const topics = dto.topicIds?.length ? await this.bank.topicsByIds(dto.topicIds) : [];
    const parts = chosen.map((c) => {
      const t = topics.filter((x) => x.chapterId === c.id).map((x) => x.id);
      return t.length ? { chapterId: c.id, topicIds: t } : { chapterId: c.id };
    });
    const size = dto.count ?? 10;
    const difficulty = dto.difficulty && dto.difficulty !== 'any' ? dto.difficulty : undefined;
    const questions = await this.bank.sample({ examId: exam.id, parts, difficulty, minImages: practiceImages(size) }, size);
    if (!questions.length) throw new NotFoundException('No questions found for these choices');
    const title = chosen.length === 1 ? chosen[0].name : `${chosen.length} chapters`;
    const attempt = await this.create(me, exam, 'practice', title, { chapterIds: chosen.map((c) => c.id), topicIds: topics.map((t) => t.id), difficulty: dto.difficulty ?? 'any', count: size }, questions, null);
    return this.view(attempt, questions);
  }

  async startMock(me: StudentPrincipal, dto: MockDto) {
    const exam = await this.exam(dto.examId);
    const open = await this.openAttempt(me.id, exam.id, 'mock');
    if (open) return this.getAttempt(me, open.id);

    const { key, label } = mockPattern(exam.code, dto.stream);
    const pattern = MOCK_PATTERNS[key];
    if (!pattern) throw new BadRequestException(`Mock tests are not ready for ${exam.code} yet`);
    const subjects = await this.bank.subjects(exam.id);
    const picked: BankQuestion[] = [];
    for (const [name, n, images] of pattern.sections) {
      const s = subjects.find((x) => subjectKey(x.name) === name);
      if (s) picked.push(...(await this.bank.sample({ examId: exam.id, subjectId: s.id, minImages: images }, n)));
    }
    if (!picked.length) throw new NotFoundException(`No questions are available for ${label} yet`);
    const [{ n }] = await this.db.select({ n: count() }).from(prepAttempts).where(and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, exam.id), eq(prepAttempts.mode, 'mock')));
    const attempt = await this.create(me, exam, 'mock', `${label} Mock Test ${n + 1}`, { stream: dto.stream ?? null }, picked, new Date(Date.now() + pattern.minutes * 60_000));
    return this.view(attempt, picked);
  }

  /** Practise questions whose latest answer was wrong. */
  async startWrong(me: StudentPrincipal, dto: ReviseDto) {
    const exam = await this.exam(dto.examId);
    const ids = await this.wrongIds(me.id, exam.id);
    if (!ids.length) throw new NotFoundException('No wrong answers to revise. Great job!');
    return this.fromIds(me, exam, ids, dto.count ?? 10, 'wrong', 'Revise wrong answers');
  }

  async startBookmarks(me: StudentPrincipal, dto: ReviseDto) {
    const exam = await this.exam(dto.examId);
    const rows = await this.db.select({ id: prepBookmarks.questionId }).from(prepBookmarks).where(and(eq(prepBookmarks.studentId, me.id), eq(prepBookmarks.examId, exam.id)));
    if (!rows.length) throw new NotFoundException('You have no bookmarked questions yet');
    return this.fromIds(me, exam, rows.map((r) => r.id), dto.count ?? 10, 'bookmark', 'Revise bookmarks');
  }

  private async fromIds(me: StudentPrincipal, exam: BankExam, ids: string[], size: number, mode: 'wrong' | 'bookmark', title: string) {
    const full = (await this.bank.questions(shuffle(ids).slice(0, size))).filter((q) => q.status === 'published');
    if (!full.length) throw new NotFoundException('No questions available to practise yet');
    const questions = full.map(studentView);
    const attempt = await this.create(me, exam, mode, title, { count: size }, questions, null);
    return this.view(attempt, questions);
  }

  private async create(me: StudentPrincipal, exam: BankExam, mode: AttemptRow['mode'], title: string, filters: Record<string, unknown>, questions: BankQuestion[], expiresAt: Date | null) {
    const items: PrepItem[] = questions.map((q) => ({ questionId: q.id, subjectId: q.subjectId, chapterId: q.chapterId, topicId: q.topicId, selected: [], marked: false, timeSec: 0 }));
    const [row] = await this.db
      .insert(prepAttempts)
      .values({ studentId: me.id, examId: exam.id, examCode: exam.code, mode, title, filters, marking: exam.marking, items, expiresAt })
      .returning();
    return row;
  }

  // ================================================================ taking

  async getAttempt(me: StudentPrincipal, id: string) {
    let a = await this.load(me.id, id);
    if (a.status === 'in_progress' && this.expired(a)) a = await this.finalize(a, undefined, true);
    if (a.status === 'in_progress') {
      const full = await this.bank.questions(a.items.map((i) => i.questionId));
      const byId = new Map(full.map((q) => [q.id, studentView(q)]));
      return this.view(a, a.items.map((i) => byId.get(i.questionId)).filter((q): q is BankQuestion => !!q));
    }
    return this.review(me, a);
  }

  /** Autosave. Ignored after a mock test's deadline: the last saved answers stand. */
  async save(me: StudentPrincipal, id: string, dto: AnswersDto) {
    const a = await this.load(me.id, id);
    if (a.status !== 'in_progress') throw new ConflictException('This attempt is already submitted');
    if (this.expired(a)) {
      await this.finalize(a, undefined, true);
      throw new ConflictException('Time is up. Your last saved answers were submitted.');
    }
    const items = applyAnswers(a.items, dto.answers);
    await this.db.update(prepAttempts).set({ items }).where(eq(prepAttempts.id, a.id));
    return { saved: true, remainingSec: this.remaining(a) };
  }

  async submit(me: StudentPrincipal, id: string, dto: AnswersDto) {
    const a = await this.load(me.id, id);
    if (a.status !== 'in_progress') return this.review(me, a); // already submitted (e.g. a retry): same result
    const timeUp = this.expired(a);
    const done = await this.finalize(a, timeUp ? undefined : dto.answers, timeUp);
    return { ...(await this.review(me, done)), message: timeUp ? 'Time was up, so your last saved answers were submitted' : 'Submitted' };
  }

  /** Scores the attempt and records every answered question for analytics. */
  private async finalize(a: AttemptRow, given: AnswersDto['answers'], auto: boolean): Promise<AttemptRow> {
    const items = auto ? a.items : applyAnswers(a.items, given);
    const [full, names] = await Promise.all([this.bank.questions(items.map((i) => i.questionId)), this.names(a.examId)]);
    const elapsed = Math.round((Date.now() - a.startedAt.getTime()) / 1000);
    const scored = score(items, new Map(full.map((q) => [q.id, q])), a.marking, names, elapsed);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(prepAttempts)
        .set({ items: scored.items, result: scored.result, status: auto ? 'auto_submitted' : 'submitted', submittedAt: new Date() })
        .where(and(eq(prepAttempts.id, a.id), eq(prepAttempts.status, 'in_progress')))
        .returning();
      if (!row) return this.load(a.studentId, a.id); // submitted concurrently: keep the first result
      const answered = scored.items.filter((i) => i.isCorrect !== null && i.isCorrect !== undefined);
      if (answered.length)
        await tx.insert(prepAnswers).values(
          answered.map((i) => ({ attemptId: a.id, studentId: a.studentId, examId: a.examId, questionId: i.questionId, subjectId: i.subjectId, chapterId: i.chapterId, topicId: i.topicId, isCorrect: i.isCorrect!, timeSec: i.timeSec })),
        );
      return row;
    });
  }

  private expired(a: AttemptRow) {
    return !!a.expiresAt && Date.now() > a.expiresAt.getTime() + GRACE_MS;
  }

  private remaining(a: AttemptRow) {
    return a.expiresAt ? Math.max(0, Math.round((a.expiresAt.getTime() - Date.now()) / 1000)) : null;
  }

  private async view(a: AttemptRow, questions: BankQuestion[]) {
    const names = await this.names(a.examId);
    return {
      attemptId: a.id,
      mode: a.mode,
      title: a.title,
      examCode: a.examCode,
      status: a.status,
      marking: a.marking,
      startedAt: a.startedAt,
      expiresAt: a.expiresAt,
      serverTime: new Date(),
      remainingSec: this.remaining(a),
      questions: questions.map((q, i) => ({
        number: i + 1,
        id: q.id,
        type: q.type,
        text: q.text,
        images: q.images,
        options: q.options,
        difficulty: q.difficulty,
        subjectName: names.subjects.get(q.subjectId) ?? '',
        chapterName: names.chapters.get(q.chapterId) ?? '',
      })),
      answers: a.items.map((i) => ({ questionId: i.questionId, selected: i.selected, numerical: i.numerical ?? null, marked: i.marked, timeSec: i.timeSec })),
    };
  }

  private async review(me: StudentPrincipal, a: AttemptRow) {
    const [full, names, marks] = await Promise.all([
      this.bank.questions(a.items.map((i) => i.questionId)),
      this.names(a.examId),
      this.db.select({ id: prepBookmarks.questionId }).from(prepBookmarks).where(and(eq(prepBookmarks.studentId, me.id), inArray(prepBookmarks.questionId, a.items.map((i) => i.questionId)))),
    ]);
    const byId = new Map(full.map((q) => [q.id, q]));
    const saved = new Set(marks.map((m) => m.id));
    return {
      attemptId: a.id,
      mode: a.mode,
      title: a.title,
      examCode: a.examCode,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      result: a.result,
      review: a.items.map((i, n) => {
        const q = byId.get(i.questionId);
        return {
          number: n + 1,
          questionId: i.questionId,
          type: q?.type ?? null,
          text: q?.text ?? '(This question was removed from the question bank)',
          images: q?.images ?? [],
          options: q?.options ?? [],
          subjectName: names.subjects.get(i.subjectId) ?? '',
          chapterName: names.chapters.get(i.chapterId) ?? '',
          selected: i.selected,
          numerical: i.numerical ?? null,
          correctOptionIds: i.correctOptionIds ?? [],
          numericalAnswer: q?.numerical?.value ?? null,
          isCorrect: i.isCorrect ?? null,
          marksAwarded: i.marksAwarded ?? 0,
          timeSec: i.timeSec,
          marked: i.marked,
          explanation: q?.explanation ?? null,
          bookmarked: saved.has(i.questionId),
        };
      }),
    };
  }

  // ================================================================ bookmarks

  async bookmarks(me: StudentPrincipal, examId: string) {
    const rows = await this.db
      .select()
      .from(prepBookmarks)
      .where(and(eq(prepBookmarks.studentId, me.id), eq(prepBookmarks.examId, examId)))
      .orderBy(desc(prepBookmarks.createdAt));
    const [full, names] = await Promise.all([this.bank.questions(rows.map((r) => r.questionId)), this.names(examId)]);
    const byId = new Map(full.map((q) => [q.id, q]));
    return rows
      .filter((r) => byId.has(r.questionId))
      .map((r) => {
        const q = byId.get(r.questionId)!;
        return { questionId: r.questionId, text: q.text, subjectName: names.subjects.get(r.subjectId) ?? '', chapterName: names.chapters.get(r.chapterId) ?? '', savedAt: r.createdAt };
      });
  }

  async addBookmark(me: StudentPrincipal, questionId: string) {
    const [q] = await this.bank.questions([questionId]);
    if (!q) throw new NotFoundException('Question not found');
    await this.db.insert(prepBookmarks).values({ studentId: me.id, questionId: q.id, examId: q.examId, subjectId: q.subjectId, chapterId: q.chapterId }).onConflictDoNothing();
    return { questionId: q.id, bookmarked: true };
  }

  async removeBookmark(me: StudentPrincipal, questionId: string) {
    await this.db.delete(prepBookmarks).where(and(eq(prepBookmarks.studentId, me.id), eq(prepBookmarks.questionId, questionId)));
  }

  // ================================================================ dashboard & analytics

  async dashboard(me: StudentPrincipal, examId: string) {
    await this.exam(examId);
    const [totals, chapters, subjects, days, wrong, recent, streak, open, bookmarks] = await Promise.all([
      this.totals(me.id, examId),
      this.namedStats(me.id, examId, 'chapter'),
      this.namedStats(me.id, examId, 'subject'),
      this.daily(me.id, examId, 7),
      this.wrongIds(me.id, examId),
      this.history(me, examId, 1, 5),
      this.streak(me.id, examId),
      this.db.select().from(prepAttempts).where(and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, examId), eq(prepAttempts.status, 'in_progress'))).orderBy(desc(prepAttempts.startedAt)).limit(1),
      this.db.select({ n: count() }).from(prepBookmarks).where(and(eq(prepBookmarks.studentId, me.id), eq(prepBookmarks.examId, examId))),
    ]);
    const eligible = chapters.filter((c) => c.attempted >= MIN_ATTEMPTS);
    const weak = eligible.filter((c) => c.accuracy < WEAK_BELOW).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
    const strong = eligible.filter((c) => c.accuracy >= STRONG_FROM).sort((a, b) => b.accuracy - a.accuracy).slice(0, 5);
    const resume = open.find((a) => !this.expired(a));
    return {
      totals,
      streak,
      subjects,
      weakChapters: weak,
      strongChapters: strong,
      recommended: weak.slice(0, 3).map((c) => ({ chapterId: c.id, name: c.name, reason: `Accuracy ${c.accuracy}%: practise this chapter again` })),
      last7Days: days,
      wrongQuestionsCount: wrong.length,
      bookmarksCount: bookmarks[0].n,
      inProgress: resume ? { attemptId: resume.id, mode: resume.mode, title: resume.title, remainingSec: this.remaining(resume) } : null,
      recent: recent.items,
    };
  }

  async analytics(me: StudentPrincipal, examId: string) {
    await this.exam(examId);
    const [totals, subjects, chapters, daily, mocks, sessions] = await Promise.all([
      this.totals(me.id, examId),
      this.namedStats(me.id, examId, 'subject'),
      this.namedStats(me.id, examId, 'chapter'),
      this.daily(me.id, examId, 30),
      this.db
        .select({ id: prepAttempts.id, title: prepAttempts.title, date: prepAttempts.submittedAt, result: prepAttempts.result })
        .from(prepAttempts)
        .where(and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, examId), eq(prepAttempts.mode, 'mock'), isNotNull(prepAttempts.submittedAt)))
        .orderBy(prepAttempts.submittedAt),
      this.db
        .select({ n: count() })
        .from(prepAttempts)
        .where(and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, examId), sql`${prepAttempts.mode} <> 'mock'`, isNotNull(prepAttempts.submittedAt))),
    ]);
    return {
      totals: { ...totals, practiceSessions: sessions[0].n, mocksTaken: mocks.length },
      subjects: subjects.sort((a, b) => b.attempted - a.attempted),
      chapters: chapters.sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted),
      mocks: mocks.map((m) => ({ id: m.id, title: m.title, date: m.date, score: m.result?.score ?? 0, maxScore: m.result?.maxScore ?? 0, percentage: Math.round(m.result?.percentage ?? 0) })),
      daily,
    };
  }

  async history(me: StudentPrincipal, examId: string, page = 1, pageSize = 20) {
    const where = and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, examId), isNotNull(prepAttempts.submittedAt));
    const [rows, [{ n }]] = await Promise.all([
      this.db.select().from(prepAttempts).where(where).orderBy(desc(prepAttempts.submittedAt)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(prepAttempts).where(where),
    ]);
    return {
      total: n,
      page,
      items: rows.map((a) => ({
        attemptId: a.id,
        mode: a.mode,
        modeLabel: MODE_LABEL[a.mode],
        title: a.title,
        submittedAt: a.submittedAt,
        questions: a.items.length,
        score: a.result?.score ?? 0,
        maxScore: a.result?.maxScore ?? 0,
        accuracy: a.result?.accuracy ?? 0,
        correct: a.result?.correct ?? 0,
        incorrect: a.result?.incorrect ?? 0,
        unanswered: a.result?.unanswered ?? 0,
      })),
    };
  }

  async mocks(me: StudentPrincipal, examId: string) {
    const rows = await this.db
      .select()
      .from(prepAttempts)
      .where(and(eq(prepAttempts.studentId, me.id), eq(prepAttempts.examId, examId), eq(prepAttempts.mode, 'mock')))
      .orderBy(desc(prepAttempts.startedAt))
      .limit(50);
    return rows.map((a) => ({
      attemptId: a.id,
      title: a.title,
      status: a.status === 'in_progress' && this.expired(a) ? 'expired' : a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      remainingSec: a.status === 'in_progress' ? this.remaining(a) : null,
      questions: a.items.length,
      score: a.result?.score ?? null,
      maxScore: a.result?.maxScore ?? null,
      percentage: a.result?.percentage ?? null,
    }));
  }

  // ================================================================ helpers

  private async exam(examId: string): Promise<BankExam> {
    const e = (await this.bank.exams()).find((x) => x.id === examId);
    if (!e) throw new NotFoundException('Exam not found');
    return e;
  }

  private async load(studentId: string, id: string): Promise<AttemptRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Attempt not found');
    const [a] = await this.db.select().from(prepAttempts).where(and(eq(prepAttempts.id, id), eq(prepAttempts.studentId, studentId)));
    if (!a) throw new NotFoundException('Attempt not found');
    return a;
  }

  /** An unfinished attempt of this mode, closing it first if its time ran out. */
  private async openAttempt(studentId: string, examId: string, mode: AttemptRow['mode']) {
    const [a] = await this.db
      .select()
      .from(prepAttempts)
      .where(and(eq(prepAttempts.studentId, studentId), eq(prepAttempts.examId, examId), eq(prepAttempts.mode, mode), eq(prepAttempts.status, 'in_progress')))
      .orderBy(desc(prepAttempts.startedAt))
      .limit(1);
    if (!a) return null;
    if (this.expired(a)) {
      await this.finalize(a, undefined, true);
      return null;
    }
    return a;
  }

  private async names(examId: string) {
    const [subjects, chapters] = await Promise.all([this.bank.subjects(examId), this.bank.chapters(examId)]);
    return { subjects: new Map(subjects.map((s) => [s.id, s.name])), chapters: new Map(chapters.map((c) => [c.id, c.name])) };
  }

  /** Questions whose most recent answer was wrong. */
  private async wrongIds(studentId: string, examId: string): Promise<string[]> {
    const rows = await this.db.execute<{ question_id: string }>(sql`
      SELECT question_id FROM (
        SELECT DISTINCT ON (question_id) question_id, is_correct
        FROM ${prepAnswers}
        WHERE student_id = ${studentId} AND exam_id = ${examId}
        ORDER BY question_id, answered_at DESC
      ) latest WHERE is_correct = false`);
    return rows.rows.map((r) => r.question_id);
  }

  private async totals(studentId: string, examId: string) {
    const [t] = await this.db
      .select({
        attempted: count(),
        correct: sql<number>`count(*) filter (where ${prepAnswers.isCorrect})::int`,
        timeSec: sql<number>`coalesce(sum(${prepAnswers.timeSec}), 0)::int`,
      })
      .from(prepAnswers)
      .where(and(eq(prepAnswers.studentId, studentId), eq(prepAnswers.examId, examId)));
    const [{ n }] = await this.db.select({ n: count() }).from(prepAttempts).where(and(eq(prepAttempts.studentId, studentId), eq(prepAttempts.examId, examId), isNotNull(prepAttempts.submittedAt)));
    return { attempted: t.attempted, correct: t.correct, incorrect: t.attempted - t.correct, accuracy: pct(t.correct, t.attempted), timeSec: t.timeSec, testsTaken: n };
  }

  private async statsBy(studentId: string, examId: string, by: 'chapter' | 'subject') {
    const col = by === 'chapter' ? prepAnswers.chapterId : prepAnswers.subjectId;
    const rows = await this.db
      .select({ id: col, attempted: count(), correct: sql<number>`count(*) filter (where ${prepAnswers.isCorrect})::int` })
      .from(prepAnswers)
      .where(and(eq(prepAnswers.studentId, studentId), eq(prepAnswers.examId, examId)))
      .groupBy(col);
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async namedStats(studentId: string, examId: string, by: 'chapter' | 'subject') {
    const [stats, names] = await Promise.all([this.statsBy(studentId, examId, by), this.names(examId)]);
    const chapterSubject = by === 'chapter' ? new Map((await this.bank.chapters(examId)).map((c) => [c.id, names.subjects.get(c.subjectId) ?? ''])) : null;
    return [...stats.values()].map((s) => ({
      id: s.id,
      name: (by === 'chapter' ? names.chapters : names.subjects).get(s.id) ?? (by === 'chapter' ? 'Chapter' : 'Subject'),
      ...(chapterSubject ? { subject: chapterSubject.get(s.id) ?? '' } : {}),
      attempted: s.attempted,
      correct: s.correct,
      accuracy: pct(s.correct, s.attempted),
    }));
  }

  /** Questions answered per college-local day, oldest first, including empty days. */
  private async daily(studentId: string, examId: string, days: number) {
    const today = this.scope.clock.today();
    const from = CollegeClock.addDays(today, -(days - 1));
    const rows = await this.db.execute<{ day: string; attempted: number; correct: number }>(sql`
      SELECT to_char((answered_at AT TIME ZONE ${this.tz})::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS attempted, (count(*) FILTER (WHERE is_correct))::int AS correct
      FROM ${prepAnswers}
      WHERE student_id = ${studentId} AND exam_id = ${examId} AND (answered_at AT TIME ZONE ${this.tz})::date >= ${from}::date
      GROUP BY 1`);
    const byDay = new Map(rows.rows.map((r) => [r.day, r]));
    const out: { date: string; attempted: number; correct: number }[] = [];
    for (let d = from; d <= today; d = CollegeClock.addDays(d, 1)) out.push({ date: d, attempted: byDay.get(d)?.attempted ?? 0, correct: byDay.get(d)?.correct ?? 0 });
    return out;
  }

  /** Consecutive days with practice, ending today or yesterday. */
  private async streak(studentId: string, examId: string) {
    const rows = await this.db.execute<{ day: string }>(sql`
      SELECT DISTINCT to_char((answered_at AT TIME ZONE ${this.tz})::date, 'YYYY-MM-DD') AS day
      FROM ${prepAnswers} WHERE student_id = ${studentId} AND exam_id = ${examId}
      ORDER BY day DESC LIMIT 400`);
    const days = new Set(rows.rows.map((r) => r.day));
    const today = this.scope.clock.today();
    let d = days.has(today) ? today : CollegeClock.addDays(today, -1);
    let current = 0;
    while (days.has(d)) {
      current++;
      d = CollegeClock.addDays(d, -1);
    }
    // Longest run in the history we have
    const sorted = [...days].sort();
    let longest = 0;
    let run = 0;
    let prev: string | null = null;
    for (const day of sorted) {
      run = prev && CollegeClock.addDays(prev, 1) === day ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = day;
    }
    return { current, longest };
  }

  // ================================================================ staff: browse the bank

  status() {
    return { source: this.bank.source };
  }

  staffExams() {
    return this.bank.exams();
  }

  async staffSyllabus(examId: string) {
    const [subjects, chapters] = await Promise.all([this.bank.subjects(examId), this.bank.chapters(examId)]);
    return subjects.map((s) => ({ id: s.id, name: s.name, chapters: chapters.filter((c) => c.subjectId === s.id).map((c) => ({ id: c.id, name: c.name, classLevel: c.classLevel, questionCount: c.questionCount })) }));
  }

  /**
   * Random single-answer questions of one subject for a live test: from chosen chapters (and
   * topics), or the whole subject; optionally only Class 11 or Class 12 chapters.
   */
  async pick(dto: PickDto) {
    const exam = await this.exam(dto.examId);
    let chosen = (await this.bank.chapters(exam.id)).filter((c) => c.subjectId === dto.subjectId);
    if (dto.chapterIds?.length) {
      const wanted = new Set(dto.chapterIds);
      chosen = chosen.filter((c) => wanted.has(c.id));
    }
    if (dto.classLevel) chosen = chosen.filter((c) => c.classLevel === dto.classLevel);
    if (!chosen.length) throw new BadRequestException('No chapters of this subject match these choices');
    const topics = dto.topicIds?.length ? await this.bank.topicsByIds(dto.topicIds) : [];
    const parts = chosen.map((c) => {
      const t = topics.filter((x) => x.chapterId === c.id).map((x) => x.id);
      return t.length ? { chapterId: c.id, topicIds: t } : { chapterId: c.id };
    });
    const exclude = new Set(dto.exclude ?? []);
    const sampled = await this.bank.sample({ examId: exam.id, parts }, Math.min(400, Math.ceil(dto.count * 1.5) + 10 + exclude.size));
    const ids = sampled.filter((q) => q.type === 'mcq_single' && !exclude.has(q.id)).map((q) => q.id);
    const full = ids.length ? await this.bank.questions(ids) : [];
    const names = new Map((await this.bank.topicsByIds([...new Set(full.map((q) => q.topicId))])).map((t) => [t.id, t.name]));
    const items = full
      .map((q) => {
        const live = toLiveQuestion(q);
        return live && { ...live, topic: names.get(q.topicId) ?? null };
      })
      .filter((q): q is NonNullable<typeof q> => !!q)
      .slice(0, dto.count);
    return { items, wanted: dto.count };
  }

  /** Single-answer questions of a chapter, already in live-test format (four options, one correct). */
  async browse(chapterId: string, page = 1) {
    const pageSize = 25;
    const { items, total } = await this.bank.browse(chapterId, page, pageSize);
    return { total, page, pageSize, items: items.map(toLiveQuestion).filter((q): q is NonNullable<typeof q> => !!q) };
  }
}

/** GenPrep question → live-test question. Pictures are kept with {{IMG::...}} markers. */
export function toLiveQuestion(q: FullQuestion) {
  if (q.type !== 'mcq_single' || q.options.length < 2 || q.correctOptionIds.length !== 1) return null;
  const correctIndex = q.options.findIndex((o) => o.id === q.correctOptionIds[0]);
  if (correctIndex < 0) return null;
  const withImages = (text: string, images: string[]) => [text, ...images.map((u) => `{{IMG::${u}}}`)].filter(Boolean).join('\n');
  const options = q.options.map((o) => withImages(o.text, o.image ? [o.image] : []) || `Option ${o.id}`);
  if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) return null;
  return {
    bankQuestionId: q.id,
    text: withImages(q.text, q.images),
    options,
    correctIndex,
    marks: 1,
    topic: null as string | null,
    explanation: withImages(q.explanation.text, q.explanation.images) || null,
    difficulty: q.difficulty,
  };
}
