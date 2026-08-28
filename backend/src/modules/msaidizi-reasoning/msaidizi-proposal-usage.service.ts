import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MsaidiziPrincipalStatus,
  MsaidiziProposalUsageStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { ModelUsage } from '../msaidizi/model-client';
import { MSAIDIZI_REASONING_LIMITS } from './msaidizi-reasoning.limits';
import {
  bindProposalRequestDigest,
  MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX,
  MsaidiziDraftProposalAuthority,
  MsaidiziDraftProposalLease,
  proposalInFlightMarker,
  proposalReceiptIdFromMarker,
  proposalRequestDigestMatchesAuthority,
} from './msaidizi-proposal-lease';

export interface ProposalUsageReservation {
  id: string;
  expiresAt: Date;
  reservationExpiresAt: Date;
  reservedModelTurns: number;
  reservedInputTokens: bigint;
  reservedOutputTokens: bigint;
  reservedCostUsd: string;
  draftLease?: MsaidiziDraftProposalLease;
}

export interface SettledProposalUsage {
  id: string;
  expiresAt: Date;
  modelTurns: number;
  inputTokens: bigint;
  outputTokens: bigint;
  estimatedCostUsd: string;
}

export interface ConsumableProposalUsage extends SettledProposalUsage {
  proposalDigest: string;
}

interface ReserveProposalUsageInput {
  userId: string;
  companyId: string | null;
  mode: MsaidiziTaskMode;
  model: string;
  requestDigest: string;
  draftAuthority?: MsaidiziDraftProposalAuthority;
}

interface SettleInput {
  modelTurns: number;
  usage: ModelUsage;
}

export type DraftProposalLeaseRecovery = 'RECOVERED' | 'LIVE' | 'BLOCKED' | 'CHANGED';

/**
 * Durable accounting boundary for model work performed before a task exists.
 *
 * A pessimistic reservation is committed before the provider call. Reservations
 * are serialized by initiating user and company so concurrent HTTP requests
 * cannot race a rolling quota. Successful proposals settle to reported usage;
 * failed or abandoned calls retain a conservative charge and can never be
 * laundered by simply declining to save the proposed task.
 */
