import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { MsaidiziTrustLevel, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EncryptionService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateMsaidiziMemoryDto,
  MsaidiziMemorySourceType,
  QueryMsaidiziMemoriesDto,
  UpdateMsaidiziMemoryDto,
} from './dto/msaidizi-control-plane.dto';
import { assertWritableCompany, controlPlaneCompanyScope } from './msaidizi-control-plane.scope';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import { PersistenceSecretGuard } from './persistence-secret-guard';

const MEMORY_SELECT = {
  id: true,
  principalId: true,
  companyId: true,
  sourceTaskId: true,
  createdByUserId: true,
  kind: true,
  scopeKey: true,
  contentCiphertext: true,
  contentDigest: true,
  metadata: true,
  trustLevel: true,
  sourceProvenance: true,
  expiresAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MsaidiziMemorySelect;

type StoredMemory = Prisma.MsaidiziMemoryGetPayload<{ select: typeof MEMORY_SELECT }>;

@Injectable()
export class MsaidiziMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly principals: MsaidiziPrincipalService,
    private readonly encryption: EncryptionService,
    private readonly secrets: PersistenceSecretGuard,
    private readonly audit: AuditLogsService,
  ) {}

  async create(dto: CreateMsaidiziMemoryDto, user: AuthUser) {
    const companyId = dto.companyId ?? user.companyId ?? null;
    assertWritableCompany(user, companyId);
    this.assertExpiry(dto.expiresAt);
    const principal = await this.principals.resolveGlobal(user);

    const content = this.secrets.sanitizeText(dto.content);
    const scopeKey = this.secrets.sanitizeText(dto.scopeKey.trim());
    const metadata = this.secrets.sanitizeJson(dto.metadata);
    const sourceProvenance = this.secrets.sanitizeJson({
      sourceType: MsaidiziMemorySourceType.USER,
      sourceId: user.id,
      capturedAt: new Date().toISOString(),
      transformations: ['server-stamped-public-memory'],
      authorityVerified: false,
    });
    const memory = await this.prisma.msaidiziMemory.create({
      data: {
        principalId: principal.id,
        companyId,
        sourceTaskId: null,
        createdByUserId: user.id,
        kind: dto.kind,
        scopeKey: scopeKey.value,
        contentCiphertext: this.encryption.encrypt(content.value),
        contentDigest: digest(content.value),
        metadata: metadata.value as Prisma.InputJsonValue,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
        sourceProvenance: sourceProvenance.value as Prisma.InputJsonValue,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      select: MEMORY_SELECT,
    });
    const redactionsApplied =
      content.redactionsApplied ||
      scopeKey.redactionsApplied ||
      metadata.redactionsApplied ||
      sourceProvenance.redactionsApplied;
    await this.writeAudit('MSAIDIZI_MEMORY_CREATE', memory, user, redactionsApplied);
    return this.present(memory, content.value, redactionsApplied);
  }

  async list(query: QueryMsaidiziMemoriesDto, user: AuthUser) {
    const principal = await this.principals.findGlobal();
    if (!principal) return { items: [], total: 0, page: query.page, limit: query.limit };
    const where: Prisma.MsaidiziMemoryWhereInput = {
      principalId: principal.id,
      createdByUserId: user.id,
      deletedAt: null,
      ...(query.kind && { kind: query.kind }),
      ...(query.scopeKey && { scopeKey: query.scopeKey }),
      ...(query.trustLevel && { trustLevel: query.trustLevel }),
      AND: [
        controlPlaneCompanyScope(user, query.companyId),
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    };
    const listSelect = { ...MEMORY_SELECT, contentCiphertext: false } as const;
    const [items, total] = await Promise.all([
      this.prisma.msaidiziMemory.findMany({
        where,
        select: listSelect,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.msaidiziMemory.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async findOne(id: string, user: AuthUser) {
    const memory = await this.findStored(id, user);
    return this.present(memory, this.decrypt(memory));
  }

  async update(id: string, dto: UpdateMsaidiziMemoryDto, user: AuthUser) {
    const existing = await this.findStored(id, user);
    assertWritableCompany(user, existing.companyId);
    if (existing.sourceTaskId) {
      throw new BadRequestException(
        'Runtime-authored memory is immutable; delete it and create an untrusted user memory instead',
      );
    }
    if (dto.expiresAt !== undefined) this.assertExpiry(dto.expiresAt ?? undefined);

    const content = dto.content === undefined ? undefined : this.secrets.sanitizeText(dto.content);
    const scopeKey =
      dto.scopeKey === undefined ? undefined : this.secrets.sanitizeText(dto.scopeKey.trim());
    const metadata =
      dto.metadata === undefined ? undefined : this.secrets.sanitizeJson(dto.metadata);
    const data: Prisma.MsaidiziMemoryUpdateManyMutationInput = {
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(scopeKey && { scopeKey: scopeKey.value }),
      ...(content && {
        contentCiphertext: this.encryption.encrypt(content.value),
        contentDigest: digest(content.value),
      }),
      ...(metadata && { metadata: metadata.value as Prisma.InputJsonValue }),
      ...(dto.expiresAt !== undefined && {
        expiresAt: dto.expiresAt === null ? null : new Date(dto.expiresAt),
      }),
    };
    const won = await this.prisma.msaidiziMemory.updateMany({
      where: {
        id,
        principalId: existing.principalId,
        createdByUserId: user.id,
        deletedAt: null,
        updatedAt: existing.updatedAt,
      },
      data,
    });
    if (won.count !== 1) throw new ConflictException('Memory changed; refresh and retry');
    const updated = await this.findStored(id, user);
    const redactionsApplied = Boolean(
      content?.redactionsApplied || scopeKey?.redactionsApplied || metadata?.redactionsApplied,
    );
    await this.writeAudit('MSAIDIZI_MEMORY_UPDATE', updated, user, redactionsApplied);
    return this.present(updated, content?.value ?? this.decrypt(updated), redactionsApplied);
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findStored(id, user);
    assertWritableCompany(user, existing.companyId);
    const won = await this.prisma.msaidiziMemory.updateMany({
      where: {
        id,
        principalId: existing.principalId,
        createdByUserId: user.id,
        deletedAt: null,
        updatedAt: existing.updatedAt,
      },
      data: { deletedAt: new Date() },
    });
    if (won.count !== 1) throw new ConflictException('Memory changed; refresh and retry');
    await this.writeAudit('MSAIDIZI_MEMORY_DELETE', existing, user, false);
    return { id, deleted: true };
  }

  private async findStored(id: string, user: AuthUser): Promise<StoredMemory> {
    const principal = await this.principals.findGlobal();
    if (!principal) throw new NotFoundException('Msaidizi memory not found');
    const memory = await this.prisma.msaidiziMemory.findFirst({
      where: {
        id,
        principalId: principal.id,
        createdByUserId: user.id,
        deletedAt: null,
        AND: [
          controlPlaneCompanyScope(user),
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
      select: MEMORY_SELECT,
    });
    if (!memory) throw new NotFoundException('Msaidizi memory not found');
    return memory;
  }

  private assertExpiry(expiresAt?: string) {
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
  }

  private decrypt(memory: StoredMemory): string {
    try {
      return this.encryption.decrypt(memory.contentCiphertext);
    } catch {
      throw new InternalServerErrorException(
        'Stored Msaidizi memory failed integrity verification',
      );
    }
  }

  private present(memory: StoredMemory, content: string, redactionsApplied = false) {
    const safe: Partial<StoredMemory> = { ...memory };
    delete safe.contentCiphertext;
    delete safe.principalId;
    delete safe.createdByUserId;
    delete safe.deletedAt;
    return { ...safe, content, redactionsApplied };
  }

  private async writeAudit(
    action: string,
    memory: StoredMemory,
    user: AuthUser,
    redactionsApplied: boolean,
  ) {
    await this.audit.log({
      action,
      entityType: 'MsaidiziMemory',
      entityId: memory.id,
      userId: user.id,
      companyId: memory.companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: memory.principalId,
      taskId: memory.sourceTaskId ?? undefined,
      metadata: {
        kind: memory.kind,
        scopeKey: memory.scopeKey,
        trustLevel: memory.trustLevel,
        contentDigest: memory.contentDigest,
        redactionsApplied,
      },
    });
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
