import {
  MANAGED_401_HEADER,
  BACKEND_PROXY_URL,
  SESSION_EXPIRED_EVENT,
  backendDelete,
  backendGet,
  backendPost,
  backendPut,
  backendUpload,
} from './api-client';
import type {
  CreateMsaidiziTaskDraftRequest,
  CreateMsaidiziMandateRequest,
  CreateMsaidiziMemoryRequest,
  CreateMsaidiziScheduleRequest,
  MsaidiziControlPlanePage,
  MsaidiziDevice,
  MsaidiziDevicePage,
  MsaidiziArtifact,
  MsaidiziArtifactKind,
  MsaidiziMandate,
  MsaidiziMandateStatus,
  MsaidiziMemory,
  MsaidiziMemoryDetail,
  MsaidiziMemoryKind,
  MsaidiziPairingCode,
  MsaidiziRecoveryCommand,
  MsaidiziRecoveryCommandStatus,
  MsaidiziTaskProposal,
  MsaidiziTaskEvent,
  MsaidiziSchedule,
  MsaidiziScheduleStatus,
  MsaidiziScheduleVersion,
  MsaidiziSafetyActionResult,
  MsaidiziSafetyStatus,
  MsaidiziTask,
  MsaidiziTaskEventPage,
  MsaidiziTaskMode,
  MsaidiziTaskPage,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  PlanMsaidiziTaskRequest,
  ProposeMsaidiziTaskRequest,
  ReplanMsaidiziTaskRequest,
  RequestMsaidiziRecoveryCommand,
  UpdateMsaidiziMandateRequest,
  UpdateMsaidiziMemoryRequest,
  UpdateMsaidiziScheduleRequest,
} from './msaidizi-task-types';
import { SseFrameParser } from './msaidizi-stream';

const taskPath = (id: string) => `/msaidizi/tasks/${encodeURIComponent(id)}`;

export function getMsaidiziSafetyStatus(): Promise<MsaidiziSafetyStatus> {
  return backendGet<MsaidiziSafetyStatus>('/msaidizi/safety');
}

export function disableMsaidiziAutopilot(): Promise<MsaidiziSafetyActionResult> {
  return backendPost<MsaidiziSafetyActionResult>('/msaidizi/safety/disable-autopilot', {
    confirmation: 'DISABLE AUTOPILOT',
  });
}

export function enableMsaidiziAutopilot(): Promise<MsaidiziSafetyActionResult> {
  return backendPost<MsaidiziSafetyActionResult>('/msaidizi/safety/enable-autopilot', {
    confirmation: 'ENABLE AUTOPILOT',
  });
}

export function planMsaidiziTask(request: PlanMsaidiziTaskRequest): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>('/msaidizi/tasks/plan', request);
}

/** Creates a durable, non-executable PLANNING envelope before media capture. */
export function createMsaidiziTaskDraft(
  request: CreateMsaidiziTaskDraftRequest,
): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>('/msaidizi/tasks/drafts', request);
}

/** Produces a policy-checked proposal only; it cannot persist, queue, or execute. */
export function proposeMsaidiziTask(
  request: ProposeMsaidiziTaskRequest,
): Promise<MsaidiziTaskProposal> {
  return backendPost<MsaidiziTaskProposal>('/msaidizi/tasks/proposals', request);
}

/** Queues a reviewed plan. It never executes a task inside this HTTP request. */
export function createMsaidiziTask(
  taskId: string,
  oneShotConsentStepIds: string[] = [],
): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>('/msaidizi/tasks', { taskId, oneShotConsentStepIds });
}

export function listMsaidiziTasks(
  params: {
    page?: number;
    limit?: number;
    status?: MsaidiziTaskStatus;
    mode?: MsaidiziTaskMode;
    companyId?: string;
  } = {},
): Promise<MsaidiziTaskPage> {
  return backendGet<MsaidiziTaskPage>('/msaidizi/tasks', { query: params });
}

export function fetchMsaidiziTask(id: string): Promise<MsaidiziTask> {
  return backendGet<MsaidiziTask>(taskPath(id));
}

export function fetchMsaidiziTaskEvents(
  id: string,
  after: string = '0',
  limit?: number,
  signal?: AbortSignal,
): Promise<MsaidiziTaskEventPage> {
  return backendGet<MsaidiziTaskEventPage>(`${taskPath(id)}/events`, {
    query: { after, ...(limit === undefined ? {} : { limit }) },
    ...(signal ? { signal } : {}),
  });
}

