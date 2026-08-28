import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import {
  AuditChannel,
  AuditScopeKind,
  AuditSeverity,
  MsaidiziEffect,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../auth.service';
import { PermissionCacheService, CachedAuthPayload } from '../../../common/services';
import { exactActionEnvelopeDigest } from '../../../common/utils/action-envelope';
import { MSAIDIZI_SERVICE_PRINCIPAL_TYPE } from '../../../common/context/request-context';
import { enrichRequestContext } from '../../../common/context/request-context';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';

const SCOPE_PRIORITY = ['GROUP', 'COMPANY', 'BRANCH', 'DIVISION'] as const;

function pickHighestScope(scopes: string[]): { scope: string } | null {
  for (const s of SCOPE_PRIORITY) {
    if (scopes.includes(s)) return { scope: s };
  }
  return scopes.length > 0 ? { scope: scopes[0] } : null;
}

const PERMISSION_CACHE_TTL_MS = 60_000; // 60s — short enough that revocations propagate fast

type MsaidiziTaskJwtPayload = JwtPayload &
  Required<
    Pick<
      JwtPayload,
      'principalId' | 'taskId' | 'stepId' | 'planVersion' | 'capability' | 'argsDigest' | 'jti'
    >
  >;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissionCache: PermissionCacheService,
    private readonly audit: AuditLogsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<CachedAuthPayload & { sid?: string }> {
    // Reject scoped challenge tokens (2FA challenge, forced-password-change) —
    // they only authorize their dedicated flow, never general API access. A
    // normal access token carries no `scope`.
    if (payload.scope === 'twoFactor' || payload.scope === 'passwordChange') {
      throw new UnauthorizedException('Challenge token cannot be used for API access');
    }

    if (payload.tokenUse === 'msaidizi-task') {
      return this.validateMsaidiziTask(payload);
    }

    // P1-01: When the token carries a session id, verify the bound
    // ActiveSession is still ACTIVE. Tokens minted before this field was
    // introduced may lack `sid`; for backwards compatibility we permit them
    // until the rotation window expires.
    if (payload.sid) {
      const session = await this.prisma.activeSession.findUnique({
        where: { id: payload.sid },
        select: { status: true, expiresAt: true },
      });
      if (!session || session.status !== 'ACTIVE') {
        throw new UnauthorizedException('Session is no longer active');
      }
      if (session.expiresAt && session.expiresAt < new Date()) {
        throw new UnauthorizedException('Session has expired');
      }
    }

    const cached = this.permissionCache.get(payload.sub);
    if (cached) return { ...cached, sid: payload.sid };

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
        companyAccess: {
          select: { companyId: true, accessLevel: true },
        },
        divisionAccess: {
          select: { divisionId: true, accessLevel: true },
        },
        branchAccess: {
          select: { branchId: true, accessLevel: true },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      // Do not return null silently — explicit failure is clearer for callers
      // and keeps cache state predictable when an account is disabled.
      throw new UnauthorizedException('Account is not active');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const roleScopes = Array.from(new Set(user.userRoles.map((ur) => ur.role.scope)));
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)),
      ),
    );
    const result: CachedAuthPayload = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      roleScopes,
      role: pickHighestScope(roleScopes),
      permissions,
      companyId: user.companyId,
      companyAccess: user.companyAccess,
      divisionAccess: user.divisionAccess,
      branchAccess: user.branchAccess,
    };

    this.permissionCache.set(payload.sub, result, PERMISSION_CACHE_TTL_MS);

    return { ...result, sid: payload.sid };
  }

  private async validateMsaidiziTask(
    payload: JwtPayload,
  ): Promise<CachedAuthPayload & { sid?: string }> {
    if (
      !payload.principalId ||
      !payload.taskId ||
      !payload.stepId ||
      !payload.planVersion ||
      !payload.capability ||
      !payload.argsDigest ||
      !payload.jti
    ) {
      throw new UnauthorizedException('Incomplete autonomous task credential');
    }
    const taskPayload = payload as MsaidiziTaskJwtPayload;

    enrichRequestContext({
      channel: AuditChannel.AGENT,
      agentSessionId: `task_${taskPayload.taskId.replace(/-/g, '')}`,
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: taskPayload.principalId,
      mandateId: taskPayload.mandateId,
      initiatedByUserId: taskPayload.sub,
      taskId: taskPayload.taskId,
      stepId: taskPayload.stepId,
      deviceId: taskPayload.deviceId,
    });

    // Consume before reading mutable task, grant, mandate, route, or argument
    // policy. Every first presentation is therefore one-shot even when a later
    // check rejects it; replay can neither execute nor hide as an uncounted
    // retry of the same reserved attempt.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.msaidiziToolAttempt.updateMany({
        where: {
          taskId: taskPayload.taskId,
          stepId: taskPayload.stepId,
          credentialJtiDigest: sha256Hex(taskPayload.jti),
          credentialConsumedAt: null,
          status: { in: ['REQUESTED', 'RUNNING'] },
        },
        data: { credentialConsumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        const error = new UnauthorizedException('Task token has already been consumed');
        await this.auditTaskCredentialDenial(tx, taskPayload, error.message, 'one_shot');
        return { ok: false as const, error };
      }

      try {
        const identity = await this.validateConsumedMsaidiziTask(tx, taskPayload);
        return { ok: true as const, identity };
      } catch (error) {
        const rejection = error instanceof Error ? error : new UnauthorizedException(String(error));
        await this.auditTaskCredentialDenial(tx, taskPayload, rejection.message, 'live_policy');
        return { ok: false as const, error: rejection };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.identity;
  }

  private async validateConsumedMsaidiziTask(
    client: Prisma.TransactionClient,
    payload: MsaidiziTaskJwtPayload,
  ): Promise<CachedAuthPayload & { sid?: string }> {
    if (
      !truthy(this.config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false')) ||
      truthy(this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'))
    ) {
      throw new UnauthorizedException('Autonomous task credentials are disabled');
    }

    const task = await client.msaidiziTask.findUnique({
      where: { id: payload.taskId },
      include: {
        principal: true,
        mandate: true,
        steps: { where: { id: payload.stepId }, take: 1 },
      },
    });
    const step = task?.steps[0];
    if (
      !task ||
      !step ||
      task.status !== 'RUNNING' ||
      task.principalId !== payload.principalId ||
      task.principal.status !== 'ACTIVE' ||
      task.activePlanVersion !== payload.planVersion ||
      !['LEASED', 'RUNNING'].includes(step.status) ||
      step.capability !== payload.capability
    ) {
      throw new UnauthorizedException('Autonomous task credential is no longer active');
    }

    const [plan, attempt] = await Promise.all([
      client.msaidiziPlanVersion.findUnique({
        where: { id: step.planVersionId },
        select: { version: true },
      }),
      client.msaidiziToolAttempt.findFirst({
        where: {
          taskId: payload.taskId,
          stepId: payload.stepId,
          credentialJtiDigest: sha256Hex(payload.jti),
        },
        select: {
          argsDigest: true,
          resolvedInputProvenance: true,
          inputProvenanceSha256: true,
        },
      }),
    ]);
    const legacyDigest = exactActionEnvelopeDigest(step.arguments);
    const resolvedBindingValid =
      attempt?.resolvedInputProvenance != null &&
      attempt.inputProvenanceSha256 != null &&
      payload.inputProvenanceSha256 != null &&
      /^[a-f0-9]{64}$/.test(payload.inputProvenanceSha256) &&
      attempt.inputProvenanceSha256 === payload.inputProvenanceSha256 &&
      canonicalDigest(attempt.resolvedInputProvenance) === payload.inputProvenanceSha256 &&
      attempt.argsDigest === payload.argsDigest;
    const legacyBindingValid =
      attempt?.resolvedInputProvenance == null &&
      attempt?.inputProvenanceSha256 == null &&
      payload.inputProvenanceSha256 == null &&
      legacyDigest != null &&
      legacyDigest === payload.argsDigest &&
      attempt?.argsDigest === payload.argsDigest;
    if (!plan || plan.version !== payload.planVersion || (!resolvedBindingValid && !legacyBindingValid)) {
      throw new UnauthorizedException('Autonomous task action binding changed');
    }

    const effectivePrincipalPermissions = intersectPermissionGrantSets(
      explicitPrincipalPermissions(task.principal.grants),
      this.deploymentPrincipalPermissions(),
    );
    if (effectivePrincipalPermissions.length === 0) {
      throw new UnauthorizedException('Autonomous task deployment grant is no longer active');
    }
    const effectivePrincipalGrants = {
      scope: principalGrantScope(task.principal.grants),
      permissions: effectivePrincipalPermissions,
    };

    if (task.mode === 'AUTOPILOT') {
      const now = Date.now();
      const mandate = task.mandate;
      if (
        !mandate ||
        mandate.id !== payload.mandateId ||
        mandate.status !== 'ACTIVE' ||
        (mandate.startsAt && mandate.startsAt.getTime() > now) ||
        (mandate.expiresAt && mandate.expiresAt.getTime() <= now)
      ) {
        throw new UnauthorizedException('Autonomous task mandate is no longer active');
      }
      if (!mandateAllowsStep(mandate.capabilities, step)) {
        throw new UnauthorizedException('Autonomous task step is outside the active mandate');
      }
      if (!taskBudgetsWithinMandate(task, mandate.budgets)) {
        throw new UnauthorizedException('Autonomous task budget exceeds the active mandate');
      }
    }

    const delegateUserId = task.initiatedByUserId;
    if (!delegateUserId || payload.sub !== delegateUserId) {
      throw new UnauthorizedException('Autonomous task has no valid record anchor');
    }
    if (task.mode !== 'AUTOPILOT') {
      return this.collaborativeTaskIdentity(
        client,
        payload,
        task,
        step,
        delegateUserId,
        effectivePrincipalGrants,
      );
    }

    const delegate = await client.user.findUnique({
      where: { id: delegateUserId },
      select: { id: true },
    });
    if (!delegate) throw new UnauthorizedException('Autonomous task record anchor is missing');

    const permissions = await this.principalPermissions(client, effectivePrincipalGrants);
    const companies = await client.company.findMany({ select: { id: true } });
    return {
      id: delegateUserId,
      email: payload.email,
      fullName: task.principal.displayName,
      roles: ['MSAIDIZI_SERVICE'],
      roleScopes: ['GROUP'],
      role: { scope: 'GROUP' },
      permissions,
      companyId: task.companyId,
      companyAccess: companies.map((company) => ({
        companyId: company.id,
        accessLevel: 'MANAGE',
      })),
      divisionAccess: [],
      branchAccess: [],
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: task.principalId,
      mandateId: task.mandateId ?? undefined,
      initiatedByUserId: task.initiatedByUserId ?? undefined,
      taskId: task.id,
      stepId: step.id,
      deviceId: payload.deviceId,
      planVersion: payload.planVersion,
      taskCapability: payload.capability,
      taskArgsDigest: payload.argsDigest,
      taskInputProvenanceSha256: payload.inputProvenanceSha256,
      taskCredentialJti: payload.jti,
    };
  }

  private async auditTaskCredentialDenial(
    client: Prisma.TransactionClient,
    payload: MsaidiziTaskJwtPayload,
    reason: string,
    stage: 'one_shot' | 'live_policy',
  ): Promise<void> {
    const taskScope = await client.msaidiziTask.findUnique({
      where: { id: payload.taskId },
      select: { companyId: true },
    });
    await this.audit.logStrictInTransaction(client, {
      action: 'MSAIDIZI_TASK_CREDENTIAL_DENIED',
      entityType: 'MsaidiziTaskStep',
      entityId: payload.stepId,
      userId: payload.sub,
      companyId: taskScope?.companyId,
      scopeKind: taskScope?.companyId ? AuditScopeKind.COMPANY : AuditScopeKind.GROUP,
      severity: AuditSeverity.HIGH,
      channel: AuditChannel.AGENT,
      agentSessionId: payload.taskId ? `task_${payload.taskId.replace(/-/g, '')}` : undefined,
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: payload.principalId,
      mandateId: payload.mandateId,
      initiatedByUserId: payload.sub,
      taskId: payload.taskId,
      stepId: payload.stepId,
      deviceId: payload.deviceId,
      metadata: {
        stage,
        reason,
        capability: payload.capability,
        argsDigest: payload.argsDigest,
        inputProvenanceSha256: payload.inputProvenanceSha256,
      },
    });
  }

  /**
   * ASK/COLLABORATIVE task tokens act as a service on behalf of a live human.
   * Resolve directly from the database on every short-lived token validation:
   * using PermissionCacheService here would leave revoked authority usable for
   * its TTL, which is unacceptable once a durable worker is already running.
   */
  private async collaborativeTaskIdentity(
    client: Prisma.TransactionClient,
    payload: JwtPayload,
    task: {
      id: string;
      principalId: string;
      mandateId: string | null;
      initiatedByUserId: string | null;
      companyId: string | null;
      principal: { displayName: string };
    },
    step: { id: string },
    delegateUserId: string,
    principalGrants: unknown,
  ): Promise<CachedAuthPayload> {
    const delegate = await client.user.findUnique({
      where: { id: delegateUserId },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
        companyAccess: { select: { companyId: true, accessLevel: true } },
        divisionAccess: {
          select: {
            divisionId: true,
            accessLevel: true,
            division: { select: { companyId: true } },
          },
        },
        branchAccess: {
          select: {
            branchId: true,
            accessLevel: true,
            branch: { select: { division: { select: { companyId: true } } } },
          },
        },
      },
    });
    if (!delegate || delegate.status !== 'ACTIVE') {
      throw new UnauthorizedException('Initiating account is not active');
    }

    const humanPermissions = Array.from(
      new Set(
        delegate.userRoles.flatMap((userRole) =>
          userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code),
        ),
      ),
    );
    const permissions = intersectPrincipalPermissions(principalGrants, humanPermissions);
    const humanScopes = Array.from(
      new Set(delegate.userRoles.map((userRole) => userRole.role.scope)),
    );
    const roleScopes = intersectRoleScopes(humanScopes, principalGrantScope(principalGrants));
    if (roleScopes.length === 0) {
      throw new UnauthorizedException('Initiating account has no active scoped role');
    }
    const taskCompanyId = task.companyId;
    if (
      taskCompanyId &&
      delegate.companyId !== taskCompanyId &&
      !delegate.companyAccess.some((access) => access.companyId === taskCompanyId)
    ) {
      throw new UnauthorizedException('Initiating account has no active task-company access');
    }
    const companyAccess = taskCompanyId
      ? delegate.companyAccess.filter((access) => access.companyId === taskCompanyId)
      : delegate.companyAccess;
    const divisionAccess = delegate.divisionAccess
      .filter((access) => !taskCompanyId || access.division.companyId === taskCompanyId)
      .map(({ divisionId, accessLevel }) => ({ divisionId, accessLevel }));
    const branchAccess = delegate.branchAccess
      .filter((access) => !taskCompanyId || access.branch.division.companyId === taskCompanyId)
      .map(({ branchId, accessLevel }) => ({ branchId, accessLevel }));

    return {
      id: delegate.id,
      email: delegate.email,
      fullName: task.principal.displayName,
      // Keep non-human attribution while authorization fields below remain the
      // live human/principal intersection.
      roles: ['MSAIDIZI_SERVICE'],
      roleScopes,
      role: pickHighestScope(roleScopes),
      permissions,
      // Scope autonomous audit and downstream company guards to the durable
      // task binding, not the initiating user's unrelated primary company.
      companyId: taskCompanyId ?? delegate.companyId,
      companyAccess,
      divisionAccess,
      branchAccess,
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: task.principalId,
      mandateId: task.mandateId ?? undefined,
      initiatedByUserId: task.initiatedByUserId ?? undefined,
      taskId: task.id,
      stepId: step.id,
      deviceId: payload.deviceId,
      planVersion: payload.planVersion,
      taskCapability: payload.capability,
      taskArgsDigest: payload.argsDigest,
      taskInputProvenanceSha256: payload.inputProvenanceSha256,
      taskCredentialJti: payload.jti,
    };
  }

  private async principalPermissions(
    client: Prisma.TransactionClient,
    grants: unknown,
  ): Promise<string[]> {
    const explicit = Array.isArray(grants)
      ? grants.filter((grant): grant is string => typeof grant === 'string')
      : grants &&
          typeof grants === 'object' &&
          Array.isArray((grants as { permissions?: unknown }).permissions)
        ? (grants as { permissions: unknown[] }).permissions.filter(
            (grant): grant is string => typeof grant === 'string',
          )
        : [];
    if (!explicit.includes('*')) return Array.from(new Set(explicit));
    const all = await client.permission.findMany({ select: { code: true } });
    return all.map((permission) => permission.code);
  }

  private deploymentPrincipalPermissions(): string[] {
    const raw = this.config.get<string>('MSAIDIZI_AUTONOMY_GRANTS', '');
    if (typeof raw !== 'string') return [];
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((permission) => permission.trim())
          .filter(Boolean),
      ),
    );
  }

  /**
   * Drop a cached entry across the cluster so the next request re-resolves
   * roles/permissions/company-access from the database. Call this whenever a
   * user's roles, permissions, or company access are mutated.
   */
  async invalidate(userId: string): Promise<void> {
    await this.permissionCache.invalidate(userId);
  }
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function explicitPrincipalPermissions(grants: unknown): string[] {
  return Array.isArray(grants)
    ? grants.filter((grant): grant is string => typeof grant === 'string')
    : grants &&
        typeof grants === 'object' &&
        Array.isArray((grants as { permissions?: unknown }).permissions)
      ? (grants as { permissions: unknown[] }).permissions.filter(
          (grant): grant is string => typeof grant === 'string',
        )
      : [];
}

