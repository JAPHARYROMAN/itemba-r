import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAttributionStatus,
  AuditChannel,
  AuditScopeKind,
  AuditSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  accessibleCompanyIdsFromUser,
  assertCanAccessCompanyFromUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import {
  ambientAgentSessionId,
  ambientChannel,
  ambientExecutionAttribution,
  ambientValidatedCompanyScope,
} from '../../common/context/request-context';
import { redactPersistedSecrets } from '../../common/utils/persistent-secret-redaction';

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId?: string;
  userId?: string | null;
  /** Compatibility FK. A string is explicit COMPANY; null remains explicit GLOBAL. */
  companyId?: string | null;
  /** Authoritative immutable scope classification when the caller knows it. */
  scopeKind?: AuditScopeKind;
  /** Authoritative immutable company-id snapshots for COMPANY/MULTI_COMPANY. */
  companyScopeIds?: string[];
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /** Override auto-derived severity. */
  severity?: AuditSeverity;
  /**
   * What drove the action. Defaults to WEB — the overwhelming majority and the
   * only channel that existed when this was introduced. Callers on a non-human
   * path must set this explicitly: SYSTEM for jobs and schedulers, API for
   * key-authenticated integration traffic, AGENT for Msaidizi.
   *
   * `userId` still records *whose authority* the action used; this records *what
   * exercised it*. An agent run has both — the user's id and AGENT.
   */
  channel?: AuditChannel;
  /**
   * Correlates every entry from one agent run, so the run can be reviewed or
   * reversed as a unit. Only meaningful with `channel: AGENT`.
   */
  agentSessionId?: string | null;
  principalType?: string | null;
  principalId?: string | null;
  mandateId?: string | null;
  initiatedByUserId?: string | null;
  taskId?: string | null;
  stepId?: string | null;
  deviceId?: string | null;
}

// ─── Severity classification ──────────────────────────────────────────────────

const CRITICAL_ACTIONS = new Set([
  'LOGIN_FAILED',
  'LOGIN_FAILED_INACTIVE',
  'LOGIN_FAILED_BAD_PASSWORD',
  'LOGIN_BLOCKED_ACCOUNT_LOCKED',
  'ACCOUNT_LOCKED',
  'PERMISSION_CHANGE',
  'ROLE_ASSIGNED',
  'ROLE_REMOVED',
  'USER_DELETE',
  'SENSITIVE_ACCESS',
  'VIEW_SENSITIVE',
  'VIEW_SENSITIVE_DENIED',
  'DOCUMENT_DOWNLOAD',
  'DOCUMENT_DELETE',
  'LOAN_STATUS_CHANGE',
  'LOAN_SETTLED',
  'LOAN_DEFAULTED',
  'DEBT_STATUS_CHANGE',
  'DEBT_SETTLED',
  'ASSET_DISPOSED',
  'ASSET_COLLATERAL_MARKED',
  'CONTRACT_STATUS_CHANGE',
  'CONTRACT_TERMINATED',
]);

const HIGH_ACTIONS = new Set([
  'LOGIN',
  'LOGOUT',
  'USER_REGISTERED',
  'BANK_ACCOUNT_CREATE',
  'BANK_ACCOUNT_UPDATE',
  'BANK_ACCOUNT_VIEW',
  'LOAN_CREATE',
  'LOAN_UPDATE',
  'LOAN_VIEW',
  'LOAN_REPAYMENT',
  'DEBT_CREATE',
  'DEBT_UPDATE',
  'DEBT_VIEW',
  'CONTRACT_CREATE',
  'CONTRACT_UPDATE',
  'CONTRACT_VIEW',
  'FIXED_ASSET_CREATE',
  'FIXED_ASSET_UPDATE',
  'FIXED_ASSET_VIEW',
  'DOCUMENT_UPLOAD',
  'DOCUMENT_VIEW',
  'LEGAL_PROFILE_UPDATE',
  'COMPANY_CREATE',
  'COMPANY_UPDATE',
  'COMPANY_DELETE',
]);

