import type { StaffRole } from '../db/schema';

export type StaffPrincipal = { kind: 'staff'; id: string; role: StaffRole; email: string; name: string; sessionFamilyId: string };
export type StudentPrincipal = { kind: 'student'; id: string; studentCode: string; name: string; sessionFamilyId: string };
export type AuthPrincipal = StaffPrincipal | StudentPrincipal;

/** Claims carried in the signed access token. */
export interface AccessTokenClaims {
  sub: string;
  typ: 'staff' | 'student';
  role?: StaffRole;
  /** email (staff) or student code (student) */
  lbl: string;
  name: string;
  sid: string; // session family id
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
