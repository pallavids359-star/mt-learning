import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, asc, eq } from 'drizzle-orm';
import type { Response } from 'express';
import type { StudentPrincipal } from '../common/auth-principal';
import { CurrentStudent, StudentOnly } from '../common/decorators';
import { InjectDb, type Database } from '../db/db.module';
import { classSubjects, holidays, staffUsers, students, subjects, teachingAssignments, timetableSlots } from '../db/schema';
import { AttendanceModule, AttendanceService } from '../attendance/attendance.module';
import { ScopeService } from '../common/scope.service';
import { LiveModule, LiveService } from '../live/live.module';
import { MaterialsModule, MaterialsService } from '../materials/materials.module';
import { NoticesModule, NoticesService } from '../notices/notices.module';
import { TestsModule } from '../tests/tests.module';
import { TestsService } from '../tests/tests.service';
import { StudentsModule } from '../students/students.module';
import { StudentsService } from '../students/students.service';
import { TabletsModule, TabletsService } from '../tablets/tablets.module';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class HeartbeatDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(100) serialNumber: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(30) appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20) androidVersion?: string;
}

@Injectable()
export class StudentPortalService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly scope: ScopeService,
    private readonly materials: MaterialsService,
    private readonly tests: TestsService,
    private readonly attendance: AttendanceService,
    private readonly notices: NoticesService,
    private readonly live: LiveService,
  ) {}

  /** The signed-in student's own profile. Guardian details are shown to the student themselves. */
  async profile(studentId: string) {
    const s = await this.db.query.students.findFirst({
      where: eq(students.id, studentId),
      with: {
        section: { with: { classGroup: { with: { academicYear: true } } } },
        hostel: true,
        tablet: true,
      },
    });
    if (!s) throw new NotFoundException('Student not found');
    const cls = s.section.classGroup;
    return {
      id: s.id,
      studentCode: s.studentCode,
      fullName: s.fullName,
      dateOfBirth: s.dateOfBirth,
      gender: s.gender,
      hasPhoto: !!s.photoUrl,
      rollNumber: s.rollNumber,
      section: { id: s.section.id, name: s.section.name },
      classGroup: { id: cls.id, name: cls.name, pucYear: cls.pucYear, stream: cls.stream },
      academicYear: { id: cls.academicYear.id, name: cls.academicYear.name },
      hostel: s.hostel ? { id: s.hostel.id, name: s.hostel.name, roomNumber: s.roomNumber } : null,
      tablet: s.tablet ? { serialNumber: s.tablet.serialNumber, model: s.tablet.model, assetTag: s.tablet.assetTag } : null,
      guardianName: s.guardianName,
      mustChangePassword: s.mustChangePassword,
      hasPin: !!s.pinHash,
    };
  }

  /** Everything the tablet home screen needs in one request, so it can be cached for offline use. */
  async home(studentId: string) {
    const profile = await this.profile(studentId);
    const ctx = await this.scope.student(studentId);
    const clock = this.scope.clock;
    const now = new Date();
    const today = clock.today(now);
    const nowTime = clock.timeOfDay(now);

    const [subjectRows, teachers, mats, testList, noticeList, calendar, results, live, [holiday], periods] = await Promise.all([
      this.db
        .select({ id: subjects.id, code: subjects.code, name: subjects.name })
        .from(classSubjects)
        .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
        .where(eq(classSubjects.classId, ctx.classId))
        .orderBy(asc(subjects.name)),
      this.db
        .select({ subjectId: teachingAssignments.subjectId, name: staffUsers.fullName })
        .from(teachingAssignments)
        .innerJoin(staffUsers, eq(staffUsers.id, teachingAssignments.teacherId))
        .where(eq(teachingAssignments.classId, ctx.classId)),
      this.materials.forStudent(studentId),
      this.tests.studentList(studentId),
      this.notices.forStudent(studentId, 50),
      this.attendance.calendar(studentId),
      this.tests.studentResults(studentId),
      this.live.forStudent(studentId),
      this.db.select().from(holidays).where(eq(holidays.date, today)),
      this.db
        .select({
          startTime: timetableSlots.startTime,
          endTime: timetableSlots.endTime,
          subjectId: timetableSlots.subjectId,
          subjectCode: subjects.code,
          subjectName: subjects.name,
          teacherName: staffUsers.fullName,
          topic: timetableSlots.topic,
          room: timetableSlots.room,
        })
        .from(timetableSlots)
        .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
        .leftJoin(staffUsers, eq(staffUsers.id, timetableSlots.teacherId))
        .where(and(eq(timetableSlots.sectionId, ctx.sectionId), eq(timetableSlots.dayOfWeek, clock.dayOfWeek(now))))
        .orderBy(asc(timetableSlots.startTime)),
    ]);

    const subjectsOut = subjectRows.map((s) => {
      const list = mats.filter((m) => m.subjectId === s.id);
      const done = list.filter((m) => m.completedAt).length;
      return {
        ...s,
        teacherNames: teachers.filter((t) => t.subjectId === s.id).map((t) => t.name),
        materialsTotal: list.length,
        materialsCompleted: done,
        progressPercent: list.length ? Math.round((done / list.length) * 100) : null,
      };
    });

    const liveToday = live.filter((l) => l.state !== 'cancelled' && clock.today(l.startsAt) === today);
    const todayPeriods = holiday
      ? []
      : periods.map((p) => {
          const lc = liveToday.find((l) => l.subjectId === p.subjectId && clock.timeOfDay(l.startsAt) < p.endTime && clock.timeOfDay(l.endsAt) > p.startTime);
          return {
            ...p,
            status: nowTime >= p.endTime ? 'done' : nowTime >= p.startTime ? 'now' : 'later',
            live: lc ? { id: lc.id, state: lc.state, joinOpen: lc.joinOpen } : null,
          };
        });

    const pendingTests = testList.filter((t) => t.state === 'open' && t.attempt?.status !== 'SUBMITTED');
    const nextTest = pendingTests[0] ?? testList.find((t) => t.state === 'upcoming') ?? null;

    return {
      serverTime: now.toISOString(),
      profile,
      subjects: subjectsOut,
      today: { date: today, holiday: holiday?.name ?? null, periods: todayPeriods },
      liveNow: live.filter((l) => l.state === 'live' || (l.state === 'scheduled' && l.joinOpen)),
      nextTest,
      openTestsCount: pendingTests.length,
      notices: { unread: noticeList.filter((n) => !n.readAt).length, latest: noticeList.slice(0, 3) },
      attendance: { monthPercent: calendar.monthPercent, yearPercent: calendar.yearPercent },
      results: { averagePercent: results.averagePercent, testsTaken: results.testsTaken },
      study: {
        total: mats.length,
        completed: mats.filter((m) => m.completedAt).length,
        downloadable: mats.filter((m) => m.allowOffline && m.hasFile).length,
      },
    };
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me')
export class StudentPortalController {
  constructor(
    private readonly svc: StudentPortalService,
    private readonly studentsSvc: StudentsService,
    private readonly tabletsSvc: TabletsService,
  ) {}

  @Get('student/profile')
  profile(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.profile(me.id);
  }

  @Get('student/home')
  home(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.home(me.id);
  }

  @Get('student/photo')
  async photo(@CurrentStudent() me: StudentPrincipal, @Res({ passthrough: true }) res: Response) {
    const { data, contentType } = await this.studentsSvc.getPhoto(me.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(data);
  }

  @Post('device/heartbeat')
  @HttpCode(200)
  heartbeat(@CurrentStudent() me: StudentPrincipal, @Body() dto: HeartbeatDto) {
    return this.tabletsSvc.heartbeat(me.id, dto.serialNumber, dto);
  }
}

@Module({
  imports: [StudentsModule, TabletsModule, MaterialsModule, TestsModule, AttendanceModule, NoticesModule, LiveModule],
  controllers: [StudentPortalController],
  providers: [StudentPortalService],
})
export class StudentPortalModule {}
