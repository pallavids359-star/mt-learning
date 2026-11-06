import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenClaims, AuthPrincipal } from '../auth-principal';
import { ANY_PRINCIPAL, IS_PUBLIC, PERMISSIONS, STUDENT_ONLY } from '../decorators';
import { Permission, roleHas } from '../permissions';

/**
 * Global guard. Every route is private by default:
 *  - @Public()            → no token needed
 *  - @StudentOnly()       → signed-in student
 *  - @AnyPrincipal()      → any signed-in staff member or student
 *  - otherwise            → signed-in staff, plus every @RequirePermissions() permission
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const principal = await this.authenticate(req);
    req.principal = principal;

    if (this.reflector.getAllAndOverride<boolean>(ANY_PRINCIPAL, targets)) return true;

    if (this.reflector.getAllAndOverride<boolean>(STUDENT_ONLY, targets)) {
      if (principal.kind !== 'student') throw new ForbiddenException('This endpoint is for students only');
      return true;
    }

    if (principal.kind !== 'staff') throw new ForbiddenException('This endpoint is for staff only');
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !roleHas(principal.role, p));
    if (missing.length) throw new ForbiddenException('You do not have permission to perform this action');
    return true;
  }

  private async authenticate(req: Request): Promise<AuthPrincipal> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (claims.typ === 'staff' && claims.role) {
      return { kind: 'staff', id: claims.sub, role: claims.role, email: claims.lbl, name: claims.name, sessionFamilyId: claims.sid };
    }
    if (claims.typ === 'student') {
      return { kind: 'student', id: claims.sub, studentCode: claims.lbl, name: claims.name, sessionFamilyId: claims.sid };
    }
    throw new UnauthorizedException('Invalid access token');
  }
}
