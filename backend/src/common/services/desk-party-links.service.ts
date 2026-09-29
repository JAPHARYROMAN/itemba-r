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

type Kind = 'supplier' | 'customer';
type Tx = Prisma.TransactionClient;
const fields = {
  id: true,
  companyId: true,
  name: true,
  email: true,
  phone: true,
  company: { select: { name: true } },
} as const;

/** Party references only. Linking never copies or settles a business transaction. */
@Injectable()
export class DeskPartyLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  private permission(user: AuthUser, kind: Kind, write = false) {
    const desk = kind === 'supplier' ? 'invoice_desk' : 'sales_desk';
    const required = [
      `${desk}.view`,
      `${kind}s.view`,
      ...(write ? [`${desk}.manage`, `${kind}s.update`] : []),
    ];
    if (!required.every((p) => user.permissions.includes(p)))
      throw new ForbiddenException('You do not have access to this shared directory.');
  }
  private async masterScope(user: AuthUser, companyId?: string) {
    const organisationScope = await this.org.recordWhereFor(user);
    return {
      AND: [
        await this.companies.companyWhereFor(user, companyId),
        // Prisma ignores an empty object inside OR rather than treating it as
        // unrestricted. Keep company/group readers unrestricted within their
        // authorised company, while branch readers retain the directory filter.
        ...(Object.keys(organisationScope).length
          ? [{ OR: [{ divisionId: null, branchId: null }, organisationScope] }]
          : []),
      ],
      deletedAt: null,
    };
  }
  async choices(user: AuthUser, kind: Kind, query: { companyId?: string; search?: string }) {
    this.permission(user, kind);
    const where = {
      ...(await this.masterScope(user, query.companyId)),
      status: 'ACTIVE' as const,
      ...(query.search?.trim()
        ? { name: { contains: query.search.trim(), mode: 'insensitive' as const } }
        : {}),
    };
    const masters =
      kind === 'supplier'
        ? await this.db.supplier.findMany({ where, select: fields, orderBy: { name: 'asc' } })
        : await this.db.customer.findMany({ where, select: fields, orderBy: { name: 'asc' } });
    const ids = masters.map((m) => m.id);
    const links =
      kind === 'supplier'
        ? (
            await this.db.invoiceDeskSupplier.findMany({
              where: { canonicalSupplierId: { in: ids } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            })
          ).map((r) => ({ id: r.id, masterId: r.canonicalSupplierId }))
        : (
            await this.db.salesDeskCustomer.findMany({
              where: { canonicalCustomerId: { in: ids } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            })
          ).map((r) => ({ id: r.id, masterId: r.canonicalCustomerId }));
    const firstLink = new Map<string, string>();
    for (const link of links)
      if (link.masterId && !firstLink.has(link.masterId)) firstLink.set(link.masterId, link.id);
    return masters.map((m) => ({ ...m, canonicalId: m.id, id: firstLink.get(m.id) ?? m.id }));
  }
  async resolve(tx: Tx, user: AuthUser, kind: Kind, id: string, companyId: string) {
    this.permission(user, kind);
    if (kind === 'supplier')
      await tx.$queryRaw`SELECT id FROM invoice_desk_suppliers WHERE id = ${id} FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM sales_desk_customers WHERE id = ${id} FOR SHARE`;
    const link =
      kind === 'supplier'
        ? await tx.invoiceDeskSupplier
            .findFirst({ where: { id, companyId }, select: { canonicalSupplierId: true } })
            .then((r) => r && { masterId: r.canonicalSupplierId })
        : await tx.salesDeskCustomer
            .findFirst({ where: { id, companyId }, select: { canonicalCustomerId: true } })
            .then((r) => r && { masterId: r.canonicalCustomerId });
    if (link && !link.masterId)
      throw new BadRequestException(
        `Match this older ${kind} to its shared profile before recording new transactions.`,
      );
    const where = {
      ...(await this.masterScope(user, companyId)),
      id: link?.masterId ?? id,
      companyId,
      status: 'ACTIVE' as const,
    };
    const master =
      kind === 'supplier'
        ? await tx.supplier.findFirst({ where, select: fields })
        : await tx.customer.findFirst({ where, select: fields });
    if (!master)
      throw new BadRequestException(
        `Choose an active ${kind} in this company and your organisation scope.`,
      );
    if (link) return id;
    const data = {
      companyId,
      name: master.name.slice(0, 160),
      nameKey: `MASTER:${master.id}`,
      email: master.email?.slice(0, 254),
      phone: master.phone?.slice(0, 60),
    };
    if (kind === 'supplier') {
      await tx.invoiceDeskSupplier.createMany({
        data: [{ ...data, canonicalSupplierId: master.id }],
        skipDuplicates: true,
      });
      return (
        await tx.invoiceDeskSupplier.findFirstOrThrow({
          where: { companyId, canonicalSupplierId: master.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      ).id;
    }
    await tx.salesDeskCustomer.createMany({
      data: [{ ...data, canonicalCustomerId: master.id }],
      skipDuplicates: true,
    });
    return (
      await tx.salesDeskCustomer.findFirstOrThrow({
        where: { companyId, canonicalCustomerId: master.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).id;
  }
  async unmatched(user: AuthUser, kind: Kind) {
    this.permission(user, kind);
    const scope = await this.companies.companyWhereFor(user);
    const recordScope = await this.org.recordWhereFor(user);
    const select = { ...fields, company: { select: { name: true } } };
    return kind === 'supplier'
      ? this.db.invoiceDeskSupplier.findMany({
          where: { AND: [scope], canonicalSupplierId: null },
          select: { ...select, _count: { select: { invoices: { where: recordScope } } } },
          orderBy: { name: 'asc' },
        })
      : this.db.salesDeskCustomer.findMany({
          where: { AND: [scope], canonicalCustomerId: null },
          select: { ...select, _count: { select: { sales: { where: recordScope } } } },
          orderBy: { name: 'asc' },
        });
  }
  async link(user: AuthUser, kind: Kind, sourceId: string, masterId: string) {
    this.permission(user, kind, true);
    const companyScope = await this.companies.companyWhereFor(user);
    const masterScope = await this.masterScope(user);
    const recordScope = await this.org.recordWhereFor(user, AccessLevel.WRITE);
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (kind === 'supplier')
            await tx.$queryRaw`SELECT id FROM invoice_desk_suppliers WHERE id = ${sourceId} FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM sales_desk_customers WHERE id = ${sourceId} FOR UPDATE`;
          const source =
            kind === 'supplier'
              ? await tx.invoiceDeskSupplier
                  .findFirst({ where: { id: sourceId, AND: [companyScope] } })
                  .then((r) => r && { ...r, masterId: r.canonicalSupplierId })
              : await tx.salesDeskCustomer
                  .findFirst({ where: { id: sourceId, AND: [companyScope] } })
                  .then((r) => r && { ...r, masterId: r.canonicalCustomerId });
          if (!source) throw new NotFoundException('Directory entry not found.');
          await this.companies.assertCanAccessCompany(user, source.companyId, AccessLevel.WRITE);
          if (source.masterId && source.masterId !== masterId)
            throw new ConflictException('This entry is already linked. Refresh its profile.');
          const where = { ...masterScope, id: masterId, companyId: source.companyId };
          const master =
            kind === 'supplier'
              ? await tx.supplier.findFirst({ where, select: fields })
              : await tx.customer.findFirst({ where, select: fields });
          if (!master)
            throw new BadRequestException(
              `Choose a ${kind} in the same company and your organisation scope.`,
            );
          const denied =
            kind === 'supplier'
              ? await tx.invoiceDeskInvoice.count({
                  where: { supplierId: sourceId, NOT: recordScope },
                })
              : await tx.salesDeskSale.count({ where: { customerId: sourceId, NOT: recordScope } });
          // Prisma NOT:{} is an empty predicate, so unrestricted roles need no row check.
          if (Object.keys(recordScope).length && denied)
            throw new ForbiddenException(
              'Write access to every associated transaction is required to link this profile.',
            );
          if (source.masterId === masterId)
            return { id: sourceId, canonicalId: masterId, name: master.name };
          if (kind === 'supplier')
            await tx.invoiceDeskSupplier.update({
              where: { id: sourceId },
              data: { canonicalSupplierId: masterId },
            });
          else
            await tx.salesDeskCustomer.update({
              where: { id: sourceId },
              data: { canonicalCustomerId: masterId },
            });
          await this.audit.logStrictInTransaction(tx, {
            action: 'DESK_PARTY_LINKED',
            entityType: kind === 'supplier' ? 'InvoiceDeskSupplier' : 'SalesDeskCustomer',
            entityId: sourceId,
            companyId: source.companyId,
            userId: user.id,
            oldValue: { name: source.name },
            newValue: { canonicalId: masterId, name: master.name },
          });
          return { id: sourceId, canonicalId: masterId, name: master.name };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException('The directory changed. Refresh before matching again.');
      throw error;
    }
  }
}
