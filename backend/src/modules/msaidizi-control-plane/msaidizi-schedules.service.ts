import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateMsaidiziScheduleDto,
  QueryMsaidiziSchedulesDto,
  UpdateMsaidiziScheduleDto,
} from './dto/msaidizi-control-plane.dto';
import {
  assertSupportedCronExpression,
  nextCronOccurrence,
  UnsupportedMsaidiziCronError,
} from './msaidizi-cron';
import { controlPlaneCompanyScope, assertWritableCompany } from './msaidizi-control-plane.scope';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import {
  assertTemplateWithinMandate,
  MsaidiziScheduleTemplateError,
  validateScheduleTaskTemplate,
} from './msaidizi-schedule-template';
import { PersistenceSecretGuard } from './persistence-secret-guard';
import { msaidiziScheduleVersionSnapshot } from './msaidizi-version-history';

const EDITABLE_SCHEDULE_STATUSES = new Set<MsaidiziScheduleStatus>([
  MsaidiziScheduleStatus.DRAFT,
  MsaidiziScheduleStatus.PAUSED,
]);

const SCHEDULE_INCLUDE = {
  mandate: {
    select: {
      id: true,
      companyId: true,
      status: true,
      version: true,
      startsAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.MsaidiziScheduleInclude;

type ScheduleDetail = Prisma.MsaidiziScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

type LockedMandateAuthority = {
  id: string;
  principalId: string;
  status: MsaidiziMandateStatus;
  version: number;
  capabilities: Prisma.JsonValue;
  startsAt: Date | null;
  expiresAt: Date | null;
};

@Injectable()
export class MsaidiziSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mandates: MsaidiziMandatesService,
    private readonly principals: MsaidiziPrincipalService,
    private readonly secrets: PersistenceSecretGuard,
    private readonly audit: AuditLogsService,
  ) {}

  async create(dto: CreateMsaidiziScheduleDto, user: AuthUser) {
    this.assertTimezone(dto.timezone);
    const cronExpression = this.normaliseCron(dto.cronExpression);
    const mandate = await this.mandates.findOne(dto.mandateId, user);
    assertWritableCompany(user, mandate.companyId);
    if (
      mandate.status === MsaidiziMandateStatus.REVOKED ||
      mandate.status === MsaidiziMandateStatus.EXPIRED
    ) {
      throw new ConflictException('Schedules cannot be attached to a terminal mandate');
    }
    this.assertTemplate(dto.taskTemplate, mandate.capabilities);
    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.msaidiziSchedule.create({
        data: {
          principalId: mandate.principalId,
          mandateId: mandate.id,
          createdByUserId: user.id,
          name: this.secrets.sanitizeText(dto.name.trim()).value,
          cronExpression,
          timezone: dto.timezone,
          taskTemplate: this.sanitizeJson(dto.taskTemplate),
          concurrencyMode: dto.concurrencyMode,
          nextRunAt: dto.nextRunAt ? new Date(dto.nextRunAt) : null,
        },
        include: SCHEDULE_INCLUDE,
      });
      await tx.msaidiziScheduleVersion.create({
        data: msaidiziScheduleVersionSnapshot(created, 'MSAIDIZI_SCHEDULE_CREATE', user.id),
      });
      return created;
    });
    await this.writeAudit('MSAIDIZI_SCHEDULE_CREATE', schedule, user, undefined, schedule);
    return schedule;
  }

  async list(query: QueryMsaidiziSchedulesDto, user: AuthUser) {
    const principal = await this.principals.findGlobal();
    if (!principal) return { items: [], total: 0, page: query.page, limit: query.limit };
    const where: Prisma.MsaidiziScheduleWhereInput = {
      principalId: principal.id,
      createdByUserId: user.id,
      ...(query.status && { status: query.status }),
      ...(query.mandateId && { mandateId: query.mandateId }),
      mandate: {
        createdByUserId: user.id,
        ...controlPlaneCompanyScope(user),
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.msaidiziSchedule.findMany({
        where,
        include: SCHEDULE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.msaidiziSchedule.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  findOne(id: string, user: AuthUser) {
    return this.findScoped(id, user);
  }

  async listVersions(id: string, user: AuthUser) {
    await this.findScoped(id, user);
    return this.prisma.msaidiziScheduleVersion.findMany({
      where: { scheduleId: id },
      orderBy: { version: 'desc' },
    });
  }

  async findVersion(id: string, version: number, user: AuthUser) {
    await this.findScoped(id, user);
    const snapshot = await this.prisma.msaidiziScheduleVersion.findUnique({
      where: { scheduleId_version: { scheduleId: id, version } },
    });
    if (!snapshot) throw new NotFoundException('Msaidizi schedule version not found');
    return snapshot;
  }

  async update(id: string, dto: UpdateMsaidiziScheduleDto, user: AuthUser) {
    const existing = await this.findScoped(id, user);
    assertWritableCompany(user, existing.mandate.companyId);
    if (!EDITABLE_SCHEDULE_STATUSES.has(existing.status)) {
      throw new ConflictException('Active and archived schedules are immutable');
    }
    const expectedVersion = dto.expectedVersion;
    if (existing.version !== expectedVersion) {
      throw new ConflictException('Schedule version changed; refresh and retry');
    }
    if (dto.timezone) this.assertTimezone(dto.timezone);
    const cronExpression =
      dto.cronExpression === undefined
        ? existing.cronExpression
        : this.normaliseCron(dto.cronExpression);
    const timezone = dto.timezone ?? existing.timezone;
    const taskTemplate = dto.taskTemplate ?? existing.taskTemplate;
    const mandatePolicy = await this.prisma.msaidiziMandate.findUnique({
      where: { id: existing.mandateId },
      select: { capabilities: true },
    });
    if (!mandatePolicy) throw new ConflictException('Schedule mandate no longer exists');
    this.assertTemplate(taskTemplate, mandatePolicy.capabilities);
    const cadenceChanged = dto.cronExpression !== undefined || dto.timezone !== undefined;
    const data: Prisma.MsaidiziScheduleUpdateManyMutationInput = {
      version: { increment: 1 },
      ...(dto.name !== undefined && { name: this.secrets.sanitizeText(dto.name.trim()).value }),
      ...(dto.cronExpression !== undefined && { cronExpression }),
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.taskTemplate !== undefined && {
        taskTemplate: this.sanitizeJson(dto.taskTemplate),
      }),
      ...(dto.concurrencyMode !== undefined && { concurrencyMode: dto.concurrencyMode }),
      ...(dto.nextRunAt !== undefined && {
        nextRunAt: dto.nextRunAt === null ? null : new Date(dto.nextRunAt),
      }),
      ...(dto.nextRunAt === undefined &&
        cadenceChanged && { nextRunAt: nextCronOccurrence(cronExpression, timezone, new Date()) }),
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziSchedule.updateMany({
        where: {
          id,
          principalId: existing.principalId,
          createdByUserId: user.id,
          status: existing.status,
          version: expectedVersion,
          updatedAt: existing.updatedAt,
        },
        data,
      });
      if (won.count !== 1) throw new ConflictException('Schedule changed; refresh and retry');
      const current = await tx.msaidiziSchedule.findUnique({
        where: { id },
        include: SCHEDULE_INCLUDE,
      });
      if (!current) throw new ConflictException('Schedule changed; refresh and retry');
      await tx.msaidiziScheduleVersion.create({
        data: msaidiziScheduleVersionSnapshot(current, 'MSAIDIZI_SCHEDULE_UPDATE', user.id),
      });
      return current;
    });
    await this.writeAudit('MSAIDIZI_SCHEDULE_UPDATE', updated, user, existing, updated);
    return updated;
  }

  activate(id: string, user: AuthUser, expectedVersion: number) {
    if (!this.principals.autopilotEnabled) {
      throw new ServiceUnavailableException('Msaidizi Autopilot is disabled by deployment policy');
    }
    return this.transition(
      id,
      user,
      new Set([MsaidiziScheduleStatus.DRAFT, MsaidiziScheduleStatus.PAUSED]),
      MsaidiziScheduleStatus.ACTIVE,
      'MSAIDIZI_SCHEDULE_ACTIVATE',
      expectedVersion,
    );
  }

  pause(id: string, user: AuthUser, expectedVersion: number) {
    return this.transition(
      id,
      user,
      new Set([MsaidiziScheduleStatus.ACTIVE]),
      MsaidiziScheduleStatus.PAUSED,
      'MSAIDIZI_SCHEDULE_PAUSE',
      expectedVersion,
    );
  }

  archive(id: string, user: AuthUser, expectedVersion: number) {
    return this.transition(
      id,
      user,
      new Set([
        MsaidiziScheduleStatus.DRAFT,
        MsaidiziScheduleStatus.ACTIVE,
        MsaidiziScheduleStatus.PAUSED,
      ]),
      MsaidiziScheduleStatus.ARCHIVED,
      'MSAIDIZI_SCHEDULE_ARCHIVE',
      expectedVersion,
    );
  }

  private async transition(
    id: string,
    user: AuthUser,
    from: ReadonlySet<MsaidiziScheduleStatus>,
    status: MsaidiziScheduleStatus,
    action: string,
    expectedVersion: number,
  ) {
    const existing = await this.findScoped(id, user);
    assertWritableCompany(user, existing.mandate.companyId);
    if (existing.version !== expectedVersion) {
      throw new ConflictException('Schedule version changed; refresh and retry');
    }
    if (!from.has(existing.status)) {
      throw new ConflictException(
        `Schedule cannot transition from ${existing.status} to ${status}`,
      );
    }
    if (status === MsaidiziScheduleStatus.ACTIVE) this.assertMandateActive(existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      let nextRunAt = existing.nextRunAt;
      let activationAuthority: LockedMandateAuthority | null = null;
      let activationAt: Date | null = null;
      if (status === MsaidiziScheduleStatus.ACTIVE) {
        activationAuthority = await this.lockActivationAuthority(tx, existing);
        activationAt = new Date();
        this.assertMandateAuthorityActive(activationAuthority, activationAt);
        this.assertTemplate(existing.taskTemplate, activationAuthority.capabilities);
        nextRunAt ??= nextCronOccurrence(existing.cronExpression, existing.timezone, activationAt);
      }
      const won = await tx.msaidiziSchedule.updateMany({
        where: {
          id,
          principalId: existing.principalId,
          createdByUserId: user.id,
          status: existing.status,
          version: expectedVersion,
          updatedAt: existing.updatedAt,
          ...(status === MsaidiziScheduleStatus.ACTIVE && {
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
            mandate: {
              is: {
                id: existing.mandateId,
                principalId: existing.principalId,
                status: MsaidiziMandateStatus.ACTIVE,
                version: activationAuthority!.version,
                OR: [{ startsAt: null }, { startsAt: { lte: activationAt! } }],
                AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: activationAt! } }] }],
              },
            },
          }),
        },
        data: {
          status,
          version: { increment: 1 },
          ...(status === MsaidiziScheduleStatus.ACTIVE && { nextRunAt }),
        },
      });
      if (won.count !== 1) throw new ConflictException('Schedule changed; refresh and retry');
      const current = await tx.msaidiziSchedule.findUnique({
        where: { id },
        include: SCHEDULE_INCLUDE,
      });
      if (!current) throw new ConflictException('Schedule changed; refresh and retry');
      await tx.msaidiziScheduleVersion.create({
        data: msaidiziScheduleVersionSnapshot(current, action, user.id),
      });
      return current;
    });
    await this.writeAudit(action, updated, user, existing, updated);
    return updated;
  }

  private async lockActivationAuthority(
    tx: Prisma.TransactionClient,
    schedule: ScheduleDetail,
  ): Promise<LockedMandateAuthority> {
    const principals = await tx.$queryRaw<Array<{ status: MsaidiziPrincipalStatus }>>(Prisma.sql`
      SELECT "status"
      FROM "msaidizi_principals"
      WHERE "id" = ${schedule.principalId}
      FOR UPDATE
    `);
    if (principals[0]?.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new ConflictException('Msaidizi Autopilot is disabled');
    }
    const mandates = await tx.$queryRaw<LockedMandateAuthority[]>(Prisma.sql`
      SELECT
        "id",
        "principalId",
        "status",
        "version",
        "capabilities",
        "startsAt",
        "expiresAt"
      FROM "msaidizi_mandates"
      WHERE "id" = ${schedule.mandateId}
      FOR UPDATE
    `);
    const mandate = mandates[0];
    if (!mandate || mandate.principalId !== schedule.principalId) {
      throw new ConflictException('Schedule mandate no longer exists');
    }
    return mandate;
  }

  private async findScoped(id: string, user: AuthUser): Promise<ScheduleDetail> {
    const principal = await this.principals.findGlobal();
    if (!principal) throw new NotFoundException('Msaidizi schedule not found');
    const schedule = await this.prisma.msaidiziSchedule.findFirst({
      where: {
        id,
        principalId: principal.id,
        createdByUserId: user.id,
        mandate: {
          createdByUserId: user.id,
          ...controlPlaneCompanyScope(user),
        },
      },
      include: SCHEDULE_INCLUDE,
    });
    if (!schedule) throw new NotFoundException('Msaidizi schedule not found');
    return schedule;
  }

  private assertMandateActive(schedule: ScheduleDetail) {
    const { mandate } = schedule;
    const now = Date.now();
    if (
      mandate.status !== MsaidiziMandateStatus.ACTIVE ||
      (mandate.startsAt && mandate.startsAt.getTime() > now) ||
      (mandate.expiresAt && mandate.expiresAt.getTime() <= now)
    ) {
      throw new ConflictException('Schedule mandate is not currently active');
    }
  }

  private assertMandateAuthorityActive(mandate: LockedMandateAuthority, now: Date) {
    if (
      mandate.status !== MsaidiziMandateStatus.ACTIVE ||
      (mandate.startsAt && mandate.startsAt.getTime() > now.getTime()) ||
      (mandate.expiresAt && mandate.expiresAt.getTime() <= now.getTime())
    ) {
      throw new ConflictException('Schedule mandate is not currently active');
    }
  }

  private assertTimezone(timezone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('timezone must be a valid IANA time zone');
    }
  }

  private normaliseCron(expression: string): string {
    const normalised = expression.trim().replace(/\s+/g, ' ');
    try {
      assertSupportedCronExpression(normalised);
    } catch (error) {
      if (error instanceof UnsupportedMsaidiziCronError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return normalised;
  }

  private assertTemplate(value: unknown, capabilities: Prisma.JsonValue): void {
    try {
      assertTemplateWithinMandate(validateScheduleTaskTemplate(value), capabilities);
    } catch (error) {
      if (error instanceof MsaidiziScheduleTemplateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private sanitizeJson(value: unknown): Prisma.InputJsonValue {
    return this.secrets.sanitizeJson(value).value as Prisma.InputJsonValue;
  }

  private async writeAudit(
    action: string,
    schedule: ScheduleDetail,
    user: AuthUser,
    oldValue?: ScheduleDetail,
    newValue?: ScheduleDetail,
  ) {
    await this.audit.log({
      action,
      entityType: 'MsaidiziSchedule',
      entityId: schedule.id,
      userId: user.id,
      companyId: schedule.mandate.companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: schedule.principalId,
      mandateId: schedule.mandateId,
      oldValue: oldValue ? auditSchedule(oldValue) : undefined,
      newValue: newValue ? auditSchedule(newValue) : undefined,
    });
  }
}

function auditSchedule(schedule: ScheduleDetail): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...schedule };
  delete safe.principalId;
  delete safe.createdByUserId;
  delete safe.mandate;
  return safe;
}
