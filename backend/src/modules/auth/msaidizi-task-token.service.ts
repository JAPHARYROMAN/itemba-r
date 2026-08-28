import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { exactActionEnvelopeDigest } from '../../common/utils/action-envelope';
import { JwtPayload } from './auth.service';

const DEFAULT_TASK_TOKEN_TTL_SECONDS = 120;
const MAX_TASK_TOKEN_TTL_SECONDS = 300;

export interface IssueMsaidiziTaskTokenInput {
  taskId: string;
  stepId: string;
  deviceId?: string;
  attemptId?: string;
  argsDigest?: string;
  inputProvenanceSha256?: string;
}

/** Mints an in-memory, short-lived credential for one exact planned step. */
@Injectable()
export class MsaidiziTaskTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(input: IssueMsaidiziTaskTokenInput): Promise<{
    accessToken: string;
    expiresInSeconds: number;
    argsDigest: string;
    inputProvenanceSha256?: string;
  }> {
    this.assertAutonomyEnabled();
    const task = await this.prisma.msaidiziTask.findUnique({
      where: { id: input.taskId },
      include: {
        principal: true,
        mandate: true,
        steps: { where: { id: input.stepId }, take: 1 },
      },
    });
    if (!task || task.status !== 'RUNNING') throw new ForbiddenException('Task is not running');
    if (task.principal.status !== 'ACTIVE') {
      throw new ForbiddenException('Msaidizi principal is disabled');
    }

    const step = task.steps[0];
    if (!step) throw new ForbiddenException('Step does not belong to this task');
    if (!['READY', 'LEASED', 'RUNNING'].includes(step.status)) {
      throw new ForbiddenException('Step is not dispatchable');
    }
    const plan = await this.prisma.msaidiziPlanVersion.findUnique({
      where: { id: step.planVersionId },
      select: { version: true },
    });
    if (!plan || plan.version !== task.activePlanVersion) {
      throw new ForbiddenException('Step is not in the active plan');
    }

    this.assertMandate(task.mode, task.mandate);
    if (!/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(step.capability)) {
      throw new ForbiddenException('Task capability must use Controller.handler identity');
    }
    const delegateUserId = task.initiatedByUserId;
    if (!delegateUserId) {
      throw new ForbiddenException('ERP execution requires the task initiating user record');
    }

    const attempt = await this.prisma.msaidiziToolAttempt.findFirst({
      where: {
        ...(input.attemptId ? { id: input.attemptId } : {}),
        taskId: task.id,
        stepId: step.id,
        status: 'REQUESTED',
        credentialJtiDigest: null,
      },
      orderBy: { attemptNumber: 'desc' },
      select: {
        id: true,
        argsDigest: true,
        resolvedInputProvenance: true,
        inputProvenanceSha256: true,
      },
    });
    if (!attempt) {
      throw new ForbiddenException('Step has no unbound reserved tool attempt');
    }
    let argsDigest: string;
    let inputProvenanceSha256: string | undefined;
    if (attempt.resolvedInputProvenance != null || attempt.inputProvenanceSha256 != null) {
      if (
        attempt.resolvedInputProvenance == null ||
        !attempt.inputProvenanceSha256 ||
        !/^[a-f0-9]{64}$/.test(attempt.inputProvenanceSha256) ||
        canonicalDigest(attempt.resolvedInputProvenance) !== attempt.inputProvenanceSha256
      ) {
        throw new ForbiddenException('Step resolved-input provenance is invalid');
      }
      argsDigest = attempt.argsDigest;
      inputProvenanceSha256 = attempt.inputProvenanceSha256;
    } else {
      const legacyDigest = exactActionEnvelopeDigest(step.arguments);
      if (!legacyDigest || legacyDigest !== attempt.argsDigest) {
        throw new ForbiddenException(
          'Step arguments must use the exact { path, query, body } envelope',
        );
      }
      argsDigest = legacyDigest;
    }
    if (input.argsDigest !== undefined && input.argsDigest !== argsDigest) {
      throw new ForbiddenException('Resolved step argument digest changed before token issuance');
    }
    if (
      input.inputProvenanceSha256 !== undefined &&
      input.inputProvenanceSha256 !== inputProvenanceSha256
    ) {
      throw new ForbiddenException('Resolved step provenance changed before token issuance');
    }

    const expiresInSeconds = this.tokenTtlSeconds();
    const jti = randomUUID();
    const payload: JwtPayload = {
      sub: delegateUserId,
      email: 'msaidizi@service.itemba.local',
      jti,
      tokenUse: 'msaidizi-task',
      principalId: task.principalId,
      taskId: task.id,
      planVersion: task.activePlanVersion,
      stepId: step.id,
      mandateId: task.mandateId ?? undefined,
      deviceId: input.deviceId,
      capability: step.capability,
      argsDigest,
      inputProvenanceSha256,
    };

    const accessToken = await this.jwt.signAsync(payload, { expiresIn: expiresInSeconds });
    const bound = await this.prisma.msaidiziToolAttempt.updateMany({
      where: {
        id: attempt.id,
        taskId: task.id,
        stepId: step.id,
        status: 'REQUESTED',
        credentialJtiDigest: null,
      },
      data: { credentialJtiDigest: sha256Hex(jti) },
    });
    if (bound.count !== 1) {
      throw new ForbiddenException('Step credential reservation changed before issuance');
    }

    return {
      accessToken,
      expiresInSeconds,
      argsDigest,
      ...(inputProvenanceSha256 ? { inputProvenanceSha256 } : {}),
    };
  }

  private assertAutonomyEnabled(): void {
    if (!truthy(this.config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false'))) {
      throw new ServiceUnavailableException('Msaidizi autonomy is disabled');
    }
    if (truthy(this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'))) {
      throw new ServiceUnavailableException('Msaidizi global kill switch is active');
    }
  }

  private assertMandate(
    mode: string,
    mandate: { status: string; startsAt: Date | null; expiresAt: Date | null } | null,
  ): void {
    if (mode !== 'AUTOPILOT') return;
    const now = Date.now();
    if (
      !mandate ||
      mandate.status !== 'ACTIVE' ||
      (mandate.startsAt && mandate.startsAt.getTime() > now) ||
      (mandate.expiresAt && mandate.expiresAt.getTime() <= now)
    ) {
      throw new ForbiddenException('Autopilot task has no active mandate');
    }
  }

  private tokenTtlSeconds(): number {
    const requested = Number(
      this.config.get<string>(
        'MSAIDIZI_TASK_TOKEN_TTL_SECONDS',
        String(DEFAULT_TASK_TOKEN_TTL_SECONDS),
      ),
    );
    if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TASK_TOKEN_TTL_SECONDS;
    return Math.min(MAX_TASK_TOKEN_TTL_SECONDS, Math.floor(requested));
  }
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
