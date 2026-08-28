import {
  MsaidiziArtifactKind,
  MsaidiziHostActionStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ToolObservationArtifactInput } from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { sha256Hex, stableJson } from './device-security';
import { REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY } from './host-file-ephemerality.policy';
import {
  MsaidiziDevicesService,
  hostResultAuditSummary,
  validateHostOutputEnvelope,
  validateLocalSpeechReceipt,
} from './msaidizi-devices.service';
import type { ActionResultDto } from './dto/msaidizi-device.dto';

const taskId = '11111111-1111-4111-8111-111111111111';
const stepId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const artifactId = '44444444-4444-4444-8444-444444444444';
const baseHash = 'a'.repeat(64);
const prepareHash = 'b'.repeat(64);
const terminalHash = 'c'.repeat(64);

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
  'base64',
);
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
  'base64',
);
const wav = pcmWavHeader();

interface PrivateObservationApi {
  persistHostResultObservation(
    action: HostActionContext,
    outputJson: string,
  ): Promise<Record<string, unknown>>;
  settleResult(actionId: string, dto: ActionResultDto): Promise<Record<string, unknown>>;
}

function settlementHarness(options: { storageFailure?: Error; commitFailure?: Error } = {}) {
  const artifactStorage = artifactHarness({
    reject: options.storageFailure,
    commitReject: options.commitFailure,
  });
  const task = {
    id: taskId,
    status: MsaidiziTaskStatus.RUNNING,
    mode: MsaidiziTaskMode.AUTOPILOT,
    principalId: 'principal-1',
    initiatedByUserId: 'operator-1',
    companyId: 'company-1',
    mandateId: 'mandate-1',
    activePlanVersion: 1,
    bytesRead: 0n,
    bytesWritten: 0n,
    maxLocalBytes: 1_000_000n,
    reservedExternalEgressBytes: 8_000_000n,
    externalEgressBytes: 0n,
  };
  const actionRecord: Record<string, unknown> = {
    id: 'host-action-1',
    actionId: 'action-1',
    actionTokenDigest: 'd'.repeat(64),
    taskId,
    stepId,
    deviceId: 'device-1',
    leaseId: 'lease-1',
    leaseFencingToken: 7n,
    leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    status: MsaidiziHostActionStatus.DISPATCHED,
    startedAt: null,
    capability: 'screen.primary.capture',
    capabilityVersion: '1.0.0',
    reservedExternalEgressBytes: 8_000_000n,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    dispatchCount: 1,
    budgetSnapshot: {
      maxWallTimeSeconds: 7_000,
      maxModelTurns: 190,
      maxAttemptedToolCalls: 490,
      maxMutations: 99,
      maxLocalBytes: 1_000_000,
      maxExternalEgressBytes: 8_000_000,
      maxModelSpendUsd: 19,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 222_222,
    },
    expectedPreState: {},
    journalExpectedPreviousSequence: 11,
    journalPreviousHash: null,
    journalPreparePreviousHash: null,
    journalSequence: null,
    journalHash: null,
    resultSummary: null,
    step: {
      id: stepId,
      taskId,
      planVersionId: 'plan-1',
      mutation: false,
      arguments: { maxWidth: 1920, maxHeight: 1080 },
    },
    task,
    lease: { id: 'lease-1', fencingToken: 7n, status: 'ACTIVE' },
    device: {
      capabilityManifest: {
        runtime: { journalSequence: 11, journalHeadHash: baseHash },
      },
    },
    dispatches: [
      {
        actionTokenDigest: 'd'.repeat(64),
        dispatchCount: 1,
        executionMode: 'EXECUTE',
        tokenIssuedAt: null,
        tokenExpiresAt: null,
        leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    ],
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    msaidiziHostAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziToolAttempt: {
      findFirst: jest.fn().mockResolvedValue({ id: attemptId }),
      update: jest.fn().mockResolvedValue({}),
    },
    msaidiziTaskStep: {
      findUnique: jest.fn().mockResolvedValue({
        id: stepId,
        taskId,
        budgets: { maxLocalBytes: 1_000_000 },
        bytesRead: 0n,
        bytesWritten: 0n,
        localIoAccountingValid: true,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziTask: {
      findUnique: jest.fn().mockResolvedValue({
        bytesRead: 0n,
        bytesWritten: 0n,
        maxLocalBytes: 1_000_000n,
        reservedExternalEgressBytes: 8_000_000n,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziHostAction: { findUnique: jest.fn().mockImplementation(() => actionRecord) },
    msaidiziToolAttempt: { findFirst: jest.fn().mockResolvedValue({ id: attemptId }) },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = {
    logStrictInTransaction: jest.fn((client: typeof tx, input: Record<string, unknown>) =>
      client.auditLog.create({ data: input }),
    ),
  };
  const service = new MsaidiziDevicesService(
    prisma as never,
    {} as never,
    {} as never,
    audit as never,
    undefined,
    {
      ingestToolObservation: artifactStorage.ingestToolObservation,
      prepareToolObservation: artifactStorage.prepareToolObservation,
      commitPreparedToolObservation: artifactStorage.commitPreparedToolObservation,
      finishPreparedToolObservation: artifactStorage.finishPreparedToolObservation,
    } as never,
  ) as unknown as PrivateObservationApi;
  return { actionRecord, artifactStorage, audit, prisma, service, tx };
}

function screenResult(isIdempotentReplay = false): ActionResultDto {
  const outputJson = JSON.stringify({
    mediaType: 'image/png',
    contentBase64: png.toString('base64'),
    width: 1,
    height: 1,
    contentSha256: sha256(png),
  });
  return {
    actionId: 'action-1',
    taskId,
    stepId,
    leaseId: 'lease-1',
    fencingToken: '7',
    leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    actionTokenSha256: 'd'.repeat(64),
    outcome: 'Completed',
    outputJson,
    outputSha256: sha256(Buffer.from(outputJson, 'utf8')),
    mutationCommitted: false,
    outcomeUncertain: false,
    isIdempotentReplay,
    errorCode: null,
    provenance: [],
    journalPrepareSequence: 12,
    journalPrepareEntryHash: prepareHash,
    journalPreparePreviousHash: baseHash,
    journalSequence: 13,
    journalEntryHash: terminalHash,
    journalPreviousHash: prepareHash,
    preStateSha256: null,
    recoveryProvenanceSha256: null,
    recoveryHandleSha256: null,
    localBytesRead: png.length,
    localBytesWritten: 0,
    externalEgressBytes: 0,
    brokerExternalEgressBytes: 1_999_998,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    uncertainExternalEgressBytes: 0,
  };
}

interface HostActionContext {
  actionId: string;
  taskId: string;
  stepId: string;
  deviceId: string;
  capability: string;
  argsDigest: string;
  dataClass: string;
  step: { arguments: Prisma.JsonValue; planVersionId: string };
}

function action(
  capability: string,
  argumentsValue: Prisma.InputJsonObject = {},
): HostActionContext {
  return {
    actionId: 'action-1',
    taskId,
    stepId,
    deviceId: 'device-1',
    capability,
    argsDigest: sha256Hex(stableJson(argumentsValue)),
    dataClass: 'RESTRICTED',
    step: { arguments: argumentsValue as Prisma.JsonValue, planVersionId: 'plan-1' },
  };
}

function artifactHarness(options: { reject?: Error; replay?: boolean; commitReject?: Error } = {}) {
  let plaintextCopy: Buffer | undefined;
  const preview = (input: ToolObservationArtifactInput) => {
    plaintextCopy = Buffer.from(input.content);
    if (options.reject) throw options.reject;
    const mimeType = input.file?.mimeType ?? input.media?.mimeType ?? 'application/json';
    return {
      artifact: {
        id: artifactId,
        sha256: input.persistedSha256,
        mimeType,
        kind: input.file
          ? MsaidiziArtifactKind.FILE
          : input.media
            ? input.media.mimeType.startsWith('image/')
              ? MsaidiziArtifactKind.SCREENSHOT
              : MsaidiziArtifactKind.AUDIO
            : MsaidiziArtifactKind.OTHER,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      },
      replay: options.replay === true,
    };
  };
  const ingestToolObservation = jest.fn(async (input: ToolObservationArtifactInput) =>
    preview(input),
  );
  const prepareToolObservation = jest.fn(async (input: ToolObservationArtifactInput) =>
    preview(input),
  );
  const commitPreparedToolObservation = jest.fn(
    async (_tx: unknown, prepared: ReturnType<typeof preview>) => {
      if (options.commitReject) throw options.commitReject;
      return prepared;
    },
  );
  const finishPreparedToolObservation = jest.fn(async () => undefined);
  const prisma = {
    msaidiziToolAttempt: {
      findFirst: jest.fn().mockResolvedValue({ id: attemptId }),
    },
  };
  const service = new MsaidiziDevicesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    {
      ingestToolObservation,
      prepareToolObservation,
      commitPreparedToolObservation,
      finishPreparedToolObservation,
    } as never,
  ) as unknown as PrivateObservationApi;
  return {
    service,
    artifactStorage: {
      ingestToolObservation,
      prepareToolObservation,
      commitPreparedToolObservation,
      finishPreparedToolObservation,
    },
    ingestToolObservation,
    prepareToolObservation,
    commitPreparedToolObservation,
    finishPreparedToolObservation,
    plaintext: () => plaintextCopy,
  };
}

describe('governed host observation artifacts', () => {
  afterAll(() => {
    png.fill(0);
    jpeg.fill(0);
    wav.fill(0);
  });

  it('promotes a large DLP-scrubbed generic result and persists only its reference', async () => {
    const marker = 'large-observation-marker';
    const outputJson = JSON.stringify({ rows: [`${marker}:${'x'.repeat(70 * 1024)}`] });
    const harness = artifactHarness();

    const result = await harness.service.persistHostResultObservation(
      action('system.status.read'),
      outputJson,
    );

    expect(harness.ingestToolObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        stepId,
        attemptId,
        sourceType: 'HOST_RESULT',
      }),
    );
    expect(result).toMatchObject({
      artifact: {
        artifactId,
        artifactMimeType: 'application/json',
        artifactKind: MsaidiziArtifactKind.OTHER,
        trustLevel: 'UNTRUSTED',
      },
      observation: { reason: 'ARTIFACT_STORED', artifactId, trustLevel: 'UNTRUSTED' },
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(harness.plaintext()?.every((byte) => byte === 0)).toBe(false);
    const callerBuffer = harness.ingestToolObservation.mock.calls[0][0].content as Buffer;
    expect(callerBuffer.every((byte) => byte === 0)).toBe(true);
    harness.plaintext()?.fill(0);
  });

  it.each([
    {
      capability: 'screen.primary.capture',
      mediaType: 'image/png',
      content: png,
      argumentsValue: { maxWidth: 1920, maxHeight: 1080 },
      output: (content: Buffer) => ({
        mediaType: 'image/png',
        contentBase64: content.toString('base64'),
        width: 1,
        height: 1,
        contentSha256: sha256(content),
      }),
    },
    {
      capability: 'camera.photo.capture',
      mediaType: 'image/jpeg',
      content: jpeg,
      argumentsValue: { cameraId: 'front-camera', maxWidth: 1280, maxHeight: 720 },
      output: (content: Buffer) => ({
        cameraId: 'front-camera',
        mediaType: 'image/jpeg',
        contentBase64: content.toString('base64'),
        width: 1,
        height: 1,
        contentSha256: sha256(content),
      }),
    },
  ])(
    'stores $capability as validated binary $mediaType without persisting Base64',
    async ({ capability, mediaType: expectedMediaType, content, argumentsValue, output }) => {
      const outputValue = output(content);
      const outputJson = JSON.stringify(outputValue);
      const harness = artifactHarness();
      const context = action(capability, argumentsValue);

      expect(validateHostOutputEnvelope(context, outputJson)).toBe(true);
      const result = await harness.service.persistHostResultObservation(context, outputJson);
      const input = harness.ingestToolObservation.mock.calls[0][0] as ToolObservationArtifactInput;

      expect(input.media).toEqual({ capability, mimeType: expectedMediaType });
      expect(harness.plaintext()?.equals(content)).toBe(true);
      expect(input.content.every((byte) => byte === 0)).toBe(true);
      expect(result).toMatchObject({
        artifact: {
          artifactMimeType: expectedMediaType,
          artifactKind: MsaidiziArtifactKind.SCREENSHOT,
          trustLevel: 'UNTRUSTED',
          provenance: {
            capability,
            mediaType: expectedMediaType,
            contentSha256: sha256(content),
          },
        },
      });
      expect(JSON.stringify(result)).not.toContain(outputValue.contentBase64);
      harness.plaintext()?.fill(0);
    },
  );

  it('rejects mismatched media/capability/digest envelopes before storage', () => {
    const outputJson = JSON.stringify({
      mediaType: 'image/jpeg',
      contentBase64: png.toString('base64'),
      width: 1,
      height: 1,
      contentSha256: '0'.repeat(64),
    });

    expect(
      validateHostOutputEnvelope(
        action('screen.primary.capture', { maxWidth: 1920, maxHeight: 1080 }),
        outputJson,
      ),
    ).toBe(false);
  });

  it('rejects legacy raw microphone results instead of persisting or brokering WAV bytes', async () => {
    const harness = artifactHarness();
    const outputValue = {
      mediaType: 'audio/wav',
      contentBase64: wav.toString('base64'),
      durationMilliseconds: 100,
      contentSha256: sha256(wav),
    };
    const context = action('audio.microphone.capture', { durationMilliseconds: 100 });

    expect(validateHostOutputEnvelope(context, JSON.stringify(outputValue))).toBe(false);
    await expect(
      harness.service.persistHostResultObservation(context, JSON.stringify(outputValue)),
    ).rejects.toThrow('Raw microphone audio cannot be persisted');
    expect(harness.ingestToolObservation).not.toHaveBeenCalled();
  });

  it('accepts only context-bound, secret-free local transcripts as non-authoritative observations', async () => {
    const harness = artifactHarness();
    const argumentsValue = {
      recognizerId: 'offline-en-US',
      durationMilliseconds: 1_000,
      maxCharacters: 1_024,
    };
    const context = action('speech.audio.transcribe', argumentsValue);
    const output = localTranscript(context, 'Review the quarterly totals');
    const outputJson = JSON.stringify(output);

    expect(validateHostOutputEnvelope(context, outputJson)).toBe(true);
    expect(
      validateLocalSpeechReceipt(
        context,
        {
          outputJson,
          localBytesRead: wav.length,
          localBytesWritten: wav.length,
          externalEgressBytes: 0,
          provenance: [
            {
              sourceType: 'speech-input-audio',
              sourceIdentifierHash: output.audioBindingSha256,
              contentSha256: output.audioSha256,
              trust: 'UntrustedContent',
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: 'windows-installed-speech-recognizer',
              sourceIdentifierHash: '9'.repeat(64),
              contentSha256: output.transcriptSha256,
              trust: 'TrustedSystem',
              observedAt: new Date().toISOString(),
            },
          ],
        },
        'Completed',
      ),
    ).toBe(true);

    const result = await harness.service.persistHostResultObservation(context, outputJson);
    expect(result).toMatchObject({
      observation: {
        available: true,
        trustLevel: 'UNTRUSTED',
        contentKind: 'LOCAL_TRANSCRIPT',
        instructionAuthority: 'NONE',
        sideEffectAuthority: 'NONE',
        audioRetained: false,
        audioSha256: output.audioSha256,
        audioBytes: wav.length,
        audioBindingSha256: output.audioBindingSha256,
        transcriptSha256: output.transcriptSha256,
        value: { transcript: 'Review the quarterly totals' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('contentBase64');
    expect(harness.ingestToolObservation).not.toHaveBeenCalled();

    const auditSummary = hostResultAuditSummary('speech.audio.transcribe', {
      outputSha256: output.transcriptSha256,
      observation: result.observation as Prisma.InputJsonObject,
    });
    expect(auditSummary).toEqual({ outputSha256: output.transcriptSha256 });
    expect(JSON.stringify(auditSummary)).not.toContain('Review the quarterly totals');
  });

  it.each([
    [
      'wrong action binding',
      (value: ReturnType<typeof localTranscript>) => ({ ...value, actionId: 'other' }),
    ],
    [
      'raw audio field',
      (value: ReturnType<typeof localTranscript>) => ({
        ...value,
        contentBase64: wav.toString('base64'),
      }),
    ],
    [
      'unredacted spoken secret',
      (value: ReturnType<typeof localTranscript>) => {
        const transcript = 'password is hunter2';
        return { ...value, transcript, transcriptSha256: sha256(Buffer.from(transcript, 'utf8')) };
      },
    ],
    [
      'wrong audio binding',
      (value: ReturnType<typeof localTranscript>) => ({
        ...value,
        audioBindingSha256: '0'.repeat(64),
      }),
    ],
  ])('rejects a local transcript with %s before persistence', async (_label, mutate) => {
    const harness = artifactHarness();
    const context = action('speech.audio.transcribe', {
      recognizerId: 'offline-en-US',
      durationMilliseconds: 1_000,
      maxCharacters: 1_024,
    });
    const outputJson = JSON.stringify(mutate(localTranscript(context, 'safe words')));

    expect(validateHostOutputEnvelope(context, outputJson)).toBe(false);
    await expect(
      harness.service.persistHostResultObservation(context, outputJson),
    ).rejects.toBeDefined();
    expect(harness.ingestToolObservation).not.toHaveBeenCalled();
  });

  it.each([
    ['known-secret text', Buffer.from('known-secret-file-canary-7u3X', 'utf8'), 'secret.txt'],
    ['PDF', Buffer.from('%PDF-1.7\nknown-secret-file-canary-7u3X\n%%EOF\n', 'ascii'), 'secret.pdf'],
    ['binary', Buffer.from('PK\u0003\u0004office-container', 'binary'), 'quarter.docx'],
  ])('refuses %s file bytes before artifact preparation', async (_label, content, name) => {
    const harness = artifactHarness();
    const argumentsValue = {
      rootId: 'managed',
      relativePath: `reports/${name}`,
      maxBytes: 524_288,
    };
    const context = action('filesystem.file.read', argumentsValue);
    const outputJson = JSON.stringify({
      rootId: 'managed',
      relativePath: `reports\\${name}`,
      contentBase64: content.toString('base64'),
      length: content.length,
      contentSha256: sha256(content),
    });

    expect(validateHostOutputEnvelope(context, outputJson)).toBe(false);
    await expect(harness.service.persistHostResultObservation(context, outputJson)).rejects.toThrow(
      'REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY',
    );
    expect(harness.ingestToolObservation).not.toHaveBeenCalled();
    content.fill(0);
  });

  it.each(['filesystem.file.read', 'filesystem.file.disclose.ephemeral'])(
    'settles a forged or replayed %s result without persisting its raw bytes',
    async (capability) => {
      const harness = settlementHarness();
      const secret = 'msaidizi-result-secret-canary';
      const content = Buffer.from(`password=${secret}`, 'utf8');
      const outputJson = JSON.stringify({
        rootId: 'managed',
        relativePath: 'credentials.txt',
        contentBase64: content.toString('base64'),
        length: content.length,
        contentSha256: sha256(content),
      });
      Object.assign(harness.actionRecord, {
        capability,
        capabilityVersion: '1.0.0',
      });
      Object.assign(harness.actionRecord.step as Record<string, unknown>, {
        arguments: {
          rootId: 'managed',
          relativePath: 'credentials.txt',
          maxBytes: 524_288,
        },
      });
      const result = { ...screenResult(), outputJson };
      result.outputSha256 = sha256(Buffer.from(outputJson, 'utf8'));

      try {
        await expect(harness.service.settleResult('host-action-1', result)).resolves.toEqual({
          accepted: true,
          replay: false,
          status: MsaidiziHostActionStatus.FAILED,
          taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
        });

        expect(harness.artifactStorage.prepareToolObservation).not.toHaveBeenCalled();
        expect(harness.artifactStorage.commitPreparedToolObservation).not.toHaveBeenCalled();
        expect(harness.artifactStorage.ingestToolObservation).not.toHaveBeenCalled();
        expect(harness.tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: MsaidiziHostActionStatus.FAILED,
              errorCode: REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
            }),
          }),
        );
        expect(harness.tx.msaidiziTask.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: MsaidiziTaskStatus.NEEDS_ATTENTION,
              failureCode: REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
            }),
          }),
        );

        const durableCalls = stringifyWithBigInts({
          hostAction: harness.tx.msaidiziHostAction.updateMany.mock.calls,
          attempt: harness.tx.msaidiziToolAttempt.update.mock.calls,
          step: harness.tx.msaidiziTaskStep.updateMany.mock.calls,
          task: harness.tx.msaidiziTask.updateMany.mock.calls,
          event: harness.tx.msaidiziTaskEvent.create.mock.calls,
          audit: harness.audit.logStrictInTransaction.mock.calls,
        });
        expect(durableCalls).not.toContain(secret);
        expect(durableCalls).not.toContain(content.toString('base64'));
      } finally {
        content.fill(0);
      }
    },
  );

  it.each(['filesystem.file.read', 'filesystem.file.disclose.ephemeral'])(
    'ignores a %s result redelivery after terminal settlement without reopening bytes',
    async (capability) => {
      const harness = settlementHarness();
      const secret = 'msaidizi-replayed-result-secret';
      const contentBase64 = Buffer.from(secret, 'utf8').toString('base64');
      const outputJson = JSON.stringify({
        rootId: 'managed',
        relativePath: 'credentials.bin',
        contentBase64,
        length: Buffer.byteLength(secret),
        contentSha256: sha256(Buffer.from(secret, 'utf8')),
      });
      Object.assign(harness.actionRecord, {
        capability,
        capabilityVersion: '1.0.0',
        status: MsaidiziHostActionStatus.SUCCEEDED,
      });
      const result = { ...screenResult(true), outputJson };
      result.outputSha256 = sha256(Buffer.from(outputJson, 'utf8'));

      await expect(harness.service.settleResult('host-action-1', result)).resolves.toEqual({
        accepted: true,
        replay: true,
        status: MsaidiziHostActionStatus.FAILED,
        taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
      });

      expect(harness.artifactStorage.prepareToolObservation).not.toHaveBeenCalled();
      expect(harness.artifactStorage.commitPreparedToolObservation).not.toHaveBeenCalled();
      expect(harness.artifactStorage.ingestToolObservation).not.toHaveBeenCalled();
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
      const durableCalls = stringifyWithBigInts({
        lookup: harness.prisma.msaidiziHostAction.findUnique.mock.calls,
        transaction: harness.prisma.$transaction.mock.calls,
      });
      expect(durableCalls).not.toContain(secret);
      expect(durableCalls).not.toContain(contentBase64);
    },
  );

  it('settles host state, event, and audit with only the media artifact reference and replays once', async () => {
    const harness = settlementHarness();
    const original = screenResult();
    const rawBase64 = (JSON.parse(original.outputJson!) as { contentBase64: string }).contentBase64;

    await expect(harness.service.settleResult('host-action-1', original)).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.SUCCEEDED,
    });
    const settlementData = harness.tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    const summaryText = JSON.stringify(settlementData.resultSummary);
    expect(summaryText).not.toContain(rawBase64);
    expect(settlementData.resultSummary).toMatchObject({
      observation: {
        artifactId,
        artifactMimeType: 'image/png',
        trustLevel: 'UNTRUSTED',
      },
    });
    const settledEvent = harness.tx.msaidiziTaskEvent.create.mock.calls.find(
      ([call]) => call.data.type === 'host_action.settled',
    )?.[0];
    expect(settledEvent?.data.payload).toMatchObject({
      artifact: { artifactId, artifactMimeType: 'image/png', trustLevel: 'UNTRUSTED' },
    });
    expect(JSON.stringify(settledEvent)).not.toContain(rawBase64);
    expect(harness.audit.logStrictInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        action: 'MSAIDIZI_HOST_ACTION_SETTLED',
        companyId: 'company-1',
        newValue: expect.objectContaining({
          observation: expect.objectContaining({ artifactId, artifactMimeType: 'image/png' }),
        }),
      }),
    );
    expect(JSON.stringify(harness.audit.logStrictInTransaction.mock.calls)).not.toContain(
      rawBase64,
    );

    Object.assign(harness.actionRecord, settlementData);
    await expect(
      harness.service.settleResult('host-action-1', screenResult(true)),
    ).resolves.toMatchObject({ accepted: true, replay: true });
    expect(harness.artifactStorage.ingestToolObservation).not.toHaveBeenCalled();
    expect(harness.artifactStorage.prepareToolObservation).toHaveBeenCalledTimes(1);
    expect(harness.artifactStorage.commitPreparedToolObservation).toHaveBeenCalledTimes(1);
    expect(harness.artifactStorage.finishPreparedToolObservation).toHaveBeenCalledWith(
      expect.any(Object),
      true,
    );
    expect(harness.tx.msaidiziHostAction.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      harness.artifactStorage.commitPreparedToolObservation.mock.invocationCallOrder[0],
    );
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    harness.artifactStorage.plaintext()?.fill(0);
  });

  it('fails closed to UNKNOWN when encrypted media storage or accounting fails', async () => {
    const harness = settlementHarness({ storageFailure: new Error('artifact vault offline') });

    await expect(harness.service.settleResult('host-action-1', screenResult())).resolves.toEqual({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.UNKNOWN,
    });
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziHostActionStatus.UNKNOWN }),
      }),
    );
    const input = harness.artifactStorage.prepareToolObservation.mock.calls[0][0];
    expect(input.content.every((byte: number) => byte === 0)).toBe(true);
    harness.artifactStorage.plaintext()?.fill(0);
  });

  it('does not publish or charge a prepared artifact when the host settlement CAS loses', async () => {
    const harness = settlementHarness();
    harness.tx.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(harness.service.settleResult('host-action-1', screenResult())).rejects.toThrow(
      'settlement eligibility changed before persistence',
    );

    expect(harness.artifactStorage.prepareToolObservation).toHaveBeenCalledTimes(1);
    expect(harness.artifactStorage.commitPreparedToolObservation).not.toHaveBeenCalled();
    expect(harness.artifactStorage.finishPreparedToolObservation).toHaveBeenCalledWith(
      expect.any(Object),
      false,
    );
    expect(harness.tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back the artifact lifecycle when work after its commit fails', async () => {
    const harness = settlementHarness();
    harness.tx.msaidiziToolAttempt.findFirst.mockRejectedValueOnce(
      new Error('attempt projection unavailable'),
    );

    await expect(harness.service.settleResult('host-action-1', screenResult())).rejects.toThrow(
      'attempt projection unavailable',
    );

    expect(harness.artifactStorage.commitPreparedToolObservation).toHaveBeenCalledTimes(1);
    expect(harness.artifactStorage.finishPreparedToolObservation).toHaveBeenCalledWith(
      expect.any(Object),
      false,
    );
  });

  it('fails closed to UNKNOWN when the atomic artifact commit itself fails', async () => {
    const harness = settlementHarness({ commitFailure: new Error('artifact commit failed') });

    await expect(harness.service.settleResult('host-action-1', screenResult())).resolves.toEqual({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.UNKNOWN,
    });

    expect(harness.artifactStorage.commitPreparedToolObservation).toHaveBeenCalledTimes(1);
    expect(harness.artifactStorage.finishPreparedToolObservation).toHaveBeenCalledWith(
      expect.any(Object),
      false,
    );
  });

  it('propagates artifact storage failure and zeroes the caller-owned buffer', async () => {
    const harness = artifactHarness({ reject: new Error('encrypted storage offline') });
    const outputJson = JSON.stringify({ rows: ['x'.repeat(70 * 1024)] });

    await expect(
      harness.service.persistHostResultObservation(action('system.status.read'), outputJson),
    ).rejects.toThrow('encrypted storage offline');
    const callerBuffer = harness.ingestToolObservation.mock.calls[0][0].content as Buffer;
    expect(callerBuffer.every((byte) => byte === 0)).toBe(true);
    harness.plaintext()?.fill(0);
  });

  it('preserves deterministic artifact replay metadata without exposing payload content', async () => {
    const harness = artifactHarness({ replay: true });
    const marker = 'replayed-large-marker';
    const outputJson = JSON.stringify({ rows: [`${marker}:${'x'.repeat(70 * 1024)}`] });

    const result = await harness.service.persistHostResultObservation(
      action('system.status.read'),
      outputJson,
    );

    expect(result).toMatchObject({
      artifact: { artifactId, replay: true },
      observation: { artifactId, replay: true },
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    harness.plaintext()?.fill(0);
  });
});

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function stringifyWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) =>
    typeof candidate === 'bigint' ? candidate.toString() : candidate,
  );
}

