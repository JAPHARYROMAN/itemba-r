import { Injectable, Logger } from '@nestjs/common';
import { AuditSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  assertCanAccessCompanyFromUser,
  companyWhereForUser,
} from '../../common/services/company-scope.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId?: string;
  userId?: string;
  companyId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /** Override auto-derived severity. */
  severity?: AuditSeverity;
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
  // Bound recursion against pathological nesting.
  if (depth > 10) return value;
  if (value === null || value === undefined) return value;
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
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
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
      // Redact sensitive fields from any payload before they hit the trail.
      // Callers should feel free to pass full DTOs as oldValue/newValue.
      const oldValue = input.oldValue ? redactSensitiveFields(input.oldValue) : undefined;
      const newValue = input.newValue ? redactSensitiveFields(input.newValue) : undefined;
      const metadata = input.metadata ? redactSensitiveFields(input.metadata) : undefined;

      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          userId: input.userId,
          companyId: input.companyId,
          oldValue: oldValue as object | undefined,
          newValue: newValue as object | undefined,
          metadata: metadata as object | undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          severity: input.severity ?? deriveSeverity(input.action),
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err as Error);
    }
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  private buildWhere(q: AuditLogQuery, user?: AuthUser): Prisma.AuditLogWhereInput {
    return {
      ...(user && companyWhereForUser(user, q.companyId)),
      ...(q.userId && { userId: q.userId }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.severity && { severity: q.severity }),
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
  }

  private readonly auditInclude = {
    user: { select: { id: true, fullName: true, email: true } },
    company: { select: { id: true, name: true, code: true } },
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
    const log = await this.prisma.auditLog.findUniqueOrThrow({
      where: { id },
      include: this.auditInclude,
    });
    if (user) assertCanAccessCompanyFromUser(user, log.companyId);
    return log;
  }

  async findByEntity(entityType: string, entityId: string, user?: AuthUser) {
    return this.prisma.auditLog.findMany({
      where: { ...(user && companyWhereForUser(user)), entityType, entityId },
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
        where: { ...(user && companyWhereForUser(user)), userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.auditInclude,
      }),
      this.prisma.auditLog.count({ where: { ...(user && companyWhereForUser(user)), userId } }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findSensitive(limit = 100, user?: AuthUser) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(user && companyWhereForUser(user)),
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
      ...(user && companyWhereForUser(user)),
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
      where: { ...(user && companyWhereForUser(user)) },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.entityType);
  }
}
