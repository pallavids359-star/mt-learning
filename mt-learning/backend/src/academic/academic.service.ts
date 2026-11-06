import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { DbOrTx, InjectDb, type Database } from '../db/db.module';
import { academicYears, classes, classSubjects, sections, students, subjects } from '../db/schema';
import type {
  CreateAcademicYearDto,
  CreateClassDto,
  CreateSubjectDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateSubjectDto,
} from './academic.dto';

@Injectable()
export class AcademicService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ academic years

  listYears() {
    return this.db.select().from(academicYears).orderBy(desc(academicYears.startDate));
  }

  async createYear(actor: StaffPrincipal, dto: CreateAcademicYearDto, meta: RequestMeta) {
    if (dto.endDate <= dto.startDate) throw new BadRequestException('End date must be after start date');
    return this.db.transaction(async (tx) => {
      if (dto.isCurrent) await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.isCurrent, true));
      const [row] = await tx.insert(academicYears).values({ ...dto, isCurrent: !!dto.isCurrent }).returning();
      await this.audit.record(actor, { action: 'academic_year.create', entityType: 'academic_year', entityId: row.id, metadata: { name: row.name } }, meta, tx);
      return row;
    });
  }

  async updateYear(actor: StaffPrincipal, id: string, dto: UpdateAcademicYearDto, meta: RequestMeta) {
    const current = await this.getYear(id);
    const start = dto.startDate ?? current.startDate;
    const end = dto.endDate ?? current.endDate;
    if (end <= start) throw new BadRequestException('End date must be after start date');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(academicYears).set(dto).where(eq(academicYears.id, id)).returning();
      await this.audit.record(actor, { action: 'academic_year.update', entityType: 'academic_year', entityId: id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  async setCurrentYear(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    await this.getYear(id);
    return this.db.transaction(async (tx) => {
      await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.isCurrent, true));
      const [row] = await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, id)).returning();
      await this.audit.record(actor, { action: 'academic_year.set_current', entityType: 'academic_year', entityId: id }, meta, tx);
      return row;
    });
  }

  private async getYear(id: string) {
    const [row] = await this.db.select().from(academicYears).where(eq(academicYears.id, id));
    if (!row) throw new NotFoundException('Academic year not found');
    return row;
  }

  async currentYearId(): Promise<string | undefined> {
    const [row] = await this.db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true));
    return row?.id;
  }

  // ------------------------------------------------------------ classes & sections

  async listClasses(academicYearId?: string) {
    const yearId = academicYearId ?? (await this.currentYearId());
    if (!yearId) return [];
    const rows = await this.db.query.classes.findMany({
      where: eq(classes.academicYearId, yearId),
      orderBy: [asc(classes.pucYear), asc(classes.name)],
      with: {
        sections: { orderBy: [asc(sections.name)] },
        classSubjects: { with: { subject: true } },
      },
    });
    const sectionIds = rows.flatMap((c) => c.sections.map((s) => s.id));
    const counts = await this.studentCounts(sectionIds);
    return rows.map((c) => this.classView(c, counts));
  }

  async getClass(id: string) {
    const c = await this.db.query.classes.findFirst({
      where: eq(classes.id, id),
      with: {
        academicYear: true,
        sections: { orderBy: [asc(sections.name)] },
        classSubjects: { with: { subject: true } },
      },
    });
    if (!c) throw new NotFoundException('Class not found');
    const counts = await this.studentCounts(c.sections.map((s) => s.id));
    return { ...this.classView(c, counts), academicYear: c.academicYear };
  }

  async createClass(actor: StaffPrincipal, dto: CreateClassDto, meta: RequestMeta) {
    await this.getYear(dto.academicYearId);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({ academicYearId: dto.academicYearId, pucYear: dto.pucYear, stream: dto.stream, name: dto.name })
        .returning();
      const names = [...new Set((dto.sectionNames ?? []).map((n) => n.trim()).filter(Boolean))];
      if (names.length) await tx.insert(sections).values(names.map((name) => ({ classId: row.id, name })));
      if (dto.subjectIds?.length) await this.replaceSubjects(tx, row.id, dto.subjectIds);
      await this.audit.record(actor, { action: 'class.create', entityType: 'class', entityId: row.id, metadata: { name: row.name } }, meta, tx);
      return row.id;
    });
    return this.getClass(id);
  }

  async updateClass(actor: StaffPrincipal, id: string, dto: UpdateClassDto, meta: RequestMeta) {
    await this.getClass(id);
    await this.db.transaction(async (tx) => {
      await tx.update(classes).set(dto).where(eq(classes.id, id));
      await this.audit.record(actor, { action: 'class.update', entityType: 'class', entityId: id, metadata: { ...dto } }, meta, tx);
    });
    return this.getClass(id);
  }

  async setClassSubjects(actor: StaffPrincipal, id: string, subjectIds: string[], meta: RequestMeta) {
    await this.getClass(id);
    await this.db.transaction(async (tx) => {
      await this.replaceSubjects(tx, id, subjectIds);
      await this.audit.record(actor, { action: 'class.subjects', entityType: 'class', entityId: id, metadata: { subjectIds } }, meta, tx);
    });
    return this.getClass(id);
  }

  async deleteClass(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const c = await this.getClass(id);
    if (c.studentCount > 0) throw new ConflictException('Move or remove the students in this class before deleting it');
    await this.db.transaction(async (tx) => {
      await tx.delete(sections).where(eq(sections.classId, id));
      await tx.delete(classes).where(eq(classes.id, id));
      await this.audit.record(actor, { action: 'class.delete', entityType: 'class', entityId: id, metadata: { name: c.name } }, meta, tx);
    });
  }

  async addSection(actor: StaffPrincipal, classId: string, name: string, meta: RequestMeta) {
    await this.getClass(classId);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(sections).values({ classId, name }).returning();
      await this.audit.record(actor, { action: 'section.create', entityType: 'section', entityId: row.id, metadata: { classId, name } }, meta, tx);
      return row;
    });
  }

  async renameSection(actor: StaffPrincipal, id: string, name: string, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(sections).set({ name }).where(eq(sections.id, id)).returning();
      if (!row) throw new NotFoundException('Section not found');
      await this.audit.record(actor, { action: 'section.update', entityType: 'section', entityId: id, metadata: { name } }, meta, tx);
      return row;
    });
  }

  async deleteSection(actor: StaffPrincipal, id: string, meta: RequestMeta) {
    const [{ n }] = await this.db.select({ n: count() }).from(students).where(eq(students.sectionId, id));
    if (n > 0) throw new ConflictException('Move or remove the students in this section before deleting it');
    await this.db.transaction(async (tx) => {
      const [row] = await tx.delete(sections).where(eq(sections.id, id)).returning();
      if (!row) throw new NotFoundException('Section not found');
      await this.audit.record(actor, { action: 'section.delete', entityType: 'section', entityId: id, metadata: { name: row.name } }, meta, tx);
    });
  }

  // ------------------------------------------------------------ subjects

  listSubjects() {
    return this.db.select().from(subjects).orderBy(asc(subjects.name));
  }

  async createSubject(actor: StaffPrincipal, dto: CreateSubjectDto, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(subjects).values(dto).returning();
      await this.audit.record(actor, { action: 'subject.create', entityType: 'subject', entityId: row.id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  async updateSubject(actor: StaffPrincipal, id: string, dto: UpdateSubjectDto, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(subjects).set(dto).where(eq(subjects.id, id)).returning();
      if (!row) throw new NotFoundException('Subject not found');
      await this.audit.record(actor, { action: 'subject.update', entityType: 'subject', entityId: id, metadata: { ...dto } }, meta, tx);
      return row;
    });
  }

  // ------------------------------------------------------------ helpers

  private async replaceSubjects(tx: DbOrTx, classId: string, subjectIds: string[]) {
    if (subjectIds.length) {
      const found = await tx.select({ id: subjects.id }).from(subjects).where(inArray(subjects.id, subjectIds));
      if (found.length !== subjectIds.length) throw new BadRequestException('One or more subjects do not exist');
    }
    await tx.delete(classSubjects).where(eq(classSubjects.classId, classId));
    if (subjectIds.length) await tx.insert(classSubjects).values(subjectIds.map((subjectId) => ({ classId, subjectId })));
  }

  private async studentCounts(sectionIds: string[]): Promise<Map<string, number>> {
    if (!sectionIds.length) return new Map();
    const rows = await this.db
      .select({ sectionId: students.sectionId, n: count() })
      .from(students)
      .where(and(inArray(students.sectionId, sectionIds), sql`${students.status} <> 'DEACTIVATED'`))
      .groupBy(students.sectionId);
    return new Map(rows.map((r) => [r.sectionId, r.n]));
  }

  private classView(
    c: typeof classes.$inferSelect & {
      sections: (typeof sections.$inferSelect)[];
      classSubjects: { subject: typeof subjects.$inferSelect }[];
    },
    counts: Map<string, number>,
  ) {
    const secs = c.sections.map((s) => ({ id: s.id, name: s.name, studentCount: counts.get(s.id) ?? 0 }));
    return {
      id: c.id,
      academicYearId: c.academicYearId,
      pucYear: c.pucYear,
      stream: c.stream,
      name: c.name,
      sections: secs,
      subjects: c.classSubjects.map((cs) => cs.subject).sort((a, b) => a.name.localeCompare(b.name)),
      studentCount: secs.reduce((sum, s) => sum + s.studentCount, 0),
    };
  }
}
