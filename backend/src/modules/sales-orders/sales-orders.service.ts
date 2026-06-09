import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AccountResolverService, AccountRole, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSalesOrderDto, SalesOrderLineDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  CurrencyCode,
  PaymentStatus,
  Prisma,
  SalesPaymentMethod,
  SalesType,
} from '@prisma/client';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';

type SalesOrderReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  salespersonId?: string | null;
  cashAccountId?: string | null;
  paymentMethod?: SalesPaymentMethod | null;
  lines?: SalesOrderLineDto[];
};

type LinkedReceivableSnapshot = {
  id: string;
  sourceId: string | null;
  paidAmount: Prisma.Decimal | number | string;
  outstandingAmount: Prisma.Decimal | number | string;
  status: string;
};

const RECEIPT_ACCOUNT_TYPES = [
  CashAccountType.CASH_ON_HAND,
  CashAccountType.PETTY_CASH,
  CashAccountType.BANK,
  CashAccountType.MOBILE_MONEY,
  CashAccountType.OTHER,
];

function accountTypesForPaymentMethod(method?: SalesPaymentMethod | null): CashAccountType[] {
  switch (method) {
    case SalesPaymentMethod.CASH:
      return [CashAccountType.CASH_ON_HAND, CashAccountType.PETTY_CASH];
    case SalesPaymentMethod.BANK_CARD:
    case SalesPaymentMethod.BANK_TRANSFER:
      return [CashAccountType.BANK];
    case SalesPaymentMethod.MOBILE_MONEY:
      return [CashAccountType.MOBILE_MONEY];
    case SalesPaymentMethod.MIXED:
    case SalesPaymentMethod.OTHER:
      return RECEIPT_ACCOUNT_TYPES;
    default:
      return [];
  }
}

