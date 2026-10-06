import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, FuelReport, InventoryMovementType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { DeskPartyLinksService } from '../../common/services/desk-party-links.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CashDeskService } from '../cash-desk/cash-desk.service';
import { checkDailyBalances, payloadKey } from '../cash-desk/cash-desk.domain';
import { applyDeskCashEffect } from '../cash-desk/cash-balance-effect';
import { CashConnectionsService } from '../desk-reports/cash-connections.service';
import { DeskPostingSource, sourceFingerprint } from '../desk-reports/desk-posting.domain';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { calculateReport, ReportCatalog } from '../fuel-reporting/fuel-reporting.calculate';
import { ReportPayloadDto } from '../fuel-reporting/fuel-reporting.dto';
import { PETRODOLLAR_COMPANY_CODE, PetroDollarService } from './petrodollar.service';
import {
  PostPetroDollarDto,
  PetroDollarSelectionsDto,
  ReversePetroDollarDto,
} from './petrodollar-posting.dto';
import { deskKey } from '../invoice-desk/invoice-desk.domain';
import { CASH_EXPENSE_CATEGORIES } from '../cash-desk/cash-desk.dto';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
// JSONB reorders nested keys. Retries must compare values, not object insertion order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const requestKey = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const POST_PERMISSIONS = [
  'fuel_reporting.read',
  'fuel_reporting.manage',
  'sales_desk.view',
  'sales_desk.manage',
  'customers.view',
  'cash_desk.view',
  'cash_desk.record',
  'journal_entries.view',
  'journal_entries.create',
  'journal_entries.post',
  'inventory.view',
  'inventory.adjustments.post',
];
type StockSnapshot = {
  productId: string;
  quantity: string;
  reserved: string;
  averageCost: string;
  value: string;
};
type Evidence = {
  saleIds: string[];
  invoiceIds: string[];
  movementIds: string[];
  journalIds: string[];
  inventoryIds: string[];
  beforeStock: StockSnapshot[];
  afterStock: StockSnapshot[];
};

/** Explicitly reviewed, all-or-nothing posting; paper closure alone never moves money. */
@Injectable()
export class PetroDollarPostingService {
  constructor(
    private readonly db: PrismaService,
    private readonly petro: PetroDollarService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly parties: DeskPartyLinksService,
    private readonly cash: CashDeskService,
    private readonly connections: CashConnectionsService,
    private readonly inventory: InventoryMovementsService,
    private readonly engine: PostingEngineService,
    private readonly audit: AuditLogsService,
  ) {}

