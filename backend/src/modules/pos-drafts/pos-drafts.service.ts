import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessLevel,
  CurrencyCode,
  PaymentMethodGeneral,
  PosDraft,
  Prisma,
  SalesPaymentMethod,
  SalesType,
  StockDamageType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { releaseExpiredPosReservations } from '../../common/services/pos-draft-reservations';
import {
  lockPosDuplicateIdentity,
  lockPosSalePosting,
} from '../../common/services/pos-sale-duplicates';
import {
  AccountResolverService,
  AccountingControlService,
  CompanyScopeService,
  OrganizationScopeService,
} from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { CustomerPaymentsService } from '../customer-payments/customer-payments.service';
import { StockAdjustmentsService } from '../stock-adjustments/stock-adjustments.service';
import { StockDamageService } from '../stock-damage/stock-damage.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import {
  MobilePosLiteService,
  effectiveSellingPrice,
} from '../mobile-pos-lite/mobile-pos-lite.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import {
  ApprovePosDraftDto,
  ConfirmReturnPosDraftDto,
  CorrectPosDraftDto,
  PosDraftRevisionDto,
  RejectPosDraftDto,
  SubmitPosDraftDto,
} from './pos-drafts.dto';
import {
  DAMAGE_TYPES,
  decimal,
  digest,
  DraftRole,
  eatDay,
  FINAL_STATUSES,
  identifier,
  JsonRecord,
  object,
  PRICE_REASONS,
  RECEIPT_METHODS,
  saleSignature,
} from './pos-drafts.types';

type Db = Prisma.TransactionClient;
type DraftScope = { companyId: string; divisionId: string; branchId: string; terminalId?: string };

