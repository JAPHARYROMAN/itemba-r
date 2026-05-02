import { SetMetadata } from '@nestjs/common';

export const RECENT_AUTH_KEY = 'recentAuth';

/**
 * Require that the user re-verified their password within the given window.
 * Default window: 15 minutes.
 *
 * Usage:
 *   @RecentAuth()            // 15 minute window
 *   @RecentAuth(5)           // 5 minute window
 */
export const RecentAuth = (windowMinutes = 15) =>
  SetMetadata(RECENT_AUTH_KEY, windowMinutes);