export type MsaidiziTaskEventTransport = 'stream' | 'polling';

export interface WatchMsaidiziTaskEventsOptions {
  signal: AbortSignal;
  after?: string;
  onEvents: (events: MsaidiziTaskEvent[], cursor: string) => void;
  /** Receives event and heartbeat cursors. It is never called with a regression. */
  onCursor?: (cursor: string) => void;
  onTransportChange?: (transport: MsaidiziTaskEventTransport) => void;
  fetchImpl?: typeof fetch;
  refreshSession?: () => Promise<boolean>;
  /** Testable recovery cadence. Production retries the stream after six bounded polls. */
  fallbackPollAttempts?: number;
  pollIntervalMs?: number;
  pageLimit?: number;
  maxPagesPerPoll?: number;
}

export class MsaidiziTaskEventWatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MsaidiziTaskEventWatchError';
  }
}

type CursorState = { value: string };
type StreamAttempt = 'dropped' | 'aborted' | MsaidiziTaskEventWatchError;

const DECIMAL_CURSOR = /^(0|[1-9]\d*)$/;
const DEFAULT_EVENT_PAGE_LIMIT = 100;
const DEFAULT_POLL_ATTEMPTS = 6;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_PAGES_PER_POLL = 10;

function isCursor(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_CURSOR.test(value);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function compareCursors(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(value as number, maximum);
}

function taskEventFromPayload(
  payload: unknown,
  taskId: string,
  wireId?: string,
): MsaidiziTaskEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = payload as Partial<MsaidiziTaskEvent>;
  if (
    !isCursor(event.cursor) ||
    (wireId !== undefined && wireId !== event.cursor) ||
    event.taskId !== taskId ||
    typeof event.type !== 'string' ||
    typeof event.actorType !== 'string' ||
    (event.actorId !== null && typeof event.actorId !== 'string') ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    Array.isArray(event.payload) ||
    typeof event.createdAt !== 'string' ||
    event.integrityVersion !== 1 ||
    typeof event.previousHash !== 'string' ||
    !SHA256_HEX.test(event.previousHash) ||
    typeof event.eventHash !== 'string' ||
    !SHA256_HEX.test(event.eventHash)
  ) {
    return null;
  }
  return event as MsaidiziTaskEvent;
}

function acceptTaskEvent(
  event: MsaidiziTaskEvent,
  cursor: CursorState,
  options: WatchMsaidiziTaskEventsOptions,
): boolean {
  if (compareCursors(event.cursor, cursor.value) <= 0) return false;
  cursor.value = event.cursor;
  options.onCursor?.(cursor.value);
  return true;
}

function acceptHeartbeat(
  frame: { id?: string; data: string },
  cursor: CursorState,
  options: WatchMsaidiziTaskEventsOptions,
): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return false;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const heartbeatCursor = (payload as { cursor?: unknown }).cursor;
  if (!isCursor(heartbeatCursor) || (frame.id !== undefined && frame.id !== heartbeatCursor)) {
    return false;
  }
  if (compareCursors(heartbeatCursor, cursor.value) >= 0) {
    cursor.value = heartbeatCursor;
    // Calling this for an equal cursor records liveness without fabricating a
    // timeline event. A lower heartbeat is ignored and can never rewind resume.
    options.onCursor?.(cursor.value);
  }
  return true;
}

