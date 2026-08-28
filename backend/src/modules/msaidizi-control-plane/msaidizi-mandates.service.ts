import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MsaidiziMandate, MsaidiziMandateStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateMsaidiziMandateDto,
  QueryMsaidiziMandatesDto,
  UpdateMsaidiziMandateDto,
} from './dto/msaidizi-control-plane.dto';
import { assertWritableCompany, controlPlaneCompanyScope } from './msaidizi-control-plane.scope';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import { PersistenceSecretGuard } from './persistence-secret-guard';

const EDITABLE_MANDATE_STATUSES = new Set<MsaidiziMandateStatus>([
  MsaidiziMandateStatus.DRAFT,
  MsaidiziMandateStatus.SUSPENDED,
]);

@Injectable()
export class MsaidiziMandatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly principals: MsaidiziPrincipalService,
    private readonly secrets: PersistenceSecretGuard,
    private readonly audit: AuditLogsService,
  ) {}

  async create(dto: CreateMsaidiziMandateDto, user: AuthUser) {
    const companyId = dto.companyId ?? user.companyId ?? null;
    assertWritableCompany(user, companyId);
    this.assertDates(dto.startsAt, dto.expiresAt);
    const principal = await this.principals.resolveGlobal(user);
    await this.assertDevices(principal.id, dto.deviceIds);

    const name = this.secrets.sanitizeText(dto.name.trim()).value;
    const description = this.secrets.sanitizeText(dto.description.trim()).value;
    const capabilities = this.sanitizeJson(dto.capabilities);
    const deviceIds = this.sanitizeJson(Array.from(new Set(dto.deviceIds)));
    const budgets = this.sanitizeJson(dto.budgets);
    const mandate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.msaidiziMandate.create({
        data: {
          principalId: principal.id,
          companyId,
          createdByUserId: user.id,
          name,
          description,
          capabilities,
          deviceIds,
          budgets,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      await tx.msaidiziMandateVersion.create({
        data: mandateVersionSnapshot(created, 'MSAIDIZI_MANDATE_CREATE', user.id),
      });
      return created;
    });
    await this.audit.log({
      action: 'MSAIDIZI_MANDATE_CREATE',
      entityType: 'MsaidiziMandate',
      entityId: mandate.id,
      userId: user.id,
      companyId: companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: principal.id,
      mandateId: mandate.id,
      newValue: auditMandate(mandate),
    });
    return mandate;
  }

  async list(query: QueryMsaidiziMandatesDto, user: AuthUser) {
    const principal = await this.principals.findGlobal();
    if (!principal) return { items: [], total: 0, page: query.page, limit: query.limit };
    const where: Prisma.MsaidiziMandateWhereInput = {
      principalId: principal.id,
      createdByUserId: user.id,
      ...controlPlaneCompanyScope(user, query.companyId),
      ...(query.status && { status: query.status }),
    };
    const [items, total] = await Promise.all([
      this.prisma.msaidiziMandate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.msaidiziMandate.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  findOne(id: string, user: AuthUser) {
    return this.findScoped(id, user);
  }

  async listVersions(id: string, user: AuthUser) {
    await this.findScoped(id, user);
    return this.prisma.msaidiziMandateVersion.findMany({
      where: { mandateId: id },
      orderBy: { version: 'desc' },
    });
  }

  async findVersion(id: string, version: number, user: AuthUser) {
    await this.findScoped(id, user);
    const snapshot = await this.prisma.msaidiziMandateVersion.findUnique({
      where: { mandateId_version: { mandateId: id, version } },
    });
    if (!snapshot) throw new NotFoundException('Msaidizi mandate version not found');
    return snapshot;
  }

  async update(id: string, dto: UpdateMsaidiziMandateDto, user: AuthUser) {
    const existing = await this.findScoped(id, user);
    assertWritableCompany(user, existing.companyId);
    if (!EDITABLE_MANDATE_STATUSES.has(existing.status)) {
      throw new ConflictException('Active, revoked, and expired mandates are immutable');
    }
    if (existing.version !== dto.expectedVersion) {
      throw new ConflictException('Mandate version changed; refresh and retry');
    }

    const startsAt = dto.startsAt === undefined ? existing.startsAt : toNullableDate(dto.startsAt);
    const expiresAt =
      dto.expiresAt === undefined ? existing.expiresAt : toNullableDate(dto.expiresAt);
    this.assertDateObjects(startsAt, expiresAt);
    if (dto.deviceIds) await this.assertDevices(existing.principalId, dto.deviceIds);

    const data: Prisma.MsaidiziMandateUpdateManyMutationInput = {
      version: { increment: 1 },
      ...(dto.name !== undefined && { name: this.secrets.sanitizeText(dto.name.trim()).value }),
      ...(dto.description !== undefined && {
        description: this.secrets.sanitizeText(dto.description.trim()).value,
      }),
      ...(dto.capabilities !== undefined && {
        capabilities: this.sanitizeJson(dto.capabilities),
      }),
      ...(dto.deviceIds !== undefined && {
        deviceIds: this.sanitizeJson(Array.from(new Set(dto.deviceIds))),
      }),
      ...(dto.budgets !== undefined && { budgets: this.sanitizeJson(dto.budgets) }),
      ...(dto.startsAt !== undefined && { startsAt }),
      ...(dto.expiresAt !== undefined && { expiresAt }),
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziMandate.updateMany({
        where: {
          id,
          principalId: existing.principalId,
          createdByUserId: user.id,
          status: existing.status,
          version: dto.expectedVersion,
        },
        data,
      });
      if (won.count !== 1) throw new ConflictException('Mandate changed; refresh and retry');
      const current = await tx.msaidiziMandate.findUnique({ where: { id } });
      if (!current) throw new ConflictException('Mandate changed; refresh and retry');
      await tx.msaidiziMandateVersion.create({
        data: mandateVersionSnapshot(current, 'MSAIDIZI_MANDATE_UPDATE', user.id),
      });
      return current;
    });
    await this.audit.log({
      action: 'MSAIDIZI_MANDATE_UPDATE',
      entityType: 'MsaidiziMandate',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: existing.principalId,
      mandateId: id,
      oldValue: auditMandate(existing),
      newValue: auditMandate(updated),
    });
    return updated;
  }

  activate(id: string, expectedVersion: number, user: AuthUser) {
    if (!this.principals.autopilotEnabled) {
      throw new ServiceUnavailableException('Msaidizi Autopilot is disabled by deployment policy');
    }
    return this.transition(
      id,
      expectedVersion,
      user,
      new Set([MsaidiziMandateStatus.DRAFT, MsaidiziMandateStatus.SUSPENDED]),
      MsaidiziMandateStatus.ACTIVE,
      'MSAIDIZI_MANDATE_ACTIVATE',
      { activatedAt: new Date(), revokedAt: null },
    );
  }

  suspend(id: string, expectedVersion: number, user: AuthUser) {
    return this.transition(
      id,
      expectedVersion,
      user,
      new Set([MsaidiziMandateStatus.ACTIVE]),
      MsaidiziMandateStatus.SUSPENDED,
      'MSAIDIZI_MANDATE_SUSPEND',
    );
  }

  revoke(id: string, expectedVersion: number, user: AuthUser) {
    return this.transition(
      id,
      expectedVersion,
      user,
      new Set([
        MsaidiziMandateStatus.DRAFT,
        MsaidiziMandateStatus.ACTIVE,
        MsaidiziMandateStatus.SUSPENDED,
        MsaidiziMandateStatus.EXPIRED,
      ]),
      MsaidiziMandateStatus.REVOKED,
      'MSAIDIZI_MANDATE_REVOKE',
      { revokedAt: new Date() },
    );
  }

  private async transition(
    id: string,
    expectedVersion: number,
    user: AuthUser,
    from: ReadonlySet<MsaidiziMandateStatus>,
    status: MsaidiziMandateStatus,
    action: string,
    extra: Prisma.MsaidiziMandateUpdateManyMutationInput = {},
  ) {
    const existing = await this.findScoped(id, user);
    assertWritableCompany(user, existing.companyId);
    if (existing.version !== expectedVersion) {
      throw new ConflictException('Mandate version changed; refresh and retry');
    }
    if (!from.has(existing.status)) {
      throw new ConflictException(`Mandate cannot transition from ${existing.status} to ${status}`);
    }
    if (status === MsaidiziMandateStatus.ACTIVE) {
      this.assertDateObjects(existing.startsAt, existing.expiresAt);
      if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('An expired mandate cannot be activated');
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziMandate.updateMany({
        where: {
          id,
          principalId: existing.principalId,
          createdByUserId: user.id,
          status: existing.status,
          version: expectedVersion,
        },
        data: { ...extra, status, version: { increment: 1 } },
      });
      if (won.count !== 1) throw new ConflictException('Mandate changed; refresh and retry');
      const current = await tx.msaidiziMandate.findUnique({ where: { id } });
      if (!current) throw new ConflictException('Mandate changed; refresh and retry');
      await tx.msaidiziMandateVersion.create({
        data: mandateVersionSnapshot(current, action, user.id),
      });
      return current;
    });
    await this.audit.log({
      action,
      entityType: 'MsaidiziMandate',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: existing.principalId,
      mandateId: id,
      oldValue: auditMandate(existing),
      newValue: auditMandate(updated),
    });
    return updated;
  }

  private async findScoped(id: string, user: AuthUser) {
    const principal = await this.principals.findGlobal();
    if (!principal) throw new NotFoundException('Msaidizi mandate not found');
    const mandate = await this.prisma.msaidiziMandate.findFirst({
      where: {
        id,
        principalId: principal.id,
        createdByUserId: user.id,
        ...controlPlaneCompanyScope(user),
      },
    });
    if (!mandate) throw new NotFoundException('Msaidizi mandate not found');
    return mandate;
  }

  private async assertDevices(principalId: string, deviceIds: string[]) {
    const unique = Array.from(new Set(deviceIds));
    if (unique.length === 0) return;
    const count = await this.prisma.msaidiziDevice.count({
      where: { id: { in: unique }, principalId, status: { in: ['ACTIVE', 'OFFLINE'] } },
    });
    if (count !== unique.length) {
      throw new BadRequestException('One or more mandate devices are unavailable');
    }
  }

  private assertDates(startsAt?: string, expiresAt?: string) {
    this.assertDateObjects(
      startsAt ? new Date(startsAt) : null,
      expiresAt ? new Date(expiresAt) : null,
    );
  }

  private assertDateObjects(startsAt: Date | null, expiresAt: Date | null) {
    if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('expiresAt must be later than startsAt');
    }
  }

  private sanitizeJson(value: unknown): Prisma.InputJsonValue {
    return this.secrets.sanitizeJson(value).value as Prisma.InputJsonValue;
  }
}

function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function auditMandate(mandate: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...mandate };
  delete safe.principalId;
  delete safe.createdByUserId;
  return safe;
}

function mandateVersionSnapshot(
  mandate: MsaidiziMandate,
  changeType: string,
  changedByUserId: string,
): Prisma.MsaidiziMandateVersionUncheckedCreateInput {
  return {
    mandateId: mandate.id,
    version: mandate.version,
    changeType,
    changedByUserId,
    principalId: mandate.principalId,
    companyId: mandate.companyId,
    createdByUserId: mandate.createdByUserId,
    name: mandate.name,
    description: mandate.description,
    status: mandate.status,
    capabilities: mandate.capabilities as Prisma.InputJsonValue,
    deviceIds: mandate.deviceIds as Prisma.InputJsonValue,
    budgets: mandate.budgets as Prisma.InputJsonValue,
    startsAt: mandate.startsAt,
    expiresAt: mandate.expiresAt,
    activatedAt: mandate.activatedAt,
    revokedAt: mandate.revokedAt,
    sourceCreatedAt: mandate.createdAt,
    sourceUpdatedAt: mandate.updatedAt,
  };
}
