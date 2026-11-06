import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { InjectDb, type Database } from '../db/db.module';
import { classes, classSubjects, holidays, sections, staffUsers, subjects, teachingAssignments, timetableSlots } from '../db/schema';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class AssignmentDto {
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiProperty() @IsUUID() teacherId: string;
}
export class SetAssignmentsDto {
  @ApiProperty({ type: [AssignmentDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments: AssignmentDto[];
}

export class SlotDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: '1 = Monday … 7 = Sunday' }) @IsInt() @Min(1) @Max(7) dayOfWeek: number;
  @ApiProperty({ example: '08:30' }) @Matches(TIME, { message: 'startTime must be HH:MM' }) startTime: string;
  @ApiProperty({ example: '09:20' }) @Matches(TIME, { message: 'endTime must be HH:MM' }) endTime: string;
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() teacherId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) topic?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(40) room?: string | null;
}
export class SetTimetableDto {
  @ApiProperty({ type: [SlotDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];
}

export class HolidayDto {
  @ApiProperty({ example: '2026-11-01' }) @IsDateString({ strict: true }) date: string;
  @ApiProperty({ example: 'Kannada Rajyotsava' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
}
export class HolidayQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) to?: string;
}

@Injectable()
export class TeachingService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ teacher assignments

  async assignments(classId: string) {
    await this.assertClass(classId);
    return this.db
      .select({
        subjectId: teachingAssignments.subjectId,
        subjectName: subjects.name,
        teacherId: teachingAssignments.teacherId,
        teacherName: staffUsers.fullName,
      })
      .from(teachingAssignments)
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
      .innerJoin(staffUsers, eq(staffUsers.id, teachingAssignments.teacherId))
      .where(eq(teachingAssignments.classId, classId))
      .orderBy(asc(subjects.name));
  }

  async setAssignments(actor: StaffPrincipal, classId: string, dto: SetAssignmentsDto, meta: RequestMeta) {
    await this.assertClass(classId);
    const subjectIds = [...new Set(dto.assignments.map((a) => a.subjectId))];
    const teacherIds = [...new Set(dto.assignments.map((a) => a.teacherId))];
    if (subjectIds.length) {
      const taught = await this.db
        .select({ id: classSubjects.subjectId })
        .from(classSubjects)
        .where(and(eq(classSubjects.classId, classId), inArray(classSubjects.subjectId, subjectIds)));
      if (taught.length !== subjectIds.length) throw new BadRequestException('Every subject must be one the class studies');
    }
    if (teacherIds.length) {
      const ok = await this.db
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(and(inArray(staffUsers.id, teacherIds), eq(staffUsers.role, 'TEACHER')));
      if (ok.length !== teacherIds.length) throw new BadRequestException('Every teacher must be a staff member with the Teacher role');
    }
    const unique = new Map(dto.assignments.map((a) => [`${a.subjectId}|${a.teacherId}`, a]));
    await this.db.transaction(async (tx) => {
      await tx.delete(teachingAssignments).where(eq(teachingAssignments.classId, classId));
      if (unique.size) await tx.insert(teachingAssignments).values([...unique.values()].map((a) => ({ classId, ...a })));
      await this.audit.record(actor, { action: 'class.teachers', entityType: 'class', entityId: classId, metadata: { count: unique.size } }, meta, tx);
    });
    return this.assignments(classId);
  }

  /** The class/subject pairs a teacher teaches; other roles are not restricted. */
  async mine(actor: StaffPrincipal) {
    if (actor.role !== 'TEACHER') return { restricted: false, pairs: [] };
    const pairs = await this.db
      .select({ classId: teachingAssignments.classId, subjectId: teachingAssignments.subjectId })
      .from(teachingAssignments)
      .where(eq(teachingAssignments.teacherId, actor.id));
    return { restricted: true, pairs };
  }

  // ------------------------------------------------------------ timetable

  async timetable(sectionId: string) {
    await this.assertSection(sectionId);
    return this.db
      .select({
        id: timetableSlots.id,
        dayOfWeek: timetableSlots.dayOfWeek,
        startTime: timetableSlots.startTime,
        endTime: timetableSlots.endTime,
        subjectId: timetableSlots.subjectId,
        subjectCode: subjects.code,
        subjectName: subjects.name,
        teacherId: timetableSlots.teacherId,
        teacherName: staffUsers.fullName,
        topic: timetableSlots.topic,
        room: timetableSlots.room,
      })
      .from(timetableSlots)
      .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
      .leftJoin(staffUsers, eq(staffUsers.id, timetableSlots.teacherId))
      .where(eq(timetableSlots.sectionId, sectionId))
      .orderBy(asc(timetableSlots.dayOfWeek), asc(timetableSlots.startTime));
  }

  async setTimetable(actor: StaffPrincipal, sectionId: string, dto: SetTimetableDto, meta: RequestMeta) {
    await this.assertSection(sectionId);
    // Validate times and overlaps per day.
    const byDay = new Map<number, SlotDto[]>();
    for (const s of dto.slots) {
      if (s.endTime <= s.startTime) throw new BadRequestException(`A period on day ${s.dayOfWeek} ends before it starts (${s.startTime}–${s.endTime})`);
      byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) ?? []), s]);
    }
    for (const [day, list] of byDay) {
      const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startTime < sorted[i - 1].endTime) {
          throw new BadRequestException(`Periods overlap on day ${day}: ${sorted[i - 1].startTime}–${sorted[i - 1].endTime} and ${sorted[i].startTime}–${sorted[i].endTime}`);
        }
      }
    }
    const subjectIds = [...new Set(dto.slots.map((s) => s.subjectId))];
    if (subjectIds.length) {
      const found = await this.db.select({ id: subjects.id }).from(subjects).where(inArray(subjects.id, subjectIds));
      if (found.length !== subjectIds.length) throw new BadRequestException('One or more subjects do not exist');
    }
    const teacherIds = [...new Set(dto.slots.map((s) => s.teacherId).filter((x): x is string => !!x))];
    if (teacherIds.length) {
      const found = await this.db.select({ id: staffUsers.id }).from(staffUsers).where(inArray(staffUsers.id, teacherIds));
      if (found.length !== teacherIds.length) throw new BadRequestException('One or more teachers do not exist');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(timetableSlots).where(eq(timetableSlots.sectionId, sectionId));
      if (dto.slots.length) {
        await tx.insert(timetableSlots).values(
          dto.slots.map((s) => ({ sectionId, ...s, teacherId: s.teacherId ?? null, topic: s.topic ?? null, room: s.room ?? null })),
        );
      }
      await this.audit.record(actor, { action: 'timetable.update', entityType: 'section', entityId: sectionId, metadata: { periods: dto.slots.length } }, meta, tx);
    });
    return this.timetable(sectionId);
  }

  // ------------------------------------------------------------ holidays

  listHolidays(q: HolidayQueryDto) {
    const where = [];
    if (q.from) where.push(gte(holidays.date, q.from));
    if (q.to) where.push(lte(holidays.date, q.to));
    return this.db.select().from(holidays).where(where.length ? and(...where) : undefined).orderBy(asc(holidays.date));
  }

  async addHoliday(actor: StaffPrincipal, dto: HolidayDto, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(holidays).values(dto).returning();
      await this.audit.record(actor, { action: 'holiday.create', entityType: 'holiday', entityId: row.id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  async removeHoliday(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.delete(holidays).where(eq(holidays.id, id)).returning();
      if (!row) throw new NotFoundException('Holiday not found');
      await this.audit.record(actor, { action: 'holiday.delete', entityType: 'holiday', entityId: id, metadata: { date: row.date, name: row.name } }, meta, tx);
    });
  }

  private async assertClass(id: string) {
    const [row] = await this.db.select({ id: classes.id }).from(classes).where(eq(classes.id, id));
    if (!row) throw new NotFoundException('Class not found');
  }

  private async assertSection(id: string) {
    const [row] = await this.db.select({ id: sections.id }).from(sections).where(eq(sections.id, id));
    if (!row) throw new NotFoundException('Section not found');
  }
}

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Teaching: assignments, timetable, holidays')
@ApiBearerAuth()
@Controller()
export class TeachingController {
  constructor(private readonly svc: TeachingService) {}

