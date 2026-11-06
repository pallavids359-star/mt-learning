import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, gte, lte, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import { CurrentStaff, CurrentStudent, ReqMeta, RequirePermissions, StudentOnly } from '../common/decorators';
import { Permission, roleHas } from '../common/permissions';
import { CollegeClock, ScopeService } from '../common/scope.service';
import { InjectDb, type Database } from '../db/db.module';
import {
  attendanceKind,
  attendanceRecords,
  attendanceSessions,
  attendanceStatus,
  classes,
  holidays,
  hostels,
  sections,
  staffUsers,
  students,
  type AttendanceKind,
  type AttendanceStatus,
} from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const KINDS = attendanceKind.enumValues;
const STATUSES = attendanceStatus.enumValues;

export class RosterQueryDto {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind: AttendanceKind;
  @ApiProperty() @IsDateString({ strict: true }) date: string;
  @ApiProperty({ example: 'Period 1' }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) label: string;
  @ApiPropertyOptional() @ValidateIf((o) => o.kind === 'CLASS') @IsUUID() sectionId?: string;
  @ApiPropertyOptional() @ValidateIf((o) => o.kind === 'HOSTEL') @IsUUID() hostelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
}

export class RecordDto {
  @ApiProperty() @IsUUID() studentId: string;
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200) note?: string | null;
}

