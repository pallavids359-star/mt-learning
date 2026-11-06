import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { DbOrTx, InjectDb, type Database } from '../db/db.module';
import { classes, hostels, sections, students, teachingAssignments } from '../db/schema';
import type { StaffPrincipal } from './auth-principal';

export interface StudentContext {
  studentId: string;
  sectionId: string;
  classId: string;
  /** PUC_1 or PUC_2, for tests set for a whole year. */
  pucYear: 'PUC_1' | 'PUC_2';
  academicYearId: string;
  hostelId: string | null;
  status: string;
}

/** College-local calendar helpers. All "today" logic uses the college's time zone, never the server's. */
export class CollegeClock {
  constructor(private readonly tz: string) {}

  private parts(d: Date) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dow };
  }

  /** YYYY-MM-DD in the college time zone. */
  today(now = new Date()): string {
    return this.parts(now).date;
  }

  /** "HH:MM" in the college time zone. */
  timeOfDay(now = new Date()): string {
    return this.parts(now).time;
  }

  /** 1 = Monday … 7 = Sunday, in the college time zone. */
  dayOfWeek(now = new Date()): number {
    return this.parts(now).dow;
  }

  /** The college-local date `days` days before `date` (YYYY-MM-DD arithmetic, no time-zone drift). */
  static addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}

@Injectable()
export class ScopeService {
  readonly clock = new CollegeClock(loadEnv().COLLEGE_TIMEZONE);

  constructor(@InjectDb() private readonly db: Database) {}

  async student(studentId: string, tx: DbOrTx = this.db): Promise<StudentContext> {
    const [row] = await tx
      .select({
        studentId: students.id,
        sectionId: students.sectionId,
        classId: sections.classId,
        pucYear: classes.pucYear,
        academicYearId: classes.academicYearId,
        hostelId: students.hostelId,
        status: students.status,
      })
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(eq(students.id, studentId));
    if (!row) throw new NotFoundException('Student not found');
    return row;
  }

  /**
   * Teachers may manage materials, tests and live classes only for class/subject pairs
   * assigned to them. Other roles with the write permission are not restricted.
   */
  async assertTeaches(actor: StaffPrincipal, classId: string, subjectId: string): Promise<void> {
    if (actor.role !== 'TEACHER') return;
    const [row] = await this.db
      .select({ c: teachingAssignments.classId })
      .from(teachingAssignments)
      .where(
        and(
          eq(teachingAssignments.classId, classId),
          eq(teachingAssignments.subjectId, subjectId),
          eq(teachingAssignments.teacherId, actor.id),
        ),
      );
    if (!row) throw new ForbiddenException('You are not assigned to teach this subject to this class');
  }

  /** Teachers may take attendance for sections of classes they teach any subject in. */
  async assertTeachesClass(actor: StaffPrincipal, classId: string): Promise<void> {
    if (actor.role !== 'TEACHER') return;
    const [row] = await this.db
      .select({ c: teachingAssignments.classId })
      .from(teachingAssignments)
      .where(and(eq(teachingAssignments.classId, classId), eq(teachingAssignments.teacherId, actor.id)));
    if (!row) throw new ForbiddenException('You are not assigned to teach this class');
  }

  /** Hostel wardens may take roll calls only for hostels they are warden of. */
  async assertWardenOf(actor: StaffPrincipal, hostelId: string): Promise<void> {
    if (actor.role !== 'HOSTEL_WARDEN') return;
    const [row] = await this.db.select({ w: hostels.wardenId }).from(hostels).where(eq(hostels.id, hostelId));
    if (!row || row.w !== actor.id) throw new ForbiddenException('You are not the warden of this hostel');
  }

  /** Class ids a teacher teaches (null = not restricted). */
  async teacherClassIds(actor: StaffPrincipal): Promise<string[] | null> {
    if (actor.role !== 'TEACHER') return null;
    const rows = await this.db
      .selectDistinct({ c: teachingAssignments.classId })
      .from(teachingAssignments)
      .where(eq(teachingAssignments.teacherId, actor.id));
    return rows.map((r) => r.c);
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}