const MEDIUM_ACTIONS = new Set([
  'DIVISION_CREATE',
  'DIVISION_UPDATE',
  'DIVISION_DELETE',
  'BRANCH_CREATE',
  'BRANCH_UPDATE',
  'BRANCH_DELETE',
  'USER_CREATE',
  'USER_UPDATE',
  'DOCUMENT_ENTITY_LIST',
  'DOCUMENT_UPDATE',
]);

function deriveSeverity(action: string): AuditSeverity {
  if (CRITICAL_ACTIONS.has(action)) return AuditSeverity.CRITICAL;
  if (HIGH_ACTIONS.has(action)) return AuditSeverity.HIGH;
  if (MEDIUM_ACTIONS.has(action)) return AuditSeverity.MEDIUM;
  return AuditSeverity.LOW;
}

// ─── Sensitive-field redaction ────────────────────────────────────────────────
//
// Audit log payloads (oldValue / newValue / metadata) frequently come from raw
// DTOs.  A DTO may include a password, a refresh token, an API secret, a 2FA
// backup code, or other material that must never enter the audit trail.
//
// We redact these keys defensively — name-based, recursive, case-insensitive.

const REDACTED_KEY_PATTERNS = [
  /password/i,
  /^pass$/i,
  /passwordhash/i,
  /\bsecret\b/i,
  /secrethash/i,
  /\btoken\b/i,
  /tokenhash/i,
  /refreshtoken/i,
  /accesstoken/i,
  /apikey/i,
  /apisecret/i,
  /privatekey/i,
  /backupcode/i,
  /pairingcode/i,
  /enrollmentcode/i,
  /activationcode/i,
  /activationpath/i,
  /contentbase64/i,
  /^otp$/i,
  /twofactorsecret/i,
  /encryptionkey/i,
  /^pin$/i,
  /^cvv$/i,
  /idempotencykey/i,
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

function shouldRedactKey(key: string): boolean {
  return REDACTED_KEY_PATTERNS.some((re) => re.test(key));
}

function redactValue(value: unknown, depth = 0): unknown {
  // Bound recursion against pathological nesting without returning the exact
  // uninspected subtree. Returning it raw turns depth into a redaction bypass.
  if (depth > 10) return REDACTED_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactPersistedSecrets(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();

    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') {
      const jsonValue = toJSON.call(value);
      if (jsonValue !== value) return redactValue(jsonValue, depth + 1);
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedactKey(k) ? REDACTED_PLACEHOLDER : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Exported so non-audit consumers (logging interceptor, error logs) can reuse the same rules. */
export function redactSensitiveFields<T>(value: T): T {
  return redactValue(value) as T;
}

// ─── Query params ─────────────────────────────────────────────────────────────

export interface AuditLogQuery {
  search?: string;
  userId?: string;
  companyId?: string;
  action?: string;
  entityType?: string;
  severity?: AuditSeverity;
  /** Filter by what drove the action — e.g. AGENT to review one agent's work. */
  channel?: AuditChannel;
  /** Pull one agent run's entries together. */
  agentSessionId?: string;
  principalType?: string;
  principalId?: string;
  mandateId?: string;
  taskId?: string;
  stepId?: string;
  deviceId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

interface ResolvedAuditScope {
  companyId: string | null;
  kind: AuditScopeKind;
  status: AuditAttributionStatus;
  companyIds: string[];
}

interface ExplicitAuditScopeResult {
  scope: ResolvedAuditScope;
  warning?: string;
}

type AuditPersistenceClient = PrismaService | Prisma.TransactionClient;

function explicitAuditScope(input: AuditLogInput): ExplicitAuditScopeResult | undefined {
  const hasModernScope = input.scopeKind !== undefined || input.companyScopeIds !== undefined;
  if (!hasModernScope && input.companyId === undefined) return undefined;

  // New scope fields are authoritative over the compatibility FK. This lets a
  // caller state MULTI_COMPANY/GROUP/GLOBAL without a lossy primary company.
  if (hasModernScope) {
    const normalized = normalizeCompanyScopeIds(input.companyScopeIds);
    if (normalized.error) return invalidExplicitAuditScope(normalized.error);

    let companyIds = normalized.ids;
    let kind = input.scopeKind;
    if (!kind) {
      if (companyIds.length === 1) kind = AuditScopeKind.COMPANY;
      else if (companyIds.length > 1) kind = AuditScopeKind.MULTI_COMPANY;
      else return invalidExplicitAuditScope('companyScopeIds must contain at least one company');
    }

    if (
      kind === AuditScopeKind.COMPANY &&
      input.companyScopeIds === undefined &&
      typeof input.companyId === 'string'
    ) {
      const fallback = normalizeCompanyScopeIds([input.companyId]);
      if (fallback.error) return invalidExplicitAuditScope(fallback.error);
      companyIds = fallback.ids;
    }

    switch (kind) {
      case AuditScopeKind.COMPANY:
        return companyIds.length === 1
          ? {
              scope: {
                companyId: companyIds[0],
                companyIds,
                kind,
                status: AuditAttributionStatus.EXPLICIT,
              },
            }
          : invalidExplicitAuditScope('COMPANY scope requires exactly one companyScopeId');
      case AuditScopeKind.MULTI_COMPANY:
        return companyIds.length >= 2
          ? {
              scope: {
                companyId: null,
                companyIds,
                kind,
                status: AuditAttributionStatus.EXPLICIT,
              },
            }
          : invalidExplicitAuditScope(
              'MULTI_COMPANY scope requires at least two distinct companyScopeIds',
            );
      case AuditScopeKind.GROUP:
      case AuditScopeKind.GLOBAL:
        return companyIds.length === 0
          ? {
              scope: {
                companyId: null,
                companyIds: [],
                kind,
                status: AuditAttributionStatus.EXPLICIT,
              },
            }
          : invalidExplicitAuditScope(`${kind} scope cannot carry companyScopeIds`);
      case AuditScopeKind.UNATTRIBUTED:
        return companyIds.length === 0
          ? { scope: failedAuditScope() }
          : invalidExplicitAuditScope('UNATTRIBUTED scope cannot carry companyScopeIds');
      default:
        return invalidExplicitAuditScope(`unsupported scope kind: ${String(kind)}`);
    }
  }

  // Compatibility for existing callers: an explicit string remains a tenant
  // action and explicit null remains an intentional global action. Historical
  // null rows are separately backfilled as UNATTRIBUTED/LEGACY.
  if (typeof input.companyId === 'string' && input.companyId.trim().length > 0) {
    const companyId = input.companyId.trim();
    return {
      scope: {
        companyId,
        companyIds: [companyId],
        kind: AuditScopeKind.COMPANY,
        status: AuditAttributionStatus.EXPLICIT,
      },
    };
  }
  if (input.companyId === null) {
    return {
      scope: {
        companyId: null,
        companyIds: [],
        kind: AuditScopeKind.GLOBAL,
        status: AuditAttributionStatus.EXPLICIT,
      },
    };
  }
  return invalidExplicitAuditScope('companyId must be a non-empty string or null');
}

function normalizeCompanyScopeIds(value: unknown): { ids: string[]; error?: string } {
  if (value === undefined) return { ids: [] };
  if (!Array.isArray(value)) return { ids: [], error: 'companyScopeIds must be an array' };

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      return { ids: [], error: 'companyScopeIds may contain only non-empty strings' };
    }
    const companyId = candidate.trim();
    if (!seen.has(companyId)) {
      seen.add(companyId);
      ids.push(companyId);
    }
  }
  return { ids };
}

function invalidExplicitAuditScope(warning: string): ExplicitAuditScopeResult {
  return { scope: failedAuditScope(), warning };
}

function resolvedCompanyAuditScope(companyId: string): ResolvedAuditScope {
  return {
    companyId,
    companyIds: [companyId],
    kind: AuditScopeKind.COMPANY,
    status: AuditAttributionStatus.RESOLVED,
  };
}

function failedAuditScope(): ResolvedAuditScope {
  return {
    companyId: null,
    companyIds: [],
    kind: AuditScopeKind.UNATTRIBUTED,
    status: AuditAttributionStatus.FAILED,
  };
}

/**
 * Central audit log writer + reader.
 * - `log()` never throws — audit failures must not block business operations.
 * - Audit logs are append-only; no update/delete endpoints exist.
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.append(input, false);
    } catch (err) {
      this.logger.error('Failed to write audit log', err as Error);
    }
  }

  /**
   * Fail-closed audit append for mandatory security events. It shares the exact
   * same redaction, attribution, and atomic create path as log(), but lets a
   * persistence failure reach the caller.
   */
  async logStrict(input: AuditLogInput): Promise<void> {
    await this.append(input, true);
  }

  /**
   * Fail-closed append on the caller's transaction. Autonomous state changes
   * use this path so the immutable scope snapshot and the action either commit
   * together or both roll back.
   */
  async logStrictInTransaction(tx: Prisma.TransactionClient, input: AuditLogInput): Promise<void> {
    await this.append(input, true, tx);
  }

  private async append(
    input: AuditLogInput,
    strictScope: boolean,
    client: AuditPersistenceClient = this.prisma,
  ): Promise<void> {
    // Attribution the caller did not supply comes from the ambient request
    // context. That is what lets existing log() call sites record an
    // agent-driven action correctly without knowing Msaidizi exists.
    const channel = input.channel ?? ambientChannel();
    const agentSessionId = input.agentSessionId ?? ambientAgentSessionId();
    const ambient = ambientExecutionAttribution();

    if (channel === AuditChannel.AGENT && !agentSessionId) {
      this.logger.warn(
        `Agent-channel audit entry without agentSessionId (action=${input.action}); ` +
          'this entry cannot be correlated to its run.',
      );
    }

    // Redact before constructing either best-effort or strict persistence data.
    const oldValue = input.oldValue ? redactSensitiveFields(input.oldValue) : undefined;
    const newValue = input.newValue ? redactSensitiveFields(input.newValue) : undefined;
    const metadata = input.metadata ? redactSensitiveFields(input.metadata) : undefined;
    const scope = await this.resolveAuditScope(input, strictScope, client);

    await client.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        userId: input.userId,
        companyId: scope.companyId,
        scopeKind: scope.kind,
        attributionStatus: scope.status,
        companyScopes:
          scope.companyIds.length > 0
            ? { create: scope.companyIds.map((companyId) => ({ companyId })) }
            : undefined,
        oldValue: oldValue as object | undefined,
        newValue: newValue as object | undefined,
        metadata: metadata as object | undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        severity: input.severity ?? deriveSeverity(input.action),
        channel,
        // Only carried on the agent path; a session id without AGENT would
        // make the trail claim a correlation that does not exist.
        agentSessionId: channel === AuditChannel.AGENT ? agentSessionId : undefined,
        principalType: input.principalType ?? ambient.principalType,
        principalId: input.principalId ?? ambient.principalId,
        mandateId: input.mandateId ?? ambient.mandateId,
        initiatedByUserId: input.initiatedByUserId ?? ambient.initiatedByUserId,
        taskId: input.taskId ?? ambient.taskId,
        stepId: input.stepId ?? ambient.stepId,
        deviceId: input.deviceId ?? ambient.deviceId,
      },
    });
  }

  private async resolveAuditScope(
    input: AuditLogInput,
    strictScope: boolean,
    client: AuditPersistenceClient,
  ): Promise<ResolvedAuditScope> {
    const explicit = explicitAuditScope(input);
    if (explicit) {
      if (explicit.warning) {
        const message =
          `Invalid explicit audit scope for ${input.entityType} (${input.action}): ` +
          explicit.warning;
        if (strictScope) throw new Error(message);
        this.logger.warn(message);
      }
      return explicit.scope;
    }

    // Company-policy services record only scopes they have already authorized.
    // Prefer that request-local proof over a post-hoc entity lookup so the
    // immutable ledger distinguishes explicit application authorization from
    // defensive persistence inference.
    const validated = ambientValidatedCompanyScope();
    if (validated) {
      if (validated.kind === 'COMPANY' && validated.companyIds.length === 1) {
        return {
          companyId: validated.companyIds[0],
          companyIds: validated.companyIds,
          kind: AuditScopeKind.COMPANY,
          status: AuditAttributionStatus.EXPLICIT,
        };
      }
      if (validated.kind === 'MULTI_COMPANY' && validated.companyIds.length >= 2) {
        return {
          companyId: null,
          companyIds: validated.companyIds,
          kind: AuditScopeKind.MULTI_COMPANY,
          status: AuditAttributionStatus.EXPLICIT,
        };
      }
      if (validated.kind === 'GROUP' || validated.kind === 'GLOBAL') {
        return {
          companyId: null,
          companyIds: [],
          kind: validated.kind === 'GROUP' ? AuditScopeKind.GROUP : AuditScopeKind.GLOBAL,
          status: AuditAttributionStatus.EXPLICIT,
        };
      }
    }

    if (input.entityType === 'Company' && input.entityId) {
      return resolvedCompanyAuditScope(input.entityId);
    }

    let persisted: string | null | undefined;
    try {
      persisted = await persistedAuditCompanyId(client, input);
    } catch (error) {
      // Company inference is defensive enrichment. It must never turn the
      // append itself into a lost-audit path, including for logStrict().
      this.logger.warn(
        `Could not resolve audit company from persisted ${input.entityType} state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof persisted === 'string') return resolvedCompanyAuditScope(persisted);
    if (persisted === null) return failedAuditScope();

    // A post-delete lookup cannot find a hard-deleted entity. Existing state
    // supplied by the service is the final trusted fallback. Never infer from
    // newValue: many callers place their raw request DTO there.
    const snapshotCompanyId = oldSnapshotAuditCompanyId(input.oldValue);
    return snapshotCompanyId ? resolvedCompanyAuditScope(snapshotCompanyId) : failedAuditScope();
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  private buildWhere(q: AuditLogQuery, user?: AuthUser): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.userId && { userId: q.userId }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.severity && { severity: q.severity }),
      ...(q.channel && { channel: q.channel }),
      ...(q.agentSessionId && { agentSessionId: q.agentSessionId }),
      ...(q.principalType && { principalType: q.principalType }),
      ...(q.principalId && { principalId: q.principalId }),
      ...(q.mandateId && { mandateId: q.mandateId }),
      ...(q.taskId && { taskId: q.taskId }),
      ...(q.stepId && { stepId: q.stepId }),
      ...(q.deviceId && { deviceId: q.deviceId }),
      ...(q.action && { action: { contains: q.action, mode: 'insensitive' as const } }),
      ...(q.search && {
        OR: [
          { action: { contains: q.search, mode: 'insensitive' as const } },
          { entityType: { contains: q.search, mode: 'insensitive' as const } },
          { entityId: { contains: q.search, mode: 'insensitive' as const } },
          { ipAddress: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
      ...((q.dateFrom || q.dateTo) && {
        createdAt: {
          ...(q.dateFrom && { gte: dateRangeStart(q.dateFrom) }),
          ...(q.dateTo && { lte: dateRangeEnd(q.dateTo) }),
        },
      }),
    };

    if (!user) return where;
    const scope = auditScopeWhere(user, q.companyId);

    // Group-level audit visibility and free-text search both use OR clauses.
    // Keep them as separate AND operands so neither can broaden the other.
    if (scope.OR && where.OR) {
      const { OR: search, ...rest } = where;
      return { ...rest, AND: [scope, { OR: search }] };
    }
    return { ...scope, ...where };
  }

  private readonly auditInclude = {
    user: { select: { id: true, fullName: true, email: true } },
    company: { select: { id: true, name: true, code: true } },
    companyScopes: { select: { companyId: true } },
  } as const;

  async findAll(q: AuditLogQuery, user?: AuthUser) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(q, user);

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.auditInclude,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    return this.prisma.auditLog.findUniqueOrThrow({
      where: user ? { id, AND: [auditScopeWhere(user)] } : { id },
      include: this.auditInclude,
    });
  }

  async findByEntity(entityType: string, entityId: string, user?: AuthUser) {
    return this.prisma.auditLog.findMany({
      where: { ...(user && auditScopeWhere(user)), entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: this.auditInclude,
    });
  }

  async findByUser(userId: string, q: Pick<AuditLogQuery, 'page' | 'limit'> = {}, user?: AuthUser) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { ...(user && auditScopeWhere(user)), userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.auditInclude,
      }),
      this.prisma.auditLog.count({ where: { ...(user && auditScopeWhere(user)), userId } }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findSensitive(limit = 100, user?: AuthUser) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(user && auditScopeWhere(user)),
        severity: { in: [AuditSeverity.CRITICAL, AuditSeverity.HIGH] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: this.auditInclude,
    });
  }

  async getSummary(dateFrom?: string, dateTo?: string, user?: AuthUser) {
    const createdAt =
      dateFrom || dateTo
        ? {
            ...(dateFrom && { gte: dateRangeStart(dateFrom) }),
            ...(dateTo && { lte: dateRangeEnd(dateTo) }),
          }
        : undefined;

    const baseWhere: Prisma.AuditLogWhereInput = {
      ...(user && auditScopeWhere(user)),
      ...(createdAt && { createdAt }),
    };

    const [total, bySeverity, byEntityType, recentCritical] = await Promise.all([
      this.prisma.auditLog.count({ where: baseWhere }),
      this.prisma.auditLog.groupBy({
        by: ['severity'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { severity: 'asc' },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityType'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.auditLog.findMany({
        where: { ...baseWhere, severity: AuditSeverity.CRITICAL },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: this.auditInclude,
      }),
    ]);

    return { total, bySeverity, byEntityType, recentCritical };
  }

  /** Distinct list of entity types present in audit logs — for filter dropdown. */
  async getEntityTypes(user?: AuthUser): Promise<string[]> {
    // Bound the distinct scan: entityType is a small finite enumeration, so a
    // generous cap is more than enough for the dropdown while preventing an
    // unbounded scan/sort over the ever-growing append-only audit table.
    const rows = await this.prisma.auditLog.findMany({
      where: { ...(user && auditScopeWhere(user)) },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.entityType);
  }
}

/**
 * Recover tenant attribution from a persisted pre-action snapshot only. This
 * is used after post-action lookup fails (notably hard deletes). Request
 * metadata and newValue are deliberately excluded because both may contain raw
 * caller-controlled DTO data.
 */
function oldSnapshotAuditCompanyId(value: unknown): string | undefined {
  const ids = new Set<string>();
  collectSnapshotCompanyIds(value, ids);
  if (ids.size === 1) return [...ids][0];
  return undefined;
}

const AUDIT_COMPANY_RELATION_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  AccountingPostingRuleLine: ['postingRule', 'companyId'],
  ApprovalAction: ['approvalRequest', 'companyId'],
  ApprovalStep: ['workflow', 'companyId'],
  AuditEvidencePackItem: ['evidencePack', 'companyId'],
  BankStatementLine: ['bankReconciliation', 'companyId'],
  Branch: ['division', 'companyId'],
  CustomerSegmentMembership: ['customerSegment', 'companyId'],
  InterCompanyTransaction: ['fromCompanyId'],
  MobileMoneyAccount: ['employee', 'companyId'],
  OfflineSyncRecord: ['syncBatch', 'companyId'],
  PriceListItem: ['priceList', 'companyId'],
});

interface AuditCompanyModelResolver {
  delegateName: string;
  path: readonly string[];
  supportsSoftDelete: boolean;
}

/**
 * Prisma's model metadata is immutable for the life of the process. Build the
 * company-resolution plan once rather than rescanning the DMMF for every audit
 * entry (a hot path for bulk mutations).
 */
const AUDIT_COMPANY_MODEL_RESOLVERS = new Map<string, AuditCompanyModelResolver>(
  Prisma.dmmf.datamodel.models.flatMap((model) => {
    const relationPath = AUDIT_COMPANY_RELATION_PATHS[model.name];
    const path = model.fields.some((field) => field.kind !== 'object' && field.name === 'companyId')
      ? (['companyId'] as const)
      : relationPath;
    if (!path) return [];

    return [
      [
        model.name,
        {
          delegateName: `${model.name.charAt(0).toLowerCase()}${model.name.slice(1)}`,
          path,
          supportsSoftDelete: model.fields.some(
            (field) => field.kind !== 'object' && field.name === 'deletedAt',
          ),
        },
      ] as [string, AuditCompanyModelResolver],
    ];
  }),
);

async function persistedAuditCompanyId(
  prisma: AuditPersistenceClient,
  input: AuditLogInput,
): Promise<string | null | undefined> {
  if (!input.entityId) return undefined;
  const resolver = AUDIT_COMPANY_MODEL_RESOLVERS.get(input.entityType);
  if (!resolver) return undefined;

  const delegate = (
    prisma as unknown as Record<
      string,
      { findUnique?: (args: Record<string, unknown>) => Promise<unknown> }
    >
  )[resolver.delegateName];
  if (typeof delegate?.findUnique !== 'function') return undefined;
  const query = {
    where: { id: input.entityId },
    select: nestedCompanySelect(resolver.path),
  };
  let record = await delegate.findUnique(query);

  // PrismaService makes an ordinary findUnique live-only. A soft-delete audit
  // runs after the mutation, so retry only for models that actually own a
  // deletedAt scalar and state the deleted-row predicate explicitly. That
  // predicate tells the middleware not to inject deletedAt: null.
  if (record == null && resolver.supportsSoftDelete) {
    record = await delegate.findUnique({
      ...query,
      where: { id: input.entityId, deletedAt: { not: null } },
    });
  }

  const value = readPath(record, resolver.path);
  return typeof value === 'string' || value === null ? value : undefined;
}

function nestedCompanySelect(path: readonly string[]): Record<string, unknown> {
  const [head, ...tail] = path;
  if (!head) return {};
  return tail.length === 0 ? { [head]: true } : { [head]: { select: nestedCompanySelect(tail) } };
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function collectSnapshotCompanyIds(value: unknown, found: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSnapshotCompanyIds(item, found, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const companyId = record.companyId;
  if (typeof companyId === 'string' && companyId.length > 0) found.add(companyId);
  const company = record.company;
  if (company && typeof company === 'object') {
    const id = (company as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) found.add(id);
  }
  for (const nested of Object.values(record)) {
    collectSnapshotCompanyIds(nested, found, depth + 1);
  }
}

function auditScopeWhere(
  user: AuthUser,
  requestedCompanyId?: string | null,
): Prisma.AuditLogWhereInput {
  if (requestedCompanyId) {
    assertCanAccessCompanyFromUser(user, requestedCompanyId);
    return {
      scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
      companyScopes: { some: { companyId: requestedCompanyId } },
    };
  }

  if (isGroupScopedUser(user)) {
    // GROUP policy grants implicit READ across the group, including companies
    // absent from the actor's explicit access list. UNATTRIBUTED remains hidden:
    // historical absence of provenance is not an oversight scope grant.
    return {
      OR: [
        { scopeKind: { in: [AuditScopeKind.GROUP, AuditScopeKind.GLOBAL] } },
        {
          scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
          companyScopes: { some: {} },
        },
      ],
    };
  }

  const companyIds = accessibleCompanyIdsFromUser(user);
  return {
    scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
    companyScopes: { some: { companyId: { in: companyIds } } },
  };
}
