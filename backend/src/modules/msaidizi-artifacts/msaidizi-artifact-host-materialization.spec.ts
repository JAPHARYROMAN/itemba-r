import { ConfigService } from '@nestjs/config';
import {
  MsaidiziArtifactKind,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HostActionArtifactMaterializationRequest,
  resolveStepInputs,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import { MsaidiziArtifactsService } from './msaidizi-artifacts.service';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';

const TASK_ID = '10000000-0000-4000-8000-000000000001';
const PLAN_ID = '10000000-0000-4000-8000-000000000002';
const TARGET_STEP_ID = '10000000-0000-4000-8000-000000000003';
const SOURCE_STEP_ID = '10000000-0000-4000-8000-000000000004';
const DEVICE_ID = '10000000-0000-4000-8000-000000000005';
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000006';
const TARGET_ATTEMPT_ID = 'target-attempt-1';
const SOURCE_ATTEMPT_ID = 'source-attempt-1';
const SOURCE_PLAN_ID = '10000000-0000-4000-8000-000000000007';

describe('Msaidizi host-action artifact materialization', () => {
  it.each(['same-plan', 'cross-plan-explicit', 'cross-plan-single'])(
    'reauthorizes and decrypts exact artifact bytes (%s)',
    async (mode) => {
      const crossPlan = mode !== 'same-plan';
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-host-artifact-'));
      const key = randomBytes(32);
      const content = Buffer.from('reviewed attachment bytes', 'utf8');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const storageKey = `${ARTIFACT_ID}.msa`;
      await fs.writeFile(path.join(root, storageKey), encryptArtifact(content, key), {
        flag: 'wx',
      });

      const target = {
        id: TARGET_STEP_ID,
        taskId: TASK_ID,
        planVersionId: PLAN_ID,
        stepKey: 'target',
        name: 'Send reviewed artifact',
        target: 'HOST',
        capability: 'email.send',
        capabilityVersion: '1',
        expectedEffect: 'EXTERNAL',
        mutation: true,
        idempotent: false,
        arguments: { artifact: null },
        dependencies: [],
        recovery: null,
        stopConditions: {},
        status: MsaidiziTaskStepStatus.RUNNING,
        preconditions: { deviceId: DEVICE_ID },
        budgets: { maxLocalBytes: 1024 },
        bytesRead: 0n,
        bytesWritten: 0n,
        localIoAccountingValid: true,
        dataClass: 'Internal',
        inputBindings: [] as Prisma.JsonValue,
        dependencyLineage: [] as Prisma.JsonValue,
        planVersion: { version: crossPlan ? 2 : 1, inputs: {} },
        task: {
          companyId: null,
          activePlanVersion: crossPlan ? 2 : 1,
          bytesRead: 0n,
          bytesWritten: 0n,
          maxLocalBytes: 1024n,
        },
      };
      const artifact = {
        id: ARTIFACT_ID,
        taskId: TASK_ID,
        stepId: SOURCE_STEP_ID,
        storageKey,
        provenance: {
          attemptId: SOURCE_ATTEMPT_ID,
          persistedSha256: sha256,
          persistedBytes: content.length,
          redactionsApplied: false,
          trustLevel: 'UNTRUSTED',
        },
        sha256,
        byteSize: BigInt(content.length),
        mimeType: 'text/plain',
        name: 'reviewed.txt',
        kind: MsaidiziArtifactKind.FILE,
        dataClass: 'Internal',
      };
      const source = {
        id: SOURCE_STEP_ID,
        taskId: TASK_ID,
        planVersionId: crossPlan ? SOURCE_PLAN_ID : PLAN_ID,
        stepKey: 'source',
        status: 'SUCCEEDED',
        dataClass: 'Internal',
        planVersion: { id: SOURCE_PLAN_ID, taskId: TASK_ID, version: 1 },
        toolAttempts: [
          {
            id: SOURCE_ATTEMPT_ID,
            taskId: TASK_ID,
            stepId: SOURCE_STEP_ID,
            status: 'SUCCEEDED',
            uncertainOutcome: false,
            argsDigest: 'c'.repeat(64),
            resultSummary: { artifactId: ARTIFACT_ID, sha256 },
          },
        ],
        artifacts: [artifact],
      };
      if (crossPlan) {
        target.dependencyLineage = [
          {
            version: 1,
            dependencyStepKey: 'source',
            sourcePlanVersionId: SOURCE_PLAN_ID,
            sourceStepId: SOURCE_STEP_ID,
            sourceAttemptId: SOURCE_ATTEMPT_ID,
            sourceResultSha256: actionArgumentDigest(source.toolAttempts[0].resultSummary),
            sourceArgsSha256: 'c'.repeat(64),
            dataClass: 'Internal',
          },
        ];
        target.inputBindings = [
          {
            targetPath: '/artifact',
            source: {
              kind: 'DEPENDENCY_ARTIFACT',
              dependencyStepKey: 'source',
              ...(mode === 'cross-plan-explicit' ? { artifactId: ARTIFACT_ID } : {}),
              path: '',
            },
            dataClass: 'Internal',
            expectedType: 'object',
            expectedSchema: artifactBindingSchema(),
            transform: { name: 'IDENTITY', version: '1' },
          },
        ];
      }
      const taskCharge = jest.fn().mockResolvedValue({ count: 1 });
      const stepCharge = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        msaidiziTask: { updateMany: taskCharge },
        msaidiziTaskStep: { updateMany: stepCharge },
      };
      const prisma = {
        msaidiziTaskStep: {
          findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
            where.id === TARGET_STEP_ID ? target : source,
          ),
        },
        msaidiziArtifact: {
          findFirst: jest.fn(
            async ({ where }: { where: { step: { is: { planVersionId: string } } } }) =>
              where.step.is.planVersionId === source.planVersionId ? artifact : null,
          ),
        },
        msaidiziToolAttempt: { findFirst: jest.fn().mockResolvedValue({ id: TARGET_ATTEMPT_ID }) },
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      };
      const config = {
        get: jest.fn((name: string, fallback?: string) => {
          if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
          if (name === 'MSAIDIZI_ARTIFACT_ENCRYPTION_KEY') return key.toString('base64');
          if (name === 'MSAIDIZI_ARTIFACT_ROOT') return root;
          return fallback;
        }),
      };
      const service = new MsaidiziArtifactsService(
        prisma as never,
        config as unknown as ConfigService,
        {} as never,
        {} as never,
      );
      const binding: HostActionArtifactMaterializationRequest = {
        taskId: TASK_ID,
        planVersionId: PLAN_ID,
        targetStepId: TARGET_STEP_ID,
        targetAttemptId: TARGET_ATTEMPT_ID,
        deviceId: DEVICE_ID,
        sourceStepId: SOURCE_STEP_ID,
        sourceAttemptId: SOURCE_ATTEMPT_ID,
        artifactId: ARTIFACT_ID,
        sha256,
        byteSize: content.length,
        mimeType: 'text/plain',
        name: 'reviewed.txt',
        kind: 'FILE',
        dataClass: 'Internal',
      };

      try {
        await expect(service.materializeForHostAction(binding)).resolves.toEqual({
          contentBase64: content.toString('base64'),
        });
        expect(prisma.msaidiziTaskStep.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: TARGET_STEP_ID,
              taskId: TASK_ID,
              planVersionId: PLAN_ID,
              target: 'HOST',
              status: 'RUNNING',
              task: { mode: 'AUTOPILOT', status: 'RUNNING', hostExecutionAllowed: true },
            }),
          }),
        );
        expect(taskCharge).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: TASK_ID,
              status: MsaidiziTaskStatus.RUNNING,
              activePlanVersion: crossPlan ? 2 : 1,
              hostExecutionAllowed: true,
              bytesRead: 0n,
              bytesWritten: 0n,
            }),
            data: expect.objectContaining({
              bytesRead: { increment: BigInt(content.length) },
            }),
          }),
        );
        expect(stepCharge).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: TARGET_STEP_ID,
              taskId: TASK_ID,
              localIoAccountingValid: true,
              bytesRead: 0n,
              bytesWritten: 0n,
            }),
            data: expect.objectContaining({
              bytesRead: { increment: BigInt(content.length) },
              bytesWritten: { increment: 0n },
            }),
          }),
        );

        if (crossPlan) {
          const pins = target.dependencyLineage;
          target.dependencyLineage = [];
          await expect(service.materializeForHostAction(binding)).rejects.toThrow(
            'Exact dependency artifact is unavailable',
          );
          target.dependencyLineage = pins;
          const resolved = await resolveStepInputs(
            prisma as never,
            TASK_ID,
            TARGET_STEP_ID,
            TARGET_ATTEMPT_ID,
            (request) => service.materializeForHostAction(request),
          );
          expect(resolved.arguments.artifact).toMatchObject({
            taskId: TASK_ID,
            planVersionId: PLAN_ID,
            sourceStepId: SOURCE_STEP_ID,
            sourceAttemptId: SOURCE_ATTEMPT_ID,
            targetStepId: TARGET_STEP_ID,
            deviceId: DEVICE_ID,
            artifactId: ARTIFACT_ID,
            contentBase64: content.toString('base64'),
          });
          expect(resolved.provenance).toMatchObject({
            bindings: [
              {
                trustLevel: 'UNTRUSTED',
                instructionAuthority: false,
                source: {
                  sourcePlanVersionId: SOURCE_PLAN_ID,
                  planVersionId: PLAN_ID,
                  artifactId: ARTIFACT_ID,
                  artifactSha256: sha256,
                },
              },
            ],
          });
          expect(JSON.stringify(resolved.provenance)).not.toContain('contentBase64');
          expect(taskCharge).toHaveBeenCalledTimes(2);
          expect(stepCharge).toHaveBeenCalledTimes(2);
        }
        const callsBeforeMismatch = prisma.$transaction.mock.calls.length;
        expect(prisma.msaidiziArtifact.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              step: {
                is: expect.objectContaining({
                  planVersionId: crossPlan ? SOURCE_PLAN_ID : PLAN_ID,
                }),
              },
            }),
          }),
        );
        if (crossPlan) {
          if (mode === 'cross-plan-single') {
            source.artifacts.push({ ...artifact, id: '10000000-0000-4000-8000-000000000099' });
            await expect(service.materializeForHostAction(binding)).rejects.toThrow(
              'not the exact reviewed lineage binding',
            );
            source.artifacts.pop();
          }
          for (const invalid of [
            { ...binding, sourceAttemptId: 'different-attempt' },
            { ...binding, dataClass: 'Restricted' },
            { ...binding, artifactId: '10000000-0000-4000-8000-000000000099' },
          ]) {
            await expect(service.materializeForHostAction(invalid)).rejects.toThrow();
            expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);
          }
          const reviewed = target.inputBindings;
          target.inputBindings = [];
          await expect(service.materializeForHostAction(binding)).rejects.toThrow(
            'not the exact reviewed lineage binding',
          );
          target.inputBindings = reviewed;
          source.toolAttempts[0].uncertainOutcome = true;
          await expect(service.materializeForHostAction(binding)).rejects.toThrow(
            'not an exact successful attempt',
          );
          source.toolAttempts[0].uncertainOutcome = false;
          source.toolAttempts[0].resultSummary.sha256 = 'd'.repeat(64);
          await expect(service.materializeForHostAction(binding)).rejects.toThrow(
            'no longer matches its immutable pin',
          );
          source.toolAttempts[0].resultSummary.sha256 = sha256;
          expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);
        }
        await expect(
          service.materializeForHostAction({
            ...binding,
            deviceId: '20000000-0000-4000-8000-000000000002',
          }),
        ).rejects.toThrow('Host artifact device scope does not match the target step');
        expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);

        for (const capability of ['filesystem.file.read', 'filesystem.file.disclose.ephemeral']) {
          Object.assign(artifact, {
            provenance: {
              ...artifact.provenance,
              sourceType: 'HOST_RESULT',
              capability,
            },
          });
          await expect(service.materializeForHostAction(binding)).rejects.toThrow(
            'Exact dependency artifact is unavailable for this host action',
          );
          expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);
        }
      } finally {
        key.fill(0);
        content.fill(0);
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});

function encryptArtifact(content: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  try {
    return Buffer.concat([Buffer.from('MSA1', 'ascii'), iv, encrypted, cipher.getAuthTag()]);
  } finally {
    iv.fill(0);
    encrypted.fill(0);
  }
}

function artifactBindingSchema() {
  const properties = {
    schemaVersion: { type: 'integer', const: 1 },
    byteSize: { type: 'integer', minimum: 1, maximum: 131_072 },
    ...Object.fromEntries(
      [
        'taskId',
        'planVersionId',
        'targetStepId',
        'deviceId',
        'sourceStepId',
        'sourceAttemptId',
        'artifactId',
        'sha256',
        'mimeType',
        'name',
        'kind',
        'dataClass',
        'scopeSha256',
        'contentBase64',
      ].map((name) => [name, { type: 'string', minLength: 1, maxLength: 174_764 }]),
    ),
  };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