@Injectable()
export class MsaidiziProposalUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autonomy: AutonomyConfig,
  ) {}

  async reserve(input: ReserveProposalUsageInput): Promise<ProposalUsageReservation> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.autonomy.proposalQuotaWindowSeconds * 1_000);
    const expiresAt = new Date(now.getTime() + this.autonomy.proposalReceiptTtlSeconds * 1_000);
    const reservationExpiresAt = new Date(
      now.getTime() +
        Math.min(
          this.autonomy.proposalReservationTimeoutSeconds,
          this.autonomy.proposalReceiptTtlSeconds,
        ) *
          1_000,
    );
    const reservedModelTurns = MSAIDIZI_REASONING_LIMITS.maxModelTurns;
    const reservedInputTokens =
      BigInt(reservedModelTurns) * BigInt(this.autonomy.proposalMaxInputTokensPerTurn);
    const reservedOutputTokens =
      BigInt(reservedModelTurns) * BigInt(MSAIDIZI_REASONING_LIMITS.maxOutputTokensPerTurn);
    const inputUsdPerMillionTokens =
      this.autonomy.adaptiveReasoningConservativeInputUsdPerMillionTokens;
    const outputUsdPerMillionTokens = this.autonomy.adaptiveReasoningOutputUsdPerMillionTokens;
    const reservedCostUsd = this.costUsd(
      reservedInputTokens,
      reservedOutputTokens,
      inputUsdPerMillionTokens,
      outputUsdPerMillionTokens,
    );
    const id = randomUUID();
    assertReserveAuthority(input);

    return this.prisma.$transaction(async (tx) => {
      // PostgreSQL advisory locks are transaction-scoped. The key contains no
      // user content and prevents two replicas from both observing spare quota.
      const quotaKey = `msaidizi-proposal:${input.userId}:${input.companyId ?? 'GROUP'}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${quotaKey}, 0))`;

      // A process can die after reserving and before settlement. Recover an
      // expired draft only when its exact marker, receipt and authority still
      // agree; corrupt or mismatched markers remain blocked for investigation.
      await this.recoverExpiredDraftLeasesInTransaction(tx, now, {
        userId: input.userId,
        companyId: input.companyId,
      });

      const aggregate = await tx.msaidiziProposalUsage.aggregate({
        where: {
          userId: input.userId,
          companyId: input.companyId,
          OR: [
            { status: MsaidiziProposalUsageStatus.RESERVED },
            { createdAt: { gte: windowStart } },
          ],
        },
        _sum: { accountedModelTurns: true, accountedCostUsd: true },
      });
      const usedTurns = aggregate._sum.accountedModelTurns ?? 0;
      const usedCost = Number(aggregate._sum.accountedCostUsd ?? 0);
      const reservedCost = Number(reservedCostUsd);
      if (
        usedTurns + reservedModelTurns > this.autonomy.proposalMaxModelTurnsPerWindow ||
        usedCost + reservedCost > this.autonomy.proposalMaxCostUsdPerWindow + 0.0000001
      ) {
        throw new HttpException(
          {
            code: 'MSAIDIZI_PROPOSAL_QUOTA_EXCEEDED',
            message: 'The deployment-owned proposal reasoning quota is exhausted',
            retryAfterSeconds: this.autonomy.proposalQuotaWindowSeconds,
          },
          429,
        );
      }

      let draftLease: MsaidiziDraftProposalLease | undefined;
      if (input.draftAuthority) {
        const marker = proposalInFlightMarker(id);
        const won = await tx.msaidiziTask.updateMany({
          where: unusedDraftWhere(input.draftAuthority, input.draftAuthority.stateVersion, null),
          data: { statusDetail: marker, stateVersion: { increment: 1 } },
        });
        if (won.count !== 1) {
          throw new ConflictException({
            code: 'MSAIDIZI_PROPOSAL_LEASE_UNAVAILABLE',
            message: 'The task draft changed before proposal reasoning could be reserved',
          });
        }
        draftLease = {
          authority: input.draftAuthority,
          receiptId: id,
          marker,
          leasedStateVersion: input.draftAuthority.stateVersion + 1,
        };
        await tx.msaidiziTaskEvent.create({
          data: {
            taskId: input.draftAuthority.taskId,
            type: 'task.proposal_reserved',
            actorType: 'HUMAN',
            actorId: input.userId,
            payload: {
              receiptId: id,
              previousStateVersion: input.draftAuthority.stateVersion,
              leasedStateVersion: draftLease.leasedStateVersion,
              reservationExpiresAt: reservationExpiresAt.toISOString(),
            },
          },
        });
      }

      await tx.msaidiziProposalUsage.create({
        data: {
          id,
          userId: input.userId,
          companyId: input.companyId,
          mode: input.mode,
          requestDigest: input.draftAuthority
            ? bindProposalRequestDigest(input.requestDigest, input.draftAuthority)
            : input.requestDigest,
          model: input.model,
          inputUsdPerMillionTokens: inputUsdPerMillionTokens.toFixed(6),
          outputUsdPerMillionTokens: outputUsdPerMillionTokens.toFixed(6),
          status: MsaidiziProposalUsageStatus.RESERVED,
          reservedModelTurns,
          reservedInputTokens,
          reservedOutputTokens,
          reservedCostUsd,
          accountedModelTurns: reservedModelTurns,
          accountedCostUsd: reservedCostUsd,
          reservationExpiresAt,
          expiresAt,
        },
      });

      return {
        id,
        expiresAt,
        reservationExpiresAt,
        reservedModelTurns,
        reservedInputTokens,
        reservedOutputTokens,
        reservedCostUsd,
        ...(draftLease && { draftLease }),
      };
    });
  }

  async settleSuccess(
    receiptId: string,
    proposalDigest: string,
    input: SettleInput,
    draftLease?: MsaidiziDraftProposalLease,
  ): Promise<SettledProposalUsage> {
    if (draftLease) {
      return this.settleDraftSuccess(receiptId, proposalDigest, input, draftLease);
    }
    const reserved = await this.requireReservation(receiptId);
    const actual = this.actualUsage(input, reserved);
    const now = new Date();
    const won = await this.prisma.msaidiziProposalUsage.updateMany({
      where: {
        id: receiptId,
        status: MsaidiziProposalUsageStatus.RESERVED,
        reservationExpiresAt: { gt: now },
      },
      data: {
        status: MsaidiziProposalUsageStatus.SETTLED,
        proposalDigest,
        actualModelTurns: actual.modelTurns,
        inputTokens: actual.directInputTokens,
        cacheReadInputTokens: actual.cacheReadInputTokens,
        cacheCreationInputTokens: actual.cacheCreationInputTokens,
        billedInputTokens: actual.billedInputTokens,
        outputTokens: actual.outputTokens,
        actualCostUsd: actual.costUsd,
        accountedModelTurns: actual.modelTurns,
        accountedCostUsd: actual.costUsd,
        settledAt: now,
      },
    });
    if (won.count !== 1) {
      throw new ServiceUnavailableException({
        code: 'MSAIDIZI_PROPOSAL_RESERVATION_EXPIRED',
        message: 'Proposal reasoning exceeded its deployment-owned reservation deadline',
      });
    }
    return {
      id: receiptId,
      expiresAt: reserved.expiresAt,
      modelTurns: actual.modelTurns,
      inputTokens: actual.billedInputTokens,
      outputTokens: actual.outputTokens,
      estimatedCostUsd: actual.costUsd,
    };
  }

  /** Preserve the original exception; a RESERVED row is already a safe charge if this update fails. */
  async settleFailure(
    receiptId: string,
    failureCode: string,
    input?: SettleInput,
    draftLease?: MsaidiziDraftProposalLease,
  ): Promise<void> {
    if (draftLease) {
      return this.settleDraftFailure(receiptId, failureCode, input, draftLease);
    }
    const reserved = await this.prisma.msaidiziProposalUsage.findUnique({
      where: { id: receiptId },
    });
    if (!reserved || reserved.status !== MsaidiziProposalUsageStatus.RESERVED) return;
    let actual: ReturnType<MsaidiziProposalUsageService['actualUsage']> | null = null;
    try {
      actual = input ? this.actualUsage(input, reserved) : null;
    } catch {
      // An impossible provider usage report remains conservatively reserved.
    }
    await this.prisma.msaidiziProposalUsage.updateMany({
      where: { id: receiptId, status: MsaidiziProposalUsageStatus.RESERVED },
      data: {
        status: MsaidiziProposalUsageStatus.FAILED,
        failureCode: safeFailureCode(failureCode),
        ...(actual
          ? {
              actualModelTurns: actual.modelTurns,
              inputTokens: actual.directInputTokens,
              cacheReadInputTokens: actual.cacheReadInputTokens,
              cacheCreationInputTokens: actual.cacheCreationInputTokens,
              billedInputTokens: actual.billedInputTokens,
              outputTokens: actual.outputTokens,
              actualCostUsd: actual.costUsd,
              accountedModelTurns: actual.modelTurns,
              accountedCostUsd: actual.costUsd,
            }
          : {}),
        settledAt: new Date(),
      },
    });
  }

  private async settleDraftSuccess(
    receiptId: string,
    proposalDigest: string,
    input: SettleInput,
    lease: MsaidiziDraftProposalLease,
  ): Promise<SettledProposalUsage> {
    assertDraftLease(receiptId, lease);
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziProposalUsage.findUnique({ where: { id: receiptId } });
      assertLeaseReceipt(reserved, lease);
      const now = new Date();
      if (reserved.reservationExpiresAt <= now) {
        throw new ServiceUnavailableException({
          code: 'MSAIDIZI_PROPOSAL_RESERVATION_EXPIRED',
          message: 'Proposal reasoning exceeded its deployment-owned reservation deadline',
        });
      }
      const actual = this.actualUsage(input, reserved);
      await this.releaseDraftLease(tx, lease, now, 'SETTLED');
      const won = await tx.msaidiziProposalUsage.updateMany({
        where: {
          id: receiptId,
          status: MsaidiziProposalUsageStatus.RESERVED,
          reservationExpiresAt: { gt: now },
        },
        data: {
          status: MsaidiziProposalUsageStatus.SETTLED,
          proposalDigest,
          actualModelTurns: actual.modelTurns,
          inputTokens: actual.directInputTokens,
          cacheReadInputTokens: actual.cacheReadInputTokens,
          cacheCreationInputTokens: actual.cacheCreationInputTokens,
          billedInputTokens: actual.billedInputTokens,
          outputTokens: actual.outputTokens,
          actualCostUsd: actual.costUsd,
          accountedModelTurns: actual.modelTurns,
          accountedCostUsd: actual.costUsd,
          settledAt: now,
        },
      });
      if (won.count !== 1) {
        throw new ServiceUnavailableException({
          code: 'MSAIDIZI_PROPOSAL_RESERVATION_EXPIRED',
          message: 'Proposal reasoning reservation changed before settlement',
        });
      }
      return {
        id: receiptId,
        expiresAt: reserved.expiresAt,
        modelTurns: actual.modelTurns,
        inputTokens: actual.billedInputTokens,
        outputTokens: actual.outputTokens,
        estimatedCostUsd: actual.costUsd,
      };
    });
  }

  private async settleDraftFailure(
    receiptId: string,
    failureCode: string,
    input: SettleInput | undefined,
    lease: MsaidiziDraftProposalLease,
  ): Promise<void> {
    assertDraftLease(receiptId, lease);
    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziProposalUsage.findUnique({ where: { id: receiptId } });
      assertLeaseReceipt(reserved, lease);
      let actual: ReturnType<MsaidiziProposalUsageService['actualUsage']> | null = null;
      try {
        actual = input ? this.actualUsage(input, reserved) : null;
      } catch {
        // Preserve the conservative reservation when provider usage is invalid.
      }
      const now = new Date();
      await this.releaseDraftLease(tx, lease, now, 'FAILED');
      const won = await tx.msaidiziProposalUsage.updateMany({
        where: { id: receiptId, status: MsaidiziProposalUsageStatus.RESERVED },
        data: {
          status: MsaidiziProposalUsageStatus.FAILED,
          failureCode: safeFailureCode(failureCode),
          ...(actual
            ? {
                actualModelTurns: actual.modelTurns,
                inputTokens: actual.directInputTokens,
                cacheReadInputTokens: actual.cacheReadInputTokens,
                cacheCreationInputTokens: actual.cacheCreationInputTokens,
                billedInputTokens: actual.billedInputTokens,
                outputTokens: actual.outputTokens,
                actualCostUsd: actual.costUsd,
                accountedModelTurns: actual.modelTurns,
                accountedCostUsd: actual.costUsd,
              }
            : {}),
          settledAt: now,
        },
      });
      if (won.count !== 1) {
        throw new ConflictException('Proposal usage reservation changed before failure settlement');
      }
    });
  }

  private async releaseDraftLease(
    tx: Prisma.TransactionClient,
    lease: MsaidiziDraftProposalLease,
    now: Date,
    outcome: 'SETTLED' | 'FAILED',
  ): Promise<void> {
    const won = await tx.msaidiziTask.updateMany({
      where: unusedDraftWhere(lease.authority, lease.leasedStateVersion, lease.marker),
      data: { statusDetail: null, stateVersion: { increment: 1 } },
    });
    if (won.count !== 1) {
      throw new ServiceUnavailableException({
        code: 'MSAIDIZI_PROPOSAL_LEASE_LOST',
        message: 'The proposal lease no longer matches its exact task draft',
      });
    }
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId: lease.authority.taskId,
        type: 'task.proposal_released',
        actorType: 'SYSTEM',
        actorId: null,
        payload: {
          receiptId: lease.receiptId,
          outcome,
          previousStateVersion: lease.leasedStateVersion,
          releasedStateVersion: lease.leasedStateVersion + 1,
          releasedAt: now.toISOString(),
        },
      },
    });
  }

  async recoverExpiredDraftLeases(now = new Date()): Promise<{ recovered: number }> {
    return this.prisma.$transaction((tx) => this.recoverExpiredDraftLeasesInTransaction(tx, now));
  }

  /**
   * Recover one caller-scoped draft before a manual promote/cancel decision.
   * A malformed, missing or authority-mismatched receipt never clears the
   * marker; it remains a visible fail-closed incident for reconciliation.
   */
  async recoverExpiredDraftLeaseForTask(
    input: { authority: MsaidiziDraftProposalAuthority; marker: string },
    now = new Date(),
  ): Promise<DraftProposalLeaseRecovery> {
    const { authority, marker } = input;
    const receiptId = proposalReceiptIdFromMarker(marker);
    if (!receiptId || authority.stateVersion < 0) return 'BLOCKED';

    return this.prisma.$transaction(async (tx) => {
      const exactDraft = await tx.msaidiziTask.findFirst({
        where: unusedDraftWhere(authority, authority.stateVersion + 1, marker),
        select: { id: true },
      });
      if (!exactDraft) return 'CHANGED';

      const receipt = await tx.msaidiziProposalUsage.findUnique({ where: { id: receiptId } });
      if (!receiptMatchesAuthority(receipt, authority, receiptId)) return 'BLOCKED';
      if (receipt.reservationExpiresAt > now) return 'LIVE';

      const taskWon = await tx.msaidiziTask.updateMany({
        where: unusedDraftWhere(authority, authority.stateVersion + 1, marker),
        data: { statusDetail: null, stateVersion: { increment: 1 } },
      });
      if (taskWon.count !== 1) return 'CHANGED';
      const receiptWon = await tx.msaidiziProposalUsage.updateMany({
        where: {
          id: receiptId,
          status: MsaidiziProposalUsageStatus.RESERVED,
          reservationExpiresAt: { lte: now },
        },
        data: {
          status: MsaidiziProposalUsageStatus.FAILED,
          failureCode: 'RESERVATION_EXPIRED_UNKNOWN',
          settledAt: now,
        },
      });
      if (receiptWon.count !== 1) {
        throw new ConflictException('Expired proposal receipt changed during lease recovery');
      }
      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: authority.taskId,
          type: 'task.proposal_recovered',
          actorType: 'SYSTEM',
          actorId: null,
          payload: {
            receiptId,
            previousStateVersion: authority.stateVersion + 1,
            recoveredStateVersion: authority.stateVersion + 2,
            recoveredAt: now.toISOString(),
          },
        },
      });
      return 'RECOVERED';
    });
  }

  private async recoverExpiredDraftLeasesInTransaction(
    tx: Prisma.TransactionClient,
    now: Date,
    scope?: { userId: string; companyId: string | null },
  ): Promise<{ recovered: number }> {
    const markedTasks = await tx.msaidiziTask.findMany({
      where: {
        status: MsaidiziTaskStatus.PLANNING,
        statusDetail: { startsWith: MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX },
        ...(scope && { initiatedByUserId: scope.userId, companyId: scope.companyId }),
      },
      select: {
        id: true,
        principalId: true,
        initiatedByUserId: true,
        companyId: true,
        mandateId: true,
        mode: true,
        stateVersion: true,
        statusDetail: true,
      },
    });
    const markerReceiptIds = new Set<string>();
    let recovered = 0;
    for (const task of markedTasks) {
      const receiptId = proposalReceiptIdFromMarker(task.statusDetail);
      if (!receiptId) continue;
      markerReceiptIds.add(receiptId);
      const receipt = await tx.msaidiziProposalUsage.findUnique({ where: { id: receiptId } });
      if (!task.initiatedByUserId || task.stateVersion < 1) {
        continue;
      }
      const authority: MsaidiziDraftProposalAuthority = {
        taskId: task.id,
        principalId: task.principalId,
        initiatedByUserId: task.initiatedByUserId,
        companyId: task.companyId,
        mandateId: task.mandateId,
        mode: task.mode,
        // The current version is the lease version during crash recovery.
        stateVersion: task.stateVersion - 1,
      };
      if (
        !receiptMatchesAuthority(receipt, authority, receiptId) ||
        receipt.reservationExpiresAt > now
      ) {
        continue;
      }
      const taskWon = await tx.msaidiziTask.updateMany({
        where: unusedDraftWhere(authority, task.stateVersion, task.statusDetail),
        data: { statusDetail: null, stateVersion: { increment: 1 } },
      });
      if (taskWon.count !== 1) continue;
      const receiptWon = await tx.msaidiziProposalUsage.updateMany({
        where: {
          id: receiptId,
          status: MsaidiziProposalUsageStatus.RESERVED,
          reservationExpiresAt: { lte: now },
        },
        data: {
          status: MsaidiziProposalUsageStatus.FAILED,
          failureCode: 'RESERVATION_EXPIRED_UNKNOWN',
          settledAt: now,
        },
      });
      if (receiptWon.count !== 1) {
        throw new ConflictException('Expired proposal receipt changed during lease recovery');
      }
      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: task.id,
          type: 'task.proposal_recovered',
          actorType: 'SYSTEM',
          actorId: null,
          payload: {
            receiptId,
            previousStateVersion: task.stateVersion,
            recoveredStateVersion: task.stateVersion + 1,
            recoveredAt: now.toISOString(),
          },
        },
      });
      recovered += 1;
    }

    // Legacy text-only reservations have no task marker. Preserve their
    // existing conservative expiry behavior without clearing any marked task.
    await tx.msaidiziProposalUsage.updateMany({
      where: {
        ...(scope && { userId: scope.userId, companyId: scope.companyId }),
        status: MsaidiziProposalUsageStatus.RESERVED,
        reservationExpiresAt: { lte: now },
        ...(markerReceiptIds.size > 0 && { id: { notIn: [...markerReceiptIds] } }),
      },
      data: {
        status: MsaidiziProposalUsageStatus.FAILED,
        failureCode: 'RESERVATION_EXPIRED_UNKNOWN',
        settledAt: now,
      },
    });
    return { recovered };
  }

  async inspectConsumable(input: {
    receiptId: string;
    proposalDigest: string;
    userId: string;
    companyId: string | null;
    mode: MsaidiziTaskMode;
  }): Promise<ConsumableProposalUsage> {
    const receipt = await this.prisma.msaidiziProposalUsage.findUnique({
      where: { id: input.receiptId },
    });
    if (
      !receipt ||
      receipt.userId !== input.userId ||
      receipt.companyId !== input.companyId ||
      receipt.mode !== input.mode ||
      receipt.status !== MsaidiziProposalUsageStatus.SETTLED ||
      receipt.proposalDigest !== input.proposalDigest ||
      receipt.expiresAt <= new Date()
    ) {
      throw new ConflictException({
        code: 'MSAIDIZI_PROPOSAL_RECEIPT_UNAVAILABLE',
        message: 'The proposal usage receipt is expired, mismatched, or already consumed',
      });
    }
    return {
      id: receipt.id,
      expiresAt: receipt.expiresAt,
      proposalDigest: receipt.proposalDigest,
      modelTurns: receipt.actualModelTurns,
      inputTokens: receipt.billedInputTokens,
      outputTokens: receipt.outputTokens,
      estimatedCostUsd: receipt.actualCostUsd.toFixed(6),
    };
  }

  async consume(
    tx: Prisma.TransactionClient,
    receiptId: string,
    proposalDigest: string,
  ): Promise<void> {
    const won = await tx.msaidiziProposalUsage.updateMany({
      where: {
        id: receiptId,
        status: MsaidiziProposalUsageStatus.SETTLED,
        proposalDigest,
        expiresAt: { gt: new Date() },
      },
      data: {
        status: MsaidiziProposalUsageStatus.CONSUMED,
        consumedAt: new Date(),
      },
    });
    if (won.count !== 1) {
      throw new ConflictException({
        code: 'MSAIDIZI_PROPOSAL_RECEIPT_UNAVAILABLE',
        message: 'The proposal usage receipt is expired, mismatched, or already consumed',
      });
    }
  }

  private async requireReservation(receiptId: string) {
    const receipt = await this.prisma.msaidiziProposalUsage.findUnique({
      where: { id: receiptId },
    });
    if (!receipt || receipt.status !== MsaidiziProposalUsageStatus.RESERVED) {
      throw new ConflictException('Proposal usage reservation is no longer active');
    }
    return receipt;
  }

  private actualUsage(
    input: SettleInput,
    reserved: {
      reservedModelTurns: number;
      reservedInputTokens: bigint;
      reservedOutputTokens: bigint;
      inputUsdPerMillionTokens: { toString(): string } | string | number;
      outputUsdPerMillionTokens: { toString(): string } | string | number;
    },
  ) {
    if (
      !Number.isSafeInteger(input.modelTurns) ||
      input.modelTurns < 1 ||
      input.modelTurns > reserved.reservedModelTurns
    ) {
      throw new ServiceUnavailableException('Provider model-turn usage exceeded its reservation');
    }
    const values = [
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.cacheReadInputTokens,
      input.usage.cacheCreationInputTokens,
    ];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new ServiceUnavailableException('Provider returned invalid proposal token usage');
    }
    const directInputTokens = BigInt(input.usage.inputTokens);
    const cacheReadInputTokens = BigInt(input.usage.cacheReadInputTokens);
    const cacheCreationInputTokens = BigInt(input.usage.cacheCreationInputTokens);
    const billedInputTokens = directInputTokens + cacheReadInputTokens + cacheCreationInputTokens;
    const outputTokens = BigInt(input.usage.outputTokens);
    if (
      billedInputTokens > reserved.reservedInputTokens ||
      outputTokens > reserved.reservedOutputTokens
    ) {
      throw new ServiceUnavailableException(
        'Provider token usage exceeded its proposal reservation',
      );
    }
    return {
      modelTurns: input.modelTurns,
      directInputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      billedInputTokens,
      outputTokens,
      costUsd: this.costUsd(
        billedInputTokens,
        outputTokens,
        Number(reserved.inputUsdPerMillionTokens),
        Number(reserved.outputUsdPerMillionTokens),
      ),
    };
  }

  private costUsd(
    inputTokens: bigint,
    outputTokens: bigint,
    inputUsdPerMillionTokens: number,
    outputUsdPerMillionTokens: number,
  ): string {
    const cost =
      (Number(inputTokens) * inputUsdPerMillionTokens +
        Number(outputTokens) * outputUsdPerMillionTokens) /
      1_000_000;
    if (!Number.isFinite(cost) || cost < 0) {
      throw new ServiceUnavailableException('Proposal model-price configuration is invalid');
    }
    return cost.toFixed(6);
  }
}

