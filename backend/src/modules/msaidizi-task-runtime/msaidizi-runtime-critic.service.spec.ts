import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskStepStatus } from '@prisma/client';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziRuntimeCritic, RuntimeAuthorizedStep } from './msaidizi-runtime-critic.service';
import { RuntimeReasoningDecision } from './msaidizi-runtime-reasoning.protocol';

describe('MsaidiziRuntimeCritic authority lock', () => {
  let critic: MsaidiziRuntimeCritic;

  beforeEach(() => {
    const manifest = new ManifestProvider();
    manifest.setForTesting([
      {
        id: 'CustomersController.findAll',
        controller: 'CustomersController',
        handler: 'findAll',
        verb: 'GET',
        path: 'customers',
        permissions: ['customers.read'],
        anyPermissions: [],
        roles: [],
        apiScopes: [],
        guard: 'permission',
        tier: 'green',
        tierReason: 'read-verb',
        params: {
          path: [],
          query: ['customerId'],
          freeFormQuery: false,
          hasBody: false,
        },
        agentExcluded: false,
      },
      {
        id: 'PaymentsController.create',
        controller: 'PaymentsController',
        handler: 'create',
        verb: 'POST',
        path: 'payments',
        permissions: ['payments.create'],
        anyPermissions: [],
        roles: [],
        apiScopes: [],
        guard: 'permission',
        tier: 'red',
        tierReason: 'financial',
        params: { path: [], query: [], freeFormQuery: false, hasBody: true },
        agentExcluded: false,
      },
    ]);
    critic = new MsaidiziRuntimeCritic(manifest);
  });

  it('accepts only a fill-only ERP read replan over existing pending rows', () => {
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: ['fallback'],
        readArgumentFills: [{ stepKey: 'lookup', values: { query: { customerId: 'c-1' } } }],
      }),
      [readStep('lookup', 1), readStep('fallback', 2)],
      mandate(['CustomersController.findAll']),
    );

    expect(review).toMatchObject({ acceptable: true, issues: [] });
    expect(review.replannedSteps).toHaveLength(1);
    expect(review.replannedSteps[0]).toMatchObject({
      stepKey: 'lookup',
      capability: 'CustomersController.findAll',
      expectedEffect: 'READ',
      mutation: false,
      arguments: { path: {}, query: { customerId: 'c-1' } },
    });
  });

  it('rejects a prompt-injected new capability instead of turning it into a row', () => {
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup', 'send-stolen-file'],
        skippedPendingStepKeys: [],
        readArgumentFills: [],
      }),
      [readStep('lookup', 1)],
      mandate(['CustomersController.findAll']),
    );

    expect(review.acceptable).toBe(false);
    expect(review.issues).toContainEqual({ code: 'REPLAN_MUST_PARTITION_PENDING_STEPS' });
    expect(review.replannedSteps.map((step) => step.capability)).toEqual([
      'CustomersController.findAll',
    ]);
  });

  it('rejects argument changes to an existing value even on an ERP read', () => {
    const locked = readStep('lookup', 1);
    locked.arguments = { path: {}, query: { customerId: 'approved-customer' } };
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: [],
        readArgumentFills: [
          { stepKey: 'lookup', values: { query: { customerId: 'attacker-customer' } } },
        ],
      }),
      [locked],
      mandate(['CustomersController.findAll']),
    );

    expect(review.issues).toContainEqual({
      code: 'REPLAN_FILL_CHANGED_EXISTING_VALUE',
      stepKey: 'lookup',
    });
  });

  it('rejects fills for a reviewed write and never changes its arguments', () => {
    const write = writeStep('pay', 1);
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['pay'],
        skippedPendingStepKeys: [],
        readArgumentFills: [{ stepKey: 'pay', values: { body: { amount: 999 } } }],
      }),
      [write],
      mandate(['PaymentsController.create'], MsaidiziEffect.WRITE),
    );

    expect(review.issues).toContainEqual({ code: 'REPLAN_FILL_REQUIRES_ERP_READ', stepKey: 'pay' });
    expect(review.replannedSteps[0].arguments).toEqual(write.arguments);
  });

  it('requires the live mandate to retain the exact capability/effect tuple', () => {
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: ['fallback'],
        readArgumentFills: [],
      }),
      [readStep('lookup', 1), readStep('fallback', 2)],
      mandate(['PaymentsController.create'], MsaidiziEffect.WRITE),
    );

    expect(review.issues).toContainEqual({
      code: 'REPLAN_MANDATE_AUTHORITY_MISSING',
      stepKey: 'lookup',
    });
  });

  it('rejects reordering a dependent step ahead of its pending prerequisite', () => {
    const dependent = readStep('dependent', 2);
    dependent.dependencies = ['lookup'];
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['dependent', 'lookup'],
        skippedPendingStepKeys: [],
        readArgumentFills: [],
      }),
      [readStep('lookup', 1), dependent],
      mandate(['CustomersController.findAll']),
    );

    expect(review.issues).toContainEqual({
      code: 'REPLAN_DEPENDENCY_NOT_SATISFIED',
      stepKey: 'dependent',
    });
  });
});

function readStep(stepKey: string, sequence: number): RuntimeAuthorizedStep {
  return {
    id: `step-${stepKey}`,
    stepKey,
    sequence,
    name: stepKey,
    target: MsaidiziExecutionTarget.ERP,
    capability: 'CustomersController.findAll',
    capabilityVersion: '1',
    arguments: { path: {}, query: {} },
    dependencies: [],
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'internal',
    preconditions: {},
    recovery: null,
    budgets: {},
    stopConditions: { stopOnEmpty: true },
    idempotent: true,
    mutation: false,
    status: MsaidiziTaskStepStatus.PENDING,
  };
}

function writeStep(stepKey: string, sequence: number): RuntimeAuthorizedStep {
  return {
    ...readStep(stepKey, sequence),
    capability: 'PaymentsController.create',
    arguments: { path: {}, query: {}, body: { amount: 100 } },
    expectedEffect: MsaidiziEffect.WRITE,
    mutation: true,
    idempotent: false,
    recovery: { strategy: 'reverse' },
  };
}

function replan(
  replanValue: NonNullable<RuntimeReasoningDecision['replan']>,
): RuntimeReasoningDecision {
  return {
    decision: 'REPLAN',
    outcome: 'ON_TRACK',
    reasonCode: 'ADAPT_PENDING_PLAN',
    summary: 'Narrow the reviewed pending work.',
    confidence: 0.9,
    replan: replanValue,
  };
}

function mandate(capabilities: string[], effect: MsaidiziEffect = MsaidiziEffect.READ) {
  return {
    status: 'ACTIVE',
    startsAt: null,
    expiresAt: null,
    capabilities: capabilities.map((capability) => ({
      capability,
      version: '1',
      effects: [effect],
      dataClasses: ['internal'],
    })),
  };
}
