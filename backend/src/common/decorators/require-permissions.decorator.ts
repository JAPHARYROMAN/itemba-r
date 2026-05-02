import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Declares one or more permission codes required to access a route.
 * Permission codes match the `code` field on the Permission model (e.g. "companies.read").
 * All listed permissions must be present on the user (AND logic).
 *
 * Example:
 *   @RequirePermissions('companies.read')
 *   @RequirePermissions('bank-accounts.read', 'bank-accounts.create')
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
