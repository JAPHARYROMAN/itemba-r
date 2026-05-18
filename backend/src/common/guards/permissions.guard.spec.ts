import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PermissionsGuard } from './permissions.guard';

function contextWithPermissions(permissions?: string[]): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => (permissions ? { user: { permissions } } : {}),
    }),
  } as unknown as ExecutionContext;
}

function guardWithMetadata(required?: string[], requiredAny?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return required;
      if (key === ANY_PERMISSIONS_KEY) return requiredAny;
      return undefined;
    }),
  } as unknown as Reflector;

  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows a route when the user has one any-permission match', () => {
    const guard = guardWithMetadata(undefined, ['inventory.view', 'sales.create']);

    expect(guard.canActivate(contextWithPermissions(['sales.create']))).toBe(true);
  });

  it('denies a route when none of the any-permissions match', () => {
    const guard = guardWithMetadata(undefined, ['inventory.view', 'sales.create']);

    expect(() => guard.canActivate(contextWithPermissions(['products.view']))).toThrow(
      ForbiddenException,
    );
  });

  it('still requires every all-permission match', () => {
    const guard = guardWithMetadata(['sales.create', 'products.view']);

    expect(() => guard.canActivate(contextWithPermissions(['sales.create']))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects protected routes without an authenticated user', () => {
    const guard = guardWithMetadata(undefined, ['sales.create']);

    expect(() => guard.canActivate(contextWithPermissions())).toThrow(UnauthorizedException);
  });
});
