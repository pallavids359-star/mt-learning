import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal, RequestMeta, StaffPrincipal, StudentPrincipal } from '../auth-principal';
import type { Permission } from '../permissions';

export const IS_PUBLIC = 'mt:isPublic';
export const PERMISSIONS = 'mt:permissions';
export const STUDENT_ONLY = 'mt:studentOnly';
export const ANY_PRINCIPAL = 'mt:anyPrincipal';

/** Endpoint does not require authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Staff endpoint requiring all of the listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

/** Endpoint reachable only by signed-in students (tablet app). */
export const StudentOnly = () => SetMetadata(STUDENT_ONLY, true);

/** Endpoint reachable by any signed-in staff member or student. */
export const AnyPrincipal = () => SetMetadata(ANY_PRINCIPAL, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthPrincipal => ctx.switchToHttp().getRequest<Request>().principal!,
);

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffPrincipal => ctx.switchToHttp().getRequest<Request>().principal as StaffPrincipal,
);

export const CurrentStudent = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StudentPrincipal =>
    ctx.switchToHttp().getRequest<Request>().principal as StudentPrincipal,
);

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : undefined };
});
