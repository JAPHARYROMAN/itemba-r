import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

function stripSensitive(profile: any) {
  if (!profile) return profile;
  const sanitized = { ...profile };
  delete sanitized.twoFactorSecretEncrypted;
  delete sanitized.backupCodesHash;
  delete sanitized.user;
  return sanitized;
}

@Injectable()
export class UserSecurityProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  private get safeSelect() {
    return {
      id: true,
      userId: true,
      passwordChangedAt: true,
      passwordExpiresAt: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      lastLoginAt: true,
      lastLoginIp: true,
      lastLoginUserAgent: true,
      lastFailedLoginAt: true,
      lastFailedLoginIp: true,
      twoFactorEnabled: true,
      twoFactorMethod: true,
      forcePasswordChange: true,
      forceTwoFactorSetup: true,
      securityRiskLevel: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  async findAll(query: any, actor: AuthUser) {
    const { page = 1, limit = 20, userId, companyId, securityRiskLevel, twoFactorEnabled } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (userId) {
      const target = await this.findTargetUser(userId);
      await this.assertCanAccessTargetUser(actor, target, AccessLevel.READ);
      where.userId = userId;
    } else {
      where.user = { is: await this.userWhereFor(actor, companyId) };
    }
    if (securityRiskLevel) where.securityRiskLevel = securityRiskLevel;
    if (twoFactorEnabled !== undefined)
      where.twoFactorEnabled = twoFactorEnabled === 'true' || twoFactorEnabled === true;

    const [data, total] = await Promise.all([
      this.prisma.userSecurityProfile.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: this.safeSelect,
      }),
      this.prisma.userSecurityProfile.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.userSecurityProfile.findFirst({
      where: { id },
      select: this.safeSelectWithUser,
    });
    if (!record) throw new NotFoundException('User security profile not found');
    await this.assertCanAccessTargetUser(user, record.user, AccessLevel.READ);
    return stripSensitive(record);
  }

  async create(dto: any, user: AuthUser) {
    const target = await this.findTargetUser(dto.userId);
    await this.assertCanAccessTargetUser(user, target, AccessLevel.MANAGE);

    // A profile is created without a TOTP secret (secrets are only ever provisioned
    // by the /auth/2fa/setup flow). Enabling twoFactorEnabled here would leave the
    // user with a flag but no secret, so login issues a 2FA challenge that can never
    // be satisfied — permanently locking them out. Reject it and require enrolment.
    if (dto.twoFactorEnabled === true || dto.twoFactorEnabled === 'true') {
      throw new BadRequestException(
        'twoFactorEnabled cannot be turned on here — the user must complete the /auth/2fa/setup flow to provision a secret. Set forceTwoFactorSetup to require enrolment.',
      );
    }

    const data: any = {
      userId: dto.userId,
      twoFactorEnabled: false,
      twoFactorMethod: dto.twoFactorMethod ?? 'NONE',
      forcePasswordChange: dto.forcePasswordChange ?? false,
      forceTwoFactorSetup: dto.forceTwoFactorSetup ?? false,
      securityRiskLevel: dto.securityRiskLevel ?? 'LOW',
    };
    const record = await this.prisma.userSecurityProfile.create({ data, select: this.safeSelect });
    await this.auditLogs.log({
      action: 'USER_SECURITY_PROFILE_CREATED',
      entityType: 'UserSecurityProfile',
      entityId: (record as any).id,
      userId: user.id,
      companyId: target.companyId ?? undefined,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.prisma.userSecurityProfile.findFirst({
      where: { id },
      // twoFactorSecretEncrypted is needed to validate 2FA enablement below; it is
      // NOT returned to the caller (the response uses this.safeSelect).
      select: { ...this.safeSelectWithUser, twoFactorSecretEncrypted: true, userId: true },
    });
    if (!existing) throw new NotFoundException('User security profile not found');
    await this.assertCanAccessTargetUser(user, existing.user, AccessLevel.MANAGE);

    const updateData: any = {};
    const allowed = [
      'twoFactorEnabled',
      'twoFactorMethod',
      'forcePasswordChange',
      'forceTwoFactorSetup',
      'securityRiskLevel',
      'lockedUntil',
      'passwordExpiresAt',
    ];
    for (const key of allowed) {
      if (dto[key] !== undefined) updateData[key] = dto[key];
    }

    // Never allow twoFactorEnabled to be turned on without a provisioned TOTP secret.
    // Login gates the 2FA challenge on this flag alone; enabling it without a secret
    // means every submitted code fails verification, permanently locking the user out.
    if (
      (updateData.twoFactorEnabled === true || updateData.twoFactorEnabled === 'true') &&
      !existing.twoFactorSecretEncrypted
    ) {
      throw new BadRequestException(
        'twoFactorEnabled cannot be turned on for a user with no 2FA secret — the user must complete the /auth/2fa/setup flow first. Set forceTwoFactorSetup to require enrolment.',
      );
    }

    // Keep the admin lock effective and the two lock columns consistent. Login and the
    // security dashboards read User.lockedUntil / UserSecurityProfile.lockedUntil
    // independently, so an admin lock set only on the profile would not block login on
    // paths that read the User column, and dashboard counts would disagree. Mirror any
    // profile lock change onto the User row (clearing failedLoginAttempts on unlock).
    const willUpdateLock = Object.prototype.hasOwnProperty.call(updateData, 'lockedUntil');

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userSecurityProfile.update({
        where: { id },
        data: updateData,
        select: this.safeSelect,
      });
      if (willUpdateLock) {
        const lockedUntil = updateData.lockedUntil ? new Date(updateData.lockedUntil) : null;
        await tx.user.update({
          where: { id: existing.userId },
          data: lockedUntil
            ? { lockedUntil }
            : { lockedUntil: null, failedLoginAttempts: 0 },
        });
      }
      return updated;
    });
    await this.auditLogs.log({
      action: 'USER_SECURITY_PROFILE_UPDATED',
      entityType: 'UserSecurityProfile',
      entityId: id,
      userId: user.id,
      companyId: existing.user.companyId ?? undefined,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  private get safeSelectWithUser() {
    return {
      ...this.safeSelect,
      user: {
        select: {
          companyId: true,
          companyAccess: { select: { companyId: true, accessLevel: true } },
        },
      },
    };
  }

  private async findTargetUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        companyId: true,
        companyAccess: { select: { companyId: true, accessLevel: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async userWhereFor(actor: AuthUser, requestedCompanyId?: string | null) {
    const where: any = { deletedAt: null };
    const companyMatch = (companyIds: string[]) => ({
      OR: [
        { companyId: { in: companyIds } },
        { companyAccess: { some: { companyId: { in: companyIds } } } },
      ],
    });

    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(actor, requestedCompanyId);
      Object.assign(where, companyMatch([requestedCompanyId]));
      return where;
    }

    if (this.companyScope.isGroupScoped(actor)) {
      return where;
    }

    const companyIds = await this.companyScope.accessibleCompanyIds(actor);
    if (!companyIds?.length) {
      return { ...where, id: { in: [] } };
    }
    Object.assign(where, companyMatch(companyIds));
    return where;
  }

  private async assertCanAccessTargetUser(
    actor: AuthUser,
    target: { companyId: string | null; companyAccess: Array<{ companyId: string }> },
    minimum: AccessLevel,
  ) {
    if (this.companyScope.isGroupScoped(actor)) return;

    const relatedCompanyIds = new Set<string>();
    if (target.companyId) relatedCompanyIds.add(target.companyId);
    for (const access of target.companyAccess ?? []) {
      relatedCompanyIds.add(access.companyId);
    }

    if (relatedCompanyIds.size === 0) {
      this.companyScope.assertGroupScoped(actor, 'access group-level user security profiles');
      return;
    }

    if (minimum === AccessLevel.READ) {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(actor);
      if (accessibleCompanyIds?.some((companyId) => relatedCompanyIds.has(companyId))) {
        return;
      }
      throw new ForbiddenException('You do not have access to this user security profile');
    }

    for (const companyId of relatedCompanyIds) {
      await this.companyScope.assertCanAccessCompany(actor, companyId, minimum);
    }
  }
}