function localTranscript(context: HostActionContext, transcript: string) {
  const audioSha256 = sha256(wav);
  return {
    protocol: 'msaidizi-local-stt/v1',
    taskId: context.taskId,
    planVersionId: context.step.planVersionId,
    stepId: context.stepId,
    deviceId: context.deviceId,
    actionId: context.actionId,
    recognizerId: (context.step.arguments as Prisma.JsonObject).recognizerId,
    audioBytes: wav.length,
    durationMilliseconds: 100,
    transcript,
    confidence: 0.82,
    audioSha256,
    transcriptSha256: sha256(Buffer.from(transcript, 'utf8')),
    audioBindingSha256: sha256(
      Buffer.from(
        [
          'msaidizi-local-stt/v1',
          context.taskId,
          context.step.planVersionId,
          context.stepId,
          context.deviceId,
          context.actionId,
          audioSha256,
        ].join('\0'),
        'utf8',
      ),
    ),
    redactionsApplied: false,
    trustLevel: 'UNTRUSTED',
    instructionAuthority: 'NONE',
  };
}

function pcmWavHeader(): Buffer {
  const content = Buffer.alloc(44);
  content.write('RIFF', 0, 'ascii');
  content.writeUInt32LE(36, 4);
  content.write('WAVE', 8, 'ascii');
  content.write('fmt ', 12, 'ascii');
  content.writeUInt32LE(16, 16);
  content.writeUInt16LE(1, 20);
  content.writeUInt16LE(1, 22);
  content.writeUInt32LE(8_000, 24);
  content.writeUInt32LE(16_000, 28);
  content.writeUInt16LE(2, 32);
  content.writeUInt16LE(16, 34);
  content.write('data', 36, 'ascii');
  content.writeUInt32LE(0, 40);
  return content;
}