async function consumeTaskEventStream(
  response: Response,
  taskId: string,
  cursor: CursorState,
  options: WatchMsaidiziTaskEventsOptions,
): Promise<'dropped' | 'aborted'> {
  const reader = response.body!.getReader();
  const parser = new SseFrameParser();
  const decoder = new TextDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal.addEventListener('abort', cancel, { once: true });

  try {
    while (!options.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) return options.signal.aborted ? 'aborted' : 'dropped';
      const frames = parser.push(decoder.decode(chunk.value, { stream: true }));
      const accepted: MsaidiziTaskEvent[] = [];

      for (const frame of frames) {
        if (frame.event === 'heartbeat') {
          if (!acceptHeartbeat(frame, cursor, options)) {
            await reader.cancel().catch(() => undefined);
            return 'dropped';
          }
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(frame.data);
        } catch {
          await reader.cancel().catch(() => undefined);
          return 'dropped';
        }
        const event = taskEventFromPayload(payload, taskId, frame.id);
        if (!event) {
          await reader.cancel().catch(() => undefined);
          return 'dropped';
        }
        if (acceptTaskEvent(event, cursor, options)) accepted.push(event);
      }

      if (accepted.length > 0) options.onEvents(accepted, cursor.value);
    }
    return 'aborted';
  } catch (error) {
    if (options.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return 'aborted';
    }
    return 'dropped';
  } finally {
    options.signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function responseMessage(response: Response): Promise<string> {
  const fallback = `Task event stream was refused (${response.status}).`;
  try {
    const payload = (await response.clone().json()) as { message?: unknown; error?: unknown };
    if (Array.isArray(payload.message)) return payload.message.join(', ');
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  } catch {
    // Gateways may return HTML. The status-bearing fallback remains actionable.
    return fallback;
  }
  return fallback;
}

async function defaultRefreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const response = await fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

async function openTaskEventStream(
  taskId: string,
  cursor: CursorState,
  options: WatchMsaidiziTaskEventsOptions,
  pageLimit: number,
): Promise<StreamAttempt> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = `${BACKEND_PROXY_URL}${taskPath(taskId)}/events/stream?${new URLSearchParams({
    after: cursor.value,
    limit: String(pageLimit),
  }).toString()}`;
  const attempt = () =>
    fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        [MANAGED_401_HEADER]: '1',
      },
      cache: 'no-store',
      signal: options.signal,
    });

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    return options.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      ? 'aborted'
      : 'dropped';
  }
  if (options.signal.aborted) return 'aborted';

  if (response.status === 401) {
    const refreshed = await (options.refreshSession ?? defaultRefreshSession)();
    if (options.signal.aborted) return 'aborted';
    if (refreshed && !options.signal.aborted) {
      try {
        response = await attempt();
      } catch (error) {
        return options.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          ? 'aborted'
          : 'dropped';
      }
    }
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
      return new MsaidiziTaskEventWatchError(
        'Your session has expired. Sign in again to continue.',
        401,
      );
    }
  }

  // A permission revoked while the stream was open must terminate the watcher;
  // repeatedly reconnecting would hammer an intentional authorization denial.
  if (response.status === 403) {
    return new MsaidiziTaskEventWatchError(await responseMessage(response), 403);
  }
  if (!response.ok) return 'dropped';
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/event-stream') || !response.body) return 'dropped';

  options.onTransportChange?.('stream');
  return consumeTaskEventStream(response, taskId, cursor, options);
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

async function pollTaskEventPages(
  taskId: string,
  cursor: CursorState,
  options: WatchMsaidiziTaskEventsOptions,
  pageLimit: number,
  maxPages: number,
): Promise<void> {
  for (let pageNumber = 0; pageNumber < maxPages && !options.signal.aborted; pageNumber += 1) {
    const page = await fetchMsaidiziTaskEvents(taskId, cursor.value, pageLimit, options.signal);
    if (options.signal.aborted) return;
    if (!page || !Array.isArray(page.data)) throw new Error('Malformed task event page.');
    const accepted: MsaidiziTaskEvent[] = [];
    for (const payload of page.data) {
      const event = taskEventFromPayload(payload, taskId);
      if (!event) throw new Error('Malformed task event payload.');
      if (acceptTaskEvent(event, cursor, options)) accepted.push(event);
    }
    if (accepted.length > 0) options.onEvents(accepted, cursor.value);
    if (!page.hasMore || page.data.length === 0) return;
  }
}

function waitForNextPoll(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const timer = window.setTimeout(() => finish(true), milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Watches one durable task until aborted. SSE is always attempted first. A
 * refusal or drop enters bounded authenticated polling, then retries SSE from
 * the last accepted event/heartbeat cursor. Authorization failures are terminal.
 */
export async function watchMsaidiziTaskEvents(
  taskId: string,
  options: WatchMsaidiziTaskEventsOptions,
): Promise<void> {
  const cursor: CursorState = { value: isCursor(options.after) ? options.after : '0' };
  const pollAttempts = boundedInteger(
    options.fallbackPollAttempts,
    DEFAULT_POLL_ATTEMPTS,
    DEFAULT_POLL_ATTEMPTS,
  );
  const pollInterval = boundedInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 60_000);
  const pageLimit = boundedInteger(
    options.pageLimit,
    DEFAULT_EVENT_PAGE_LIMIT,
    DEFAULT_EVENT_PAGE_LIMIT,
  );
  const maxPages = boundedInteger(
    options.maxPagesPerPoll,
    DEFAULT_MAX_PAGES_PER_POLL,
    DEFAULT_MAX_PAGES_PER_POLL,
  );

  while (!options.signal.aborted) {
    const streamed = await openTaskEventStream(taskId, cursor, options, pageLimit);
    if (streamed === 'aborted' || options.signal.aborted) return;
    if (streamed instanceof MsaidiziTaskEventWatchError) throw streamed;

    options.onTransportChange?.('polling');
    for (let attempt = 0; attempt < pollAttempts && !options.signal.aborted; attempt += 1) {
      try {
        await pollTaskEventPages(taskId, cursor, options, pageLimit, maxPages);
      } catch (error) {
        const status = errorStatus(error);
        if (status === 401 || status === 403) throw error;
        // Network and malformed-page failures remain inside the bounded fallback
        // window; the next poll or stream retry gets a clean chance to recover.
      }
      if (attempt + 1 < pollAttempts && !(await waitForNextPoll(pollInterval, options.signal))) {
        return;
      }
    }
  }
}

export function pauseMsaidiziTask(id: string): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>(`${taskPath(id)}/pause`);
}

