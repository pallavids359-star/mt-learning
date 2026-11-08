import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { likePattern, pageOf } from '../common/dto/pagination.dto';
import { Permission, roleHas } from '../common/permissions';
import { hashSecret, temporaryPassword } from '../common/utils/secrets';
import { IMAGE_TYPES, sniffImage, StorageService } from '../common/utils/storage.service';
import { InjectDb, type Database } from '../db/db.module';
import { academicYears, classes, hostels, sections, students, tablets, testAttempts, type AccountStatus } from '../db/schema';
import {
  CreateStudentDto,
  ImportQueryDto,
  ImportRowDto,
  StudentQueryDto,
  TransferStudentDto,
  UpdateStudentDto,
} from './students.dto';

const MAX_IMPORT_ROWS = 2000;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Columns returned for a student. Credentials and lockout counters are never exposed. */
const studentCols = {
  id: students.id,
  studentCode: students.studentCode,
  fullName: students.fullName,
  dateOfBirth: students.dateOfBirth,
  gender: students.gender,
  hasPhoto: sql<boolean>`${students.photoUrl} is not null`,
  guardianName: students.guardianName,
  guardianPhone: students.guardianPhone,
  rollNumber: students.rollNumber,
  roomNumber: students.roomNumber,
  status: students.status,
  mustChangePassword: students.mustChangePassword,
  hasPin: sql<boolean>`${students.pinHash} is not null`,
  lockedUntil: students.lockedUntil,
  lastLoginAt: students.lastLoginAt,
  createdAt: students.createdAt,
  section: { id: sections.id, name: sections.name },
  classGroup: { id: classes.id, name: classes.name, pucYear: classes.pucYear, stream: classes.stream },
  hostel: { id: hostels.id, name: hostels.name },
  tablet: { id: tablets.id, serialNumber: tablets.serialNumber, model: tablets.model, lastSeenAt: tablets.lastSeenAt },
};

type StudentRow = Awaited<ReturnType<StudentsService['baseQuery']>>[number];

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: boolean;
  errors: { row: number; studentCode?: string; messages: string[] }[];
  created: number;
  credentials: { studentCode: string; fullName: string; temporaryPassword: string }[];
}

