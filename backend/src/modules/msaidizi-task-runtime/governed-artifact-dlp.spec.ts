import {
  MsaidiziDeviceStatus,
  MsaidiziEffect,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  Prisma,
} from '@prisma/client';
import { JobHandlerRegistry } from '../job-worker/job-handler.registry';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziDevicesService } from '../msaidizi-devices/msaidizi-devices.service';
import {
  ResolvedStepInputs,
  sha256Canonical,
  staticStepInputs,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import { hostQueueCheckpointData, MsaidiziTaskStepHandler } from './msaidizi-task-step.handler';

const TASK_ID = '10000000-0000-4000-8000-000000000001';
const PLAN_ID = '10000000-0000-4000-8000-000000000002';
const STEP_ID = '10000000-0000-4000-8000-000000000003';
const ATTEMPT_ID = '10000000-0000-4000-8000-000000000004';
const DEVICE_ID = '10000000-0000-4000-8000-000000000005';
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000006';
const SOURCE_STEP_ID = '10000000-0000-4000-8000-000000000007';
const SOURCE_ATTEMPT_ID = '10000000-0000-4000-8000-000000000008';
const RAW_ARTIFACT_BYTES = Buffer.from(
  'governed bytes that must never enter a durable projection',
  'utf8',
);
const RAW_ARTIFACT_BASE64 = RAW_ARTIFACT_BYTES.toString('base64');

function serialiseDurableCalls(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) =>
    typeof candidate === 'bigint' ? candidate.toString() : candidate,
  );
}

function governedInputs(): ResolvedStepInputs {
  const resolved = staticStepInputs(TASK_ID, PLAN_ID, STEP_ID, ATTEMPT_ID, {
    attachment: {
      schemaVersion: 1,
      taskId: TASK_ID,
      planVersionId: PLAN_ID,
      targetStepId: STEP_ID,
      deviceId: DEVICE_ID,
      sourceStepId: SOURCE_STEP_ID,
      sourceAttemptId: SOURCE_ATTEMPT_ID,
      artifactId: ARTIFACT_ID,
      sha256: 'a'.repeat(64),
      byteSize: RAW_ARTIFACT_BYTES.length,
      mimeType: 'text/plain',
      name: 'reviewed-report.txt',
      kind: 'FILE',
      dataClass: 'Internal',
      scopeSha256: 'b'.repeat(64),
      contentBase64: RAW_ARTIFACT_BASE64,
    },
  });
  const provenance = {
    ...resolved.provenance,
    bindings: [
      {
        targetPath: '/attachment',
        trustLevel: 'UNTRUSTED',
        instructionAuthority: false,
        source: {
          kind: 'DEPENDENCY_ARTIFACT',
          stepId: SOURCE_STEP_ID,
          attemptId: SOURCE_ATTEMPT_ID,
          artifactId: ARTIFACT_ID,
          artifactSha256: 'a'.repeat(64),
        },
      },
    ],
  } as Prisma.InputJsonObject;
  return {
    ...resolved,
    provenance,
    provenanceSha256: sha256Canonical(provenance),
  };
}

