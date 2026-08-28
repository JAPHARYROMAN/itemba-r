import { PerformanceTraceStatus, PerformanceTraceType } from '@prisma/client';
import { MsaidiziObservabilityService } from './msaidizi-observability.service';

describe('MsaidiziObservabilityService', () => {
  const create = jest.fn();
  const prisma = { performanceTrace: { create } } as any;
  let service: MsaidiziObservabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 'trace-1' });
    service = new MsaidiziObservabilityService(prisma);
  });

  it('persists a correlated, bounded task runtime span without payload content', async () => {
    const span = service.startSpan({
      operation: 'msaidizi.step.execute',
      taskId: 'task-1',
      planVersion: 2,
      stepId: 'step-1',
      jobId: 'job-1',
    });

    await expect(
      service.finishSpan(span, {
        outcome: 'SUCCESS',
        outcomeCode: 'STEP_SUCCEEDED',
        measurements: { responseBytes: 42, mutation: false, externalEgressBytes: 7n },
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traceNumber: expect.stringMatching(/^MSAIDIZI-/),
        traceType: PerformanceTraceType.BACKGROUND_JOB,
        operationName: 'msaidizi.step.execute',
        durationMs: expect.any(Number),
        status: PerformanceTraceStatus.SUCCESS,
        metadata: expect.objectContaining({
          schema: 'msaidizi-runtime-trace/v1',
          traceId: expect.stringMatching(/^[a-f0-9]{32}$/),
          spanId: expect.stringMatching(/^[a-f0-9]{16}$/),
          taskId: 'task-1',
          planVersion: 2,
          stepId: 'step-1',
          jobId: 'job-1',
          outcomeCode: 'STEP_SUCCEEDED',
          measurements: {
            responseBytes: 42,
            mutation: false,
            externalEgressBytes: '7',
          },
        }),
      }),
    });
  });

  it('uses one stable trace id for separate spans of the same durable task', () => {
    const first = service.startSpan({ operation: 'msaidizi.step.execute', taskId: 'task-1' });
    const second = service.startSpan({ operation: 'msaidizi.task.dispatch', taskId: 'task-1' });

    expect(first.traceId).toBe(second.traceId);
    expect(first.spanId).not.toBe(second.spanId);
  });

  it('rejects arbitrary metadata channels before persistence', async () => {
    expect(() => service.startSpan({ operation: 'tool.execute', taskId: 'task-1' })).toThrow(
      'operation is invalid',
    );

    const span = service.startSpan({ operation: 'msaidizi.step.execute', taskId: 'task-1' });
    await expect(
      service.finishSpan(span, {
        outcome: 'FAILED',
        outcomeCode: 'contains a prompt or error message',
      }),
    ).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('fails open when telemetry persistence is unavailable', async () => {
    create.mockRejectedValueOnce(new Error('database unavailable with sensitive detail'));
    const span = service.startSpan({ operation: 'msaidizi.dispatch.tick' });

    await expect(
      service.finishSpan(span, {
        outcome: 'WARNING',
        outcomeCode: 'KILL_SWITCH_ACTIVE',
        measurements: { started: 0, processed: 0, enqueued: 0 },
      }),
    ).resolves.toBe(false);
  });
});
