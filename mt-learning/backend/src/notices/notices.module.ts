import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { and, count, desc, eq, gt, isNull, lte, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import { CurrentStaff, CurrentStudent, ReqMeta, RequirePermissions, StudentOnly } from '../common/decorators';
import { pageOf, PageQueryDto } from '../common/dto/pagination.dto';
import { Permission } from '../common/permissions';
import { ScopeService } from '../common/scope.service';
import { InjectDb, type Database } from '../db/db.module';
import {
  audienceType,
  classes,
  hostels,
  noticeCategory,
  noticeReads,
  notices,
  sections,
  students,
  type AudienceType,
  type NoticeCategory,
} from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateNoticeDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(5000) body: string;
  @ApiProperty({ enum: noticeCategory.enumValues }) @IsIn(noticeCategory.enumValues) category: NoticeCategory;
  @ApiProperty({ enum: audienceType.enumValues }) @IsIn(audienceType.enumValues) audienceType: AudienceType;
  @ApiPropertyOptional() @ValidateIf((o) => o.audienceType !== 'ALL') @IsUUID() audienceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string;
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'College Administrator',
  COLLEGE_ADMIN: 'College Administrator',
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  EXAM_COORDINATOR: 'Examination Coordinator',
  HOSTEL_WARDEN: 'Hostel Warden',
  DEVICE_ADMIN: 'Device Administrator',
};

