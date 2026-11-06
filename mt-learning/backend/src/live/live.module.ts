import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, asc, desc, eq, gte, isNull, lte, or, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal, RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import { AnyPrincipal, CurrentStaff, CurrentStudent, CurrentUser, ReqMeta, RequirePermissions, StudentOnly } from '../common/decorators';
import { Permission, roleHas } from '../common/permissions';
import { ScopeService } from '../common/scope.service';
import { loadEnv } from '../config/env';
import { InjectDb, type Database } from '../db/db.module';
import { classes, liveClasses, liveQuestions, materials, sections, staffUsers, subjects } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const JOIN_EARLY_MIN = 10;

export class CreateLiveDto {
  @ApiProperty() @IsUUID() classId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teacherId?: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiProperty() @IsISO8601({ strict: true }) startsAt: string;
  @ApiProperty() @IsISO8601({ strict: true }) endsAt: string;
  @ApiProperty({ example: 'https://meet.jit.si/mt-2puc-chemistry' })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'joinUrl must be an https:// meeting link' })
  joinUrl: string;
}

export class UpdateLiveDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) endsAt?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'joinUrl must be an https:// meeting link' })
  joinUrl?: string;
  @ApiPropertyOptional({ description: 'A published material holding the recording' }) @IsOptional() @IsUUID() recordingMaterialId?: string;
}

export class LiveQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
}

export class QuestionBodyDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) body: string;
}

type LiveState = 'scheduled' | 'live' | 'ended' | 'cancelled';
export function liveState(l: { startsAt: Date; endsAt: Date; cancelledAt: Date | null }, now = new Date()): LiveState {
  if (l.cancelledAt) return 'cancelled';
  if (now < l.startsAt) return 'scheduled';
  if (now <= l.endsAt) return 'live';
  return 'ended';
}

const cols = {
  id: liveClasses.id,
  classId: liveClasses.classId,
  className: classes.name,
  sectionId: liveClasses.sectionId,
  sectionName: sections.name,
  subjectId: liveClasses.subjectId,
  subjectCode: subjects.code,
  subjectName: subjects.name,
  teacherId: liveClasses.teacherId,
  teacherName: staffUsers.fullName,
  title: liveClasses.title,
  startsAt: liveClasses.startsAt,
  endsAt: liveClasses.endsAt,
  joinUrl: liveClasses.joinUrl,
  recordingMaterialId: liveClasses.recordingMaterialId,
  cancelledAt: liveClasses.cancelledAt,
};

@Injectable()
export class LiveService {
  private readonly allowedHosts = loadEnv()
    .LIVE_ALLOWED_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private base() {
    return this.db
      .select(cols)
      .from(liveClasses)
      .innerJoin(classes, eq(classes.id, liveClasses.classId))
      .innerJoin(subjects, eq(subjects.id, liveClasses.subjectId))
      .leftJoin(sections, eq(sections.id, liveClasses.sectionId))
      .leftJoin(staffUsers, eq(staffUsers.id, liveClasses.teacherId))
      .$dynamic();
  }

  private view<T extends { startsAt: Date; endsAt: Date; cancelledAt: Date | null }>(r: T) {
    return { ...r, state: liveState(r) };
  }

  async list(q: LiveQueryDto) {
    const where: SQL[] = [];
    if (q.from) where.push(gte(liveClasses.endsAt, new Date(q.from)));
    if (q.to) where.push(lte(liveClasses.startsAt, new Date(q.to)));
    if (q.classId) where.push(eq(liveClasses.classId, q.classId));
    const rows = await this.base().where(where.length ? and(...where) : undefined).orderBy(desc(liveClasses.startsAt)).limit(200);
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    const [r] = await this.base().where(eq(liveClasses.id, id));
    if (!r) throw new NotFoundException('Live class not found');
    return this.view(r);
  }

