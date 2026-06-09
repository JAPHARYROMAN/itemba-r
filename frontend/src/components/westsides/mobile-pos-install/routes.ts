export const WESTSIDES_MOBILE_POS_NAME = 'Westsides Mobile POS';
export const WESTSIDES_MOBILE_POS_INSTALL_PATH = '/westsides/mobile-pos/install';
export const WESTSIDES_MOBILE_POS_ROUTE = '/westsides/mobile-pos';
export const WESTSIDES_MOBILE_POS_MANIFEST_PATH = '/westsides-mobile-pos.webmanifest';

const DEFAULT_ORIGIN = 'https://app.itembagrouptz.com';

export function getMobilePosInstallUrl(origin?: string) {
  const rawOrigin = origin ?? DEFAULT_ORIGIN;

  try {
    return new URL(WESTSIDES_MOBILE_POS_INSTALL_PATH, rawOrigin).toString();
  } catch {
    return new URL(WESTSIDES_MOBILE_POS_INSTALL_PATH, DEFAULT_ORIGIN).toString();
  }
}
