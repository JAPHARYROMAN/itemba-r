import { BadRequestException, Injectable } from '@nestjs/common';
import { BackgroundJobStatus, PerformanceTraceType } from '@prisma/client';

type TraceLike = {
  traceType: PerformanceTraceType;
  durationMs: number;
  status?: string;
  path?: string | null;
  operationName?: string | null;
};

export type TraceBudgetEvaluation = {
  traceType: PerformanceTraceType;
  durationMs: number;
  budgetMs: number;
  withinBudget: boolean;
  severity: 'OK' | 'WARNING' | 'CRITICAL';
  action: string;
};

const BUDGETS_MS: Record<PerformanceTraceType, number> = {
  API_REQUEST: 1000,
  DB_QUERY: 500,
  REPORT_RUN: 10000,
  BACKGROUND_JOB: 30000,
  PAGE_LOAD: 2500,
  EXPORT: 15000,
  SYNC_OPERATION: 20000,
  CUSTOM: 2000,
};

@Injectable()
export class ObservabilityBudgetService {
  evaluateTrace(trace: TraceLike): TraceBudgetEvaluation {
    const budgetMs = BUDGETS_MS[trace.traceType] ?? BUDGETS_MS.CUSTOM;
    const ratio = budgetMs > 0 ? trace.durationMs / budgetMs : 0;
    const severity = ratio >= 2 ? 'CRITICAL' : ratio > 1 ? 'WARNING' : 'OK';

    return {
      traceType: trace.traceType,
      durationMs: trace.durationMs,
      budgetMs,
      withinBudget: severity === 'OK',
      severity,
      action: this.recommendAction(trace, severity),
    };
  }

  summarizeTraces(traces: TraceLike[]) {
    const evaluations = traces.map((trace) => this.evaluateTrace(trace));
    const breached = evaluations.filter((item) => !item.withinBudget);
    return {
      totalEvaluated: evaluations.length,
      breachedCount: breached.length,
      criticalCount: breached.filter((item) => item.severity === 'CRITICAL').length,
      warningCount: breached.filter((item) => item.severity === 'WARNING').length,
      breachRate: evaluations.length ? breached.length / evaluations.length : 0,
      breached,
    };
  }

  assertRetryAllowed(job: { status: BackgroundJobStatus; attempts: number; maxAttempts: number }) {
    const retryableStatuses: BackgroundJobStatus[] = [
      BackgroundJobStatus.FAILED,
      BackgroundJobStatus.DEAD_LETTER,
    ];
    if (!retryableStatuses.includes(job.status)) {
      throw new BadRequestException('Only failed or dead-letter jobs can be retried');
    }
    if (job.status !== BackgroundJobStatus.DEAD_LETTER && job.attempts >= job.maxAttempts) {
      throw new BadRequestException('Max attempts reached');
    }
  }

  assertCancelAllowed(job: { status: BackgroundJobStatus }) {
    const cancellableStatuses: BackgroundJobStatus[] = [
      BackgroundJobStatus.QUEUED,
      BackgroundJobStatus.RUNNING,
      BackgroundJobStatus.RETRYING,
    ];
    if (!cancellableStatuses.includes(job.status)) {
      throw new BadRequestException('Only queued, running, or retrying jobs can be cancelled');
    }
  }

  private recommendAction(trace: TraceLike, severity: TraceBudgetEvaluation['severity']): string {
    if (severity === 'OK') return 'No action required';
    if (trace.traceType === PerformanceTraceType.DB_QUERY) {
      return 'Inspect query plan, indexes, and company/date filters';
    }
    if (trace.traceType === PerformanceTraceType.REPORT_RUN) {
      return 'Review report filters, row counts, cache eligibility, and async execution';
    }
    if (trace.traceType === PerformanceTraceType.BACKGROUND_JOB) {
      return 'Review queue concurrency, retry policy, payload size, and downstream dependency latency';
    }
    if (trace.traceType === PerformanceTraceType.API_REQUEST) {
      return 'Inspect controller/service timing and related database traces';
    }
    return 'Review trace metadata and upstream/downstream timings';
  }
}
