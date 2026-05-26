import { SetMetadata } from '@nestjs/common';

export type Permission =
  | 'uploads:write'
  | 'scheduling:write'
  | 'billing:write'
  | 'analytics:read'
  | 'integrations:write'
  | 'settings:write'
  | 'delete:write';

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
