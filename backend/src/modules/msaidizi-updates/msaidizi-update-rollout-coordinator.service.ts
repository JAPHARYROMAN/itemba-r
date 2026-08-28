import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MsaidiziUpdateManifestSigner } from './msaidizi-update-manifest-signer.service';
import { AutomaticRolloutSweepResult, MsaidiziUpdatesService } from './msaidizi-updates.service';

/**
 * Deployment-owned lifecycle loop for durable update progression.
 *
 * No in-memory cursor is authoritative: each sweep reconstructs work from the
 * candidate/deployment ledger, while row locks and unique command identities
 * make multiple backend instances safe. The loop never retries a deployment;
 * it only creates the next ring after trusted completion of the current one.
 */
@Injectable()
export class MsaidiziUpdateRolloutCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MsaidiziUpdateRolloutCoordinator.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private enabled = false;

  constructor(
    private readonly updates: MsaidiziUpdatesService,
    private readonly signer: MsaidiziUpdateManifestSigner,
  ) {}

  onModuleInit(): void {
    this.enabled = this.signer.supervisorConfigured;
    if (!this.enabled) {
      this.logger.log('Trusted update rollout and recovery dispatch are disabled.');
      return;
    }
    this.schedule(0);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async drainOnce(): Promise<AutomaticRolloutSweepResult> {
    if (this.running) {
      return {
        scanned: 0,
        queued: 0,
        skippedEmpty: 0,
        pending: 0,
        disabled: false,
      };
    }
    this.running = true;
    try {
      await this.updates.advancePendingRecoveries();
      return await this.updates.advanceAutomaticRollouts();
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs = this.signer.automaticRolloutSweepSeconds * 1_000): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.drainOnce();
      if (result.queued > 0 || result.skippedEmpty > 0) {
        this.logger.log(
          `Automatic update rollout sweep advanced ${result.queued + result.skippedEmpty} candidate(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Automatic update rollout sweep failed closed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.schedule();
    }
  }
}