function cashAccountRole(accountType?: CashAccountType | null): AccountRole {
  return accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizePaymentMethodForSalesType(
  salesType: SalesType,
  paymentMethod?: SalesPaymentMethod | null,
): SalesPaymentMethod {
  if (salesType === SalesType.CASH_SALE || salesType === SalesType.RETAIL) {
    return paymentMethod && paymentMethod !== SalesPaymentMethod.CREDIT
      ? paymentMethod
      : SalesPaymentMethod.CASH;
  }

  if (salesType === SalesType.CREDIT_SALE) {
    return SalesPaymentMethod.CREDIT;
  }

  return paymentMethod ?? SalesPaymentMethod.CREDIT;
}

function calculateLineTotals(
  lines: {
    productId: string;
    description?: string;
    quantity: number;
    unitId: string;
    unitPrice: number;
    discountAmount?: number;
    taxAmount?: number;
    batchId?: string;
  }[],
) {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  const computed = lines.map((line) => {
    const qty = Number(line.quantity);
    const price = Number(line.unitPrice);
    const discount = Number(line.discountAmount ?? 0);
    const tax = Number(line.taxAmount ?? 0);
    // Defensive server-side validation (ITMB-003/ITMB-041): reject quantities,
    // prices, discounts or taxes that would corrupt totals or inventory. The
    // DTO already enforces these, but recompute here so update() (which can
    // reuse stored lines) and any future caller cannot bypass the guard.
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('Sales order line quantity must be greater than zero');
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException('Sales order line unit price cannot be negative');
    }
    if (!Number.isFinite(discount) || discount < 0) {
      throw new BadRequestException('Sales order line discount cannot be negative');
    }
    if (!Number.isFinite(tax) || tax < 0) {
      throw new BadRequestException('Sales order line tax cannot be negative');
    }
    const extended = qty * price;
    if (discount > extended) {
      throw new BadRequestException(
        'Sales order line discount cannot exceed the line amount (quantity x unit price)',
      );
    }
    const lineTotal = extended - discount + tax;
    subtotal += extended;
    totalDiscount += discount;
    totalTax += tax;
    return { ...line, lineTotal };
  });

  const totalAmount = subtotal - totalDiscount + totalTax;
  return { computed, subtotal, totalDiscount, totalTax, totalAmount };
}

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly taxAutoApply: TaxAutoApplyService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async findAll(query: QuerySalesOrderDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      customerId,
      salesType,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (salesType) where.salesType = salesType;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.orderDate.lte = dateRangeEnd(dateTo);
    }
    if (search) {
      where.OR = [
        { salesOrderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true, name: true } },
          receivable: {
            select: {
              id: true,
              sourceId: true,
              paidAmount: true,
              outstandingAmount: true,
              status: true,
            },
          },
          lines: {
            include: {
              product: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true, symbol: true } },
            },
          },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    const sourceReceivables = await this.findSalesOrderSourceReceivables(
      data.map((order) => order.id),
    );

    return {
      data: data.map((order) =>
        this.withReceivablePaymentSnapshot(order, sourceReceivables.get(order.id)),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.salesOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            website: true,
            logoUrl: true,
            group: {
              select: {
                name: true,
                code: true,
                address: true,
                phone: true,
                email: true,
                website: true,
              },
            },
            profile: {
              select: {
                registeredName: true,
                tradingName: true,
                brelaRegNumber: true,
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
        customer: { select: { id: true, name: true } },
        receivable: {
          select: {
            id: true,
            sourceId: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
          },
        },
        createdBy: { select: { id: true, fullName: true } },
        confirmedBy: { select: { id: true, fullName: true } },
        cashAccount: { select: { id: true, accountName: true, accountType: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales order not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }

    const sourceReceivable = record.receivable
      ? null
      : await this.prisma.receivable.findFirst({
          where: { sourceType: 'SalesOrder', sourceId: id, deletedAt: null },
          select: {
            id: true,
            sourceId: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

    return this.withReceivablePaymentSnapshot(record, sourceReceivable);
  }

  private async findSalesOrderSourceReceivables(salesOrderIds: string[]) {
    if (salesOrderIds.length === 0) return new Map<string, LinkedReceivableSnapshot>();

    const receivables = await this.prisma.receivable.findMany({
      where: { sourceType: 'SalesOrder', sourceId: { in: salesOrderIds }, deletedAt: null },
      select: {
        id: true,
        sourceId: true,
        paidAmount: true,
        outstandingAmount: true,
        status: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const bySalesOrderId = new Map<string, LinkedReceivableSnapshot>();
    for (const receivable of receivables) {
      if (receivable.sourceId && !bySalesOrderId.has(receivable.sourceId)) {
        bySalesOrderId.set(receivable.sourceId, receivable);
      }
    }
    return bySalesOrderId;
  }

  private withReceivablePaymentSnapshot<
    T extends {
      receivable?: LinkedReceivableSnapshot | null;
      receivableId?: string | null;
    },
  >(order: T, sourceReceivable?: LinkedReceivableSnapshot | null): T {
    const receivable = order.receivable ?? sourceReceivable;
    if (!receivable) return order;

    const paidAmount = new Prisma.Decimal(receivable.paidAmount ?? 0).toDecimalPlaces(2);
    const outstandingAmount = new Prisma.Decimal(receivable.outstandingAmount ?? 0).toDecimalPlaces(
      2,
    );
    const paymentStatus = outstandingAmount.isZero()
      ? PaymentStatus.PAID
      : paidAmount.gt(0)
        ? PaymentStatus.PARTIALLY_PAID
        : PaymentStatus.UNPAID;

    return {
      ...order,
      receivableId: order.receivableId ?? receivable.id,
      receivable: order.receivable ?? receivable,
      paidAmount,
      outstandingAmount,
      paymentStatus,
    } as T;
  }

  async findReceiptAccounts(
    query: {
      companyId?: string;
      divisionId?: string;
      branchId?: string;
      paymentMethod?: SalesPaymentMethod;
      limit?: string | number;
    },
    user: AuthUser,
  ) {
    if (!query.companyId || query.paymentMethod === SalesPaymentMethod.CREDIT) {
      return [];
    }

    await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.READ);

    const paymentMethod = query.paymentMethod as SalesPaymentMethod | undefined;
    const allowedTypes = paymentMethod
      ? accountTypesForPaymentMethod(paymentMethod)
      : RECEIPT_ACCOUNT_TYPES;
    if (allowedTypes.length === 0) return [];

    const max = Math.min(Math.max(Number(query.limit ?? 500), 1), 1000);
    const accounts = await this.prisma.cashAccount.findMany({
      where: {
        companyId: query.companyId,
        deletedAt: null,
        isActive: true,
        accountType: { in: allowedTypes },
      },
      include: {
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        linkedBank: {
          select: { id: true, bankName: true, accountName: true, accountNumber: true },
        },
      },
      orderBy: { accountName: 'asc' },
      take: 1000,
    });

    return accounts
      .filter((account) => {
        if (account.accountType === CashAccountType.BANK) {
          return (
            (!account.divisionId || account.divisionId === query.divisionId) &&
            (!account.branchId || account.branchId === query.branchId)
          );
        }

        return (
          Boolean(query.divisionId) &&
          Boolean(query.branchId) &&
          account.divisionId === query.divisionId &&
          account.branchId === query.branchId
        );
      })
      .slice(0, max);
  }

  async mobilePosBootstrap(user: AuthUser) {
    const company = await this.findWestsidesCompany();
    await this.companyScope.assertCanAccessCompany(user, company.id, AccessLevel.READ);

    const [divisions, branches, customers] = await Promise.all([
      this.prisma.division.findMany({
        where: { companyId: company.id, deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.findMany({
        where: { division: { companyId: company.id }, deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true, divisionId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.findMany({
        where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          customerCode: true,
          divisionId: true,
          branchId: true,
          customerType: true,
        },
        orderBy: { name: 'asc' },
        take: 500,
      }),
    ]);

    return {
      company,
      divisions,
      branches,
      customers,
      defaults: {
        currency: CurrencyCode.TZS,
        salesType: SalesType.CASH_SALE,
        paymentMethod: SalesPaymentMethod.CASH,
      },
    };
  }

  async mobilePosQuickSale(dto: CreateSalesOrderDto, user: AuthUser) {
    const company = await this.findWestsidesCompany();
    if (dto.companyId !== company.id) {
      throw new BadRequestException('Mobile POS is restricted to Westsides Company Ltd');
    }
    if (dto.paymentMethod === SalesPaymentMethod.CREDIT) {
      throw new BadRequestException('Mobile POS only supports paid counter sales');
    }

    const safeDto: CreateSalesOrderDto = {
      ...dto,
      companyId: company.id,
      salesType: SalesType.CASH_SALE,
      currency: dto.currency ?? CurrencyCode.TZS,
      notes: [dto.notes, 'Created from Westsides Mobile POS'].filter(Boolean).join('\n'),
      paymentMethod: dto.paymentMethod ?? SalesPaymentMethod.CASH,
    };

    return this.quickSale(safeDto, user);
  }

  async create(dto: CreateSalesOrderDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const paymentMethod = normalizePaymentMethodForSalesType(dto.salesType, dto.paymentMethod);
    const cashAccountId =
      paymentMethod === SalesPaymentMethod.CREDIT ? undefined : dto.cashAccountId;
    await this.assertReferencesBelongToCompany(dto.companyId, {
      ...dto,
      paymentMethod,
      cashAccountId,
    });
    const userId = user.id;
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } = calculateLineTotals(
      dto.lines,
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const salesOrderNumber = await this.codes.next({
        entityType: 'SalesOrder',
        companyId: dto.companyId,
        tx,
      });
      const order = await tx.salesOrder.create({
        data: {
          salesOrderNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          customerName: dto.customerName,
          salesType: dto.salesType,
          orderDate: new Date(dto.orderDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          currency: dto.currency as CurrencyCode,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          totalAmount,
          paidAmount: 0,
          outstandingAmount: totalAmount,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          notes: dto.notes,
          salespersonId: dto.salespersonId,
          paymentMethod,
          cashAccountId: cashAccountId ?? null,
          paymentReference: dto.paymentReference,
          createdById: userId,
        },
      });

      await tx.salesOrderLine.createMany({
        data: computed.map((line) => ({
          salesOrderId: order.id,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitId: line.unitId,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount ?? 0,
          taxAmount: line.taxAmount ?? 0,
          lineTotal: line.lineTotal,
          batchId: line.batchId,
        })),
      });

      return order;
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CREATE',
      entityType: 'SalesOrder',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return this.findOne(record.id, user);
  }

  private async findWestsidesCompany() {
    const company = await this.prisma.company.findFirst({
      where: { code: 'WESTSIDES', deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    if (!company) throw new NotFoundException('Westsides Company Ltd is not configured');
    return company;
  }

  async update(id: string, dto: UpdateSalesOrderDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Sales order can only be updated in DRAFT status');
    }
    const nextSalesType = dto.salesType ?? existing.salesType;
    const nextPaymentMethod = normalizePaymentMethodForSalesType(
      nextSalesType,
      dto.paymentMethod ?? ((existing as any).paymentMethod as SalesPaymentMethod),
    );
    const nextCashAccountId =
      nextPaymentMethod === SalesPaymentMethod.CREDIT
        ? null
        : (dto.cashAccountId ?? (existing as any).cashAccountId ?? null);
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: dto.divisionId ?? existing.divisionId,
      branchId: dto.branchId ?? existing.branchId,
      customerId: dto.customerId ?? existing.customerId,
      salespersonId: dto.salespersonId ?? existing.salespersonId,
      cashAccountId: nextCashAccountId ?? undefined,
      paymentMethod: nextPaymentMethod,
      lines: dto.lines,
    });

    const linesToProcess = dto.lines ?? (existing.lines as any[]);
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } =
      calculateLineTotals(linesToProcess);

    const record = await this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderLine.createMany({
          data: computed.map((line) => ({
            salesOrderId: id,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount ?? 0,
            taxAmount: line.taxAmount ?? 0,
            lineTotal: line.lineTotal,
            batchId: line.batchId,
          })),
        });
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          ...(dto.customerId !== undefined && { customerId: dto.customerId }),
          ...(dto.customerName !== undefined && { customerName: dto.customerName }),
          ...(dto.salesType && { salesType: dto.salesType }),
          ...(dto.orderDate && { orderDate: new Date(dto.orderDate) }),
          ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: dto.branchId }),
          ...(dto.salespersonId !== undefined && { salespersonId: dto.salespersonId }),
          paymentMethod: nextPaymentMethod,
          cashAccountId: nextCashAccountId,
          ...(dto.paymentReference !== undefined && { paymentReference: dto.paymentReference }),
          ...(dto.lines && {
            subtotal,
            discountAmount: totalDiscount,
            taxAmount: totalTax,
            totalAmount,
            outstandingAmount: totalAmount,
          }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_UPDATE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return this.findOne(id, user);
  }

  private async assertReferencesBelongToCompany(companyId: string, refs: SalesOrderReferenceIds) {
    if (
      refs.paymentMethod &&
      refs.paymentMethod !== SalesPaymentMethod.CREDIT &&
      !refs.cashAccountId
    ) {
      throw new BadRequestException('Receipt account is required for non-credit sales');
    }

    if (refs.paymentMethod === SalesPaymentMethod.CREDIT && refs.cashAccountId) {
      throw new BadRequestException('Receipt account is only valid for non-credit sales');
    }

    if (refs.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
      if (refs.divisionId && branch.divisionId !== refs.divisionId) {
        throw new BadRequestException('Branch does not belong to the selected division');
      }
    }

    if (refs.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true },
      });
      if (!customer || customer.companyId !== companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
      if (!refs.branchId) {
        throw new BadRequestException('Sales order branch is required for this customer');
      }
      if (customer.branchId && refs.branchId !== customer.branchId) {
        throw new BadRequestException('Customer does not belong to the selected branch');
      }
      if (customer.divisionId && refs.divisionId && refs.divisionId !== customer.divisionId) {
        throw new BadRequestException('Customer does not belong to the selected division');
      }
    }

    if (refs.salespersonId) {
      const salesperson = await this.prisma.employee.findFirst({
        where: { id: refs.salespersonId, deletedAt: null },
        select: { companyId: true },
      });
      if (!salesperson || salesperson.companyId !== companyId) {
        throw new BadRequestException('Salesperson does not belong to this company');
      }
    }

    if (refs.cashAccountId) {
      const cashAccount = await this.prisma.cashAccount.findFirst({
        where: { id: refs.cashAccountId, deletedAt: null, isActive: true },
        select: { companyId: true, divisionId: true, branchId: true, accountType: true },
      });
      if (!cashAccount || cashAccount.companyId !== companyId) {
        throw new BadRequestException('Cash account does not belong to this company');
      }

      const allowedTypes = accountTypesForPaymentMethod(refs.paymentMethod);
      if (allowedTypes.length && !allowedTypes.includes(cashAccount.accountType)) {
        throw new BadRequestException('Cash account type does not match payment method');
      }

      if (cashAccount.accountType === CashAccountType.BANK) {
        if (
          cashAccount.divisionId &&
          refs.divisionId &&
          cashAccount.divisionId !== refs.divisionId
        ) {
          throw new BadRequestException('Bank account does not belong to the selected division');
        }
        if (cashAccount.branchId && refs.branchId && cashAccount.branchId !== refs.branchId) {
          throw new BadRequestException('Bank account does not belong to the selected branch');
        }
      } else {
        if (!refs.divisionId || cashAccount.divisionId !== refs.divisionId) {
          throw new BadRequestException('Cash account does not belong to the selected division');
        }
        if (!refs.branchId || cashAccount.branchId !== refs.branchId) {
          throw new BadRequestException('Cash account does not belong to the selected branch');
        }
      }
    }

    await this.assertLineReferencesBelongToCompany(companyId, refs.lines, refs.branchId);
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: SalesOrderLineDto[] | undefined,
    branchId?: string | null,
  ) {
    if (!lines?.length) return;

    const unique = (ids: Array<string | undefined>) =>
      Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    const productIds = unique(lines.map((line) => line.productId));
    const unitIds = unique(lines.map((line) => line.unitId));
    const batchIds = unique(lines.map((line) => line.batchId));

    const [products, units, batches] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
      batchIds.length
        ? this.prisma.productBatch.findMany({
            where: { id: { in: batchIds }, deletedAt: null },
            select: { id: true, companyId: true, productId: true },
          })
        : Promise.resolve([]),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Sales order product does not belong to this company');
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Sales order unit does not belong to this company');
    }

    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    for (const line of lines) {
      if (!line.batchId) continue;
      const batch = batchById.get(line.batchId);
      if (!batch || batch.companyId !== companyId || batch.productId !== line.productId) {
        throw new BadRequestException('Sales order batch does not belong to this company');
      }
    }
  }

  async confirm(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be confirmed');
    }
    if (!existing.branchId) {
      throw new BadRequestException('Sales order branch/location is required to issue stock');
    }
    const issuingBranchId = existing.branchId;

    const record = await this.prisma.$transaction(async (tx) => {
      let cogsAmount = 0;

      for (const line of existing.lines as any[]) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product?.trackInventory) continue;

        try {
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              companyId_productId_branchId: {
                companyId: existing.companyId,
                productId: line.productId,
                branchId: issuingBranchId,
              },
            },
            select: { averageCost: true },
          });
          const unitCost = Number(balance?.averageCost ?? 0);
          cogsAmount += Number(line.quantity) * unitCost;

          await this.inventoryMovements.createMovement({
            companyId: existing.companyId,
            productId: line.productId,
            movementType: 'SALE_ISSUE',
            quantity: Number(line.quantity),
            unitId: line.unitId,
            unitCost,
            movementDate: existing.orderDate,
            createdById: userId,
            referenceType: 'SalesOrder',
            referenceId: id,
            divisionId: existing.divisionId ?? undefined,
            branchId: issuingBranchId,
            tx,
          });
        } catch (err: any) {
          throw new BadRequestException(
            `Failed to create inventory movement for product "${product.name}": ${err.message}`,
          );
        }

        // Decrement the specific batch's remainingQuantity if a batch was picked.
        if (line.batchId) {
          await tx.productBatch.update({
            where: { id: line.batchId },
            data: { remainingQuantity: { decrement: Number(line.quantity) } },
          });
        }
      }

      // ── Payment routing ────────────────────────────────────────────────
      // Non-CREDIT methods credit the chosen cash account immediately and
      // mark the order PAID. CREDIT creates a Receivable instead.
      const paymentMethod = (existing as any).paymentMethod ?? 'CREDIT';
      let paymentStatus: 'UNPAID' | 'PAID' = 'UNPAID';
      let paidAmount = 0;
      let outstandingAmount = Number(existing.totalAmount);
      let receivableId: string | null = null;

      if (paymentMethod === 'CREDIT') {
        const recNumber = await this.codes.next({
          entityType: 'Receivable',
          companyId: existing.companyId,
          tx,
        });
        const receivable = await tx.receivable.create({
          data: {
            receivableNumber: recNumber,
            companyId: existing.companyId,
            divisionId: existing.divisionId ?? null,
            branchId: existing.branchId ?? null,
            customerId: existing.customerId ?? null,
            customerName: existing.customerName ?? 'Walk-in Customer',
            amount: existing.totalAmount,
            paidAmount: 0,
            outstandingAmount: existing.totalAmount,
            currency: existing.currency,
            issueDate: new Date(),
            dueDate: existing.dueDate ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
            status: 'OPEN' as any,
            sourceType: 'SalesOrder',
            sourceId: id,
            notes: `Sales Order ${existing.salesOrderNumber}`,
          },
        });
        receivableId = receivable.id;
      } else if ((existing as any).cashAccountId) {
        // Credit the cash account balance.
        await tx.cashAccount.update({
          where: { id: (existing as any).cashAccountId },
          data: { currentBalance: { increment: existing.totalAmount } },
        });
        paymentStatus = 'PAID';
        paidAmount = Number(existing.totalAmount);
        outstandingAmount = 0;
      }

      const journalEntry = await this.postSalesOrderLedger({
        order: existing as any,
        paymentMethod,
        cashAccountType: existing.cashAccount?.accountType ?? null,
        cogsAmount,
        userId,
        tx,
      });

      if (receivableId) {
        await tx.receivable.update({
          where: { id: receivableId },
          data: { journalEntryId: journalEntry.id },
        });
      }

      // ── Tax auto-apply (Sprint C2) ───────────────────────────────────────
      // Mirror line-level taxAmount values into the TaxTransaction ledger so
      // C3 filing reports can aggregate them. Soft-fails: any error inside
      // the auto-apply is logged inside the service and does NOT roll back
      // the order confirmation. Env-flag gated (TAX_AUTO_APPLY=true).
      try {
        const taxResult = await this.taxAutoApply.applyForSalesOrder(id, userId, tx);
        if (taxResult.error) {
          this.logger.warn(`Tax auto-apply for order ${id}: ${taxResult.error}`);
        }
      } catch (err) {
        this.logger.warn(
          `Tax auto-apply threw for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedById: userId,
          confirmedAt: new Date(),
          paymentStatus,
          paidAmount,
          outstandingAmount,
          journalEntryId: journalEntry.id,
          ...(receivableId ? { receivableId } : {}),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CONFIRM',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'CONFIRMED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    // Auto-create a DRAFT SalesCommission when the order has a salesperson
    // with a defaultCommissionRate set. Idempotent: the unique key on
    // (salesOrderId, employeeId) means a prior commission blocks a duplicate
    // (e.g. if the order is unconfirmed/reconfirmed). Soft-fails so a
    // configuration gap doesn't break the confirmation flow.
    try {
      await this.maybeCreateAutoCommission(id, userId);
    } catch (err) {
      this.logger.warn(
        `Auto-commission creation failed for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.findOne(id, user);
  }

  /**
   * Helper for `confirm()` — looks up the salesperson and rate, computes
   * a GROSS-basis commission amount, and creates the row. Skips silently
   * when there's no salesperson, no rate, or a commission already exists.
   */
  private async maybeCreateAutoCommission(orderId: string, userId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        companyId: true,
        salespersonId: true,
        subtotal: true,
        currency: true,
      },
    });
    if (!order?.salespersonId) return;

    const salesperson = await this.prisma.employee.findFirst({
      where: { id: order.salespersonId, companyId: order.companyId, deletedAt: null },
      select: { id: true, defaultCommissionRate: true },
    });
    if (!salesperson?.defaultCommissionRate) return;

    const existing = await this.prisma.salesCommission.findFirst({
      where: { salesOrderId: orderId, employeeId: salesperson.id, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;

    const rate = Number(salesperson.defaultCommissionRate);
    const subtotal = Number(order.subtotal);
    const amount = Math.round(subtotal * rate * 100) / 100;

    await this.prisma.salesCommission.create({
      data: {
        companyId: order.companyId,
        employeeId: salesperson.id,
        salesOrderId: order.id,
        basis: 'GROSS',
        rate,
        amount,
        currency: order.currency,
        status: 'DRAFT',
        notes: 'Auto-created on order confirmation',
        createdById: userId,
      },
    });
  }

  private async postSalesOrderLedger(input: {
    order: {
      id: string;
      salesOrderNumber: string;
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      orderDate: Date;
      totalAmount: Prisma.Decimal | number | string;
      taxAmount: Prisma.Decimal | number | string;
    };
    paymentMethod: SalesPaymentMethod | string;
    cashAccountType?: CashAccountType | null;
    cogsAmount: number;
    userId: string;
    tx: Prisma.TransactionClient;
  }) {
    const totalAmount = roundMoney(Number(input.order.totalAmount));
    const taxAmount = roundMoney(Number(input.order.taxAmount ?? 0));
    const revenueAmount = roundMoney(totalAmount - taxAmount);
    const cogsAmount = roundMoney(input.cogsAmount);
    if (totalAmount <= 0) {
      throw new BadRequestException('Sales order total must be greater than zero to post');
    }

    const receivableOrCashRole: AccountRole =
      input.paymentMethod === SalesPaymentMethod.CREDIT
        ? 'AR_CONTROL'
        : cashAccountRole(input.cashAccountType);
    const roles: AccountRole[] = [receivableOrCashRole, 'SALES_REVENUE'];
    if (taxAmount > 0) roles.push('TAX_VAT_PAYABLE');
    if (cogsAmount > 0) roles.push('COST_OF_GOODS_SOLD', 'INVENTORY_ASSET');

    const accounts = await this.accountResolver.resolveMany(input.order.companyId, roles, input.tx);
    const description = `Sales order ${input.order.salesOrderNumber}`;
    const lines = [
      {
        accountId: accounts[receivableOrCashRole].id,
        description:
          input.paymentMethod === SalesPaymentMethod.CREDIT ? 'Customer receivable' : 'Cash sale',
        debit: totalAmount,
        credit: 0,
      },
      ...(revenueAmount > 0
        ? [
            {
              accountId: accounts.SALES_REVENUE.id,
              description: 'Sales revenue',
              debit: 0,
              credit: revenueAmount,
            },
          ]
        : []),
      ...(taxAmount > 0
        ? [
            {
              accountId: accounts.TAX_VAT_PAYABLE.id,
              description: 'Output tax',
              debit: 0,
              credit: taxAmount,
            },
          ]
        : []),
      ...(cogsAmount > 0
        ? [
            {
              accountId: accounts.COST_OF_GOODS_SOLD.id,
              description: 'Cost of goods sold',
              debit: cogsAmount,
              credit: 0,
            },
            {
              accountId: accounts.INVENTORY_ASSET.id,
              description: 'Inventory issued',
              debit: 0,
              credit: cogsAmount,
            },
          ]
        : []),
    ];

    return this.postingEngine.postLines(
      {
        companyId: input.order.companyId,
        divisionId: input.order.divisionId,
        branchId: input.order.branchId,
        transactionDate: input.order.orderDate,
        description,
        referenceType: 'SalesOrder',
        referenceId: input.order.id,
        moduleName: 'sales-orders',
        userId: input.userId,
        lines,
      },
      input.tx,
    );
  }

  /**
   * One-shot create + confirm in a single operator action — the heart of the
   * Quick Sale flow (Westsides W2). Internally still creates the SalesOrder
   * first (its own transaction) then confirms (a second transaction that
   * issues inventory, decrements batches, posts the cash receipt or
   * receivable, and auto-creates a commission). If `confirm` throws, the
   * created DRAFT order is left in the database — the operator sees it in
   * the regular list and can retry or delete.
   */
  async quickSale(dto: CreateSalesOrderDto, user: AuthUser) {
    // Quick-sale defaults: never CREDIT (a counter sale is paid before
    // walking out). Operators who need credit should use the standard
    // Sales Order flow.
    const safeDto: CreateSalesOrderDto = {
      ...dto,
      paymentMethod:
        dto.paymentMethod && dto.paymentMethod !== 'CREDIT' ? dto.paymentMethod : 'CASH',
    };
    if (!safeDto.divisionId && safeDto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: safeDto.branchId, deletedAt: null },
        select: { divisionId: true },
      });
      if (branch) safeDto.divisionId = branch.divisionId;
    }
    const draft = await this.create(safeDto, user);
    return this.confirm(draft.id, user);
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'CONFIRMED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or CONFIRMED sales orders can be cancelled');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (existing.status === 'CONFIRMED') {
        for (const line of existing.lines as any[]) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product?.trackInventory) continue;
          if (!existing.branchId) {
            throw new BadRequestException(
              'Sales order branch/location is required to reverse stock',
            );
          }

          try {
            await this.inventoryMovements.createMovement({
              companyId: existing.companyId,
              productId: line.productId,
              movementType: 'SALES_RETURN',
              quantity: Number(line.quantity),
              unitId: line.unitId,
              movementDate: new Date(),
              createdById: userId,
              referenceType: 'SalesOrder',
              referenceId: id,
              notes: `Reversal: cancellation of sales order ${existing.salesOrderNumber}`,
              divisionId: existing.divisionId ?? undefined,
              branchId: existing.branchId,
              tx,
            });
          } catch (err: any) {
            throw new BadRequestException(
              `Failed to reverse inventory movement for product "${product.name}": ${err.message}`,
            );
          }
        }
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CANCEL',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'CANCELLED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be deleted');
    }

    await this.prisma.salesOrder.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'SALES_ORDER_DELETE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