export class SaveSessionDto extends RosterQueryDto {
  @ApiProperty({ type: [RecordDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RecordDto)
  records: RecordDto[];

  @ApiPropertyOptional({ description: 'Required when changing records that were already saved' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class SessionsQueryDto {
  @ApiProperty() @IsDateString({ strict: true }) date: string;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: AttendanceKind;
}

export class TrendQueryDto {
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) days: number = 14;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
}

export class LowQueryDto {
  @ApiPropertyOptional({ default: 80 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) threshold: number = 80;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days: number = 30;
}

export class MonthQueryDto {
  @ApiPropertyOptional({ example: '2026-10' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' }) month?: string;
}

type DayStatus = AttendanceStatus | 'PARTIAL' | 'HOLIDAY';

/** Attendance % = present ÷ (present + absent). Approved leave is not counted against the student. */
const percent = (present: number, absent: number) => (present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : null);

@Injectable()
export class AttendanceService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private get clock() {
    return this.scope.clock;
  }

  // ------------------------------------------------------------ roll call

  async roster(actor: StaffPrincipal, q: RosterQueryDto) {
    await this.assertScope(actor, q);
    const people = await this.people(q);
    const session = await this.findSession(q);
    const recs = session
      ? await this.db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session.id))
      : [];
    const byStudent = new Map(recs.map((r) => [r.studentId, r]));
    const [holiday] = await this.db.select().from(holidays).where(eq(holidays.date, q.date));
    let takenByName: string | null = null;
    if (session?.takenBy) {
      const [u] = await this.db.select({ n: staffUsers.fullName }).from(staffUsers).where(eq(staffUsers.id, session.takenBy));
      takenByName = u?.n ?? null;
    }
    return {
      session: session ? { id: session.id, updatedAt: session.updatedAt, takenByName } : null,
      holiday: holiday?.name ?? null,
      canCorrect: this.canChangeSaved(actor, q.date),
      students: people.map((p) => ({
        ...p,
        status: byStudent.get(p.studentId)?.status ?? null,
        note: byStudent.get(p.studentId)?.note ?? null,
      })),
    };
  }

  async save(actor: StaffPrincipal, dto: SaveSessionDto, meta: RequestMeta) {
    await this.assertScope(actor, dto);
    const today = this.clock.today();
    if (dto.date > today) throw new BadRequestException('Attendance cannot be taken for a future date');
    const [holiday] = await this.db.select().from(holidays).where(eq(holidays.date, dto.date));
    if (holiday) throw new BadRequestException(`${dto.date} is a holiday (${holiday.name})`);

    const people = await this.people(dto);
    const allowed = new Set(people.map((p) => p.studentId));
    const outsiders = dto.records.filter((r) => !allowed.has(r.studentId));
    if (outsiders.length) throw new BadRequestException(`${outsiders.length} student(s) are not on this roll`);
    if (new Set(dto.records.map((r) => r.studentId)).size !== dto.records.length) throw new BadRequestException('A student appears twice');

    return this.db.transaction(async (tx) => {
      let [session] = await tx
        .select()
        .from(attendanceSessions)
        .where(this.sessionWhere(dto))
        .for('update');
      const created = !session;
      if (!session) {
        [session] = await tx
          .insert(attendanceSessions)
          .values({
            kind: dto.kind,
            date: dto.date,
            label: dto.label,
            sectionId: dto.kind === 'CLASS' ? dto.sectionId! : null,
            hostelId: dto.kind === 'HOSTEL' ? dto.hostelId! : null,
            subjectId: dto.subjectId ?? null,
            takenBy: actor.id,
          })
          .returning();
      }
      const existing = created ? [] : await tx.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session.id));
      const prev = new Map(existing.map((r) => [r.studentId, r]));
      const changes = dto.records.filter((r) => prev.has(r.studentId) && prev.get(r.studentId)!.status !== r.status);
      if (changes.length) {
        if (!this.canChangeSaved(actor, dto.date)) {
          throw new ForbiddenException('Only administrators can change attendance for earlier days');
        }
        if (!dto.reason || dto.reason.length < 3) throw new BadRequestException('Give a reason for changing attendance that was already saved');
      }
      for (const r of dto.records) {
        await tx
          .insert(attendanceRecords)
          .values({ sessionId: session.id, studentId: r.studentId, status: r.status, note: r.note ?? null, updatedBy: actor.id })
          .onConflictDoUpdate({
            target: [attendanceRecords.sessionId, attendanceRecords.studentId],
            set: { status: r.status, note: r.note ?? null, updatedBy: actor.id, updatedAt: new Date() },
          });
      }
      await tx.update(attendanceSessions).set({ updatedAt: new Date() }).where(eq(attendanceSessions.id, session.id));
      const tally = (s: AttendanceStatus) => dto.records.filter((r) => r.status === s).length;
      await this.audit.record(
        actor,
        {
          action: created ? 'attendance.take' : changes.length ? 'attendance.correct' : 'attendance.update',
          entityType: 'attendance',
          entityId: session.id,
          metadata: {
            date: dto.date,
            label: dto.label,
            present: tally('PRESENT'),
            absent: tally('ABSENT'),
            leave: tally('LEAVE'),
            ...(changes.length && {
              reason: dto.reason,
              changes: changes.map((c) => ({ studentId: c.studentId, from: prev.get(c.studentId)!.status, to: c.status })),
            }),
          },
        },
        meta,
        tx,
      );
      return { sessionId: session.id, saved: dto.records.length, present: tally('PRESENT'), absent: tally('ABSENT'), leave: tally('LEAVE'), corrected: changes.length };
    });
  }

  async sessions(q: SessionsQueryDto) {
    const where: SQL[] = [eq(attendanceSessions.date, q.date)];
    if (q.kind) where.push(eq(attendanceSessions.kind, q.kind));
    return this.db
      .select({
        id: attendanceSessions.id,
        kind: attendanceSessions.kind,
        date: attendanceSessions.date,
        label: attendanceSessions.label,
        sectionId: attendanceSessions.sectionId,
        sectionName: sections.name,
        className: classes.name,
        hostelId: attendanceSessions.hostelId,
        hostelName: hostels.name,
        takenByName: staffUsers.fullName,
        updatedAt: attendanceSessions.updatedAt,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
        leave: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'LEAVE')::int`,
      })
      .from(attendanceSessions)
      .leftJoin(attendanceRecords, eq(attendanceRecords.sessionId, attendanceSessions.id))
      .leftJoin(sections, eq(sections.id, attendanceSessions.sectionId))
      .leftJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(hostels, eq(hostels.id, attendanceSessions.hostelId))
      .leftJoin(staffUsers, eq(staffUsers.id, attendanceSessions.takenBy))
      .where(and(...where))
      .groupBy(attendanceSessions.id, sections.name, classes.name, hostels.name, staffUsers.fullName)
      .orderBy(asc(attendanceSessions.kind), asc(attendanceSessions.label));
  }

  /** Daily attendance % over the last N college days that had any roll call. */
  async trend(q: TrendQueryDto) {
    const to = this.clock.today();
    const from = CollegeClock.addDays(to, -(q.days * 2)); // look further back to find N days with data
    const where: SQL[] = [gte(attendanceSessions.date, from), lte(attendanceSessions.date, to)];
    if (q.classId) where.push(eq(sections.classId, q.classId));
    const rows = await this.db
      .select({
        date: attendanceSessions.date,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .leftJoin(sections, eq(sections.id, attendanceSessions.sectionId))
      .where(and(...where))
      .groupBy(attendanceSessions.date)
      .orderBy(desc(attendanceSessions.date))
      .limit(q.days);
    return rows.reverse().map((r) => ({ date: r.date, present: r.present, absent: r.absent, percent: percent(r.present, r.absent) }));
  }

  /** Active students whose attendance over the last N days is below the threshold. */
  async low(q: LowQueryDto) {
    const to = this.clock.today();
    const from = CollegeClock.addDays(to, -q.days);
    const rows = await this.db
      .select({
        studentId: students.id,
        studentCode: students.studentCode,
        fullName: students.fullName,
        className: classes.name,
        sectionName: sections.name,
        guardianPhone: students.guardianPhone,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .innerJoin(students, eq(students.id, attendanceRecords.studentId))
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(and(gte(attendanceSessions.date, from), lte(attendanceSessions.date, to), eq(students.status, 'ACTIVE')))
      .groupBy(students.id, classes.name, sections.name);
    return rows
      .map((r) => ({ ...r, percent: percent(r.present, r.absent) }))
      .filter((r) => r.percent !== null && r.percent < q.threshold)
      .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
  }

  /** A month calendar for one student (used by the tablet app and the staff student page). */
  async calendar(studentId: string, month?: string) {
    const today = this.clock.today();
    const m = month ?? today.slice(0, 7);
    const first = `${m}-01`;
    const last = CollegeClock.addDays(`${CollegeClock.addDays(first, 32).slice(0, 7)}-01`, -1);
    const recs = await this.db
      .select({ date: attendanceSessions.date, label: attendanceSessions.label, kind: attendanceSessions.kind, status: attendanceRecords.status, note: attendanceRecords.note })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .where(and(eq(attendanceRecords.studentId, studentId), gte(attendanceSessions.date, first), lte(attendanceSessions.date, last)))
      .orderBy(asc(attendanceSessions.date), asc(attendanceSessions.label));
    const hols = await this.db.select().from(holidays).where(and(gte(holidays.date, first), lte(holidays.date, last)));
    const days: { date: string; status: DayStatus | null; holiday: string | null; sessions: { label: string; kind: string; status: AttendanceStatus; note: string | null }[] }[] = [];
    for (let d = first; d <= last; d = CollegeClock.addDays(d, 1)) {
      const list = recs.filter((r) => r.date === d);
      const hol = hols.find((h) => h.date === d);
      let status: DayStatus | null = null;
      if (hol) status = 'HOLIDAY';
      else if (list.length) {
        const set = new Set(list.map((r) => r.status));
        if (set.size === 1) status = list[0].status;
        else if (set.has('ABSENT')) status = 'PARTIAL';
        else status = 'PRESENT';
      }
      days.push({ date: d, status, holiday: hol?.name ?? null, sessions: list.map(({ label, kind, status: s, note }) => ({ label, kind, status: s, note })) });
    }
    const present = recs.filter((r) => r.status === 'PRESENT').length;
    const absent = recs.filter((r) => r.status === 'ABSENT').length;

    // Academic-year-to-date percentage.
    const yearStart = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 6 ? 1 : 0)}-06-01`;
    const [y] = await this.db
      .select({
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .where(and(eq(attendanceRecords.studentId, studentId), gte(attendanceSessions.date, yearStart)));
    return {
      month: m,
      today,
      days,
      monthPercent: percent(present, absent),
      yearPercent: percent(y.present, y.absent),
      daysPresent: days.filter((d) => d.status === 'PRESENT').length,
      daysRecorded: days.filter((d) => d.status && d.status !== 'HOLIDAY').length,
      absences: days.filter((d) => d.status === 'ABSENT' || d.status === 'PARTIAL').map((d) => ({ date: d.date, sessions: d.sessions.filter((s) => s.status === 'ABSENT') })),
    };
  }

  /** Today's overall attendance % (for dashboards). */
  async todayPercent() {
    const today = this.clock.today();
    const [r] = await this.db
      .select({
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .where(eq(attendanceSessions.date, today));
    return { date: today, percent: percent(r.present, r.absent), present: r.present, absent: r.absent };
  }

  // ------------------------------------------------------------ internals

  /** Same-day changes are allowed for whoever takes attendance; earlier days need the correction permission. */
  private canChangeSaved(actor: StaffPrincipal, date: string) {
    return date === this.clock.today() || roleHas(actor.role, Permission.AttendanceCorrect);
  }

  private async assertScope(actor: StaffPrincipal, q: RosterQueryDto) {
    if (q.kind === 'CLASS') {
      if (!q.sectionId) throw new BadRequestException('Choose a section');
      const [sec] = await this.db.select({ classId: sections.classId }).from(sections).where(eq(sections.id, q.sectionId));
      if (!sec) throw new BadRequestException('Section does not exist');
      if (actor.role === 'HOSTEL_WARDEN') throw new ForbiddenException('Wardens take hostel roll calls only');
      await this.scope.assertTeachesClass(actor, sec.classId);
    } else {
      if (!q.hostelId) throw new BadRequestException('Choose a hostel');
      const [h] = await this.db.select({ id: hostels.id }).from(hostels).where(eq(hostels.id, q.hostelId));
      if (!h) throw new BadRequestException('Hostel does not exist');
      if (actor.role === 'TEACHER') throw new ForbiddenException('Teachers take class attendance only');
      await this.scope.assertWardenOf(actor, q.hostelId);
    }
  }

  private people(q: RosterQueryDto) {
    const where = q.kind === 'CLASS' ? eq(students.sectionId, q.sectionId!) : eq(students.hostelId, q.hostelId!);
    return this.db
      .select({
        studentId: students.id,
        studentCode: students.studentCode,
        fullName: students.fullName,
        rollNumber: students.rollNumber,
        roomNumber: students.roomNumber,
        className: classes.name,
        sectionName: sections.name,
      })
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(and(where, eq(students.status, 'ACTIVE')))
      .orderBy(q.kind === 'CLASS' ? sql`length(${students.rollNumber}), ${students.rollNumber}` : sql`${students.roomNumber} nulls last, ${students.fullName}`);
  }

  private sessionWhere(q: RosterQueryDto) {
    return and(
      eq(attendanceSessions.date, q.date),
      eq(attendanceSessions.label, q.label),
      sql`coalesce(${attendanceSessions.sectionId}::text, '') = ${q.kind === 'CLASS' ? q.sectionId! : ''}`,
      sql`coalesce(${attendanceSessions.hostelId}::text, '') = ${q.kind === 'HOSTEL' ? q.hostelId! : ''}`,
    );
  }

  private async findSession(q: RosterQueryDto) {
    const [s] = await this.db.select().from(attendanceSessions).where(this.sessionWhere(q));
    return s;
  }
}

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get('attendance/roster') @RequirePermissions(Permission.AttendanceWrite)
  roster(@CurrentStaff() a: StaffPrincipal, @Query() q: RosterQueryDto) {
    return this.svc.roster(a, q);
  }

  @Put('attendance/sessions') @RequirePermissions(Permission.AttendanceWrite)
  save(@CurrentStaff() a: StaffPrincipal, @Body() dto: SaveSessionDto, @ReqMeta() m: RequestMeta) {
    return this.svc.save(a, dto, m);
  }

  @Get('attendance/sessions') @RequirePermissions(Permission.AttendanceRead)
  sessions(@Query() q: SessionsQueryDto) {
    return this.svc.sessions(q);
  }

  @Get('attendance/trend') @RequirePermissions(Permission.AttendanceRead)
  trend(@Query() q: TrendQueryDto) {
    return this.svc.trend(q);
  }

  @Get('attendance/low') @RequirePermissions(Permission.AttendanceRead)
  async low(@CurrentStaff() a: StaffPrincipal, @Query() q: LowQueryDto) {
    const rows = await this.svc.low(q);
    // Guardian contact is sensitive: only roles allowed to see it get it.
    return roleHas(a.role, Permission.StudentsSensitiveRead) ? rows : rows.map((r) => ({ ...r, guardianPhone: null }));
  }

  @Get('students/:id/attendance') @RequirePermissions(Permission.AttendanceRead)
  student(@Param('id', ParseUUIDPipe) id: string, @Query() q: MonthQueryDto) {
    return this.svc.calendar(id, q.month);
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me/attendance')
export class StudentAttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get()
  mine(@CurrentStudent() me: StudentPrincipal, @Query() q: MonthQueryDto) {
    return this.svc.calendar(me.id, q.month);
  }
}

@Module({ controllers: [AttendanceController, StudentAttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}