function intersectPrincipalPermissions(grants: unknown, humanPermissions: string[]): string[] {
  const ceiling = new Set(explicitPrincipalPermissions(grants));
  const uniqueHuman = Array.from(new Set(humanPermissions));
  if (ceiling.has('*')) return uniqueHuman;
  return uniqueHuman.filter((permission) => ceiling.has(permission));
}

function intersectPermissionGrantSets(left: string[], right: string[]): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.has('*') && rightSet.has('*')) return ['*'];
  if (leftSet.has('*')) return Array.from(rightSet);
  if (rightSet.has('*')) return Array.from(leftSet);
  return Array.from(leftSet).filter((permission) => rightSet.has(permission));
}

function principalGrantScope(grants: unknown): string {
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return 'GROUP';
  const scope = (grants as { scope?: unknown }).scope;
  return typeof scope === 'string' ? scope : 'GROUP';
}

function intersectRoleScopes(humanScopes: string[], principalScope: string): string[] {
  const humanRanks = humanScopes
    .map((scope) => SCOPE_PRIORITY.indexOf(scope as (typeof SCOPE_PRIORITY)[number]))
    .filter((rank) => rank >= 0);
  const principalRank = SCOPE_PRIORITY.indexOf(principalScope as (typeof SCOPE_PRIORITY)[number]);
  if (humanRanks.length === 0 || principalRank < 0) return [];
  const effectiveRank = Math.max(Math.min(...humanRanks), principalRank);
  return [SCOPE_PRIORITY[effectiveRank]];
}

