import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, Permission } from '../decorators/permissions.decorator';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPERADMIN: ['uploads:write', 'scheduling:write', 'billing:write', 'analytics:read', 'integrations:write', 'settings:write', 'delete:write'],
  OWNER: ['uploads:write', 'scheduling:write', 'billing:write', 'analytics:read', 'integrations:write', 'settings:write', 'delete:write'],
  ADMIN: ['uploads:write', 'scheduling:write', 'billing:write', 'analytics:read', 'integrations:write', 'settings:write', 'delete:write'],
  EDITOR: ['uploads:write', 'scheduling:write', 'analytics:read'],
  VIEWER: ['analytics:read'],
  USER: ['analytics:read'],
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const role = request.membership?.role || 'USER';
    const allowed = new Set(ROLE_PERMISSIONS[role] || []);
    const ok = required.every((permission) => allowed.has(permission));
    if (!ok) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
