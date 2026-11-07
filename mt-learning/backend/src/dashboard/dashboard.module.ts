import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AttendanceModule, AttendanceService } from '../attendance/attendance.module';
import { TestsModule } from '../tests/tests.module';
import { TestsService } from '../tests/tests.service';
import type { StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, RequirePermissions } from '../common/decorators';
import { Permission, roleHas } from '../common/permissions';
import { InjectDb, type Database } from '../db/db.module';
import { academicYears, auditLogs, classes, hostels, sections, staffUsers, students, subjects, tablets, testAttempts, tests } from '../db/schema';

const STALE_DAYS = 7;

const YEAR_LABEL: Record<string, string> = { PUC_1: 'Class 11', PUC_2: 'Class 12', BOTH: 'Class 11 and 12' };

/** "Class 12, NEET" style label for exam tests, the class name for older tests. */
function testLabels(t: typeof tests.$inferSelect, className: string | null, subjectName: string | null) {
  if (t.audience) return { className: `${YEAR_LABEL[t.audience]} \u00b7 ${t.examCode}`, subjectName: (t.subjectNames ?? []).join(', ') };
  return { className: className ?? '', subjectName: subjectName ?? '' };
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly attendance: AttendanceService,
    private readonly testsSvc: TestsService,
  ) {}

  /**
   * The dashboard's live-test banner, score trend, upcoming tests and section table.
   * Scores count only submissions that are not waiting for review or rejected.
   */
  async overview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const published = isNotNull(tests.publishedAt);
    const counted = sql`${testAttempts.reviewStatus} in ('NONE','ACCEPTED')`;
    const percent = sql<number | null>`round(avg(${testAttempts.score} / nullif(${testAttempts.maxScore}, 0)) * 1000) / 10`;
    const [currentYear] = await this.db.select().from(academicYears).where(eq(academicYears.isCurrent, true));

    const [openTests, [month], [upcomingCount], [avgThis], [avgLast], weeklyRows, upcomingRows, sectionRows, studentRows] = await Promise.all([
      this.db
        .select({ test: tests, className: classes.name, subjectName: subjects.name })
        .from(tests)
        .leftJoin(classes, eq(classes.id, tests.classId))
        .leftJoin(subjects, eq(subjects.id, tests.subjectId))
        .where(and(published, lte(tests.opensAt, now), gte(tests.closesAt, now)))
        .orderBy(asc(tests.closesAt))
        .limit(1),
      this.db.select({ n: count() }).from(tests).where(and(published, gte(tests.opensAt, monthStart))),
      this.db.select({ n: count() }).from(tests).where(and(published, gte(tests.opensAt, now))),
      this.db
        .select({ avg: percent })
        .from(testAttempts)
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, monthStart), counted)),
      this.db
        .select({ avg: percent })
        .from(testAttempts)
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, lastMonthStart), lt(testAttempts.submittedAt, monthStart), counted)),
      this.db
        .select({
          week: sql<string>`to_char(date_trunc('week', ${testAttempts.submittedAt}), 'YYYY-MM-DD')`,
          pucYear: classes.pucYear,
          avg: percent,
        })
        .from(testAttempts)
        .innerJoin(students, eq(students.id, testAttempts.studentId))
        .innerJoin(sections, eq(sections.id, students.sectionId))
        .innerJoin(classes, eq(classes.id, sections.classId))
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, eightWeeksAgo), counted))
        .groupBy(sql`1`, classes.pucYear),
      this.db
        .select({ test: tests, className: classes.name })
        .from(tests)
        .leftJoin(classes, eq(classes.id, tests.classId))
        .where(and(published, gte(tests.opensAt, now)))
        .orderBy(asc(tests.opensAt))
        .limit(4),
      currentYear
        ? this.db
            .select({
              sectionId: sections.id,
              className: classes.name,
              pucYear: classes.pucYear,
              sectionName: sections.name,
              students: sql<number>`count(${students.id}) filter (where ${students.status} = 'ACTIVE')::int`,
            })
            .from(sections)
            .innerJoin(classes, eq(classes.id, sections.classId))
            .leftJoin(students, eq(students.sectionId, sections.id))
            .where(eq(classes.academicYearId, currentYear.id))
            .groupBy(sections.id, classes.name, classes.pucYear, sections.name)
            .orderBy(asc(classes.pucYear), asc(classes.name), asc(sections.name))
        : Promise.resolve([]),
      this.db
        .select({ sectionId: students.sectionId, name: students.fullName, avg: percent, attempts: count() })
        .from(testAttempts)
        .innerJoin(students, eq(students.id, testAttempts.studentId))
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, thirtyDaysAgo), counted, eq(students.status, 'ACTIVE')))
        .groupBy(students.id),
    ]);

    // Live banner: the open test that closes first.
    let live = null;
    if (openTests[0]) {
      const o = openTests[0];
      const s = (await this.testsSvc.monitor(o.test.id)).summary;
      const l = testLabels(o.test, o.className, o.subjectName);
      live = {
        id: o.test.id,
        title: o.test.title,
        className: l.className,
        subjectName: l.subjectName,
        closesAt: o.test.closesAt,
        total: s.total,
        started: s.total - s.notStarted,
        writing: s.active,
        submitted: s.submitted,
        needHelp: s.inactive + s.timeOver,
        notStarted: s.notStarted,
      };
    }

    // Last 8 weeks, oldest first, Monday dates; a week with no tests has no score.
    const weeks: { week: string; puc1: number | null; puc2: number | null }[] = [];
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const d = new Date(monday.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10);
      const pick = (y: string) => weeklyRows.find((r) => r.week === d && r.pucYear === y)?.avg ?? null;
      weeks.push({ week: d, puc1: pick('PUC_1'), puc2: pick('PUC_2') });
    }

    // Sections: average of their students' tests in the last 30 days, and the top student.
    const bySection = new Map<string, { name: string; avg: number }[]>();
    for (const r of studentRows) {
      if (r.avg === null || !r.sectionId) continue;
      const list = bySection.get(r.sectionId) ?? [];
      list.push({ name: r.name, avg: Number(r.avg) });
      bySection.set(r.sectionId, list);
    }
    const sectionList = sectionRows.map((r) => {
      const list = (bySection.get(r.sectionId) ?? []).sort((a, b) => b.avg - a.avg);
      const average = list.length ? Math.round((list.reduce((t, x) => t + x.avg, 0) / list.length) * 10) / 10 : null;
      return {
        sectionId: r.sectionId,
        className: r.className,
        pucYear: r.pucYear,
        sectionName: r.sectionName,
        students: r.students,
        average,
        topper: list[0] ? { name: list[0].name, percent: list[0].avg } : null,
      };
    });

    return {
      live,
      testsThisMonth: month.n,
      upcomingCount: upcomingCount.n,
      averageThisMonth: avgThis.avg === null ? null : Number(avgThis.avg),
      averageLastMonth: avgLast.avg === null ? null : Number(avgLast.avg),
      weekly: weeks,
      upcoming: upcomingRows.map((r) => ({
        id: r.test.id,
        title: r.test.title,
        className: testLabels(r.test, r.className, null).className,
        examCode: r.test.examCode,
        opensAt: r.test.opensAt,
        durationMin: r.test.durationMin,
      })),
      sections: sectionList,
    };
  }

  async summary(actor: StaffPrincipal) {
    const [base, extra] = await Promise.all([this.baseSummary(actor), this.teachingSummary(actor)]);
    return { ...base, ...extra };
  }

  /** Phase 2 figures: attendance, tests, devices online, class performance. */
  private async teachingSummary(actor: StaffPrincipal) {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const canAttendance = roleHas(actor.role, Permission.AttendanceRead);
    const canTests = roleHas(actor.role, Permission.TestsRead);
    const [byYear, [online], attendanceToday, trend, low, [week], [pending], [openNow], perf] = await Promise.all([
      this.db
        .select({ pucYear: classes.pucYear, n: count() })
        .from(students)
        .innerJoin(sections, eq(sections.id, students.sectionId))
        .innerJoin(classes, eq(classes.id, sections.classId))
        .where(eq(students.status, 'ACTIVE'))
        .groupBy(classes.pucYear),
      this.db.select({ n: count() }).from(tablets).where(and(eq(tablets.status, 'ASSIGNED'), gte(tablets.lastSeenAt, dayAgo))),
      canAttendance ? this.attendance.todayPercent() : Promise.resolve(null),
      canAttendance ? this.attendance.trend({ days: 14 }) : Promise.resolve(null),
      canAttendance ? this.attendance.low({ threshold: 80, days: 30 }) : Promise.resolve(null),
      this.db
        .select({
          n: count(),
          avg: sql<number | null>`round(avg(${testAttempts.score} / nullif(${testAttempts.maxScore}, 0)) filter (where ${testAttempts.reviewStatus} in ('NONE','ACCEPTED')) * 1000) / 10`,
        })
        .from(testAttempts)
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, weekAgo))),
      this.db.select({ n: count() }).from(testAttempts).where(eq(testAttempts.reviewStatus, 'PENDING')),
      this.db
        .select({ n: count() })
        .from(tests)
        .where(and(isNotNull(tests.publishedAt), lte(tests.opensAt, now), gte(tests.closesAt, now))),
      this.db
        .select({
          classId: classes.id,
          className: classes.name,
          sectionName: sections.name,
          averagePercent: sql<number>`round(avg(${testAttempts.score} / nullif(${testAttempts.maxScore}, 0)) * 1000) / 10`,
          attempts: count(),
        })
        .from(testAttempts)
        .innerJoin(students, eq(students.id, testAttempts.studentId))
        .innerJoin(sections, eq(sections.id, students.sectionId))
        .innerJoin(classes, eq(classes.id, sections.classId))
        .where(and(isNotNull(testAttempts.submittedAt), gte(testAttempts.submittedAt, monthAgo), sql`${testAttempts.reviewStatus} in ('NONE','ACCEPTED')`))
        .groupBy(classes.id, sections.name)
        .orderBy(asc(classes.name), asc(sections.name)),
    ]);
    return {
      studentsByYear: Object.fromEntries(byYear.map((r) => [r.pucYear, r.n])),
      tabletsOnlineToday: online.n,
      attendance: canAttendance
        ? { today: attendanceToday, trend, belowThreshold: low!.length, threshold: 80, lowStudents: low!.slice(0, 10).map((r) => (roleHas(actor.role, Permission.StudentsSensitiveRead) ? r : { ...r, guardianPhone: null })) }
        : null,
      tests: canTests
        ? { submittedThisWeek: week.n, averagePercentThisWeek: week.avg, pendingReviews: pending.n, openNow: openNow.n }
        : null,
      classPerformance: canTests ? perf : null,
    };
  }

  private async baseSummary(actor: StaffPrincipal) {
    const [currentYear] = await this.db.select().from(academicYears).where(eq(academicYears.isCurrent, true));
    const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);

    const [studentStatus, tabletStatus, staleTablets, withoutTablet, staffByRole, subjectCount, hostelCount, byClass] = await Promise.all([
      this.db.select({ status: students.status, n: count() }).from(students).groupBy(students.status),
      this.db.select({ status: tablets.status, n: count() }).from(tablets).groupBy(tablets.status),
      this.db
        .select({ n: count() })
        .from(tablets)
        .where(and(eq(tablets.status, 'ASSIGNED'), or(isNull(tablets.lastSeenAt), lt(tablets.lastSeenAt, staleBefore)))),
      this.db
        .select({ n: count() })
        .from(students)
        .leftJoin(tablets, eq(tablets.studentId, students.id))
        .where(and(eq(students.status, 'ACTIVE'), isNull(tablets.id))),
      this.db.select({ role: staffUsers.role, n: count() }).from(staffUsers).where(eq(staffUsers.status, 'ACTIVE')).groupBy(staffUsers.role),
      this.db.select({ n: count() }).from(subjects).where(eq(subjects.isActive, true)),
      this.db.select({ n: count() }).from(hostels),
      currentYear
        ? this.db
            .select({
              classId: classes.id,
              className: classes.name,
              pucYear: classes.pucYear,
              sections: sql<number>`count(distinct ${sections.id})::int`,
              students: sql<number>`count(${students.id}) filter (where ${students.status} = 'ACTIVE')::int`,
            })
            .from(classes)
            .leftJoin(sections, eq(sections.classId, classes.id))
            .leftJoin(students, eq(students.sectionId, sections.id))
            .where(eq(classes.academicYearId, currentYear.id))
            .groupBy(classes.id)
            .orderBy(asc(classes.pucYear), asc(classes.name))
        : Promise.resolve([]),
    ]);

    const tally = <K extends string>(rows: { n: number }[], key: (r: never) => K) =>
      Object.fromEntries(rows.map((r) => [key(r as never), r.n])) as Record<K, number>;
    const sByStatus = tally(studentStatus, (r: { status: string }) => r.status);
    const tByStatus = tally(tabletStatus, (r: { status: string }) => r.status);

    const recentActivity = roleHas(actor.role, Permission.AuditRead)
      ? await this.db
          .select({ id: auditLogs.id, action: auditLogs.action, actorLabel: auditLogs.actorLabel, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt })
          .from(auditLogs)
          .orderBy(desc(auditLogs.createdAt))
          .limit(10)
      : null;

    return {
      generatedAt: new Date().toISOString(),
      academicYear: currentYear ? { id: currentYear.id, name: currentYear.name } : null,
      students: {
        active: sByStatus.ACTIVE ?? 0,
        suspended: sByStatus.SUSPENDED ?? 0,
        deactivated: sByStatus.DEACTIVATED ?? 0,
        activeWithoutTablet: withoutTablet[0].n,
      },
      tablets: {
        total: Object.values(tByStatus).reduce((a, b) => a + b, 0),
        byStatus: tByStatus,
        staleAssigned: staleTablets[0].n,
        staleAfterDays: STALE_DAYS,
      },
      classes: byClass,
      subjects: subjectCount[0].n,
      hostels: hostelCount[0].n,
      staffByRole: tally(staffByRole, (r: { role: string }) => r.role),
      recentActivity,
    };
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('summary') @RequirePermissions(Permission.DashboardView)
  summary(@CurrentStaff() actor: StaffPrincipal) {
    return this.svc.summary(actor);
  }

  @Get('overview') @RequirePermissions(Permission.DashboardView, Permission.TestsRead)
  overview() {
    return this.svc.overview();
  }
}

@Module({ imports: [AttendanceModule, TestsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