export function resumeMsaidiziTask(id: string): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>(`${taskPath(id)}/resume`);
}

export function cancelMsaidiziTask(id: string): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>(`${taskPath(id)}/cancel`);
}

export function replanMsaidiziTask(
  id: string,
  request: ReplanMsaidiziTaskRequest,
): Promise<MsaidiziTask> {
  return backendPost<MsaidiziTask>(`${taskPath(id)}/replan`, request);
}

const mandatePath = (id: string) => `/msaidizi/mandates/${encodeURIComponent(id)}`;
const schedulePath = (id: string) => `/msaidizi/routines/${encodeURIComponent(id)}`;
const memoryPath = (id: string) => `/msaidizi/memory/${encodeURIComponent(id)}`;

export function listMsaidiziMandates(
  params: {
    page?: number;
    limit?: number;
    status?: MsaidiziMandateStatus;
    companyId?: string;
  } = {},
) {
  return backendGet<MsaidiziControlPlanePage<MsaidiziMandate>>('/msaidizi/mandates', {
    query: params,
  });
}

export function createMsaidiziMandate(request: CreateMsaidiziMandateRequest) {
  return backendPost<MsaidiziMandate>('/msaidizi/mandates', request);
}

export function updateMsaidiziMandate(id: string, request: UpdateMsaidiziMandateRequest) {
  return backendPut<MsaidiziMandate>(mandatePath(id), request);
}

function mandateAction(id: string, action: 'activate' | 'suspend' | 'revoke', version: number) {
  return backendPost<MsaidiziMandate>(`${mandatePath(id)}/${action}`, {
    expectedVersion: version,
  });
}

export const activateMsaidiziMandate = (id: string, version: number) =>
  mandateAction(id, 'activate', version);
export const suspendMsaidiziMandate = (id: string, version: number) =>
  mandateAction(id, 'suspend', version);
export const revokeMsaidiziMandate = (id: string, version: number) =>
  mandateAction(id, 'revoke', version);

export function deleteMsaidiziMandate(id: string, version: number) {
  return backendDelete<MsaidiziMandate>(mandatePath(id), {
    body: { expectedVersion: version },
  });
}

export function listMsaidiziSchedules(
  params: {
    page?: number;
    limit?: number;
    status?: MsaidiziScheduleStatus;
    mandateId?: string;
  } = {},
) {
  return backendGet<MsaidiziControlPlanePage<MsaidiziSchedule>>('/msaidizi/routines', {
    query: params,
  });
}

export function createMsaidiziSchedule(request: CreateMsaidiziScheduleRequest) {
  return backendPost<MsaidiziSchedule>('/msaidizi/routines', request);
}

export function fetchMsaidiziSchedule(id: string) {
  return backendGet<MsaidiziSchedule>(schedulePath(id));
}

export function listMsaidiziScheduleVersions(id: string) {
  return backendGet<MsaidiziScheduleVersion[]>(`${schedulePath(id)}/versions`);
}

export function fetchMsaidiziScheduleVersion(id: string, version: number) {
  return backendGet<MsaidiziScheduleVersion>(
    `${schedulePath(id)}/versions/${encodeURIComponent(String(version))}`,
  );
}

export function updateMsaidiziSchedule(id: string, request: UpdateMsaidiziScheduleRequest) {
  return backendPut<MsaidiziSchedule>(schedulePath(id), request);
}