interface MandateBoundStep {
  capability: string;
  capabilityVersion: string;
  expectedEffect: MsaidiziEffect;
  dataClass: string;
}

interface MandateCapabilityGrant {
  capability: string;
  version?: string;
  effects: MsaidiziEffect[];
  dataClasses: string[];
}

/**
 * Token validation is a final authority boundary, so do not silently discard a
 * malformed grant and continue with the rest of the array. The whole mandate
 * fails closed until its stored policy is repaired.
 */
function mandateAllowsStep(rawGrants: unknown, step: MandateBoundStep): boolean {
  if (!Array.isArray(rawGrants) || !rawGrants.every(isMandateCapabilityGrant)) return false;
  return rawGrants.some(
    (grant) =>
      grant.capability === step.capability &&
      (grant.version === undefined || grant.version === step.capabilityVersion) &&
      grant.effects.includes(step.expectedEffect) &&
      (grant.dataClasses.includes('*') || grant.dataClasses.includes(step.dataClass)),
  );
}

function isMandateCapabilityGrant(value: unknown): value is MandateCapabilityGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.capability === 'string' &&
    grant.capability.length > 0 &&
    (grant.version === undefined ||
      (typeof grant.version === 'string' && grant.version.length > 0)) &&
    Array.isArray(grant.effects) &&
    grant.effects.length > 0 &&
    grant.effects.every(
      (effect) =>
        typeof effect === 'string' &&
        Object.values(MsaidiziEffect).includes(effect as MsaidiziEffect),
    ) &&
    Array.isArray(grant.dataClasses) &&
    grant.dataClasses.length > 0 &&
    grant.dataClasses.every((dataClass) => typeof dataClass === 'string' && dataClass.length > 0)
  );
}

