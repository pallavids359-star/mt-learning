import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or, SQL, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import type { StudentContext } from '../common/scope.service';
import { likePattern, pageOf } from '../common/dto/pagination.dto';
import { ScopeService } from '../common/scope.service';
import { loadEnv } from '../config/env';
import { DbOrTx, InjectDb, type Database } from '../db/db.module';
import { academicYears, classes, sections, staffUsers, students, subjects, tablets, teachingAssignments, testAttempts, testQuestions, tests, type AnswerMap, type ReviewStatus, type TestAudience } from '../db/schema';
import type { CreateTestDto, ProgressDto, QuestionDto, ReviewDto, StartTestDto, SubmitTestDto, TestQueryDto, UpdateTestDto } from './tests.dto';

type TestRow = typeof tests.$inferSelect;
type QuestionRow = typeof testQuestions.$inferSelect;
type AttemptRow = typeof testAttempts.$inferSelect;

export type TestState = 'draft' | 'upcoming' | 'open' | 'closed';

export function testState(t: Pick<TestRow, 'publishedAt' | 'opensAt' | 'closesAt'>, now = new Date()): TestState {
  if (!t.publishedAt) return 'draft';
  if (now < t.opensAt) return 'upcoming';
  if (now <= t.closesAt) return 'open';
  return 'closed';
}

/** Whether an attempt's score counts (auto-accepted or accepted on review). */
const counts = (r: ReviewStatus) => r === 'NONE' || r === 'ACCEPTED';

export function grade(questions: QuestionRow[], answers: AnswerMap, negativeMarks: number) {
  let score = 0;
  let max = 0;
  let correct = 0;
  for (const q of questions) {
    max += q.marks;
    const a = answers[q.id];
    if (a === null || a === undefined) continue;
    if (a === q.correctIndex) {
      score += q.marks;
      correct++;
    } else {
      score -= negativeMarks;
    }
  }
  return { score: Math.round(score * 100) / 100, maxScore: max, correctCount: correct };
}

/** When an attempt must be finished: the time limit or the closing time, whichever is first, plus any extra time from staff. */
export function attemptDeadline(t: Pick<TestRow, 'durationMin' | 'closesAt'>, a: Pick<AttemptRow, 'startedAt' | 'extraSec'>): Date {
  return new Date(Math.min(a.startedAt.getTime() + t.durationMin * 60_000, t.closesAt.getTime()) + a.extraSec * 1000);
}

/** A tablet that reported within this time counts as active in the live monitor. */
export const ACTIVE_WINDOW_MS = 60_000;

