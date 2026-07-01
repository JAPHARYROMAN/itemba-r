import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, CurrencyCode, PayableStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { GenerateSupplierStatementDto } from './dto/generate-supplier-statement.dto';
import { QuerySupplierStatementDto } from './dto/query-supplier-statement.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Payable statuses that MUST be excluded from a supplier (AP) statement:
 *   WRITTEN_OFF — the AP liability was cleared by a write-off JE, not paid; its
 *                 amount/paidAmount no longer reflect a real balance owed.
 *   CANCELLED   — the payable was voided and never represented a real liability.
 * Including either makes the closing balance un-reconcilable against the AP
 * subledger's true outstanding.
 */
const EXCLUDED_STATUSES: PayableStatus[] = [
  PayableStatus.WRITTEN_OFF,
  PayableStatus.CANCELLED,
];

@Injectable()
export class SupplierStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySupplierStatementDto, user: AuthUser) {
    const { companyId, supplierId, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.SupplierStatementRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    const [data, total] = await Promise.all([
      this.prisma.supplierStatementRun.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          generatedBy: { select: { id: true, fullName: true, email: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplierStatementRun.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: take, totalPages: Math.ceil(total / take) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierStatementRun.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Supplier statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async generate(dto: GenerateSupplierStatementDto, user: AuthUser) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart > periodEnd) {
      throw new BadRequestException('Statement start date cannot be after end date');
    }

    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier does not belong to the selected company');
      }
    }

    // A statement is single-currency by design: summing AP across TZS/USD/… is
    // meaningless. Scope every figure to one currency (default TZS) and persist
    // it on the run so consumers know what the totals are denominated in.
    const currency: CurrencyCode = dto.currency ?? CurrencyCode.TZS;

    // Pull every payable up to and including periodEnd, then split pre-period
    // (opening) vs in-period. WRITTEN_OFF / CANCELLED are excluded so the run
    // reconciles against the AP subledger's true outstanding.
    const payableWhere: Prisma.PayableWhereInput = {
      companyId: dto.companyId,
      deletedAt: null,
      currency,
      status: { notIn: EXCLUDED_STATUSES },
      issueDate: { lte: periodEnd },
    };
    if (dto.supplierId) payableWhere.supplierId = dto.supplierId;

    const payables = await this.prisma.payable.findMany({
      where: payableWhere,
      select: { amount: true, paidAmount: true, issueDate: true },
    });

    // Sign convention (supplier AP ledger — what we owe the supplier):
    //   DEBIT  (raises balance): invoice/payable amount billed to us
    //   CREDIT (lowers balance): amount paid against the payable
    //
    // With no separate AP payment ledger, paidAmount is the payable's
    // as-of-now cumulative settlement. Attributing it to the payable's own
    // issue period keeps the run reconcilable by construction:
    //   opening = Σ_{issue < start} (amount − paidAmount)
    //   closing = opening + Σ_{in-period} amount − Σ_{in-period} paidAmount
    //           = Σ_{issue ≤ end} (amount − paidAmount)   (true outstanding)
    let openingBalance = ZERO;
    let totalDebits = ZERO;
    let totalCredits = ZERO;
    for (const p of payables) {
      const amount = p.amount ?? ZERO;
      const paid = p.paidAmount ?? ZERO;
      if (p.issueDate < periodStart) {
        openingBalance = openingBalance.plus(amount).minus(paid);
      } else {
        totalDebits = totalDebits.plus(amount);
        totalCredits = totalCredits.plus(paid);
      }
    }
    const closingBalance = openingBalance.plus(totalDebits).minus(totalCredits);

    const run = await this.prisma.supplierStatementRun.create({
      data: {
        statementRunNumber: `SSTAT-${Date.now()}`,
        companyId: dto.companyId,
        supplierId: dto.supplierId ?? 'ALL',
        periodStart,
        periodEnd,
        openingBalance,
        totalDebits,
        totalCredits,
        closingBalance,
        currency,
        generatedById: user.id,
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_STATEMENT_GENERATE',
      entityType: 'SupplierStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: run as any,
    });
    return run;
  }
}