const MANDATE_BUDGET_RULES = {
  maxWallTimeSeconds: { minimum: 1, integer: true },
  maxModelTurns: { minimum: 1, integer: true },
  maxAttemptedToolCalls: { minimum: 1, integer: true },
  maxMutations: { minimum: 0, integer: true },
  maxLocalBytes: { minimum: 1, integer: true },
  maxExternalEgressBytes: { minimum: 0, integer: true },
  maxModelCostUsd: { minimum: 0, integer: false },
} as const;

type MandateBudgetKey = keyof typeof MANDATE_BUDGET_RULES;
type TaskBudgetFields = { [K in MandateBudgetKey]: unknown };

function taskBudgetsWithinMandate(task: TaskBudgetFields, rawBudgets: unknown): boolean {
  if (!rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) return false;
  const mandate = rawBudgets as Record<string, unknown>;
  for (const key of Object.keys(MANDATE_BUDGET_RULES) as MandateBudgetKey[]) {
    if (!(key in mandate)) continue;
    const rule = MANDATE_BUDGET_RULES[key];
    const ceiling = mandate[key];
    if (
      typeof ceiling !== 'number' ||
      !Number.isFinite(ceiling) ||
      ceiling < rule.minimum ||
      (rule.integer && !Number.isSafeInteger(ceiling))
    ) {
      return false;
    }
    const taskLimit = persistedTaskBudgetNumber(task[key]);
    if (taskLimit === null || taskLimit > ceiling) return false;
  }
  return true;
}

function persistedTaskBudgetNumber(value: unknown): number | null {
  let numeric: number;
  if (typeof value === 'number') numeric = value;
  else if (typeof value === 'bigint') numeric = Number(value);
  else if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    numeric = Number((value as { toString(): string }).toString());
  } else {
    return null;
  }
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
