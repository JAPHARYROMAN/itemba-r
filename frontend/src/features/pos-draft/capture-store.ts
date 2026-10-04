import type { DeviceIdentity } from './mobile-api';
import type { Draft, DraftContext, Submission } from './types';
import type { MobileProfile } from './mobile-types';
export type LocalCapture = {
  key: string;
  partition: string;
  requestId: string;
  submission: Submission;
  state: 'LOCAL' | 'SUBMITTED' | 'ATTENTION';
  draft?: Draft;
  error?: string;
};
const DB_NAME = 'itemba-pos-capture-v2';
let database: Promise<IDBDatabase> | undefined;
function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const value = request.result;
      value.createObjectStore('captures', { keyPath: 'key' });
      value.createObjectStore('sessions', { keyPath: 'partition' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Device storage is unavailable.'));
  });
  return database;
}
async function write(store: string, value: unknown) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save on this device.'));
    tx.onabort = () => reject(tx.error ?? new Error('Could not save on this device.'));
  });
}
async function read<T>(store: string, key?: string): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, 'readonly');
    const request =
      key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}
export async function capturePartition(device: DeviceIdentity) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(device.deviceSecret),
  );
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${device.enrollmentId}:${device.ownerId}:${device.credentialVersion}:${hash}`;
}
export async function saveCapture(partition: string, submission: Submission) {
  const value: LocalCapture = {
    key: `${partition}:${submission.requestId}`,
    partition,
    requestId: submission.requestId,
    submission,
    state: 'LOCAL',
  };
  await write('captures', value);
  return value;
}
export async function updateCapture(value: LocalCapture) {
  await write('captures', value);
}
export async function getCaptures(partition: string) {
  return (await read<LocalCapture[]>('captures'))
    .filter((value) => value.partition === partition)
    .sort((a, b) => b.submission.capturedAt.localeCompare(a.submission.capturedAt));
}
export async function cacheMobileSession(
  partition: string,
  profile: MobileProfile,
  context: DraftContext,
) {
  await write('sessions', {
    partition,
    profile,
    context,
    authenticated: true,
    savedAt: new Date().toISOString(),
  });
}
export async function getCachedSession(partition: string) {
  return read<
    | {
        partition: string;
        profile: MobileProfile;
        context: DraftContext;
        authenticated: boolean;
        savedAt: string;
      }
    | undefined
  >('sessions', partition);
}
export async function clearCachedSession(partition: string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete(partition);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
