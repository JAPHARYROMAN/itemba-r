import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessLevel, MobilePosEnrollment, Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MobilePosRole } from '../../common/decorators/mobile-pos-session.decorator';
import {
  MobilePosApproveDto,
  MobilePosBranchSetupDto,
  MobilePosLoginDto,
  MobilePosRegistrationDto,
  MobilePosResetDto,
  MobilePosSetupDto,
} from './mobile-pos-auth.dto';

const CLAIM_TTL_MS = 7 * 86400000;
const SESSION_TTL_MS = 8 * 3600000;
const LOCK_TTL_MS = 15 * 60000;
const token = () => randomBytes(24).toString('base64url');
export const mobilePosHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function mobilePosHashMatches(hash: string | null, raw: string): boolean {
  if (!hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(mobilePosHash(raw), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const mobilePosPermissions = (role: MobilePosRole): string[] => [
  'mobile_pos_lite.access',
  'pos_drafts.view',
  'pos_drafts.create',
  ...(role === 'STOCKIST' ? ['pos_drafts.dispatch'] : []),
];

export type PosSessionClaims = {
  sub: string;
  email: string;
  sid: string;
  tokenUse: 'mobile-pos' | 'mobile-pos-refresh';
  mobilePosEnrollmentId: string;
  mobilePosTerminalId: string;
  mobilePosCredentialVersion: number;
  jti?: string;
};

@Injectable()
export class MobilePosAuthService {
  private readonly dummyPinHash = argon2.hash(randomBytes(32).toString('hex'));
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    private readonly companies: CompanyScopeService,
    private readonly organization: OrganizationScopeService,
  ) {}

  private async assertManager(
    user: AuthUser,
    companyId: string,
    divisionId: string,
    branchId: string,
  ) {
    if (
      user.tokenUse === 'mobile-pos' ||
      !user.permissions.includes('mobile_pos_onboarding.manage')
    ) {
      throw new ForbiddenException('Existing administrator access is required');
    }
    await this.companies.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);
    await this.organization.assertCanAccessScope(user, divisionId, branchId, AccessLevel.WRITE);
  }

  async saveBranchSetup(dto: MobilePosBranchSetupDto, actor: AuthUser) {
    await this.assertManager(actor, dto.companyId, dto.divisionId, dto.branchId);
    if (dto.approvalRequired === false)
      throw new BadRequestException('Staff captures always require office approval');
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: dto.branchId,
        divisionId: dto.divisionId,
        isActive: true,
        deletedAt: null,
        division: { companyId: dto.companyId, isActive: true, deletedAt: null },
      },
    });
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: dto.generalCustomerId,
        companyId: dto.companyId,
        status: 'ACTIVE',
        deletedAt: null,
        OR: [{ branchId: null }, { branchId: dto.branchId }],
        AND: [{ OR: [{ divisionId: null }, { divisionId: dto.divisionId }] }],
      },
    });
    if (!branch || !customer)
      throw new BadRequestException('Branch or general customer is outside this setup');
    const mappings = dto.paymentMappings;
    if (
      !mappings.length ||
      !mappings.some((m) => m.paymentMethod === 'CASH') ||
      new Set(mappings.map((m) => m.paymentMethod)).size !== mappings.length
    ) {
      throw new BadRequestException('Configure Cash once and each receipt method at most once');
    }
    const accounts = await this.prisma.cashAccount.findMany({
      where: {
        id: { in: mappings.map((m) => m.cashAccountId) },
        companyId: dto.companyId,
        isActive: true,
        currency: 'TZS',
        deletedAt: null,
      },
    });
    const types: Record<string, string[]> = {
      CASH: ['CASH_ON_HAND', 'PETTY_CASH'],
      MOBILE_MONEY: ['MOBILE_MONEY'],
      BANK_TRANSFER: ['BANK'],
    };
    for (const mapping of mappings) {
      const account = accounts.find((a) => a.id === mapping.cashAccountId);
      if (
        !account ||
        !types[mapping.paymentMethod].includes(account.accountType) ||
        (account.divisionId && account.divisionId !== dto.divisionId) ||
        (account.branchId && account.branchId !== dto.branchId) ||
        (mapping.paymentMethod !== 'BANK_TRANSFER' &&
          (account.divisionId !== dto.divisionId || account.branchId !== dto.branchId))
      ) {
        throw new BadRequestException(
          'A receipt account is missing, inactive or outside this branch',
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const setup = await tx.mobilePosBranchSetup.upsert({
        where: { branchId: dto.branchId },
        create: {
          ...dto,
          approvalRequired: true,
          paymentMappings: mappings as unknown as Prisma.InputJsonValue,
          createdById: actor.id,
        },
        update: {
          ...dto,
          approvalRequired: true,
          paymentMappings: mappings as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_BRANCH_SETUP_SAVED',
        entityType: 'MobilePosBranchSetup',
        entityId: setup.id,
        userId: actor.id,
        companyId: setup.companyId,
      });
      return setup;
    });
  }

  async branchOptions(actor: AuthUser, companyId: string, divisionId: string, branchId: string) {
    if (!companyId || !divisionId || !branchId)
      throw new BadRequestException('Select a company, division and branch');
    await this.assertManager(actor, companyId, divisionId, branchId);
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        divisionId,
        isActive: true,
        deletedAt: null,
        division: { companyId, isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch is outside this setup');
    const compatible = {
      companyId,
      deletedAt: null,
      AND: [
        { OR: [{ divisionId: null }, { divisionId }] },
        { OR: [{ branchId: null }, { branchId }] },
      ],
    };
    const [customers, accounts] = await Promise.all([
      this.prisma.customer.findMany({
        where: { ...compatible, status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.cashAccount.findMany({
        where: { ...compatible, isActive: true, currency: 'TZS' },
        select: { id: true, accountName: true, accountType: true },
        orderBy: { accountName: 'asc' },
      }),
    ]);
    return { customers, accounts };
  }

  async listBranchSetups(user: AuthUser, companyId?: string) {
    const where = await this.companies.companyWhereFor(user, companyId);
    const rows = await this.prisma.mobilePosBranchSetup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const visible = [];
    for (const row of rows) {
      try {
        await this.assertManager(user, row.companyId, row.divisionId, row.branchId);
        const mappings = row.paymentMappings as unknown as Array<{
          paymentMethod: string;
          cashAccountId: string;
          label?: string;
        }>;
        const [scope, customer, accounts] = await Promise.all([
          this.scopeProfile(row),
          this.prisma.customer.findFirst({
            where: { id: row.generalCustomerId, companyId: row.companyId },
            select: { id: true, name: true },
          }),
          this.prisma.cashAccount.findMany({
            where: {
              id: { in: mappings.map((mapping) => mapping.cashAccountId) },
              companyId: row.companyId,
            },
            select: { id: true, accountName: true },
          }),
        ]);
        visible.push({
          ...row,
          ...scope,
          generalCustomer: customer,
          paymentMappings: mappings.map((mapping) => ({
            ...mapping,
            accountName:
              accounts.find((account) => account.id === mapping.cashAccountId)?.accountName ?? null,
          })),
        });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return visible;
  }

  async createInvite(branchSetupId: string, actor: AuthUser) {
    const setup = await this.prisma.mobilePosBranchSetup.findUnique({
      where: { id: branchSetupId },
    });
    if (!setup?.enabled || !setup.approvalRequired)
      throw new BadRequestException('Enable branch setup before issuing an invitation');
    await this.assertManager(actor, setup.companyId, setup.divisionId, setup.branchId);
    const rawToken = token();
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
    const invite = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mobilePosInvite.create({
        data: {
          branchSetupId,
          tokenHash: mobilePosHash(rawToken),
          expiresAt,
          createdById: actor.id,
        },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_INVITE_CREATED',
        entityType: 'MobilePosInvite',
        entityId: created.id,
        userId: actor.id,
        companyId: setup.companyId,
      });
      return created;
    });
    return {
      id: invite.id,
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      path: '/mobile-pos/join/' + rawToken,
      ...(await this.scopeProfile(setup)),
    };
  }

  private async findInvite(rawToken: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(rawToken))
      throw new NotFoundException('Invitation is unavailable');
    const invite = await this.prisma.mobilePosInvite.findUnique({
      where: { tokenHash: mobilePosHash(rawToken) },
      include: { branchSetup: true },
    });
    if (
      !invite ||
      invite.revokedAt ||
      invite.expiresAt < new Date() ||
      !invite.branchSetup.enabled ||
      !invite.branchSetup.approvalRequired
    )
      throw new NotFoundException('Invitation is unavailable');
    return invite;
  }
  async inviteInfo(rawToken: string) {
    return this.scopeProfile((await this.findInvite(rawToken)).branchSetup);
  }

  async register(rawToken: string, dto: MobilePosRegistrationDto) {
    if (dto.name.trim().length < 2 || !['CASHIER', 'STOCKIST', 'ADMIN'].includes(dto.role))
      throw new BadRequestException('Enter a name and requested role');
    const invite = await this.findInvite(rawToken);
    const setup = invite.branchSetup;
    const claimToken = token();
    const row = await this.prisma.mobilePosEnrollment.create({
      data: {
        branchSetupId: setup.id,
        companyId: setup.companyId,
        divisionId: setup.divisionId,
        branchId: setup.branchId,
        name: dto.name.trim(),
        requestedRole: dto.role,
        claimTokenHash: mobilePosHash(claimToken),
        claimExpiresAt: new Date(Date.now() + CLAIM_TTL_MS),
      },
    });
    return {
      enrollmentId: row.id,
      claimToken,
      status: row.status,
      ...(await this.scopeProfile(setup)),
    };
  }
  private async findClaim(claimToken: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(claimToken))
      throw new NotFoundException('Registration is unavailable');
    const hash = mobilePosHash(claimToken);
    const row = await this.prisma.mobilePosEnrollment.findFirst({
      where: {
        OR: [
          { claimTokenHash: hash, claimExpiresAt: { gt: new Date() } },
          { setupTokenHash: hash, setupExpiresAt: { gt: new Date() } },
        ],
      },
    });
    if (!row) throw new NotFoundException('Registration is unavailable');
    return row;
  }
  async enrollmentInfo(claimToken: string) {
    const row = await this.findClaim(claimToken);
    const resetRequired = mobilePosHashMatches(row.setupTokenHash, claimToken);
    return {
      enrollmentId: row.id,
      name: row.name,
      status: row.status,
      role: row.approvedRole ?? row.requestedRole,
      pinReady: !!row.pinHash && !resetRequired,
      resetRequired,
      ...(await this.scopeProfile(row)),
    };
  }
  private safe(row: MobilePosEnrollment) {
    return {
      id: row.id,
      name: row.name,
      requestedRole: row.requestedRole,
      approvedRole: row.approvedRole,
      status: row.status,
      companyId: row.companyId,
      divisionId: row.divisionId,
      branchId: row.branchId,
      terminalId: row.terminalId,
      userId: row.userId,
      approvedAt: row.approvedAt,
      rejectedReason: row.rejectedReason,
      credentialVersion: row.credentialVersion,
      createdAt: row.createdAt,
    };
  }
  async listEnrollments(actor: AuthUser, companyId?: string, branchId?: string) {
    const where = await this.companies.companyWhereFor(actor, companyId);
    const rows = await this.prisma.mobilePosEnrollment.findMany({
      where: { ...where, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const visible = [];
    for (const row of rows) {
      try {
        await this.assertManager(actor, row.companyId, row.divisionId, row.branchId);
        visible.push(this.safe(row));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return visible;
  }
  private async manageable(id: string, actor: AuthUser) {
    const row = await this.prisma.mobilePosEnrollment.findUnique({
      where: { id },
      include: { branchSetup: true },
    });
    if (!row) throw new NotFoundException('Registration not found');
    await this.assertManager(actor, row.companyId, row.divisionId, row.branchId);
    return row;
  }
  async approve(id: string, dto: MobilePosApproveDto, actor: AuthUser) {
    if (!['CASHIER', 'STOCKIST'].includes(dto.role))
      throw new ForbiddenException('PIN enrollment cannot grant administrator access');
    const current = await this.manageable(id, actor);
    if (current.status !== 'PENDING' || current.requestedRole === 'ADMIN') {
      throw new BadRequestException('Admin registration requires that administrator to sign in');
    }
    if (!current.branchSetup.enabled || !current.branchSetup.approvalRequired)
      throw new BadRequestException('Branch setup is disabled');
    const userId = randomUUID();
    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.mobilePosEnrollment.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedRole: dto.role,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Registration has already been decided');
      await tx.user.create({
        data: {
          id: userId,
          email: userId + '@pos.invalid',
          authKind: 'POS_PIN',
          passwordHash,
          fullName: current.name,
          companyId: current.companyId,
          companyAccess: {
            create: { companyId: current.companyId, accessLevel: 'READ', grantedById: actor.id },
          },
          divisionAccess: {
            create: { divisionId: current.divisionId, accessLevel: 'READ', grantedById: actor.id },
          },
          branchAccess: {
            create: { branchId: current.branchId, accessLevel: 'READ', grantedById: actor.id },
          },
        },
      });
      const mappings = current.branchSetup.paymentMappings as unknown as Array<{
        paymentMethod: 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER';
        cashAccountId: string;
        label?: string;
      }>;
      const terminal = await tx.mobilePosTerminal.create({
        data: {
          terminalCode: 'MPL-' + randomBytes(4).toString('hex').toUpperCase(),
          name: current.name,
          companyId: current.companyId,
          divisionId: current.divisionId,
          branchId: current.branchId,
          assignedUserId: userId,
          generalCustomerId: current.branchSetup.generalCustomerId,
          offlineCashEnabled: false,
          creditEnabled: false,
          uiVersion: 3,
          paymentMethods: { create: mappings },
        },
      });
      const row = await tx.mobilePosEnrollment.update({
        where: { id },
        data: { userId, terminalId: terminal.id },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_ENROLLMENT_APPROVED',
        entityType: 'MobilePosEnrollment',
        entityId: id,
        userId: actor.id,
        companyId: row.companyId,
        metadata: { approvedRole: dto.role, operatorId: userId },
      });
      return this.safe(row);
    });
  }
  async adminLink(id: string, claimToken: string, actor: AuthUser) {
    const row = await this.findClaim(claimToken);
    if (row.id !== id || row.requestedRole !== 'ADMIN' || row.status !== 'PENDING')
      throw new ForbiddenException('Admin registration does not match this claim');
    await this.assertManager(actor, row.companyId, row.divisionId, row.branchId);
    const existing = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!existing || existing.authKind === 'POS_PIN' || existing.status !== 'ACTIVE')
      throw new ForbiddenException('Sign in with your existing administrator account');
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.mobilePosEnrollment.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedRole: 'ADMIN',
          userId: actor.id,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Registration has already been decided');
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_ADMIN_LINKED',
        entityType: 'MobilePosEnrollment',
        entityId: id,
        userId: actor.id,
        companyId: row.companyId,
      });
      return this.safe(await tx.mobilePosEnrollment.findUniqueOrThrow({ where: { id } }));
    });
  }
  async reject(id: string, reason: string, actor: AuthUser) {
    const current = await this.manageable(id, actor);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.mobilePosEnrollment.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED', rejectedReason: reason.trim() },
      });
      if (changed.count !== 1) throw new ConflictException('Registration has already been decided');
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_ENROLLMENT_REJECTED',
        entityType: 'MobilePosEnrollment',
        entityId: id,
        userId: actor.id,
        companyId: current.companyId,
        metadata: { reason: reason.trim() },
      });
      return this.safe(await tx.mobilePosEnrollment.findUniqueOrThrow({ where: { id } }));
    });
  }

  async setup(dto: MobilePosSetupDto) {
    const row = await this.findClaim(dto.claimToken);
    if (mobilePosHashMatches(row.setupTokenHash, dto.claimToken)) {
      return this.resetPin({
        enrollmentId: row.id,
        resetToken: dto.claimToken,
        deviceSecret: dto.deviceSecret,
        pin: dto.pin,
      });
    }
    await this.assertUsable(row);
    if (row.pinHash) {
      return this.login({ enrollmentId: row.id, deviceSecret: dto.deviceSecret, pin: dto.pin });
    }
    const pinHash = await argon2.hash(dto.pin);
    const bound = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.mobilePosEnrollment.updateMany({
        where: {
          id: row.id,
          status: 'APPROVED',
          pinHash: null,
          claimExpiresAt: { gt: new Date() },
        },
        data: {
          pinHash,
          deviceSecretHash: mobilePosHash(dto.deviceSecret),
          failedPinAttempts: 0,
          lockedUntil: null,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Registration has already been claimed');
      await tx.mobilePosTerminal.update({
        where: { id: row.terminalId! },
        data: {
          deviceSecretHash: mobilePosHash(dto.deviceSecret),
          activatedAt: new Date(),
          lastSeenAt: new Date(),
          deviceName: row.name,
        },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_PIN_SETUP',
        entityType: 'MobilePosEnrollment',
        entityId: row.id,
        userId: row.userId!,
        companyId: row.companyId,
      });
      return tx.mobilePosEnrollment.findUniqueOrThrow({ where: { id: row.id } });
    });
    return { ...(await this.issue(bound)), ...(await this.profile(bound)) };
  }

  private async assertUsable(row: MobilePosEnrollment) {
    if (
      row.status !== 'APPROVED' ||
      !['CASHIER', 'STOCKIST'].includes(row.approvedRole ?? '') ||
      !row.userId ||
      !row.terminalId
    )
      throw new UnauthorizedException('Device access is unavailable');
    const [setup, user, terminal] = await Promise.all([
      this.prisma.mobilePosBranchSetup.findUnique({ where: { id: row.branchSetupId } }),
      this.prisma.user.findUnique({ where: { id: row.userId } }),
      this.prisma.mobilePosTerminal.findUnique({ where: { id: row.terminalId } }),
    ]);
    if (
      !setup?.enabled ||
      !setup.approvalRequired ||
      !user ||
      user.status !== 'ACTIVE' ||
      !!user.deletedAt ||
      user.authKind !== 'POS_PIN' ||
      !terminal ||
      terminal.status !== 'ACTIVE' ||
      terminal.assignedUserId !== row.userId ||
      terminal.branchId !== row.branchId ||
      terminal.companyId !== row.companyId ||
      terminal.divisionId !== row.divisionId
    )
      throw new UnauthorizedException('Device access is unavailable');
  }

  async login(dto: MobilePosLoginDto) {
    const row = await this.prisma.mobilePosEnrollment.findUnique({
      where: { id: dto.enrollmentId },
    });
    if (
      !row ||
      !row.pinHash ||
      row.setupTokenHash ||
      !mobilePosHashMatches(row.deviceSecretHash, dto.deviceSecret)
    ) {
      await argon2.verify(await this.dummyPinHash, dto.pin);
      throw new UnauthorizedException('Invalid device or PIN');
    }
    await this.assertUsable(row);
    const authenticated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "mobile_pos_enrollments" WHERE "id" = ${row.id} FOR UPDATE`,
      );
      const current = await tx.mobilePosEnrollment.findUniqueOrThrow({ where: { id: row.id } });
      if (
        current.status !== 'APPROVED' ||
        current.credentialVersion !== row.credentialVersion ||
        current.pinHash !== row.pinHash ||
        current.setupTokenHash ||
        !mobilePosHashMatches(current.deviceSecretHash, dto.deviceSecret)
      )
        return null;
      if (current.lockedUntil && current.lockedUntil > new Date()) return null;
      const correct = await argon2.verify(current.pinHash!, dto.pin);
      if (!correct) {
        const count = current.lockedUntil ? 1 : current.failedPinAttempts + 1;
        await tx.mobilePosEnrollment.update({
          where: { id: current.id },
          data: {
            failedPinAttempts: count,
            lockedUntil: count >= 5 ? new Date(Date.now() + LOCK_TTL_MS) : null,
          },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MOBILE_POS_PIN_FAILED',
          entityType: 'MobilePosEnrollment',
          entityId: current.id,
          userId: current.userId!,
          companyId: current.companyId,
          metadata: { attempts: count },
        });
        return null;
      }
      return tx.mobilePosEnrollment.update({
        where: { id: current.id },
        data: { failedPinAttempts: 0, lockedUntil: null },
      });
    });
    if (!authenticated) throw new UnauthorizedException('Invalid device or PIN');
    return { ...(await this.issue(authenticated)), ...(await this.profile(authenticated)) };
  }

  private refreshHash(raw: string) {
    return createHmac(
      'sha256',
      this.config.get<string>('REFRESH_TOKEN_PEPPER') ??
        this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    )
      .update(raw)
      .digest('hex');
  }
  private async issue(row: MobilePosEnrollment, existingSid?: string, familyId?: string) {
    const session = existingSid
      ? null
      : await this.prisma.activeSession.create({
          data: {
            sessionCode: 'POS-' + randomUUID(),
            userId: row.userId!,
            companyId: row.companyId,
            deviceId: row.id,
            sessionType: 'POS',
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            lastActivityAt: new Date(),
          },
        });
    const payload: PosSessionClaims = {
      sub: row.userId!,
      email: row.userId! + '@pos.invalid',
      sid: existingSid ?? session!.id,
      tokenUse: 'mobile-pos',
      mobilePosEnrollmentId: row.id,
      mobilePosTerminalId: row.terminalId!,
      mobilePosCredentialVersion: row.credentialVersion,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: '15m',
    });
    const refreshToken = await this.jwt.signAsync(
      { ...payload, tokenUse: 'mobile-pos-refresh', jti: randomUUID() },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: '8h' },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: row.userId!,
        tokenHash: this.refreshHash(refreshToken),
        familyId: familyId ?? randomUUID(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  async refresh(rawToken: string, deviceSecret: string) {
    let claims: PosSessionClaims;
    try {
      claims = await this.jwt.verifyAsync<PosSessionClaims>(rawToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Device session has expired');
    }
    if (claims.tokenUse !== 'mobile-pos-refresh' || !claims.sid || !claims.mobilePosEnrollmentId)
      throw new UnauthorizedException('Device session has expired');
    const row = await this.prisma.mobilePosEnrollment.findUnique({
      where: { id: claims.mobilePosEnrollmentId },
    });
    if (
      !row ||
      row.userId !== claims.sub ||
      row.terminalId !== claims.mobilePosTerminalId ||
      row.credentialVersion !== claims.mobilePosCredentialVersion ||
      !mobilePosHashMatches(row.deviceSecretHash, deviceSecret)
    )
      throw new UnauthorizedException('Device session has expired');
    await this.assertUsable(row);
    const refresh = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.refreshHash(rawToken) },
    });
    const session = await this.prisma.activeSession.findUnique({ where: { id: claims.sid } });
    if (
      !refresh ||
      refresh.userId !== row.userId ||
      refresh.expiresAt < new Date() ||
      refresh.revokedAt ||
      !session ||
      session.userId !== row.userId ||
      session.deviceId !== row.id ||
      session.sessionType !== 'POS' ||
      session.status !== 'ACTIVE' ||
      !session.expiresAt ||
      session.expiresAt < new Date()
    )
      throw new UnauthorizedException('Device session has expired');
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: refresh.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ROTATION' },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('Device session has expired');
    return {
      ...(await this.issue(row, session.id, refresh.familyId ?? undefined)),
      ...(await this.profile(row)),
    };
  }

  async me(user: AuthUser) {
    if (!user.mobilePosEnrollmentId || user.tokenUse !== 'mobile-pos')
      throw new UnauthorizedException('Device session required');
    const row = await this.prisma.mobilePosEnrollment.findUniqueOrThrow({
      where: { id: user.mobilePosEnrollmentId },
    });
    await this.assertUsable(row);
    return this.profile(row);
  }
  async logout(user: AuthUser) {
    if (user.tokenUse !== 'mobile-pos' || !user.sid || !user.mobilePosEnrollmentId)
      throw new UnauthorizedException('Device session required');
    await this.prisma.$transaction(async (tx) => {
      await tx.activeSession.updateMany({
        where: { id: user.sid, userId: user.id, sessionType: 'POS' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'LOGOUT' },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
    });
    return { message: 'Signed out' };
  }
  async issueReset(id: string, actor: AuthUser) {
    const row = await this.manageable(id, actor);
    if (row.status !== 'APPROVED' || row.approvedRole === 'ADMIN' || !row.pinHash)
      throw new BadRequestException('An approved PIN device is required');
    const resetToken = token();
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await this.prisma.$transaction(async (tx) => {
      await tx.mobilePosEnrollment.update({
        where: { id },
        data: {
          setupTokenHash: mobilePosHash(resetToken),
          setupExpiresAt: expiresAt,
          credentialVersion: { increment: 1 },
        },
      });
      await tx.activeSession.updateMany({
        where: { userId: row.userId!, deviceId: row.id, sessionType: 'POS', status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'PIN_RESET' },
      });
      await tx.refreshToken.updateMany({
        where: { userId: row.userId!, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PIN_RESET' },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_PIN_RESET_ISSUED',
        entityType: 'MobilePosEnrollment',
        entityId: id,
        userId: actor.id,
        companyId: row.companyId,
      });
    });
    return { enrollmentId: id, resetToken, expiresAt: expiresAt.toISOString() };
  }
  async resetPin(dto: MobilePosResetDto) {
    const row = await this.prisma.mobilePosEnrollment.findUnique({
      where: { id: dto.enrollmentId },
    });
    if (
      !row ||
      !mobilePosHashMatches(row.deviceSecretHash, dto.deviceSecret) ||
      !mobilePosHashMatches(row.setupTokenHash, dto.resetToken) ||
      !row.setupExpiresAt ||
      row.setupExpiresAt < new Date()
    )
      throw new UnauthorizedException('Reset is unavailable');
    await this.assertUsable(row);
    const pinHash = await argon2.hash(dto.pin);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.mobilePosEnrollment.updateMany({
        where: {
          id: row.id,
          status: 'APPROVED',
          credentialVersion: row.credentialVersion,
          deviceSecretHash: row.deviceSecretHash,
          setupTokenHash: row.setupTokenHash,
          setupExpiresAt: { gt: new Date() },
        },
        data: {
          pinHash,
          failedPinAttempts: 0,
          lockedUntil: null,
          setupTokenHash: null,
          setupExpiresAt: null,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Reset has already been used');
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_PIN_RESET_COMPLETED',
        entityType: 'MobilePosEnrollment',
        entityId: row.id,
        userId: row.userId!,
        companyId: row.companyId,
      });
    });
    return this.login(dto);
  }
  async revoke(id: string, reason: string, actor: AuthUser) {
    const row = await this.manageable(id, actor);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mobilePosEnrollment.update({
        where: { id },
        data: {
          status: 'REVOKED',
          deviceSecretHash: null,
          setupTokenHash: null,
          setupExpiresAt: null,
          credentialVersion: { increment: 1 },
          rejectedReason: reason,
        },
      });
      if (row.terminalId)
        await tx.mobilePosTerminal.update({
          where: { id: row.terminalId },
          data: { status: 'REVOKED', deviceSecretHash: null },
        });
      if (row.userId && row.approvedRole !== 'ADMIN') {
        await tx.activeSession.updateMany({
          where: { userId: row.userId, sessionType: 'POS' },
          data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'DEVICE_REVOKED' },
        });
        await tx.refreshToken.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'DEVICE_REVOKED' },
        });
      }
      await this.audit.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_DEVICE_REVOKED',
        entityType: 'MobilePosEnrollment',
        entityId: id,
        userId: actor.id,
        companyId: row.companyId,
        metadata: { reason },
      });
      return this.safe(updated);
    });
  }

  private async scopeProfile(row: { companyId: string; divisionId: string; branchId: string }) {
    const [company, division, branch] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: row.companyId },
        select: { id: true, name: true },
      }),
      this.prisma.division.findUniqueOrThrow({
        where: { id: row.divisionId },
        select: { id: true, name: true },
      }),
      this.prisma.branch.findUniqueOrThrow({
        where: { id: row.branchId },
        select: { id: true, name: true },
      }),
    ]);
    return { company, division, branch };
  }
  private async profile(row: MobilePosEnrollment) {
    const role = row.approvedRole as MobilePosRole;
    const scope = await this.scopeProfile(row);
    const terminal = await this.prisma.mobilePosTerminal.findUniqueOrThrow({
      where: { id: row.terminalId! },
      select: { terminalCode: true },
    });
    const user: AuthUser = {
      id: row.userId!,
      email: '',
      fullName: row.name,
      roles: ['MOBILE_POS_' + role],
      roleScopes: ['BRANCH'],
      role: { scope: 'BRANCH' },
      permissions: mobilePosPermissions(role),
      companyId: row.companyId,
      companyAccess: [{ companyId: row.companyId, accessLevel: 'READ' }],
      divisionAccess: [{ divisionId: row.divisionId, accessLevel: 'READ' }],
      branchAccess: [{ branchId: row.branchId, accessLevel: 'READ' }],
      tokenUse: 'mobile-pos',
      mobilePosRole: role,
      mobilePosEnrollmentId: row.id,
      mobilePosTerminalId: row.terminalId!,
      mobilePosCredentialVersion: row.credentialVersion,
    };
    return {
      user,
      operator: { id: row.userId, name: row.name, role, credentialVersion: row.credentialVersion },
      enrollmentId: row.id,
      terminalCode: terminal.terminalCode,
      role,
      ...scope,
      capabilities: {
        captureSales: role === 'CASHIER',
        captureStock: role === 'STOCKIST',
        dispatchStock: role === 'STOCKIST',
        approve: false,
      },
    };
  }
}