@Injectable()
export class PosDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly organizationScope: OrganizationScopeService,
    private readonly audit: AuditLogsService,
    private readonly sales: SalesOrdersService,
    private readonly purchases: PurchaseOrdersService,
    private readonly collections: CustomerPaymentsService,
    private readonly counts: StockAdjustmentsService,
    private readonly damage: StockDamageService,
    private readonly movements: InventoryMovementsService,
    private readonly mobile: MobilePosLiteService,
    private readonly posting: PostingEngineService,
    private readonly accounts: AccountResolverService,
    private readonly accountingControl: AccountingControlService = new AccountingControlService(
      prisma,
    ),
  ) {}

  private has(user: AuthUser, permission: string) {
    return user.permissions.includes(permission);
  }
  private assertPermission(user: AuthUser, permission: string) {
    if (!this.has(user, permission))
      throw new ForbiddenException(`Missing permission: ${permission}`);
  }
  private async roleFor(user: AuthUser, branchId?: string): Promise<DraftRole> {
    if (user.mobilePosRole) return user.mobilePosRole;
    const enrollment = await this.prisma.mobilePosEnrollment.findFirst({
      where: {
        userId: user.id,
        ...(branchId ? { branchId } : {}),
        approvedRole: { in: ['CASHIER', 'STOCKIST'] },
        branchSetup: { approvalRequired: true },
      },
      select: { approvedRole: true },
    });
    if (enrollment) return enrollment.approvedRole as DraftRole;
    if (!this.has(user, 'mobile_pos_lite.manage')) {
      const terminals = await this.prisma.mobilePosTerminal.findMany({
        where: { assignedUserId: user.id, ...(branchId ? { branchId } : {}) },
        select: { branchId: true },
      });
      if (
        terminals.length &&
        (await this.prisma.mobilePosBranchSetup.findFirst({
          where: {
            branchId: { in: terminals.map((terminal) => terminal.branchId) },
            approvalRequired: true,
          },
          select: { id: true },
        }))
      )
        return 'CASHIER';
    }
    return 'ADMIN';
  }
  private async branchWhere(user: AuthUser): Promise<Prisma.BranchWhereInput> {
    const scope = await this.organizationScope.accessibleIds(user);
    return scope.unrestricted
      ? {}
      : { OR: [{ id: { in: scope.branchIds } }, { divisionId: { in: scope.divisionIds } }] };
  }
  async scopes(user: AuthUser) {
    if (
      !this.has(user, 'pos_drafts.view') &&
      !this.has(user, 'mobile_pos_lite.manage') &&
      !this.has(user, 'mobile_pos_onboarding.manage')
    )
      throw new ForbiddenException('POS Draft access is required');
    const companyIds = await this.companyScope.accessibleCompanyIds(user);
    const bound = user.tokenUse === 'mobile-pos' ? await this.scope({}, user) : null;
    const [companies, branches] = await Promise.all([
      this.prisma.company.findMany({
        where: {
          id: { in: bound ? [bound.companyId] : companyIds },
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.findMany({
        where: {
          ...(bound ? { id: bound.branchId } : await this.branchWhere(user)),
          isActive: true,
          deletedAt: null,
          division: {
            companyId: { in: bound ? [bound.companyId] : companyIds },
            isActive: true,
            deletedAt: null,
            company: { status: 'ACTIVE', deletedAt: null },
          },
        },
        select: {
          id: true,
          name: true,
          divisionId: true,
          division: { select: { id: true, name: true, companyId: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      companies,
      divisions: [...new Map(branches.map((b) => [b.division.id, b.division])).values()],
      branches: branches.map(({ division, ...branch }) => ({
        ...branch,
        companyId: division.companyId,
      })),
    };
  }
  private async eligiblePurchaseOrders(scope: DraftScope) {
    const [orders, grns, movements] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'CONFIRMED',
          deletedAt: null,
        },
        select: {
          id: true,
          purchaseOrderNumber: true,
          supplierId: true,
          supplierName: true,
          status: true,
          totalAmount: true,
          currency: true,
          purchaseType: true,
          supplier: { select: { paymentTerms: true, name: true } },
          lines: {
            select: {
              productId: true,
              quantity: true,
              unitCost: true,
              lineTotal: true,
              product: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.goodsReceivedNote.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'POSTED',
          deletedAt: null,
        },
        select: { purchaseOrderId: true },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          referenceType: 'PurchaseOrder',
          movementType: 'PURCHASE_RECEIPT',
        },
        select: { referenceId: true },
      }),
    ]);
    const received = new Set([
      ...grns.map((g) => g.purchaseOrderId),
      ...movements.map((m) => m.referenceId),
    ]);
    return orders
      .filter((o) => !received.has(o.id))
      .map((o) => ({
        id: o.id,
        purchaseOrderNumber: o.purchaseOrderNumber,
        supplierId: o.supplierId,
        supplierName: o.supplierName ?? o.supplier?.name ?? '',
        status: o.status,
        totalAmount: Number(o.totalAmount),
        currency: o.currency,
        purchaseType: o.purchaseType,
        paymentTerms: o.supplier?.paymentTerms ?? null,
        lines: o.lines.map((l) => ({
          productId: l.productId,
          name: l.product.name,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          lineTotal: Number(l.lineTotal),
        })),
      }));
  }
  private capabilities(user: AuthUser, role: DraftRole) {
    return {
      canSubmitSale: this.has(user, 'pos_drafts.create'),
      canSubmitStock: role !== 'CASHIER' && this.has(user, 'pos_drafts.create'),
      canApprove:
        role === 'ADMIN' && user.tokenUse !== 'mobile-pos' && this.has(user, 'pos_drafts.approve'),
      canPrepare: role !== 'CASHIER' && this.has(user, 'pos_drafts.dispatch'),
      canDirectPost:
        role === 'ADMIN' &&
        user.tokenUse !== 'mobile-pos' &&
        this.has(user, 'pos_drafts.direct_post'),
    };
  }
  private async scope(
    input: { companyId?: string; branchId?: string; divisionId?: string },
    user: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ): Promise<DraftScope> {
    const enrollment =
      user.tokenUse === 'mobile-pos'
        ? await this.prisma.mobilePosEnrollment.findFirst({
            where: {
              id: user.mobilePosEnrollmentId,
              userId: user.id,
              status: 'APPROVED',
              credentialVersion: user.mobilePosCredentialVersion,
              terminalId: user.mobilePosTerminalId,
              branchSetup: { enabled: true },
            },
          })
        : null;
    if (user.tokenUse === 'mobile-pos' && !enrollment)
      throw new ForbiddenException('This POS enrollment is no longer active');
    const companyId = input.companyId || enrollment?.companyId;
    const branchId = input.branchId || enrollment?.branchId;
    if (!companyId || !branchId) throw new BadRequestException('Select a company and branch');
    if (enrollment && (companyId !== enrollment.companyId || branchId !== enrollment.branchId))
      throw new ForbiddenException('This POS account is bound to another branch');
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        isActive: true,
        deletedAt: null,
        division: { companyId, isActive: true, deletedAt: null },
      },
      select: { divisionId: true },
    });
    if (!branch || (input.divisionId && input.divisionId !== branch.divisionId))
      throw new BadRequestException('Invalid branch scope');
    await this.companyScope.assertCanAccessCompany(user, companyId, minimum);
    await this.organizationScope.assertCanAccessScope(user, branch.divisionId, branchId, minimum);
    return {
      companyId,
      divisionId: branch.divisionId,
      branchId,
      ...(enrollment?.terminalId ? { terminalId: enrollment.terminalId } : {}),
    };
  }
  private async where(
    user: AuthUser,
    query: Record<string, string> = {},
  ): Promise<Prisma.PosDraftWhereInput> {
    const company = await this.companyScope.companyWhereFor(user, query.companyId);
    const org = await this.organizationScope.recordWhereFor(user);
    const role = await this.roleFor(user, query.branchId);
    const filters: Prisma.PosDraftWhereInput[] = [
      company as Prisma.PosDraftWhereInput,
      org as Prisma.PosDraftWhereInput,
    ];
    if (query.branchId) {
      await this.scope(query, user);
      filters.push({ branchId: query.branchId });
    }
    if (user.tokenUse === 'mobile-pos') {
      const bound = await this.scope({}, user);
      filters.push({ companyId: bound.companyId, branchId: bound.branchId });
    }
    if (role === 'CASHIER') filters.push({ originUserId: user.id });
    else if (role === 'STOCKIST') {
      const links = await this.prisma.posDraft.findMany({
        where: { originUserId: user.id, originRole: 'STOCKIST', kind: 'SALE' },
        select: { payload: true },
      });
      const linkedIds = links
        .map((d) => object(d.payload)._continuesDraftId)
        .filter((id): id is string => typeof id === 'string');
      filters.push({
        OR: [
          { originUserId: user.id },
          { status: { in: ['AWAITING_STOCKIST', 'READY_FINAL'] }, originRole: 'CASHIER' },
          { decisions: { some: { actorUserId: user.id, action: 'PREPARE' } } },
          ...(linkedIds.length ? [{ id: { in: linkedIds } }] : []),
        ],
      });
    } else if (query.originUserId) filters.push({ originUserId: query.originUserId });
    if (query.view === 'pending')
      filters.push({
        OR: [
          { status: { notIn: ['POSTED', 'REJECTED'] } },
          { status: 'REJECTED', pendingMoney: { gt: 0 } },
        ],
      });
    if (query.attentionRejected === 'true')
      filters.push({ status: 'REJECTED', pendingMoney: { gt: 0 } });
    if (query.view === 'sales') filters.push({ kind: { in: ['SALE', 'COLLECTION'] } });
    if (query.view === 'stock')
      filters.push({ kind: { in: ['RECEIPT', 'TRANSFER', 'COUNT', 'DAMAGE'] } });
    if (query.view === 'history') filters.push({ status: { in: ['POSTED', 'REJECTED'] } });
    if (query.kind) filters.push({ kind: query.kind });
    if (query.status) filters.push({ status: query.status });
    if (query.search?.trim()) {
      const companyIds = query.companyId
        ? [query.companyId]
        : await this.companyScope.accessibleCompanyIds(user);
      const pattern = `%${query.search
        .trim()
        .slice(0, 100)
        .replace(/[\\%_]/g, '\\$&')}%`;
      const matches = companyIds.length
        ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT d.id FROM pos_drafts d
          LEFT JOIN users u ON u.id = d."originUserId"
          LEFT JOIN sales_orders s ON s.id = CASE WHEN d."postedEntityType"='SalesOrder' THEN d."postedEntityId" ELSE d.payload->>'salesOrderId' END
          LEFT JOIN customers c ON c.id = COALESCE(d.payload->>'customerId', s."customerId")
          LEFT JOIN purchase_orders p ON p.id = CASE WHEN d."postedEntityType"='PurchaseOrder' THEN d."postedEntityId" ELSE d.payload->>'purchaseOrderId' END
          LEFT JOIN customer_payments cp ON cp.id = d."postedEntityId" AND d."postedEntityType"='CustomerPayment'
          LEFT JOIN stock_adjustments a ON a.id = d."postedEntityId" AND d."postedEntityType"='StockAdjustment'
          LEFT JOIN stock_damages dmg ON dmg.id = d."postedEntityId" AND d."postedEntityType"='StockDamage'
          WHERE d."companyId" IN (${Prisma.join(companyIds)})
          AND (d."requestId" ILIKE ${pattern} OR d.payload::text ILIKE ${pattern}
            OR u."fullName" ILIKE ${pattern} OR u.email ILIKE ${pattern}
            OR c.name ILIKE ${pattern} OR c."customerCode" ILIKE ${pattern} OR c.phone ILIKE ${pattern}
            OR s."salesOrderNumber" ILIKE ${pattern} OR p."purchaseOrderNumber" ILIKE ${pattern}
            OR p."supplierName" ILIKE ${pattern} OR cp."paymentNumber" ILIKE ${pattern}
            OR a."adjustmentNumber" ILIKE ${pattern} OR dmg."damageNumber" ILIKE ${pattern})`)
        : [];
      filters.push({ id: { in: matches.map((row) => row.id) } });
    }
    return { AND: filters };
  }
  async list(query: Record<string, string>, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.view');
    const where = await this.where(user, query);
    const page = Math.max(1, Number(query.page) || 1),
      limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const [data, total, groups] = await Promise.all([
      this.prisma.posDraft.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.posDraft.count({ where }),
      this.prisma.posDraft.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { pendingMoney: true },
      }),
    ]);
    const summary = { pendingMoney: 0, awaitingApproval: 0, awaitingStockist: 0, readyFinal: 0 };
    for (const g of groups) {
      summary.pendingMoney += Number(g._sum.pendingMoney ?? 0);
      if (g.status === 'SUBMITTED') summary.awaitingApproval += g._count;
      if (g.status === 'AWAITING_STOCKIST') summary.awaitingStockist += g._count;
      if (g.status === 'READY_FINAL') summary.readyFinal += g._count;
    }
    return {
      data: data.map((d) => this.present(d, user)),
      total,
      page,
      limit,
      capabilities: this.capabilities(user, await this.roleFor(user, query.branchId)),
      summary,
    };
  }
  private present(draft: PosDraft, user: AuthUser, extras: JsonRecord = {}) {
    const expired =
      ['AWAITING_STOCKIST', 'READY_FINAL'].includes(draft.status) &&
      draft.reservedUntil &&
      draft.reservedUntil.getTime() <= Date.now();
    if (expired)
      draft = {
        ...draft,
        status: 'NEEDS_ATTENTION',
        blockingReason: 'The 24 hour reservation expired. Approve and prepare stock again.',
      };
    const payload = Object.fromEntries(
      Object.entries(object(draft.payload)).filter(([key]) => !key.startsWith('_')),
    );
    const actions: string[] = [];
    if (
      ['SUBMITTED', 'NEEDS_ATTENTION', 'AWAITING_STOCKIST', 'READY_FINAL'].includes(draft.status) &&
      draft.originUserId === user.id &&
      !object(draft.payload)._continuesDraftId &&
      this.has(user, 'pos_drafts.create')
    )
      actions.push('correct');
    if (!user.mobilePosRole || user.mobilePosRole === 'ADMIN') {
      if (
        ['SUBMITTED', 'READY_FINAL', 'NEEDS_ATTENTION'].includes(draft.status) &&
        draft.originUserId !== user.id &&
        this.has(user, 'pos_drafts.approve') &&
        user.tokenUse !== 'mobile-pos'
      )
        actions.push('approve');
      if (
        !FINAL_STATUSES.includes(draft.status) &&
        this.has(user, 'pos_drafts.reject') &&
        user.tokenUse !== 'mobile-pos'
      )
        actions.push('reject');
      if (
        draft.status === 'REJECTED' &&
        draft.pendingMoney.gt(0) &&
        this.has(user, 'pos_drafts.approve') &&
        user.tokenUse !== 'mobile-pos'
      )
        actions.push('confirm-return');
      if (
        draft.originRole === 'ADMIN' &&
        draft.originUserId === user.id &&
        ['SUBMITTED', 'NEEDS_ATTENTION'].includes(draft.status) &&
        this.has(user, 'pos_drafts.direct_post') &&
        user.tokenUse !== 'mobile-pos'
      )
        actions.push('direct-post');
    }
    if (draft.status === 'AWAITING_STOCKIST' && this.has(user, 'pos_drafts.dispatch'))
      actions.push('prepare');
    return {
      ...draft,
      businessDate: draft.businessDate.toISOString().slice(0, 10),
      amount: Number(draft.amount),
      pendingMoney: Number(draft.pendingMoney),
      payload,
      allowedActions: actions,
      ...extras,
    };
  }
  private async visible(id: string, user: AuthUser) {
    const record = await this.prisma.posDraft.findFirst({
      where: { AND: [{ id }, await this.where(user)] },
      include: { decisions: { orderBy: { createdAt: 'asc' } }, reservations: true },
    });
    if (!record) throw new NotFoundException('POS Draft not found');
    return record;
  }
  async detail(id: string, user: AuthUser) {
    const draft = await this.visible(id, user);
    const role = await this.roleFor(user, draft.branchId);
    const [actors, company, branch] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [draft.originUserId, ...draft.decisions.map((d) => d.actorUserId)] } },
        select: { id: true, fullName: true },
      }),
      this.prisma.company.findUnique({ where: { id: draft.companyId }, select: { name: true } }),
      this.prisma.branch.findUnique({ where: { id: draft.branchId }, select: { name: true } }),
    ]);
    const actorsById = new Map(actors.map((a) => [a.id, a]));
    return this.present(draft, user, {
      originUser: actorsById.get(draft.originUserId),
      company,
      branch,
      decisions: draft.decisions.map((d) => ({
        ...d,
        actorId: d.actorUserId,
        actor: actorsById.get(d.actorUserId),
      })),
      duplicateCandidates:
        role === 'ADMIN'
          ? await this.reviewableCandidates(await this.candidates(this.prisma, draft), user)
          : [],
      capabilities: this.capabilities(user, role),
    });
  }
  async receipt(id: string, user: AuthUser) {
    const draft = await this.visible(id, user);
    if (
      draft.status !== 'POSTED' ||
      draft.kind !== 'SALE' ||
      draft.postedEntityType !== 'SalesOrder' ||
      !draft.postedEntityId
    )
      throw new BadRequestException('A final receipt is available only after the sale posts');
    const sale = await this.prisma.salesOrder.findFirst({
      where: { id: draft.postedEntityId, companyId: draft.companyId, deletedAt: null },
      include: {
        company: { select: { name: true } },
        branch: { select: { name: true } },
        lines: { include: { product: { select: { name: true } } } },
      },
    });
    if (!sale) throw new NotFoundException('Posted sale not found');
    const payload = object(draft.payload),
      snapshot = object(payload._sale);
    return {
      receiptNumber: sale.salesOrderNumber,
      companyName: sale.company.name,
      branchName: sale.branch?.name ?? '',
      businessDate: draft.businessDate.toISOString().slice(0, 10),
      customerName: sale.customerName ?? '',
      paymentMethod: sale.paymentMethod,
      subtotal: Number(sale.subtotal),
      taxAmount: Number(sale.taxAmount),
      totalAmount: Number(sale.totalAmount),
      paidAmount: Number(sale.paidAmount),
      outstandingAmount: Number(sale.outstandingAmount),
      payments: (
        snapshot.tenders ??
        (sale.paymentMethod === 'CREDIT'
          ? []
          : [
              {
                method: sale.paymentMethod,
                amount: Number(sale.totalAmount),
                reference: sale.paymentReference,
              },
            ])
      ).map((t: JsonRecord) => ({ method: t.method, amount: t.amount, reference: t.reference })),
      lines: sale.lines.map((l) => ({
        productId: l.productId,
        name: l.product.name,
        quantity: Number(l.quantity),
        unitPrice: Number(new Prisma.Decimal(l.lineTotal).div(l.quantity).toDecimalPlaces(2)),
        lineTotal: Number(l.lineTotal),
      })),
      originUserId: draft.originUserId,
      approvedByUserId: sale.confirmedById,
    };
  }
  async outcome(requestId: string, user: AuthUser) {
    const record = await this.prisma.posDraft.findFirst({
      where: { AND: [{ requestId }, await this.where(user)] },
    });
    if (!record) return { state: 'not_found' };
    const alias = object(record.payload)._continuesDraftId;
    const draft = alias ? await this.visible(alias, user) : record;
    return {
      state:
        draft.status === 'POSTED'
          ? 'posted'
          : draft.status === 'REJECTED'
            ? 'rejected'
            : draft.status === 'NEEDS_ATTENTION'
              ? 'needs_attention'
              : 'pending',
      draft: this.present(draft, user),
      postedEntityType: draft.postedEntityType,
      postedEntityId: draft.postedEntityId,
    };
  }
  async legacyTerminals(query: Record<string, string>, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.view');
    this.assertPermission(user, 'mobile_pos_lite.manage');
    if (user.tokenUse === 'mobile-pos') throw new ForbiddenException('Office access is required');
    const filters: Prisma.MobilePosTerminalWhereInput[] = [
      (await this.companyScope.companyWhereFor(
        user,
        query.companyId,
      )) as Prisma.MobilePosTerminalWhereInput,
      (await this.organizationScope.recordWhereFor(user)) as Prisma.MobilePosTerminalWhereInput,
    ];
    if (query.branchId) {
      const branchId = identifier(query.branchId, 'Branch');
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch) throw new NotFoundException('Branch not found');
      await this.companyScope.assertCanAccessCompany(user, branch.division.companyId);
      await this.organizationScope.assertCanAccessScope(user, branch.divisionId, branchId);
      if (query.companyId && query.companyId !== branch.division.companyId)
        throw new BadRequestException('Invalid branch scope');
      filters.push({ branchId });
    }
    // Reconciliation is a read of historical identities, independent of the
    // GROUP-only provisioning surface and a terminal's current operating state.
    const rows = await this.prisma.mobilePosTerminal.findMany({
      where: { AND: filters },
      select: { id: true, terminalCode: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ id, terminalCode, name }) => ({ id, code: terminalCode, name }));
  }
  async legacyOutcome(query: Record<string, string>, user: AuthUser) {
    this.assertPermission(user, 'mobile_pos_lite.manage');
    if (user.tokenUse === 'mobile-pos') throw new ForbiddenException('Office access is required');
    const terminal = await this.prisma.mobilePosTerminal.findUnique({
      where: { id: identifier(query.terminalId, 'Original terminal') },
    });
    if (!terminal) throw new NotFoundException('Original terminal not found');
    await this.scope(terminal, user);
    const requestId = identifier(query.requestId, 'Original request identity');
    const [sale, purchase, count] = await Promise.all([
      this.prisma.salesOrder.findFirst({
        where: {
          companyId: terminal.companyId,
          branchId: terminal.branchId,
          mobilePosTerminalId: terminal.id,
          idempotencyKey: requestId,
        },
        select: { id: true, status: true },
      }),
      this.prisma.purchaseOrder.findFirst({
        where: {
          companyId: terminal.companyId,
          branchId: terminal.branchId,
          OR: [
            { idempotencyKey: requestId },
            { notes: { contains: `[MPL-PURCHASE:${requestId}]` } },
          ],
        },
        select: { id: true, status: true },
      }),
      this.prisma.stockAdjustment.findFirst({
        where: {
          companyId: terminal.companyId,
          branchId: terminal.branchId,
          OR: [{ idempotencyKey: requestId }, { notes: { contains: `[MPL-COUNT:${requestId}]` } }],
        },
        select: { id: true, status: true },
      }),
    ]);
    const record = sale ?? purchase ?? count;
    if (!record)
      return {
        state: 'not_found',
        message:
          'No matching canonical record found; retain the original capture for office reconciliation.',
      };
    const posted = sale
      ? ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(sale.status)
      : purchase
        ? purchase.status === 'RECEIVED'
        : count?.status === 'POSTED';
    const attention = ['CANCELLED', 'REJECTED', 'VOIDED', 'PARTIALLY_RECEIVED'].includes(
      record.status,
    );
    return {
      state: posted ? 'posted' : attention ? 'needs_attention' : 'pending',
      postedEntityType: sale ? 'SalesOrder' : purchase ? 'PurchaseOrder' : 'StockAdjustment',
      postedEntityId: record.id,
      recordStatus: record.status,
    };
  }

  async context(query: Record<string, string>, user: AuthUser) {
    const scope = await this.scope(query, user);
    await this.prisma.$transaction((tx) => this.expire(tx, scope.companyId, scope.branchId), {
      timeout: 60000,
    });
    await this.finishExpiry(scope, user);
    const role = await this.roleFor(user, scope.branchId);
    const [products, customers, balances, orders, purchaseOrders, branches, accounts, terminal] =
      await Promise.all([
        this.prisma.product.findMany({
          where: {
            companyId: scope.companyId,
            status: 'ACTIVE',
            deletedAt: null,
            OR: [{ divisionId: scope.divisionId }, { divisionId: null }],
          },
          include: { baseUnit: true, productFamily: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.customer.findMany({
          where: {
            companyId: scope.companyId,
            status: 'ACTIVE',
            deletedAt: null,
            AND: [
              { OR: [{ divisionId: scope.divisionId }, { divisionId: null }] },
              { OR: [{ branchId: scope.branchId }, { branchId: null }] },
            ],
          },
          select: { id: true, name: true, customerCode: true, phone: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.inventoryBalance.findMany({
          where: { companyId: scope.companyId, branchId: scope.branchId },
        }),
        this.prisma.salesOrder.findMany({
          where: {
            companyId: scope.companyId,
            branchId: scope.branchId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
            outstandingAmount: { gt: 0 },
          },
          select: {
            id: true,
            salesOrderNumber: true,
            customerId: true,
            customerName: true,
            outstandingAmount: true,
          },
        }),
        role === 'CASHIER' ? Promise.resolve([]) : this.eligiblePurchaseOrders(scope),
        this.prisma.branch.findMany({
          where: {
            division: { companyId: scope.companyId, isActive: true },
            deletedAt: null,
            isActive: true,
            ...(role === 'STOCKIST' ? {} : await this.branchWhere(user)),
          },
          select: { id: true, name: true, divisionId: true },
        }),
        this.prisma.cashAccount.findMany({
          where: {
            companyId: scope.companyId,
            isActive: true,
            deletedAt: null,
            AND: [
              { OR: [{ divisionId: scope.divisionId }, { divisionId: null }] },
              { OR: [{ branchId: scope.branchId }, { branchId: null }] },
            ],
          },
          select: { id: true, accountName: true, accountType: true, currency: true },
        }),
        scope.terminalId
          ? this.prisma.mobilePosTerminal.findUnique({
              where: { id: scope.terminalId },
              include: { paymentMethods: true },
            })
          : Promise.resolve(null),
      ]);
    const balanceById = new Map(balances.map((b) => [b.productId, b]));
    const mappedIds = new Set(
      terminal?.paymentMethods.filter((p) => p.isEnabled).map((p) => p.cashAccountId),
    );
    return {
      scope,
      capabilities: this.capabilities(user, role),
      products: products.map((p) => {
        const balance = balanceById.get(p.id);
        return {
          id: p.id,
          name: p.name,
          code: p.productCode,
          barcode: p.barcode,
          unitId: p.baseUnitId,
          unitSymbol: p.baseUnit.symbol,
          sellingPrice: effectiveSellingPrice(p),
          quantityOnHand: Number(balance?.quantityOnHand ?? 0),
          quantityAvailable:
            Number(balance?.quantityOnHand ?? 0) - Number(balance?.quantityReserved ?? 0),
          physicalRevision: balance?.physicalRevision ?? 0,
          trackInventory: p.trackInventory,
        };
      }),
      customers,
      unpaidSales: orders.map((o) => ({ ...o, outstandingAmount: Number(o.outstandingAmount) })),
      purchaseOrders,
      branches,
      accounts: scope.terminalId ? accounts.filter((a) => mappedIds.has(a.id)) : accounts,
      paymentMethods:
        terminal?.paymentMethods.filter((p) => p.isEnabled).map((p) => p.paymentMethod) ??
        RECEIPT_METHODS,
      creditEnabled: terminal?.creditEnabled ?? true,
    };
  }
  async baseline(query: Record<string, string>, user: AuthUser) {
    const context = await this.context(query, user);
    return {
      ...context.scope,
      capturedAt: new Date().toISOString(),
      lines: context.products
        .filter((p) => p.trackInventory)
        .map((p) => ({
          productId: p.id,
          name: p.name,
          unitId: p.unitId,
          quantityOnHand: p.quantityOnHand,
          physicalRevision: p.physicalRevision,
        })),
    };
  }

  private async normalize(
    dto: SubmitPosDraftDto,
    user: AuthUser,
    scope: DraftScope,
    role: DraftRole,
    db: Db | PrismaService = this.prisma,
  ) {
    if (role === 'CASHIER' && !['SALE', 'COLLECTION'].includes(dto.kind))
      throw new ForbiddenException('Cashiers capture sales and collections');
    const capture = new Date(dto.capturedAt);
    if (
      !Number.isFinite(capture.getTime()) ||
      capture.getTime() > Date.now() + 300000 ||
      eatDay(capture) !== dto.businessDate
    )
      throw new BadRequestException('Business date must match the captured time in East Africa');
    const p = object(dto.payload);
    for (const field of ['paymentReference', 'reference']) {
      if (p[field] != null && (typeof p[field] !== 'string' || p[field].length > 200))
        throw new BadRequestException(`Invalid ${field}`);
    }
    const setup = await db.mobilePosBranchSetup.findUnique({ where: { branchId: scope.branchId } });
    const enrollment = await db.mobilePosEnrollment.findFirst({
      where: {
        userId: user.id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        status: 'APPROVED',
      },
    });
    const terminalId = scope.terminalId ?? enrollment?.terminalId ?? undefined;
    const terminal = terminalId
      ? await db.mobilePosTerminal.findUnique({
          where: { id: terminalId },
          include: { paymentMethods: true },
        })
      : null;
    if (
      role !== 'ADMIN' &&
      (!setup?.enabled ||
        !setup.approvalRequired ||
        !terminal ||
        terminal.status !== 'ACTIVE' ||
        terminal.assignedUserId !== user.id)
    )
      throw new ForbiddenException('An active approved POS branch and terminal are required');
    let payload: JsonRecord,
      amount = new Prisma.Decimal(0),
      pendingMoney = new Prisma.Decimal(0),
      signature: string;
    const getAccount = async (method: string, supplied?: unknown) => {
      const configured = terminal?.paymentMethods.find(
        (t) => t.isEnabled && t.paymentMethod === method,
      )?.cashAccountId;
      if (terminal && supplied && supplied !== configured)
        throw new ForbiddenException('The receipt account is fixed by branch configuration');
      const accountId = identifier(configured ?? supplied, 'Receipt account');
      const account = await db.cashAccount.findFirst({
        where: { id: accountId, companyId: scope.companyId, isActive: true, deletedAt: null },
      });
      const types: Record<string, string[]> = {
        CASH: ['CASH_ON_HAND', 'PETTY_CASH'],
        MOBILE_MONEY: ['MOBILE_MONEY'],
        BANK_TRANSFER: ['BANK'],
      };
      if (
        !account ||
        (account.divisionId && account.divisionId !== scope.divisionId) ||
        (account.branchId && account.branchId !== scope.branchId) ||
        account.currency !== 'TZS' ||
        !types[method]?.includes(account.accountType)
      )
        throw new BadRequestException('Invalid receipt account for this method and branch');
      return accountId;
    };
    const validateProducts = async (lines: JsonRecord[]) => {
      const ids = [...new Set(lines.map((l) => identifier(object(l).productId, 'Product')))];
      if (!ids.length || ids.length > 500)
        throw new BadRequestException('Choose between 1 and 500 products');
      const products = await db.product.findMany({
        where: {
          id: { in: ids },
          companyId: scope.companyId,
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ divisionId: scope.divisionId }, { divisionId: null }],
        },
        include: { productFamily: true },
      });
      if (products.length !== ids.length)
        throw new BadRequestException('One or more products are unavailable in this branch');
      return new Map(products.map((product) => [product.id, product]));
    };
    if (dto.kind === 'SALE') {
      object(p, [
        'customerId',
        'paymentMethod',
        'cashAccountId',
        'paymentReference',
        'expectedTotal',
        'lines',
        'payments',
      ]);
      const method = identifier(p.paymentMethod, 'Payment method');
      if (![...RECEIPT_METHODS, 'CREDIT', 'MIXED'].includes(method as any))
        throw new BadRequestException('Invalid sale payment method');
      if (!Array.isArray(p.lines)) throw new BadRequestException('Sale lines are required');
      const products = await validateProducts(p.lines);
      const byId = new Map<string, JsonRecord>(),
        overrides: JsonRecord[] = [],
        priceEdits: JsonRecord[] = [];
      for (const raw of p.lines) {
        const l = object(raw, ['productId', 'quantity', 'unitPrice', 'priceReason', 'priceNote']);
        const product = products.get(identifier(l.productId, 'Product'))!;
        if (l.priceReason != null && !PRICE_REASONS.includes(l.priceReason))
          throw new BadRequestException('Choose a valid price change reason');
        if (l.priceNote != null && (typeof l.priceNote !== 'string' || l.priceNote.length > 120))
          throw new BadRequestException('Invalid price change note');
        const quantity = decimal(l.quantity, 'Quantity', 4);
        const list = effectiveSellingPrice(product);
        if (list == null) throw new BadRequestException(`${product.name} has no selling price`);
        const price =
          l.unitPrice == null ? new Prisma.Decimal(list) : decimal(l.unitPrice, 'Unit price');
        if (!price.eq(list)) {
          if (!this.has(user, 'mobile_pos_lite.edit_price'))
            throw new ForbiddenException('You cannot change selling prices');
          if (!PRICE_REASONS.includes(l.priceReason))
            throw new BadRequestException('Choose a valid price change reason');
          const drop = new Prisma.Decimal(list).minus(price).div(list).times(100);
          if (
            !this.has(user, 'mobile_pos_lite.edit_price_unlimited') &&
            drop.gt(terminal?.maxPriceDropPct ?? 0)
          )
            throw new BadRequestException('The price is below the allowed selling price');
          priceEdits.push({
            productId: product.id,
            listUnitPrice: list,
            chargedUnitPrice: Number(price),
            reasonCode: l.priceReason,
          });
          if (terminal)
            overrides.push({
              companyId: scope.companyId,
              terminalId: terminal.id,
              productId: product.id,
              userId: user.id,
              listUnitPrice: list,
              chargedUnitPrice: Number(price),
              quantity: Number(quantity),
              reasonCode: l.priceReason,
              note: typeof l.priceNote === 'string' ? l.priceNote.trim().slice(0, 120) : null,
            });
        }
        const earlier = byId.get(product.id);
        if (earlier && earlier.unitPrice !== Number(price))
          throw new BadRequestException('Each product must have one selling price');
        byId.set(product.id, {
          productId: product.id,
          quantity: Number(quantity.plus(earlier?.quantity ?? 0)),
          unitPrice: Number(price),
          ...(l.priceReason ? { priceReason: l.priceReason } : {}),
          ...(l.priceNote ? { priceNote: l.priceNote } : {}),
        });
      }
      const lines = [...byId.values()].sort((a, b) => a.productId.localeCompare(b.productId));
      amount = lines
        .reduce((n, l) => n.plus(new Prisma.Decimal(l.quantity).times(l.unitPrice)), amount)
        .toDecimalPlaces(2);
      if (!decimal(p.expectedTotal, 'Expected total').eq(amount))
        throw new ConflictException('The sale total changed; review the canonical prices');
      const customerId = identifier(
        p.customerId ?? terminal?.generalCustomerId ?? setup?.generalCustomerId,
        'Customer',
      );
      const customer = await db.customer.findFirst({
        where: {
          id: customerId,
          companyId: scope.companyId,
          status: 'ACTIVE',
          deletedAt: null,
          AND: [
            { OR: [{ divisionId: scope.divisionId }, { divisionId: null }] },
            { OR: [{ branchId: scope.branchId }, { branchId: null }] },
          ],
        },
      });
      if (!customer) throw new BadRequestException('Customer is unavailable in this branch');
      if (method === 'CREDIT' && (!p.customerId || (terminal && !terminal.creditEnabled)))
        throw new BadRequestException('Credit requires a named customer and enabled credit');
      let tenders: JsonRecord[] | undefined;
      let cashAccountId: string | undefined;
      if (method === 'MIXED') {
        if (!Array.isArray(p.payments) || !p.payments.length || p.payments.length > 3)
          throw new BadRequestException('Split payment allocations are required');
        const seen = new Set<string>();
        tenders = [];
        for (const raw of p.payments) {
          const t = object(raw, ['method', 'amount', 'reference', 'cashAccountId']);
          if (!RECEIPT_METHODS.includes(t.method) || seen.has(t.method))
            throw new BadRequestException('Invalid split payment method');
          seen.add(t.method);
          if (t.method !== 'CASH' && (typeof t.reference !== 'string' || !t.reference.trim()))
            throw new BadRequestException('Non-cash payments require a reference');
          tenders.push({
            method: t.method,
            amount: Number(decimal(t.amount, 'Payment amount')),
            reference: typeof t.reference === 'string' ? t.reference.trim() : null,
            cashAccountId: await getAccount(t.method, t.cashAccountId ?? p.cashAccountId),
          });
        }
        if (!tenders.reduce((n, t) => n.plus(t.amount), new Prisma.Decimal(0)).eq(amount))
          throw new BadRequestException('Split payments must equal the full sale');
        cashAccountId = tenders[0].cashAccountId;
      } else {
        if (p.payments !== undefined)
          throw new BadRequestException('Payment allocations require MIXED');
        if (method !== 'CREDIT') cashAccountId = await getAccount(method, p.cashAccountId);
        if (
          method !== 'CASH' &&
          method !== 'CREDIT' &&
          (typeof p.paymentReference !== 'string' || !p.paymentReference.trim())
        )
          throw new BadRequestException('Non-cash payments require a reference');
      }
      pendingMoney = method === 'CREDIT' ? new Prisma.Decimal(0) : amount;
      const canonicalLines = lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitId: products.get(l.productId)!.baseUnitId,
        description: products.get(l.productId)!.name,
        discountAmount: 0,
        taxAmount: 0,
      }));
      await this.sales.assertDraftSaleProfitable(scope, canonicalLines, user, db);
      payload = {
        ...p,
        customerId,
        lines,
        expectedTotal: Number(amount),
        _sale: {
          cashAccountId,
          lines: canonicalLines,
          tenders,
          overrides: overrides
            .filter((v, i) => overrides.findIndex((o) => o.productId === v.productId) === i)
            .map((v) => ({ ...v, quantity: byId.get(v.productId)!.quantity })),
          priceEdits,
          salespersonId: terminal?.salespersonId ?? undefined,
        },
      };
      signature = saleSignature(scope.companyId, dto.businessDate, customerId, lines, amount);
    } else if (dto.kind === 'COLLECTION') {
      object(p, ['salesOrderId', 'method', 'amount', 'reference', 'cashAccountId']);
      if (!RECEIPT_METHODS.includes(p.method))
        throw new BadRequestException('Invalid collection method');
      amount = decimal(p.amount, 'Collection amount');
      pendingMoney = amount;
      const sale = await db.salesOrder.findFirst({
        where: {
          id: identifier(p.salesOrderId, 'Sale'),
          companyId: scope.companyId,
          branchId: scope.branchId,
          deletedAt: null,
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          outstandingAmount: { gte: amount },
        },
      });
      if (!sale?.customerId || !sale.receivableId)
        throw new BadRequestException('Select an approved sale with outstanding customer debt');
      if (p.method !== 'CASH' && (typeof p.reference !== 'string' || !p.reference.trim()))
        throw new BadRequestException('A payment reference is required');
      payload = {
        ...p,
        _cashAccountId: await getAccount(p.method, p.cashAccountId),
        _customerId: sale.customerId,
        _receivableId: sale.receivableId,
      };
      signature = digest({
        companyId: scope.companyId,
        day: dto.businessDate,
        kind: dto.kind,
        salesOrderId: sale.id,
        method: p.method,
        amount: amount.toFixed(2),
        reference: p.reference?.trim() ?? null,
      });
    } else if (dto.kind === 'RECEIPT') {
      object(p, ['purchaseOrderId', 'fullOrderArrived']);
      if (p.fullOrderArrived !== true)
        throw new BadRequestException(
          'Confirm that the entire approved supplier order arrived. Partial deliveries use office receiving.',
        );
      const po = await db.purchaseOrder.findFirst({
        where: {
          id: identifier(p.purchaseOrderId, 'Purchase order'),
          companyId: scope.companyId,
          branchId: scope.branchId,
          deletedAt: null,
        },
        include: { lines: true },
      });
      if (
        !po ||
        po.status !== 'CONFIRMED' ||
        (await db.goodsReceivedNote.findFirst({
          where: { purchaseOrderId: po.id, status: 'POSTED', deletedAt: null },
          select: { id: true },
        }))
      )
        throw new BadRequestException(
          'Receive only full confirmed orders without previous receipts. Use office GRN receiving for partial orders.',
        );
      if (
        await db.inventoryMovement.findFirst({
          where: {
            companyId: scope.companyId,
            referenceType: 'PurchaseOrder',
            referenceId: po.id,
            movementType: 'PURCHASE_RECEIPT',
          },
        })
      )
        throw new BadRequestException('This order already has posted stock; use office receiving');
      amount = po.totalAmount;
      payload = {
        purchaseOrderId: po.id,
        fullOrderArrived: true,
        _receiptFingerprint: digest({
          updatedAt: po.updatedAt.toISOString(),
          totalAmount: po.totalAmount.toFixed(2),
          lines: po.lines.map((l) => [l.productId, l.quantity.toString(), l.lineTotal.toString()]),
          purchaseType: po.purchaseType,
        }),
      };
      signature = digest({ companyId: scope.companyId, kind: dto.kind, purchaseOrderId: po.id });
    } else if (dto.kind === 'DAMAGE') {
      object(p, ['productId', 'quantity', 'damageType', 'reason', 'batchId']);
      if (!DAMAGE_TYPES.includes(p.damageType))
        throw new BadRequestException('Invalid damage type');
      const products = await validateProducts([p]);
      const product = products.get(p.productId)!;
      if (!product.trackInventory)
        throw new BadRequestException('This product is not stock tracked');
      const quantity = Number(decimal(p.quantity, 'Damage quantity', 4));
      payload = {
        productId: p.productId,
        quantity,
        damageType: p.damageType,
        reason: identifier(p.reason, 'Damage reason'),
        ...(p.batchId ? { batchId: identifier(p.batchId, 'Batch') } : {}),
        _unitId: product.baseUnitId,
      };
      signature = digest({
        companyId: scope.companyId,
        day: dto.businessDate,
        kind: dto.kind,
        ...payload,
      });
    } else {
      object(p, dto.kind === 'TRANSFER' ? ['destinationBranchId', 'lines'] : ['lines']);
      if (!Array.isArray(p.lines)) throw new BadRequestException('Stock lines are required');
      const products = await validateProducts(p.lines),
        seen = new Set<string>();
      const lines = p.lines.map((raw: unknown) => {
        const l = object(
          raw,
          dto.kind === 'TRANSFER'
            ? ['productId', 'quantity']
            : ['productId', 'countedQuantity', 'baselineQuantity', 'physicalRevision'],
        );
        const product = products.get(l.productId)!;
        if (!product.trackInventory || seen.has(product.id))
          throw new BadRequestException('Choose each stock tracked product once');
        seen.add(product.id);
        if (dto.kind === 'TRANSFER')
          return {
            productId: product.id,
            quantity: Number(decimal(l.quantity, 'Transfer quantity', 4)),
            unitId: product.baseUnitId,
          };
        if (!Number.isInteger(l.physicalRevision) || l.physicalRevision < 0)
          throw new BadRequestException('Capture a current stock baseline');
        return {
          productId: product.id,
          countedQuantity: Number(decimal(l.countedQuantity, 'Counted quantity', 4, true)),
          baselineQuantity: Number(decimal(l.baselineQuantity, 'Baseline quantity', 4, true)),
          physicalRevision: l.physicalRevision,
          unitId: product.baseUnitId,
        };
      });
      if (dto.kind === 'TRANSFER') {
        const destination = await db.branch.findFirst({
          where: {
            id: identifier(p.destinationBranchId, 'Destination branch'),
            isActive: true,
            deletedAt: null,
            division: { companyId: scope.companyId, isActive: true, deletedAt: null },
          },
          select: { id: true, divisionId: true },
        });
        if (!destination || destination.id === scope.branchId)
          throw new BadRequestException('Select another active branch in the same company');
        if (role === 'ADMIN')
          await this.scope(
            { companyId: scope.companyId, branchId: destination.id },
            user,
            AccessLevel.WRITE,
          );
        payload = {
          destinationBranchId: destination.id,
          lines,
          _destinationDivisionId: destination.divisionId,
        };
      } else payload = { lines };
      signature = digest({
        companyId: scope.companyId,
        branchId: scope.branchId,
        day: dto.businessDate,
        kind: dto.kind,
        ...payload,
      });
    }
    return {
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      amount,
      pendingMoney,
      duplicateSignature: signature,
      terminalId,
    };
  }

  async submit(dto: SubmitPosDraftDto, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.create');
    const role = await this.roleFor(user, dto.branchId),
      scope = await this.scope(dto, user, role === 'ADMIN' ? AccessLevel.WRITE : AccessLevel.READ);
    const captureDigest = digest(dto);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockIdentity(tx, scope.companyId, dto.requestId);
        const prior = await tx.posDraft.findUnique({
          where: { companyId_requestId: { companyId: scope.companyId, requestId: dto.requestId } },
        });
        if (prior) {
          if (
            prior.originUserId !== user.id ||
            object(prior.payload)._captureDigest !== captureDigest
          )
            throw new ConflictException(
              'This request identity belongs to another capture; check its outcome',
            );
          return this.present(prior, user);
        }
        const normalized = await this.normalize(dto, user, scope, role, tx);
        await this.lockIdentity(tx, scope.companyId, normalized.duplicateSignature);
        await this.expire(tx, scope.companyId, scope.branchId);
        let continuation: PosDraft | null = null;
        if (role === 'STOCKIST' && dto.kind === 'SALE')
          continuation = await tx.posDraft.findFirst({
            where: {
              companyId: scope.companyId,
              branchId: scope.branchId,
              duplicateSignature: normalized.duplicateSignature,
              originRole: 'CASHIER',
              status: { in: ['SUBMITTED', 'AWAITING_STOCKIST', 'READY_FINAL', 'POSTED'] },
            },
            orderBy: { createdAt: 'asc' },
          });
        const provisional = {
          ...scope,
          ...normalized,
          businessDate: new Date(`${dto.businessDate}T00:00:00Z`),
          capturedAt: new Date(dto.capturedAt),
          originUserId: user.id,
          originRole: role,
          requestId: dto.requestId,
          kind: dto.kind,
          status: continuation ? 'NEEDS_ATTENTION' : 'SUBMITTED',
          payload: {
            ...object(normalized.payload),
            _captureDigest: captureDigest,
            ...(continuation ? { _continuesDraftId: continuation.id } : {}),
          } as Prisma.InputJsonValue,
          ...(continuation
            ? {
                blockingReason:
                  'Continue the matching cashier transaction; do not create another sale',
                pendingMoney: new Prisma.Decimal(0),
              }
            : {}),
        };
        const draft = await tx.posDraft.create({ data: provisional });
        if (!continuation) {
          const candidates = await this.candidates(tx, draft);
          if (candidates.length)
            await tx.posDraft.update({
              where: { id: draft.id },
              data: {
                status: 'NEEDS_ATTENTION',
                blockingReason: 'A matching transaction requires administrator review',
              },
            });
        }
        await this.decision(
          tx,
          draft,
          user,
          continuation ? 'CONTINUE' : 'SUBMIT',
          undefined,
          continuation ? { continuedDraftId: continuation.id } : undefined,
        );
        const saved = await tx.posDraft.findUniqueOrThrow({ where: { id: draft.id } });
        return continuation
          ? this.present(continuation, user, { continuedExisting: true, captureDraftId: draft.id })
          : this.present(saved, user);
      },
      { timeout: 60000 },
    );
  }
  private lockIdentity(tx: Db, companyId: string, identity: string) {
    return lockPosDuplicateIdentity(tx, companyId, identity);
  }
  private async lockDraft(
    tx: Db,
    id: string,
    user: AuthUser,
    revision: number,
    minimum: AccessLevel = AccessLevel.WRITE,
  ) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM pos_drafts WHERE id = ${id} FOR UPDATE`);
    const draft = await tx.posDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('POS Draft not found');
    await this.scope(draft as any, user, minimum);
    if (draft.revision !== revision)
      throw new ConflictException('This draft changed; reload its current revision');
    return draft;
  }
  async correct(id: string, dto: CorrectPosDraftDto, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.create');
    const role = await this.roleFor(user, dto.branchId),
      scope = await this.scope(dto, user, role === 'ADMIN' ? AccessLevel.WRITE : AccessLevel.READ);
    return this.prisma.$transaction(
      async (tx) => {
        const old = await this.lockDraft(tx, id, user, dto.revision, AccessLevel.READ);
        if (
          old.originUserId !== user.id ||
          !['SUBMITTED', 'NEEDS_ATTENTION', 'AWAITING_STOCKIST', 'READY_FINAL'].includes(
            old.status,
          ) ||
          object(old.payload)._continuesDraftId
        )
          throw new ForbiddenException('Only the origin recorder may correct an unposted draft');
        if (
          old.requestId !== dto.requestId ||
          old.companyId !== scope.companyId ||
          old.branchId !== scope.branchId ||
          old.kind !== dto.kind ||
          old.businessDate.toISOString().slice(0, 10) !== dto.businessDate ||
          old.capturedAt.getTime() !== new Date(dto.capturedAt).getTime()
        )
          throw new BadRequestException(
            'A correction cannot change transaction identity, kind, branch, or original capture date',
          );
        const normalized = await this.normalize(dto, user, scope, role, tx);
        if (old.pendingMoney.gt(0)) {
          const paymentShape = (payload: JsonRecord) => ({
            method: payload.paymentMethod ?? payload.method,
            payments: (payload.payments ?? [])
              .map((payment: JsonRecord) => ({
                method: payment.method,
                amount: new Prisma.Decimal(payment.amount).toFixed(2),
              }))
              .sort((a: JsonRecord, b: JsonRecord) => a.method.localeCompare(b.method)),
          });
          if (
            !old.pendingMoney.eq(normalized.pendingMoney) ||
            digest(paymentShape(object(old.payload))) !==
              digest(paymentShape(object(normalized.payload)))
          )
            throw new ConflictException(
              'Collected funds cannot change during correction. Ask an administrator to reject and reconcile the funds before a new capture.',
            );
        }
        // A correction invalidates all prior sale/dispatch approvals. Release
        // only this draft's hold after validation succeeds in the same transaction.
        await this.lockIdentity(tx, scope.companyId, normalized.duplicateSignature);
        await this.release(tx, old);
        const { revision: ignored, ...capture } = dto;
        const draft = await tx.posDraft.update({
          where: { id },
          data: {
            ...normalized,
            revision: { increment: 1 },
            status: 'SUBMITTED',
            blockingReason: null,
            reservedUntil: null,
            businessDate: new Date(`${dto.businessDate}T00:00:00Z`),
            capturedAt: new Date(dto.capturedAt),
            payload: { ...object(normalized.payload), _captureDigest: digest(capture) },
          },
        });
        await this.decision(tx, draft, user, 'CORRECT');
        return this.present(draft, user);
      },
      { timeout: 60000 },
    );
  }
  private async decision(
    tx: Db,
    draft: PosDraft,
    user: AuthUser,
    action: string,
    reason?: string,
    metadata?: JsonRecord,
  ) {
    await tx.posDraftDecision.create({
      data: {
        draftId: draft.id,
        revision: draft.revision,
        actorUserId: user.id,
        action,
        reason,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: `POS_DRAFT_${action}`,
      entityType: 'PosDraft',
      entityId: draft.id,
      userId: user.id,
      companyId: draft.companyId,
      metadata: {
        revision: draft.revision,
        originUserId: draft.originUserId,
        originRole: draft.originRole,
        requestId: draft.requestId,
        ...(reason ? { reason } : {}),
        ...metadata,
      },
    });
  }
  private async candidates(db: Db | PrismaService, draft: PosDraft) {
    if (!draft.duplicateSignature) return [];
    const records = await db.posDraft.findMany({
      where: {
        companyId: draft.companyId,
        duplicateSignature: draft.duplicateSignature,
        id: { not: draft.id },
        status: { not: 'REJECTED' },
      },
      select: {
        id: true,
        requestId: true,
        originUserId: true,
        divisionId: true,
        branchId: true,
        businessDate: true,
        status: true,
        amount: true,
        postedEntityId: true,
        payload: true,
      },
      orderBy: { id: 'asc' },
    });
    const candidates: JsonRecord[] = records
      .filter((r) => !object(r.payload)._continuesDraftId)
      .map(({ payload, postedEntityId, ...r }) => ({ ...r, amount: Number(r.amount) }));
    if (draft.kind === 'SALE') {
      const p = object(draft.payload),
        day = draft.businessDate.toISOString().slice(0, 10);
      const start = new Date(`${day}T00:00:00+03:00`),
        end = new Date(start.getTime() + 86400000);
      const represented = new Set(records.map((r) => r.postedEntityId).filter(Boolean));
      if (draft.postedEntityId) represented.add(draft.postedEntityId);
      const sales = await db.salesOrder.findMany({
        where: {
          companyId: draft.companyId,
          customerId: p.customerId,
          orderDate: { gte: start, lt: end },
          totalAmount: draft.amount,
          deletedAt: null,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        include: { lines: true },
      });
      for (const sale of sales) {
        if (represented.has(sale.id)) continue;
        const lines = sale.lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(new Prisma.Decimal(l.lineTotal).div(l.quantity).toDecimalPlaces(2)),
        }));
        if (
          saleSignature(draft.companyId, day, sale.customerId!, lines, sale.totalAmount) ===
          draft.duplicateSignature
        )
          candidates.push({
            id: sale.id,
            requestId: sale.idempotencyKey,
            originUserId: sale.createdById,
            divisionId: sale.divisionId,
            branchId: sale.branchId,
            businessDate: draft.businessDate,
            status: 'POSTED',
            amount: Number(sale.totalAmount),
            entityType: 'SalesOrder',
          });
      }
    }
    return candidates.sort((a, b) => a.id.localeCompare(b.id));
  }
  private async reviewableCandidates(candidates: JsonRecord[], user: AuthUser) {
    return Promise.all(
      candidates.map(async (candidate) => {
        try {
          await this.organizationScope.assertCanAccessScope(
            user,
            candidate.divisionId,
            candidate.branchId,
            AccessLevel.READ,
          );
          return { ...candidate, reviewable: true };
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          return {
            id: `restricted-${digest(candidate.id).slice(0, 12)}`,
            status: 'NEEDS_ATTENTION',
            amount: candidate.amount,
            businessDate: candidate.businessDate,
            reviewable: false,
            restricted: true,
          };
        }
      }),
    );
  }
  private async checkDuplicates(tx: Db, draft: PosDraft, dto: ApprovePosDraftDto, user: AuthUser) {
    await this.lockIdentity(tx, draft.companyId, draft.duplicateSignature ?? draft.requestId);
    const candidates = await this.candidates(tx, draft);
    if (!candidates.length) return { reviewedCandidateIds: [] };
    const reviewable = await this.reviewableCandidates(candidates, user);
    if (reviewable.some((candidate) => !candidate.reviewable))
      throw new ForbiddenException(
        'A matching transaction is outside your branch access. An administrator with access to both transactions must review it.',
      );
    const supplied = [...new Set(dto.reviewedCandidateIds ?? [])].sort(),
      actual = candidates.map((c) => c.id).sort();
    const reason = dto.duplicateReason?.trim();
    if (!reason) {
      const prior = await tx.posDraftDecision.findFirst({
        where: { draftId: draft.id, action: 'APPROVE' },
        orderBy: { createdAt: 'desc' },
      });
      const metadata = prior?.metadata ? object(prior.metadata) : null;
      if (
        metadata?.duplicateReason &&
        metadata.captureDigest === object(draft.payload)._captureDigest &&
        digest(metadata.reviewedCandidateIds) === digest(actual)
      )
        return metadata;
    }
    if (!reason || reason.length < 5 || digest(supplied) !== digest(actual))
      throw new ConflictException({
        message: 'Review every matching transaction and give a reason for a genuine repeat',
        duplicateCandidates: candidates,
      });
    return {
      duplicateReason: reason,
      reviewedCandidateIds: actual,
      captureDigest: object(draft.payload)._captureDigest,
    };
  }

  async approve(id: string, dto: ApprovePosDraftDto, user: AuthUser, direct = false) {
    this.assertPermission(user, direct ? 'pos_drafts.direct_post' : 'pos_drafts.approve');
    if (user.tokenUse === 'mobile-pos')
      throw new ForbiddenException('A POS PIN account cannot approve or post');
    const visible = await this.visible(id, user);
    if ((await this.roleFor(user, visible.branchId)) !== 'ADMIN')
      throw new ForbiddenException('Cashier and stockist accounts cannot approve');
    let acceptedAction = false;
    let reviewedContinuation:
      | { payload: Prisma.InputJsonObject; pendingMoney: Prisma.Decimal; metadata: JsonRecord }
      | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          let draft = await this.lockDraft(tx, id, user, dto.revision);
          if (draft.status === 'POSTED') return this.present(draft, user);
          if (
            ['AWAITING_STOCKIST', 'READY_FINAL'].includes(draft.status) &&
            draft.reservedUntil &&
            draft.reservedUntil.getTime() <= Date.now()
          ) {
            await this.release(tx, draft);
            const expired = await tx.posDraft.update({
              where: { id },
              data: {
                revision: { increment: 1 },
                status: 'NEEDS_ATTENTION',
                reservedUntil: null,
                blockingReason:
                  'The 24 hour stock reservation expired. Approve and prepare the full dispatch again.',
              },
            });
            await this.decision(tx, expired, user, 'EXPIRE');
            return this.present(expired, user);
          }
          if (!['SUBMITTED', 'READY_FINAL', 'NEEDS_ATTENTION'].includes(draft.status))
            throw new BadRequestException('This draft is not awaiting approval');
          const continuedDraftId = object(draft.payload)._continuesDraftId;
          if (
            continuedDraftId &&
            (draft.kind !== 'SALE' ||
              draft.originRole !== 'STOCKIST' ||
              (dto.duplicateReason?.trim().length ?? 0) < 5 ||
              !dto.reviewedCandidateIds?.includes(continuedDraftId))
          )
            throw new BadRequestException(
              'Continue the cashier transaction, or review every match and explain this separate genuine purchase',
            );
          if (
            direct &&
            (draft.originRole !== 'ADMIN' ||
              draft.originUserId !== user.id ||
              !['SUBMITTED', 'NEEDS_ATTENTION'].includes(draft.status))
          )
            throw new ForbiddenException(
              'Direct posting is available only for your authorized administrator transaction',
            );
          if (!direct && draft.originUserId === user.id)
            throw new ForbiddenException(
              'Another administrator must approve this draft. Use authorized direct posting for your own transaction.',
            );
          acceptedAction = true;
          if (draft.kind === 'SALE') await lockPosSalePosting(tx, draft.companyId);
          await this.expire(tx, draft.companyId, draft.branchId);
          let metadata: JsonRecord | undefined;
          if (continuedDraftId) {
            // Matching captures continue the cashier sale by default. Only a
            // fresh, complete administrator review may establish a second sale.
            metadata = await this.checkDuplicates(tx, draft, dto, user);
            if (!metadata.reviewedCandidateIds.includes(continuedDraftId))
              throw new ConflictException(
                'The cashier transaction changed. Review the matching capture before treating it as a separate purchase.',
              );
            const payload = { ...object(draft.payload) };
            delete payload._continuesDraftId;
            reviewedContinuation = {
              payload: { ...payload, _separateRepeatOfDraftId: continuedDraftId },
              pendingMoney:
                payload.paymentMethod === 'CREDIT' ? new Prisma.Decimal(0) : draft.amount,
              metadata: { ...metadata, continuedDraftId, resolution: 'GENUINE_REPEAT' },
            };
            draft = await tx.posDraft.update({
              where: { id },
              data: {
                payload: reviewedContinuation.payload,
                pendingMoney: reviewedContinuation.pendingMoney,
              },
            });
            await this.decision(
              tx,
              draft,
              user,
              'REPEAT_REVIEW',
              dto.duplicateReason?.trim(),
              reviewedContinuation.metadata,
            );
          }
          const origin = await this.assertOriginActive(tx, draft);
          if (draft.kind === 'SALE') {
            await this.accountingControl.assertPostingAllowed(
              {
                companyId: draft.companyId,
                transactionDate: new Date(
                  `${draft.businessDate.toISOString().slice(0, 10)}T12:00:00+03:00`,
                ),
                moduleName: 'sales',
              },
              tx,
            );
            await this.validateCapturedSale(tx, draft, origin);
          }
          metadata ??= await this.checkDuplicates(tx, draft, dto, user);
          if (
            draft.kind === 'SALE' &&
            draft.originRole === 'CASHIER' &&
            draft.status !== 'READY_FINAL'
          ) {
            await this.reserve(tx, draft);
            const updated = await tx.posDraft.update({
              where: { id },
              data: {
                revision: { increment: 1 },
                status: 'AWAITING_STOCKIST',
                blockingReason: null,
                reservedUntil: new Date(Date.now() + 86400000),
              },
            });
            await this.decision(tx, updated, user, 'APPROVE', undefined, metadata);
            return this.present(updated, user);
          }
          if (
            draft.originRole === 'CASHIER' &&
            draft.kind === 'SALE' &&
            (!draft.reservedUntil || draft.reservedUntil.getTime() <= Date.now())
          )
            throw new ConflictException(
              'The stock reservation expired; recapture and approve the full dispatch',
            );
          const result = await this.post(tx, draft, user);
          const posted = await tx.posDraft.update({
            where: { id },
            data: {
              revision: { increment: 1 },
              status: 'POSTED',
              postedEntityType: result.type,
              postedEntityId: result.id,
              postedAt: new Date(),
              pendingMoney: 0,
              blockingReason: null,
              reservedUntil: null,
            },
          });
          await this.decision(tx, posted, user, direct ? 'DIRECT_POST' : 'APPROVE', undefined, {
            ...metadata,
            postedEntityType: result.type,
            postedEntityId: result.id,
          });
          return this.present(posted, user);
        },
        { timeout: 60000 },
      );
    } catch (error) {
      // The posting transaction has rolled back in full. Retain the money claim
      // and a visible reconciliation task without inventing canonical records.
      if (
        !acceptedAction ||
        (!(error instanceof BadRequestException || error instanceof ConflictException) &&
          !reviewedContinuation)
      )
        throw error;
      const message =
        error instanceof BadRequestException || error instanceof ConflictException
          ? error.message
          : 'Posting failed after the genuine repeat review. Retain collected funds for office reconciliation.';
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM pos_drafts WHERE id = ${id} FOR UPDATE`);
          const draft = await tx.posDraft.findUnique({ where: { id } });
          if (
            draft &&
            draft.revision === dto.revision &&
            ['SUBMITTED', 'READY_FINAL', 'NEEDS_ATTENTION'].includes(draft.status)
          ) {
            await this.release(tx, draft);
            const updated = await tx.posDraft.update({
              where: { id },
              data: {
                revision: { increment: 1 },
                status: 'NEEDS_ATTENTION',
                blockingReason: message,
                reservedUntil: null,
                ...(reviewedContinuation
                  ? {
                      payload: reviewedContinuation.payload,
                      pendingMoney: reviewedContinuation.pendingMoney,
                    }
                  : {}),
              },
            });
            if (reviewedContinuation)
              await this.decision(
                tx,
                updated,
                user,
                'REPEAT_REVIEW',
                dto.duplicateReason?.trim(),
                reviewedContinuation.metadata,
              );
            await this.decision(tx, updated, user, 'POST_BLOCKED', message);
          }
        },
        { timeout: 60000 },
      );
      throw error;
    }
  }
  private async assertOriginActive(tx: Db, draft: PosDraft): Promise<AuthUser> {
    const user = await tx.user.findFirst({
      where: { id: draft.originUserId, status: 'ACTIVE', deletedAt: null },
      include: {
        companyAccess: true,
        divisionAccess: true,
        branchAccess: true,
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) throw new BadRequestException('The origin recorder is no longer active');
    let origin: AuthUser = {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      roles: user.userRoles.map((r) => r.role.name),
      roleScopes: user.userRoles.map((r) => r.role.scope),
      permissions: [
        ...new Set(
          user.userRoles.flatMap((r) => r.role.rolePermissions.map((p) => p.permission.code)),
        ),
      ],
      companyAccess: user.companyAccess,
      divisionAccess: user.divisionAccess,
      branchAccess: user.branchAccess,
    };
    if (draft.originRole !== 'ADMIN') {
      const enrolled = await tx.mobilePosEnrollment.findFirst({
        where: {
          userId: draft.originUserId,
          companyId: draft.companyId,
          branchId: draft.branchId,
          approvedRole: draft.originRole,
          status: 'APPROVED',
          terminalId: draft.terminalId,
          branchSetup: { enabled: true, approvalRequired: true },
        },
      });
      if (!enrolled)
        throw new BadRequestException('The origin POS enrollment is no longer approved');
      if (user.authKind === 'POS_PIN')
        origin = {
          ...origin,
          companyId: enrolled.companyId,
          roleScopes: ['BRANCH'],
          permissions: ['pos_drafts.view', 'pos_drafts.create'],
          companyAccess: [{ companyId: enrolled.companyId, accessLevel: 'READ' }],
          divisionAccess: [],
          branchAccess: [{ branchId: enrolled.branchId, accessLevel: 'READ' }],
        };
    }
    if (!origin.permissions.includes('pos_drafts.create'))
      throw new BadRequestException(
        'The origin recorder no longer has permission to capture POS drafts',
      );
    const minimum = user.authKind === 'POS_PIN' ? AccessLevel.READ : AccessLevel.WRITE;
    await this.companyScope.assertCanAccessCompany(origin, draft.companyId, minimum);
    await this.organizationScope.assertCanAccessScope(
      origin,
      draft.divisionId,
      draft.branchId,
      minimum,
    );
    return origin;
  }
  private async validateCapturedSale(tx: Db, draft: PosDraft, origin: AuthUser) {
    const p = object(draft.payload),
      snap = object(p._sale);
    const terminal = draft.terminalId
      ? await tx.mobilePosTerminal.findUnique({
          where: { id: draft.terminalId },
          include: { paymentMethods: true },
        })
      : null;
    if (
      draft.originRole !== 'ADMIN' &&
      (!terminal ||
        terminal.status !== 'ACTIVE' ||
        terminal.assignedUserId !== draft.originUserId ||
        terminal.branchId !== draft.branchId ||
        terminal.companyId !== draft.companyId)
    )
      throw new BadRequestException('The origin terminal is no longer active in this branch');
    const customer = await tx.customer.findFirst({
      where: {
        id: p.customerId,
        companyId: draft.companyId,
        status: 'ACTIVE',
        deletedAt: null,
        AND: [
          { OR: [{ divisionId: draft.divisionId }, { divisionId: null }] },
          { OR: [{ branchId: draft.branchId }, { branchId: null }] },
        ],
      },
      select: { id: true },
    });
    if (!customer || (p.paymentMethod === 'CREDIT' && terminal && !terminal.creditEnabled))
      throw new BadRequestException('The customer or credit configuration is no longer available');
    for (const line of p.lines) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id=${line.productId} FOR SHARE`);
      const product = await tx.product.findFirst({
        where: {
          id: line.productId,
          companyId: draft.companyId,
          status: 'ACTIVE',
          deletedAt: null,
          OR: [{ divisionId: draft.divisionId }, { divisionId: null }],
        },
        include: { productFamily: true },
      });
      if (!product) throw new BadRequestException('A captured product is no longer available');
      const list = effectiveSellingPrice(product),
        override =
          snap.priceEdits?.find((v: JsonRecord) => v.productId === line.productId) ??
          snap.overrides?.find((v: JsonRecord) => v.productId === line.productId);
      if (
        list == null ||
        (!override && list !== line.unitPrice) ||
        (override && list !== override.listUnitPrice)
      )
        throw new ConflictException(
          'A canonical selling price changed. Correct and review this draft again.',
        );
      if (override) {
        if (!origin.permissions.includes('mobile_pos_lite.edit_price'))
          throw new BadRequestException(
            'The origin recorder can no longer authorize this price change',
          );
        const drop = new Prisma.Decimal(list).minus(line.unitPrice).div(list).times(100);
        if (
          !origin.permissions.includes('mobile_pos_lite.edit_price_unlimited') &&
          drop.gt(terminal?.maxPriceDropPct ?? 0)
        )
          throw new BadRequestException(
            'The captured price exceeds the current authorized price limit',
          );
      }
    }
    const receipts =
      snap.tenders ??
      (p.paymentMethod === 'CREDIT'
        ? []
        : [{ method: p.paymentMethod, cashAccountId: snap.cashAccountId }]);
    for (const tender of receipts) {
      const configured = terminal?.paymentMethods.find(
        (t) => t.isEnabled && t.paymentMethod === tender.method,
      )?.cashAccountId;
      const account = await tx.cashAccount.findFirst({
        where: {
          id: tender.cashAccountId,
          companyId: draft.companyId,
          currency: 'TZS',
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, branchId: true, divisionId: true },
      });
      if (
        !account ||
        (terminal && configured !== account.id) ||
        (account.branchId && account.branchId !== draft.branchId) ||
        (account.divisionId && account.divisionId !== draft.divisionId)
      )
        throw new BadRequestException('The captured receipt account is no longer authorized');
    }
    await this.sales.assertDraftSaleProfitable(
      { companyId: draft.companyId, branchId: draft.branchId },
      snap.lines,
      origin,
      tx,
    );
  }
  async prepare(id: string, dto: PosDraftRevisionDto, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.dispatch');
    const visible = await this.visible(id, user),
      role = await this.roleFor(user, visible.branchId);
    if (role === 'CASHIER') throw new ForbiddenException('A stockist must prepare dispatch');
    return this.prisma.$transaction(
      async (tx) => {
        const draft = await this.lockDraft(
          tx,
          id,
          user,
          dto.revision,
          role === 'ADMIN' ? AccessLevel.WRITE : AccessLevel.READ,
        );
        if (role === 'STOCKIST') {
          const enrollment = await tx.mobilePosEnrollment.findFirst({
            where: {
              userId: user.id,
              companyId: draft.companyId,
              branchId: draft.branchId,
              approvedRole: 'STOCKIST',
              status: 'APPROVED',
              branchSetup: { enabled: true, approvalRequired: true },
            },
            select: { id: true, terminalId: true },
          });
          const terminal = enrollment?.terminalId
            ? await tx.mobilePosTerminal.findFirst({
                where: {
                  id: enrollment.terminalId,
                  assignedUserId: user.id,
                  companyId: draft.companyId,
                  branchId: draft.branchId,
                  status: 'ACTIVE',
                },
                select: { id: true },
              })
            : null;
          if (!enrollment || !terminal)
            throw new ForbiddenException('An active approved stockist enrollment is required');
        }
        await this.expire(tx, draft.companyId, draft.branchId);
        const fresh = await tx.posDraft.findUniqueOrThrow({ where: { id } });
        if (
          fresh.status === 'AWAITING_STOCKIST' &&
          fresh.reservedUntil &&
          fresh.reservedUntil.getTime() <= Date.now()
        ) {
          await this.release(tx, fresh);
          const expired = await tx.posDraft.update({
            where: { id },
            data: {
              revision: { increment: 1 },
              status: 'NEEDS_ATTENTION',
              reservedUntil: null,
              blockingReason: 'Reservation expired. Ask an administrator to approve stock again.',
            },
          });
          await this.decision(tx, expired, user, 'EXPIRE');
          return this.present(expired, user);
        }
        if (fresh.status !== 'AWAITING_STOCKIST' || !fresh.reservedUntil)
          throw new ConflictException(
            'The approved reservation is no longer available; ask an administrator to review',
          );
        const reservations = await tx.posDraftReservation.findMany({
          where: { draftId: id, releasedAt: null, expiresAt: { gt: new Date() } },
        });
        const p = object(draft.payload);
        const products = await tx.product.findMany({
          where: { id: { in: p.lines.map((l: JsonRecord) => l.productId) }, trackInventory: true },
          select: { id: true },
        });
        if (
          products.some(
            (product) =>
              !reservations.some(
                (r) =>
                  r.productId === product.id &&
                  r.quantity.eq(
                    p.lines.find((l: JsonRecord) => l.productId === product.id).quantity,
                  ),
              ),
          )
        )
          throw new ConflictException(
            'Prepare the entire reserved dispatch; partial fulfillment is unavailable',
          );
        const updated = await tx.posDraft.update({
          where: { id },
          data: { revision: { increment: 1 }, status: 'READY_FINAL' },
        });
        await this.decision(tx, updated, user, 'PREPARE');
        return this.present(updated, user);
      },
      { timeout: 60000 },
    );
  }
  async reject(id: string, dto: RejectPosDraftDto, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.reject');
    if (user.tokenUse === 'mobile-pos')
      throw new ForbiddenException('A POS PIN account cannot reject');
    const visible = await this.visible(id, user);
    if ((await this.roleFor(user, visible.branchId)) !== 'ADMIN')
      throw new ForbiddenException('An administrator must reject');
    return this.prisma.$transaction(
      async (tx) => {
        const draft = await this.lockDraft(tx, id, user, dto.revision);
        if (draft.status === 'REJECTED') return this.present(draft, user);
        if (draft.status === 'POSTED')
          throw new BadRequestException(
            'A posted transaction requires the canonical return or reversal workflow',
          );
        await this.release(tx, draft);
        const updated = await tx.posDraft.update({
          where: { id },
          data: {
            revision: { increment: 1 },
            status: 'REJECTED',
            blockingReason: draft.pendingMoney.gt(0)
              ? `Money reconciliation required: ${dto.reason}`
              : dto.reason,
            reservedUntil: null,
          },
        });
        await this.decision(tx, updated, user, 'REJECT', dto.reason);
        return this.present(updated, user);
      },
      { timeout: 60000 },
    );
  }

  async confirmReturn(id: string, dto: ConfirmReturnPosDraftDto, user: AuthUser) {
    this.assertPermission(user, 'pos_drafts.approve');
    if (user.tokenUse === 'mobile-pos')
      throw new ForbiddenException('An office administrator must confirm returned funds');
    if (
      dto.fundsReturned !== true ||
      typeof dto.reason !== 'string' ||
      dto.reason.trim().length < 5 ||
      dto.reason.length > 500 ||
      (dto.reference != null && (typeof dto.reference !== 'string' || dto.reference.length > 200))
    )
      throw new BadRequestException(
        'Confirm that all collected funds were returned and explain how',
      );
    const visible = await this.visible(id, user);
    if ((await this.roleFor(user, visible.branchId)) !== 'ADMIN')
      throw new ForbiddenException('An office administrator must confirm returned funds');
    const reason = dto.reason.trim(),
      reference = dto.reference?.trim() || null,
      confirmationKey = digest({ revision: dto.revision, reason, reference });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM pos_drafts WHERE id=${id} FOR UPDATE`);
      const draft = await tx.posDraft.findUnique({ where: { id } });
      if (!draft) throw new NotFoundException('POS Draft not found');
      await this.scope(draft as any, user, AccessLevel.WRITE);
      if (draft.status !== 'REJECTED')
        throw new ConflictException('Only rejected captures may have their pending funds returned');
      if (draft.pendingMoney.eq(0)) {
        const prior = await tx.posDraftDecision.findFirst({
          where: { draftId: id, action: 'RETURN_FUNDS', actorUserId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        if (prior && object(prior.metadata).confirmationKey === confirmationKey)
          return this.present(draft, user);
        throw new ConflictException(
          'The pending funds were already reconciled; reload this capture',
        );
      }
      if (draft.revision !== dto.revision)
        throw new ConflictException('This draft changed; reload its current revision');
      const originalPendingMoney = draft.pendingMoney.toFixed(2);
      const updated = await tx.posDraft.update({
        where: { id },
        data: {
          revision: { increment: 1 },
          pendingMoney: 0,
          blockingReason: `All collected funds returned: ${reason}`,
        },
      });
      await this.decision(tx, updated, user, 'RETURN_FUNDS', reason, {
        originalPendingMoney,
        currency: draft.currency,
        reference,
        confirmationKey,
        fundsReturned: true,
      });
      return this.present(updated, user);
    });
  }

  private async balance(tx: Db, companyId: string, branchId: string, productId: string) {
    await tx.inventoryBalance.upsert({
      where: { companyId_productId_branchId: { companyId, productId, branchId } },
      create: { companyId, branchId, productId, quantityOnHand: 0, quantityReserved: 0 },
      update: {},
    });
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM inventory_balances WHERE "companyId"=${companyId} AND "branchId"=${branchId} AND "productId"=${productId} FOR UPDATE`,
    );
    return tx.inventoryBalance.findUniqueOrThrow({
      where: { companyId_productId_branchId: { companyId, productId, branchId } },
    });
  }
  private async expire(tx: Db, companyId: string, branchId: string) {
    const products = await tx.posDraftReservation.findMany({
      where: { companyId, branchId, releasedAt: null, expiresAt: { lte: new Date() } },
      select: { productId: true },
      distinct: ['productId'],
      orderBy: { productId: 'asc' },
    });
    for (const product of products) {
      const locked = await this.balance(tx, companyId, branchId, product.productId);
      await releaseExpiredPosReservations(tx, { ...locked, branchId });
    }
  }
  /** Release stock first, then lock draft rows in a separate transaction. */
  private async finishExpiry(scope: DraftScope, user: AuthUser) {
    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM pos_drafts WHERE "companyId"=${scope.companyId} AND "branchId"=${scope.branchId} AND status IN ('AWAITING_STOCKIST','READY_FINAL') AND "reservedUntil" <= NOW() ORDER BY id FOR UPDATE SKIP LOCKED`,
        );
        for (const row of rows) {
          const draft = await tx.posDraft.findUniqueOrThrow({ where: { id: row.id } });
          if (
            await tx.posDraftReservation.count({ where: { draftId: draft.id, releasedAt: null } })
          )
            continue;
          const updated = await tx.posDraft.update({
            where: { id: draft.id },
            data: {
              revision: { increment: 1 },
              status: 'NEEDS_ATTENTION',
              reservedUntil: null,
              blockingReason: 'The 24 hour reservation expired. Approve and prepare stock again.',
            },
          });
          await this.decision(tx, updated, user, 'EXPIRE');
        }
      },
      { timeout: 60000 },
    );
  }
  private async release(tx: Db, draft: PosDraft) {
    const reservations = await tx.posDraftReservation.findMany({
      where: { draftId: draft.id, releasedAt: null },
      orderBy: { productId: 'asc' },
    });
    for (const r of reservations) {
      await this.balance(tx, draft.companyId, r.branchId, r.productId);
      const claimed = await tx.posDraftReservation.updateMany({
        where: { id: r.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (claimed.count)
        await tx.inventoryBalance.update({
          where: {
            companyId_productId_branchId: {
              companyId: draft.companyId,
              productId: r.productId,
              branchId: r.branchId,
            },
          },
          data: { quantityReserved: { decrement: r.quantity } },
        });
    }
  }
  private async reserve(tx: Db, draft: PosDraft) {
    const p = object(draft.payload),
      until = new Date(Date.now() + 86400000);
    for (const line of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: line.productId },
        select: { trackInventory: true },
      });
      if (!product.trackInventory) continue;
      const balance = await this.balance(tx, draft.companyId, draft.branchId, line.productId);
      if (balance.quantityOnHand.minus(balance.quantityReserved).lt(line.quantity))
        throw new ConflictException('There is insufficient available stock for the full sale');
      await tx.posDraftReservation.upsert({
        where: {
          draftId_productId_branchId: {
            draftId: draft.id,
            productId: line.productId,
            branchId: draft.branchId,
          },
        },
        create: {
          draftId: draft.id,
          companyId: draft.companyId,
          branchId: draft.branchId,
          productId: line.productId,
          quantity: line.quantity,
          expiresAt: until,
        },
        update: { quantity: line.quantity, expiresAt: until, releasedAt: null },
      });
      await tx.inventoryBalance.update({
        where: {
          companyId_productId_branchId: {
            companyId: draft.companyId,
            productId: line.productId,
            branchId: draft.branchId,
          },
        },
        data: { quantityReserved: { increment: line.quantity } },
      });
    }
  }

  private async post(
    tx: Db,
    draft: PosDraft,
    user: AuthUser,
  ): Promise<{ type: string; id: string }> {
    const p = object(draft.payload),
      scope = {
        companyId: draft.companyId,
        divisionId: draft.divisionId!,
        branchId: draft.branchId,
      };
    const date = `${draft.businessDate.toISOString().slice(0, 10)}T12:00:00+03:00`;
    if (draft.kind === 'SALE') {
      const snap = object(p._sale);
      // Compare stored list prices against the current master; approval cannot
      // silently replace the customer's captured price or grant an override.
      for (const line of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const product = await tx.product.findFirst({
          where: {
            id: line.productId,
            companyId: draft.companyId,
            status: 'ACTIVE',
            deletedAt: null,
          },
          include: { productFamily: true },
        });
        if (!product) throw new BadRequestException('A captured product is no longer available');
        const override =
          snap.priceEdits?.find((v: JsonRecord) => v.productId === line.productId) ??
          snap.overrides?.find((v: JsonRecord) => v.productId === line.productId);
        if (!override && effectiveSellingPrice(product) !== line.unitPrice)
          throw new ConflictException(
            'A canonical selling price changed. Correct and review this draft again.',
          );
        if (product.trackInventory)
          await this.balance(tx, draft.companyId, draft.branchId, line.productId);
      }
      await this.release(tx, draft);
      const order = await this.sales.createAndConfirmInTransaction(
        {
          ...scope,
          customerId: p.customerId,
          salesType: p.paymentMethod === 'CREDIT' ? SalesType.CREDIT_SALE : SalesType.CASH_SALE,
          orderDate: date,
          currency: CurrencyCode.TZS,
          paymentMethod: p.paymentMethod as SalesPaymentMethod,
          cashAccountId: snap.cashAccountId,
          paymentReference: p.paymentReference,
          salespersonId: snap.salespersonId,
          idempotencyKey: `PD-${digest({ companyId: draft.companyId, requestId: draft.requestId }).slice(0, 60)}`,
          notes: `Approved POS Draft ${draft.id}; origin recorder ${draft.originUserId}`,
          lines: snap.lines,
        },
        user,
        tx,
        {
          originatingPosDraftId: draft.id,
          originUserId: draft.originUserId,
          mobilePosTerminalId: draft.terminalId ?? undefined,
          posTenders: snap.tenders,
          mobilePosPriceOverrides: snap.overrides,
        },
      );
      return { type: 'SalesOrder', id: order.id };
    }
    if (draft.kind === 'COLLECTION') {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM sales_orders WHERE id=${p.salesOrderId} FOR UPDATE`,
      );
      const sale = await tx.salesOrder.findFirst({
        where: {
          id: p.salesOrderId,
          companyId: draft.companyId,
          branchId: draft.branchId,
          deletedAt: null,
          outstandingAmount: { gte: draft.amount },
        },
      });
      if (!sale || sale.receivableId !== p._receivableId || sale.customerId !== p._customerId)
        throw new ConflictException('The selected sale no longer has this outstanding debt');
      const payment = await this.collections.create(
        {
          ...scope,
          customerId: p._customerId,
          amount: Number(draft.amount),
          method: p.method as PaymentMethodGeneral,
          paymentDate: date,
          cashAccountId: p._cashAccountId,
          reference: p.reference,
          currency: CurrencyCode.TZS,
          notes: `POS Draft ${draft.id}; origin recorder ${draft.originUserId}`,
          allocations: [{ receivableId: p._receivableId, amount: Number(draft.amount) }],
        },
        user,
        tx,
        { originUserId: draft.originUserId },
      );
      return { type: 'CustomerPayment', id: payment.id };
    }
    if (draft.kind === 'RECEIPT') {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM purchase_orders WHERE id=${p.purchaseOrderId} FOR UPDATE`,
      );
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: p.purchaseOrderId },
        include: { lines: true },
      });
      const fingerprint = digest({
        updatedAt: po.updatedAt.toISOString(),
        totalAmount: po.totalAmount.toFixed(2),
        lines: po.lines.map((l) => [l.productId, l.quantity.toString(), l.lineTotal.toString()]),
        purchaseType: po.purchaseType,
      });
      if (
        fingerprint !== p._receiptFingerprint ||
        po.companyId !== draft.companyId ||
        po.branchId !== draft.branchId
      )
        throw new ConflictException(
          'The approved purchase order changed; capture its full receipt again',
        );
      const receipt = await this.purchases.receive(po.id, user, {}, tx, {
        originUserId: draft.originUserId,
      });
      return { type: 'PurchaseOrder', id: receipt.id };
    }
    if (draft.kind === 'COUNT') {
      for (const l of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const balance = await this.balance(tx, draft.companyId, draft.branchId, l.productId);
        if (
          balance.physicalRevision !== l.physicalRevision ||
          !balance.quantityOnHand.eq(l.baselineQuantity)
        )
          throw new ConflictException(
            'Stock moved after this count was captured. Recount against a fresh baseline.',
          );
        if (new Prisma.Decimal(l.countedQuantity).lt(balance.quantityReserved))
          throw new ConflictException(
            'This count conflicts with approved reserved dispatches. Resolve those dispatches and recount.',
          );
      }
      const adjustment = await tx.stockAdjustment.create({
        data: {
          ...scope,
          adjustmentNumber: `PD-${draft.id}`,
          reason: 'Approved POS physical count',
          status: 'APPROVED',
          createdById: draft.originUserId,
          approvedById: user.id,
          approvedAt: new Date(),
          notes: `POS Draft ${draft.id}`,
          lines: {
            create: p.lines.map((l: JsonRecord) => ({
              productId: l.productId,
              unitId: l.unitId,
              systemQuantity: l.baselineQuantity,
              countedQuantity: l.countedQuantity,
              varianceQuantity: new Prisma.Decimal(l.countedQuantity).minus(l.baselineQuantity),
            })),
          },
        },
      });
      await this.counts.post(adjustment.id, user, tx);
      return { type: 'StockAdjustment', id: adjustment.id };
    }
    if (draft.kind === 'DAMAGE') {
      const balance = await this.balance(tx, draft.companyId, draft.branchId, p.productId);
      if (balance.quantityOnHand.minus(balance.quantityReserved).lt(p.quantity))
        throw new ConflictException('Damage cannot consume stock reserved for approved dispatches');
      const damage = await tx.stockDamage.create({
        data: {
          companyId: draft.companyId,
          branchId: draft.branchId,
          productId: p.productId,
          quantity: p.quantity,
          unitId: p._unitId,
          damageType: p.damageType as StockDamageType,
          batchId: p.batchId,
          reportedById: draft.originUserId,
          approvedById: user.id,
          approvedAt: new Date(),
          status: 'APPROVED',
          damageNumber: `PD-${draft.id}`,
          notes: p.reason,
        },
      });
      await this.damage.post(damage.id, user, tx);
      return { type: 'StockDamage', id: damage.id };
    }
    if (draft.kind === 'TRANSFER') {
      await this.scope(
        { companyId: draft.companyId, branchId: p.destinationBranchId },
        user,
        AccessLevel.WRITE,
      );
      const keys = p.lines
        .flatMap((l: JsonRecord) => [
          { branch: draft.branchId, product: l.productId },
          { branch: p.destinationBranchId, product: l.productId },
        ])
        .sort((a: JsonRecord, b: JsonRecord) =>
          `${a.branch}:${a.product}`.localeCompare(`${b.branch}:${b.product}`),
        );
      for (const key of keys) await this.balance(tx, draft.companyId, key.branch, key.product);
      const inventoryAccount = await this.accounts.resolve(draft.companyId, 'INVENTORY_ASSET', tx);
      let total = new Prisma.Decimal(0);
      for (const l of p.lines) {
        const before = await this.balance(tx, draft.companyId, draft.branchId, l.productId);
        if (
          before.quantityOnHand.minus(before.quantityReserved).lt(l.quantity) ||
          before.averageCost.lte(0)
        )
          throw new ConflictException('Insufficient available valued stock for this transfer');
        await this.movements.createMovement({
          companyId: draft.companyId,
          divisionId: draft.divisionId ?? undefined,
          branchId: draft.branchId,
          productId: l.productId,
          unitId: l.unitId,
          movementType: 'TRANSFER_OUT',
          quantity: l.quantity,
          unitCost: Number(before.averageCost),
          transferValue: before.quantityOnHand.eq(l.quantity)
            ? before.totalValue
            : before.averageCost.times(l.quantity).toDecimalPlaces(2),
          movementDate: new Date(date),
          createdById: draft.originUserId,
          auditActorUserId: user.id,
          referenceType: 'PosDraftTransfer',
          referenceId: draft.id,
          tx,
        });
        const after = await tx.inventoryBalance.findUniqueOrThrow({
          where: {
            companyId_productId_branchId: {
              companyId: draft.companyId,
              productId: l.productId,
              branchId: draft.branchId,
            },
          },
        });
        const value = before.totalValue.minus(after.totalValue).toDecimalPlaces(2);
        if (value.lte(0)) throw new BadRequestException('The transfer has no inventory value');
        await this.movements.createMovement({
          companyId: draft.companyId,
          divisionId: p._destinationDivisionId,
          branchId: p.destinationBranchId,
          productId: l.productId,
          unitId: l.unitId,
          movementType: 'TRANSFER_IN',
          quantity: l.quantity,
          unitCost: Number(value.div(l.quantity)),
          transferValue: value,
          movementDate: new Date(date),
          createdById: draft.originUserId,
          auditActorUserId: user.id,
          referenceType: 'PosDraftTransfer',
          referenceId: draft.id,
          tx,
        });
        total = total.plus(value);
      }
      await this.posting.postLines(
        {
          companyId: draft.companyId,
          transactionDate: new Date(date),
          description: `Approved same-company transfer ${draft.id}`,
          referenceType: 'PosDraftTransfer',
          referenceId: draft.id,
          userId: user.id,
          moduleName: 'inventory',
          lines: [
            {
              accountId: inventoryAccount.id,
              debit: Number(total),
              credit: 0,
              divisionId: p._destinationDivisionId,
              branchId: p.destinationBranchId,
            },
            {
              accountId: inventoryAccount.id,
              debit: 0,
              credit: Number(total),
              divisionId: draft.divisionId,
              branchId: draft.branchId,
            },
          ],
        },
        tx,
      );
      return { type: 'PosDraftTransfer', id: draft.id };
    }
    throw new BadRequestException('Unsupported POS Draft kind');
  }
}