  async create(actor: StaffPrincipal, dto: CreateLiveDto, meta: RequestMeta) {
    await this.scope.assertTeaches(actor, dto.classId, dto.subjectId);
    this.checkTimes(new Date(dto.startsAt), new Date(dto.endsAt));
    this.checkUrl(dto.joinUrl);
    if (dto.sectionId) {
      const [s] = await this.db.select({ c: sections.classId }).from(sections).where(eq(sections.id, dto.sectionId));
      if (!s || s.c !== dto.classId) throw new BadRequestException('The section must belong to the class');
    }
    const teacherId = dto.teacherId ?? (actor.role === 'TEACHER' ? actor.id : null);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(liveClasses)
        .values({
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          subjectId: dto.subjectId,
          teacherId,
          title: dto.title,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          joinUrl: dto.joinUrl,
          createdBy: actor.id,
        })
        .returning({ id: liveClasses.id });
      await this.audit.record(actor, { action: 'live.create', entityType: 'live_class', entityId: row.id, metadata: { title: dto.title } }, meta, tx);
      return row.id;
    });
    return this.get(id);
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateLiveDto, meta: RequestMeta) {
    const l = await this.get(id);
    await this.scope.assertTeaches(actor, l.classId, l.subjectId);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : l.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : l.endsAt;
    if (dto.startsAt || dto.endsAt) this.checkTimes(startsAt, endsAt, false);
    if (dto.joinUrl) this.checkUrl(dto.joinUrl);
    if (dto.recordingMaterialId) {
      const [m] = await this.db.select({ c: materials.classId }).from(materials).where(eq(materials.id, dto.recordingMaterialId));
      if (!m || m.c !== l.classId) throw new BadRequestException('The recording must be a material of the same class');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(liveClasses).set({ ...dto, startsAt, endsAt }).where(eq(liveClasses.id, id));
      await this.audit.record(actor, { action: 'live.update', entityType: 'live_class', entityId: id, metadata: { fields: Object.keys(dto) } }, meta, tx);
    });
    return this.get(id);
  }

  async cancel(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const l = await this.get(id);
    await this.scope.assertTeaches(actor, l.classId, l.subjectId);
    if (l.state === 'ended') throw new BadRequestException('This class has already ended');
    await this.db.transaction(async (tx) => {
      await tx.update(liveClasses).set({ cancelledAt: new Date() }).where(eq(liveClasses.id, id));
      await this.audit.record(actor, { action: 'live.cancel', entityType: 'live_class', entityId: id, metadata: { title: l.title } }, meta, tx);
    });
    return this.get(id);
  }

  // ------------------------------------------------------------ student

  private async studentWhere(studentId: string) {
    const ctx = await this.scope.student(studentId);
    return and(eq(liveClasses.classId, ctx.classId), or(isNull(liveClasses.sectionId), eq(liveClasses.sectionId, ctx.sectionId)))!;
  }

  /** Classes from the last 7 days and the next 14. The meeting link is shown only while joining is open. */
  async forStudent(studentId: string) {
    const where = await this.studentWhere(studentId);
    const now = Date.now();
    const rows = await this.base()
      .where(and(where, gte(liveClasses.endsAt, new Date(now - 7 * 86_400_000)), lte(liveClasses.startsAt, new Date(now + 14 * 86_400_000))))
      .orderBy(asc(liveClasses.startsAt));
    return rows.map((r) => this.studentView(r));
  }

  async studentGet(studentId: string, id: string) {
    const where = await this.studentWhere(studentId);
    const [r] = await this.base().where(and(where, eq(liveClasses.id, id)));
    if (!r) throw new NotFoundException('Live class not found');
    return this.studentView(r);
  }

  private studentView<T extends { startsAt: Date; endsAt: Date; cancelledAt: Date | null; joinUrl: string }>(r: T) {
    const state = liveState(r);
    const joinOpen = state === 'live' || (state === 'scheduled' && r.startsAt.getTime() - Date.now() <= JOIN_EARLY_MIN * 60_000);
    const { joinUrl, ...rest } = r;
    return { ...rest, state, joinOpen, joinUrl: joinOpen ? joinUrl : null };
  }

  // ------------------------------------------------------------ questions (both sides)

  private async assertCanSee(user: AuthPrincipal, id: string) {
    if (user.kind === 'student') return this.studentGet(user.id, id);
    if (!roleHas(user.role, Permission.LiveRead)) throw new ForbiddenException();
    return this.get(id);
  }

  async questions(user: AuthPrincipal, id: string) {
    await this.assertCanSee(user, id);
    return this.db
      .select({ id: liveQuestions.id, authorType: liveQuestions.authorType, authorName: liveQuestions.authorName, body: liveQuestions.body, createdAt: liveQuestions.createdAt })
      .from(liveQuestions)
      .where(eq(liveQuestions.liveClassId, id))
      .orderBy(asc(liveQuestions.createdAt))
      .limit(500);
  }

  async ask(user: AuthPrincipal, id: string, body: string) {
    const l = await this.assertCanSee(user, id);
    if (l.state !== 'live' && l.state !== 'scheduled') throw new BadRequestException('Questions are closed for this class');
    if (user.kind === 'staff' && !roleHas(user.role, Permission.LiveWrite)) throw new ForbiddenException();
    const [row] = await this.db
      .insert(liveQuestions)
      .values({ liveClassId: id, authorType: user.kind === 'staff' ? 'STAFF' : 'STUDENT', authorId: user.id, authorName: user.name, body })
      .returning();
    return row;
  }

  // ------------------------------------------------------------ internals

  private checkTimes(startsAt: Date, endsAt: Date, mustBeFuture = true) {
    if (endsAt <= startsAt) throw new BadRequestException('The class must end after it starts');
    if (endsAt.getTime() - startsAt.getTime() > 6 * 3_600_000) throw new BadRequestException('A live class can last at most 6 hours');
    if (mustBeFuture && endsAt <= new Date()) throw new BadRequestException('The class has to end in the future');
  }

  /** Only approved meeting platforms, so tablets locked to the app never open arbitrary sites. */
  private checkUrl(url: string) {
    const host = new URL(url).hostname.toLowerCase();
    if (!this.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new BadRequestException(`Use a meeting link from an approved platform: ${this.allowedHosts.join(', ')}`);
    }
  }
}

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Live classes')
@ApiBearerAuth()
@Controller('live-classes')
export class LiveController {
  constructor(private readonly svc: LiveService) {}

