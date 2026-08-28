import { Injectable, Logger } from '@nestjs/common';
import { PerformanceTraceStatus, PerformanceTraceType, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;
const OPERATION_PATTERN = /^msaidizi\.[a-z0-9][a-z0-9_.-]{0,95}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const METRIC_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;

export type MsaidiziTraceOutcome = 'SUCCESS' | 'WARNING' | 'FAILED';
export type MsaidiziMetricValue = number | bigint | boolean;

export interface MsaidiziSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly operation: string;
  readonly taskId?: string;
  readonly planVersion?: number;
  readonly stepId?: string;
  readonly jobId?: string;
  readonly startedAt: Date;
  readonly startedNs: bigint;
}

export interface StartMsaidiziSpan {
  operation: string;
  taskId?: string;
  planVersion?: number;
  stepId?: string;
  jobId?: string;
}

export interface FinishMsaidiziSpan {
  outcome: MsaidiziTraceOutcome;
  outcomeCode?: string;
  measurements?: Readonly<Record<string, MsaidiziMetricValue | undefined>>;
}

/**
 * Fail-open runtime telemetry for durable Msaidizi work.
 *
 * Task counters and append-only events remain the authoritative accounting and
 * audit ledgers. This service adds correlated latency spans and bounded numeric
 * measurements to the existing PerformanceTrace store. It deliberately accepts
 * no prompts, tool arguments, model output, response bodies, error messages, or
 * arbitrary metadata, so observability cannot become a second secret store.
 */
@Injectable()
export class MsaidiziObservabilityService {
  private readonly logger = new Logger(MsaidiziObservabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  startSpan(input: StartMsaidiziSpan): MsaidiziSpan {
    if (!OPERATION_PATTERN.test(input.operation)) {
      throw new Error('Msaidizi trace operation is invalid');
    }
    const taskId = optionalId(input.taskId, 'taskId');
    const stepId = optionalId(input.stepId, 'stepId');
    const jobId = optionalId(input.jobId, 'jobId');
    if (
      input.planVersion !== undefined &&
      (!Number.isSafeInteger(input.planVersion) || input.planVersion < 1)
    ) {
      throw new Error('Msaidizi trace planVersion is invalid');
    }

    return {
      traceId: taskId ? taskTraceId(taskId) : randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      operation: input.operation,
      taskId,
      planVersion: input.planVersion,
      stepId,
      jobId,
      startedAt: new Date(),
      startedNs: process.hrtime.bigint(),
    };
  }

  /** Never throws: losing telemetry must not change task execution semantics. */
  async finishSpan(span: MsaidiziSpan, result: FinishMsaidiziSpan): Promise<boolean> {
    try {
      const outcomeCode = result.outcomeCode;
      if (outcomeCode !== undefined && !CODE_PATTERN.test(outcomeCode)) {
        throw new Error('Msaidizi trace outcomeCode is invalid');
      }
      const measurements = boundedMeasurements(result.measurements);
      const durationNs = process.hrtime.bigint() - span.startedNs;
      const durationMs = clampDuration(Number(durationNs / 1_000_000n));
      const metadata: Prisma.InputJsonObject = {
        schema: 'msaidizi-runtime-trace/v1',
        traceId: span.traceId,
        spanId: span.spanId,
        startedAt: span.startedAt.toISOString(),
        ...(span.taskId ? { taskId: span.taskId } : {}),
        ...(span.planVersion ? { planVersion: span.planVersion } : {}),
        ...(span.stepId ? { stepId: span.stepId } : {}),
        ...(span.jobId ? { jobId: span.jobId } : {}),
        ...(outcomeCode ? { outcomeCode } : {}),
        ...(Object.keys(measurements).length > 0 ? { measurements } : {}),
      };

      await this.prisma.performanceTrace.create({
        data: {
          traceNumber: `MSAIDIZI-${randomUUID()}`,
          traceType: PerformanceTraceType.BACKGROUND_JOB,
          operationName: span.operation,
          durationMs,
          status: traceStatus(result.outcome),
          metadata,
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(`Msaidizi runtime trace was not persisted: ${safeErrorClass(error)}`);
      return false;
    }
  }
}

function optionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!ID_PATTERN.test(value)) throw new Error(`Msaidizi trace ${field} is invalid`);
  return value;
}

function taskTraceId(taskId: string): string {
  return createHash('sha256')
    .update(`itemba/msaidizi/task/${taskId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function traceStatus(outcome: MsaidiziTraceOutcome): PerformanceTraceStatus {
  if (outcome === 'FAILED') return PerformanceTraceStatus.FAILED;
  if (outcome === 'WARNING') return PerformanceTraceStatus.WARNING;
  return PerformanceTraceStatus.SUCCESS;
}

function boundedMeasurements(
  measurements: FinishMsaidiziSpan['measurements'],
): Prisma.InputJsonObject {
  const result: Record<string, string | number | boolean> = {};
  if (!measurements) return result;
  const entries = Object.entries(measurements);
  if (entries.length > 32) throw new Error('Msaidizi trace has too many measurements');
  for (const [key, value] of entries) {
    if (!METRIC_PATTERN.test(key)) throw new Error('Msaidizi trace measurement name is invalid');
    if (value === undefined) continue;
    if (typeof value === 'bigint') {
      result[key] = value.toString(10);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Msaidizi trace measurement is not finite');
      result[key] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function clampDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.min(2_147_483_647, Math.trunc(durationMs));
}

function safeErrorClass(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)) return error.name;
  return 'UnknownError';
}
