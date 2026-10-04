import { unwrapApiPayload, ApiError, buildQuery } from '@/lib/api-client';
import type { PosRole } from './types';

export type DeviceIdentity = {
  enrollmentId: string;
  deviceSecret: string;
  ownerId: string;
  credentialVersion: number;
  claimToken?: string;
  inviteToken?: string;
};
const DEVICE_KEY = 'itemba.pos.device.v2';
const PENDING_KEY = 'itemba.pos.pending.v1';
const REGISTRATION_KEY = 'itemba.pos.registration-attempt.v1';
const ADMIN_KEY = 'itemba.pos.admin-install.v1';
const SETUP_KEY = 'itemba.pos.setup-binding.v1';
export type PendingRegistration = {
  inviteToken: string;
  name: string;
  role: PosRole;
  requestId: string;
  claimToken: string;
};
export function readPendingRegistration(): PendingRegistration | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(REGISTRATION_KEY) ?? 'null',
    ) as PendingRegistration | null;
    return value &&
      typeof value.inviteToken === 'string' &&
      /^[\w-]{1,128}$/.test(value.inviteToken) &&
      typeof value.name === 'string' &&
      value.name.trim() === value.name &&
      value.name.length >= 2 &&
      value.name.length <= 120 &&
      ['CASHIER', 'STOCKIST', 'ADMIN'].includes(value.role) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        value.requestId,
      ) &&
      /^[A-Za-z0-9_-]{32}$/.test(value.claimToken)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function prepareRegistration(
  inviteToken: string,
  name: string,
  role: PosRole,
): PendingRegistration {
  const previous = readPendingRegistration();
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120)
    throw new Error('Enter a full name between 2 and 120 characters.');
  if (
    previous?.inviteToken === inviteToken &&
    previous.name === normalized &&
    previous.role === role
  )
    return previous;
  if (previous)
    throw new Error(
      'Retry your saved access request before requesting a different name, role or branch.',
    );
  const value: PendingRegistration = {
    inviteToken,
    name: normalized,
    role,
    requestId: crypto.randomUUID(),
    claimToken: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
      .replaceAll('+', '-')
      .replaceAll('/', '_'),
  };
  // Persistence must succeed before callers can submit the registration.
  localStorage.setItem(REGISTRATION_KEY, JSON.stringify(value));
  return value;
}
export function clearPendingRegistration(requestId: string) {
  if (readPendingRegistration()?.requestId === requestId) localStorage.removeItem(REGISTRATION_KEY);
}
export function readSetupBinding(enrollmentId: string): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as {
      enrollmentId: string;
      deviceSecret: string;
    } | null;
    return value?.enrollmentId === enrollmentId && /^[a-f0-9]{64}$/.test(value.deviceSecret)
      ? value.deviceSecret
      : null;
  } catch {
    return null;
  }
}
export function saveSetupBinding(enrollmentId: string, deviceSecret: string) {
  localStorage.setItem(SETUP_KEY, JSON.stringify({ enrollmentId, deviceSecret }));
}
export function clearSetupBinding(enrollmentId: string) {
  if (readSetupBinding(enrollmentId)) localStorage.removeItem(SETUP_KEY);
}
export type AdminInstallation = PendingEnrollment & { companyId: string; branchId: string };
export function readAdminInstallation(): AdminInstallation | null {
  try {
    const value = JSON.parse(localStorage.getItem(ADMIN_KEY) ?? 'null') as AdminInstallation | null;
    return value &&
      /^[\w-]{1,128}$/.test(value.claimToken) &&
      /^[\w-]{1,128}$/.test(value.inviteToken) &&
      value.enrollmentId &&
      value.companyId &&
      value.branchId
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveAdminInstallation(value: AdminInstallation) {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(value));
}
export type PendingEnrollment = { inviteToken: string; claimToken: string; enrollmentId: string };
export function readPendingEnrollment(): PendingEnrollment | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(PENDING_KEY) ?? 'null',
    ) as PendingEnrollment | null;
    return value &&
      /^[\w-]{1,128}$/.test(value.inviteToken) &&
      /^[\w-]{1,128}$/.test(value.claimToken) &&
      typeof value.enrollmentId === 'string' &&
      value.enrollmentId
      ? value
      : null;
  } catch {
    return null;
  }
}
export function savePendingEnrollment(value: PendingEnrollment) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(value));
}
export function clearPendingEnrollment(enrollmentId: string) {
  if (readPendingEnrollment()?.enrollmentId === enrollmentId) localStorage.removeItem(PENDING_KEY);
}
export function readDevice(): DeviceIdentity | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as DeviceIdentity;
    return value.enrollmentId &&
      /^[a-f0-9]{64}$/.test(value.deviceSecret) &&
      value.ownerId &&
      Number.isSafeInteger(value.credentialVersion) &&
      value.credentialVersion >= 1
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveDevice(device: DeviceIdentity) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
}
export function createDeviceSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  );
}
function csrfCookie() {
  const row = document.cookie.split('; ').find((c) => c.startsWith('itemba_pos_csrf='));
  return row ? decodeURIComponent(row.slice('itemba_pos_csrf='.length)) : '';
}
export async function mobileApi<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    query?: Record<string, string | number | boolean | null | undefined>;
    signal?: AbortSignal;
    public?: boolean;
    deviceSecret?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  if (method !== 'GET' && !options.public && !csrfCookie())
    await fetch('/api/mobile-pos/mobile-pos-auth/csrf', {
      credentials: 'same-origin',
      headers: { 'X-Itemba-POS': '1' },
    });
  const secret = options.deviceSecret ?? readDevice()?.deviceSecret;
  const response = await fetch(`/api/mobile-pos${path}${buildQuery(options.query)}`, {
    method,
    credentials: 'same-origin',
    signal: options.signal,
    headers: {
      'X-Itemba-POS': '1',
      ...(secret ? { 'x-mobile-pos-device': secret } : {}),
      ...(method !== 'GET'
        ? { 'Content-Type': 'application/json', 'x-csrf-token': csrfCookie() }
        : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  if (!response.ok)
    throw new ApiError(
      Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : (payload?.message ?? 'Could not complete this request.'),
      response.status,
      payload,
    );
  return unwrapApiPayload<T>(payload);
}
