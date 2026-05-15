import * as crypto from 'crypto';

export function hashApiKey(rawKey: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(rawKey).digest('hex');
}

export function legacyHashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
