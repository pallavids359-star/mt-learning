import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { asc, count, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { InjectDb, type Database } from '../db/db.module';
import { hostels, staffUsers, students } from '../db/schema';

export class CreateHostelDto {
  @ApiProperty({ example: 'Boys Hostel A' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() wardenId?: string | null;
}

export class UpdateHostelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() wardenId?: string | null;
}

@Injectable()
export class HostelsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db
      .select({
        id: hostels.id,
        name: hostels.name,
        wardenId: hostels.wardenId,
        wardenName: staffUsers.fullName,
        studentCount: sql<number>`(select count(*)::int from ${students} where ${students.hostelId} = ${hostels.id} and ${students.status} <> 'DEACTIVATED')`,
      })
      .from(hostels)
      .leftJoin(staffUsers, eq(staffUsers.id, hostels.wardenId))
      .orderBy(asc(hostels.name));
  }

  async create(actor: StaffPrincipal, dto: CreateHostelDto, meta: RequestMeta) {
    if (dto.wardenId) await this.assertWarden(dto.wardenId);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(hostels).values({ name: dto.name, wardenId: dto.wardenId ?? null }).returning();
      await this.audit.record(actor, { action: 'hostel.create', entityType: 'hostel', entityId: row.id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateHostelDto, meta: RequestMeta) {
    if (dto.wardenId) await this.assertWarden(dto.wardenId);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(hostels).set(dto).where(eq(hostels.id, id)).returning();
      if (!row) throw new NotFoundException('Hostel not found');
      await this.audit.record(actor, { action: 'hostel.update', entityType: 'hostel', entityId: id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  private async assertWarden(id: string) {
    const [u] = await this.db.select({ role: staffUsers.role }).from(staffUsers).where(eq(staffUsers.id, id));
    if (!u || u.role !== 'HOSTEL_WARDEN') throw new BadRequestException('The selected warden must be a staff member with the Hostel Warden role');
  }

  async total() {
    const [{ n }] = await this.db.select({ n: count() }).from(hostels);
    return n;
  }
}

@ApiTags('Hostels')
@ApiBearerAuth()
@Controller('hostels')
export class HostelsController {
  constructor(private readonly svc: HostelsService) {}

  @Get() @RequirePermissions(Permission.AcademicRead)
  list() {
    return this.svc.list();
  }

  @Post() @RequirePermissions(Permission.HostelsWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateHostelDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.HostelsWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHostelDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }
}

@Module({ controllers: [HostelsController], providers: [HostelsService], exports: [HostelsService] })
export class HostelsModule {}
