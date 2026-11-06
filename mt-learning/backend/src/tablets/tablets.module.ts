import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { and, asc, count, eq, ilike, isNull, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { likePattern, pageOf, PageQueryDto } from '../common/dto/pagination.dto';
import { Permission } from '../common/permissions';
import { InjectDb, type Database } from '../db/db.module';
import { students, tablets, tabletStatus, type TabletStatus } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const MANUAL_STATUSES = ['IN_STOCK', 'UNDER_REPAIR', 'LOST', 'RETIRED'] as const;

export class CreateTabletDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @IsString() @MinLength(3) @MaxLength(100) serialNumber: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) assetTag?: string | null;
  @ApiProperty({ example: 'Samsung Galaxy Tab A9+' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) model: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) androidVersion?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateTabletDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) assetTag?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) model?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) androidVersion?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) notes?: string | null;
}

export class AssignTabletDto {
  @ApiProperty() @IsUUID() studentId: string;
}

export class TabletStatusDto {
  @ApiProperty({ enum: MANUAL_STATUSES }) @IsIn(MANUAL_STATUSES) status: (typeof MANUAL_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}

export class TabletQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: tabletStatus.enumValues }) @IsOptional() @IsIn(tabletStatus.enumValues) status?: TabletStatus;
}

const cols = {
  id: tablets.id,
  serialNumber: tablets.serialNumber,
  assetTag: tablets.assetTag,
  model: tablets.model,
  androidVersion: tablets.androidVersion,
  appVersion: tablets.appVersion,
  status: tablets.status,
  assignedAt: tablets.assignedAt,
  lastSeenAt: tablets.lastSeenAt,
  notes: tablets.notes,
  createdAt: tablets.createdAt,
  student: { id: students.id, studentCode: students.studentCode, fullName: students.fullName },
};

