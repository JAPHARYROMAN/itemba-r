import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { CreateProjectBillingDto } from './dto/create-project-billing.dto';
import { UpdateProjectBillingDto } from './dto/update-project-billing.dto';
import { ProjectBillingStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

const CONSTRUCTION_PRODUCT_CODE = 'CONST-SVC';
const CONSTRUCTION_CATEGORY_NAME = 'Construction Services';
const SERVICE_UNIT_SYMBOL = 'svc';

// Allowed over-billing margin above the contract value to accommodate
// legitimate variation orders before a billing is hard-blocked. Configurable
// via PROJECT_BILLING_OVERBILL_TOLERANCE_PCT (percent of contract value).
const DEFAULT_OVERBILL_TOLERANCE_PCT = 10;

@Injectable()
export class ProjectBillingService {
  private readonly logger = new Logger(ProjectBillingService.name);
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private salesOrders: SalesOrdersService,
  ) {}

  private async nextNumber(companyId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.projectBilling.count({ where: { companyId } });
    return `PBIL-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateProjectBillingDto, userId: string) {
    const billingNumber = await this.nextNumber(dto.companyId);
    const billing = await this.prisma.projectBilling.create({
      data: { ...dto, billingNumber, billingDate: new Date(dto.billingDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ProjectBilling', entityId: billing.id, newValue: dto as unknown as Record<string, unknown> });
    return billing;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.projectBilling.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { billingDate: 'desc' }, include: { project: { select: { projectName: true, projectCode: true } } } }),
      this.prisma.projectBilling.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const b = await this.prisma.projectBilling.findFirst({
      where: { id, deletedAt: null },
      include: {
        project: true,
        customer: { select: { id: true, name: true } },
        salesOrder: { select: { id: true, salesOrderNumber: true, status: true, paymentStatus: true } },
        receivable: { select: { id: true, receivableNumber: true, outstandingAmount: true, status: true, dueDate: true } },
      },
    });
    if (!b) throw new NotFoundException('Project billing not found');
    return b;
  }

  async send(id: string, userId: string) {
    const b = await this.findOne(id);
    if (b.status !== ProjectBillingStatus.DRAFT) throw new BadRequestException('Only DRAFT billings can be sent');

    // Cap cumulative billing against the contract value (plus a variation-order
    // tolerance) so a project cannot be billed arbitrarily beyond contract.
    // Only enforced when a positive contractValue is recorded, so projects with
    // no contract value set are unaffected.
    const contractValue = Number(b.project.contractValue ?? 0);
    if (contractValue > 0) {
      const tolerancePct = Number(
        process.env.PROJECT_BILLING_OVERBILL_TOLERANCE_PCT ?? DEFAULT_OVERBILL_TOLERANCE_PCT,
      );
      const tolerance = Number.isFinite(tolerancePct)
        ? tolerancePct
        : DEFAULT_OVERBILL_TOLERANCE_PCT;
      const cap = contractValue * (1 + tolerance / 100);
      const alreadyBilled = Number(b.project.billedAmount ?? 0);
      const projected = alreadyBilled + Number(b.amount);
      if (projected > cap) {
        throw new BadRequestException(
          `Billing would exceed the project contract value (${contractValue}) plus the ${tolerance}% variation tolerance. ` +
            `Already billed ${alreadyBilled}, this billing ${Number(b.amount)} would total ${projected} (cap ${cap}).`,
        );
      }
    }

    const updated = await this.prisma.projectBilling.update({ where: { id }, data: { status: ProjectBillingStatus.SENT } });
    // Update project billed amount
    await this.prisma.constructionProject.update({ where: { id: b.projectId }, data: { billedAmount: { increment: Number(b.amount) } } });
    await this.audit.log({ userId, action: 'SEND', entityType: 'ProjectBilling', entityId: id, newValue: {} });
    return updated;
  }

  async approve(id: string, user: import('../../common/decorators/current-user.decorator').AuthUser) {
    const userId = user.id;
    const b = await this.findOne(id);
    if (b.status !== ProjectBillingStatus.SENT) throw new BadRequestException('Only SENT billings can be approved');

    // ── Revenue closure (Sprint I1) ───────────────────────────────────────
    // On approval, create a CREDIT-method SalesOrder for the customer (project
    // contracts always invoice → pay later). Confirming the SalesOrder
    // automatically opens a Receivable. Both are linked back to the billing.
    // Idempotent: if a SalesOrder is already linked, skip.
    let salesOrderId = b.salesOrderId ?? null;
    let receivableId = b.receivableId ?? null;
    if (!salesOrderId) {
      // Resolve the customer to bill: prefer billing.customerId,
      // fall back to the project's customer.
      const customerId = b.customerId ?? b.project.customerId ?? null;
      if (!customerId) {
        throw new BadRequestException(
          'Cannot approve billing: no customer set on the billing or its project. Add a customer to the project first.',
        );
      }
      try {
        const product = await this.ensureConstructionServiceProduct(b.companyId);
        const created = await this.salesOrders.create(
          {
            companyId: b.companyId,
            divisionId: b.divisionId,
            customerId,
            salesType: 'SERVICE' as any,
            orderDate: new Date().toISOString(),
            currency: b.currency as any,
            paymentMethod: 'CREDIT' as any,
            notes: `Project billing ${b.billingNumber} — ${b.project.projectName}`,
            lines: [
              {
                productId: product.id,
                description: b.description,
                quantity: 1,
                unitId: product.baseUnitId,
                unitPrice: Number(b.amount),
                discountAmount: 0,
                taxAmount: 0,
              },
            ],
            createdById: userId,
          } as any,
          user,
        );
        const confirmed = await this.salesOrders.confirm(created.id, user);
        salesOrderId = confirmed.id;
        receivableId = confirmed.receivableId ?? null;
      } catch (err) {
        // Soft-fail: log but still flip status to APPROVED. Operator can
        // retry via a re-approval endpoint or open the SalesOrder manually.
        this.logger.warn(
          `Auto-revenue creation failed for billing ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const updated = await this.prisma.projectBilling.update({
      where: { id },
      data: {
        status: ProjectBillingStatus.APPROVED,
        approvedById: userId,
        ...(salesOrderId ? { salesOrderId } : {}),
        ...(receivableId ? { receivableId } : {}),
      },
    });
    await this.audit.log({
      userId,
      action: 'APPROVE',
      entityType: 'ProjectBilling',
      entityId: id,
      newValue: { salesOrderId, receivableId } as unknown as Record<string, unknown>,
    });
    return updated;
  }

  /**
   * Lazily ensure a per-company "Construction Service" Product exists. Same
   * pattern as W5.5's hospitality service product — uses the system-wide
   * Service unit so no per-company seed needed. Idempotent.
   */
  private async ensureConstructionServiceProduct(companyId: string) {
    const existing = await this.prisma.product.findFirst({
      where: { companyId, productCode: CONSTRUCTION_PRODUCT_CODE, deletedAt: null },
      select: { id: true, baseUnitId: true },
    });
    if (existing) return existing;

    let category = await this.prisma.productCategory.findFirst({
      where: { companyId, name: CONSTRUCTION_CATEGORY_NAME, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      const created = await this.prisma.productCategory.create({
        data: {
          companyId,
          name: CONSTRUCTION_CATEGORY_NAME,
          categoryType: 'SERVICE',
          description: 'Auto-created for project billing settlements.',
        },
      });
      category = { id: created.id };
    }

    const unit = await this.prisma.unitOfMeasure.findFirst({
      where: { symbol: SERVICE_UNIT_SYMBOL, isSystemUnit: true },
      select: { id: true },
    });
    if (!unit) {
      throw new BadRequestException('System "Service" unit (svc) is missing — re-run the seed.');
    }

    const product = await this.prisma.product.create({
      data: {
        companyId,
        productCode: CONSTRUCTION_PRODUCT_CODE,
        categoryId: category.id,
        name: 'Construction Service',
        description: 'Generic non-inventory service line for project billing settlements.',
        productType: 'SERVICE',
        baseUnitId: unit.id,
        trackInventory: false,
        trackBatch: false,
        trackExpiry: false,
        isTaxable: false,
        status: 'ACTIVE',
      },
      select: { id: true, baseUnitId: true },
    });
    return product;
  }

  async markPaid(id: string, userId: string) {
    const b = await this.findOne(id);
    if (!([ProjectBillingStatus.APPROVED, ProjectBillingStatus.PARTIALLY_PAID] as string[]).includes(b.status)) throw new BadRequestException('Only APPROVED or PARTIALLY_PAID billings can be marked paid');
    const updated = await this.prisma.projectBilling.update({ where: { id }, data: { status: ProjectBillingStatus.PAID } });
    await this.prisma.constructionProject.update({ where: { id: b.projectId }, data: { receivedAmount: { increment: Number(b.amount) } } });
    await this.audit.log({ userId, action: 'MARK_PAID', entityType: 'ProjectBilling', entityId: id, newValue: {} });
    return updated;
  }

  async cancel(id: string, userId: string) {
    const b = await this.findOne(id);
    if (b.status === ProjectBillingStatus.PAID) throw new BadRequestException('Cannot cancel a paid billing');
    const updated = await this.prisma.projectBilling.update({ where: { id }, data: { status: ProjectBillingStatus.CANCELLED } });
    await this.audit.log({ userId, action: 'CANCEL', entityType: 'ProjectBilling', entityId: id, newValue: {} });
    return updated;
  }

  async update(id: string, dto: UpdateProjectBillingDto, userId: string) {
    const b = await this.findOne(id);
    if (b.status !== ProjectBillingStatus.DRAFT) throw new BadRequestException('Only DRAFT billings can be updated');
    const updated = await this.prisma.projectBilling.update({ where: { id }, data: { ...dto, billingDate: dto.billingDate ? new Date(dto.billingDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ProjectBilling', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return updated;
  }
}
