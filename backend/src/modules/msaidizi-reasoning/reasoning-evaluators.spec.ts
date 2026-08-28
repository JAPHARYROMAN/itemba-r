import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskMode } from '@prisma/client';
import { DeterministicMsaidiziCritic } from './msaidizi-critic.service';
import { DeterministicMsaidiziOutcomeEvaluator } from './msaidizi-outcome-evaluator.service';
import { ProposedPlanDraft, ReasoningContext } from './msaidizi-reasoning.types';

describe('reasoning critic and outcome evaluator', () => {
  const plan: ProposedPlanDraft = {
    title: 'Update setting',
    summary: 'Update and verify one setting.',
    steps: [
      {
        key: 'update-setting',
        name: 'Update setting',
        target: MsaidiziExecutionTarget.HOST,
        capability: 'settings.update',
        capabilityVersion: '1',
        arguments: { name: 'theme', value: 'dark' },
        dependsOn: [],
        inputBindings: [],
        expectedEffect: MsaidiziEffect.WRITE,
        dataClass: 'Internal',
        preconditions: { deviceId: 'device-1' },
        recovery: { strategy: 'restore-pre-state' },
        budgets: {},
        stopConditions: { onMismatch: true },
        idempotent: true,
        mutation: true,
      },
    ],
  };

  it('critic is independently deterministic', () => {
    const result = new DeterministicMsaidiziCritic().review(plan, context());
    expect(result.acceptable).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('outcome evaluator reports risk and recovery without executing', () => {
    expect(new DeterministicMsaidiziOutcomeEvaluator().evaluateProposal(plan)).toMatchObject({
      proposedOnly: true,
      mutationCount: 1,
      highestRisk: 'WRITE',
      recoveryCoverage: 1,
    });
  });
});

function context(): ReasoningContext {
  return {
    objective: 'Update setting',
    mode: MsaidiziTaskMode.COLLABORATIVE,
    companyId: 'company-1',
    inputs: {},
    stopConditions: { onFailure: true },
    budgets: {
      maxWallTimeSeconds: 60,
      maxModelTurns: 10,
      maxAttemptedToolCalls: 10,
      maxMutations: 10,
      maxLocalBytes: 1_000,
      maxExternalEgressBytes: 1_000,
      maxModelCostUsd: 1,
    },
    budgetViolations: [],
    mandate: null,
    capabilities: [],
    memories: [],
    callerPermissions: [],
    principalPermissions: [],
    redactionsApplied: false,
  };
}
