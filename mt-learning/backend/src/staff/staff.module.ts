import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { and, asc, count, eq, ilike, or, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { likePattern, pageOf, PageQueryDto } from '../common/dto/pagination.dto';
import { canManageRole, Permission } from '../common/permissions';
import { hashSecret, temporaryPassword } from '../common/utils/secrets';
import { InjectDb, type Database } from '../db/db.module';
import { accountStatus, staffRole, staffUsers, type AccountStatus, type StaffRole } from '../db/schema';

const ROLES = staffRole.enumValues;
const STATUSES = accountStatus.enumValues;
const phone = /^[+0-9][0-9 \-]{6,19}$/;

export class CreateStaffDto {
  @ApiProperty() @Transform(({ value }) => String(value).trim().toLowerCase()) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @Transform(({ value }) => String(value).trim()) @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @ApiPropertyOptional() @IsOptional() @Matches(phone, { message: 'Invalid phone number' }) phone?: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role: StaffRole;
}

export class UpdateStaffDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => String(value).trim()) @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(phone, { message: 'Invalid phone number' }) phone?: string;
  @ApiPropertyOptional({ enum: ROLES }) @IsOptional() @IsIn(ROLES) role?: StaffRole;
}

export class StaffStatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status: AccountStatus;
}

export class StaffQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ROLES }) @IsOptional() @IsIn(ROLES) role?: StaffRole;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: AccountStatus;
}

const publicCols = {
  id: staffUsers.id,
  email: staffUsers.email,
  fullName: staffUsers.fullName,
  phone: staffUsers.phone,
  role: staffUsers.role,
  status: staffUsers.status,
  mustChangePassword: staffUsers.mustChangePassword,
  lastLoginAt: staffUsers.lastLoginAt,
  createdAt: staffUsers.createdAt,
};

@Injectable()
export class StaffService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(q: StaffQueryDto) {
    const where: SQL[] = [];
    if (q.role) where.push(eq(staffUsers.role, q.role));
    if (q.status) where.push(eq(staffUsers.status, q.status));
    if (q.search) {
      const p = likePattern(q.search);
      where.push(or(ilike(staffUsers.fullName, p), ilike(staffUsers.email, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(publicCols)
        .from(staffUsers)
        .where(cond)
        .orderBy(asc(staffUsers.fullName))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(staffUsers).where(cond),
    ]);
    return pageOf(items, total, q);
  }

  async get(id: string) {
    const [row] = await this.db.select(publicCols).from(staffUsers).where(eq(staffUsers.id, id));
    if (!row) throw new NotFoundException('Staff member not found');
    return row;
  }

  async create(actor: StaffPrincipal, dto: CreateStaffDto, meta: RequestMeta) {
    this.assertCanManage(actor, dto.role);
    const tempPassword = temporaryPassword(12);
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(staffUsers)
        .values({ ...dto, passwordHash: await hashSecret(tempPassword), mustChangePassword: true })
        .returning(publicCols);
      await this.audit.record(
        actor,
        { action: 'staff.create', entityType: 'staff', entityId: row.id, metadata: { email: row.email, role: row.role } },
        meta,
        tx,
      );
      return row;
    });
    return { staff: created, temporaryPassword: tempPassword };
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateStaffDto, meta: RequestMeta) {
    const current = await this.get(id);
    this.assertCanManage(actor, current.role);
    if (dto.role) this.assertCanManage(actor, dto.role);
    if (id === actor.id && dto.role && dto.role !== current.role) {
      throw new ForbiddenException('You cannot change your own role');
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(staffUsers).set(dto).where(eq(staffUsers.id, id)).returning(publicCols);
      if (dto.role && dto.role !== current.role) await this.auth.revokeAllSessions(tx, { staffId: id });
      await this.audit.record(actor, { action: 'staff.update', entityType: 'staff', entityId: id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  async setStatus(actor: StaffPrincipal, id: string, status: AccountStatus, meta: RequestMeta) {
    const current = await this.get(id);
    this.assertCanManage(actor, current.role);
    if (id === actor.id) throw new ForbiddenException('You cannot change the status of your own account');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(staffUsers).set({ status }).where(eq(staffUsers.id, id)).returning(publicCols);
      if (status !== 'ACTIVE') await this.auth.revokeAllSessions(tx, { staffId: id });
      await this.audit.record(
        actor,
        { action: 'staff.status', entityType: 'staff', entityId: id, metadata: { from: current.status, to: status } },
        meta,
        tx,
      );
      return row;
    });
  }

  async resetPassword(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const current = await this.get(id);
    this.assertCanManage(actor, current.role);
    const tempPassword = temporaryPassword(12);
    await this.db.transaction(async (tx) => {
      await tx
        .update(staffUsers)
        .set({ passwordHash: await hashSecret(tempPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
        .where(eq(staffUsers.id, id));
      await this.auth.revokeAllSessions(tx, { staffId: id });
      await this.audit.record(actor, { action: 'staff.password_reset', entityType: 'staff', entityId: id }, meta, tx);
    });
    return { temporaryPassword: tempPassword };
  }

  private assertCanManage(actor: StaffPrincipal, target: StaffRole) {
    if (!canManageRole(actor.role, target)) throw new ForbiddenException('You cannot manage staff with this role');
  }
}

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions(Permission.StaffRead)
  list(@Query() q: StaffQueryDto) {
    return this.staff.list(q);
  }

  @Get(':id')
  @RequirePermissions(Permission.StaffRead)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(id);
  }

  @Post()
  @RequirePermissions(Permission.StaffWrite)
  create(@CurrentStaff() actor: StaffPrincipal, @Body() dto: CreateStaffDto, @ReqMeta() meta: RequestMeta) {
    return this.staff.create(actor, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions(Permission.StaffWrite)
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.staff.update(actor, id, dto, meta);
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.StaffWrite)
  setStatus(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffStatusDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.staff.setStatus(actor, id, dto.status, meta);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.StaffWrite)
  resetPassword(@CurrentStaff() actor: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.staff.resetPassword(actor, id, meta);
  }
}

@Module({ controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
