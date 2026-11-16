import { createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface AuthUser {
  sub: number;
  role: UserRole;
  tenantId: number | null;
}

export const IS_PUBLIC = 'isPublic';
/** Ruta sin autenticación (webhooks, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** Local del usuario autenticado; rechaza a quien no pertenece a un local (ej. SUPERADMIN). */
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): number => {
  const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
  if (!user?.tenantId) throw new ForbiddenException('Esta sección es solo para usuarios de un local');
  return user.tenantId;
});