function assertReserveAuthority(input: ReserveProposalUsageInput): void {
  const authority = input.draftAuthority;
  if (!authority) return;
  if (
    authority.initiatedByUserId !== input.userId ||
    authority.companyId !== input.companyId ||
    authority.mode !== input.mode ||
    !Number.isSafeInteger(authority.stateVersion) ||
    authority.stateVersion < 0
  ) {
    throw new ConflictException({
      code: 'MSAIDIZI_PROPOSAL_AUTHORITY_MISMATCH',
      message: 'Proposal reservation authority does not match the resolved task draft',
    });
  }
}

function unusedDraftWhere(
  authority: MsaidiziDraftProposalAuthority,
  stateVersion: number,
  statusDetail: string | null,
): Prisma.MsaidiziTaskWhereInput {
  return {
    id: authority.taskId,
    principalId: authority.principalId,
    initiatedByUserId: authority.initiatedByUserId,
    companyId: authority.companyId,
    mandateId: authority.mandateId,
    scheduleId: null,
    mode: authority.mode,
    status: MsaidiziTaskStatus.PLANNING,
    activePlanVersion: 0,
    stateVersion,
    statusDetail,
    proposalUsageId: null,
    mutations: 0,
    attemptedToolCalls: 0,
    executedToolCalls: 0,
    modelTurns: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    modelCostUsd: 0,
    principal: { is: { status: MsaidiziPrincipalStatus.ACTIVE } },
    planVersions: { none: {} },
    steps: { none: {} },
    toolAttempts: { none: {} },
    deviceLeases: { none: {} },
    hostActions: { none: {} },
  };
}

