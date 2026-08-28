import { ConfigService } from '@nestjs/config';
import {
  MsaidiziArtifactKind,
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziTrustLevel,
} from '@prisma/client';
import { JobHandlerRegistry } from '../job-worker/job-handler.registry';
import {
  AdaptiveReasoningImageBinding,
  MsaidiziArtifactsService,
  ReasoningArtifactContent,
} from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY } from '../msaidizi-devices/host-file-ephemerality.policy';
import { ModelClient, ModelRequest } from '../msaidizi/model-client';
import { MsaidiziAdaptiveReasoningService } from './msaidizi-adaptive-reasoning.service';

const taskId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const artifactId = '44444444-4444-4444-8444-444444444444';
const attemptId = '55555555-5555-4555-8555-555555555555';
const sha256 = 'a'.repeat(64);

describe('adaptive checkpoint media handoff', () => {
  it('attaches only the exact settled native image as explicitly untrusted model content', async () => {
    const content = Buffer.from('native-image-bytes');
    const fixture = adaptiveFixture(screenObservation(content.length), {
      id: artifactId,
      taskId,
      kind: MsaidiziArtifactKind.SCREENSHOT,
      name: `screen-${stepId}.png`,
      mimeType: 'image/png',
      byteSize: BigInt(content.length),
      sha256,
      dataClass: 'screen-content',
      trustLevel: 'UNTRUSTED',
      storedTrustLevel: MsaidiziTrustLevel.UNTRUSTED,
      provenance: { sourceType: 'HOST_RESULT' },
      content,
    });

    const built = await adaptiveApi(fixture.service).buildModelInput(taskId, planId, stepId);
    const payload = JSON.parse(built.request.messages[0].content as string);
    expect(payload.mediaAttachment).toEqual({
      status: 'READY',
      mediaKind: 'IMAGE',
      artifactId,
      mimeType: 'image/png',
      sha256,
      byteSize: content.length,
      capability: 'screen.primary.capture',
      trustLevel: 'UNTRUSTED',
      instructionAuthority: 'NONE',
    });
    expect(built.image).toEqual(expect.objectContaining({ artifactId, trustLevel: 'UNTRUSTED' }));

    const attached = await adaptiveApi(fixture.service).attachCheckpointImage(
      built,
      taskId,
      planId,
      stepId,
    );

    expect(fixture.artifacts.readSettledImageForAdaptiveReasoning).toHaveBeenCalledWith({
      taskId,
      planVersionId: planId,
      planVersion: 1,
      stepId,
      attemptId,
      artifactId,
      capability: 'screen.primary.capture',
      mimeType: 'image/png',
      sha256,
      byteSize: 'native-image-bytes'.length,
      dataClass: 'screen-content',
    });
    expect(attached.request.tools).toEqual([]);
    const blocks = attached.request.messages[0].content as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('UNTRUSTED') }),
    );
    expect(blocks[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from('native-image-bytes').toString('base64'),
      },
    });
    expect(content.every((byte) => byte === 0)).toBe(true);
  });

  it('makes raw audio an explicit local-transcription gap and never opens or sends it', async () => {
    const fixture = adaptiveFixture(audioObservation());

    const built = await adaptiveApi(fixture.service).buildModelInput(taskId, planId, stepId);
    const payloadText = built.request.messages[0].content as string;
    const payload = JSON.parse(payloadText);

    expect(payload.mediaAttachment).toEqual({
      status: 'REFUSED',
      mediaKind: 'AUDIO',
      artifactId,
      mimeType: 'audio/wav',
      capability: 'audio.microphone.capture',
      trustLevel: 'UNTRUSTED',
      reason: 'RAW_AUDIO_REQUIRES_LOCAL_TRANSCRIPTION',
    });
    expect(built.image).toBeNull();
    await expect(
      adaptiveApi(fixture.service).attachCheckpointImage(built, taskId, planId, stepId),
    ).resolves.toBe(built);
    expect(fixture.artifacts.readSettledImageForAdaptiveReasoning).not.toHaveBeenCalled();
    expect(payloadText).not.toContain('contentBase64');
    expect(payloadText).not.toContain('UklGR');
  });

  it('does not promote a media reference whose host provenance is inconsistent', async () => {
    const observation = screenObservation(64);
    const detail = observation.observation as Record<string, unknown>;
    (detail.provenance as Record<string, unknown>).capability = 'camera.photo.capture';
    const fixture = adaptiveFixture(observation);

    const built = await adaptiveApi(fixture.service).buildModelInput(taskId, planId, stepId);

    expect(built.image).toBeNull();
    const payload = JSON.parse(built.request.messages[0].content as string);
    expect(payload.mediaAttachment).toBeNull();
    expect(fixture.artifacts.readSettledImageForAdaptiveReasoning).not.toHaveBeenCalled();
  });

  it.each([
    ['text/plain' as const, '.txt' as const, Buffer.from('password=known-file-secret', 'utf8')],
    [
      'application/pdf' as const,
      '.pdf' as const,
      Buffer.from('%PDF-1.7\n(password=known-file-secret)\n%%EOF\n', 'ascii'),
    ],
  ])(
    'refuses legacy %s adaptive file attachment without reopening or model persistence',
    async (mimeType, extension, content) => {
      const fixture = adaptiveFixture(
        fileObservation(content.length, mimeType, extension),
        {
          id: artifactId,
          taskId,
          kind: MsaidiziArtifactKind.FILE,
          name: `host-file-observation-${stepId}${extension}`,
          mimeType,
          byteSize: BigInt(content.length),
          sha256,
          dataClass: 'host-file',
          trustLevel: 'UNTRUSTED',
          storedTrustLevel: MsaidiziTrustLevel.UNTRUSTED,
          provenance: { sourceType: 'HOST_RESULT' },
          content,
        },
        {
          capability: 'filesystem.file.read',
          dataClass: 'host-file',
          arguments: {
            rootId: 'managed',
            relativePath: `credential${extension}`,
            maxBytes: 524_288,
          },
        },
      );

      const built = await adaptiveApi(fixture.service).buildModelInput(taskId, planId, stepId);
      const serializedModelInput = JSON.stringify(built.request);
      expect(serializedModelInput).not.toContain('known-file-secret');
      expect(serializedModelInput).not.toContain(
        Buffer.from('password=known-file-secret', 'utf8').toString('base64'),
      );

      await expect(
        adaptiveApi(fixture.service).attachCheckpointFile(built, taskId, planId, stepId),
      ).rejects.toThrow(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
      expect(fixture.artifacts.readSettledFileForAdaptiveReasoning).not.toHaveBeenCalled();
      content.fill(0);
    },
  );
});

