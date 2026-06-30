import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { QueryPayableDto } from './dto/query-payable.dto';
import { RecordPayablePaymentDto } from './dto/record-payable-payment.dto';
import { WriteOffPayableDto } from './dto/write-off-payable.dto';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { pagination } from '../../common/utils/pagination';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: QueryPayableDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      supplierId,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.PayableWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.issueDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.payable.findMany({
        where,
        include: this.includeListScope(),
        orderBy: { issueDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.payable.count({ where }),
    ]);

    return {
      data: data.map((record) => this.withResolvedSupplierName(record)),
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.payable.findFirst({
      where: { id, deletedAt: null },
      include: this.includeDetailScope(),
    });
    if (!record) throw new NotFoundException('Payable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    const supplier = record.supplierId
      ? await this.prisma.supplier.findFirst({
          where: { id: record.supplierId, deletedAt: null },
          select: {
            id: true,
            supplierCode: true,
            name: true,
            legalName: true,
            supplierType: true,
            tin: true,
            vrn: true,
            phone: true,
            email: true,
            address: true,
            contactPerson: true,
            creditLimit: true,
            currentBalance: true,
            paymentTerms: true,
            status: true,
          },
        })
      : null;
    return this.withResolvedSupplierName({
      ...record,
      supplier: supplier ?? record.supplier,
    });
  }

  async create(dto: CreatePayableDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const scope = await this.resolvePayableScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      supplierId: dto.supplierId || null,
    });
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Payable amount must be greater than zero');

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payable.create({
        data: {
          payableNumber: await this.codes.next({
            entityType: 'Payable',
            companyId: dto.companyId,
            tx,
          }),
          companyId: dto.companyId,
          divisionId: scope.divisionId,
          branchId: scope.branchId,
          supplierId: dto.supplierId || null,
          supplierName: scope.supplierName ?? dto.supplierName,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          amount,
          paidAmount: 0,
          outstandingAmount: amount,
          currency: dto.currency,
          issueDate: new Date(dto.issueDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: 'OPEN',
          notes: dto.notes,
        },
      });

      const [expenseAccount, apAccount] = await Promise.all([
        this.accountResolver.resolve(created.companyId, 'GENERAL_EXPENSE', tx),
        this.accountResolver.resolve(created.companyId, 'AP_CONTROL', tx),
      ]);
      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: created.companyId,
          divisionId: created.divisionId,
          branchId: created.branchId,
          transactionDate: created.issueDate,
          description: `Manual payable ${created.payableNumber}`,
          referenceType: 'Payable',
          referenceId: created.id,
          moduleName: 'payables',
          userId,
          lines: [
            {
              accountId: expenseAccount.id,
              description: `Payable expense: ${created.supplierName}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: apAccount.id,
              description: `Accounts payable: ${created.supplierName}`,
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );

      const updated = await tx.payable.update({
        where: { id: created.id },
        data: { journalEntryId: journalEntry.id },
      });
      await this.syncSupplierBalance(tx, updated.companyId, updated.supplierId);
      return updated;
    });

    await this.auditLogs.log({
      action: 'PAYABLE_CREATE',
      entityType: 'Payable',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdatePayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const scope = await this.resolvePayableScope({
      companyId: existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      supplierId:
        dto.supplierId !== undefined ? dto.supplierId || null : existing.supplierId || null,
    });
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payable.update({
        where: { id },
        data: {
          divisionId: scope.divisionId,
          branchId: scope.branchId,
          supplierName: scope.supplierName ?? dto.supplierName ?? existing.supplierName,
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId || null }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
          ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
        },
      });
      await this.syncSupplierBalance(tx, existing.companyId, existing.supplierId);
      await this.syncSupplierBalance(tx, updated.companyId, updated.supplierId);
      return updated;
    });

    await this.auditLogs.log({
      action: 'PAYABLE_UPDATE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async recordPayment(id: string, dto: RecordPayablePaymentDto, user: AuthUser) {
    const userId = user.id;
    const paymentAmount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (paymentAmount.lte(0))
      throw new BadRequestException('Payment amount must be greater than zero');

    const { existing, record, newOutstanding, newPaid, newStatus } = await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          Array<{
            id: string;
            companyId: string;
            divisionId: string | null;
            branchId: string | null;
            supplierId: string | null;
            supplierName: string | null;
            payableNumber: string;
            outstandingAmount: Prisma.Decimal;
            paidAmount: Prisma.Decimal;
            status: string;
          }>
        >`SELECT "id", "companyId", "divisionId", "branchId", "supplierId", "supplierName", "payableNumber", "outstandingAmount", "paidAmount", "status"
          FROM "payables"
          WHERE "id" = ${id} AND "deletedAt" IS NULL
          FOR UPDATE`;

        if (!locked) throw new NotFoundException('Payable not found');
        await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);

        // A WRITTEN_OFF (or already-PAID) payable is settled: it must not accept a
        // payment that would post a spurious cash settlement journal. (WRITTEN_OFF
        // can still carry a non-zero outstandingAmount, so the amount check below
        // does not catch this on its own.)
        if (!['OPEN', 'PARTIALLY_PAID'].includes(locked.status)) {
          throw new BadRequestException(
            `Cannot record a payment against a ${locked.status} payable`,
          );
        }

        const outstanding = new Prisma.Decimal(locked.outstandingAmount);
        if (paymentAmount.gt(outstanding)) {
          throw new BadRequestException(
            `Payment amount (${paymentAmount.toString()}) exceeds outstanding amount (${outstanding.toString()})`,
          );
        }

        const nextOutstanding = outstanding.minus(paymentAmount);
        const nextPaid = new Prisma.Decimal(locked.paidAmount).plus(paymentAmount);
        const nextStatus = nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';

        const updated = await tx.payable.update({
          where: { id },
          data: {
            outstandingAmount: nextOutstanding,
            paidAmount: nextPaid,
            status: nextStatus,
          },
        });

        // ITMB-045: post the balanced settlement entry so AP control reduces.
        // DR AP_CONTROL (liability down) / CR Cash on hand (asset down).
        const [apAccount, cashAccount] = await Promise.all([
          this.accountResolver.resolve(locked.companyId, 'AP_CONTROL', tx),
          this.accountResolver.resolve(locked.companyId, 'CASH_ON_HAND', tx),
        ]);
        const settlementDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
        await this.postingEngine.postLines(
          {
            companyId: locked.companyId,
            divisionId: locked.divisionId,
            branchId: locked.branchId,
            transactionDate: settlementDate,
            description: `Payable settlement ${locked.payableNumber}`,
            referenceType: 'Payable',
            referenceId: locked.id,
            moduleName: 'payables',
            userId,
            lines: [
              {
                accountId: apAccount!.id,
                description: `Accounts payable settlement: ${locked.supplierName}`,
                debit: paymentAmount,
                credit: 0,
              },
              {
                accountId: cashAccount!.id,
                description: `Payment to supplier: ${locked.supplierName}`,
                debit: 0,
                credit: paymentAmount,
              },
            ],
          },
          tx,
        );
        await this.syncSupplierBalance(tx, updated.companyId, updated.supplierId);

        return {
          existing: locked,
          record: updated,
          newOutstanding: nextOutstanding,
          newPaid: nextPaid,
          newStatus: nextStatus,
        };
      },
    );

    await this.auditLogs.log({
      action: 'PAYABLE_PAYMENT',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { outstandingAmount: existing.outstandingAmount, status: existing.status } as any,
      newValue: {
        outstandingAmount: newOutstanding,
        paidAmount: newPaid,
        status: newStatus,
      } as any,
    });

    return record;
  }

  async writeOff(id: string, dto: WriteOffPayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payable.update({
        where: { id },
        data: { status: 'WRITTEN_OFF', notes: dto.reason },
      });
      await this.syncSupplierBalance(tx, updated.companyId, updated.supplierId);
      return updated;
    });

    await this.auditLogs.log({
      action: 'PAYABLE_WRITE_OFF',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'WRITTEN_OFF', reason: dto.reason } as any,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.payable.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.syncSupplierBalance(tx, existing.companyId, existing.supplierId);
    });

    await this.auditLogs.log({
      action: 'PAYABLE_DELETE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private includeListScope() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      supplier: {
        select: {
          id: true,
          supplierCode: true,
          name: true,
          legalName: true,
          supplierType: true,
          tin: true,
          vrn: true,
          phone: true,
          email: true,
          address: true,
          contactPerson: true,
          creditLimit: true,
          currentBalance: true,
          paymentTerms: true,
          status: true,
        },
      },
    };
  }

  private includeDetailScope() {
    return {
      ...this.includeListScope(),
      journalEntry: {
        select: {
          id: true,
          journalNumber: true,
          transactionDate: true,
          description: true,
          referenceType: true,
          referenceId: true,
          status: true,
          totalDebit: true,
          totalCredit: true,
          postedAt: true,
          lines: {
            select: {
              id: true,
              description: true,
              debit: true,
              credit: true,
              account: {
                select: {
                  id: true,
                  accountCode: true,
                  accountName: true,
                  accountType: true,
                  accountSubType: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
      purchaseOrders: {
        where: { deletedAt: null },
        select: {
          id: true,
          purchaseOrderNumber: true,
          orderDate: true,
          expectedDate: true,
          purchaseType: true,
          status: true,
          paymentStatus: true,
          subtotal: true,
          taxAmount: true,
          discountAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          lines: {
            select: {
              id: true,
              description: true,
              quantity: true,
              unitCost: true,
              discountAmount: true,
              taxAmount: true,
              lineTotal: true,
              batchNumber: true,
              expiryDate: true,
              product: {
                select: {
                  id: true,
                  productCode: true,
                  sku: true,
                  name: true,
                },
              },
              unit: {
                select: {
                  id: true,
                  name: true,
                  symbol: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
        orderBy: { orderDate: 'desc' as const },
        take: 10,
      },
      fuelDeliveries: {
        where: { deletedAt: null },
        select: {
          id: true,
          deliveryNumber: true,
          deliveryDate: true,
          deliveryNoteNumber: true,
          invoiceNumber: true,
          status: true,
          orderedLitres: true,
          deliveredLitres: true,
          acceptedLitres: true,
          rejectedLitres: true,
          unitCost: true,
          totalCost: true,
          product: { select: { id: true, productCode: true, name: true, sku: true } },
          tank: { select: { id: true, tankCode: true, tankName: true } },
        },
        orderBy: { deliveryDate: 'desc' as const },
        take: 10,
      },
    };
  }

  private withResolvedSupplierName<
    TRecord extends {
      supplierName: string;
      supplier?: { name?: string | null } | null;
    },
  >(record: TRecord): TRecord {
    const supplierName = record.supplier?.name?.trim() || record.supplierName;
    return supplierName === record.supplierName ? record : { ...record, supplierName };
  }

  private async resolvePayableScope(input: {
    companyId: string;
    divisionId?: string | null;
    branchId?: string | null;
    supplierId?: string | null;
  }) {
    let divisionId = input.divisionId || null;
    let branchId = input.branchId || null;

    if (input.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true, name: true },
      });
      if (!supplier || supplier.companyId !== input.companyId) {
        throw new BadRequestException('Supplier does not belong to this company');
      }
      if (!divisionId && supplier.divisionId) divisionId = supplier.divisionId;
      if (!branchId && supplier.branchId) branchId = supplier.branchId;
      if (divisionId && supplier.divisionId && supplier.divisionId !== divisionId) {
        throw new BadRequestException('Supplier does not belong to the selected division');
      }
      if (branchId && supplier.branchId && supplier.branchId !== branchId) {
        throw new BadRequestException('Supplier does not belong to the selected branch/location');
      }
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== input.companyId) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (!divisionId) divisionId = branch.divisionId;
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== input.companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    const supplierName = input.supplierId
      ? (
          await this.prisma.supplier.findFirst({
            where: { id: input.supplierId, deletedAt: null },
            select: { name: true },
          })
        )?.name
      : undefined;

    return { divisionId, branchId, supplierName };
  }

  private async syncSupplierBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    supplierId?: string | null,
  ) {
    if (!supplierId) return;
    const summary = await tx.payable.aggregate({
      where: {
        companyId,
        supplierId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as any },
      },
      _sum: { outstandingAmount: true },
    });
    await tx.supplier.updateMany({
      where: { id: supplierId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }
}
