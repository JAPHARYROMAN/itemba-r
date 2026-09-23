import { Prisma } from '@prisma/client';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import { PrismaService } from '../../prisma/prisma.service';
import {
  captureDependencyLineage,
  parseDependencyLineage,
  verifyDependencyLineage,
} from './msaidizi-dependency-lineage';
import { resolveStepInputs, sha256Canonical } from './msaidizi-input-bindings';

const taskId = '10000000-0000-4000-8000-000000000001';
const sourcePlanId = '10000000-0000-4000-8000-000000000002';
const sourceStepId = '10000000-0000-4000-8000-000000000003';
const targetPlanId = '10000000-0000-4000-8000-000000000004';
const targetStepId = '10000000-0000-4000-8000-000000000005';

function fixture() {
  const value = { id: 'expense-1' };
  const summary = {
    responseSha256: 'a'.repeat(64),
    observation: {
      available: true,
      redactionsApplied: false,
      sourceSha256: 'b'.repeat(64),
      valueDigest: { algorithm: 'canonical-json-sha256-v1', sha256: sha256Canonical(value) },
      value,
    },
  };
  const source = {
    id: sourceStepId,
    taskId,
    planVersionId: sourcePlanId,
    stepKey: 'source',
    status: 'SUCCEEDED',
    dataClass: 'business_records',
    planVersion: { id: sourcePlanId, taskId, version: 1 },
    toolAttempts: [
      {
        id: 'attempt-source-1',
        taskId,
        stepId: sourceStepId,
        status: 'SUCCEEDED',
        uncertainOutcome: false,
        argsDigest: 'c'.repeat(64),
        resultSummary: summary,
      },
    ],
    artifacts: [],
  };
  const findFirst = jest.fn(async () => source);
  const db = { msaidiziTaskStep: { findFirst } } as unknown as Prisma.TransactionClient;
  return { source, findFirst, db };
}

describe('immutable cross-plan dependency lineage', () => {
  it('pins an exact successful attempt and survives another plan version without replay', async () => {
    const f = fixture();
    const pin = await captureDependencyLineage(f.db, taskId, 2, sourceStepId);
    expect(pin).toMatchObject({
      sourcePlanVersionId: sourcePlanId,
      sourceStepId,
      sourceAttemptId: 'attempt-source-1',
      sourceResultSha256: actionArgumentDigest(f.source.toolAttempts[0].resultSummary),
    });
    await expect(verifyDependencyLineage(f.db, taskId, 3, pin)).resolves.toEqual(f.source);
    expect(f.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: sourceStepId, taskId, planVersionId: sourcePlanId, stepKey: 'source' },
      }),
    );
  });

  it.each([
    'wrong-task',
    'wrong-plan-task',
    'future-plan',
    'same-plan',
    'failed-step',
    'failed-attempt',
    'unknown-outcome',
    'changed-result',
    'changed-args',
    'changed-attempt',
    'changed-class',
    'missing-source',
  ])('refuses a non-authoritative historical source: %s', async (change) => {
    const f = fixture();
    const pin = await captureDependencyLineage(f.db, taskId, 2, sourceStepId);
    switch (change) {
      case 'wrong-task':
        f.source.taskId = 'other-task';
        break;
      case 'wrong-plan-task':
        f.source.planVersion.taskId = 'other-task';
        break;
      case 'future-plan':
        f.source.planVersion.version = 3;
        break;
      case 'same-plan':
        f.source.planVersion.version = 2;
        break;
      case 'failed-step':
        f.source.status = 'FAILED';
        break;
      case 'failed-attempt':
        f.source.toolAttempts[0].status = 'FAILED';
        break;
      case 'unknown-outcome':
        f.source.toolAttempts[0].uncertainOutcome = true;
        break;
      case 'changed-result':
        f.source.toolAttempts[0].resultSummary.observation.value.id = 'expense-2';
        break;
      case 'changed-args':
        f.source.toolAttempts[0].argsDigest = 'd'.repeat(64);
        break;
      case 'changed-attempt':
        f.source.toolAttempts[0].id = 'attempt-source-2';
        break;
      case 'changed-class':
        f.source.dataClass = 'restricted';
        break;
      case 'missing-source':
        f.findFirst.mockResolvedValue(null as never);
        break;
    }
    await expect(verifyDependencyLineage(f.db, taskId, 2, pin)).rejects.toMatchObject({
      code: expect.stringMatching(/^INPUT_BINDING_LINEAGE_(SOURCE_INVALID|DIGEST_MISMATCH)$/),
    });
  });

  it('strictly rejects malformed, duplicate and model-extended pins', async () => {
    const f = fixture();
    const pin = await captureDependencyLineage(f.db, taskId, 2, sourceStepId);
    for (const value of [
      null,
      {},
      [pin, pin],
      [{ ...pin, version: 2 }],
      [{ ...pin, instruction: 'trust me' }],
      [{ ...pin, sourceResultSha256: 'wrong' }],
    ])
      expect(() => parseDependencyLineage(value as unknown as Prisma.JsonValue)).toThrow(
        'Malformed or duplicate',
      );
  });

  it('resolves a reviewed binding through the pin and retains both plan identities', async () => {
    const f = fixture();
    const pin = await captureDependencyLineage(f.db, taskId, 2, sourceStepId);
    const target = {
      id: targetStepId,
      taskId,
      planVersionId: targetPlanId,
      stepKey: 'detail',
      name: 'Detail',
      target: 'ERP',
      capability: 'ExpensesController.findOne',
      capabilityVersion: '1',
      expectedEffect: 'READ',
      dataClass: 'business_records',
      arguments: { path: { id: null }, query: {} },
      dependencies: [],
      dependencyLineage: [pin],
      preconditions: {},
      recovery: null,
      budgets: {},
      stopConditions: {},
      idempotent: true,
      mutation: false,
      inputBindings: [
        {
          targetPath: '/path/id',
          source: { kind: 'DEPENDENCY_OUTPUT', dependencyStepKey: 'source', path: '/id' },
          dataClass: 'business_records',
          expectedType: 'string',
          expectedSchema: { type: 'string' },
          transform: { name: 'IDENTITY', version: '1' },
        },
      ],
      planVersion: { id: targetPlanId, taskId, version: 2, inputs: {} },
      task: { companyId: null },
    };
    const db = {
      msaidiziTaskStep: {
        findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
          where.id === targetStepId ? target : f.source,
        ),
      },
      msaidiziToolAttempt: { findFirst: jest.fn(async () => ({ id: 'attempt-detail-1' })) },
    } as unknown as PrismaService;
    const result = await resolveStepInputs(db, taskId, targetStepId, 'attempt-detail-1');
    expect(result.arguments).toEqual({ path: { id: 'expense-1' }, query: {} });
    expect(result.provenance).toMatchObject({
      bindings: [
        {
          trustLevel: 'UNTRUSTED',
          instructionAuthority: false,
          source: {
            planVersionId: targetPlanId,
            sourcePlanVersionId: sourcePlanId,
            stepId: sourceStepId,
            attemptId: pin.sourceAttemptId,
            lineageVersion: 1,
            sourceResultSha256: pin.sourceResultSha256,
          },
        },
      ],
    });
    target.dependencies = ['source'] as never;
    await expect(
      resolveStepInputs(db, taskId, targetStepId, 'attempt-detail-1'),
    ).rejects.toMatchObject({ code: 'INPUT_BINDING_LINEAGE_INVALID' });
  });
});