describe('governed artifact durable-record DLP', () => {
  it('projects an explicit value-free worker checkpoint instead of spreading queue internals', () => {
    const checkpoint = hostQueueCheckpointData({
      queued: true,
      replay: false,
      actionId: 'action-1',
      deviceId: DEVICE_ID,
      contentBase64: RAW_ARTIFACT_BASE64,
    } as Parameters<typeof hostQueueCheckpointData>[0] & {
      contentBase64: string;
    });

    expect(checkpoint).toEqual({
      ok: true,
      queued: true,
      replay: false,
      actionId: 'action-1',
      deviceId: DEVICE_ID,
    });
    expect(serialiseDurableCalls(checkpoint)).not.toContain('contentBase64');
    expect(serialiseDurableCalls(checkpoint)).not.toContain(RAW_ARTIFACT_BASE64);
  });

  it('redacts materialized bytes from attempts and keeps events and audit value-free', async () => {
    const attemptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const eventCreate = jest.fn().mockResolvedValue({ cursor: 1n });
    const audit = { logStrictInTransaction: jest.fn().mockResolvedValue({}) };
    const tx = {
      msaidiziToolAttempt: {
        updateMany: attemptUpdate,
        findFirst: jest.fn(),
      },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      { report: jest.fn() } as never,
      audit as never,
    ) as unknown as {
      bindResolvedInputs(
        loaded: {
          task: Record<string, unknown>;
          step: Record<string, unknown>;
        },
        attemptId: string,
        resolved: ResolvedStepInputs,
      ): Promise<void>;
    };

    await handler.bindResolvedInputs(
      {
        task: {
          id: TASK_ID,
          initiatedByUserId: 'operator-1',
          companyId: 'company-1',
          principalId: 'principal-1',
          mandateId: 'mandate-1',
        },
        step: { id: STEP_ID, mutation: false, inputBindings: [{}] },
      },
      ATTEMPT_ID,
      governedInputs(),
    );

    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          argumentsRedacted: expect.objectContaining({
            attachment: expect.objectContaining({ contentBase64: '[REDACTED]' }),
          }),
        }),
      }),
    );
    const durableCalls = serialiseDurableCalls({
      attempt: attemptUpdate.mock.calls,
      events: eventCreate.mock.calls,
      audit: audit.logStrictInTransaction.mock.calls,
    });
    expect(durableCalls).not.toContain(RAW_ARTIFACT_BASE64);
    expect(durableCalls).toContain('"contentBase64":"[REDACTED]"');
  });

  it('redacts host-action arguments while attempt, event, and audit projections retain hashes only', async () => {
    const resolved = governedInputs();
    const now = new Date();
    const task = {
      id: TASK_ID,
      status: MsaidiziTaskStatus.RUNNING,
      mode: MsaidiziTaskMode.AUTOPILOT,
      principalId: 'principal-1',
      initiatedByUserId: 'operator-1',
      companyId: 'company-1',
      mandateId: 'mandate-1',
      maxWallTimeSeconds: 7_200,
      maxModelTurns: 200,
      maxAttemptedToolCalls: 500,
      maxMutations: 100,
      maxLocalBytes: 5_000_000n,
      maxExternalEgressBytes: 20_000_000n,
      maxModelCostUsd: new Prisma.Decimal(20),
      startedAt: new Date(now.getTime() - 1_000),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: now,
      modelTurns: 0,
      attemptedToolCalls: 1,
      mutations: 0,
      bytesRead: BigInt(RAW_ARTIFACT_BYTES.length),
      bytesWritten: 0n,
      externalEgressBytes: 0n,
      reservedExternalEgressBytes: 0n,
      modelCostUsd: new Prisma.Decimal(0),
      principal: { status: MsaidiziPrincipalStatus.ACTIVE },
      mandate: {
        id: 'mandate-1',
        status: MsaidiziMandateStatus.ACTIVE,
        startsAt: null,
        expiresAt: null,
        deviceIds: [DEVICE_ID],
        budgets: {},
        capabilities: [
          {
            capability: 'system.status.read',
            version: '1.0.0',
            effects: [MsaidiziEffect.READ],
            dataClasses: ['Internal'],
          },
        ],
      },
    };
    const step = {
      id: STEP_ID,
      taskId: TASK_ID,
      planVersionId: PLAN_ID,
      status: MsaidiziTaskStepStatus.RUNNING,
      capability: 'system.status.read',
      capabilityVersion: '1.0.0',
      expectedEffect: MsaidiziEffect.READ,
      dataClass: 'Internal',
      mutation: false,
      arguments: { attachment: null },
      inputBindings: [{}],
      preconditions: { deviceId: DEVICE_ID },
      budgets: {},
      startedAt: now,
      bytesRead: BigInt(RAW_ARTIFACT_BYTES.length),
      bytesWritten: 0n,
      localIoAccountingValid: true,
      task,
      planVersion: { id: PLAN_ID, version: 1, inputs: {} },
    };
    const device = {
      id: DEVICE_ID,
      principalId: task.principalId,
      status: MsaidiziDeviceStatus.ACTIVE,
      capabilityManifest: {
        capabilities: [
          {
            id: step.capability,
            version: step.capabilityVersion,
            effect: 0,
            dataClass: 1,
            consent: 2,
            recovery: 0,
          },
        ],
      },
    };
    const hostActionCreate = jest.fn().mockResolvedValue({});
    const attemptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const eventCreate = jest.fn().mockResolvedValue({ cursor: 2n });
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          consumedWallTimeMs: task.consumedWallTimeMs,
          wallTimeCheckpointAt: task.wallTimeCheckpointAt,
          maxWallTimeSeconds: task.maxWallTimeSeconds,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziHostAction: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: hostActionCreate,
      },
      msaidiziDeviceLease: {
        create: jest.fn().mockResolvedValue({
          id: 'lease-1',
          fencingToken: 1n,
          expiresAt: new Date(now.getTime() + 30_000),
        }),
      },
      msaidiziToolAttempt: { updateMany: attemptUpdate },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(step) },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          argsDigest: resolved.argumentsSha256,
          resolvedInputProvenance: resolved.provenance,
          inputProvenanceSha256: resolved.provenanceSha256,
        }),
      },
      msaidiziDevice: { findFirst: jest.fn().mockResolvedValue(device) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const audit = { logStrictInTransaction: jest.fn().mockResolvedValue({}) };
    const service = new MsaidiziDevicesService(
      prisma as never,
      {
        channelReady: () => true,
        leasePepper: 'p'.repeat(64),
        leaseTtlSeconds: 30,
      } as never,
      { assertReady: jest.fn() } as never,
      audit as never,
    );

    await expect(
      service.queueHostAction(TASK_ID, STEP_ID, ATTEMPT_ID, resolved),
    ).resolves.toMatchObject({ queued: true, replay: false, deviceId: DEVICE_ID });

    expect(hostActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          argumentsRedacted: expect.objectContaining({
            attachment: expect.objectContaining({ contentBase64: '[REDACTED]' }),
          }),
          argsDigest: resolved.argumentsJsonSha256.toUpperCase(),
          inputProvenanceSha256: resolved.provenanceSha256,
        }),
      }),
    );
    const durableCalls = serialiseDurableCalls({
      hostAction: hostActionCreate.mock.calls,
      attempt: attemptUpdate.mock.calls,
      events: eventCreate.mock.calls,
      audit: audit.logStrictInTransaction.mock.calls,
    });
    expect(durableCalls).not.toContain(RAW_ARTIFACT_BASE64);
    expect(durableCalls).toContain('"contentBase64":"[REDACTED]"');
  });
});
