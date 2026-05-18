import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAuditEvidencePackDto } from './dto/create-audit-evidence-pack.dto';
import { UpdateAuditEvidencePackDto } from './dto/update-audit-evidence-pack.dto';
import { CreateAuditEvidencePackItemDto } from './dto/create-audit-evidence-pack-item.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class AuditEvidencePacksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, packType, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (packType) where.packType = packType;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.auditEvidencePack.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.auditEvidencePack.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.auditEvidencePack.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Audit evidence pack not found');
    return record;
  }

  async create(dto: CreateAuditEvidencePackDto, user: any) {
    const record = await this.prisma.auditEvidencePack.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'AuditEvidencePack', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateAuditEvidencePackDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.auditEvidencePack.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AuditEvidencePack', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async review(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.auditEvidencePack.update({ where: { id }, data: { status: 'REVIEWED' as any, reviewedById: user.id, reviewedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AuditEvidencePack', entityId: id, newValue: { status: 'REVIEWED' } });
    return record;
  }

  async markReady(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.auditEvidencePack.update({ where: { id }, data: { status: 'READY' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AuditEvidencePack', entityId: id, newValue: { status: 'READY' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.auditEvidencePack.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'AuditEvidencePack', entityId: id, newValue: {} });
    return { message: 'Audit evidence pack deleted' };
  }

  async addItem(packId: string, dto: CreateAuditEvidencePackItemDto, user: any) {
    await this.findOne(packId, user);
    const item = await this.prisma.auditEvidencePackItem.create({ data: { ...dto, evidencePackId: packId } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'AuditEvidencePackItem', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async listItems(packId: string, user: any) {
    await this.findOne(packId, user);
    return this.prisma.auditEvidencePackItem.findMany({ where: { evidencePackId: packId }, orderBy: { createdAt: 'asc' } });
  }

  async removeItem(packId: string, itemId: string, user: any) {
    await this.findOne(packId, user);
    const item = await this.prisma.auditEvidencePackItem.findFirst({ where: { id: itemId, evidencePackId: packId } });
    if (!item) throw new NotFoundException('Audit evidence pack item not found');
    await this.prisma.auditEvidencePackItem.delete({ where: { id: itemId } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'AuditEvidencePackItem', entityId: itemId, newValue: {} });
    return { message: 'Audit evidence pack item deleted' };
  }

  /**
   * Phase 4 — auto-link evidence: given a FinancialStatementRun, attach every
   * POSTED journal entry inside the run's period as an AuditEvidencePackItem.
   * This turns a manually-curated evidence pack into a reproducible artifact
   * tied to a specific statement run.
   *
   * Idempotency: items with matching `linkedEntityType='JournalEntry'` and
   * `linkedEntityId` are skipped, so the action can be retried safely.
   */
  async autoLinkStatementRun(packId: string, statementRunId: string, user: any) {
    const pack = await this.findOne(packId, user);

    const run = await this.prisma.financialStatementRun.findFirst({
      where: { id: statementRunId },
    });
    if (!run) {
      throw new NotFoundException('Financial statement run not found');
    }
    if (run.companyId && run.companyId !== pack.companyId) {
      throw new NotFoundException(
        'Statement run belongs to a different company than the evidence pack',
      );
    }

    // Pull every posted JE inside the run's period for the pack's company.
    const jes = await this.prisma.journalEntry.findMany({
      where: {
        companyId: pack.companyId,
        status: 'POSTED',
        deletedAt: null,
        transactionDate: { gte: run.periodStart, lte: run.periodEnd },
      },
      select: { id: true, journalNumber: true, transactionDate: true, description: true },
      orderBy: { transactionDate: 'asc' },
    });

    // De-dupe against existing items in the pack.
    const existingLinks = await this.prisma.auditEvidencePackItem.findMany({
      where: { evidencePackId: packId, linkedEntityType: 'JournalEntry' },
      select: { linkedEntityId: true },
    });
    const linked = new Set(existingLinks.map((l) => l.linkedEntityId));

    const toCreate = jes.filter((je) => !linked.has(je.id));
    if (toCreate.length === 0) {
      return { packId, statementRunId, linkedCount: 0, skipped: jes.length };
    }

    await this.prisma.auditEvidencePackItem.createMany({
      data: toCreate.map((je) => ({
        evidencePackId: packId,
        itemType: 'TRANSACTION' as any,
        linkedEntityType: 'JournalEntry',
        linkedEntityId: je.id,
        title: `${je.journalNumber} — ${je.description ?? 'JE'}`,
        notes: `Auto-linked from FinancialStatementRun ${run.statementRunNumber}`,
      })),
    });

    await this.audit.log({
      userId: user.id,
      action: 'AUTO_LINK_EVIDENCE',
      entityType: 'AuditEvidencePack',
      entityId: packId,
      newValue: {
        statementRunId,
        statementRunNumber: run.statementRunNumber,
        linkedCount: toCreate.length,
        skipped: jes.length - toCreate.length,
      },
    });

    return {
      packId,
      statementRunId,
      statementRunNumber: run.statementRunNumber,
      linkedCount: toCreate.length,
      skipped: jes.length - toCreate.length,
    };
  }
}
