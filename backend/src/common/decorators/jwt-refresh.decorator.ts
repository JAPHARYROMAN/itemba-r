import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

export const IS_JWT_REFRESH_ROUTE = 'isJwtRefreshRoute';

/**
 * Marks a route as one that authenticates via the refresh-token JWT strategy
 * instead of the default access-token JWT strategy.
 *
 * Two effects are bundled together so callers can't accidentally apply only
 * half of the configuration:
 *  - Sets a metadata flag the global JwtAuthGuard checks to skip itself.
 *  - Attaches the `jwt-refresh` Passport guard.
 *
 * This replaces the previous `@Public() + @UseGuards(AuthGuard('jwt-refresh'))`
 * pair on the refresh route, which was a logical contradiction (Public meant
 * unauthenticated, but in practice the route required a refresh token).
 */
export const JwtRefresh = () =>
  applyDecorators(
    SetMetadata(IS_JWT_REFRESH_ROUTE, true),
    UseGuards(AuthGuard('jwt-refresh')),
  );