/** Exams a test can be set for: the subjects (in paper order) and the usual marking. */
export const EXAM_TESTS: Record<string, { subjects: string[]; negativeMarks: number; minutes: number }> = {
  NEET: { subjects: ['Physics', 'Chemistry', 'Biology'], negativeMarks: 1, minutes: 180 },
  JEE: { subjects: ['Physics', 'Chemistry', 'Mathematics'], negativeMarks: 1, minutes: 180 },
  KCET: { subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'], negativeMarks: 0, minutes: 240 },
};

export const AUDIENCE_LABEL: Record<TestAudience, string> = { PUC_1: 'Class 11', PUC_2: 'Class 12', BOTH: 'Class 11 and 12' };

/** Classes (joined as `classes`) whose students write the test. Exam tests: every class of that year in the current academic year. */
function classesOf(t: Pick<TestRow, 'classId' | 'audience'>): SQL {
  if (!t.audience) return eq(classes.id, t.classId!);
  const current = sql`${classes.academicYearId} = (select ${academicYears.id} from ${academicYears} where ${academicYears.isCurrent} limit 1)`;
  return t.audience === 'BOTH' ? current : and(current, eq(classes.pucYear, t.audience))!;
}

/** Tests (the `tests` table) a student may see. */
function testsFor(ctx: Pick<StudentContext, 'classId' | 'pucYear'>): SQL {
  return or(eq(tests.classId, ctx.classId), and(isNotNull(tests.audience), or(eq(tests.audience, 'BOTH'), eq(tests.audience, ctx.pucYear))))!;
}

/** "Class 12 · NEET" / "Physics, Chemistry, Biology" for exam tests; the class and subject for older ones. */
function labels(t: TestRow, cls?: { name: string | null } | null, sub?: { code: string | null; name: string | null } | null) {
  if (t.audience) return { className: `${AUDIENCE_LABEL[t.audience]} · ${t.examCode}`, subjectCode: t.examCode ?? '', subjectName: (t.subjectNames ?? []).join(', ') };
  return { className: cls?.name ?? '', subjectCode: sub?.code ?? '', subjectName: sub?.name ?? '' };
}

const pct = (score: number | null, max: number | null) => (score === null || !max ? null : Math.round((score / max) * 1000) / 10);

@Injectable()
export class TestsService {
  private readonly env = loadEnv();
  private readonly pkgKey = createHmac('sha256', this.env.JWT_ACCESS_SECRET).update('mt-test-package-v1').digest();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // =========================================================== staff: authoring

  async list(q: TestQueryDto) {
    const now = new Date();
    const where: SQL[] = [];
    if (q.classId) {
      where.push(
        or(
          eq(tests.classId, q.classId),
          and(isNotNull(tests.audience), sql`(${tests.audience} = 'BOTH' or ${tests.audience} = (select ${classes.pucYear}::text from ${classes} where ${classes.id} = ${q.classId}))`),
        )!,
      );
    }
    if (q.subjectId) where.push(eq(tests.subjectId, q.subjectId));
    if (q.search) where.push(sql`${tests.title} ilike ${likePattern(q.search)}`);
    if (q.status === 'draft') where.push(isNull(tests.publishedAt));
    if (q.status === 'upcoming') where.push(and(isNotNull(tests.publishedAt), gt(tests.opensAt, now))!);
    if (q.status === 'open') where.push(and(isNotNull(tests.publishedAt), lte(tests.opensAt, now), sql`${tests.closesAt} >= ${now}`)!);
    if (q.status === 'closed') where.push(and(isNotNull(tests.publishedAt), sql`${tests.closesAt} < ${now}`)!);
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          test: tests,
          className: classes.name,
          subjectCode: subjects.code,
          subjectName: subjects.name,
          createdByName: staffUsers.fullName,
          questionCount: sql<number>`(select count(*)::int from ${testQuestions} q where q.test_id = ${tests.id})`,
          submittedCount: sql<number>`(select count(*)::int from ${testAttempts} a where a.test_id = ${tests.id} and a.submitted_at is not null)`,
          pendingReviewCount: sql<number>`(select count(*)::int from ${testAttempts} a where a.test_id = ${tests.id} and a.review_status = 'PENDING')`,
          averagePercent: sql<number | null>`(select round(avg(a.score / nullif(a.max_score, 0)) * 1000) / 10 from ${testAttempts} a where a.test_id = ${tests.id} and a.submitted_at is not null and a.review_status in ('NONE','ACCEPTED'))`,
          studentCount: sql<number>`(select count(*)::int from ${students} s join ${sections} sec on sec.id = s.section_id join ${classes} c on c.id = sec.class_id
            where s.status = 'ACTIVE' and (c.id = ${tests.classId} or (${tests.audience} is not null
              and c.academic_year_id = (select ay.id from ${academicYears} ay where ay.is_current limit 1)
              and (${tests.audience} = 'BOTH' or c.puc_year::text = ${tests.audience}))))`,
        })
        .from(tests)
        .leftJoin(classes, eq(classes.id, tests.classId))
        .leftJoin(subjects, eq(subjects.id, tests.subjectId))
        .leftJoin(staffUsers, eq(staffUsers.id, tests.createdBy))
        .where(cond)
        .orderBy(desc(tests.opensAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(tests).where(cond),
    ]);
    return pageOf(
      rows.map(({ test, className, subjectCode, subjectName, ...rest }) => ({
        ...this.testView(test),
        ...rest,
        ...labels(test, { name: className }, { code: subjectCode, name: subjectName }),
        state: testState(test, now),
      })),
      total,
      q,
    );
  }

  async get(id: string) {
    const t = await this.load(id);
    const [cls] = t.classId ? await this.db.select({ name: classes.name }).from(classes).where(eq(classes.id, t.classId)) : [];
    const [sub] = t.subjectId ? await this.db.select({ code: subjects.code, name: subjects.name }).from(subjects).where(eq(subjects.id, t.subjectId)) : [];
    const questions = await this.questions(id);
    const [{ n }] = await this.db.select({ n: count() }).from(testAttempts).where(eq(testAttempts.testId, id));
    return {
      ...this.testView(t),
      state: testState(t),
      ...labels(t, cls, sub),
      attemptCount: n,
      questions: questions.map((q) => ({ id: q.id, position: q.position, text: q.text, options: q.options, correctIndex: q.correctIndex, marks: q.marks, topic: q.topic, explanation: q.explanation, bankQuestionId: q.bankQuestionId, subject: q.subject })),
    };
  }

  async create(actor: StaffPrincipal, dto: CreateTestDto, meta: RequestMeta) {
    const target = this.targetOf(dto);
    await this.assertAuthor(actor, { classId: target.classId, subjectId: target.subjectId, audience: target.audience });
    this.checkWindow(new Date(dto.opensAt), new Date(dto.closesAt), dto.durationMin);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tests)
        .values({
          ...target,
          title: dto.title,
          instructions: dto.instructions ?? null,
          durationMin: dto.durationMin,
          opensAt: new Date(dto.opensAt),
          closesAt: new Date(dto.closesAt),
          allowOffline: dto.allowOffline ?? false,
          negativeMarks: dto.negativeMarks ?? (target.examCode ? EXAM_TESTS[target.examCode].negativeMarks : 0),
          instantResults: dto.instantResults ?? true,
          createdBy: actor.id,
        })
        .returning({ id: tests.id });
      if (dto.questions?.length) await this.writeQuestions(tx, row.id, dto.questions);
      await this.audit.record(actor, { action: 'test.create', entityType: 'test', entityId: row.id, metadata: { title: dto.title, exam: target.examCode, audience: target.audience } }, meta, tx);
      return row.id;
    });
    return this.get(id);
  }

  /** Either an exam test (audience + exam) or an older single class and subject test. */
  private targetOf(dto: CreateTestDto) {
    if (dto.audience || dto.examCode) {
      if (!dto.audience || !dto.examCode || !EXAM_TESTS[dto.examCode]) throw new BadRequestException('Choose the class (11, 12 or both) and the exam (NEET, JEE or KCET)');
      return { classId: null, subjectId: null, audience: dto.audience, examCode: dto.examCode, subjectNames: EXAM_TESTS[dto.examCode].subjects };
    }
    if (!dto.classId || !dto.subjectId) throw new BadRequestException('Choose the class and the exam');
    return { classId: dto.classId, subjectId: dto.subjectId, audience: null, examCode: null, subjectNames: null };
  }

  /** Teachers may only set tests for what they teach: their class and subject, or (exam tests) a class in that year. */
  private async assertAuthor(actor: StaffPrincipal, t: Pick<TestRow, 'classId' | 'subjectId' | 'audience'>) {
    if (actor.role !== 'TEACHER') return;
    if (!t.audience) return this.scope.assertTeaches(actor, t.classId!, t.subjectId!);
    const [row] = await this.db
      .select({ c: teachingAssignments.classId })
      .from(teachingAssignments)
      .innerJoin(classes, eq(classes.id, teachingAssignments.classId))
      .where(and(eq(teachingAssignments.teacherId, actor.id), classesOf(t)))
      .limit(1);
    if (!row) throw new ForbiddenException('You do not teach any class in this year');
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateTestDto, meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    const attempts = await this.attemptCount(id);
    if (attempts > 0) {
      // Once students have started, only the wording and a later closing time may change.
      const allowed = ['title', 'instructions', 'closesAt'];
      const changed = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined);
      const blocked = changed.filter((k) => !allowed.includes(k));
      if (blocked.length) throw new ConflictException(`Students have already taken this test, so ${blocked.join(', ')} can no longer change`);
      if (dto.closesAt && new Date(dto.closesAt) < t.closesAt) throw new ConflictException('The closing time can only be extended once students have started');
    }
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : t.opensAt;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : t.closesAt;
    this.checkWindow(opensAt, closesAt, dto.durationMin ?? t.durationMin);
    await this.db.transaction(async (tx) => {
      await tx
        .update(tests)
        .set({
          ...dto,
          opensAt,
          closesAt,
        })
        .where(eq(tests.id, id));
      await this.audit.record(actor, { action: 'test.update', entityType: 'test', entityId: id, metadata: { fields: Object.keys(dto) } }, meta, tx);
    });
    return this.get(id);
  }

  async setQuestions(actor: StaffPrincipal, id: string, questions: QuestionDto[], meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    if ((await this.attemptCount(id)) > 0) throw new ConflictException('Questions cannot change after students have started the test');
    await this.db.transaction(async (tx) => {
      await tx.delete(testQuestions).where(eq(testQuestions.testId, id));
      await this.writeQuestions(tx, id, questions);
      await this.audit.record(actor, { action: 'test.questions', entityType: 'test', entityId: id, metadata: { count: questions.length } }, meta, tx);
    });
    return this.get(id);
  }

  async publish(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    const qs = await this.questions(id);
    if (!qs.length) throw new BadRequestException('Add at least one question before publishing');
    if (t.closesAt <= new Date()) throw new BadRequestException('The closing time has already passed');
    await this.db.transaction(async (tx) => {
      await tx.update(tests).set({ publishedAt: t.publishedAt ?? new Date() }).where(eq(tests.id, id));
      await this.audit.record(actor, { action: 'test.publish', entityType: 'test', entityId: id, metadata: { title: t.title } }, meta, tx);
    });
    return this.get(id);
  }

  async unpublish(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    if ((await this.attemptCount(id)) > 0) throw new ConflictException('Students have already taken this test; it cannot be withdrawn');
    await this.db.transaction(async (tx) => {
      await tx.update(tests).set({ publishedAt: null }).where(eq(tests.id, id));
      await this.audit.record(actor, { action: 'test.unpublish', entityType: 'test', entityId: id }, meta, tx);
    });
    return this.get(id);
  }

  async remove(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    if ((await this.attemptCount(id)) > 0) throw new ConflictException('Tests that students have taken cannot be deleted');
    await this.db.transaction(async (tx) => {
      await tx.delete(tests).where(eq(tests.id, id));
      await this.audit.record(actor, { action: 'test.delete', entityType: 'test', entityId: id, metadata: { title: t.title } }, meta, tx);
    });
  }

  // =========================================================== staff: results & review

  async results(id: string) {
    const t = await this.load(id);
    const qs = await this.questions(id);
    const rows = await this.db
      .select({
        attempt: testAttempts,
        studentCode: students.studentCode,
        studentName: students.fullName,
        sectionName: sections.name,
      })
      .from(testAttempts)
      .innerJoin(students, eq(students.id, testAttempts.studentId))
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .where(eq(testAttempts.testId, id))
      .orderBy(desc(testAttempts.score));
    const [{ eligible }] = await this.db
      .select({ eligible: count() })
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(and(classesOf(t), eq(students.status, 'ACTIVE')));

    const submitted = rows.filter((r) => r.attempt.submittedAt);
    const counted = submitted.filter((r) => counts(r.attempt.reviewStatus));
    const percents = counted.map((r) => pct(r.attempt.score, r.attempt.maxScore) ?? 0);
    const durations = submitted
      .filter((r) => r.attempt.mode === 'ONLINE')
      .map((r) => (r.attempt.submittedAt!.getTime() - r.attempt.startedAt.getTime()) / 1000)
      .sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;

    const perQuestion = qs.map((q) => {
      const answered = counted.filter((r) => r.attempt.answers?.[q.id] !== null && r.attempt.answers?.[q.id] !== undefined);
      const right = counted.filter((r) => r.attempt.answers?.[q.id] === q.correctIndex).length;
      const optionCounts = q.options.map((_, i) => counted.filter((r) => r.attempt.answers?.[q.id] === i).length);
      return {
        questionId: q.id,
        position: q.position,
        text: q.text,
        topic: q.topic,
        correctIndex: q.correctIndex,
        answered: answered.length,
        correct: right,
        correctPercent: counted.length ? Math.round((right / counted.length) * 1000) / 10 : null,
        optionCounts,
      };
    });

    return {
      test: { ...this.testView(t), state: testState(t), questionCount: qs.length },
      summary: {
        eligible,
        started: rows.length,
        submitted: submitted.length,
        counted: counted.length,
        pendingReview: rows.filter((r) => r.attempt.reviewStatus === 'PENDING').length,
        averagePercent: percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null,
        highestPercent: percents.length ? Math.max(...percents) : null,
        medianSeconds: median === null ? null : Math.round(median),
      },
      perQuestion,
      attempts: rows.map((r) => ({
        id: r.attempt.id,
        studentId: r.attempt.studentId,
        studentCode: r.studentCode,
        studentName: r.studentName,
        sectionName: r.sectionName,
        mode: r.attempt.mode,
        startedAt: r.attempt.startedAt,
        submittedAt: r.attempt.submittedAt,
        clientSubmittedAt: r.attempt.clientSubmittedAt,
        elapsedSec: r.attempt.elapsedSec,
        score: r.attempt.score,
        maxScore: r.attempt.maxScore,
        percent: pct(r.attempt.score, r.attempt.maxScore),
        correctCount: r.attempt.correctCount,
        reviewStatus: r.attempt.reviewStatus,
        reviewReason: r.attempt.reviewReason,
      })),
    };
  }

  /** One row per student of a class (or one section), one column per live test, highest total first. */
  async marksSheet(classId: string, sectionId?: string) {
    const [cls] = await this.db.select().from(classes).where(eq(classes.id, classId));
    if (!cls) throw new NotFoundException('Class not found');
    if (sectionId) {
      const [sec] = await this.db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.classId, classId)));
      if (!sec) throw new NotFoundException('Section not found in this class');
    }
    const list = (
      await this.db
        .select({ test: tests, subjectName: subjects.name, maxScore: sql<number>`(select coalesce(sum(q.marks), 0)::float from ${testQuestions} q where q.test_id = ${tests.id})` })
        .from(tests)
        .leftJoin(subjects, eq(subjects.id, tests.subjectId))
        .where(and(testsFor({ classId, pucYear: cls.pucYear }), isNotNull(tests.publishedAt), lte(tests.opensAt, new Date())))
        .orderBy(asc(tests.opensAt))
    ).map((r) => ({ ...r, subjectName: labels(r.test, null, { code: null, name: r.subjectName }).subjectName }));
    const people = await this.db
      .select({ id: students.id, code: students.studentCode, name: students.fullName, roll: students.rollNumber, section: sections.name })
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .where(and(eq(sections.classId, classId), eq(students.status, 'ACTIVE'), sectionId ? eq(students.sectionId, sectionId) : undefined))
      .orderBy(asc(sections.name), asc(students.fullName));
    const ids = list.map((t) => t.test.id);
    const attempts = ids.length
      ? await this.db
          .select({ testId: testAttempts.testId, studentId: testAttempts.studentId, score: testAttempts.score, review: testAttempts.reviewStatus, submittedAt: testAttempts.submittedAt })
          .from(testAttempts)
          .where(inArray(testAttempts.testId, ids))
      : [];
    const scoreOf = new Map<string, number>();
    for (const a of attempts) if (a.submittedAt && a.score !== null && counts(a.review)) scoreOf.set(`${a.studentId}:${a.testId}`, a.score);

    const rows = people.map((p) => {
      const marks: Record<string, number | null> = {};
      let total = 0;
      let outOf = 0;
      let taken = 0;
      for (const t of list) {
        const v = scoreOf.get(`${p.id}:${t.test.id}`);
        marks[t.test.id] = v ?? null;
        if (v !== undefined) {
          total += v;
          outOf += t.maxScore;
          taken++;
        }
      }
      return {
        studentId: p.id,
        studentCode: p.code,
        studentName: p.name,
        rollNumber: p.roll,
        sectionName: p.section,
        marks,
        testsTaken: taken,
        total: Math.round(total * 100) / 100,
        outOf,
        percent: outOf ? Math.round((total / outOf) * 1000) / 10 : null,
        rank: null as number | null,
      };
    });
    // Highest percentage first; students who took no test go last, unranked.
    rows.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.studentName.localeCompare(b.studentName));
    let rank = 0;
    let prev: number | null = null;
    rows.forEach((r, i) => {
      if (r.percent === null) return;
      if (r.percent !== prev) rank = i + 1;
      prev = r.percent;
      r.rank = rank;
    });
    return {
      className: cls.name,
      tests: list.map((t) => ({ id: t.test.id, title: t.test.title, subjectName: t.subjectName, opensAt: t.test.opensAt, maxScore: t.maxScore })),
      students: rows,
    };
  }

  async pendingReviews() {
    return this.db
      .select({
        attemptId: testAttempts.id,
        testId: tests.id,
        testTitle: tests.title,
        studentName: students.fullName,
        studentCode: students.studentCode,
        mode: testAttempts.mode,
        clientSubmittedAt: testAttempts.clientSubmittedAt,
        submittedAt: testAttempts.submittedAt,
        reviewReason: testAttempts.reviewReason,
        score: testAttempts.score,
        maxScore: testAttempts.maxScore,
      })
      .from(testAttempts)
      .innerJoin(tests, eq(tests.id, testAttempts.testId))
      .innerJoin(students, eq(students.id, testAttempts.studentId))
      .where(eq(testAttempts.reviewStatus, 'PENDING'))
      .orderBy(asc(testAttempts.submittedAt))
      .limit(200);
  }

  async review(actor: StaffPrincipal, testId: string, attemptId: string, dto: ReviewDto, meta: RequestMeta) {
    const t = await this.load(testId);
    await this.assertAuthor(actor, t);
    const [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.id, attemptId), eq(testAttempts.testId, testId)));
    if (!a) throw new NotFoundException('Attempt not found');
    if (!a.submittedAt) throw new ConflictException('This attempt has not been submitted');
    await this.db.transaction(async (tx) => {
      await tx
        .update(testAttempts)
        .set({ reviewStatus: dto.decision, reviewReason: dto.note ?? a.reviewReason, reviewedBy: actor.id, reviewedAt: new Date() })
        .where(eq(testAttempts.id, attemptId));
      await this.audit.record(
        actor,
        { action: 'test.review', entityType: 'test', entityId: testId, metadata: { attemptId, studentId: a.studentId, from: a.reviewStatus, to: dto.decision, note: dto.note ?? null } },
        meta,
        tx,
      );
    });
    return this.results(testId);
  }

  async releaseResults(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const t = await this.load(id);
    await this.assertAuthor(actor, t);
    if (!t.publishedAt) throw new BadRequestException('Publish the test first');
    await this.db.transaction(async (tx) => {
      await tx.update(tests).set({ resultsReleasedAt: t.resultsReleasedAt ?? new Date() }).where(eq(tests.id, id));
      await this.audit.record(actor, { action: 'test.release_results', entityType: 'test', entityId: id, metadata: { title: t.title } }, meta, tx);
    });
    return this.get(id);
  }

  // =========================================================== student

  async studentList(studentId: string) {
    const ctx = await this.scope.student(studentId);
    const now = new Date();
    const rows = await this.db
      .select({
        test: tests,
        subjectCode: subjects.code,
        subjectName: subjects.name,
        questionCount: sql<number>`(select count(*)::int from ${testQuestions} q where q.test_id = ${tests.id})`,
        attempt: testAttempts,
      })
      .from(tests)
      .leftJoin(subjects, eq(subjects.id, tests.subjectId))
      .leftJoin(testAttempts, and(eq(testAttempts.testId, tests.id), eq(testAttempts.studentId, studentId)))
      .where(and(testsFor(ctx), isNotNull(tests.publishedAt)))
      .orderBy(asc(tests.closesAt));
    return rows.map((r) => {
      const l = labels(r.test, null, { code: r.subjectCode, name: r.subjectName });
      return this.studentTestView(r.test, r.attempt, { subjectCode: l.subjectCode, subjectName: l.subjectName, questionCount: r.questionCount }, now);
    });
  }

  /** Starts (or resumes) an online attempt and returns the paper without answers. */
  async start(student: StudentPrincipal, id: string, dto: StartTestDto) {
    const t = await this.studentTest(student.id, id);
    const state = testState(t);
    let [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, student.id)));
    if (a?.submittedAt) throw new ConflictException('You have already submitted this test');
    // A test that has closed can still be continued when staff revived this student's attempt.
    const revivedOpen = !!a?.revivedAt && attemptDeadline(t, a) > new Date();
    if (state !== 'open' && !revivedOpen) throw new ConflictException(state === 'upcoming' ? 'This test has not opened yet' : 'This test has closed');
    if (!a) {
      [a] = await this.db
        .insert(testAttempts)
        .values({ testId: id, studentId: student.id, mode: 'ONLINE', startedAt: new Date(), deviceSerial: dto.deviceSerial ?? null })
        .onConflictDoNothing()
        .returning();
      // A concurrent start from the same student won the race; use that attempt.
      if (!a) [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, student.id)));
    }
    [a] = await this.db
      .update(testAttempts)
      .set({ lastSeenAt: new Date(), ...(dto.deviceSerial ? { deviceSerial: dto.deviceSerial } : {}) })
      .where(eq(testAttempts.id, a.id))
      .returning();
    return {
      attemptId: a.id,
      startedAt: a.startedAt,
      deadline: attemptDeadline(t, a),
      serverTime: new Date(),
      paper: await this.paper(t),
      // Saved progress, so a student can carry on from where they stopped (also on another tablet).
      answers: a.answers ?? {},
      currentQuestion: a.currentQuestion ?? 1,
    };
  }

  /** Signed offline package: the paper without answers, valid for this student and test only. */
  async offlinePackage(student: StudentPrincipal, id: string) {
    const t = await this.studentTest(student.id, id);
    if (!t.allowOffline) throw new ForbiddenException('This test can only be taken online');
    const state = testState(t);
    if (state === 'closed') throw new ConflictException('This test has closed');
    const [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, student.id)));
    if (a?.submittedAt) throw new ConflictException('You have already submitted this test');
    const issuedAt = new Date();
    const token = this.signPackage({ t: id, s: student.id, i: issuedAt.getTime() });
    await this.audit.record(student, { action: 'test.package_download', entityType: 'test', entityId: id });
    return { packageToken: token, issuedAt, serverTime: issuedAt, paper: await this.paper(t) };
  }

  async submit(student: StudentPrincipal, id: string, dto: SubmitTestDto, meta: RequestMeta) {
    const t = await this.studentTest(student.id, id);
    const qs = await this.questions(id);
    const answers = this.cleanAnswers(qs, dto.answers);
    const now = new Date();
    const graceMs = this.env.TEST_GRACE_MINUTES * 60_000;
    const [existing] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, student.id)));

    // Retried upload of an attempt the server already has (e.g. the reply was lost on bad Wi-Fi).
    if (existing?.submittedAt) {
      const same = Object.keys(answers).every((k) => (existing.answers?.[k] ?? null) === answers[k]);
      if (same) return this.submitResult(t, existing);
      throw new ConflictException('You have already submitted this test');
    }

    let mode: 'ONLINE' | 'OFFLINE' = dto.mode;
    let startedAt: Date;
    const reasons: string[] = [];
    if (dto.mode === 'ONLINE') {
      if (!existing) throw new BadRequestException('Start the test before submitting it');
      startedAt = existing.startedAt;
      const deadline = attemptDeadline(t, existing).getTime();
      if (now.getTime() > deadline + graceMs) reasons.push('Submitted after the time limit');
    } else {
      if (!t.allowOffline) throw new ForbiddenException('This test can only be taken online');
      if (!dto.packageToken || !this.verifyPackage(dto.packageToken, id, student.id)) {
        throw new ForbiddenException('The offline test package is not valid. Download the test again while online.');
      }
      if (existing) mode = existing.mode; // a started online attempt finished offline keeps its server start time
      startedAt = existing?.startedAt ?? (dto.clientStartedAt ? new Date(dto.clientStartedAt) : now);
      if (now.getTime() > t.closesAt.getTime() + (existing?.extraSec ?? 0) * 1000 + graceMs) {
        reasons.push(`Uploaded after the test closed${dto.clientSubmittedAt ? ` (tablet says answered at ${dto.clientSubmittedAt})` : ''}`);
      }
      if (dto.elapsedSec !== undefined && dto.elapsedSec > t.durationMin * 60 + graceMs / 1000) {
        reasons.push(`Took ${Math.round(dto.elapsedSec / 60)} min on the tablet; the limit is ${t.durationMin} min`);
      }
      if (now < t.opensAt) reasons.push('Submitted before the test opened');
    }

    const g = grade(qs, answers, t.negativeMarks);
    const values = {
      mode,
      startedAt,
      submittedAt: now,
      clientStartedAt: dto.clientStartedAt ? new Date(dto.clientStartedAt) : null,
      clientSubmittedAt: dto.clientSubmittedAt ? new Date(dto.clientSubmittedAt) : null,
      elapsedSec: dto.elapsedSec ?? (mode === 'ONLINE' ? Math.round((now.getTime() - startedAt.getTime()) / 1000) : null),
      deviceSerial: dto.deviceSerial ?? existing?.deviceSerial ?? null,
      answers,
      lastSeenAt: now,
      ...g,
      reviewStatus: (reasons.length ? 'PENDING' : 'NONE') as ReviewStatus,
      reviewReason: reasons.length ? reasons.join('; ') : null,
    };
    const saved = await this.db.transaction(async (tx) => {
      let row: AttemptRow | undefined;
      if (existing) {
        [row] = await tx.update(testAttempts).set(values).where(and(eq(testAttempts.id, existing.id), isNull(testAttempts.submittedAt))).returning();
      } else {
        [row] = await tx.insert(testAttempts).values({ testId: id, studentId: student.id, ...values }).onConflictDoNothing().returning();
      }
      if (!row) throw new ConflictException('You have already submitted this test');
      await this.audit.record(
        student,
        { action: 'test.submit', entityType: 'test', entityId: id, metadata: { mode, score: g.score, maxScore: g.maxScore, review: values.reviewStatus } },
        meta,
        tx,
      );
      return row;
    });
    return this.submitResult(t, saved);
  }

  /** Answer review: only after the test closes (so answers cannot leak to classmates) and once results are visible. */
  async studentReview(studentId: string, id: string) {
    const t = await this.studentTest(studentId, id);
    const [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, studentId)));
    if (!a?.submittedAt) throw new NotFoundException('You have not submitted this test');
    if (!this.scoreVisible(t, a)) throw new ForbiddenException('Results for this test are not available yet');
    if (testState(t) !== 'closed' && !t.resultsReleasedAt) throw new ForbiddenException('Answers are shown after the test closes');
    const qs = await this.questions(id);
    return {
      test: { id: t.id, title: t.title },
      score: a.score,
      maxScore: a.maxScore,
      percent: pct(a.score, a.maxScore),
      questions: qs.map((q) => ({
        id: q.id,
        position: q.position,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        yourAnswer: a.answers?.[q.id] ?? null,
        marks: q.marks,
        topic: q.topic,
        explanation: q.explanation,
      })),
    };
  }

  /** Score history, subject averages and topics to revise for the student app. */
  async studentResults(studentId: string) {
    const ctx = await this.scope.student(studentId);
    const rows = await this.db
      .select({ test: tests, attempt: testAttempts, subjectCode: subjects.code, subjectName: subjects.name })
      .from(testAttempts)
      .innerJoin(tests, eq(tests.id, testAttempts.testId))
      .leftJoin(subjects, eq(subjects.id, tests.subjectId))
      .where(and(eq(testAttempts.studentId, studentId), isNotNull(testAttempts.submittedAt), testsFor(ctx)))
      .orderBy(asc(testAttempts.submittedAt));
    const visible = rows.filter((r) => this.scoreVisible(r.test, r.attempt));
    const history = visible.map((r) => ({
      testId: r.test.id,
      title: r.test.title,
      ...(({ subjectCode, subjectName }) => ({ subjectCode, subjectName }))(labels(r.test, null, { code: r.subjectCode, name: r.subjectName })),
      submittedAt: r.attempt.submittedAt,
      score: r.attempt.score,
      maxScore: r.attempt.maxScore,
      percent: pct(r.attempt.score, r.attempt.maxScore),
    }));
    const bySubject = new Map<string, { code: string; name: string; total: number; n: number }>();
    for (const h of history) {
      const s = bySubject.get(h.subjectCode) ?? { code: h.subjectCode, name: h.subjectName, total: 0, n: 0 };
      s.total += h.percent ?? 0;
      s.n++;
      bySubject.set(h.subjectCode, s);
    }
    // Topics answered wrong, only from tests that have closed (so this never reveals a live test's answers).
    const closedIds = visible.filter((r) => testState(r.test) === 'closed' || r.test.resultsReleasedAt).map((r) => r.test.id);
    const weak: { subjectCode: string; topic: string; wrong: number; asked: number }[] = [];
    if (closedIds.length) {
      const qs = await this.db.select().from(testQuestions).where(and(inArray(testQuestions.testId, closedIds), isNotNull(testQuestions.topic)));
      const byTopic = new Map<string, { subjectCode: string; topic: string; wrong: number; asked: number }>();
      for (const q of qs) {
        const r = visible.find((v) => v.test.id === q.testId)!;
        // Exam tests: the question's own subject (PHY, CHE…), so topics to revise are per subject.
        const code = q.subject ? q.subject.slice(0, 3).toUpperCase() : (r.subjectCode ?? '');
        const key = `${code}|${q.topic}`;
        const e = byTopic.get(key) ?? { subjectCode: code, topic: q.topic!, wrong: 0, asked: 0 };
        e.asked++;
        if (r.attempt.answers?.[q.id] !== q.correctIndex) e.wrong++;
        byTopic.set(key, e);
      }
      weak.push(...[...byTopic.values()].filter((e) => e.wrong >= 1 && e.wrong / e.asked >= 0.4).sort((a, b) => b.wrong / b.asked - a.wrong / a.asked).slice(0, 8));
    }
    const all = history.map((h) => h.percent ?? 0);
    return {
      averagePercent: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null,
      testsTaken: rows.length,
      awaitingReview: rows.filter((r) => r.attempt.reviewStatus === 'PENDING').length,
      history,
      subjects: [...bySubject.values()].map((s) => ({ subjectCode: s.code, subjectName: s.name, averagePercent: Math.round((s.total / s.n) * 10) / 10, tests: s.n })),
      topicsToRevise: weak,
    };
  }

  // =========================================================== internals

  // =========================================================== live monitor

  /** The tablet's regular report while a student takes the test. Also tells the tablet about staff actions. */
  async progress(student: StudentPrincipal, id: string, dto: ProgressDto) {
    const t = await this.studentTest(student.id, id);
    const [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.testId, id), eq(testAttempts.studentId, student.id)));
    const serverTime = new Date();
    // Staff gave this student a new start: the tablet throws its copy away.
    if (!a || a.id !== dto.attemptId) return { status: 'reset' as const, serverTime };
    if (a.submittedAt) return { status: 'submitted' as const, byStaff: !!a.forcedBy, serverTime, outcome: this.submitResult(t, a) };
    const qs = await this.questions(id);
    const known = new Set(qs.map((q) => q.id));
    const answers = this.cleanAnswers(qs, Object.fromEntries(Object.entries(dto.answers).filter(([k]) => known.has(k))));
    const [row] = await this.db
      .update(testAttempts)
      .set({
        answers,
        currentQuestion: Math.min(dto.currentQuestion, Math.max(qs.length, 1)),
        skippedCount: dto.skipped ?? null,
        batteryPercent: dto.battery ?? null,
        charging: dto.charging ?? null,
        lastSeenAt: serverTime,
      })
      .where(and(eq(testAttempts.id, a.id), isNull(testAttempts.submittedAt)))
      .returning();
    if (!row) return { status: 'submitted' as const, byStaff: true, serverTime, outcome: null };
    return { status: 'ok' as const, serverTime, deadline: attemptDeadline(t, row) };
  }

  /** Who is taking the test right now: one row per student in the class, plus counts. */
  async monitor(id: string) {
    const t = await this.load(id);
    const [{ n: questionCount }] = await this.db.select({ n: count() }).from(testQuestions).where(eq(testQuestions.testId, id));
    const rows = await this.db
      .select({
        studentId: students.id,
        studentCode: students.studentCode,
        studentName: students.fullName,
        rollNumber: students.rollNumber,
        sectionName: sections.name,
        tabletSerial: tablets.serialNumber,
        tabletTag: tablets.assetTag,
        attempt: testAttempts,
      })
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(tablets, eq(tablets.studentId, students.id))
      .leftJoin(testAttempts, and(eq(testAttempts.testId, id), eq(testAttempts.studentId, students.id)))
      .where(and(classesOf(t), eq(students.status, 'ACTIVE')))
      .orderBy(asc(classes.name), asc(sections.name), asc(students.fullName));

    const now = new Date();
    const list = rows.map((r) => {
      const a = r.attempt;
      const answered = a?.answers ? Object.values(a.answers).filter((v) => v !== null && v !== undefined).length : 0;
      const deadline = a ? attemptDeadline(t, a) : null;
      const seen = a ? (a.lastSeenAt ?? a.startedAt) : null;
      const status: 'not_started' | 'active' | 'inactive' | 'time_over' | 'submitted' = !a
        ? 'not_started'
        : a.submittedAt
          ? 'submitted'
          : deadline! <= now
            ? 'time_over'
            : now.getTime() - seen!.getTime() <= ACTIVE_WINDOW_MS
              ? 'active'
              : 'inactive';
      return {
        studentId: r.studentId,
        studentCode: r.studentCode,
        studentName: r.studentName,
        rollNumber: r.rollNumber,
        sectionName: r.sectionName,
        tablet: r.tabletTag ?? r.tabletSerial ?? a?.deviceSerial ?? null,
        attemptId: a?.id ?? null,
        mode: a?.mode ?? null,
        status,
        battery: a?.batteryPercent ?? null,
        charging: a?.charging ?? null,
        currentQuestion: a && !a.submittedAt ? (a.currentQuestion ?? 1) : null,
        attended: answered,
        left: Math.max(questionCount - answered, 0),
        skipped: a?.skippedCount ?? 0,
        remainingSec: a && !a.submittedAt ? Math.max(0, Math.round((deadline!.getTime() - now.getTime()) / 1000)) : null,
        submission: !a?.submittedAt ? 'not_submitted' : a.reviewStatus === 'PENDING' ? 'pending_review' : 'submitted',
        submittedAt: a?.submittedAt ?? null,
        submittedByStaff: !!a?.forcedBy,
        revived: !!a?.revivedAt,
        lastActivity: a ? (a.lastSeenAt ?? a.submittedAt ?? a.startedAt) : null,
        score: a?.submittedAt ? a.score : null,
        maxScore: a?.submittedAt ? a.maxScore : null,
      };
    });
    const by = (s: string) => list.filter((x) => x.status === s).length;
    return {
      test: { ...this.testView(t), state: testState(t), questionCount },
      serverTime: now,
      summary: {
        total: list.length,
        active: by('active'),
        inactive: by('inactive'),
        timeOver: by('time_over'),
        notStarted: by('not_started'),
        submitted: by('submitted'),
        notSubmitted: list.length - by('submitted'),
      },
      students: list,
    };
  }

  private async attemptOf(testId: string, attemptId: string) {
    const [a] = await this.db.select().from(testAttempts).where(and(eq(testAttempts.id, attemptId), eq(testAttempts.testId, testId)));
    if (!a) throw new NotFoundException('This student has not started the test');
    return a;
  }

  /** Staff submit the answers saved so far, e.g. when a tablet froze near the end. */
  async forceSubmit(actor: StaffPrincipal, testId: string, attemptId: string, meta: RequestMeta) {
    const t = await this.load(testId);
    const a = await this.attemptOf(testId, attemptId);
    if (a.submittedAt) throw new ConflictException('This test is already submitted');
    const qs = await this.questions(testId);
    const answers = a.answers ?? {};
    const g = grade(qs, answers, t.negativeMarks);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(testAttempts)
        .set({ submittedAt: now, answers, ...g, elapsedSec: Math.round((now.getTime() - a.startedAt.getTime()) / 1000), forcedBy: actor.id, reviewStatus: 'NONE', reviewReason: null })
        .where(and(eq(testAttempts.id, a.id), isNull(testAttempts.submittedAt)))
        .returning();
      if (!row) throw new ConflictException('This test is already submitted');
      await this.audit.record(actor, { action: 'test.force_submit', entityType: 'test', entityId: testId, metadata: { attemptId, studentId: a.studentId, score: g.score } }, meta, tx);
    });
    return { ok: true };
  }

  /** Lets a student carry on from where they stopped, with at least the given minutes from now. Saved answers are kept. */
  async revive(actor: StaffPrincipal, testId: string, attemptId: string, minutes: number, meta: RequestMeta) {
    const t = await this.load(testId);
    const a = await this.attemptOf(testId, attemptId);
    const now = Date.now();
    const base = attemptDeadline(t, { startedAt: a.startedAt, extraSec: 0 }).getTime();
    const extraSec = Math.max(a.extraSec, Math.ceil((now + minutes * 60_000 - base) / 1000));
    await this.db.transaction(async (tx) => {
      await tx
        .update(testAttempts)
        .set({
          submittedAt: null,
          score: null,
          maxScore: null,
          correctCount: null,
          reviewStatus: 'NONE',
          reviewReason: null,
          reviewedBy: null,
          reviewedAt: null,
          forcedBy: null,
          extraSec,
          revivedAt: new Date(now),
          // The tablet's copy was cleared when it submitted, so it continues from the server's saved answers.
          mode: 'ONLINE',
        })
        .where(eq(testAttempts.id, a.id));
      await this.audit.record(
        actor,
        { action: 'test.revive', entityType: 'test', entityId: testId, metadata: { attemptId, studentId: a.studentId, minutes, previousScore: a.score, wasSubmitted: !!a.submittedAt } },
        meta,
        tx,
      );
    });
    return { ok: true, deadline: new Date(base + extraSec * 1000) };
  }

  /** Throws the attempt away so the student starts again from question 1 with the full time. */
  async restart(actor: StaffPrincipal, testId: string, attemptId: string, meta: RequestMeta) {
    await this.load(testId);
    const a = await this.attemptOf(testId, attemptId);
    await this.db.transaction(async (tx) => {
      await tx.delete(testAttempts).where(eq(testAttempts.id, a.id));
      const answered = a.answers ? Object.values(a.answers).filter((v) => v !== null).length : 0;
      await this.audit.record(
        actor,
        { action: 'test.restart', entityType: 'test', entityId: testId, metadata: { attemptId, studentId: a.studentId, answered, previousScore: a.score, wasSubmitted: !!a.submittedAt } },
        meta,
        tx,
      );
    });
    return { ok: true };
  }

  private async load(id: string): Promise<TestRow> {
    const [t] = await this.db.select().from(tests).where(eq(tests.id, id));
    if (!t) throw new NotFoundException('Test not found');
    return t;
  }

  private async studentTest(studentId: string, id: string): Promise<TestRow> {
    const ctx = await this.scope.student(studentId);
    const [t] = await this.db.select().from(tests).where(and(eq(tests.id, id), testsFor(ctx), isNotNull(tests.publishedAt)));
    if (!t) throw new NotFoundException('Test not found');
    return t;
  }

  private questions(testId: string, tx: DbOrTx = this.db) {
    return tx.select().from(testQuestions).where(eq(testQuestions.testId, testId)).orderBy(asc(testQuestions.position));
  }

  private async attemptCount(testId: string) {
    const [{ n }] = await this.db.select({ n: count() }).from(testAttempts).where(eq(testAttempts.testId, testId));
    return n;
  }

  private async writeQuestions(tx: DbOrTx, testId: string, questions: QuestionDto[]) {
    questions.forEach((q, i) => {
      if (q.correctIndex >= q.options.length) throw new BadRequestException(`Question ${i + 1}: the correct answer must be one of its options`);
      if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length) throw new BadRequestException(`Question ${i + 1}: options must be different from each other`);
    });
    if (!questions.length) return;
    await tx.insert(testQuestions).values(
      questions.map((q, i) => ({
        testId,
        position: i + 1,
        text: q.text,
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
        marks: q.marks ?? 1,
        topic: q.topic ?? null,
        explanation: q.explanation ?? null,
        bankQuestionId: q.bankQuestionId ?? null,
        subject: q.subject ?? null,
      })),
    );
  }

  private checkWindow(opensAt: Date, closesAt: Date, durationMin: number) {
    if (closesAt <= opensAt) throw new BadRequestException('The test must close after it opens');
    if (closesAt.getTime() - opensAt.getTime() < durationMin * 60_000) throw new BadRequestException('The test window is shorter than the time limit');
  }

  private async paper(t: TestRow) {
    const qs = await this.questions(t.id);
    const [sub] = t.subjectId ? await this.db.select({ code: subjects.code, name: subjects.name }).from(subjects).where(eq(subjects.id, t.subjectId)) : [];
    const l = labels(t, null, sub);
    return {
      testId: t.id,
      title: t.title,
      instructions: t.instructions,
      subjectCode: l.subjectCode,
      subjectName: l.subjectName,
      durationMin: t.durationMin,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      negativeMarks: t.negativeMarks,
      allowOffline: t.allowOffline,
      questions: qs.map((q) => ({ id: q.id, position: q.position, text: q.text, options: q.options, marks: q.marks, subject: q.subject })),
    };
  }

  private cleanAnswers(qs: QuestionRow[], raw: Record<string, number | null>): AnswerMap {
    const out: AnswerMap = {};
    for (const q of qs) {
      const v = raw[q.id];
      if (v === null || v === undefined) out[q.id] = null;
      else if (Number.isInteger(v) && v >= 0 && v < q.options.length) out[q.id] = v;
      else throw new BadRequestException(`Invalid answer for question ${q.position}`);
    }
    const unknown = Object.keys(raw).filter((k) => !qs.some((q) => q.id === k));
    if (unknown.length) throw new BadRequestException('Answers include questions that are not in this test');
    return out;
  }

  private scoreVisible(t: TestRow, a: AttemptRow) {
    return !!a.submittedAt && counts(a.reviewStatus) && (t.instantResults || !!t.resultsReleasedAt);
  }

  private submitResult(t: TestRow, a: AttemptRow) {
    const visible = this.scoreVisible(t, a);
    return {
      attemptId: a.id,
      submittedAt: a.submittedAt,
      mode: a.mode,
      reviewStatus: a.reviewStatus,
      reviewReason: a.reviewStatus === 'PENDING' ? 'Your answers were received and will be checked by your teacher.' : null,
      result: visible ? { score: a.score, maxScore: a.maxScore, correctCount: a.correctCount, percent: pct(a.score, a.maxScore) } : null,
    };
  }

  private studentTestView(
    t: TestRow,
    a: AttemptRow | null,
    extra: { subjectCode: string; subjectName: string; questionCount: number },
    now: Date,
  ) {
    const state = testState(t, now);
    const visible = a ? this.scoreVisible(t, a) : false;
    const deadline = a ? attemptDeadline(t, a) : null;
    const revived = !!a && !a.submittedAt && !!a.revivedAt && deadline! > now;
    return {
      id: t.id,
      title: t.title,
      instructions: t.instructions,
      ...extra,
      durationMin: t.durationMin,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      allowOffline: t.allowOffline,
      negativeMarks: t.negativeMarks,
      state,
      canStart: (state === 'open' && !a?.submittedAt) || revived,
      attempt: a
        ? {
            status: a.submittedAt ? 'SUBMITTED' : 'IN_PROGRESS',
            deadline: a.submittedAt ? null : deadline,
            revived,
            startedAt: a.startedAt,
            submittedAt: a.submittedAt,
            reviewStatus: a.reviewStatus,
            score: visible ? a.score : null,
            maxScore: visible ? a.maxScore : null,
            percent: visible ? pct(a.score, a.maxScore) : null,
            reviewAvailable: visible && (state === 'closed' || !!t.resultsReleasedAt),
          }
        : null,
    };
  }

  private testView(t: TestRow) {
    return {
      id: t.id,
      classId: t.classId,
      subjectId: t.subjectId,
      audience: t.audience,
      examCode: t.examCode,
      subjects: t.subjectNames ?? [],
      title: t.title,
      instructions: t.instructions,
      durationMin: t.durationMin,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      allowOffline: t.allowOffline,
      negativeMarks: t.negativeMarks,
      instantResults: t.instantResults,
      publishedAt: t.publishedAt,
      resultsReleasedAt: t.resultsReleasedAt,
      createdAt: t.createdAt,
    };
  }

  private signPackage(payload: { t: string; s: string; i: number }) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.pkgKey).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyPackage(token: string, testId: string, studentId: string): boolean {
    const [body, sig] = token.split('.');
    if (!body || !sig) return false;
    const expected = createHmac('sha256', this.pkgKey).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { t: string; s: string };
      return p.t === testId && p.s === studentId;
    } catch {
      return false;
    }
  }
}