describe('adaptive image artifact authorization', () => {
  it('binds the read to the active task, plan, succeeded step/attempt, image metadata and budgets', async () => {
    const binding = imageBinding();
    const row = artifactRow(binding);
    const prisma = {
      msaidiziArtifact: { findFirst: jest.fn().mockResolvedValue(row) },
      msaidiziTask: { updateMany: jest.fn() },
    };
    const service = new MsaidiziArtifactsService(
      prisma as never,
      new ConfigService({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
      {} as never,
      {} as never,
    );
    const loaded: ReasoningArtifactContent = {
      id: artifactId,
      taskId,
      kind: MsaidiziArtifactKind.SCREENSHOT,
      name: 'screen.png',
      mimeType: 'image/png',
      byteSize: 64n,
      sha256,
      dataClass: 'screen-content',
      trustLevel: 'UNTRUSTED',
      storedTrustLevel: MsaidiziTrustLevel.UNTRUSTED,
      provenance: row.provenance,
      content: Buffer.alloc(64, 1),
    };
    const reserve = jest.fn().mockResolvedValue([loaded]);
    artifactApi(service).reserveAndLoadReasoningArtifacts = reserve;

    await expect(service.readSettledImageForAdaptiveReasoning(binding)).resolves.toBe(loaded);

    expect(prisma.msaidiziArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: artifactId,
          taskId,
          stepId,
          kind: MsaidiziArtifactKind.SCREENSHOT,
          mimeType: 'image/png',
          sha256,
          byteSize: 64n,
          encrypted: true,
          dataClass: 'screen-content',
          trustLevel: MsaidiziTrustLevel.UNTRUSTED,
          task: expect.objectContaining({
            mode: MsaidiziTaskMode.AUTOPILOT,
            status: MsaidiziTaskStatus.RUNNING,
            activePlanVersion: 1,
            hostExecutionAllowed: true,
          }),
          step: {
            is: expect.objectContaining({
              id: stepId,
              planVersionId: planId,
              status: MsaidiziTaskStepStatus.SUCCEEDED,
              toolAttempts: {
                some: expect.objectContaining({
                  id: attemptId,
                  status: 'SUCCEEDED',
                }),
              },
            }),
          },
        }),
      }),
    );
    expect(reserve).toHaveBeenCalledWith(
      [row],
      expect.objectContaining({
        mode: MsaidiziTaskMode.AUTOPILOT,
        status: MsaidiziTaskStatus.RUNNING,
        activePlanVersion: 1,
        hostExecutionAllowed: true,
      }),
    );
    loaded.content.fill(0);
  });

  it('refuses a row whose encrypted provenance is not bound to the settled attempt', async () => {
    const binding = imageBinding();
    const row = artifactRow(binding);
    (row.provenance as Record<string, unknown>).attemptId = '66666666-6666-4666-8666-666666666666';
    const prisma = {
      msaidiziArtifact: { findFirst: jest.fn().mockResolvedValue(row) },
      msaidiziTask: { updateMany: jest.fn() },
    };
    const service = new MsaidiziArtifactsService(
      prisma as never,
      new ConfigService({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
      {} as never,
      {} as never,
    );
    const reserve = jest.fn();
    artifactApi(service).reserveAndLoadReasoningArtifacts = reserve;

    await expect(service.readSettledImageForAdaptiveReasoning(binding)).rejects.toThrow(
      'Adaptive image provenance does not match its host attempt',
    );
    expect(reserve).not.toHaveBeenCalled();
  });
});