function scheduleAction(id: string, action: 'activate' | 'pause' | 'archive', version: number) {
  return backendPost<MsaidiziSchedule>(`${schedulePath(id)}/${action}`, {
    expectedVersion: version,
  });
}

export const activateMsaidiziSchedule = (id: string, version: number) =>
  scheduleAction(id, 'activate', version);
export const pauseMsaidiziSchedule = (id: string, version: number) =>
  scheduleAction(id, 'pause', version);
export const archiveMsaidiziSchedule = (id: string, version: number) =>
  scheduleAction(id, 'archive', version);

export function deleteMsaidiziSchedule(id: string, version: number) {
  return backendDelete<MsaidiziSchedule>(schedulePath(id), {
    body: { expectedVersion: version },
  });
}

export function listMsaidiziMemories(
  params: {
    page?: number;
    limit?: number;
    kind?: MsaidiziMemoryKind;
    trustLevel?: MsaidiziTrustLevel;
    scopeKey?: string;
    companyId?: string;
  } = {},
) {
  return backendGet<MsaidiziControlPlanePage<MsaidiziMemory>>('/msaidizi/memory', {
    query: params,
  });
}

export function createMsaidiziMemory(request: CreateMsaidiziMemoryRequest) {
  return backendPost<MsaidiziMemoryDetail>('/msaidizi/memory', request);
}

export function fetchMsaidiziMemory(id: string) {
  return backendGet<MsaidiziMemoryDetail>(memoryPath(id));
}

export function updateMsaidiziMemory(id: string, request: UpdateMsaidiziMemoryRequest) {
  return backendPut<MsaidiziMemoryDetail>(memoryPath(id), request);
}

export function deleteMsaidiziMemory(id: string) {
  return backendDelete<{ id: string; deleted: true }>(memoryPath(id));
}

const devicePath = (id: string) => `/msaidizi/devices/${encodeURIComponent(id)}`;

export function listMsaidiziDevices() {
  return backendGet<MsaidiziDevicePage>('/msaidizi/devices');
}

export function createMsaidiziPairingCode(name: string) {
  return backendPost<MsaidiziPairingCode>('/msaidizi/devices/pair-codes', { name });
}

export function revokeMsaidiziDevice(id: string) {
  return backendPost<Partial<MsaidiziDevice>>(`${devicePath(id)}/revoke`);
}

export function killMsaidiziDevice(id: string) {
  return backendPost<Partial<MsaidiziDevice>>(`${devicePath(id)}/kill`);
}

export function killAllMsaidiziDevices() {
  return backendPost<{ killed: number }>('/msaidizi/devices/kill-all');
}

const recoveryCommandPath = (id: string) => `/msaidizi/recovery-commands/${encodeURIComponent(id)}`;

export function listMsaidiziRecoveryCommands(status?: MsaidiziRecoveryCommandStatus) {
  return status
    ? backendGet<MsaidiziRecoveryCommand[]>('/msaidizi/recovery-commands', {
        query: { status },
      })
    : backendGet<MsaidiziRecoveryCommand[]>('/msaidizi/recovery-commands');
}

export function fetchMsaidiziRecoveryCommand(id: string) {
  return backendGet<MsaidiziRecoveryCommand>(recoveryCommandPath(id));
}

/** Human-only exact recovery authorization; never called by deep-link loading. */
export function requestMsaidiziRecoveryCommand(request: RequestMsaidiziRecoveryCommand) {
  return backendPost<MsaidiziRecoveryCommand>('/msaidizi/recovery-commands', request);
}

/** Browser download URL; the backend proxy supplies the authenticated session. */
export function msaidiziArtifactDownloadUrl(id: string): string {
  return `${BACKEND_PROXY_URL}/msaidizi/artifacts/${encodeURIComponent(id)}/download`;
}

export function uploadMsaidiziArtifact(input: {
  taskId: string;
  file: File;
  kind: MsaidiziArtifactKind;
  name?: string;
  dataClass: string;
  provenance: Record<string, unknown>;
}): Promise<MsaidiziArtifact> {
  const form = new FormData();
  form.set('taskId', input.taskId);
  form.set('kind', input.kind);
  form.set('name', input.name ?? input.file.name);
  form.set('dataClass', input.dataClass);
  form.set('provenance', JSON.stringify(input.provenance));
  form.set('file', input.file);
  return backendUpload<MsaidiziArtifact>('/msaidizi/artifacts/upload', form);
}