@Injectable()
export class NoticesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** SQL condition for students who are in a notice's audience. */
  private audienceCount(n: typeof notices.$inferSelect) {
    const active = eq(students.status, 'ACTIVE');
    const q = this.db.select({ n: count() }).from(students).innerJoin(sections, eq(sections.id, students.sectionId));
    switch (n.audienceType) {
      case 'ALL':
        return q.where(active);
      case 'CLASS':
        return q.where(and(active, eq(sections.classId, n.audienceId!)));
      case 'SECTION':
        return q.where(and(active, eq(students.sectionId, n.audienceId!)));
      case 'HOSTEL':
        return q.where(and(active, eq(students.hostelId, n.audienceId!)));
    }
  }

  private async audienceName(type: AudienceType, id: string | null) {
    if (type === 'ALL' || !id) return 'All students';
    if (type === 'CLASS') return (await this.db.select({ n: classes.name }).from(classes).where(eq(classes.id, id)))[0]?.n ?? 'Class';
    if (type === 'SECTION') {
      const [r] = await this.db.select({ c: classes.name, s: sections.name }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, id));
      return r ? `${r.c} · ${r.s}` : 'Section';
    }
    return (await this.db.select({ n: hostels.name }).from(hostels).where(eq(hostels.id, id)))[0]?.n ?? 'Hostel';
  }

  async list(q: PageQueryDto) {
    const where = q.search ? sql`${notices.title} ilike ${'%' + q.search.trim() + '%'}` : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          notice: notices,
          readCount: sql<number>`(select count(*)::int from ${noticeReads} r where r.notice_id = ${notices.id})`,
        })
        .from(notices)
        .where(where)
        .orderBy(desc(notices.publishedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(notices).where(where),
    ]);
    const items = await Promise.all(
      rows.map(async ({ notice, readCount }) => {
        const [{ n }] = await this.audienceCount(notice);
        return { ...notice, readCount, audienceSize: n, audienceName: await this.audienceName(notice.audienceType, notice.audienceId) };
      }),
    );
    return pageOf(items, total, q);
  }

  async create(actor: StaffPrincipal, dto: CreateNoticeDto, meta: RequestMeta) {
    await this.assertAudience(actor, dto.audienceType, dto.audienceId ?? null);
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) throw new BadRequestException('The expiry time must be in the future');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(notices)
        .values({
          title: dto.title,
          body: dto.body,
          category: dto.category,
          audienceType: dto.audienceType,
          audienceId: dto.audienceType === 'ALL' ? null : dto.audienceId!,
          postedBy: actor.id,
          postedByLabel: `${actor.name} · ${ROLE_LABEL[actor.role]}`,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        })
        .returning();
      await this.audit.record(actor, { action: 'notice.create', entityType: 'notice', entityId: row.id, metadata: { title: dto.title, audience: dto.audienceType } }, meta, tx);
      return row;
    });
  }

  async remove(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const [n] = await this.db.select().from(notices).where(eq(notices.id, id));
    if (!n) throw new NotFoundException('Notice not found');
    const admin = actor.role === 'SUPER_ADMIN' || actor.role === 'COLLEGE_ADMIN' || actor.role === 'PRINCIPAL';
    if (!admin && n.postedBy !== actor.id) throw new ForbiddenException('You can only withdraw notices you posted');
    await this.db.transaction(async (tx) => {
      await tx.delete(notices).where(eq(notices.id, id));
      await this.audit.record(actor, { action: 'notice.delete', entityType: 'notice', entityId: id, metadata: { title: n.title } }, meta, tx);
    });
  }

  // ------------------------------------------------------------ student

  private async visibleWhere(studentId: string): Promise<SQL> {
    const ctx = await this.scope.student(studentId);
    const now = new Date();
    const audience = or(
      eq(notices.audienceType, 'ALL'),
      and(eq(notices.audienceType, 'CLASS'), eq(notices.audienceId, ctx.classId)),
      and(eq(notices.audienceType, 'SECTION'), eq(notices.audienceId, ctx.sectionId)),
      ctx.hostelId ? and(eq(notices.audienceType, 'HOSTEL'), eq(notices.audienceId, ctx.hostelId)) : sql`false`,
    )!;
    return and(audience, lte(notices.publishedAt, now), or(isNull(notices.expiresAt), gt(notices.expiresAt, now)))!;
  }

  async forStudent(studentId: string, limit = 100) {
    const where = await this.visibleWhere(studentId);
    return this.db
      .select({
        id: notices.id,
        title: notices.title,
        body: notices.body,
        category: notices.category,
        postedByLabel: notices.postedByLabel,
        publishedAt: notices.publishedAt,
        readAt: noticeReads.readAt,
      })
      .from(notices)
      .leftJoin(noticeReads, and(eq(noticeReads.noticeId, notices.id), eq(noticeReads.studentId, studentId)))
      .where(where)
      .orderBy(desc(notices.publishedAt))
      .limit(limit);
  }

  async markRead(student: StudentPrincipal, id: string) {
    const where = await this.visibleWhere(student.id);
    const [n] = await this.db.select({ id: notices.id }).from(notices).where(and(eq(notices.id, id), where));
    if (!n) throw new NotFoundException('Notice not found');
    await this.db.insert(noticeReads).values({ noticeId: id, studentId: student.id }).onConflictDoNothing();
    return { ok: true };
  }

  // ------------------------------------------------------------ scope

  /**
   * Administrators, the principal and the exam coordinator may address anyone.
   * Teachers may address only classes or sections they teach; wardens only their hostels.
   */
  private async assertAudience(actor: StaffPrincipal, type: AudienceType, id: string | null) {
    if (type !== 'ALL' && !id) throw new BadRequestException('Choose who the notice is for');
    if (type === 'CLASS' && !(await this.db.select({ id: classes.id }).from(classes).where(eq(classes.id, id!))).length) throw new BadRequestException('Class does not exist');
    if (type === 'SECTION' && !(await this.db.select({ id: sections.id }).from(sections).where(eq(sections.id, id!))).length) throw new BadRequestException('Section does not exist');
    if (type === 'HOSTEL' && !(await this.db.select({ id: hostels.id }).from(hostels).where(eq(hostels.id, id!))).length) throw new BadRequestException('Hostel does not exist');

    if (actor.role === 'TEACHER') {
      if (type === 'ALL' || type === 'HOSTEL') throw new ForbiddenException('Teachers can post notices to their own classes and sections only');
      const classId = type === 'CLASS' ? id! : (await this.db.select({ c: sections.classId }).from(sections).where(eq(sections.id, id!)))[0].c;
      await this.scope.assertTeachesClass(actor, classId);
    }
    if (actor.role === 'HOSTEL_WARDEN') {
      if (type !== 'HOSTEL') throw new ForbiddenException('Wardens can post notices to their own hostel only');
      await this.scope.assertWardenOf(actor, id!);
    }
  }
}

@ApiTags('Notices')
@ApiBearerAuth()
@Controller('notices')
export class NoticesController {
  constructor(private readonly svc: NoticesService) {}

  @Get() @RequirePermissions(Permission.NoticesRead)
  list(@Query() q: PageQueryDto) {
    return this.svc.list(q);
  }

  @Post() @RequirePermissions(Permission.NoticesWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateNoticeDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(Permission.NoticesWrite)
  async remove(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.remove(a, id, m);
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me/notices')
export class StudentNoticesController {
  constructor(private readonly svc: NoticesService) {}

  @Get()
  list(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.forStudent(me.id);
  }

  @Post(':id/read') @HttpCode(200)
  read(@CurrentStudent() me: StudentPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(me, id);
  }
}

@Module({ controllers: [NoticesController, StudentNoticesController], providers: [NoticesService], exports: [NoticesService] })
export class NoticesModule {}