  @Get() @RequirePermissions(Permission.LiveRead)
  list(@Query() q: LiveQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id') @RequirePermissions(Permission.LiveRead)
  get(@Id() id: string) {
    return this.svc.get(id);
  }

  @Post() @RequirePermissions(Permission.LiveWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateLiveDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.LiveWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateLiveDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions(Permission.LiveWrite)
  cancel(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.cancel(a, id, m);
  }
}

/** Questions are shared by staff and students, so this controller accepts either. */
@ApiTags('Live classes')
@ApiBearerAuth()
@AnyPrincipal()
@Controller()
export class LiveQuestionsController {
  constructor(private readonly svc: LiveService) {}

  @Get('live-classes/:id/questions')
  questions(@CurrentUser() u: AuthPrincipal, @Id() id: string) {
    return this.svc.questions(u, id);
  }

  @Post('live-classes/:id/questions')
  ask(@CurrentUser() u: AuthPrincipal, @Id() id: string, @Body() dto: QuestionBodyDto) {
    return this.svc.ask(u, id, dto.body);
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me/live-classes')
export class StudentLiveController {
  constructor(private readonly svc: LiveService) {}

  @Get()
  list(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.forStudent(me.id);
  }

  @Get(':id')
  get(@CurrentStudent() me: StudentPrincipal, @Id() id: string) {
    return this.svc.studentGet(me.id, id);
  }
}

@Module({ controllers: [LiveController, LiveQuestionsController, StudentLiveController], providers: [LiveService], exports: [LiveService] })
export class LiveModule {}
