import { ConfigService } from '@nestjs/config';
import { AutonomyConfig } from './autonomy.config';

function configWith(values: Record<string, string>) {
  return new AutonomyConfig({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as ConfigService);
}

describe('AutonomyConfig', () => {
  it('keeps autonomy, Autopilot, and host execution independently off by default', () => {
    const config = configWith({});
    expect(config.enabled).toBe(false);
    expect(config.autopilotEnabled).toBe(false);
    expect(config.hostExecutionEnabled).toBe(false);
    expect(config.globalKillSwitchActive).toBe(false);
  });

  it('exposes the deployment-owned global kill switch as a live fail-closed control', () => {
    expect(configWith({ MSAIDIZI_GLOBAL_KILL_SWITCH: 'true' }).globalKillSwitchActive).toBe(true);
  });

  it('uses the persisted hard ceilings from the rollout plan', () => {
    expect(configWith({}).budgetCeilings).toEqual({
      maxWallTimeSeconds: 7_200,
      maxModelTurns: 200,
      maxAttemptedToolCalls: 500,
      maxMutations: 100,
      maxLocalBytes: 5_368_709_120n,
      maxExternalEgressBytes: 262_144_000n,
      maxModelCostUsd: 20,
    });
  });

  it('accepts deployment-owned overrides and fails invalid values back to defaults', () => {
    expect(
      configWith({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_HOST_EXECUTION_ENABLED: 'true',
        MSAIDIZI_AUTONOMY_MAX_MODEL_TURNS: '25',
        MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES: 'bad',
      }),
    ).toMatchObject({ enabled: true, hostExecutionEnabled: true });
    expect(
      configWith({ MSAIDIZI_AUTONOMY_MAX_MODEL_TURNS: '25' }).budgetCeilings.maxModelTurns,
    ).toBe(25);
    expect(
      configWith({ MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES: 'bad' }).budgetCeilings.maxLocalBytes,
    ).toBe(5_368_709_120n);
  });

  it('preserves explicit zero deny-ceilings for mutation, egress, and model spend', () => {
    expect(
      configWith({
        MSAIDIZI_AUTONOMY_MAX_MUTATIONS: '0',
        MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES: '0',
        MSAIDIZI_AUTONOMY_MAX_MODEL_COST_USD: '0',
      }).budgetCeilings,
    ).toMatchObject({
      maxMutations: 0,
      maxExternalEgressBytes: 0n,
      maxModelCostUsd: 0,
    });
  });

  it('keeps pre-task proposal spend inside a separate deployment-owned rolling quota', () => {
    const defaults = configWith({});
    expect(defaults.proposalMaxInputTokensPerTurn).toBe(200_000);
    expect(defaults.proposalQuotaWindowSeconds).toBe(3_600);
    expect(defaults.proposalMaxModelTurnsPerWindow).toBe(200);
    expect(defaults.proposalMaxCostUsdPerWindow).toBe(20);
    expect(defaults.proposalReceiptTtlSeconds).toBe(86_400);
    expect(defaults.proposalReservationTimeoutSeconds).toBe(300);

    const denied = configWith({
      MSAIDIZI_PROPOSAL_MAX_MODEL_TURNS_PER_WINDOW: '0',
      MSAIDIZI_PROPOSAL_MAX_COST_USD_PER_WINDOW: '0',
    });
    expect(denied.proposalMaxModelTurnsPerWindow).toBe(0);
    expect(denied.proposalMaxCostUsdPerWindow).toBe(0);
  });

  it('uses the highest deployment-owned input or cache rate for conservative accounting', () => {
    const defaults = configWith({});
    expect(defaults.adaptiveReasoningConservativeInputUsdPerMillionTokens).toBe(37.5);
    expect(
      configWith({
        MSAIDIZI_MODEL_INPUT_USD_PER_MILLION_TOKENS: '10',
        MSAIDIZI_MODEL_CACHE_READ_USD_PER_MILLION_TOKENS: '4',
        MSAIDIZI_MODEL_CACHE_CREATION_USD_PER_MILLION_TOKENS: '25',
      }).adaptiveReasoningConservativeInputUsdPerMillionTokens,
    ).toBe(25);
  });
});
