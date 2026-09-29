import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { CompanyScopeService } from './company-scope.service';
import { OrganizationScopeService } from './organization-scope.service';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
type Kind = 'sale' | 'invoice';

@Injectable()
export class DeskTransactionLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
  ) {}
  async link(user: AuthUser, kind: Kind, id: string, canonicalId: string) {
    const permissions =
      kind === 'sale'
        ? ['sales_desk.view', 'sales_desk.manage', 'sales.view', 'customers.view']
        : ['invoice_desk.view', 'invoice_desk.manage', 'supplier_invoices.view', 'suppliers.view'];
    if (!permissions.every((p) => user.permissions.includes(p)))
      throw new ForbiddenException('Access to both transaction sources is required.');
    const company = await this.companies.companyWhereFor(user),
      scope = await this.org.recordWhereFor(user, AccessLevel.WRITE);
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (kind === 'sale')
            await tx.$queryRaw`SELECT id FROM sales_desk_sales WHERE id = ${id} FOR UPDATE`;
          else await tx.$queryRaw`SELECT id FROM invoice_desk_invoices WHERE id = ${id} FOR UPDATE`;
          const source =
            kind === 'sale'
              ? await tx.salesDeskSale
                  .findFirst({
                    where: { id, AND: [company, scope] },
                    include: { customer: true, _count: { select: { payments: true } } },
                  })
                  .then(
                    (r) =>
                      r && {
                        ...r,
                        partyId: r.customer.canonicalCustomerId,
                        linkedId: r.canonicalSalesOrderId,
                      },
                  )
              : await tx.invoiceDeskInvoice
                  .findFirst({
                    where: { id, AND: [company, scope] },
                    include: { supplier: true, _count: { select: { payments: true } } },
                  })
                  .then(
                    (r) =>
                      r && {
                        ...r,
                        partyId: r.supplier.canonicalSupplierId,
                        linkedId: r.canonicalInvoiceId,
                      },
                  );
          if (!source)
            throw new NotFoundException(
              'Direct transaction not found in your writable organisation scope.',
            );
          await this.companies.assertCanAccessCompany(user, source.companyId, AccessLevel.WRITE);
          if (source.linkedId) {
            if (source.linkedId === canonicalId) return { id, canonicalId };
            throw new ConflictException('This transaction is already linked.');
          }
          if (!source.partyId)
            throw new BadRequestException(
              'Match its supplier or customer to the shared profile first.',
            );
          if (source.voidedAt || source._count.payments || !source.paidAmount.isZero())
            throw new BadRequestException(
              'Only an unpaid direct entry without payment history can be linked. Reconcile existing payments before migrating a paid entry.',
            );
          if (
            await tx.journalEntry.count({
              where: {
                referenceType: kind === 'sale' ? 'DeskSale' : 'DeskPurchase',
                referenceId: id,
              },
            })
          )
            throw new BadRequestException(
              'This entry already has accounting history. Accounting must resolve that history before migration.',
            );
          if (kind === 'sale')
            await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${canonicalId} FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM supplier_invoices WHERE id = ${canonicalId} FOR UPDATE`;
          const target =
            kind === 'sale'
              ? await tx.salesOrder
                  .findFirst({
                    where: {
                      id: canonicalId,
                      deletedAt: null,
                      AND: [company, scope],
                      status: { notIn: ['DRAFT', 'CANCELLED'] },
                    },
                  })
                  .then((r) => r && { ...r, partyId: r.customerId })
              : await tx.supplierInvoice
                  .findFirst({
                    where: {
                      id: canonicalId,
                      deletedAt: null,
                      AND: [company, scope],
                      payableId: { not: null },
                      status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
                    },
                  })
                  .then((r) => r && { ...r, partyId: r.supplierId });
          if (
            !target ||
            target.companyId !== source.companyId ||
            target.divisionId !== source.divisionId ||
            target.branchId !== source.branchId ||
            target.partyId !== source.partyId ||
            target.currency !== source.currency ||
            !target.totalAmount.eq(source.totalAmount)
          )
            throw new BadRequestException(
              'The business transaction must match the company, division, branch, shared party, currency and full amount.',
            );
          // Claim the same version used by payments. A racing payment or posting rolls back.
          const claim =
            kind === 'sale'
              ? await tx.salesDeskSale.updateMany({
                  where: {
                    id,
                    version: source.version,
                    canonicalSalesOrderId: null,
                    paidAmount: 0,
                  },
                  data: { canonicalSalesOrderId: canonicalId, version: { increment: 1 } },
                })
              : await tx.invoiceDeskInvoice.updateMany({
                  where: { id, version: source.version, canonicalInvoiceId: null, paidAmount: 0 },
                  data: { canonicalInvoiceId: canonicalId, version: { increment: 1 } },
                });
          if (claim.count !== 1)
            throw new ConflictException(
              'This entry changed during review. Refresh before linking.',
            );
          await this.audit.logStrictInTransaction(tx, {
            action: 'DESK_TRANSACTION_LINKED',
            entityType: kind === 'sale' ? 'SalesDeskSale' : 'InvoiceDeskInvoice',
            entityId: id,
            companyId: source.companyId,
            userId: user.id,
            newValue: { canonicalId },
          });
          return { id, canonicalId };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code))
        throw new ConflictException(
          'This transaction changed or is already linked. Refresh before retrying.',
        );
      throw e;
    }
  }
}
