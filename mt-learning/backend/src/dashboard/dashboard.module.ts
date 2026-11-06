import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AttendanceModule, AttendanceService } from '../attendance/attendance.module';
import type { StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, RequirePermissions } from '../common/decorators';
import { Permission, roleHas } from '../common/permissions';
import { InjectDb, type Database } from '../db/db.module';
import { academicYears, auditLogs, classes, hostels, sections, staffUsers, students, subjects, tablets, testAttempts, tests } from '../db/schema';

const STALE_DAYS = 7;

@Injectable()
export class DashboardService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly attendance: AttendanceService,
  ) {}

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
}

@Module({ imports: [AttendanceModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