function adaptiveFixture(
  resultSummary: Record<string, unknown>,
  returnedArtifact?: ReasoningArtifactContent,
  stepOverrides: Record<string, unknown> = {},
) {
  const step = {
    id: stepId,
    taskId,
    planVersionId: planId,
    stepKey: 'capture-screen',
    sequence: 1,
    status: MsaidiziTaskStepStatus.SUCCEEDED,
    target: MsaidiziExecutionTarget.HOST,
    capability: 'screen.primary.capture',
    capabilityVersion: '1',
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'screen-content',
    mutation: false,
    dependencies: [],
    stopConditions: {},
    arguments: {},
    ...stepOverrides,
  };
  const task = {
    id: taskId,
    objective: 'Inspect the screen and continue only within the reviewed plan.',
    mode: MsaidiziTaskMode.AUTOPILOT,
  };
  const plan = { id: planId, taskId, version: 1, stopConditions: {}, steps: [step] };
  const attempt = {
    id: attemptId,
    status: 'SUCCEEDED',
    resultSummary,
    errorCode: null,
    uncertainOutcome: false,
    argsDigest: 'b'.repeat(64),
  };
  const prisma = {
    msaidiziTask: { findUnique: jest.fn().mockResolvedValue(task) },
    msaidiziPlanVersion: { findUnique: jest.fn().mockResolvedValue(plan) },
    msaidiziToolAttempt: { findFirst: jest.fn().mockResolvedValue(attempt) },
    msaidiziReasoningTurn: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const artifacts = {
    readSettledImageForAdaptiveReasoning: jest
      .fn()
      .mockResolvedValue(returnedArtifact ?? ({} as ReasoningArtifactContent)),
    readSettledFileForAdaptiveReasoning: jest
      .fn()
      .mockResolvedValue(returnedArtifact ?? ({} as ReasoningArtifactContent)),
  };
  const service = new MsaidiziAdaptiveReasoningService(
    prisma as never,
    new JobHandlerRegistry(),
    { adaptiveReasoningMaxOutputTokens: 2_048 } as never,
    new ConfigService(),
    { createMessage: jest.fn() } as unknown as ModelClient,
    {} as never,
    {} as never,
    undefined,
    artifacts as never,
  );
  return { service, artifacts };
}

function screenObservation(byteSize: number): Record<string, unknown> {
  return {
    outcome: 'SUCCEEDED',
    observation: {
      available: false,
      reason: 'ARTIFACT_STORED',
      trustLevel: 'UNTRUSTED',
      sourceType: 'HOST_RESULT',
      artifactId,
      artifactSha256: sha256,
      artifactBytes: byteSize,
      artifactMimeType: 'image/png',
      artifactKind: 'SCREENSHOT',
      provenance: {
        sourceType: 'HOST_RESULT',
        capability: 'screen.primary.capture',
        mediaType: 'image/png',
        contentSha256: sha256,
      },
    },
  };
}

function audioObservation(): Record<string, unknown> {
  return {
    outcome: 'SUCCEEDED',
    observation: {
      available: false,
      reason: 'ARTIFACT_STORED',
      trustLevel: 'UNTRUSTED',
      sourceType: 'HOST_RESULT',
      artifactId,
      artifactSha256: sha256,
      artifactBytes: 128,
      artifactMimeType: 'audio/wav',
      artifactKind: 'AUDIO',
      provenance: {
        sourceType: 'HOST_RESULT',
        capability: 'audio.microphone.capture',
        mediaType: 'audio/wav',
        contentSha256: sha256,
      },
    },
  };
}

function fileObservation(
  byteSize: number,
  mimeType: 'application/pdf' | 'text/plain',
  extension: '.pdf' | '.txt',
): Record<string, unknown> {
  return {
    outcome: 'SUCCEEDED',
    observation: {
      available: false,
      reason: 'ARTIFACT_STORED',
      trustLevel: 'UNTRUSTED',
      sourceType: 'HOST_RESULT',
      artifactId,
      artifactSha256: sha256,
      artifactBytes: byteSize,
      artifactMimeType: mimeType,
      artifactKind: 'FILE',
      provenance: {
        sourceType: 'HOST_RESULT',
        capability: 'filesystem.file.read',
        mediaType: mimeType,
        contentSha256: sha256,
        extension,
        argumentsSha256: 'b'.repeat(64),
        sourceIdentifierSha256: 'c'.repeat(64),
      },
    },
  };
}

function imageBinding(): AdaptiveReasoningImageBinding {
  return {
    taskId,
    planVersionId: planId,
    planVersion: 1,
    stepId,
    attemptId,
    artifactId,
    capability: 'screen.primary.capture',
    mimeType: 'image/png',
    sha256,
    byteSize: 64,
    dataClass: 'screen-content',
  };
}

function artifactRow(binding: AdaptiveReasoningImageBinding) {
  return {
    id: binding.artifactId,
    taskId: binding.taskId,
    stepId: binding.stepId,
    kind: MsaidiziArtifactKind.SCREENSHOT,
    name: 'screen.png',
    mimeType: binding.mimeType,
    storageKey: `${binding.artifactId}.msa`,
    sha256: binding.sha256,
    byteSize: BigInt(binding.byteSize),
    encrypted: true,
    dataClass: binding.dataClass,
    trustLevel: MsaidiziTrustLevel.UNTRUSTED,
    provenance: {
      uploadSource: 'tool-observation',
      attemptId: binding.attemptId,
      sourceType: 'HOST_RESULT',
      persistedSha256: binding.sha256,
      persistedBytes: binding.byteSize,
      redactionsApplied: false,
      capability: binding.capability,
      mimeType: binding.mimeType,
      trustLevel: 'UNTRUSTED',
    },
    task: {
      initiatedByUserId: 'user-1',
      bytesRead: 0n,
      bytesWritten: 0n,
      externalEgressBytes: 0n,
      reservedExternalEgressBytes: 0n,
      maxLocalBytes: 1_000_000n,
      maxExternalEgressBytes: 1_000_000n,
    },
  };
}

function adaptiveApi(service: MsaidiziAdaptiveReasoningService) {
  return service as unknown as {
    buildModelInput: (
      taskId: string,
      planVersionId: string,
      checkpointStepId: string,
    ) => Promise<TestRuntimeInput>;
    attachCheckpointImage: (
      input: TestRuntimeInput,
      taskId: string,
      planVersionId: string,
      checkpointStepId: string,
    ) => Promise<TestRuntimeInput>;
    attachCheckpointFile: (
      input: TestRuntimeInput,
      taskId: string,
      planVersionId: string,
      checkpointStepId: string,
    ) => Promise<TestRuntimeInput>;
  };
}

function artifactApi(service: MsaidiziArtifactsService) {
  return service as unknown as {
    reserveAndLoadReasoningArtifacts: jest.Mock;
  };
}

interface TestRuntimeInput {
  request: ModelRequest;
  digest: string;
  byteSize: number;
  image: {
    artifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: 'image/png' | 'image/jpeg';
    capability: 'screen.primary.capture' | 'camera.photo.capture';
    trustLevel: 'UNTRUSTED';
  } | null;
  file: {
    artifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: 'application/pdf' | 'text/plain';
    extension: '.pdf' | '.txt';
    capability: 'filesystem.file.read';
    argsDigest: string;
    sourceIdentifierHash: string;
    trustLevel: 'UNTRUSTED';
  } | null;
}