@Injectable()
export class StudentsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}

  private baseQuery() {
    return this.db
      .select(studentCols)
      .from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(hostels, eq(hostels.id, students.hostelId))
      .leftJoin(tablets, eq(tablets.studentId, students.id))
      .$dynamic();
  }

  /** Removes guardian contact and date of birth for roles without the sensitive-data permission. */
  private view(actor: StaffPrincipal, row: StudentRow) {
    const out = { ...row, hostel: row.hostel?.id ? row.hostel : null, tablet: row.tablet?.id ? row.tablet : null };
    if (!roleHas(actor.role, Permission.StudentsSensitiveRead)) {
      return { ...out, dateOfBirth: null, guardianName: null, guardianPhone: null };
    }
    return out;
  }

  async list(actor: StaffPrincipal, q: StudentQueryDto) {
    const where: SQL[] = [];
    if (q.classId) where.push(eq(classes.id, q.classId));
    if (q.sectionId) where.push(eq(students.sectionId, q.sectionId));
    if (q.hostelId) where.push(eq(students.hostelId, q.hostelId));
    if (q.residence === 'hostel') where.push(isNotNull(students.hostelId));
    if (q.residence === 'day') where.push(isNull(students.hostelId));
    if (q.gender) where.push(eq(students.gender, q.gender));
    if (q.status) where.push(eq(students.status, q.status));
    if (q.hasTablet === true) where.push(isNotNull(tablets.id));
    if (q.hasTablet === false) where.push(isNull(tablets.id));
    if (q.search) {
      const p = likePattern(q.search);
      where.push(or(ilike(students.fullName, p), ilike(students.studentCode, p), ilike(students.rollNumber, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total }], [counts]] = await Promise.all([
      this.baseQuery()
        .where(cond)
        .orderBy(asc(classes.name), asc(sections.name), sql`length(${students.rollNumber})`, asc(students.rollNumber))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(students)
        .innerJoin(sections, eq(sections.id, students.sectionId))
        .innerJoin(classes, eq(classes.id, sections.classId))
        .leftJoin(tablets, eq(tablets.studentId, students.id))
        .where(cond),
      // The tabs above the list: every student, hostel, day scholars, and those without a tablet.
      this.db
        .select({
          all: count(),
          hostel: sql<number>`count(*) filter (where ${students.hostelId} is not null)::int`,
          day: sql<number>`count(*) filter (where ${students.hostelId} is null)::int`,
          noTablet: sql<number>`count(*) filter (where ${tablets.id} is null)::int`,
        })
        .from(students)
        .leftJoin(tablets, eq(tablets.studentId, students.id)),
    ]);
    // Each student's average across live tests (only results that count: not waiting for review or rejected).
    const ids = rows.map((r) => r.id);
    const averages = ids.length
      ? await this.db
          .select({
            studentId: testAttempts.studentId,
            avg: sql<number | null>`round(avg(${testAttempts.score} / nullif(${testAttempts.maxScore}, 0)) * 1000) / 10`,
          })
          .from(testAttempts)
          .where(and(inArray(testAttempts.studentId, ids), isNotNull(testAttempts.submittedAt), sql`${testAttempts.reviewStatus} in ('NONE','ACCEPTED')`))
          .groupBy(testAttempts.studentId)
      : [];
    const avgOf = new Map(averages.map((a) => [a.studentId, a.avg === null ? null : Number(a.avg)]));
    return {
      ...pageOf(
        rows.map((r) => ({ ...this.view(actor, r), averagePercent: avgOf.get(r.id) ?? null })),
        total,
        q,
      ),
      counts,
    };
  }

  async get(actor: StaffPrincipal, id: string) {
    const [row] = await this.baseQuery().where(eq(students.id, id));
    if (!row) throw new NotFoundException('Student not found');
    return this.view(actor, row);
  }

  async create(actor: StaffPrincipal, dto: CreateStudentDto, meta: RequestMeta) {
    if (dto.sectionId) await this.assertSection(dto.sectionId);
    if (dto.hostelId) await this.assertHostel(dto.hostelId);
    const { pucYear: year, sectionName, sectionId: givenSection, rollNumber, ...rest } = dto;
    const tempPassword = temporaryPassword();
    const id = await this.db.transaction(async (tx) => {
      const sectionId = givenSection ?? (await this.sectionFor(tx, year!, sectionName ?? 'A'));
      const [row] = await tx
        .insert(students)
        .values({
          ...rest,
          sectionId,
          rollNumber: rollNumber || rollFromCode(dto.studentCode),
          passwordHash: await hashSecret(tempPassword),
          mustChangePassword: true,
        })
        .returning({ id: students.id });
      await this.audit.record(
        actor,
        { action: 'student.create', entityType: 'student', entityId: row.id, metadata: { studentCode: dto.studentCode } },
        meta,
        tx,
      );
      return row.id;
    });
    return { student: await this.get(actor, id), temporaryPassword: tempPassword };
  }

  /**
   * "Class 11" or "Class 12", section A, B, ... in the current academic year. The year, class and
   * section are created the first time they are needed, so students can be added straight away.
   */
  private async sectionFor(tx: Pick<Database, 'select' | 'insert'>, year: 'PUC_1' | 'PUC_2', sectionName: string): Promise<string> {
    let [ay] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true));
    if (!ay) {
      const now = new Date();
      const start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
      const name = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
      [ay] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.name, name));
      if (!ay) {
        [ay] = await tx
          .insert(academicYears)
          .values({ name, startDate: `${start}-06-01`, endDate: `${start + 1}-03-31`, isCurrent: true })
          .returning({ id: academicYears.id });
      }
    }
    const className = year === 'PUC_1' ? 'Class 11' : 'Class 12';
    let [cls] = await tx.select({ id: classes.id }).from(classes).where(and(eq(classes.academicYearId, ay.id), eq(classes.name, className)));
    if (!cls) {
      [cls] = await tx.insert(classes).values({ academicYearId: ay.id, pucYear: year, stream: 'General', name: className }).returning({ id: classes.id });
    }
    let [sec] = await tx.select({ id: sections.id }).from(sections).where(and(eq(sections.classId, cls.id), eq(sections.name, sectionName)));
    if (!sec) [sec] = await tx.insert(sections).values({ classId: cls.id, name: sectionName }).returning({ id: sections.id });
    return sec.id;
  }

  async update(actor: StaffPrincipal, id: string, dto: UpdateStudentDto, meta: RequestMeta) {
    await this.get(actor, id);
    if (dto.hostelId) await this.assertHostel(dto.hostelId);
    await this.db.transaction(async (tx) => {
      await tx.update(students).set(dto).where(eq(students.id, id));
      await this.audit.record(actor, { action: 'student.update', entityType: 'student', entityId: id, metadata: { fields: Object.keys(dto) } }, meta, tx);
    });
    return this.get(actor, id);
  }

  async setStatus(actor: StaffPrincipal, id: string, status: AccountStatus, reason: string | undefined, meta: RequestMeta) {
    const current = await this.get(actor, id);
    await this.db.transaction(async (tx) => {
      await tx.update(students).set({ status }).where(eq(students.id, id));
      if (status !== 'ACTIVE') await this.auth.revokeAllSessions(tx, { studentId: id });
      await this.audit.record(
        actor,
        { action: 'student.status', entityType: 'student', entityId: id, metadata: { from: current.status, to: status, reason: reason ?? null } },
        meta,
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** Issues a new temporary password, clears the PIN and lockout, and signs the student out everywhere. */
  async resetCredentials(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const s = await this.get(actor, id);
    const tempPassword = temporaryPassword();
    await this.db.transaction(async (tx) => {
      await tx
        .update(students)
        .set({ passwordHash: await hashSecret(tempPassword), pinHash: null, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
        .where(eq(students.id, id));
      await this.auth.revokeAllSessions(tx, { studentId: id });
      await this.audit.record(actor, { action: 'student.credentials_reset', entityType: 'student', entityId: id }, meta, tx);
    });
    return { studentCode: s.studentCode, temporaryPassword: tempPassword };
  }

  async transfer(actor: StaffPrincipal, id: string, dto: TransferStudentDto, meta: RequestMeta) {
    const current = await this.get(actor, id);
    await this.assertSection(dto.sectionId);
    await this.db.transaction(async (tx) => {
      await tx.update(students).set({ sectionId: dto.sectionId, rollNumber: dto.rollNumber }).where(eq(students.id, id));
      await this.audit.record(
        actor,
        {
          action: 'student.transfer',
          entityType: 'student',
          entityId: id,
          metadata: {
            fromSectionId: current.section.id,
            fromRoll: current.rollNumber,
            toSectionId: dto.sectionId,
            toRoll: dto.rollNumber,
            reason: dto.reason ?? null,
          },
        },
        meta,
        tx,
      );
    });
    return this.get(actor, id);
  }

  // ------------------------------------------------------------ photos

  async setPhoto(actor: StaffPrincipal, id: string, file: Express.Multer.File | undefined, meta: RequestMeta) {
    await this.get(actor, id);
    if (!file?.buffer?.length) throw new BadRequestException('Attach a photo file in the "file" field');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Photo must be 2 MB or smaller');
    const ext = sniffImage(file.buffer);
    if (!ext) throw new BadRequestException('Photo must be a JPEG, PNG or WebP image');
    const [prev] = await this.db.select({ key: students.photoUrl }).from(students).where(eq(students.id, id));
    const key = `student-photos/${id}.${ext}`;
    await this.storage.put(key, file.buffer);
    if (prev?.key && prev.key !== key) await this.storage.remove(prev.key);
    await this.db.update(students).set({ photoUrl: key }).where(eq(students.id, id));
    await this.audit.record(actor, { action: 'student.photo', entityType: 'student', entityId: id }, meta);
    return this.get(actor, id);
  }

  async getPhoto(id: string): Promise<{ data: Buffer; contentType: string }> {
    const [row] = await this.db.select({ key: students.photoUrl }).from(students).where(eq(students.id, id));
    if (!row?.key) throw new NotFoundException('No photo');
    const data = await this.storage.get(row.key);
    if (!data) throw new NotFoundException('No photo');
    const ext = row.key.split('.').pop() as keyof typeof IMAGE_TYPES;
    return { data, contentType: IMAGE_TYPES[ext] ?? 'application/octet-stream' };
  }

  // ------------------------------------------------------------ bulk import

  /**
   * Imports students from CSV. All rows are validated first; nothing is written unless every
   * row is valid (all-or-nothing). Temporary passwords are returned once, for printing.
   */
  async importCsv(actor: StaffPrincipal, file: Express.Multer.File | undefined, q: ImportQueryDto, meta: RequestMeta): Promise<ImportResult> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a CSV file in the "file" field');
    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: (header: string[]) => header.map(normaliseHeader),
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (e) {
      throw new BadRequestException(`Could not read the CSV file: ${(e as Error).message}`);
    }
    if (!records.length) throw new BadRequestException('The CSV file has no data rows');
    if (records.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);

    const yearId =
      q.academicYearId ??
      (await this.db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)))[0]?.id;
    if (!yearId) throw new BadRequestException('No current academic year is set. Choose an academic year for the import.');

    // Lookups
    const sectionRows = await this.db
      .select({ id: sections.id, sectionName: sections.name, className: classes.name })
      .from(sections)
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(eq(classes.academicYearId, yearId));
    const sectionByKey = new Map(sectionRows.map((s) => [`${s.className.toLowerCase()}|${s.sectionName.toLowerCase()}`, s.id]));
    const hostelRows = await this.db.select({ id: hostels.id, name: hostels.name }).from(hostels);
    const hostelByName = new Map(hostelRows.map((h) => [h.name.toLowerCase(), h.id]));

    const errors: ImportResult['errors'] = [];
    const prepared: (ImportRowDto & { sectionId: string; hostelId: string | null })[] = [];
    const seenCodes = new Map<string, number>();
    const seenRolls = new Map<string, number>();

    for (let i = 0; i < records.length; i++) {
      const rowNo = i + 2; // header is row 1
      const dto = plainToInstance(ImportRowDto, records[i]);
      const issues = await validate(dto, { whitelist: true });
      const messages = issues.flatMap((e) => Object.values(e.constraints ?? {}));
      let sectionId: string | undefined;
      let hostelId: string | null = null;
      if (!messages.length) {
        sectionId = sectionByKey.get(`${dto.className.toLowerCase()}|${dto.sectionName.toLowerCase()}`);
        if (!sectionId) messages.push(`Class "${dto.className}" section "${dto.sectionName}" does not exist in the selected academic year`);
        if (dto.hostelName) {
          hostelId = hostelByName.get(dto.hostelName.toLowerCase()) ?? null;
          if (!hostelId) messages.push(`Hostel "${dto.hostelName}" does not exist`);
        }
        const dupCode = seenCodes.get(dto.studentCode);
        if (dupCode) messages.push(`studentCode is repeated (also on row ${dupCode})`);
        else seenCodes.set(dto.studentCode, rowNo);
        if (sectionId) {
          const rollKey = `${sectionId}|${dto.rollNumber}`;
          const dupRoll = seenRolls.get(rollKey);
          if (dupRoll) messages.push(`rollNumber is repeated in this section (also on row ${dupRoll})`);
          else seenRolls.set(rollKey, rowNo);
        }
      }
      if (messages.length) errors.push({ row: rowNo, studentCode: records[i].studentCode, messages });
      else prepared.push({ ...dto, sectionId: sectionId!, hostelId });
    }

    // Conflicts with existing data
    if (prepared.length) {
      const codes = prepared.map((p) => p.studentCode);
      const existing = await this.db
        .select({ code: students.studentCode })
        .from(students)
        .where(inArray(sql`upper(${students.studentCode})`, codes));
      const existingCodes = new Set(existing.map((e) => e.code.toUpperCase()));
      const existingRolls = await this.db
        .select({ sectionId: students.sectionId, roll: students.rollNumber })
        .from(students)
        .where(inArray(students.sectionId, [...new Set(prepared.map((p) => p.sectionId))]));
      const rollSet = new Set(existingRolls.map((r) => `${r.sectionId}|${r.roll}`));
      for (let i = 0; i < prepared.length; i++) {
        const p = prepared[i];
        const messages: string[] = [];
        if (existingCodes.has(p.studentCode)) messages.push('A student with this studentCode already exists');
        if (rollSet.has(`${p.sectionId}|${p.rollNumber}`)) messages.push('This rollNumber is already used in the section');
        if (messages.length) {
          const rowNo = records.findIndex((r) => (r.studentCode ?? '').trim().toUpperCase() === p.studentCode) + 2;
          errors.push({ row: rowNo, studentCode: p.studentCode, messages });
        }
      }
    }
    errors.sort((a, b) => a.row - b.row);

    const result: ImportResult = { dryRun: q.dryRun, totalRows: records.length, valid: errors.length === 0, errors, created: 0, credentials: [] };
    if (!result.valid || q.dryRun) return result;

    const withSecrets = await mapLimit(prepared, 4, async (p) => {
      const pw = temporaryPassword();
      return { p, pw, hash: await hashSecret(pw) };
    });
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < withSecrets.length; i += 200) {
        const chunk = withSecrets.slice(i, i + 200);
        await tx.insert(students).values(
          chunk.map(({ p, hash }) => ({
            studentCode: p.studentCode,
            fullName: p.fullName,
            sectionId: p.sectionId,
            rollNumber: p.rollNumber,
            dateOfBirth: p.dateOfBirth ?? null,
            gender: p.gender ?? null,
            guardianName: p.guardianName ?? null,
            guardianPhone: p.guardianPhone ?? null,
            hostelId: p.hostelId,
            roomNumber: p.roomNumber ?? null,
            passwordHash: hash,
            mustChangePassword: true,
          })),
        );
      }
      await this.audit.record(actor, { action: 'student.import', entityType: 'student', metadata: { count: withSecrets.length, academicYearId: yearId } }, meta, tx);
    });
    result.created = withSecrets.length;
    result.credentials = withSecrets.map(({ p, pw }) => ({ studentCode: p.studentCode, fullName: p.fullName, temporaryPassword: pw }));
    return result;
  }

  // ------------------------------------------------------------ helpers

  private async assertSection(id: string) {
    const [row] = await this.db.select({ id: sections.id }).from(sections).where(eq(sections.id, id));
    if (!row) throw new BadRequestException('Section does not exist');
  }

  private async assertHostel(id: string) {
    const [row] = await this.db.select({ id: hostels.id }).from(hostels).where(eq(hostels.id, id));
    if (!row) throw new BadRequestException('Hostel does not exist');
  }
}

const HEADER_ALIASES: Record<string, string> = {
  studentid: 'studentCode',
  studentcode: 'studentCode',
  name: 'fullName',
  fullname: 'fullName',
  studentname: 'fullName',
  class: 'className',
  classname: 'className',
  section: 'sectionName',
  sectionname: 'sectionName',
  roll: 'rollNumber',
  rollno: 'rollNumber',
  rollnumber: 'rollNumber',
  dob: 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  gender: 'gender',
  guardian: 'guardianName',
  guardianname: 'guardianName',
  parentname: 'guardianName',
  guardianphone: 'guardianPhone',
  parentphone: 'guardianPhone',
  hostel: 'hostelName',
  hostelname: 'hostelName',
  room: 'roomNumber',
  roomno: 'roomNumber',
  roomnumber: 'roomNumber',
};

function normaliseHeader(h: string): string {
  const key = h.toLowerCase().replace(/[^a-z]/g, '');
  return HEADER_ALIASES[key] ?? h.trim();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Roll number from the Student ID: its last 3 digits (MT26057 -> 057), or the whole ID. */
export function rollFromCode(code: string): string {
  const m = code.match(/(\d{3})$/);
  return m ? m[1] : code;
}
