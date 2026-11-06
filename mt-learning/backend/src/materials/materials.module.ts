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
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { and, asc, count, desc, eq, ilike, isNotNull, or, sql, SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import { CurrentStaff, CurrentStudent, ReqMeta, RequirePermissions, StudentOnly } from '../common/decorators';
import { likePattern, pageOf, PageQueryDto } from '../common/dto/pagination.dto';
import { Permission } from '../common/permissions';
import { ScopeService } from '../common/scope.service';
import { DOC_MIME, headOf, sniffDocument, StorageService } from '../common/utils/storage.service';
import { loadEnv } from '../config/env';
import { InjectDb, type Database } from '../db/db.module';
import { classes, materialKind, materialProgress, materials, sections, staffUsers, students, subjects, type MaterialKind } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const KINDS = materialKind.enumValues;

export class CreateMaterialDto {
  @ApiProperty() @IsUUID() classId: string;
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiProperty({ example: 'Electric Charges and Fields' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) chapter: string;
  @ApiProperty({ example: 'Gauss’s law — class notes' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind: MaterialKind;
  @ApiPropertyOptional({ description: 'Required for LINK; optional streaming link for VIDEO' })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'externalUrl must be an https:// link' })
  externalUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) durationMin?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() allowOffline?: boolean;
}

export class UpdateMaterialDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) chapter?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'externalUrl must be an https:// link' })
  externalUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) durationMin?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOffline?: boolean;
}

export class MaterialQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
}

export class ProgressDto {
  @ApiProperty({ enum: ['opened', 'downloaded', 'completed'] }) @IsIn(['opened', 'downloaded', 'completed']) event: 'opened' | 'downloaded' | 'completed';
}

const listCols = {
  id: materials.id,
  classId: materials.classId,
  className: classes.name,
  subjectId: materials.subjectId,
  subjectCode: subjects.code,
  subjectName: subjects.name,
  chapter: materials.chapter,
  title: materials.title,
  description: materials.description,
  kind: materials.kind,
  hasFile: sql<boolean>`${materials.fileKey} is not null`,
  fileName: materials.fileName,
  mimeType: materials.mimeType,
  sizeBytes: materials.sizeBytes,
  durationMin: materials.durationMin,
  externalUrl: materials.externalUrl,
  allowOffline: materials.allowOffline,
  publishedAt: materials.publishedAt,
  createdByName: staffUsers.fullName,
  createdAt: materials.createdAt,
};

