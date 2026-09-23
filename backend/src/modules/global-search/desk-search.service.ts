import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopedWhere, OrganizationScopeService } from '../../common/services';
import type { GlobalSearchResult } from './global-search.service';

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
const organization = {
  company: { select: { name: true } },
  branch: { select: { name: true } },
} as const;
const subtitle = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ');

/** The same company/organisation boundaries as the owning Desk list endpoints. */
@Injectable()
export class DeskSearchService {
  constructor(
    private readonly db: PrismaService,
    private readonly org: OrganizationScopeService,
  ) {}

  async search(
    query: string,
    user: AuthUser,
    company: CompanyScopedWhere,
    limit: number,
    filesOnly = false,
  ) {
    const can = (permission: string) => user.permissions.includes(permission);
    const scope = ['invoice_desk.view', 'sales_desk.view', 'cash_desk.view'].some(can)
      ? { AND: [company, await this.org.recordWhereFor(user)] }
      : { id: { in: [] as string[] } };
    const [invoices, sales, movements, documents, attachments] = await Promise.all([
      !filesOnly && can('invoice_desk.view')
        ? this.db.invoiceDeskInvoice.findMany({
            where: {
              AND: [
                scope,
                {
                  OR: [
                    { invoiceNumber: contains(query) },
                    { description: contains(query) },
                    { supplier: { name: contains(query) } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              voidedAt: true,
              supplier: { select: { name: true } },
              ...organization,
            },
            orderBy: [{ invoiceDate: 'desc' }, { id: 'asc' }],
            take: limit,
          })
        : [],
      !filesOnly && can('sales_desk.view')
        ? this.db.salesDeskSale.findMany({
            where: {
              AND: [
                scope,
                {
                  OR: [
                    { saleNumber: contains(query) },
                    { customer: { name: contains(query) } },
                    { lines: { some: { description: contains(query) } } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              saleNumber: true,
              saleDate: true,
              voidedAt: true,
              customer: { select: { name: true } },
              ...organization,
            },
            orderBy: [{ saleDate: 'desc' }, { id: 'asc' }],
            take: limit,
          })
        : [],
      !filesOnly && can('cash_desk.view')
        ? this.db.cashDeskMovement.findMany({
            where: {
              AND: [
                { entries: { some: { account: scope } } },
                {
                  OR: [
                    { description: contains(query) },
                    { reference: contains(query) },
                    { payee: contains(query) },
                  ],
                },
              ],
            },
            select: {
              id: true,
              description: true,
              reference: true,
              businessDate: true,
              kind: true,
              reversedAt: true,
              entries: {
                where: { account: scope },
                select: {
                  account: { select: { name: true, company: { select: { name: true } } } },
                },
              },
            },
            orderBy: [{ businessDate: 'desc' }, { id: 'asc' }],
            take: limit,
          })
        : [],
      // Documents currently use company scope, matching DocumentsService.findAll.
      can('documents.view')
        ? this.db.document.findMany({
            where: {
              AND: [
                company,
                {
                  deletedAt: null,
                  OR: [
                    { title: contains(query) },
                    { documentCode: contains(query) },
                    { fileName: contains(query) },
                    { description: contains(query) },
                  ],
                },
              ],
            },
            select: {
              id: true,
              title: true,
              fileName: true,
              version: true,
              status: true,
              company: { select: { name: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: limit,
          })
        : [],
      can('invoice_desk.view')
        ? this.db.invoiceDeskAttachment.findMany({
            where: {
              invoice: scope,
              OR: [
                { name: contains(query) },
                { invoice: { invoiceNumber: contains(query) } },
                { invoice: { supplier: { name: contains(query) } } },
              ],
            },
            select: {
              id: true,
              invoiceId: true,
              name: true,
              createdAt: true,
              invoice: { select: { invoiceNumber: true, ...organization } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: limit,
          })
        : [],
    ]);
    const bucket = (key: string, label: string, results: GlobalSearchResult[]) => ({
      key,
      label,
      results,
    });
    return [
      bucket(
        'desk-invoices',
        'Invoice Desk',
        invoices.map((row) => ({
          id: row.id,
          type: 'desk-invoice',
          module: 'Invoice Desk',
          title: row.invoiceNumber,
          subtitle: subtitle([row.supplier.name, row.company.name, row.branch.name]),
          href: `/invoice-desk?record=${encodeURIComponent(row.id)}`,
          date: row.invoiceDate.toISOString().slice(0, 10),
          badge: row.voidedAt ? 'VOID' : undefined,
        })),
      ),
      bucket(
        'desk-sales',
        'Sales Desk',
        sales.map((row) => ({
          id: row.id,
          type: 'desk-sale',
          module: 'Sales Desk',
          title: row.saleNumber,
          subtitle: subtitle([row.customer.name, row.company.name, row.branch.name]),
          href: `/sales-desk?record=${encodeURIComponent(row.id)}`,
          date: row.saleDate.toISOString().slice(0, 10),
          badge: row.voidedAt ? 'VOID' : undefined,
        })),
      ),
      bucket(
        'desk-movements',
        'Cash Desk',
        movements.map((row) => ({
          id: row.id,
          type: 'desk-movement',
          module: 'Cash Desk',
          title: row.description,
          subtitle: subtitle([
            row.reference,
            ...new Set(
              row.entries.map((entry) => `${entry.account.name} · ${entry.account.company.name}`),
            ),
          ]),
          href: `/cash-desk?record=${encodeURIComponent(row.id)}`,
          date: row.businessDate.toISOString().slice(0, 10),
          badge: row.reversedAt ? 'REVERSED' : row.kind.replaceAll('_', ' '),
        })),
      ),
      bucket(
        'documents',
        'Documents',
        documents.map((row) => ({
          id: row.id,
          type: 'document',
          module: 'Documents',
          title: row.title,
          subtitle: subtitle([row.fileName, row.company?.name]),
          badge: row.status,
          href: `/group-control/documents/${encodeURIComponent(row.id)}`,
          file: {
            kind: 'document',
            id: row.id,
            title: row.title,
            fileName: row.fileName,
            version: row.version,
          },
        })),
      ),
      bucket(
        'invoice-attachments',
        'Invoice files',
        attachments.map((row) => ({
          id: row.id,
          type: 'invoice-attachment',
          module: 'Invoice Desk',
          title: row.name,
          subtitle: subtitle([
            row.invoice.invoiceNumber,
            row.invoice.company.name,
            row.invoice.branch.name,
          ]),
          href: `/invoice-desk?record=${encodeURIComponent(row.invoiceId)}`,
          date: row.createdAt.toISOString().slice(0, 10),
          file: {
            kind: 'invoice-attachment',
            id: row.id,
            invoiceId: row.invoiceId,
            title: row.name,
            fileName: row.name,
          },
        })),
      ),
    ];
  }
}
