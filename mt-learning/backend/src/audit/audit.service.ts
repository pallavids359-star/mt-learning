import { Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, lte, or, SQL } from 'drizzle-orm';
import type { AuthPrincipal, RequestMeta } from '../common/auth-principal';
import { likePattern, pageOf } from '../common/dto/pagination.dto';
import { DbOrTx, InjectDb, type Database } from '../db/db.module';
import { auditLogs, type PrincipalType } from '../db/schema';
import { AuditQueryDto } from './audit.dto';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Records a sensitive action. Pass the transaction handle when the action is part of a
   * transaction so the audit row commits (or rolls back) with it.
   */
  async record(
    actor: AuthPrincipal | { kind: 'system' } | { kind: 'anonymous'; label: string },
    entry: AuditEntry,
    meta: RequestMeta = {},
    tx: DbOrTx = this.db,
  ): Promise<void> {
    let actorType: PrincipalType = 'SYSTEM';
    let actorId: string | null = null;
    let actorLabel: string | null = null;
    if (actor.kind === 'staff') {
      actorType = 'STAFF';
      actorId = actor.id;
      actorLabel = actor.email;
    } else if (actor.kind === 'student') {
      actorType = 'STUDENT';
      actorId = actor.id;
      actorLabel = actor.studentCode;
    } else if (actor.kind === 'anonymous') {
      actorLabel = actor.label;
    }
    try {
      await tx.insert(auditLogs).values({
        actorType,
        actorId,
        actorLabel,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    } catch (err) {
      // Inside a transaction the failure must propagate; outside, never block the request on audit.
      if (tx !== this.db) throw err;
      this.logger.error(`Failed to write audit log for ${entry.action}`, err as Error);
    }
  }

  async list(q: AuditQueryDto) {
    const where: SQL[] = [];
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.entityType) where.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLogs.entityId, q.entityId));
    if (q.actorId) where.push(eq(auditLogs.actorId, q.actorId));
    if (q.from) where.push(gte(auditLogs.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(auditLogs.createdAt, new Date(q.to)));
    if (q.search) {
      const p = likePattern(q.search);
      where.push(or(ilike(auditLogs.actorLabel, p), ilike(auditLogs.action, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(cond)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(auditLogs).where(cond),
    ]);
    return pageOf(items, total, q);
  }
}