  private permission(user: AuthUser, required: string[]) {
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length)
      throw new ForbiddenException(`Posting access is required: ${missing.join(', ')}.`);
  }
  private async report(user: AuthUser, id: string, tx: Tx = this.db) {
    // Includes the company pin and current station access, even for retry/recovery reads.
    await this.petro.revisions(user, id);
    const report = await tx.fuelReport.findUnique({
      where: { id },
      include: { branch: { include: { division: true } } },
    });
    if (!report) throw new NotFoundException('Report not found.');
    const company = await tx.company.findFirst({
      where: {
        id: report.companyId,
        code: PETRODOLLAR_COMPANY_CODE,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    if (
      !company ||
      report.branch.division.companyId !== report.companyId ||
      !report.branch.isActive ||
      report.branch.deletedAt ||
      !report.branch.division.isActive ||
      report.branch.division.deletedAt
    )
      throw new ForbiddenException('This station is no longer available for PetroDollar.');
    return report;
  }
  private fingerprint(report: FuelReport) {
    return payloadKey({
      id: report.id,
      version: report.version,
      date: report.businessDate,
      shift: report.shift,
      payload: report.payload,
      summary: report.summary,
    });
  }
  private requirements(report: FuelReport) {
    const p = report.payload as unknown as ReportPayloadDto;
    return [
      ...POST_PERMISSIONS,
      ...(p.deliveries.length
        ? ['invoice_desk.view', 'invoice_desk.manage', 'suppliers.view']
        : []),
      ...(p.deliveries.some((d) => d.paidAmount > 0) ? ['invoice_desk.payments'] : []),
      ...((report.summary as { flagged?: number }).flagged
        ? ['inventory.adjustments.approve']
        : []),
    ];
  }
  async review(user: AuthUser, id: string) {
    const report = await this.report(user, id);
    this.permission(user, [
      'fuel_reporting.read',
      'journal_entries.view',
      'cash_desk.view',
      'sales_desk.view',
      'customers.view',
      'inventory.view',
    ]);
    const payload = report.payload as unknown as ReportPayloadDto;
    const scope = {
      companyId: report.companyId,
      divisionId: report.branch.divisionId,
      branchId: report.branchId,
    };
    const [customers, suppliers, cash, ledger, balances, postings, profile] = await Promise.all([
      this.parties.choices(user, 'customer', { companyId: report.companyId }),
      payload.deliveries.length
        ? this.parties.choices(user, 'supplier', { companyId: report.companyId })
        : [],
      this.db.cashDeskAccount.findMany({
        where: { ...scope, currency: 'TZS' },
        include: { erpCashAccount: { include: { ledgerAccount: true } } },
        orderBy: { name: 'asc' },
      }),
      this.db.chartOfAccount.findMany({
        where: {
          companyId: report.companyId,
          isActive: true,
          deletedAt: null,
          AND: [
            { OR: [{ divisionId: null }, { divisionId: scope.divisionId }] },
            { OR: [{ branchId: null }, { branchId: scope.branchId }] },
          ],
        },
        select: { id: true, accountCode: true, accountName: true, accountType: true },
        orderBy: { accountCode: 'asc' },
      }),
      this.db.inventoryBalance.findMany({
        where: {
          companyId: report.companyId,
          branchId: report.branchId,
          productId: {
            in: (report.payload as unknown as { catalog: ReportCatalog }).catalog.tanks.map(
              (t) => t.productId,
            ),
          },
        },
      }),
      this.db.fuelReportPosting.findMany({
        where: { reportId: id },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.companyProfile.findUnique({
        where: { companyId: report.companyId },
        select: { currency: true },
      }),
    ]);
    const issues: string[] = [];
    const summary = report.summary as unknown as ReturnType<typeof calculateReport>;
    if (report.status !== 'CLOSED') issues.push('Close and reconcile the shift before posting.');
    if (profile?.currency !== 'TZS') issues.push('The company accounting currency must be TZS.');
    if (!decimal(summary.sales).equals(decimal(summary.collected).plus(summary.credit)))
      issues.push('Collections plus credit sales must equal meter sales before financial posting.');
    if (payload.deliveries.some((d) => !d.totalCost || d.totalCost <= 0))
      issues.push('Enter a positive purchase cost for every delivery before posting.');
    for (const stock of summary.stock) {
      const balance = balances.find((b) => b.productId === stock.productId);
      if (!balance || !balance.quantityOnHand.eq(stock.opening))
        issues.push(
          `${stock.productName}: reconcile Inventory opening stock (${balance?.quantityOnHand.toString() ?? 'not set'}) with the opening dip (${stock.opening} L).`,
        );
      if (stock.opening > 0 && (!balance || !balance.averageCost.gt(0)))
        issues.push(`${stock.productName}: opening inventory must have a verified cost.`);
    }
    const missingPermissions = this.requirements(report).filter(
      (p) => !user.permissions.includes(p),
    );
    return {
      reportId: id,
      version: report.version,
      fingerprint: this.fingerprint(report),
      summary,
      postings,
      customers: customers.map((c) => ({ id: c.id, name: c.name })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
      accounts: cash.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        balance: c.balance.toFixed(2),
        connected:
          !!c.erpCashAccount?.ledgerAccount &&
          c.erpCashAccount.isActive &&
          !c.erpCashAccount.deletedAt &&
          c.erpCashAccount.ledgerAccount.isActive &&
          !c.erpCashAccount.ledgerAccount.deletedAt,
        ledgerAccountId: c.erpCashAccount?.ledgerAccountId ?? null,
      })),
      ledger,
      issues,
      missingPermissions,
      canPost: missingPermissions.length === 0,
    };
  }

  private async snapshot(tx: Tx, report: FuelReport, productId: string): Promise<StockSnapshot> {
    const balance = await tx.inventoryBalance.findUniqueOrThrow({
      where: {
        companyId_productId_branchId: {
          companyId: report.companyId,
          branchId: report.branchId,
          productId,
        },
      },
    });
    return {
      productId,
      quantity: balance.quantityOnHand.toString(),
      reserved: balance.quantityReserved.toString(),
      averageCost: balance.averageCost.toString(),
      value: balance.totalValue.toString(),
    };
  }
  private async lock(tx: Tx, report: FuelReport) {
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${report.branchId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM fuel_reports WHERE id = ${report.id} FOR UPDATE`;
  }
  private async validateSelections(
    tx: Tx,
    user: AuthUser,
    report: FuelReport,
    s: PetroDollarSelectionsDto,
  ) {
    const p = report.payload as unknown as ReportPayloadDto;
    if (
      s.credits.length !== p.creditSales.length ||
      s.deliveries.length !== p.deliveries.length ||
      s.expenses.length !== p.expenses.length
    )
      throw new BadRequestException(
        'Link every credit sale, delivery and expense in this revision.',
      );
    const roles = {
      receivableAccountId: ['ASSET'],
      revenueAccountId: ['INCOME'],
      payableAccountId: ['LIABILITY'],
      inventoryAccountId: ['ASSET'],
      costAccountId: ['COST_OF_GOODS_SOLD'],
      expenseAccountId: ['EXPENSE'],
      varianceAccountId: ['EXPENSE', 'COST_OF_GOODS_SOLD'],
    };
    const ids = Object.keys(roles).map((k) => s[k as keyof typeof roles]);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'Choose separate control, revenue, cost, expense and variance ledger accounts.',
      );
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: report.branchId } });
    const accounts = await tx.chartOfAccount.findMany({
      where: {
        id: { in: ids },
        companyId: report.companyId,
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ divisionId: null }, { divisionId: branch.divisionId }] },
          { OR: [{ branchId: null }, { branchId: report.branchId }] },
        ],
      },
    });
    for (const [key, types] of Object.entries(roles)) {
      const account = accounts.find((a) => a.id === s[key as keyof typeof roles]);
      if (!account || !types.includes(account.accountType))
        throw new BadRequestException(
          `Choose an active, compatible ${key.replace('AccountId', '')} account in this organisation.`,
        );
    }
    const usedCashIds = [
      ...new Set(
        [
          s.cashAccountId,
          s.mobileAccountId,
          s.bankAccountId,
          ...s.deliveries.map((d) => d.accountId),
          ...s.expenses.map((e) => e.accountId),
        ].filter((id): id is string => !!id),
      ),
    ].sort();
    for (const id of usedCashIds) {
      await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${id} FOR UPDATE`;
      const account = await tx.cashDeskAccount.findUnique({
        where: { id },
        include: { erpCashAccount: { include: { ledgerAccount: true } } },
      });
      const bank = account?.erpCashAccount,
        ledger = bank?.ledgerAccount;
      if (
        !account ||
        account.companyId !== report.companyId ||
        account.branchId !== report.branchId ||
        account.currency !== 'TZS' ||
        !bank ||
        !ledger ||
        !bank.isActive ||
        bank.deletedAt ||
        bank.companyId !== report.companyId ||
        bank.currency !== 'TZS' ||
        (bank.branchId && bank.branchId !== report.branchId) ||
        (bank.divisionId && bank.divisionId !== branch.divisionId) ||
        !ledger.isActive ||
        ledger.deletedAt ||
        ledger.accountType !== 'ASSET' ||
        ledger.companyId !== report.companyId ||
        (ledger.branchId && ledger.branchId !== report.branchId) ||
        (ledger.divisionId && ledger.divisionId !== branch.divisionId) ||
        ids.includes(ledger.id)
      )
        throw new BadRequestException(
          'Every payment account must have its own active, connected TZS cash ledger account at this station.',
        );
    }
    for (const [amount, id, label] of [
      [p.collections.cash, s.cashAccountId, 'cash'],
      [p.collections.mobile, s.mobileAccountId, 'mobile money'],
      [p.collections.bank, s.bankAccountId, 'bank/card'],
    ] as const)
      if (amount && !id) throw new BadRequestException(`Choose the receiving ${label} account.`);
    for (let i = 0; i < p.deliveries.length; i++) {
      const d = p.deliveries[i];
      if (!d.totalCost || d.totalCost <= 0 || d.paidAmount > d.totalCost)
        throw new BadRequestException(
          'Every delivery needs a positive cost and a payment within that amount.',
        );
      if (d.paidAmount && !s.deliveries[i].accountId)
        throw new BadRequestException('Choose the payment account for every paid delivery.');
      if (
        d.paymentSource === 'SHIFT_CASH' &&
        d.paidAmount &&
        s.deliveries[i].accountId !== s.cashAccountId
      )
        throw new BadRequestException(
          'A shift-cash supplier payment must use the cash collection account.',
        );
    }
    for (let i = 0; i < p.expenses.length; i++)
      if (
        p.expenses[i].paymentSource === 'SHIFT_CASH' &&
        s.expenses[i].accountId !== s.cashAccountId
      )
        throw new BadRequestException('A shift-cash expense must use the cash collection account.');
    await this.companies.assertCanAccessCompany(user, report.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, branch.divisionId, branch.id, AccessLevel.WRITE);
  }
  private dueDate(value: string, report: FuelReport) {
    const date = new Date(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value ||
      date < report.businessDate
    )
      throw new BadRequestException('Due dates must be valid and on or after the business date.');
    return date;
  }
  private async journal(
    tx: Tx,
    user: AuthUser,
    report: FuelReport,
    input: {
      referenceType: string;
      referenceId: string;
      description: string;
      lines: { accountId: string; debit?: Prisma.Decimal; credit?: Prisma.Decimal }[];
    },
  ) {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: report.branchId } });
    return this.engine.postLines(
      {
        ...input,
        companyId: report.companyId,
        divisionId: branch.divisionId,
        branchId: report.branchId,
        transactionDate: report.businessDate,
        journalNumber: `JE-PD-${randomUUID()}`,
        userId: user.id,
        moduleName: 'PetroDollar',
      },
      tx,
    );
  }

  async post(user: AuthUser, id: string, dto: PostPetroDollarDto) {
    const initial = await this.report(user, id);
    this.permission(user, this.requirements(initial));
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, initial);
        const report = await this.report(user, id, tx);
        const key = requestKey({ reportId: id, ...dto });
        const retry = await tx.fuelReportPosting.findUnique({
          where: { requestId: dto.requestId },
        });
        if (retry) {
          if (
            retry.reportId !== id ||
            retry.createdBy !== user.id ||
            requestKey({
              reportId: id,
              requestId: retry.requestId,
              version: retry.reportVersion,
              fingerprint: retry.fingerprint,
              selections: retry.selections,
            }) !== key
          )
            throw new ConflictException('This posting request reference was already used.');
          return retry;
        }
        if (
          report.status !== 'CLOSED' ||
          report.version !== dto.version ||
          this.fingerprint(report) !== dto.fingerprint
        )
          throw new ConflictException('The closed shift changed. Review it again before posting.');
        if (await tx.fuelReportPosting.count({ where: { reportId: id, reversedAt: null } }))
          throw new ConflictException(
            'This shift is already posted. Refresh to see its linked records.',
          );
        const p = report.payload as unknown as ReportPayloadDto & { catalog: ReportCatalog };
        const summary = report.summary as unknown as ReturnType<typeof calculateReport>;
        if (!decimal(summary.sales).eq(decimal(summary.collected).plus(summary.credit)))
          throw new BadRequestException(
            'Collections plus credit sales must equal meter sales before posting.',
          );
        if (
          (await tx.companyProfile.findUnique({ where: { companyId: report.companyId } }))
            ?.currency !== 'TZS'
        )
          throw new BadRequestException('The company accounting currency must be TZS.');
        await this.validateSelections(tx, user, report, dto.selections);
        const s = dto.selections;
        const beforeStock: StockSnapshot[] = [];
        const products = await tx.product.findMany({
          where: {
            id: { in: summary.stock.map((r) => r.productId) },
            companyId: report.companyId,
            status: 'ACTIVE',
            deletedAt: null,
          },
          include: { baseUnit: true },
        });
        for (const stock of [...summary.stock].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          const product = products.find((r) => r.id === stock.productId);
          if (
            !product ||
            !product.trackInventory ||
            !['l', 'litre', 'liter', 'litres', 'liters'].includes(
              product.baseUnit.symbol.toLowerCase(),
            ) ||
            (product.divisionId && product.divisionId !== report.branch.divisionId)
          )
            throw new BadRequestException(
              `${stock.productName} must be an active inventory product measured in litres in this division.`,
            );
          await tx.$queryRaw`SELECT id FROM inventory_balances WHERE "companyId" = ${report.companyId} AND "branchId" = ${report.branchId} AND "productId" = ${stock.productId} FOR UPDATE`;
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              companyId_productId_branchId: {
                companyId: report.companyId,
                productId: stock.productId,
                branchId: report.branchId,
              },
            },
          });
          if (
            !balance ||
            !balance.quantityOnHand.eq(stock.opening) ||
            (stock.opening > 0 && !balance.averageCost.gt(0))
          )
            throw new ConflictException(
              `Reconcile ${stock.productName} opening quantity and cost in Inventory before posting.`,
            );
          beforeStock.push(await this.snapshot(tx, report, stock.productId));
        }
        const evidence: Evidence = {
          saleIds: [],
          invoiceIds: [],
          movementIds: [],
          journalIds: [],
          inventoryIds: [],
          beforeStock,
          afterStock: [],
        };
        const posting = await tx.fuelReportPosting.create({
          data: {
            reportId: id,
            reportVersion: report.version,
            requestId: dto.requestId,
            fingerprint: dto.fingerprint,
            selections: json(s),
            evidence: json(evidence),
            createdBy: user.id,
          },
        });
        const scope = {
          companyId: report.companyId,
          divisionId: report.branch.divisionId,
          branchId: report.branchId,
        };
        const reference = `PD-${report.businessDate.toISOString().slice(0, 10)}-${report.shift}-${id.slice(0, 8)}-V${report.version}`;
        const addSale = async (customer: string, amount: number, label: string, dueDate: Date) => {
          const customerId = await this.parties.resolve(
            tx,
            user,
            'customer',
            customer,
            report.companyId,
          );
          const saleNumber = `${reference}-S${evidence.saleIds.length + 1}`;
          const sale = await tx.salesDeskSale.create({
            data: {
              ...scope,
              fuelReportPostingId: posting.id,
              requestId: randomUUID(),
              payloadKey: key,
              customerId,
              saleNumber,
              numberKey: saleNumber,
              currency: 'TZS',
              saleDate: report.businessDate,
              dueDate,
              totalAmount: decimal(amount),
              createdBy: user.id,
              notes: `PetroDollar shift ${id}. ${label}`,
              lines: {
                create: [
                  {
                    position: 1,
                    description: label.slice(0, 250),
                    quantity: 1,
                    unitPrice: decimal(amount),
                    totalAmount: decimal(amount),
                  },
                ],
              },
            },
          });
          const source: DeskPostingSource = {
            id: sale.id,
            kind: 'sales',
            ...scope,
            reference: saleNumber,
            currency: 'TZS',
            date: report.businessDate.toISOString().slice(0, 10),
            amount: sale.totalAmount.toFixed(2),
            partyId: customerId,
            voided: false,
          };
          evidence.saleIds.push(sale.id);
          evidence.journalIds.push(
            (
              await this.journal(tx, user, report, {
                referenceType: 'DeskSale',
                referenceId: sale.id,
                description: `Sales Desk ${saleNumber} [desk-source:${sourceFingerprint(source)}]`,
                lines: [
                  { accountId: s.receivableAccountId, debit: sale.totalAmount },
                  { accountId: s.revenueAccountId, credit: sale.totalAmount },
                ],
              })
            ).id,
          );
          await tx.salesDeskEvent.create({
            data: {
              saleId: sale.id,
              actorId: user.id,
              actorName: user.fullName || user.email,
              action: 'CREATED',
              detail: `Posted from PetroDollar ${reference}`,
            },
          });
          return sale;
        };
        const addCash = async (
          input: Omit<
            Parameters<CashDeskService['recordFuelMovement']>[2],
            'postingId' | 'companyId' | 'branchId' | 'date' | 'requestId'
          >,
          offsetAccountId?: string,
        ) => {
          const movement = await this.cash.recordFuelMovement(tx, user, {
            ...input,
            postingId: posting.id,
            ...scope,
            date: report.businessDate,
            requestId: randomUUID(),
          });
          const review = await this.connections.review(user, movement.id, tx);
          const journal = await this.connections.post(
            user,
            movement.id,
            { fingerprint: review.fingerprint, offsetAccountId },
            tx,
          );
          evidence.movementIds.push(movement.id);
          evidence.journalIds.push(journal.id);
          return movement;
        };
        if (summary.collected > 0) {
          if (!s.retailCustomerId)
            throw new BadRequestException('Select the existing walk-in/retail customer profile.');
          const sale = await addSale(
            s.retailCustomerId,
            summary.collected,
            `Fuel sales collected · ${reference}`,
            report.businessDate,
          );
          for (const [amount, accountId, label] of [
            [p.collections.cash, s.cashAccountId, 'Cash'],
            [p.collections.mobile, s.mobileAccountId, 'Mobile money'],
            [p.collections.bank, s.bankAccountId, 'Bank/card'],
          ] as const) {
            if (!amount) continue;
            const payment = await tx.salesDeskPayment.create({
              data: {
                saleId: sale.id,
                requestId: randomUUID(),
                payloadKey: key,
                amount: decimal(amount),
                paymentDate: report.businessDate,
                reference: `${reference} ${label}`,
                createdBy: user.id,
              },
            });
            await addCash({
              accountId: accountId!,
              amount: decimal(amount),
              kind: 'SALE_RECEIPT',
              reference: `${reference} ${label}`,
              description: `${label} fuel collection · ${reference}`,
              salesPaymentId: payment.id,
            });
          }
          await tx.salesDeskSale.update({
            where: { id: sale.id },
            data: { paidAmount: sale.totalAmount },
          });
        }
        for (let i = 0; i < p.creditSales.length; i++)
          await addSale(
            s.credits[i].customerId,
            p.creditSales[i].amount,
            `Fuel credit · ${p.creditSales[i].reference || reference}`,
            this.dueDate(s.credits[i].dueDate, report),
          );
        // Receive at a verified cost before issuing fuel. Each movement uses the canonical WAC engine.
        for (let i = 0; i < p.deliveries.length; i++) {
          const delivery = p.deliveries[i],
            link = s.deliveries[i];
          const supplierId = await this.parties.resolve(
            tx,
            user,
            'supplier',
            link.supplierId,
            report.companyId,
          );
          const invoiceNumber = delivery.reference.trim() || `${reference}-D${i + 1}`;
          if (invoiceNumber.length > 100)
            throw new BadRequestException(
              'Delivery invoice references must be at most 100 characters.',
            );
          const numberKey = deskKey(invoiceNumber);
          if (
            await tx.invoiceDeskInvoice.count({
              where: { companyId: report.companyId, supplierId, numberKey },
            })
          )
            throw new ConflictException(
              `Supplier invoice ${invoiceNumber} already exists. Resolve the duplicate before posting this delivery.`,
            );
          const invoice = await tx.invoiceDeskInvoice.create({
            data: {
              ...scope,
              fuelReportPostingId: posting.id,
              supplierId,
              invoiceNumber,
              numberKey,
              description: `Fuel received · ${reference}`,
              currency: 'TZS',
              invoiceDate: report.businessDate,
              dueDate: this.dueDate(link.dueDate, report),
              totalAmount: decimal(delivery.totalCost!),
              paidAmount: decimal(delivery.paidAmount),
            },
          });
          evidence.invoiceIds.push(invoice.id);
          const product = products.find((r) => r.id === delivery.productId)!;
          const before = await this.snapshot(tx, report, product.id);
          const unitCost = decimal(delivery.totalCost!).div(delivery.litres).toDecimalPlaces(4);
          const movement = await this.inventory.createMovement({
            ...scope,
            productId: product.id,
            unitId: product.baseUnitId,
            movementType: 'PURCHASE_RECEIPT',
            quantity: delivery.litres,
            unitCost: unitCost.toNumber(),
            receiptValue: invoice.totalAmount,
            movementDate: report.businessDate,
            createdById: user.id,
            referenceType: 'PetroDollar',
            referenceId: posting.id,
            notes: invoiceNumber,
            tx,
          });
          const after = await this.snapshot(tx, report, product.id);
          if (!decimal(after.value).minus(before.value).eq(invoice.totalAmount))
            throw new BadRequestException(
              'The received stock value does not agree with the supplier invoice.',
            );
          evidence.inventoryIds.push(movement.id);
          const source: DeskPostingSource = {
            id: invoice.id,
            kind: 'purchases',
            ...scope,
            reference: invoiceNumber,
            currency: 'TZS',
            date: report.businessDate.toISOString().slice(0, 10),
            amount: invoice.totalAmount.toFixed(2),
            partyId: supplierId,
            voided: false,
          };
          evidence.journalIds.push(
            (
              await this.journal(tx, user, report, {
                referenceType: 'DeskPurchase',
                referenceId: invoice.id,
                description: `Invoice Desk ${invoiceNumber} [desk-source:${sourceFingerprint(source)}]`,
                lines: [
                  { accountId: s.inventoryAccountId, debit: invoice.totalAmount },
                  { accountId: s.payableAccountId, credit: invoice.totalAmount },
                ],
              })
            ).id,
          );
          await tx.invoiceDeskEvent.create({
            data: {
              invoiceId: invoice.id,
              actorId: user.id,
              actorName: user.fullName || user.email,
              action: 'CREATED',
              detail: `Posted from PetroDollar ${reference}`,
            },
          });
          if (delivery.paidAmount) {
            const payment = await tx.invoiceDeskPayment.create({
              data: {
                invoiceId: invoice.id,
                requestId: randomUUID(),
                amount: decimal(delivery.paidAmount),
                paymentDate: report.businessDate,
                method: 'Other',
                reference: invoiceNumber,
                createdBy: user.id,
              },
            });
            await addCash({
              accountId: link.accountId!,
              amount: payment.amount,
              kind: 'SUPPLIER_PAYMENT',
              reference: invoiceNumber,
              description: `Fuel supplier payment · ${invoiceNumber}`,
              invoicePaymentId: payment.id,
            });
          }
        }
        for (let i = 0; i < p.expenses.length; i++)
          await addCash(
            {
              accountId: s.expenses[i].accountId,
              amount: decimal(p.expenses[i].amount),
              kind: 'EXPENSE',
              reference,
              description: p.expenses[i].description,
              expenseCategory:
                CASH_EXPENSE_CATEGORIES.find(
                  (c) => c === p.expenses[i].category.trim().toUpperCase(),
                ) ?? 'OTHER',
              expenseNotes: `Station category: ${p.expenses[i].category}`,
            },
            s.expenseAccountId,
          );
        for (const stock of summary.stock) {
          const product = products.find((r) => r.id === stock.productId)!;
          const move = async (type: InventoryMovementType, quantity: number) => {
            const before = await this.snapshot(tx, report, product.id);
            const movement = await this.inventory.createMovement({
              ...scope,
              productId: product.id,
              unitId: product.baseUnitId,
              movementType: type,
              quantity,
              unitCost: decimal(before.averageCost).toNumber(),
              movementDate: report.businessDate,
              createdById: user.id,
              referenceType: 'PetroDollar',
              referenceId: posting.id,
              notes: reference,
              tx,
            });
            evidence.inventoryIds.push(movement.id);
            const after = await this.snapshot(tx, report, product.id);
            const value = decimal(after.value).minus(before.value);
            if (!value.isZero())
              evidence.journalIds.push(
                (
                  await this.journal(tx, user, report, {
                    referenceType: 'PetroDollar',
                    referenceId: posting.id,
                    description: `${type === 'SALE_ISSUE' ? 'Fuel cost of sales' : 'Fuel dip variance'} · ${reference}`,
                    lines: value.gt(0)
                      ? [
                          { accountId: s.inventoryAccountId, debit: value },
                          { accountId: s.varianceAccountId, credit: value },
                        ]
                      : [
                          {
                            accountId:
                              type === 'SALE_ISSUE' ? s.costAccountId : s.varianceAccountId,
                            debit: value.abs(),
                          },
                          { accountId: s.inventoryAccountId, credit: value.abs() },
                        ],
                  })
                ).id,
              );
          };
          if (stock.sold > 0) await move('SALE_ISSUE', stock.sold);
          if (stock.difference)
            await move(
              stock.difference > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              Math.abs(stock.difference),
            );
          const after = await this.snapshot(tx, report, product.id);
          if (stock.actual == null || !decimal(after.quantity).eq(stock.actual))
            throw new ConflictException(
              'Closing inventory does not agree with the recorded tank dip.',
            );
          evidence.afterStock.push(after);
        }
        await this.audit.logStrictInTransaction(tx, {
          action: 'PETRODOLLAR_POST',
          entityType: 'FuelReport',
          entityId: id,
          companyId: report.companyId,
          userId: user.id,
          metadata: { postingId: posting.id, version: report.version },
        });
        return tx.fuelReportPosting.update({
          where: { id: posting.id },
          data: { evidence: json(evidence) },
        });
      },
      { timeout: 60000 },
    );
  }

  async reverse(user: AuthUser, id: string, dto: ReversePetroDollarDto) {
    const report = await this.report(user, id);
    this.permission(user, [
      ...this.requirements(report),
      'cash_desk.reverse',
      'journal_entries.reverse',
    ]);
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Explain why the entire shift posting must be reversed.');
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, report);
        const currentReport = await this.report(user, id, tx);
        await this.companies.assertCanAccessCompany(
          user,
          currentReport.companyId,
          AccessLevel.WRITE,
        );
        await this.org.assertCanAccessScope(
          user,
          currentReport.branch.divisionId,
          currentReport.branchId,
          AccessLevel.WRITE,
        );
        const posting = await tx.fuelReportPosting.findFirst({
          where: { id: dto.postingId, reportId: id },
        });
        if (!posting) throw new NotFoundException('Shift posting not found.');
        if (posting.reversedAt) return posting;
        const latest = await tx.fuelReport.findFirst({
          where: { branchId: report.branchId, status: 'CLOSED' },
          orderBy: [{ businessDate: 'desc' }, { shift: 'desc' }],
        });
        if (latest?.id !== id)
          throw new ConflictException('Reverse and reopen later shifts first.');
        const e = posting.evidence as unknown as Evidence;
        const sales = await tx.salesDeskSale.findMany({
          where: { fuelReportPostingId: posting.id },
          include: { payments: true },
        });
        for (const sale of sales.sort((a, b) => a.id.localeCompare(b.id)))
          await tx.$queryRaw`SELECT id FROM sales_desk_sales WHERE id = ${sale.id} FOR UPDATE`;
        const invoices = await tx.invoiceDeskInvoice.findMany({
          where: { fuelReportPostingId: posting.id },
          include: { payments: true },
        });
        const movements = await tx.cashDeskMovement.findMany({
          where: { fuelReportPostingId: posting.id },
          include: { entries: true },
        });
        const ownedSalesPayments = new Set(movements.map((m) => m.salesPaymentId).filter(Boolean));
        const ownedInvoicePayments = new Set(
          movements.map((m) => m.invoicePaymentId).filter(Boolean),
        );
        // Lock documents and reread before checking downstream payments.
        const accountIds = [
          ...new Set(movements.flatMap((m) => m.entries.map((x) => x.accountId))),
        ].sort();
        const cashAccounts = await tx.cashDeskAccount.findMany({
          where: { id: { in: accountIds } },
        });
        for (const erpId of [
          ...new Set(cashAccounts.flatMap((a) => (a.erpCashAccountId ? [a.erpCashAccountId] : []))),
        ].sort())
          await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${erpId} FOR UPDATE`;
        for (const accountId of accountIds)
          await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${accountId} FOR UPDATE`;
        for (const invoice of invoices.sort((a, b) => a.id.localeCompare(b.id)))
          await tx.$queryRaw`SELECT id FROM invoice_desk_invoices WHERE id = ${invoice.id} FOR UPDATE`;
        if (
          (await tx.salesDeskPayment.count({
            where: {
              saleId: { in: e.saleIds },
              reversedAt: null,
              id: { notIn: [...ownedSalesPayments] as string[] },
            },
          })) ||
          (await tx.invoiceDeskPayment.count({
            where: {
              invoiceId: { in: e.invoiceIds },
              reversedAt: null,
              id: { notIn: [...ownedInvoicePayments] as string[] },
            },
          }))
        )
          throw new ConflictException(
            'Reverse later customer collections or supplier payments in Cash Desk before reversing this shift.',
          );
        if (
          movements.some((m) => m.reversedAt) ||
          sales.some((s) => s.voidedAt) ||
          invoices.some((i) => i.voidedAt)
        )
          throw new ConflictException(
            'A linked record changed. Review the shift posting before reversing.',
          );
        for (const before of e.beforeStock) {
          await tx.$queryRaw`SELECT id FROM inventory_balances WHERE "companyId" = ${report.companyId} AND "branchId" = ${report.branchId} AND "productId" = ${before.productId} FOR UPDATE`;
          const current = await this.snapshot(tx, report, before.productId),
            after = e.afterStock.find((a) => a.productId === before.productId)!;
          if (
            requestKey(current) !== requestKey(after) ||
            (await tx.inventoryMovement.count({
              where: {
                companyId: report.companyId,
                branchId: report.branchId,
                productId: before.productId,
                createdAt: { gte: posting.createdAt },
                NOT: { referenceType: 'PetroDollar', referenceId: posting.id },
              },
            }))
          )
            throw new ConflictException(
              'Inventory has later activity or changed reservations. Reverse that activity before this shift.',
            );
        }
        const reason = dto.reason.trim(),
          reversalDate = report.businessDate;
        const cashReversals = new Map<string, string>();
        // Positive compensating legs first, then expenses, so each day remains non-negative.
        for (const movement of [...movements].sort(
          (a, b) => Number(b.kind !== 'SALE_RECEIPT') - Number(a.kind !== 'SALE_RECEIPT'),
        )) {
          const reversal = await tx.cashDeskMovement.create({
            data: {
              fuelReportPostingId: posting.id,
              requestId: randomUUID(),
              payloadKey: payloadKey({ reversalOfId: movement.id, postingId: posting.id }),
              kind: 'REVERSAL',
              amount: movement.amount,
              currency: movement.currency,
              businessDate: reversalDate,
              description: reason,
              reference: movement.reference,
              createdBy: user.id,
              actorName: user.fullName || user.email,
              reversalOfId: movement.id,
            },
          });
          cashReversals.set(movement.id, reversal.id);
          for (const entry of movement.entries) {
            const account = await tx.cashDeskAccount.findUniqueOrThrow({
              where: { id: entry.accountId },
            });
            if (
              account.erpCashAccountId !==
              cashAccounts.find((a) => a.id === account.id)?.erpCashAccountId
            )
              throw new ConflictException(
                'The cash account connection changed. Review the shift again.',
              );
            const daily = await tx.cashDeskEntry.groupBy({
              by: ['businessDate'],
              where: { accountId: account.id },
              _sum: { amount: true },
            });
            const amount = entry.amount.negated();
            const balance = checkDailyBalances(
              daily.map((d) => ({ businessDate: d.businessDate, amount: d._sum.amount! })),
              reversalDate,
              amount,
            );
            const erpBalanceApplied = await applyDeskCashEffect(tx, account, amount, movement.id);
            await tx.cashDeskEntry.create({
              data: {
                movementId: reversal.id,
                accountId: account.id,
                businessDate: reversalDate,
                amount,
                erpBalanceApplied,
              },
            });
            await tx.cashDeskAccount.update({
              where: { id: account.id },
              data: { balance, version: { increment: 1 } },
            });
          }
          await tx.cashDeskMovement.update({
            where: { id: movement.id },
            data: { reversedAt: new Date(), reversalReason: reason },
          });
          if (movement.salesPaymentId)
            await tx.salesDeskPayment.update({
              where: { id: movement.salesPaymentId },
              data: { reversedAt: new Date(), reversalReason: reason },
            });
          if (movement.invoicePaymentId)
            await tx.invoiceDeskPayment.update({
              where: { id: movement.invoicePaymentId },
              data: { reversedAt: new Date(), reversalReason: reason },
            });
        }
        const originals = await tx.inventoryMovement.findMany({
          where: { id: { in: e.inventoryIds } },
        });
        // The inverse movements document quantity compensation; verified snapshots restore exact WAC and value.
        const inverse: Partial<Record<InventoryMovementType, InventoryMovementType>> = {
          PURCHASE_RECEIPT: 'PURCHASE_RETURN',
          SALE_ISSUE: 'SALES_RETURN',
          ADJUSTMENT_IN: 'ADJUSTMENT_OUT',
          ADJUSTMENT_OUT: 'ADJUSTMENT_IN',
        };
        for (const movementId of [...e.inventoryIds].reverse()) {
          const original = originals.find((m) => m.id === movementId)!;
          await this.inventory.createMovement({
            companyId: original.companyId,
            divisionId: original.divisionId ?? undefined,
            branchId: report.branchId,
            productId: original.productId,
            unitId: original.unitId,
            movementType: inverse[original.movementType]!,
            quantity: original.quantity.toNumber(),
            unitCost: original.unitCost?.toNumber(),
            movementDate: reversalDate,
            createdById: user.id,
            referenceType: 'PetroDollarReversal',
            referenceId: posting.id,
            notes: reason,
            tx,
          });
        }
        for (const before of e.beforeStock)
          await tx.inventoryBalance.update({
            where: {
              companyId_productId_branchId: {
                companyId: report.companyId,
                productId: before.productId,
                branchId: report.branchId,
              },
            },
            data: {
              quantityOnHand: decimal(before.quantity),
              // Holds are owned by their reservation records. Movement expiry
              // may have released one since the snapshot; never resurrect it.
              averageCost: decimal(before.averageCost),
              totalValue: decimal(before.value),
              physicalRevision: { increment: 1 },
            },
          });
        for (const journalId of e.journalIds) {
          const original = await tx.journalEntry.findUniqueOrThrow({
            where: { id: journalId },
            include: { lines: true },
          });
          if (original.status !== 'POSTED' || original.deletedAt || original.reversalOfId)
            throw new ConflictException(
              'A linked journal changed. Review it before reversing the shift.',
            );
          const reversal = await this.journal(tx, user, report, {
            referenceType: original.referenceType!,
            referenceId:
              original.referenceType === 'DeskCash'
                ? cashReversals.get(original.referenceId!)!
                : original.referenceId!,
            description: `PetroDollar reversal · ${reason}`,
            lines: original.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
            })),
          });
          await tx.journalEntry.update({
            where: { id: reversal.id },
            data: { reversalOfId: original.id },
          });
          await tx.journalEntry.update({
            where: { id: original.id },
            data: {
              status: 'REVERSED',
              reversedAt: new Date(),
              reversedById: user.id,
              reversalReason: reason,
            },
          });
        }
        await tx.salesDeskSale.updateMany({
          where: { id: { in: e.saleIds } },
          data: { paidAmount: 0, voidedAt: new Date(), version: { increment: 1 } },
        });
        for (const invoiceId of e.invoiceIds)
          await tx.invoiceDeskInvoice.update({
            where: { id: invoiceId },
            data: {
              paidAmount: 0,
              voidedAt: new Date(),
              version: { increment: 1 },
              numberKey: `VOID-PD-${invoiceId}`,
            },
          });
        await this.audit.logStrictInTransaction(tx, {
          action: 'PETRODOLLAR_REVERSE',
          entityType: 'FuelReport',
          entityId: id,
          companyId: report.companyId,
          userId: user.id,
          metadata: { postingId: posting.id, reason },
        });
        return tx.fuelReportPosting.update({
          where: { id: posting.id },
          data: { reversedAt: new Date(), reversedBy: user.id, reversalReason: reason },
        });
      },
      { timeout: 60000 },
    );
  }
}