  @Get('teaching/mine') @RequirePermissions(Permission.AcademicRead)
  mine(@CurrentStaff() a: StaffPrincipal) {
    return this.svc.mine(a);
  }

  @Get('classes/:id/teachers') @RequirePermissions(Permission.AcademicRead)
  assignments(@Id() id: string) {
    return this.svc.assignments(id);
  }

  @Put('classes/:id/teachers') @RequirePermissions(Permission.AcademicWrite)
  setAssignments(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SetAssignmentsDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setAssignments(a, id, dto, m);
  }

  @Get('sections/:id/timetable') @RequirePermissions(Permission.AcademicRead)
  timetable(@Id() id: string) {
    return this.svc.timetable(id);
  }

  @Put('sections/:id/timetable') @RequirePermissions(Permission.AcademicWrite)
  setTimetable(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SetTimetableDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setTimetable(a, id, dto, m);
  }

  @Get('holidays') @RequirePermissions(Permission.AcademicRead)
  holidays(@Query() q: HolidayQueryDto) {
    return this.svc.listHolidays(q);
  }

  @Post('holidays') @RequirePermissions(Permission.AcademicWrite)
  addHoliday(@CurrentStaff() a: StaffPrincipal, @Body() dto: HolidayDto, @ReqMeta() m: RequestMeta) {
    return this.svc.addHoliday(a, dto, m);
  }

  @Delete('holidays/:id') @HttpCode(204) @RequirePermissions(Permission.AcademicWrite)
  async removeHoliday(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.removeHoliday(a, id, m);
  }
}

@Module({ controllers: [TeachingController], providers: [TeachingService], exports: [TeachingService] })
export class TeachingModule {}
