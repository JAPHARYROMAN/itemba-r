import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  DeskInvoiceDto,
  DeskEditDto,
  DeskPaymentDto,
  DeskQuery,
  DeskReasonDto,
  DeskSupplierDto,
} from './invoice-desk.dto';
import { deskBalance, deskKey, positiveAmount, todayUtc } from './invoice-desk.domain';
import { previewDocument } from '../documents/document-preview';

const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
  supplier: { select: { name: true, email: true, phone: true } },
} as const;
const attachmentMeta = {
  id: true,
  name: true,
  size: true,
  mimeType: true,
  createdAt: true,
} as const;

@Injectable()
export class InvoiceDeskService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  private async where(
    user: AuthUser,
    q: DeskQuery = { page: 1 },
  ): Promise<Prisma.InvoiceDeskInvoiceWhereInput> {
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('Start date must be on or before end date.');
    const company = await this.companies.companyWhereFor(user, q.companyId);
    const scope = await this.org.recordWhereFor(user);
    const today = todayUtc(),
      next = new Date(today.getTime() + 7 * 86400000);
    const open = {
      voidedAt: null,
      paidAmount: { lt: this.db.invoiceDeskInvoice.fields.totalAmount },
    };
    const statuses: Record<string, Prisma.InvoiceDeskInvoiceWhereInput> = {
      unpaid: { voidedAt: null, paidAmount: 0 },
      partial: { AND: [open, { paidAmount: { gt: 0 } }] },
      paid: {
        voidedAt: null,
        paidAmount: { equals: this.db.invoiceDeskInvoice.fields.totalAmount },
      },
      overdue: { ...open, dueDate: { lt: today } },
      due: { ...open, dueDate: { gte: today, lte: next } },
      void: { voidedAt: { not: null } },
    };
    return {
      AND: [
        company,
        scope,
        {
          divisionId: q.divisionId,
          branchId: q.branchId,
          supplierId: q.supplierId,
          invoiceDate: {
            gte: q.from ? new Date(q.from) : undefined,
            lte: q.to ? new Date(q.to) : undefined,
          },
        },
        statuses[q.status ?? ''] ?? {},
        q.search?.trim()
          ? {
              OR: [
                { invoiceNumber: { contains: q.search.trim(), mode: 'insensitive' } },
                { description: { contains: q.search.trim(), mode: 'insensitive' } },
                { supplier: { name: { contains: q.search.trim(), mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
  }

  async directory(user: AuthUser) {
    const companyScope = await this.companies.companyWhereFor(user);
    const accessible = await this.org.accessibleIds(user);
    const branchScope = accessible.unrestricted
      ? {}
      : {
          OR: [
            { id: { in: accessible.branchIds } },
            { divisionId: { in: accessible.divisionIds } },
          ],
        };
    const branches = await this.db.branch.findMany({
      where: {
        AND: [
          branchScope,
          {
            isActive: true,
            deletedAt: null,
            division: {
              ...companyScope,
              isActive: true,
              deletedAt: null,
              company: { status: 'ACTIVE', deletedAt: null },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        divisionId: true,
        division: {
          select: {
            id: true,
            name: true,
            companyId: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    // Include accessible companies even before their first branch is set up.
    const companyIds =
      'companyId' in companyScope ? companyScope.companyId : { in: [] as string[] };
    const companies = await this.db.company.findMany({
      where: { id: companyIds, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      companies,
      divisions: [
        ...new Map(
          branches.map((b) => [
            b.divisionId,
            { id: b.divisionId, name: b.division.name, companyId: b.division.companyId },
          ]),
        ).values(),
      ],
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        divisionId: b.divisionId,
        companyId: b.division.companyId,
      })),
    };
  }

  async suppliers(user: AuthUser, q: DeskQuery) {
    return this.db.invoiceDeskSupplier.findMany({
      where: {
        AND: [
          await this.companies.companyWhereFor(user, q.companyId),
          q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {},
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async createSupplier(user: AuthUser, dto: DeskSupplierDto) {
    await this.companies.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (!dto.name.trim()) throw new BadRequestException('Enter a supplier name.');
    return this.unique(() =>
      this.db.$transaction(async (tx) => {
        const supplier = await tx.invoiceDeskSupplier.create({
          data: { ...dto, name: dto.name.trim(), nameKey: deskKey(dto.name) },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'INVOICE_DESK_SUPPLIER_CREATED',
          entityType: 'InvoiceDeskSupplier',
          entityId: supplier.id,
          companyId: dto.companyId,
          userId: user.id,
          newValue: { name: supplier.name },
        });
        return supplier;
      }),
    );
  }

  async list(user: AuthUser, q: DeskQuery) {
    const where = await this.where(user, q),
      page = q.page || 1;
    const [rows, total] = await this.db.$transaction(
      [
        this.db.invoiceDeskInvoice.findMany({
          where,
          include: names,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * 25,
          take: 25,
        }),
        this.db.invoiceDeskInvoice.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      rows: rows.map((row) => ({ ...row, ...deskBalance(row) })),
      total,
      page,
      pageSize: 25,
    };
  }

  async overview(user: AuthUser, q: DeskQuery) {
    const rows = await this.db.invoiceDeskInvoice.findMany({
      where: {
        AND: [
          await this.where(user, {
            ...q,
            companyId: q.companyId,
            divisionId: q.divisionId,
            branchId: q.branchId,
            page: 1,
          }),
          { voidedAt: null },
        ],
      },
      select: {
        supplierId: true,
        supplier: { select: { name: true } },
        currency: true,
        totalAmount: true,
        paidAmount: true,
        dueDate: true,
        voidedAt: true,
      },
    });
    const currencies = new Map<
      string,
      {
        currency: string;
        total: Prisma.Decimal;
        paid: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        overdue: Prisma.Decimal;
        due: Prisma.Decimal;
        count: number;
      }
    >();
    const suppliers = new Map<
      string,
      { id: string; name: string; currency: string; outstanding: Prisma.Decimal; count: number }
    >();
    const today = todayUtc(),
      next = new Date(today.getTime() + 7 * 86400000);
    for (const row of rows) {
      const balance = row.totalAmount.minus(row.paidAmount);
      const c = currencies.get(row.currency) ?? {
        currency: row.currency,
        total: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
        outstanding: new Prisma.Decimal(0),
        overdue: new Prisma.Decimal(0),
        due: new Prisma.Decimal(0),
        count: 0,
      };
      c.total = c.total.plus(row.totalAmount);
      c.paid = c.paid.plus(row.paidAmount);
      c.outstanding = c.outstanding.plus(balance);
      c.count++;
      if (row.dueDate < today) c.overdue = c.overdue.plus(balance);
      else if (row.dueDate <= next) c.due = c.due.plus(balance);
      currencies.set(row.currency, c);
      if (balance.gt(0)) {
        const key = `${row.supplierId}:${row.currency}`;
        const s = suppliers.get(key) ?? {
          id: row.supplierId,
          name: row.supplier.name,
          currency: row.currency,
          outstanding: new Prisma.Decimal(0),
          count: 0,
        };
        s.outstanding = s.outstanding.plus(balance);
        s.count++;
        suppliers.set(key, s);
      }
    }
    return {
      currencies: [...currencies.values()],
      suppliers: [...suppliers.values()].sort(
        (a, b) => a.currency.localeCompare(b.currency) || b.outstanding.comparedTo(a.outstanding),
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.db.invoiceDeskInvoice.findFirst({
      where: { AND: [{ id }, await this.where(user)] },
      include: {
        ...names,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: { cashMovement: { select: { id: true } } },
        },
        attachments: { select: attachmentMeta, orderBy: { createdAt: 'desc' } },
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!row) throw new NotFoundException('Invoice not found.');
    return { ...row, ...deskBalance(row) };
  }

  private async writable(user: AuthUser, id: string) {
    const row = await this.detail(user, id);
    await this.companies.assertCanAccessCompany(user, row.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, AccessLevel.WRITE);
    return row;
  }

  private async event(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    invoice: { id: string; companyId: string },
    action: string,
    detail: string,
  ) {
    await tx.invoiceDeskEvent.create({
      data: {
        invoiceId: invoice.id,
        actorId: user.id,
        actorName: user.fullName || user.email,
        action,
        detail,
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: `INVOICE_DESK_${action}`,
      entityType: 'InvoiceDeskInvoice',
      entityId: invoice.id,
      companyId: invoice.companyId,
      userId: user.id,
      metadata: { detail },
    });
  }

  async create(user: AuthUser, dto: DeskInvoiceDto) {
    await this.companies.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, dto.divisionId, dto.branchId, AccessLevel.WRITE);
    const branch = await this.db.branch.findFirst({
      where: {
        id: dto.branchId,
        divisionId: dto.divisionId,
        isActive: true,
        deletedAt: null,
        division: {
          companyId: dto.companyId,
          isActive: true,
          deletedAt: null,
          company: { status: 'ACTIVE', deletedAt: null },
        },
      },
    });
    const supplier = await this.db.invoiceDeskSupplier.findFirst({
      where: { id: dto.supplierId, companyId: dto.companyId },
    });
    if (!branch || !supplier)
      throw new BadRequestException('Select a supplier and branch belonging to this company.');
    if (!dto.invoiceNumber.trim() || !dto.description.trim())
      throw new BadRequestException('Enter an invoice number and purchase description.');
    const invoiceDate = new Date(dto.invoiceDate),
      dueDate = new Date(dto.dueDate);
    if (invoiceDate > todayUtc() || dueDate < invoiceDate)
      throw new BadRequestException(
        'Issue date cannot be in the future; due date cannot precede it.',
      );
    const totalAmount = positiveAmount(dto.totalAmount);
    return this.unique(() =>
      this.db.$transaction(async (tx) => {
        const row = await tx.invoiceDeskInvoice.create({
          data: {
            ...dto,
            invoiceNumber: dto.invoiceNumber.trim(),
            description: dto.description.trim(),
            numberKey: deskKey(dto.invoiceNumber),
            invoiceDate,
            dueDate,
            totalAmount,
          },
        });
        await this.event(
          tx,
          user,
          row,
          'CREATED',
          `Invoice ${row.invoiceNumber} recorded · ${row.currency} ${totalAmount.toFixed(2)}`,
        );
        return row;
      }),
    );
  }

  async edit(user: AuthUser, id: string, dto: DeskEditDto) {
    await this.writable(user, id);
    const invoiceDate = new Date(dto.invoiceDate),
      dueDate = new Date(dto.dueDate);
    if (!dto.invoiceNumber.trim() || !dto.description.trim())
      throw new BadRequestException('Enter an invoice number and purchase description.');
    if (invoiceDate > todayUtc() || dueDate < invoiceDate)
      throw new BadRequestException(
        'Issue date cannot be in the future; due date cannot precede it.',
      );
    const totalAmount = positiveAmount(dto.totalAmount);
    return this.unique(() =>
      this.db.$transaction(async (tx) => {
        const old = await this.claim(tx, id, dto.version);
        if (await tx.invoiceDeskPayment.count({ where: { invoiceId: id } }))
          throw new ConflictException(
            'Invoices with payment history cannot be edited. Keep the original record for reconciliation.',
          );
        const values = {
          invoiceNumber: dto.invoiceNumber,
          description: dto.description,
          currency: dto.currency,
          invoiceDate: dto.invoiceDate,
          dueDate: dto.dueDate,
          totalAmount: dto.totalAmount,
          notes: dto.notes,
        };
        const updated = await tx.invoiceDeskInvoice.update({
          where: { id },
          data: {
            ...values,
            invoiceNumber: dto.invoiceNumber.trim(),
            description: dto.description.trim(),
            numberKey: deskKey(dto.invoiceNumber),
            invoiceDate,
            dueDate,
            totalAmount,
          },
        });
        await this.event(
          tx,
          user,
          old,
          'UPDATED',
          `Invoice ${old.invoiceNumber} → ${updated.invoiceNumber} · ${old.currency} ${old.totalAmount.toFixed(2)} → ${updated.currency} ${updated.totalAmount.toFixed(2)}`,
        );
        await this.audit.logStrictInTransaction(tx, {
          action: 'INVOICE_DESK_DETAILS_CHANGED',
          entityType: 'InvoiceDeskInvoice',
          entityId: id,
          companyId: old.companyId,
          userId: user.id,
          oldValue: {
            invoiceNumber: old.invoiceNumber,
            description: old.description,
            notes: old.notes,
            invoiceDate: old.invoiceDate.toISOString(),
            dueDate: old.dueDate.toISOString(),
            totalAmount: old.totalAmount.toFixed(2),
            currency: old.currency,
          },
          newValue: { ...values },
        });
        return updated;
      }),
    );
  }

  private async claim(tx: Prisma.TransactionClient, id: string, version: number) {
    const updated = await tx.invoiceDeskInvoice.updateMany({
      where: { id, version, voidedAt: null },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new ConflictException('This invoice changed. Refresh it before trying again.');
    return tx.invoiceDeskInvoice.findUniqueOrThrow({ where: { id } });
  }

  async payment(user: AuthUser, id: string, dto: DeskPaymentDto) {
    await this.writable(user, id);
    return this.unique(() =>
      this.db.$transaction((tx) => this.paymentInTransaction(tx, user, id, dto)),
    );
  }

  async paymentInTransaction(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    dto: DeskPaymentDto,
  ) {
    await this.writable(user, id);
    const amount = positiveAmount(dto.amount),
      paymentDate = new Date(dto.paymentDate);
    if (paymentDate > todayUtc())
      throw new BadRequestException('Record only payments already made.');
    const existing = await tx.invoiceDeskPayment.findUnique({
      where: { requestId: dto.requestId },
    });
    if (existing) {
      if (
        existing.invoiceId !== id ||
        !existing.amount.eq(amount) ||
        existing.paymentDate.getTime() !== paymentDate.getTime() ||
        existing.method !== dto.method ||
        existing.reference !== dto.reference.trim()
      )
        throw new ConflictException(
          'This payment reference was already used for a different request.',
        );
      return existing;
    }
    const invoice = await this.claim(tx, id, dto.version);
    if (paymentDate < invoice.invoiceDate)
      throw new BadRequestException('Payment date cannot precede the invoice date.');
    if (amount.gt(invoice.totalAmount.minus(invoice.paidAmount)))
      throw new BadRequestException('Payment exceeds the outstanding balance.');
    const payment = await tx.invoiceDeskPayment.create({
      data: {
        invoiceId: id,
        requestId: dto.requestId,
        amount,
        paymentDate,
        method: dto.method,
        reference: dto.reference.trim(),
        createdBy: user.id,
      },
    });
    await tx.invoiceDeskInvoice.update({
      where: { id },
      data: { paidAmount: { increment: amount } },
    });
    await this.event(
      tx,
      user,
      invoice,
      'PAYMENT_RECORDED',
      `${invoice.currency} ${amount.toFixed(2)} · ${dto.method} · ${dto.reference.trim() || 'No reference'}`,
    );
    return payment;
  }

  async reverse(user: AuthUser, id: string, paymentId: string, dto: DeskReasonDto) {
    return this.db.$transaction((tx) => this.reverseInTransaction(tx, user, id, paymentId, dto));
  }

  async reverseInTransaction(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    paymentId: string,
    dto: DeskReasonDto,
    fromCashDesk = false,
  ) {
    await this.writable(user, id);
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Enter a reason for the reversal.');
    const invoice = await this.claim(tx, id, dto.version);
    if (
      !fromCashDesk &&
      (await tx.cashDeskMovement.findUnique({ where: { invoicePaymentId: paymentId } }))
    )
      throw new ConflictException(
        'Reverse this payment in Cash Desk to keep the cash and invoice balances together.',
      );
    const payment = await tx.invoiceDeskPayment.findFirst({
      where: { id: paymentId, invoiceId: id, reversedAt: null },
    });
    if (!payment) throw new ConflictException('This payment is missing or already reversed.');
    await tx.invoiceDeskPayment.update({
      where: { id: paymentId },
      data: { reversedAt: new Date(), reversalReason: dto.reason.trim() },
    });
    await tx.invoiceDeskInvoice.update({
      where: { id },
      data: { paidAmount: { decrement: payment.amount } },
    });
    await this.event(
      tx,
      user,
      invoice,
      'PAYMENT_REVERSED',
      `${invoice.currency} ${payment.amount.toFixed(2)} · ${dto.reason.trim()}`,
    );
    return { success: true };
  }

  async void(user: AuthUser, id: string, dto: DeskReasonDto) {
    await this.writable(user, id);
    if (dto.reason.trim().length < 3) throw new BadRequestException('Enter a reason for voiding.');
    return this.db.$transaction(async (tx) => {
      const invoice = await this.claim(tx, id, dto.version);
      if (!invoice.paidAmount.eq(0))
        throw new BadRequestException('Reverse recorded payments before voiding this invoice.');
      await tx.invoiceDeskInvoice.update({ where: { id }, data: { voidedAt: new Date() } });
      await this.event(tx, user, invoice, 'VOIDED', dto.reason.trim());
      return { success: true };
    });
  }

  async attach(user: AuthUser, id: string, file?: Express.Multer.File) {
    const invoice = await this.writable(user, id);
    if (!file?.buffer?.length || file.size > 10 * 1024 * 1024)
      throw new BadRequestException('Choose a PDF, PNG or JPEG up to 10 MB.');
    const bytes = file.buffer;
    const mimeType =
      bytes.subarray(0, 5).toString() === '%PDF-'
        ? 'application/pdf'
        : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? 'image/jpeg'
            : '';
    if (!mimeType) throw new BadRequestException('Only PDF, PNG and JPEG files are supported.');
    const name = file.originalname.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200),
      digest = createHash('sha256').update(bytes).digest('hex');
    return this.unique(() =>
      this.db.$transaction(async (tx) => {
        await this.claim(tx, id, invoice.version);
        if ((await tx.invoiceDeskAttachment.count({ where: { invoiceId: id } })) >= 10)
          throw new BadRequestException('An invoice can hold up to 10 attachments.');
        const attachment = await tx.invoiceDeskAttachment.create({
          data: { invoiceId: id, name, mimeType, size: file.size, digest, content: bytes },
          select: attachmentMeta,
        });
        await this.event(tx, user, invoice, 'ATTACHMENT_ADDED', name);
        return attachment;
      }),
    );
  }

  async attachment(user: AuthUser, id: string, attachmentId: string) {
    await this.detail(user, id);
    const file = await this.db.invoiceDeskAttachment.findFirst({
      where: { id: attachmentId, invoiceId: id },
    });
    if (!file) throw new NotFoundException('Attachment not found.');
    return file;
  }

  async previewAttachment(user: AuthUser, id: string, attachmentId: string) {
    const file = await this.attachment(user, id, attachmentId);
    return previewDocument(Buffer.from(file.content), file.mimeType);
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException(
          'This record already exists. Check the supplier name, invoice number or attachment before retrying.',
        );
      throw error;
    }
  }
}
