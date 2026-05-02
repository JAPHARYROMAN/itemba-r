import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateProjectMaterialIssueDto } from './dto/create-project-material-issue.dto';
import { UpdateProjectMaterialIssueDto } from './dto/update-project-material-issue.dto';
import { MaterialIssueStatus, InventoryMovementType } from '@prisma/client';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class ProjectMaterialIssuesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateProjectMaterialIssueDto, userId: string) {
    const issueNumber = await this.codes.next({ entityType: 'ProjectMaterialIssue', companyId: dto.companyId });
    const { lines, ...issueData } = dto;
    const issue = await this.prisma.projectMaterialIssue.create({
      data: {
        ...issueData,
        issueNumber,
        issueDate: new Date(issueData.issueDate),
        createdById: userId,
        lines: { create: lines.map(l => ({ ...l, totalCost: l.totalCost ?? (l.unitCost ? l.unitCost * l.quantity : undefined) })) },
      },
      include: { lines: true },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ProjectMaterialIssue', entityId: issue.id, newValue: dto as unknown as Record<string, unknown> });
    return issue;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.projectMaterialIssue.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { issueDate: 'desc' }, include: { project: { select: { projectName: true, projectCode: true } }, lines: true } }),
      this.prisma.projectMaterialIssue.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const issue = await this.prisma.projectMaterialIssue.findFirst({ where: { id, deletedAt: null }, include: { project: true, site: true, lines: { include: { product: { select: { name: true, sku: true } }, unit: { select: { symbol: true } } } } } });
    if (!issue) throw new NotFoundException('Material issue not found');
    return issue;
  }

  async submit(id: string, userId: string) {
    const issue = await this.findOne(id);
    if (issue.status !== MaterialIssueStatus.DRAFT) throw new BadRequestException('Only DRAFT issues can be submitted');
    const updated = await this.prisma.projectMaterialIssue.update({ where: { id }, data: { status: MaterialIssueStatus.SUBMITTED } });
    await this.audit.log({ userId, action: 'SUBMIT', entityType: 'ProjectMaterialIssue', entityId: id, newValue: {} });
    return updated;
  }

  async approve(id: string, userId: string) {
    const issue = await this.findOne(id);
    if (issue.status !== MaterialIssueStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED issues can be approved');
    const updated = await this.prisma.projectMaterialIssue.update({ where: { id }, data: { status: MaterialIssueStatus.APPROVED, approvedById: userId } });
    await this.audit.log({ userId, action: 'APPROVE', entityType: 'ProjectMaterialIssue', entityId: id, newValue: {} });
    return updated;
  }

  async post(id: string, userId: string) {
    const issue = await this.findOne(id);
    if (issue.status !== MaterialIssueStatus.APPROVED) throw new BadRequestException('Only APPROVED issues can be posted');

    let totalCost = 0;
    let journalEntryId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      for (const line of issue.lines) {
        // Resolve unit cost: use what's on the line if set, otherwise fall
        // back to the inventory's running average. This catches the common
        // case where the issuer didn't record cost — we still book a real
        // cost figure based on what the warehouse paid.
        const bal = await tx.inventoryBalance.findFirst({
          where: { productId: line.productId, inventoryLocationId: issue.inventoryLocationId },
        });
        const lineUnitCost = Number(line.unitCost ?? 0);
        const fallbackCost = bal ? Number(bal.averageCost) : 0;
        const resolvedUnitCost = lineUnitCost > 0 ? lineUnitCost : fallbackCost;
        const lineTotalCost = round2(resolvedUnitCost * Number(line.quantity));

        // Persist the resolved cost back to the line so the audit trail
        // shows what was actually booked (not the pre-resolution null).
        if (resolvedUnitCost > 0 && (lineUnitCost === 0 || Number(line.totalCost ?? 0) === 0)) {
          await tx.projectMaterialIssueLine.update({
            where: { id: line.id },
            data: { unitCost: resolvedUnitCost, totalCost: lineTotalCost },
          });
        }

        // Inventory movement — INTERNAL_USE (consumed by the project).
        const movementNumber = await this.codes.next({ entityType: 'InventoryMovement', companyId: issue.companyId, tx });
        await tx.inventoryMovement.create({
          data: {
            movementNumber,
            companyId: issue.companyId,
            divisionId: issue.divisionId,
            productId: line.productId,
            inventoryLocationId: issue.inventoryLocationId,
            movementType: InventoryMovementType.INTERNAL_USE,
            quantity: -Number(line.quantity),
            unitId: line.unitId,
            movementDate: issue.issueDate,
            referenceType: 'ProjectMaterialIssue',
            referenceId: id,
            notes: `Material issue: ${issue.issueNumber}`,
            createdById: userId,
          },
        });

        // Decrement inventory balance + total value (so averageCost stays sane).
        if (bal) {
          await tx.inventoryBalance.update({
            where: { id: bal.id },
            data: {
              quantityOnHand: { decrement: Number(line.quantity) },
              totalValue: { decrement: lineTotalCost },
            },
          });
        }

        totalCost += lineTotalCost;
      }

      // Update project actual cost so the dashboard P&L sees materials.
      await tx.constructionProject.update({
        where: { id: issue.projectId },
        data: { actualCost: { increment: totalCost } },
      });

      // ── GL posting (Sprint I2) ───────────────────────────────────────────
      // Dr Direct Project Materials Cost (5200)   totalCost
      //    Cr Inventory (1200)                     totalCost
      // Looks up both accounts on the company; soft-fails to a logged warning
      // if either is missing so the inventory move still completes.
      if (totalCost > 0) {
        const accounts = await tx.chartOfAccount.findMany({
          where: {
            companyId: issue.companyId,
            deletedAt: null,
            accountCode: { in: ['5200', '1200'] },
          },
          select: { id: true, accountCode: true },
        });
        const materialsExpenseId = accounts.find((a) => a.accountCode === '5200')?.id;
        const inventoryAssetId = accounts.find((a) => a.accountCode === '1200')?.id;
        if (materialsExpenseId && inventoryAssetId) {
          const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: issue.companyId, tx });
          const je = await tx.journalEntry.create({
            data: {
              journalNumber,
              companyId: issue.companyId,
              transactionDate: issue.issueDate,
              description: `Material issue ${issue.issueNumber} — ${issue.project.projectName}`,
              referenceType: 'ProjectMaterialIssue',
              referenceId: id,
              status: 'DRAFT',
              totalDebit: totalCost,
              totalCredit: totalCost,
              createdById: userId,
              lines: {
                create: [
                  {
                    accountId: materialsExpenseId,
                    description: `Materials issued to ${issue.project.projectName}`,
                    debit: totalCost,
                    credit: 0,
                    companyId: issue.companyId,
                  },
                  {
                    accountId: inventoryAssetId,
                    description: `Inventory consumed for project`,
                    debit: 0,
                    credit: totalCost,
                    companyId: issue.companyId,
                  },
                ],
              },
            },
          });
          journalEntryId = je.id;
        }
      }

      await tx.projectMaterialIssue.update({
        where: { id },
        data: { status: MaterialIssueStatus.POSTED, postedById: userId },
      });
    });

    await this.audit.log({
      userId,
      action: 'POST',
      entityType: 'ProjectMaterialIssue',
      entityId: id,
      newValue: { totalCost, journalEntryId } as unknown as Record<string, unknown>,
    });
    return this.findOne(id);
  }

  async reject(id: string, userId: string) {
    const issue = await this.findOne(id);
    if (!([MaterialIssueStatus.SUBMITTED, MaterialIssueStatus.APPROVED] as string[]).includes(issue.status)) throw new BadRequestException('Cannot reject in current state');
    const updated = await this.prisma.projectMaterialIssue.update({ where: { id }, data: { status: MaterialIssueStatus.REJECTED } });
    await this.audit.log({ userId, action: 'REJECT', entityType: 'ProjectMaterialIssue', entityId: id, newValue: {} });
    return updated;
  }

  async cancel(id: string, userId: string) {
    const issue = await this.findOne(id);
    if (issue.status === MaterialIssueStatus.POSTED) throw new BadRequestException('Cannot cancel a posted issue');
    const updated = await this.prisma.projectMaterialIssue.update({ where: { id }, data: { status: MaterialIssueStatus.CANCELLED } });
    await this.audit.log({ userId, action: 'CANCEL', entityType: 'ProjectMaterialIssue', entityId: id, newValue: {} });
    return updated;
  }

  async update(id: string, dto: UpdateProjectMaterialIssueDto, userId: string) {
    const issue = await this.findOne(id);
    if (issue.status !== MaterialIssueStatus.DRAFT) throw new BadRequestException('Only DRAFT issues can be updated');
    const updated = await this.prisma.projectMaterialIssue.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ProjectMaterialIssue', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return updated;
  }
}