@Injectable()
export class MaterialsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly storage: StorageService,
  ) {}

  private base() {
    return this.db
      .select({
        ...listCols,
        completedCount: sql<number>`(select count(*)::int from ${materialProgress} mp where mp.material_id = ${materials.id} and mp.completed_at is not null)`,
        openedCount: sql<number>`(select count(*)::int from ${materialProgress} mp where mp.material_id = ${materials.id} and mp.opened_at is not null)`,
        studentCount: sql<number>`(select count(*)::int from ${students} s join ${sections} sec on sec.id = s.section_id where sec.class_id = ${materials.classId} and s.status = 'ACTIVE')`,
      })
      .from(materials)
      .innerJoin(classes, eq(classes.id, materials.classId))
      .innerJoin(subjects, eq(subjects.id, materials.subjectId))
      .leftJoin(staffUsers, eq(staffUsers.id, materials.createdBy))
      .$dynamic();
  }

  async list(q: MaterialQueryDto) {
    const where: SQL[] = [];
    if (q.classId) where.push(eq(materials.classId, q.classId));
    if (q.subjectId) where.push(eq(materials.subjectId, q.subjectId));
    if (q.search) {
      const p = likePattern(q.search);
      where.push(or(ilike(materials.title, p), ilike(materials.chapter, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const [items, [{ total }]] = await Promise.all([
      this.base().where(cond).orderBy(desc(materials.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(materials).where(cond),
    ]);
    return pageOf(items, total, q);
  }

  async get(id: string) {
    const [row] = await this.base().where(eq(materials.id, id));
    if (!row) throw new NotFoundException('Material not found');
    return row;
  }

  async create(actor: StaffPrincipal, dto: CreateMaterialDto, meta: RequestMeta) {
    await this.scope.assertTeaches(actor, dto.classId, dto.subjectId);
    if (dto.kind === 'LINK' && !dto.externalUrl) throw new BadRequestException('A link material needs an externalUrl');
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(materials)
        .values({
          ...dto,
          description: dto.description ?? null,
          externalUrl: dto.externalUrl ?? null,
          durationMin: dto.durationMin ?? null,
          allowOffline: dto.kind === 'LINK' ? false : (dto.allowOffline ?? true),
          createdBy: actor.id,
        })
        .returning({ id: materials.id });
      await this.audit.record(actor, { action: 'material.create', entityType: 'material', entityId: row.id, metadata: { title: dto.title } }, meta, tx);
      return row.id;
    });
    return this.get(id);
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateMaterialDto, meta: RequestMeta) {
    const m = await this.get(id);
    await this.scope.assertTeaches(actor, m.classId, m.subjectId);
    await this.db.transaction(async (tx) => {
      await tx.update(materials).set(dto).where(eq(materials.id, id));
      await this.audit.record(actor, { action: 'material.update', entityType: 'material', entityId: id, metadata: { fields: Object.keys(dto) } }, meta, tx);
    });
    return this.get(id);
  }

  async remove(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const [m] = await this.db.select().from(materials).where(eq(materials.id, id));
    if (!m) throw new NotFoundException('Material not found');
    await this.scope.assertTeaches(actor, m.classId, m.subjectId);
    await this.db.transaction(async (tx) => {
      await tx.delete(materials).where(eq(materials.id, id));
      await this.audit.record(actor, { action: 'material.delete', entityType: 'material', entityId: id, metadata: { title: m.title } }, meta, tx);
    });
    if (m.fileKey) await this.storage.remove(m.fileKey);
  }

  /** Stores the uploaded file after checking its real type matches the material kind. */
  async attachFile(actor: StaffPrincipal, id: string, file: Express.Multer.File | undefined, meta: RequestMeta) {
    try {
      if (!file?.path) throw new BadRequestException('Attach the file in the "file" field');
      const [m] = await this.db.select().from(materials).where(eq(materials.id, id));
      if (!m) throw new NotFoundException('Material not found');
      await this.scope.assertTeaches(actor, m.classId, m.subjectId);
      if (m.kind === 'LINK') throw new BadRequestException('Link materials do not have a file');
      const type = sniffDocument(await headOf(file.path));
      const okFor: Record<Exclude<MaterialKind, 'LINK'>, string[]> = { PDF: ['pdf'], SLIDES: ['pdf'], VIDEO: ['mp4', 'webm'] };
      if (!type || !okFor[m.kind as Exclude<MaterialKind, 'LINK'>].includes(type)) {
        throw new BadRequestException(
          m.kind === 'VIDEO' ? 'Videos must be MP4 or WebM files' : 'Notes and slides must be PDF files (export slides to PDF first)',
        );
      }
      const key = `materials/${id}/${randomUUID()}.${type}`;
      await this.storage.moveIn(key, file.path);
      const original = (file.originalname || `file.${type}`).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
      await this.db.transaction(async (tx) => {
        await tx
          .update(materials)
          .set({ fileKey: key, fileName: original, mimeType: DOC_MIME[type], sizeBytes: file.size })
          .where(eq(materials.id, id));
        await this.audit.record(actor, { action: 'material.file', entityType: 'material', entityId: id, metadata: { sizeBytes: file.size, type } }, meta, tx);
      });
      if (m.fileKey && m.fileKey !== key) await this.storage.remove(m.fileKey);
      return this.get(id);
    } finally {
      if (file?.path) await rm(file.path, { force: true });
    }
  }

  async setPublished(actor: StaffPrincipal, id: string, publish: boolean, meta: RequestMeta) {
    const [m] = await this.db.select().from(materials).where(eq(materials.id, id));
    if (!m) throw new NotFoundException('Material not found');
    await this.scope.assertTeaches(actor, m.classId, m.subjectId);
    if (publish && m.kind !== 'LINK' && !m.fileKey && !m.externalUrl) throw new BadRequestException('Upload the file before publishing');
    await this.db.transaction(async (tx) => {
      await tx.update(materials).set({ publishedAt: publish ? (m.publishedAt ?? new Date()) : null }).where(eq(materials.id, id));
      await this.audit.record(actor, { action: publish ? 'material.publish' : 'material.unpublish', entityType: 'material', entityId: id, metadata: { title: m.title } }, meta, tx);
    });
    return this.get(id);
  }

  async staffFile(id: string, res: Response) {
    const [m] = await this.db.select().from(materials).where(eq(materials.id, id));
    if (!m?.fileKey) throw new NotFoundException('No file');
    return this.send(m, res);
  }

  // ------------------------------------------------------------ student side

  async forStudent(studentId: string) {
    const ctx = await this.scope.student(studentId);
    return this.db
      .select({
        ...listCols,
        openedAt: materialProgress.openedAt,
        downloadedAt: materialProgress.downloadedAt,
        completedAt: materialProgress.completedAt,
      })
      .from(materials)
      .innerJoin(classes, eq(classes.id, materials.classId))
      .innerJoin(subjects, eq(subjects.id, materials.subjectId))
      .leftJoin(staffUsers, eq(staffUsers.id, materials.createdBy))
      .leftJoin(materialProgress, and(eq(materialProgress.materialId, materials.id), eq(materialProgress.studentId, studentId)))
      .where(and(eq(materials.classId, ctx.classId), isNotNull(materials.publishedAt)))
      .orderBy(asc(subjects.name), desc(materials.publishedAt));
  }

  private async studentMaterial(studentId: string, id: string) {
    const ctx = await this.scope.student(studentId);
    const [m] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, id), eq(materials.classId, ctx.classId), isNotNull(materials.publishedAt)));
    if (!m) throw new NotFoundException('Material not found');
    return m;
  }

  async studentFile(student: StudentPrincipal, id: string, res: Response) {
    const m = await this.studentMaterial(student.id, id);
    if (!m.fileKey) throw new NotFoundException('This material has no file');
    return this.send(m, res);
  }

  async progress(student: StudentPrincipal, id: string, event: ProgressDto['event']) {
    const m = await this.studentMaterial(student.id, id);
    if (event === 'downloaded' && !m.allowOffline) throw new BadRequestException('This material cannot be downloaded');
    const now = new Date();
    // Each timestamp records the first time it happened; repeats keep the original time.
    await this.db
      .insert(materialProgress)
      .values({
        studentId: student.id,
        materialId: id,
        openedAt: event === 'downloaded' ? null : now,
        downloadedAt: event === 'downloaded' ? now : null,
        completedAt: event === 'completed' ? now : null,
      })
      .onConflictDoUpdate({
        target: [materialProgress.studentId, materialProgress.materialId],
        set: {
          openedAt: sql`coalesce(${materialProgress.openedAt}, excluded.opened_at)`,
          downloadedAt: sql`coalesce(${materialProgress.downloadedAt}, excluded.downloaded_at)`,
          completedAt: sql`coalesce(${materialProgress.completedAt}, excluded.completed_at)`,
        },
      });
    return { ok: true };
  }

  private async send(m: typeof materials.$inferSelect, res: Response) {
    const full = await this.storage.pathOf(m.fileKey!);
    if (!full) throw new NotFoundException('The file is missing from storage');
    res.setHeader('Content-Type', m.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(m.fileName ?? 'material')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // sendFile handles HTTP Range requests, so videos can seek and downloads can resume.
    await new Promise<void>((resolve, reject) => res.sendFile(full, { acceptRanges: true, dotfiles: 'deny' }, (err) => (err ? reject(err) : resolve())));
  }
}

const uploadInterceptor = () => {
  const env = loadEnv();
  return FileInterceptor('file', {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.resolve(env.STORAGE_DIR, '.uploads');
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`),
    }),
  });
};

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Study materials')
@ApiBearerAuth()
@Controller('materials')
export class MaterialsController {
  constructor(private readonly svc: MaterialsService) {}

  @Get() @RequirePermissions(Permission.MaterialsRead)
  list(@Query() q: MaterialQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id') @RequirePermissions(Permission.MaterialsRead)
  get(@Id() id: string) {
    return this.svc.get(id);
  }

  @Get(':id/file') @RequirePermissions(Permission.MaterialsRead)
  file(@Id() id: string, @Res() res: Response) {
    return this.svc.staffFile(id, res);
  }

  @Post() @RequirePermissions(Permission.MaterialsWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateMaterialDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.MaterialsWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateMaterialDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(Permission.MaterialsWrite)
  async remove(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.remove(a, id, m);
  }

  @Post(':id/file')
  @HttpCode(200)
  @RequirePermissions(Permission.MaterialsWrite)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(uploadInterceptor())
  upload(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @UploadedFile() file: Express.Multer.File, @ReqMeta() m: RequestMeta) {
    return this.svc.attachFile(a, id, file, m);
  }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions(Permission.MaterialsWrite)
  publish(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.setPublished(a, id, true, m);
  }

  @Post(':id/unpublish') @HttpCode(200) @RequirePermissions(Permission.MaterialsWrite)
  unpublish(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.setPublished(a, id, false, m);
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me/materials')
export class StudentMaterialsController {
  constructor(private readonly svc: MaterialsService) {}

  @Get()
  list(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.forStudent(me.id);
  }

  @Get(':id/file')
  file(@CurrentStudent() me: StudentPrincipal, @Id() id: string, @Res() res: Response) {
    return this.svc.studentFile(me, id, res);
  }

  @Post(':id/progress') @HttpCode(200)
  progress(@CurrentStudent() me: StudentPrincipal, @Id() id: string, @Body() dto: ProgressDto) {
    return this.svc.progress(me, id, dto.event);
  }
}

@Module({ controllers: [MaterialsController, StudentMaterialsController], providers: [MaterialsService], exports: [MaterialsService] })
export class MaterialsModule {}
