import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Party linkage, Phase 2 PR-4: everything about a supplier or customer, one lazy section
 * at a time. Each section is read only with the permission its own register requires,
 * always inside the party's company and the reader's organisation scope, and comes back
 * in one row shape so both profiles render it the same way. Nothing here is a balance:
 * balances come from the party balance resolver.
 */
export const SUPPLIER_SECTIONS = {
  payments: 'supplier-payments.view',
  cash: 'cash_desk.view',
  expenses: 'expenses.view',
  notebook: 'records.view',
  invoices: 'supplier_invoices.list',
  grns: 'grn.list',
  'purchase-orders': 'purchases.view',
  'desk-invoices': 'invoice_desk.view',
  contracts: 'contracts.view',
  loans: 'loans.read',
  debts: 'debts.read',
  contacts: 'contact_persons.list',
  communications: 'communication_logs.list',
  documents: 'documents.view',
} as const;
export const CUSTOMER_SECTIONS = {
  payments: 'customer-payments.view',
  cash: 'cash_desk.view',
  notebook: 'records.view',
  'credit-notes': 'receivables.view',
  refunds: 'refunds.view',
  quotations: 'quotations.view',
  proformas: 'proformas.view',
  'delivery-notes': 'delivery_notes.view',
  'desk-sales': 'sales_desk.view',
  packages: 'customers.view',
  contracts: 'contracts.view',
  contacts: 'contact_persons.list',
  communications: 'communication_logs.list',
  documents: 'documents.view',
} as const;
type SupplierSection = keyof typeof SUPPLIER_SECTIONS;
type CustomerSection = keyof typeof CUSTOMER_SECTIONS;

export interface RelatedRow {
  id: string;
  /** Document number, title or name. */
  number: string;
  date: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  /** Secondary line: method, reference, counterpart, position, etc. */
  detail: string | null;
  /** The record this row opens; the frontend maps the kind to a route. */
  link: { kind: string; id: string } | null;
}
export interface RelatedSection {
  section: string;
  rows: RelatedRow[];
  total: number;
}

const PAGE = 50;
type OrgScope = Awaited<ReturnType<OrganizationScopeService['recordWhereFor']>>;
const money = (value: Prisma.Decimal | number | string | null | undefined) =>
  value == null ? null : new Prisma.Decimal(value).toFixed(2);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const join = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ') || null;
/** Attachment join rows store the entity type as free text; match it case-insensitively. */
const entityType = (kind: 'SUPPLIER' | 'CUSTOMER') => ({
  equals: kind,
  mode: 'insensitive' as const,
});