function assertDraftLease(receiptId: string, lease: MsaidiziDraftProposalLease): void {
  if (
    lease.receiptId !== receiptId ||
    lease.marker !== proposalInFlightMarker(receiptId) ||
    lease.leasedStateVersion !== lease.authority.stateVersion + 1
  ) {
    throw new ConflictException('Proposal draft lease is invalid');
  }
}

function assertLeaseReceipt(
  receipt: {
    id: string;
    userId: string;
    companyId: string | null;
    mode: MsaidiziTaskMode;
    status: MsaidiziProposalUsageStatus;
    requestDigest: string;
    reservationExpiresAt: Date;
    expiresAt: Date;
    reservedModelTurns: number;
    reservedInputTokens: bigint;
    reservedOutputTokens: bigint;
    inputUsdPerMillionTokens: { toString(): string } | string | number;
    outputUsdPerMillionTokens: { toString(): string } | string | number;
  } | null,
  lease: MsaidiziDraftProposalLease,
): asserts receipt is NonNullable<typeof receipt> {
  if (!receiptMatchesAuthority(receipt, lease.authority, lease.receiptId)) {
    throw new ConflictException({
      code: 'MSAIDIZI_PROPOSAL_LEASE_RECEIPT_MISMATCH',
      message: 'The proposal marker and accounting receipt no longer match',
    });
  }
}

function receiptMatchesAuthority(
  receipt: {
    id: string;
    userId: string;
    companyId: string | null;
    mode: MsaidiziTaskMode;
    status: MsaidiziProposalUsageStatus;
    requestDigest: string;
  } | null,
  authority: MsaidiziDraftProposalAuthority,
  receiptId: string,
): receipt is NonNullable<typeof receipt> {
  return Boolean(
    receipt &&
    receipt.id === receiptId &&
    receipt.userId === authority.initiatedByUserId &&
    receipt.companyId === authority.companyId &&
    receipt.mode === authority.mode &&
    receipt.status === MsaidiziProposalUsageStatus.RESERVED &&
    proposalRequestDigestMatchesAuthority(receipt.requestDigest, authority),
  );
}

function safeFailureCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80);
  return normalized || 'PROPOSAL_FAILED';
}