@Injectable()
export class TabletsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private query() {
    return this.db.select(cols).from(tablets).leftJoin(students, eq(students.id, tablets.studentId)).$dynamic();
  }

  private view<T extends { student: { id: string | null } | null }>(row: T) {
    return { ...row, student: row.student?.id ? row.student : null };
  }

  async list(q: TabletQueryDto) {
    const where: SQL[] = [];
    if (q.status) where.push(eq(tablets.status, q.status));
    if (q.search) {
      const p = likePattern(q.search);
      where.push(or(ilike(tablets.serialNumber, p), ilike(tablets.assetTag, p), ilike(tablets.model, p), ilike(students.fullName, p), ilike(students.studentCode, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.query().where(cond).orderBy(asc(tablets.serialNumber)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(tablets).leftJoin(students, eq(students.id, tablets.studentId)).where(cond),
    ]);
    return pageOf(rows.map((r) => this.view(r)), total, q);
  }

  async get(id: string) {
    const [row] = await this.query().where(eq(tablets.id, id));
    if (!row) throw new NotFoundException('Tablet not found');
    return this.view(row);
  }

  async create(actor: StaffPrincipal, dto: CreateTabletDto, meta: RequestMeta) {
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(tablets).values(dto).returning({ id: tablets.id });
      await this.audit.record(actor, { action: 'tablet.enroll', entityType: 'tablet', entityId: row.id, metadata: { serialNumber: dto.serialNumber } }, meta, tx);
      return row.id;
    });
    return this.get(id);
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateTabletDto, meta: RequestMeta) {
    await this.get(id);
    await this.db.transaction(async (tx) => {
      await tx.update(tablets).set(dto).where(eq(tablets.id, id));
      await this.audit.record(actor, { action: 'tablet.update', entityType: 'tablet', entityId: id, metadata: { ...dto } }, meta, tx);
    });
    return this.get(id);
  }

  async assign(actor: StaffPrincipal, id: string, studentId: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tablets).where(eq(tablets.id, id)).for('update');
      if (!t) throw new NotFoundException('Tablet not found');
      if (t.status !== 'IN_STOCK') throw new ConflictException('Only tablets that are in stock can be assigned. Unassign it first.');
      const [s] = await tx.select({ id: students.id, status: students.status }).from(students).where(eq(students.id, studentId));
      if (!s) throw new BadRequestException('Student does not exist');
      if (s.status !== 'ACTIVE') throw new ConflictException('Only active students can be assigned a tablet');
      const [existing] = await tx.select({ serial: tablets.serialNumber }).from(tablets).where(eq(tablets.studentId, studentId));
      if (existing) throw new ConflictException(`This student already has tablet ${existing.serial}. Unassign it first.`);
      await tx.update(tablets).set({ studentId, status: 'ASSIGNED', assignedAt: new Date() }).where(eq(tablets.id, id));
      await this.audit.record(actor, { action: 'tablet.assign', entityType: 'tablet', entityId: id, metadata: { studentId } }, meta, tx);
    });
    return this.get(id);
  }

  async unassign(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tablets).where(eq(tablets.id, id)).for('update');
      if (!t) throw new NotFoundException('Tablet not found');
      if (!t.studentId) throw new ConflictException('This tablet is not assigned');
      await tx.update(tablets).set({ studentId: null, assignedAt: null, status: 'IN_STOCK' }).where(eq(tablets.id, id));
      // The student's sessions were bound to this device; sign them out.
      await this.auth.revokeAllSessions(tx, { studentId: t.studentId });
      await this.audit.record(actor, { action: 'tablet.unassign', entityType: 'tablet', entityId: id, metadata: { studentId: t.studentId } }, meta, tx);
    });
    return this.get(id);
  }

  /** Marks a tablet in stock, under repair, lost or retired. Any assignment is removed and the student signed out. */
  async setStatus(actor: StaffPrincipal, id: string, dto: TabletStatusDto, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tablets).where(eq(tablets.id, id)).for('update');
      if (!t) throw new NotFoundException('Tablet not found');
      if (t.status === 'RETIRED' && dto.status !== 'RETIRED') throw new ConflictException('A retired tablet cannot be returned to service');
      await tx.update(tablets).set({ status: dto.status, studentId: null, assignedAt: null }).where(eq(tablets.id, id));
      if (t.studentId) await this.auth.revokeAllSessions(tx, { studentId: t.studentId });
      await this.audit.record(
        actor,
        { action: 'tablet.status', entityType: 'tablet', entityId: id, metadata: { from: t.status, to: dto.status, studentId: t.studentId, reason: dto.reason ?? null } },
        meta,
        tx,
      );
    });
    return this.get(id);
  }

  /** Called by the student app to report it is alive. Only updates the tablet assigned to that student. */
  async heartbeat(studentId: string, serial: string, info: { appVersion?: string; androidVersion?: string }) {
    const [row] = await this.db
      .update(tablets)
      .set({ lastSeenAt: new Date(), ...(info.appVersion && { appVersion: info.appVersion }), ...(info.androidVersion && { androidVersion: info.androidVersion }) })
      .where(and(eq(tablets.studentId, studentId), sql`upper(${tablets.serialNumber}) = ${serial.toUpperCase()}`))
      .returning({ id: tablets.id });
    if (row) return { matched: true, action: 'NONE' as const };
    // The tablet is not (or no longer) this student's: if the office marked it lost or retired,
    // or it now belongs to someone else, the app signs out and wipes downloaded data.
    const [t] = await this.db
      .select({ status: tablets.status, studentId: tablets.studentId })
      .from(tablets)
      .where(sql`upper(${tablets.serialNumber}) = ${serial.toUpperCase()}`);
    const wipe = !!t && (t.status === 'LOST' || t.status === 'RETIRED' || (t.studentId !== null && t.studentId !== studentId));
    if (wipe) {
      await this.audit.record(
        { kind: 'system' },
        { action: 'tablet.remote_wipe', entityType: 'tablet', metadata: { serialNumber: serial.toUpperCase(), studentId, status: t.status } },
      );
    }
    return { matched: false, action: wipe ? ('SIGN_OUT_AND_WIPE' as const) : ('NONE' as const) };
  }

  async unassignedInStock() {
    const [{ n }] = await this.db.select({ n: count() }).from(tablets).where(and(eq(tablets.status, 'IN_STOCK'), isNull(tablets.studentId)));
    return n;
  }
}

@ApiTags('Tablets')
@ApiBearerAuth()
@Controller('tablets')
export class TabletsController {
  constructor(private readonly svc: TabletsService) {}

  @Get() @RequirePermissions(Permission.TabletsRead)
  list(@Query() q: TabletQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id') @RequirePermissions(Permission.TabletsRead)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Post() @RequirePermissions(Permission.TabletsWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateTabletDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.TabletsWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTabletDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }

  @Post(':id/assign') @HttpCode(200) @RequirePermissions(Permission.TabletsWrite)
  assign(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTabletDto, @ReqMeta() m: RequestMeta) {
    return this.svc.assign(a, id, dto.studentId, m);
  }

  @Post(':id/unassign') @HttpCode(200) @RequirePermissions(Permission.TabletsWrite)
  unassign(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.unassign(a, id, m);
  }

  @Patch(':id/status') @RequirePermissions(Permission.TabletsWrite)
  setStatus(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TabletStatusDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setStatus(a, id, dto, m);
  }
}

@Module({ controllers: [TabletsController], providers: [TabletsService], exports: [TabletsService] })
export class TabletsModule {}
