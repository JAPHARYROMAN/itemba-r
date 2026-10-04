import { SetMetadata } from '@nestjs/common';

export const MOBILE_POS_SESSION_ROLES = 'itemba.mobile-pos-session.roles';
export type MobilePosRole = 'CASHIER' | 'STOCKIST' | 'ADMIN';
/** Explicit allowlist for a device/PIN principal; absence denies the handler. */
export const MobilePosSessionAllowed = (...roles: MobilePosRole[]) =>
  SetMetadata(MOBILE_POS_SESSION_ROLES, roles);
