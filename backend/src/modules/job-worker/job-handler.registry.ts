import { Injectable, Logger } from '@nestjs/common';
import { BackgroundJobType } from '@prisma/client';

export interface JobContext {
  jobId: string;
  jobType: BackgroundJobType;
  companyId: string | null;
  payload: Record<string, unknown>;
  correlationId: string | null;
  attempts: number;
  /** Aborted when the worker timeout fires or periodic/checkpoint renewal loses the lease. */
  signal?: AbortSignal;
  /**
   * Durable cancellation checkpoint. Long-running handlers call this between
   * externally visible steps; it throws once the leased row is no longer
   * RUNNING, so no later step can dispatch after cancel or stale recovery.
   */
  checkpoint?: () => Promise<void>;
}

export class JobLeaseEndedError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} no longer holds a RUNNING lease`);
    this.name = 'JobLeaseEndedError';
  }
}

export interface JobResult {
  /** Free-form data persisted to BackgroundJob.result on success. */
  data?: Record<string, unknown>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

/**
 * Registry of handlers keyed by BackgroundJobType. Modules contribute their
 * handlers at app boot; the worker polls the BackgroundJob table and dispatches
 * the row to the registered handler.
 *
 * Keeping this registry separate from the worker lets us swap the polling
 * runtime (Postgres polling now, BullMQ later) without rewriting handlers.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly logger = new Logger(JobHandlerRegistry.name);
  private readonly handlers = new Map<BackgroundJobType, JobHandler>();

  register(jobType: BackgroundJobType, handler: JobHandler): void {
    if (this.handlers.has(jobType)) {
      this.logger.warn(`JobHandler for ${jobType} replaced — second registration`);
    }
    this.handlers.set(jobType, handler);
  }

  get(jobType: BackgroundJobType): JobHandler | undefined {
    return this.handlers.get(jobType);
  }

  registeredTypes(): BackgroundJobType[] {
    return Array.from(this.handlers.keys());
  }
}
