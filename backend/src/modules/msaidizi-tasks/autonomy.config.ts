import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AutonomyBudgetCeilings {
  maxWallTimeSeconds: number;
  maxModelTurns: number;
  maxAttemptedToolCalls: number;
  maxMutations: number;
  maxLocalBytes: bigint;
  maxExternalEgressBytes: bigint;
  maxModelCostUsd: number;
}

/**
 * Deployment-owned controls for durable autonomous work.
 *
 * All execution switches fail closed. Request DTOs may ask for smaller budgets,
 * but MsaidiziTasksService clamps them to these values so a model-controlled
 * plan can never raise its own authority or spend ceiling.
 */
@Injectable()
export class AutonomyConfig {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.flag('MSAIDIZI_AUTONOMY_ENABLED');
  }

  get hostExecutionEnabled(): boolean {
    return this.flag('MSAIDIZI_HOST_EXECUTION_ENABLED');
  }

  get autopilotEnabled(): boolean {
    return this.flag('MSAIDIZI_AUTOPILOT_ENABLED');
  }

  /** Emergency deployment-owned stop. Models, mandates, and database rows cannot clear it. */
  get globalKillSwitchActive(): boolean {
    return this.flag('MSAIDIZI_GLOBAL_KILL_SWITCH');
  }

  /**
   * Enables model evaluation between durable Autopilot steps. Kept separate
   * from task execution so an existing deployment cannot acquire adaptive
   * behavior merely by upgrading the binary.
   */
  get adaptiveReasoningEnabled(): boolean {
    return this.flag('MSAIDIZI_ADAPTIVE_REASONING_ENABLED');
  }

  /** Maximum persisted-context bytes sent by one durable reasoning turn. */
  get adaptiveReasoningMaxInputBytes(): number {
    return this.positiveInt('MSAIDIZI_ADAPTIVE_REASONING_MAX_INPUT_BYTES', 65_536);
  }

  /** Provider output ceiling for one durable reasoning turn. */
  get adaptiveReasoningMaxOutputTokens(): number {
    return this.positiveInt('MSAIDIZI_ADAPTIVE_REASONING_MAX_OUTPUT_TOKENS', 2_048);
  }

  /**
   * Deployment-owned conservative prices used for the task's hard spend
   * reservation. Cache units are charged at the full input rate here.
   */
  get adaptiveReasoningInputUsdPerMillionTokens(): number {
    return this.positiveNumber('MSAIDIZI_MODEL_INPUT_USD_PER_MILLION_TOKENS', 30);
  }

  get adaptiveReasoningOutputUsdPerMillionTokens(): number {
    return this.positiveNumber('MSAIDIZI_MODEL_OUTPUT_USD_PER_MILLION_TOKENS', 150);
  }

  /** Cache reads are conservatively charged at least as high as direct input. */
  get adaptiveReasoningCacheReadUsdPerMillionTokens(): number {
    return this.positiveNumber(
      'MSAIDIZI_MODEL_CACHE_READ_USD_PER_MILLION_TOKENS',
      this.adaptiveReasoningInputUsdPerMillionTokens,
    );
  }

  /** Cache creation commonly carries a premium; the default is 1.25x input. */
  get adaptiveReasoningCacheCreationUsdPerMillionTokens(): number {
    return this.positiveNumber(
      'MSAIDIZI_MODEL_CACHE_CREATION_USD_PER_MILLION_TOKENS',
      this.adaptiveReasoningInputUsdPerMillionTokens * 1.25,
    );
  }

  /**
   * One snapshottable worst-case rate for all input/cache units. This may
   * over-account a provider bill but can never silently under-account a cache
   * premium when enforcing the hard task ceiling.
   */
  get adaptiveReasoningConservativeInputUsdPerMillionTokens(): number {
    return Math.max(
      this.adaptiveReasoningInputUsdPerMillionTokens,
      this.adaptiveReasoningCacheReadUsdPerMillionTokens,
      this.adaptiveReasoningCacheCreationUsdPerMillionTokens,
    );
  }

  /**
   * Proposal reasoning happens before a durable task exists. These deployment-
   * owned limits bound that otherwise unaccounted plane. A reservation charges
   * the full configured context/output allowance before the provider is called;
   * a successful response later settles to provider-reported token usage.
   */
  get proposalMaxInputTokensPerTurn(): number {
    return this.positiveInt('MSAIDIZI_PROPOSAL_MAX_INPUT_TOKENS_PER_TURN', 200_000);
  }

  get proposalQuotaWindowSeconds(): number {
    return this.positiveInt('MSAIDIZI_PROPOSAL_QUOTA_WINDOW_SECONDS', 3_600);
  }

  get proposalMaxModelTurnsPerWindow(): number {
    return this.nonNegativeInt('MSAIDIZI_PROPOSAL_MAX_MODEL_TURNS_PER_WINDOW', 200);
  }

  get proposalMaxCostUsdPerWindow(): number {
    return this.nonNegativeNumber('MSAIDIZI_PROPOSAL_MAX_COST_USD_PER_WINDOW', 20);
  }

  get proposalReceiptTtlSeconds(): number {
    return this.positiveInt('MSAIDIZI_PROPOSAL_RECEIPT_TTL_SECONDS', 86_400);
  }

  get proposalReservationTimeoutSeconds(): number {
    return this.positiveInt('MSAIDIZI_PROPOSAL_RESERVATION_TIMEOUT_SECONDS', 300);
  }

  get principalKey(): string {
    return this.config.get<string>('MSAIDIZI_AUTONOMY_PRINCIPAL_KEY', 'global-msaidizi');
  }

  /** Explicit permission ceiling for the global service principal. `*` is allowed only by config. */
  get principalGrants(): string[] {
    const raw = this.config.get<string>('MSAIDIZI_AUTONOMY_GRANTS', '');
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
  }

  get budgetCeilings(): AutonomyBudgetCeilings {
    return {
      maxWallTimeSeconds: this.positiveInt('MSAIDIZI_AUTONOMY_MAX_WALL_SECONDS', 7_200),
      maxModelTurns: this.positiveInt('MSAIDIZI_AUTONOMY_MAX_MODEL_TURNS', 200),
      maxAttemptedToolCalls: this.positiveInt('MSAIDIZI_AUTONOMY_MAX_TOOL_ATTEMPTS', 500),
      maxMutations: this.nonNegativeInt('MSAIDIZI_AUTONOMY_MAX_MUTATIONS', 100),
      maxLocalBytes: this.positiveBigInt('MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES', 5_368_709_120n),
      maxExternalEgressBytes: this.nonNegativeBigInt(
        'MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES',
        262_144_000n,
      ),
      maxModelCostUsd: this.nonNegativeNumber('MSAIDIZI_AUTONOMY_MAX_MODEL_COST_USD', 20),
    };
  }

  private flag(key: string): boolean {
    return this.config.get<string>(key, 'false').toLowerCase() === 'true';
  }

  private positiveInt(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private nonNegativeInt(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  private positiveNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private nonNegativeNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private positiveBigInt(key: string, fallback: bigint): bigint {
    try {
      const value = BigInt(this.config.get<string>(key, fallback.toString()));
      return value > 0n ? value : fallback;
    } catch {
      return fallback;
    }
  }

  private nonNegativeBigInt(key: string, fallback: bigint): bigint {
    try {
      const value = BigInt(this.config.get<string>(key, fallback.toString()));
      return value >= 0n ? value : fallback;
    } catch {
      return fallback;
    }
  }
}