@Injectable()
export class PartyProfileService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}

  private require(user: AuthUser, permission: string) {
    if (!user.permissions.includes(permission))
      throw new ForbiddenException(`${permission} is required to view this section.`);
  }

  private async load(user: AuthUser, kind: 'supplier' | 'customer', id: string) {
    const party =
      kind === 'supplier'
        ? await this.db.supplier.findFirst({
            where: { id, deletedAt: null },
            select: { id: true, companyId: true },
          })
        : await this.db.customer.findFirst({
            where: { id, deletedAt: null },
            select: { id: true, companyId: true },
          });
    if (!party)
      throw new NotFoundException(
        kind === 'supplier' ? 'Supplier not found' : 'Customer not found',
      );
    await this.companies.assertCanAccessCompany(user, party.companyId);
    const scope = await this.org.recordWhereFor(user);
    return { companyId: party.companyId, scope };
  }

  private section<T>(section: string, rows: T[], total: number, map: (row: T) => RelatedRow) {
    return { section, rows: rows.map(map), total } satisfies RelatedSection;
  }

  /** Company-level rows (no division or branch) stay visible to branch-limited readers. */
  private orgOrCompanyLevel(scope: OrgScope) {
    return Object.keys(scope).length ? [{ OR: [{ divisionId: null, branchId: null }, scope] }] : [];
  }

  private async cash(
    partyWhere: Prisma.CashDeskMovementWhereInput,
    companyId: string,
    scope: OrgScope,
  ) {
    const where: Prisma.CashDeskMovementWhereInput = {
      ...partyWhere,
      entries: { some: { account: { companyId, ...scope } } },
    };
    const [rows, total] = await Promise.all([
      this.db.cashDeskMovement.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: PAGE,
        select: {
          id: true,
          kind: true,
          businessDate: true,
          amount: true,
          currency: true,
          description: true,
          reference: true,
          reversedAt: true,
        },
      }),
      this.db.cashDeskMovement.count({ where }),
    ]);
    return this.section('cash', rows, total, (m) => ({
      id: m.id,
      number: m.description,
      date: iso(m.businessDate),
      amount: money(m.amount),
      currency: m.currency,
      status: m.reversedAt ? 'REVERSED' : m.kind,
      detail: m.reference || null,
      link: { kind: 'cash-movement', id: m.id },
    }));
  }

  private async notebook(
    partyWhere: { supplierId: string } | { customerId: string },
    companyId: string,
    scope: OrgScope,
  ) {
    const where: Prisma.RecordEntryWhereInput = {
      ...partyWhere,
      companyId,
      voidedAt: null,
      ...scope,
    };
    const [rows, total] = await Promise.all([
      this.db.recordEntry.findMany({
        where,
        orderBy: [{ recordDate: 'desc' }, { id: 'desc' }],
        take: PAGE,
        select: {
          id: true,
          kind: true,
          title: true,
          reference: true,
          recordDate: true,
          dueDate: true,
          amount: true,
          settledAmount: true,
          currency: true,
        },
      }),
      this.db.recordEntry.count({ where }),
    ]);
    return this.section('notebook', rows, total, (r) => ({
      id: r.id,
      number: r.title,
      date: iso(r.recordDate),
      amount: money(
        r.kind === 'DEBTOR' || r.kind === 'CREDITOR' ? r.amount.minus(r.settledAmount) : r.amount,
      ),
      currency: r.currency,
      status: r.kind,
      detail: join([r.reference, r.dueDate ? `Due ${r.dueDate.toISOString().slice(0, 10)}` : null]),
      link: { kind: 'record', id: r.id },
    }));
  }

  private async contracts(
    partyWhere: { supplierId: string } | { customerId: string },
    companyId: string,
    scope: OrgScope,
  ) {
    const where: Prisma.ContractWhereInput = {
      ...partyWhere,
      companyId,
      deletedAt: null,
      ...scope,
    };
    const [rows, total] = await Promise.all([
      this.db.contract.findMany({
        where,
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: PAGE,
        select: {
          id: true,
          title: true,
          contractNumber: true,
          startDate: true,
          endDate: true,
          value: true,
          currency: true,
          status: true,
        },
      }),
      this.db.contract.count({ where }),
    ]);
    return this.section('contracts', rows, total, (c) => ({
      id: c.id,
      number: c.title,
      date: iso(c.startDate),
      amount: money(c.value),
      currency: c.currency,
      status: c.status,
      detail: join([
        c.contractNumber,
        c.endDate ? `Ends ${c.endDate.toISOString().slice(0, 10)}` : null,
      ]),
      link: { kind: 'contract', id: c.id },
    }));
  }

  private async contacts(kind: 'SUPPLIER' | 'CUSTOMER', id: string, companyId: string) {
    const where: Prisma.ContactPersonWhereInput = {
      companyId,
      entityType: kind,
      entityId: id,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.db.contactPerson.findMany({
        where,
        orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        take: PAGE,
        select: {
          id: true,
          fullName: true,
          position: true,
          phone: true,
          email: true,
          isPrimary: true,
          createdAt: true,
        },
      }),
      this.db.contactPerson.count({ where }),
    ]);
    return this.section('contacts', rows, total, (c) => ({
      id: c.id,
      number: c.fullName,
      date: iso(c.createdAt),
      amount: null,
      currency: null,
      status: c.isPrimary ? 'PRIMARY' : null,
      detail: join([c.position, c.phone, c.email]),
      link: null,
    }));
  }

  private async communications(kind: 'SUPPLIER' | 'CUSTOMER', id: string, companyId: string) {
    const where: Prisma.CommunicationLogWhereInput = {
      companyId,
      entityType: kind,
      entityId: id,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.db.communicationLog.findMany({
        where,
        orderBy: [{ communicationDate: 'desc' }, { id: 'desc' }],
        take: PAGE,
        select: {
          id: true,
          communicationNumber: true,
          subject: true,
          summary: true,
          communicationType: true,
          direction: true,
          communicationDate: true,
          followUpDate: true,
          status: true,
        },
      }),
      this.db.communicationLog.count({ where }),
    ]);
    return this.section('communications', rows, total, (c) => ({
      id: c.id,
      number: c.subject || c.communicationNumber,
      date: iso(c.communicationDate),
      amount: null,
      currency: null,
      status: c.status,
      detail: join([
        c.communicationType,
        c.direction,
        c.followUpDate ? `Follow up ${c.followUpDate.toISOString().slice(0, 10)}` : null,
      ]),
      link: null,
    }));
  }

  /** Documents owned by the party plus documents attached to it from finance or operations. */
  private async documents(
    kind: 'SUPPLIER' | 'CUSTOMER',
    id: string,
    companyId: string,
    scope: OrgScope,
  ) {
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      OR: [
        { ownerType: kind, ownerId: id },
        { financialAttachments: { some: { entityType: entityType(kind), entityId: id } } },
        { operationsAttachments: { some: { entityType: entityType(kind), entityId: id } } },
      ],
      AND: [{ OR: [{ companyId }, { companyId: null }] }, ...this.orgOrCompanyLevel(scope)],
    };
    const [rows, total] = await Promise.all([
      this.db.document.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE,
        select: {
          id: true,
          title: true,
          documentCode: true,
          category: true,
          status: true,
          createdAt: true,
          expiryDate: true,
        },
      }),
      this.db.document.count({ where }),
    ]);
    return this.section('documents', rows, total, (d) => ({
      id: d.id,
      number: d.title,
      date: iso(d.createdAt),
      amount: null,
      currency: null,
      status: d.status,
      detail: join([
        d.documentCode,
        d.category,
        d.expiryDate ? `Expires ${d.expiryDate.toISOString().slice(0, 10)}` : null,
      ]),
      link: { kind: 'document', id: d.id },
    }));
  }

  async supplier(user: AuthUser, id: string, section: string): Promise<RelatedSection> {
    const permission = (SUPPLIER_SECTIONS as Record<string, string>)[section];
    if (!permission) throw new BadRequestException('Unknown profile section.');
    this.require(user, permission);
    const { companyId, scope } = await this.load(user, 'supplier', id);
    const scoped = { companyId, deletedAt: null, ...scope };
    switch (section as SupplierSection) {
      case 'payments': {
        const where = { ...scoped, supplierId: id };
        const [rows, total] = await Promise.all([
          this.db.supplierPayment.findMany({
            where,
            orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              paymentNumber: true,
              paymentDate: true,
              amount: true,
              currency: true,
              status: true,
              method: true,
              reference: true,
            },
          }),
          this.db.supplierPayment.count({ where }),
        ]);
        return this.section(section, rows, total, (p) => ({
          id: p.id,
          number: p.paymentNumber,
          date: iso(p.paymentDate),
          amount: money(p.amount),
          currency: p.currency,
          status: p.status,
          detail: join([p.method, p.reference]),
          link: null,
        }));
      }
      case 'cash':
        return this.cash({ supplierId: id }, companyId, scope);
      case 'expenses': {
        const where = { ...scoped, supplierId: id };
        const [rows, total] = await Promise.all([
          this.db.expense.findMany({
            where,
            orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              expenseNumber: true,
              expenseDate: true,
              amount: true,
              currency: true,
              status: true,
              description: true,
            },
          }),
          this.db.expense.count({ where }),
        ]);
        return this.section(section, rows, total, (e) => ({
          id: e.id,
          number: e.expenseNumber,
          date: iso(e.expenseDate),
          amount: money(e.amount),
          currency: e.currency,
          status: e.status,
          detail: e.description,
          link: { kind: 'expense', id: e.id },
        }));
      }
      case 'notebook':
        return this.notebook({ supplierId: id }, companyId, scope);
      case 'invoices': {
        const where = { ...scoped, supplierId: id };
        const [rows, total] = await Promise.all([
          this.db.supplierInvoice.findMany({
            where,
            orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              supplierInvoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              totalAmount: true,
              currency: true,
              status: true,
            },
          }),
          this.db.supplierInvoice.count({ where }),
        ]);
        return this.section(section, rows, total, (i) => ({
          id: i.id,
          number: i.supplierInvoiceNumber,
          date: iso(i.invoiceDate),
          amount: money(i.totalAmount),
          currency: i.currency,
          status: i.status,
          detail: i.dueDate ? `Due ${i.dueDate.toISOString().slice(0, 10)}` : null,
          link: { kind: 'supplier-invoice', id: i.id },
        }));
      }
      case 'grns': {
        const where = { ...scoped, supplierId: id };
        const [rows, total] = await Promise.all([
          this.db.goodsReceivedNote.findMany({
            where,
            orderBy: [{ receivedDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: { id: true, grnNumber: true, receivedDate: true, status: true },
          }),
          this.db.goodsReceivedNote.count({ where }),
        ]);
        return this.section(section, rows, total, (g) => ({
          id: g.id,
          number: g.grnNumber,
          date: iso(g.receivedDate),
          amount: null,
          currency: null,
          status: g.status,
          detail: null,
          link: { kind: 'grn', id: g.id },
        }));
      }
      case 'purchase-orders': {
        const where = { ...scoped, supplierId: id };
        const [rows, total] = await Promise.all([
          this.db.purchaseOrder.findMany({
            where,
            orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              purchaseOrderNumber: true,
              orderDate: true,
              totalAmount: true,
              currency: true,
              status: true,
              supplierInvoiceNumber: true,
            },
          }),
          this.db.purchaseOrder.count({ where }),
        ]);
        return this.section(section, rows, total, (o) => ({
          id: o.id,
          number: o.purchaseOrderNumber,
          date: iso(o.orderDate),
          amount: money(o.totalAmount),
          currency: o.currency,
          status: o.status,
          detail: o.supplierInvoiceNumber ? `Invoice ${o.supplierInvoiceNumber}` : null,
          link: { kind: 'purchase-order', id: o.id },
        }));
      }
      case 'desk-invoices': {
        const where: Prisma.InvoiceDeskInvoiceWhereInput = {
          companyId,
          voidedAt: null,
          supplier: { canonicalSupplierId: id },
          ...scope,
        };
        const [rows, total] = await Promise.all([
          this.db.invoiceDeskInvoice.findMany({
            where,
            orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              totalAmount: true,
              paidAmount: true,
              currency: true,
            },
          }),
          this.db.invoiceDeskInvoice.count({ where }),
        ]);
        return this.section(section, rows, total, (i) => {
          const balance = i.totalAmount.minus(i.paidAmount);
          return {
            id: i.id,
            number: i.invoiceNumber,
            date: iso(i.invoiceDate),
            amount: money(balance),
            currency: i.currency,
            status: balance.lte(0) ? 'PAID' : i.paidAmount.gt(0) ? 'PARTIALLY_PAID' : 'OPEN',
            detail: `Total ${i.totalAmount.toFixed(2)} · Due ${i.dueDate.toISOString().slice(0, 10)}`,
            link: { kind: 'desk-invoice', id: i.id },
          };
        });
      }
      case 'contracts':
        return this.contracts({ supplierId: id }, companyId, scope);
      case 'loans': {
        const where: Prisma.LoanWhereInput = {
          supplierId: id,
          companyId,
          deletedAt: null,
          ...scope,
        };
        const [rows, total] = await Promise.all([
          this.db.loan.findMany({
            where,
            orderBy: [{ disbursementDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              loanReference: true,
              lenderName: true,
              principalAmount: true,
              outstandingBalance: true,
              currency: true,
              status: true,
              maturityDate: true,
              disbursementDate: true,
            },
          }),
          this.db.loan.count({ where }),
        ]);
        return this.section(section, rows, total, (l) => ({
          id: l.id,
          number: l.loanReference || l.lenderName,
          date: iso(l.disbursementDate),
          amount: money(l.outstandingBalance),
          currency: l.currency,
          status: l.status,
          detail: `Principal ${l.principalAmount.toFixed(2)} · Matures ${l.maturityDate.toISOString().slice(0, 10)}`,
          link: { kind: 'loan', id: l.id },
        }));
      }
      case 'debts': {
        const where: Prisma.DebtWhereInput = { supplierId: id, companyId, deletedAt: null };
        const [rows, total] = await Promise.all([
          this.db.debt.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              description: true,
              invoiceNumber: true,
              amount: true,
              amountPaid: true,
              currency: true,
              status: true,
              dueDate: true,
              createdAt: true,
            },
          }),
          this.db.debt.count({ where }),
        ]);
        return this.section(section, rows, total, (d) => ({
          id: d.id,
          number: d.description,
          date: iso(d.createdAt),
          amount: money(d.amount.minus(d.amountPaid)),
          currency: d.currency,
          status: d.status,
          detail: join([
            d.invoiceNumber,
            d.dueDate ? `Due ${d.dueDate.toISOString().slice(0, 10)}` : null,
          ]),
          link: { kind: 'debt', id: d.id },
        }));
      }
      case 'contacts':
        return this.contacts('SUPPLIER', id, companyId);
      case 'communications':
        return this.communications('SUPPLIER', id, companyId);
      case 'documents':
        return this.documents('SUPPLIER', id, companyId, scope);
    }
    throw new BadRequestException('Unknown profile section.');
  }

  async customer(user: AuthUser, id: string, section: string): Promise<RelatedSection> {
    const permission = (CUSTOMER_SECTIONS as Record<string, string>)[section];
    if (!permission) throw new BadRequestException('Unknown profile section.');
    this.require(user, permission);
    const { companyId, scope } = await this.load(user, 'customer', id);
    const scoped = { companyId, deletedAt: null, ...scope };
    switch (section as CustomerSection) {
      case 'payments': {
        const where = { ...scoped, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.customerPayment.findMany({
            where,
            orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              paymentNumber: true,
              paymentDate: true,
              amount: true,
              currency: true,
              status: true,
              method: true,
              reference: true,
            },
          }),
          this.db.customerPayment.count({ where }),
        ]);
        return this.section(section, rows, total, (p) => ({
          id: p.id,
          number: p.paymentNumber,
          date: iso(p.paymentDate),
          amount: money(p.amount),
          currency: p.currency,
          status: p.status,
          detail: join([p.method, p.reference]),
          link: { kind: 'customer-payment', id: p.id },
        }));
      }
      case 'cash':
        return this.cash({ customerId: id }, companyId, scope);
      case 'notebook':
        return this.notebook({ customerId: id }, companyId, scope);
      case 'credit-notes': {
        const where = { ...scoped, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.creditNote.findMany({
            where,
            orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              creditNoteNumber: true,
              issueDate: true,
              totalAmount: true,
              currency: true,
              status: true,
            },
          }),
          this.db.creditNote.count({ where }),
        ]);
        return this.section(section, rows, total, (n) => ({
          id: n.id,
          number: n.creditNoteNumber,
          date: iso(n.issueDate),
          amount: money(n.totalAmount),
          currency: n.currency,
          status: n.status,
          detail: null,
          link: { kind: 'credit-note', id: n.id },
        }));
      }
      case 'refunds': {
        const where = { ...scoped, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.refund.findMany({
            where,
            orderBy: [{ refundDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              refundNumber: true,
              refundDate: true,
              amount: true,
              currency: true,
              status: true,
              voidedAt: true,
            },
          }),
          this.db.refund.count({ where }),
        ]);
        return this.section(section, rows, total, (r) => ({
          id: r.id,
          number: r.refundNumber,
          date: iso(r.refundDate),
          amount: money(r.amount),
          currency: r.currency,
          status: r.voidedAt ? 'VOIDED' : r.status,
          detail: null,
          link: { kind: 'refund', id: r.id },
        }));
      }
      case 'quotations': {
        const where = { ...scoped, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.quotation.findMany({
            where,
            orderBy: [{ quotationDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              quotationNumber: true,
              quotationDate: true,
              totalAmount: true,
              currency: true,
              status: true,
            },
          }),
          this.db.quotation.count({ where }),
        ]);
        return this.section(section, rows, total, (q) => ({
          id: q.id,
          number: q.quotationNumber,
          date: iso(q.quotationDate),
          amount: money(q.totalAmount),
          currency: q.currency,
          status: q.status,
          detail: null,
          link: null,
        }));
      }
      case 'proformas': {
        const where = { ...scoped, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.proformaInvoice.findMany({
            where,
            orderBy: [{ proformaDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              proformaNumber: true,
              proformaDate: true,
              totalAmount: true,
              currency: true,
              status: true,
            },
          }),
          this.db.proformaInvoice.count({ where }),
        ]);
        return this.section(section, rows, total, (p) => ({
          id: p.id,
          number: p.proformaNumber,
          date: iso(p.proformaDate),
          amount: money(p.totalAmount),
          currency: p.currency,
          status: p.status,
          detail: null,
          link: null,
        }));
      }
      case 'delivery-notes': {
        const branchScope = (scope as { branchId?: Prisma.StringFilter | string }).branchId;
        const where: Prisma.DeliveryNoteWhereInput = {
          companyId,
          deletedAt: null,
          customerId: id,
          ...(branchScope !== undefined ? { branchId: branchScope } : {}),
        };
        const [rows, total] = await Promise.all([
          this.db.deliveryNote.findMany({
            where,
            orderBy: [{ deliveryDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              deliveryNoteNumber: true,
              deliveryDate: true,
              vehicleNumber: true,
              status: true,
            },
          }),
          this.db.deliveryNote.count({ where }),
        ]);
        return this.section(section, rows, total, (n) => ({
          id: n.id,
          number: n.deliveryNoteNumber,
          date: iso(n.deliveryDate),
          amount: null,
          currency: null,
          status: n.status,
          detail: n.vehicleNumber ? `Vehicle ${n.vehicleNumber}` : null,
          link: null,
        }));
      }
      case 'desk-sales': {
        const where: Prisma.SalesDeskSaleWhereInput = {
          companyId,
          voidedAt: null,
          customer: { canonicalCustomerId: id },
          ...scope,
        };
        const [rows, total] = await Promise.all([
          this.db.salesDeskSale.findMany({
            where,
            orderBy: [{ dueDate: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              saleNumber: true,
              dueDate: true,
              totalAmount: true,
              paidAmount: true,
              currency: true,
            },
          }),
          this.db.salesDeskSale.count({ where }),
        ]);
        return this.section(section, rows, total, (s) => {
          const balance = s.totalAmount.minus(s.paidAmount);
          return {
            id: s.id,
            number: s.saleNumber,
            date: iso(s.dueDate),
            amount: money(balance),
            currency: s.currency,
            status: balance.lte(0) ? 'PAID' : s.paidAmount.gt(0) ? 'PARTIALLY_PAID' : 'OPEN',
            detail: `Total ${s.totalAmount.toFixed(2)}`,
            link: { kind: 'desk-sale', id: s.id },
          };
        });
      }
      case 'packages': {
        const where: Prisma.CustomerPackageBalanceWhereInput = { companyId, customerId: id };
        const [rows, total] = await Promise.all([
          this.db.customerPackageBalance.findMany({
            where,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: PAGE,
            select: {
              id: true,
              updatedAt: true,
              quantityOwedByCustomer: true,
              quantityOwedToCustomer: true,
              depositBalance: true,
              returnablePackage: { select: { name: true, packageCode: true } },
            },
          }),
          this.db.customerPackageBalance.count({ where }),
        ]);
        return this.section(section, rows, total, (b) => ({
          id: b.id,
          number: b.returnablePackage?.name ?? 'Package',
          date: iso(b.updatedAt),
          amount: money(b.depositBalance),
          currency: null,
          status: null,
          detail: join([
            b.returnablePackage?.packageCode,
            `Owed by customer ${new Prisma.Decimal(b.quantityOwedByCustomer).toFixed(2)}`,
            `Owed to customer ${new Prisma.Decimal(b.quantityOwedToCustomer).toFixed(2)}`,
          ]),
          link: null,
        }));
      }
      case 'contracts':
        return this.contracts({ customerId: id }, companyId, scope);
      case 'contacts':
        return this.contacts('CUSTOMER', id, companyId);
      case 'communications':
        return this.communications('CUSTOMER', id, companyId);
      case 'documents':
        return this.documents('CUSTOMER', id, companyId, scope);
    }
    throw new BadRequestException('Unknown profile section.');
  }
}
