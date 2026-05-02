import { BadRequestException } from '@nestjs/common';
import { BackgroundJobStatus, PerformanceTraceType } from '@prisma/client';
import { ObservabilityBudgetService } from './observability-budget.service';

describe('ObservabilityBudgetService', () => {
  let service: ObservabilityBudgetService;

  beforeEach(() => {
    service = new ObservabilityBudgetService();
  });

  it('marks traces within their type-specific budget as OK', () => {
    const result = service.evaluateTrace({
      traceType: PerformanceTraceType.API_REQUEST,
      durationMs: 900,
    });

    expect(result).toMatchObject({
      budgetMs: 1000,
      withinBudget: true,
      severity: 'OK',
    });
  });

  it('classifies budget breaches as warning or critical', () => {
    expect(
      service.evaluateTrace({
        traceType: PerformanceTraceType.DB_QUERY,
        durationMs: 750,
      }),
    ).toMatchObject({ budgetMs: 500, severity: 'WARNING', withinBudget: false });

    expect(
      service.evaluateTrace({
        traceType: PerformanceTraceType.REPORT_RUN,
        durationMs: 25000,
      }),
    ).toMatchObject({ budgetMs: 10000, severity: 'CRITICAL', withinBudget: false });
  });

  it('summarizes trace breach counts and breach rate', () => {
    const summary = service.summarizeTraces([
      { traceType: PerformanceTraceType.API_REQUEST, durationMs: 500 },
      { traceType: PerformanceTraceType.API_REQUEST, durationMs: 1200 },
      { traceType: PerformanceTraceType.DB_QUERY, durationMs: 1100 },
    ]);

    expect(summary).toMatchObject({
      totalEvaluated: 3,
      breachedCount: 2,
      criticalCount: 1,
      warningCount: 1,
      breachRate: 2 / 3,
    });
  });

  it('allows retry only for failed or dead-letter jobs below max attempts', () => {
    expect(() =>
      service.assertRetryAllowed({
        status: BackgroundJobStatus.FAILED,
        attempts: 1,
        maxAttempts: 3,
      }),
    ).not.toThrow();

    expect(() =>
      service.assertRetryAllowed({
        status: BackgroundJobStatus.COMPLETED,
        attempts: 1,
        maxAttempts: 3,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.assertRetryAllowed({
        status: BackgroundJobStatus.FAILED,
        attempts: 3,
        maxAttempts: 3,
      }),
    ).toThrow(BadRequestException);
  });

  it('allows explicit replay of dead-letter jobs even after max attempts', () => {
    expect(() =>
      service.assertRetryAllowed({
        status: BackgroundJobStatus.DEAD_LETTER,
        attempts: 3,
        maxAttempts: 3,
      }),
    ).not.toThrow();
  });

  it('allows cancellation only before terminal job states', () => {
    expect(() => service.assertCancelAllowed({ status: BackgroundJobStatus.QUEUED })).not.toThrow();
    expect(() =>
      service.assertCancelAllowed({ status: BackgroundJobStatus.RUNNING }),
    ).not.toThrow();
    expect(() => service.assertCancelAllowed({ status: BackgroundJobStatus.COMPLETED })).toThrow(
      BadRequestException,
    );
  });
});
