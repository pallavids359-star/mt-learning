import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AccessTokenClaims, AuthPrincipal, RequestMeta } from '../common/auth-principal';
import { ROLE_PERMISSIONS } from '../common/permissions';
import { dummySecretHash, hashSecret, newRefreshToken, sha256, verifySecret } from '../common/utils/secrets';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DbOrTx, InjectDb, type Database } from '../db/db.module';
import { sessions, staffUsers, students, tablets } from '../db/schema';
import type { ChangePasswordDto, SetPinDto, StaffLoginDto, StudentLoginDto } from './dto/auth.dto';

const INVALID_CREDENTIALS = 'Invalid credentials';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

type LockableAccount = { id: string; failedLoginCount: number; lockedUntil: Date | null };

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- staff

  async staffLogin(dto: StaffLoginDto, meta: RequestMeta) {
    const user = await this.db.query.staffUsers.findFirst({
      where: sql`lower(${staffUsers.email}) = ${dto.email}`,
    });
    if (!user) {
      await verifySecret(await dummySecretHash(), dto.password);
      await this.audit.record({ kind: 'anonymous', label: dto.email }, { action: 'auth.staff.login_failed' }, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.assertNotLocked(user);
    const ok = await verifySecret(user.passwordHash, dto.password);
    if (!ok) {
      await this.registerFailure('staff', user);
      await this.audit.record(
        { kind: 'anonymous', label: dto.email },
        { action: 'auth.staff.login_failed', entityType: 'staff', entityId: user.id },
        meta,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Contact the administrator.');

    const principal: AuthPrincipal = {
      kind: 'staff',
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.fullName,
      sessionFamilyId: randomUUID(),
    };
    const tokens = await this.db.transaction(async (tx) => {
      await tx
        .update(staffUsers)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(staffUsers.id, user.id));
      const pair = await this.issueTokens(tx, principal, meta);
      await this.audit.record(principal, { action: 'auth.staff.login', entityType: 'staff', entityId: user.id }, meta, tx);
      return pair;
    });
    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword,
      user: this.staffView(user),
    };
  }

  // ---------------------------------------------------------------- student

  async studentLogin(dto: StudentLoginDto, meta: RequestMeta) {
    const student = await this.db.query.students.findFirst({
      where: sql`upper(${students.studentCode}) = ${dto.studentCode}`,
      with: { tablet: true },
    });
    const label = dto.studentCode;
    if (!student) {
      await verifySecret(await dummySecretHash(), dto.secret);
      await this.audit.record({ kind: 'anonymous', label }, { action: 'auth.student.login_failed' }, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.assertNotLocked(student);

    const hash = dto.secretType === 'pin' ? student.pinHash : student.passwordHash;
    const ok = hash ? await verifySecret(hash, dto.secret) : (await verifySecret(await dummySecretHash(), dto.secret), false);
    if (!ok) {
      await this.registerFailure('student', student);
      await this.audit.record(
        { kind: 'anonymous', label },
        { action: 'auth.student.login_failed', entityType: 'student', entityId: student.id, metadata: { secretType: dto.secretType } },
        meta,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (student.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Contact the college office.');
    if (dto.secretType === 'pin' && student.mustChangePassword) {
      throw new ForbiddenException('Sign in with your password to set a new password first.');
    }

    const serial = dto.deviceSerial?.toUpperCase();
    const assigned = student.tablet?.serialNumber.toUpperCase();
    if (this.env.ENFORCE_TABLET_BINDING) {
      if (!assigned) throw new ForbiddenException('No tablet is assigned to this account. Contact the device administrator.');
      if (serial !== assigned) {
        await this.audit.record(
          { kind: 'anonymous', label },
          { action: 'auth.student.wrong_device', entityType: 'student', entityId: student.id, metadata: { deviceSerial: serial ?? null } },
          meta,
        );
        throw new ForbiddenException('This account can only be used on the tablet assigned to it.');
      }
    }

    const principal: AuthPrincipal = {
      kind: 'student',
      id: student.id,
      studentCode: student.studentCode,
      name: student.fullName,
      sessionFamilyId: randomUUID(),
    };
    const tokens = await this.db.transaction(async (tx) => {
      await tx
        .update(students)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(students.id, student.id));
      if (student.tablet && serial && serial === assigned) {
        await tx.update(tablets).set({ lastSeenAt: new Date() }).where(eq(tablets.id, student.tablet.id));
      }
      const pair = await this.issueTokens(tx, principal, meta, serial);
      await this.audit.record(principal, { action: 'auth.student.login', entityType: 'student', entityId: student.id }, meta, tx);
      return pair;
    });
    return {
      ...tokens,
      mustChangePassword: student.mustChangePassword,
      hasPin: !!student.pinHash,
      user: { id: student.id, studentCode: student.studentCode, fullName: student.fullName },
    };
  }

  // ---------------------------------------------------------------- refresh / logout

  /**
   * Rotates a refresh token. Presenting an already-rotated token is treated as theft:
   * the whole session family is revoked.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);
    const result = await this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).for('update');
      if (!session) return { error: 'invalid' as const };
      if (session.revokedAt) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        return { error: 'reuse' as const, session };
      }
      if (session.expiresAt.getTime() <= Date.now()) return { error: 'expired' as const };

      const principal = await this.loadActivePrincipal(tx, session);
      if (!principal) {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.familyId, session.familyId));
        return { error: 'inactive' as const };
      }
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
      const pair = await this.issueTokens(tx, principal, meta, session.deviceSerial ?? undefined);
      return { pair };
    });

    if ('pair' in result && result.pair) return result.pair;
    if (result.error === 'reuse') {
      await this.audit.record(
        { kind: 'system' },
        {
          action: 'auth.refresh_reuse_detected',
          entityType: result.session.principal === 'STAFF' ? 'staff' : 'student',
          entityId: (result.session.staffId ?? result.session.studentId) as string,
        },
        meta,
      );
    }
    throw new UnauthorizedException('Session expired. Please sign in again.');
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    const [session] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
    if (!session) return;
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
  }

  /** Revokes every session of an account (used after suspension or credential reset). */
  async revokeAllSessions(tx: DbOrTx, who: { staffId?: string; studentId?: string }, exceptFamilyId?: string) {
    const owner = who.staffId ? eq(sessions.staffId, who.staffId) : eq(sessions.studentId, who.studentId!);
    const conds = [owner, isNull(sessions.revokedAt)];
    if (exceptFamilyId) conds.push(ne(sessions.familyId, exceptFamilyId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(...conds));
  }

  // ---------------------------------------------------------------- self-service

  async me(principal: AuthPrincipal) {
    if (principal.kind === 'staff') {
      const user = await this.db.query.staffUsers.findFirst({ where: eq(staffUsers.id, principal.id) });
      if (!user) throw new UnauthorizedException();
      return { kind: 'staff' as const, ...this.staffView(user), permissions: ROLE_PERMISSIONS[user.role] };
    }
    const s = await this.db.query.students.findFirst({ where: eq(students.id, principal.id) });
    if (!s) throw new UnauthorizedException();
    return {
      kind: 'student' as const,
      id: s.id,
      studentCode: s.studentCode,
      fullName: s.fullName,
      mustChangePassword: s.mustChangePassword,
      hasPin: !!s.pinHash,
    };
  }

  async changePassword(principal: AuthPrincipal, dto: ChangePasswordDto, meta: RequestMeta) {
    if (dto.currentPassword === dto.newPassword) {
      throw new ForbiddenException('The new password must be different from the current password');
    }
    const table = principal.kind === 'staff' ? staffUsers : students;
    const [row] = await this.db.select({ hash: table.passwordHash }).from(table).where(eq(table.id, principal.id));
    if (!row || !(await verifySecret(row.hash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hashSecret(dto.newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(table).set({ passwordHash, mustChangePassword: false }).where(eq(table.id, principal.id));
      await this.revokeAllSessions(
        tx,
        principal.kind === 'staff' ? { staffId: principal.id } : { studentId: principal.id },
        principal.sessionFamilyId,
      );
      await this.audit.record(
        principal,
        { action: `auth.${principal.kind}.password_changed`, entityType: principal.kind, entityId: principal.id },
        meta,
        tx,
      );
    });
  }

  async setStudentPin(principal: AuthPrincipal, dto: SetPinDto, meta: RequestMeta) {
    const [row] = await this.db.select().from(students).where(eq(students.id, principal.id));
    if (!row || !(await verifySecret(row.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (row.mustChangePassword) throw new ForbiddenException('Set a new password before creating a PIN');
    await this.db.update(students).set({ pinHash: await hashSecret(dto.pin) }).where(eq(students.id, principal.id));
    await this.audit.record(principal, { action: 'auth.student.pin_set', entityType: 'student', entityId: principal.id }, meta);
  }

  // ---------------------------------------------------------------- internals

  private staffView(u: typeof staffUsers.$inferSelect) {
    return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, mustChangePassword: u.mustChangePassword };
  }

  private assertNotLocked(acc: LockableAccount) {
    if (acc.lockedUntil && acc.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((acc.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Too many failed attempts. Try again in ${minutes} minute(s).`);
    }
  }

  private async registerFailure(kind: 'staff' | 'student', acc: LockableAccount) {
    const table = kind === 'staff' ? staffUsers : students;
    const failed = acc.failedLoginCount + 1;
    const lock = failed >= this.env.LOGIN_MAX_ATTEMPTS;
    await this.db
      .update(table)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) : acc.lockedUntil,
      })
      .where(eq(table.id, acc.id));
  }

  private async loadActivePrincipal(tx: DbOrTx, session: typeof sessions.$inferSelect): Promise<AuthPrincipal | null> {
    if (session.staffId) {
      const [u] = await tx.select().from(staffUsers).where(eq(staffUsers.id, session.staffId));
      if (!u || u.status !== 'ACTIVE') return null;
      return { kind: 'staff', id: u.id, role: u.role, email: u.email, name: u.fullName, sessionFamilyId: session.familyId };
    }
    if (session.studentId) {
      const [s] = await tx.select().from(students).where(eq(students.id, session.studentId));
      if (!s || s.status !== 'ACTIVE') return null;
      return { kind: 'student', id: s.id, studentCode: s.studentCode, name: s.fullName, sessionFamilyId: session.familyId };
    }
    return null;
  }

  private async issueTokens(tx: DbOrTx, p: AuthPrincipal, meta: RequestMeta, deviceSerial?: string): Promise<TokenPair> {
    const claims: AccessTokenClaims =
      p.kind === 'staff'
        ? { sub: p.id, typ: 'staff', role: p.role, lbl: p.email, name: p.name, sid: p.sessionFamilyId }
        : { sub: p.id, typ: 'student', lbl: p.studentCode, name: p.name, sid: p.sessionFamilyId };
    const accessToken = await this.jwt.signAsync(claims);
    const refreshToken = newRefreshToken();
    const days = p.kind === 'staff' ? this.env.STAFF_REFRESH_TTL_DAYS : this.env.STUDENT_REFRESH_TTL_DAYS;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await tx.insert(sessions).values({
      principal: p.kind === 'staff' ? 'STAFF' : 'STUDENT',
      staffId: p.kind === 'staff' ? p.id : null,
      studentId: p.kind === 'student' ? p.id : null,
      tokenHash: sha256(refreshToken),
      familyId: p.sessionFamilyId,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      deviceSerial: deviceSerial ?? null,
      expiresAt,
    });
    return {
      accessToken,
      accessTokenExpiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }
}
