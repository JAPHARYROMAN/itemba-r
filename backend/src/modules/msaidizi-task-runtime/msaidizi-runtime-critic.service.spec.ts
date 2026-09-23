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
          query: ['customerId', 'limit'],
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

  const binding = {
    targetPath: '/query/customerId',
    source: { kind: 'PLAN_INPUT', path: '/customerId' },
    dataClass: 'internal',
    expectedType: 'string',
    expectedSchema: { type: 'string' },
    transform: { name: 'IDENTITY', version: '1' },
  };
  it('fills an unbound read field while preserving an executor-managed placeholder', () => {
    const lookup = readStep('lookup', 1);
    lookup.arguments = { path: {}, query: { customerId: null } };
    lookup.inputBindings = [binding];
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: ['fallback'],
        readArgumentFills: [{ stepKey: 'lookup', values: { query: { limit: '10' } } }],
      }),
      [lookup, readStep('fallback', 2)],
      mandate(['CustomersController.findAll']),
      new Date(),
      { customerId: 'reviewed-customer' },
    );
    expect(review).toMatchObject({
      acceptable: true,
      issues: [],
      replannedSteps: [
        {
          arguments: { path: {}, query: { customerId: null, limit: '10' } },
          inputBindings: [binding],
        },
      ],
    });
    expect(lookup.arguments).toEqual({ path: {}, query: { customerId: null } });
  });
  it.each([{ query: { limit: 10 } }, { query: { undeclared: '10' } }, { body: { extra: true } }])(
    'still rejects incompatible unbound fills beside a valid binding: %j',
    (values) => {
      const lookup = readStep('lookup', 1);
      lookup.arguments = { path: {}, query: { customerId: null } };
      lookup.inputBindings = [binding];
      const review = critic.review(
        replan({
          orderedPendingStepKeys: ['lookup'],
          skippedPendingStepKeys: [],
          readArgumentFills: [{ stepKey: 'lookup', values }],
        }),
        [lookup],
        mandate(['CustomersController.findAll']),
        new Date(),
        { customerId: 'reviewed-customer' },
      );
      expect(review.acceptable).toBe(false);
      expect(review.issues).toContainEqual({
        code: 'REPLAN_FILL_SCHEMA_MISMATCH',
        stepKey: 'lookup',
      });
      expect(lookup.arguments).toEqual({ path: {}, query: { customerId: null } });
    },
  );
  it.each([false, true])(
    'preserves reviewed input bindings and refuses to fill their target (fill=%s)',
    (fill) => {
      const lookup = readStep('lookup', 1);
      lookup.arguments = { path: {}, query: { customerId: null } };
      lookup.inputBindings = [binding];
      const review = critic.review(
        replan({
          orderedPendingStepKeys: ['lookup'],
          skippedPendingStepKeys: ['fallback'],
          readArgumentFills: fill
            ? [{ stepKey: 'lookup', values: { query: { customerId: 'attacker-customer' } } }]
            : [],
        }),
        [lookup, readStep('fallback', 2)],
        mandate(['CustomersController.findAll']),
        new Date(),
        { customerId: 'reviewed-customer' },
      );
      expect(review.acceptable).toBe(!fill);
      expect(review.replannedSteps[0].inputBindings).toEqual([binding]);
      expect(lookup.arguments).toEqual({ path: {}, query: { customerId: null } });
      if (fill)
        expect(review.issues).toContainEqual({ code: 'INPUT_BINDING_TARGET_NOT_PLACEHOLDER' });
    },
  );

  it.each([false, true])(
    'retains pending and completed dependency binding authority (completed=%s)',
    (completed) => {
      const source = readStep('source', 1);
      if (completed) source.status = MsaidiziTaskStepStatus.SUCCEEDED;
      const lookup = readStep('lookup', 2);
      lookup.arguments = { path: {}, query: { customerId: null } };
      lookup.dependencies = ['source'];
      lookup.inputBindings = [
        {
          ...binding,
          source: { kind: 'DEPENDENCY_OUTPUT', dependencyStepKey: 'source', path: '/id' },
        },
      ];
      const review = critic.review(
        replan({
          orderedPendingStepKeys: completed ? ['lookup'] : ['source', 'lookup'],
          skippedPendingStepKeys: ['fallback'],
          readArgumentFills: [{ stepKey: 'lookup', values: { query: { limit: '10' } } }],
        }),
        [source, lookup, readStep('fallback', 3)],
        mandate(['CustomersController.findAll']),
      );
      expect(review.acceptable).toBe(true);
      expect(review.replannedSteps[completed ? 0 : 1]).toMatchObject({
        dependencies: completed ? [] : ['source'],
        inputBindings: lookup.inputBindings,
        arguments: { path: {}, query: { customerId: null, limit: '10' } },
      });
    },
  );

  it.each([
    { inputs: {}, code: 'INPUT_BINDING_SOURCE_MISSING' },
    { inputs: { customerId: 123 }, code: 'INPUT_BINDING_TYPE_MISMATCH' },
  ])('validates immutable source inputs before accepting a version: $code', ({ inputs, code }) => {
    const lookup = readStep('lookup', 1);
    lookup.arguments = { path: {}, query: { customerId: null } };
    lookup.inputBindings = [binding];
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: ['fallback'],
        readArgumentFills: [],
      }),
      [lookup, readStep('fallback', 2)],
      mandate(['CustomersController.findAll']),
      new Date(),
      inputs,
    );
    expect(review.acceptable).toBe(false);
    expect(review.issues).toContainEqual({ code });
  });

  it('rejects malformed persisted binding definitions before creating a version', () => {
    const lookup = readStep('lookup', 1);
    lookup.inputBindings = [{ ...binding, injected: true }];
    const review = critic.review(
      replan({
        orderedPendingStepKeys: ['lookup'],
        skippedPendingStepKeys: ['fallback'],
        readArgumentFills: [],
      }),
      [lookup, readStep('fallback', 2)],
      mandate(['CustomersController.findAll']),
    );
    expect(review.acceptable).toBe(false);
    expect(review.issues).toContainEqual({ code: 'INPUT_BINDING_DEFINITION_TAMPERED' });
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
