import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import type { PostingLine } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import {
  CreateSupplierInvoiceDto,
  SupplierInvoiceLineDto,
} from './dto/create-supplier-invoice.dto';
import { UpdateSupplierInvoiceDto } from './dto/update-supplier-invoice.dto';
import { QuerySupplierInvoiceDto } from './dto/query-supplier-invoice.dto';
import { ApproveSupplierInvoiceDto } from './dto/approve-supplier-invoice.dto';
import { VoidSupplierInvoiceDto } from './dto/void-supplier-invoice.dto';
import { computeThreeWayMatch } from '../three-way-matching/three-way-match-calculator';

const MONEY_TOLERANCE = new Prisma.Decimal('0.01');

@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: QuerySupplierInvoiceDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      supplierId,
      status,
      purchaseOrderId,
      goodsReceivedNoteId,
      search,
      page = 1,
      limit = 20,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: Prisma.SupplierInvoiceWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    if (supplierId) where.supplierId = supplierId;
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (goodsReceivedNoteId) where.goodsReceivedNoteId = goodsReceivedNoteId;
    if (search) {
      where.OR = [
        { supplierInvoiceNumber: { contains: search, mode: 'insensitive' } },
        { invoiceReference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          goodsReceivedNote: { select: { id: true, grnNumber: true, status: true } },
          lines: true,
        },
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);

    const data = await this.decorateInvoices(items);
    return {
      data,
      items: data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        goodsReceivedNote: { select: { id: true, grnNumber: true, status: true } },
        lines: true,
      },
    });
    if (!item) throw new NotFoundException('Supplier invoice not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    const [decorated] = await this.decorateInvoices([item]);
    return decorated;
  }

  async create(dto: CreateSupplierInvoiceDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const refs = await this.assertProcurementReferences({
      companyId: dto.companyId,
      supplierId: dto.supplierId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      purchaseOrderId: dto.purchaseOrderId,
      goodsReceivedNoteId: dto.goodsReceivedNoteId,
      currency: dto.currency ?? CurrencyCode.TZS,
    });
    await this.assertInvoiceNumberAvailable({
      companyId: dto.companyId,
      supplierId: dto.supplierId,
      invoiceNumber: dto.supplierInvoiceNumber,
      purchaseOrderId: refs.purchaseOrderId,
    });
    const totals = this.buildInvoiceLines(dto.lines, dto.totalAmount);

    const item = await this.prisma.supplierInvoice.create({
      data: {
        supplierInvoiceNumber: dto.supplierInvoiceNumber.trim(),
        companyId: dto.companyId,
        divisionId: refs.divisionId,
        branchId: refs.branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: refs.purchaseOrderId,
        goodsReceivedNoteId: dto.goodsReceivedNoteId,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        invoiceReference: dto.invoiceReference?.trim() || undefined,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        outstandingAmount: totals.totalAmount,
        currency: dto.currency ?? CurrencyCode.TZS,
        status: 'DRAFT',
        notes: dto.notes?.trim() || undefined,
        createdById: user.id,
        lines: { create: totals.lines },
      },
      include: { lines: true },
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_CREATE',
      entityType: 'SupplierInvoice',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
      newValue: item as any,
    });

    return item;
  }

  async update(id: string, dto: UpdateSupplierInvoiceDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'RECEIVED', 'DISPUTED'].includes(existing.status)) {
      throw new BadRequestException('Only draft, received, or disputed invoices can be updated');
    }
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Supplier invoice company cannot be changed');
    }
    const supplierId = dto.supplierId ?? existing.supplierId;
    const refs = await this.assertProcurementReferences({
      companyId: existing.companyId,
      supplierId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      purchaseOrderId: dto.purchaseOrderId ?? existing.purchaseOrderId ?? undefined,
      goodsReceivedNoteId: dto.goodsReceivedNoteId ?? existing.goodsReceivedNoteId ?? undefined,
      currency: dto.currency ?? existing.currency,
    });
    if (
      dto.supplierInvoiceNumber !== undefined ||
      dto.supplierId !== undefined ||
      dto.purchaseOrderId !== undefined
    ) {
      await this.assertInvoiceNumberAvailable({
        companyId: existing.companyId,
        supplierId,
        invoiceNumber: dto.supplierInvoiceNumber ?? existing.supplierInvoiceNumber,
        excludeInvoiceId: id,
        purchaseOrderId: refs.purchaseOrderId,
      });
    }
    const totals = dto.lines ? this.buildInvoiceLines(dto.lines, dto.totalAmount) : undefined;
    const invalidatesMatch =
      dto.lines !== undefined ||
      dto.supplierId !== undefined ||
      dto.purchaseOrderId !== undefined ||
      dto.goodsReceivedNoteId !== undefined ||
      dto.currency !== undefined ||
      dto.totalAmount !== undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the exact version read by findOne before rewriting children or
      // match inputs. This serializes update() against runMatch() and other
      // editors; losing the CAS leaves every child and match row untouched.
      const claim = await tx.supplierInvoice.updateMany({
        where: {
          id,
          deletedAt: null,
          status: existing.status,
          updatedAt: existing.updatedAt,
        },
        data: { updatedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException(
          'Supplier invoice was changed by another action; refresh before updating',
        );
      }

      if (totals) {
        await tx.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: id } });
      }
      if (invalidatesMatch) {
        // Supplier, PO, GRN, currency, totals, and lines all feed matching or its
        // ownership invariants. Retire the active result and reset to DRAFT so a
        // later run recomputes instead of returning stale MATCHED/DISPUTED data.
        await tx.threeWayMatch.updateMany({
          where: { supplierInvoiceId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
      return tx.supplierInvoice.update({
        where: { id },
        data: {
          ...(dto.supplierInvoiceNumber !== undefined && {
            supplierInvoiceNumber: dto.supplierInvoiceNumber.trim(),
          }),
          ...(dto.supplierId !== undefined && { supplierId }),
          divisionId: refs.divisionId,
          branchId: refs.branchId,
          ...(dto.purchaseOrderId !== undefined && { purchaseOrderId: refs.purchaseOrderId }),
          ...(dto.goodsReceivedNoteId !== undefined && {
            goodsReceivedNoteId: dto.goodsReceivedNoteId || null,
          }),
          ...(dto.invoiceDate !== undefined && { invoiceDate: new Date(dto.invoiceDate) }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
          ...(dto.invoiceReference !== undefined && {
            invoiceReference: dto.invoiceReference?.trim() || null,
          }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...(invalidatesMatch && { status: 'DRAFT' }),
          ...(totals && {
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            totalAmount: totals.totalAmount,
            outstandingAmount: totals.totalAmount,
            lines: { create: totals.lines },
          }),
        },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_UPDATE',
      entityType: 'SupplierInvoice',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      newValue: updated as any,
    });

    return updated;
  }

  async runMatch(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    // MATCHED/DISPUTED are accepted as idempotent replays. The guarded claim in
    // createThreeWayMatch returns the existing active match instead of allocating
    // another sequence number or row. An invoice edit resets status to DRAFT and
    // retires the prior match, which is the only path that performs a fresh match.
    if (!['DRAFT', 'RECEIVED', 'MATCHED', 'DISPUTED'].includes(existing.status as string)) {
      throw new BadRequestException(`A ${existing.status} supplier invoice cannot be re-matched`);
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const result = (await this.createThreeWayMatch(existing, user.id, tx, {
        claimStandalone: true,
      })) as { match: any; created: boolean };
      if (result.created) {
        await this.auditLogs.logStrictInTransaction(tx, {
          action: 'SUPPLIER_INVOICE_MATCH',
          entityType: 'SupplierInvoice',
          entityId: id,
          userId: user.id,
          companyId: existing.companyId,
          newValue: result.match as any,
        });
      }
      return result;
    });
    return outcome.match;
  }

  async approve(id: string, dto: ApproveSupplierInvoiceDto | undefined, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'RECEIVED', 'MATCHED', 'DISPUTED'].includes(existing.status)) {
      throw new BadRequestException('Invoice cannot be approved in its current status');
    }
    if (!existing.lines?.length) {
      throw new BadRequestException('Supplier invoice must have at least one line before approval');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: existing.supplierId, companyId: existing.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException('Supplier does not belong to this company');

    let match: any = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the exact invoice version evaluated above. Matching and editing both
      // advance updatedAt, so neither a runMatch() nor an update() that wins after
      // findOne() can be silently posted from this stale snapshot.
      const claim = await tx.supplierInvoice.updateMany({
        where: {
          id,
          deletedAt: null,
          status: existing.status,
          updatedAt: existing.updatedAt,
        },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id },
      });
      if (claim.count !== 1) {
        throw new ConflictException(
          'Supplier invoice was already approved or changed by another action',
        );
      }

      if (existing.purchaseOrderId) {
        if (['MATCHED', 'DISPUTED'].includes(existing.status as string)) {
          // runMatch() already committed the governed result represented by this
          // status. Reuse that sole active row instead of allocating another match
          // number and duplicating the result during approval.
          match = await tx.threeWayMatch.findFirst({
            where: {
              supplierInvoiceId: id,
              companyId: existing.companyId,
              purchaseOrderId: existing.purchaseOrderId,
              deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!match) {
            throw new ConflictException(
              'Supplier invoice is marked as matched but has no active three-way match',
            );
          }
        } else {
          match = await this.createThreeWayMatch(existing, user.id, tx);
        }
        if (match.matchStatus === 'VARIANCE' && !dto?.allowVariance) {
          throw new BadRequestException(
            'Supplier invoice has PO/GRN variance. Review the match or approve with variance.',
          );
        }
      }

      const oldPayable = existing.payableId
        ? await tx.payable.findUnique({
            where: { id: existing.payableId },
            select: { companyId: true, supplierId: true, paidAmount: true },
          })
        : null;

      const payable = existing.payableId
        ? await tx.payable.update({
            where: { id: existing.payableId },
            data: {
              supplierId: supplier.id,
              supplierName: supplier.name,
              divisionId: existing.divisionId,
              branchId: existing.branchId,
              amount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              // Derive outstanding from the PAYABLE's own paidAmount, never the
              // invoice's. The payable tracks payments applied directly against it
              // (recordPayment), which the invoice row does not see. Recomputing
              // outstanding from the invoice would resurrect already-paid amounts.
              outstandingAmount: new Prisma.Decimal(existing.totalAmount)
                .minus(oldPayable?.paidAmount ?? 0)
                .toDecimalPlaces(2),
              currency: existing.currency as CurrencyCode,
              issueDate: existing.invoiceDate,
              dueDate: existing.dueDate,
              sourceType: 'SupplierInvoice',
              sourceId: existing.id,
              notes: `Supplier invoice ${existing.supplierInvoiceNumber}`,
            },
          })
        : await tx.payable.create({
            data: {
              payableNumber: await this.codes.next({
                entityType: 'Payable',
                companyId: existing.companyId,
                tx,
              }),
              companyId: existing.companyId,
              divisionId: existing.divisionId,
              branchId: existing.branchId,
              supplierId: supplier.id,
              supplierName: supplier.name,
              sourceType: 'SupplierInvoice',
              sourceId: existing.id,
              amount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              paidAmount: 0,
              outstandingAmount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              currency: existing.currency as CurrencyCode,
              issueDate: existing.invoiceDate,
              dueDate: existing.dueDate,
              status: 'OPEN',
              notes: `Supplier invoice ${existing.supplierInvoiceNumber}`,
            },
          });

      if (existing.purchaseOrderId) {
        await tx.purchaseOrder.updateMany({
          where: { id: existing.purchaseOrderId, companyId: existing.companyId, deletedAt: null },
          data: { payableId: payable.id },
        });
      }

      if (!payable.journalEntryId) {
        const journalEntry = await this.postSupplierInvoicePayable(existing, payable, user.id, tx);
        await tx.payable.update({
          where: { id: payable.id },
          data: { journalEntryId: journalEntry.id },
        });
      }

      await this.syncSupplierBalance(
        tx,
        oldPayable?.companyId ?? payable.companyId,
        oldPayable?.supplierId,
      );
      await this.syncSupplierBalance(tx, payable.companyId, payable.supplierId);

      // Re-assert APPROVED as the FINAL write. For a PO-linked invoice,
      // createThreeWayMatch() above set status to MATCHED/DISPUTED; without this
      // re-assert a successfully-approved invoice would (a) read as un-approved and
      // (b) stay inside the atomic claim's re-claimable set, so a second approve()
      // would create duplicate three-way-match rows. approvedAt/approvedById were
      // set by the claim and are intentionally left intact.
      const invoice = await tx.supplierInvoice.update({
        where: { id },
        data: { status: 'APPROVED', payableId: payable.id },
        include: { lines: true },
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'SUPPLIER_INVOICE_APPROVE',
        entityType: 'SupplierInvoice',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: existing as any,
        newValue: { invoice, match } as any,
      });
      return invoice;
    });

    return updated;
  }

  /**
   * Void / reverse an APPROVED supplier invoice.
   *
   * A wrongly-approved invoice (entered against the wrong PO, disputed, etc.)
   * must be correctable. What "correct" means depends on where the invoice's
   * payable came from — this system is payable-at-receipt, so there are two
   * origins:
   *
   *  (a) The payable was CREATED by this invoice's own approve() (no PO
   *      receipt behind it, or the PO settled outside AP). approve() posted
   *      DR Inventory|Expense / CR AP via postSupplierInvoicePayable and the
   *      payable exists only because of this invoice. Voiding must fully unwind
   *      it: mirror-reverse that journal entry and cancel the payable.
   *
   *  (b) approve() REUSED a payable created at goods receipt
   *      (PurchaseOrdersService.receive -> createCreditPurchasePayable posted
   *      DR Inventory / CR AP and opened the payable the moment stock arrived
   *      on supplier credit). The receipt obligation is real regardless of this
   *      invoice — the goods are still in stock, still owed to the supplier —
   *      so voiding the invoice must NOT cancel the payable or touch the
   *      receipt accrual JE. It restores the payable to its pre-invoice state
   *      (amount/outstanding back to the receipt-created amount, source link
   *      back to the PO) and detaches the invoice from it.
   *
   * ORIGIN EVIDENCE (why we branch on the payable's backing journal entry and
   * not on PO.payableId or payable.sourceType): approve() unconditionally
   * writes PurchaseOrder.payableId = payable.id for every PO-linked invoice,
   * and its reuse branch rewrites payable.sourceType/sourceId to
   * 'SupplierInvoice'/<invoice.id> — so after approval BOTH origins look
   * identical on those fields. The one durable discriminator is
   * payable.journalEntryId's referenceType: createCreditPurchasePayable stamps
   * its receipt accrual with referenceType 'Payable' / referenceId <payable.id>
   * (moduleName 'purchase-orders'), while postSupplierInvoicePayable stamps
   * referenceType 'SupplierInvoice' / referenceId <invoice.id>. approve() never
   * overwrites journalEntryId once set (`if (!payable.journalEntryId)`), so the
   * backing JE still records who really created the liability.
   *
   * In ONE transaction:
   *   1) atomically claim the invoice APPROVED -> CANCELLED, pinned to the
   *      exact version read (idempotent: a re-void of an already-CANCELLED
   *      invoice is a no-op),
   *   2) block if the linked payable already carries payments (paidAmount > 0)
   *      — those must be unwound first (a partly-paid liability can't just
   *      vanish, or Cash and AP drift apart),
   *   3) branch on the payable's origin as above,
   *   4) re-sync the supplier balance and append the audit row in-transaction.
   */
  async void(id: string, dto: VoidSupplierInvoiceDto | undefined, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);

    // Idempotent short-circuit: an already-voided (CANCELLED) invoice needs no
    // work. Return it as-is so a retried void is a safe no-op.
    if (existing.status === 'CANCELLED') {
      return existing;
    }
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only an APPROVED supplier invoice can be voided');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim pinned to the exact version findOne() read: flip
      // APPROVED -> CANCELLED under a guarded write so a concurrent void (or a
      // payment that just moved the invoice) can't race this one into posting a
      // reversal from a stale snapshot. The loser sees count 0.
      const claim = await tx.supplierInvoice.updateMany({
        where: { id, deletedAt: null, status: 'APPROVED', updatedAt: existing.updatedAt },
        data: { status: 'CANCELLED' },
      });
      if (claim.count !== 1) {
        // Someone else already voided (or otherwise moved) it. Re-read: if it is
        // now CANCELLED this is an idempotent no-op; otherwise it changed under us.
        const current = await tx.supplierInvoice.findUnique({
          where: { id },
          select: { status: true },
        });
        if (current?.status === 'CANCELLED') return { alreadyVoided: true } as const;
        throw new ConflictException(
          'Supplier invoice was changed by another action and could not be voided',
        );
      }

      // Row-lock the payable (SELECT ... FOR UPDATE, mirroring
      // PayablesService.recordPayment's locked read) so a concurrent
      // recordPayment cannot interleave between the payments guard below and
      // the cancel/restore write: either the payment commits first and this
      // read sees its paidAmount/status (the guard rejects), or the payment
      // blocks on this lock until the void commits and its own status gate
      // then sees CANCELLED and rejects. A plain findUnique would let cash go
      // out against a voided invoice while the full approve JE is reversed
      // (AP over-relieved). Lock order is deadlock-free: void claims the
      // invoice row then the payable row; recordPayment takes only the
      // payable row.
      const payable = existing.payableId
        ? ((
            await tx.$queryRaw<
              Array<{
                id: string;
                companyId: string;
                supplierId: string | null;
                status: string;
                paidAmount: Prisma.Decimal | null;
                journalEntryId: string | null;
              }>
            >`SELECT "id", "companyId", "supplierId", "status", "paidAmount", "journalEntryId"
              FROM "payables"
              WHERE "id" = ${existing.payableId} AND "deletedAt" IS NULL
              FOR UPDATE`
          )[0] ?? null)
        : null;

      let reusedReceiptPayable = false;
      if (payable) {
        // Block a void once money has moved against the payable. A partly/fully
        // paid liability can't just be reversed away — the cash side must be
        // unwound first (void the supplier payment), otherwise Cash and AP drift.
        if (
          this.moneyToCents(payable.paidAmount ?? 0) > 0 ||
          payable.status === 'PAID' ||
          payable.status === 'PARTIALLY_PAID'
        ) {
          throw new BadRequestException(
            'This invoice’s payable already has payments applied. ' +
              'Reverse the supplier payment(s) before voiding the invoice.',
          );
        }

        // A written-off payable is settled by forgiveness: writeOff() already
        // posted DR AP / CR write-off income and deliberately left the approve
        // JE POSTED. Voiding now would mirror-reverse that approve JE — a
        // SECOND DR AP for the same liability — and clobber the WRITTEN_OFF
        // audit state to CANCELLED. (paidAmount is 0 on a written-off payable,
        // so the payments guard above cannot catch this.)
        if (payable.status === 'WRITTEN_OFF') {
          throw new BadRequestException(
            'This invoice’s payable has been written off. ' +
              'Reverse the write-off before voiding the invoice.',
          );
        }

        // The payable's backing journal entry is the origin evidence (see the
        // method doc): referenceType 'Payable' means the purchase-order receipt
        // accrual created it; referenceType 'SupplierInvoice' means this
        // invoice's own approve() did.
        const backingJournal = payable.journalEntryId
          ? await tx.journalEntry.findFirst({
              where: {
                id: payable.journalEntryId,
                companyId: existing.companyId,
                deletedAt: null,
              },
              include: { lines: true },
            })
          : null;
        reusedReceiptPayable = backingJournal?.referenceType === 'Payable';

        if (reusedReceiptPayable) {
          // (b) approve() reused the receipt-created payable. On this path
          // approve() posts NO incremental JE — postSupplierInvoicePayable is
          // gated behind `if (!payable.journalEntryId)` and the receipt path
          // already set journalEntryId — so normally there is nothing to
          // reverse in the GL and the restore is linkage-only. Reverse an
          // invoice-referenced POSTED entry defensively if one ever exists.
          const incremental = await tx.journalEntry.findFirst({
            where: {
              companyId: existing.companyId,
              referenceType: 'SupplierInvoice',
              referenceId: existing.id,
              status: 'POSTED',
              deletedAt: null,
            },
            include: { lines: true },
            orderBy: { createdAt: 'desc' },
          });
          if (incremental && incremental.lines.length > 0) {
            await this.reverseSupplierInvoiceJournal(tx, existing, incremental, dto?.reason, user.id);
          }

          // Restore the payable to its pre-invoice, receipt-created state. The
          // receipt accrual JE (still POSTED, untouched) is the authority for
          // the receipt amount.
          await this.restoreReceiptPayable(tx, existing, payable, backingJournal!);
        } else {
          // (a) The payable exists only because of this invoice: reverse the
          // approve-time journal entry line-for-line and cancel the payable.
          const original =
            backingJournal && backingJournal.referenceType === 'SupplierInvoice'
              ? backingJournal
              : await tx.journalEntry.findFirst({
                  where: {
                    companyId: existing.companyId,
                    referenceType: 'SupplierInvoice',
                    referenceId: existing.id,
                    deletedAt: null,
                  },
                  include: { lines: true },
                  orderBy: { createdAt: 'desc' },
                });
          if (original && original.lines.length > 0) {
            await this.reverseSupplierInvoiceJournal(tx, existing, original, dto?.reason, user.id);
          }

          // Cancel the payable subledger row (unless it was already cancelled,
          // e.g. by a PO cancel that ran first) and zero its outstanding.
          if (payable.status !== 'CANCELLED') {
            await tx.payable.update({
              where: { id: payable.id },
              data: { status: 'CANCELLED', outstandingAmount: 0 },
            });
          }

          // approve() unconditionally pointed the linked PO at this
          // invoice-created payable. Left in place, that stale backlink makes a
          // later receive() of a credit-purchase PO skip
          // createCreditPurchasePayable (it gates on !po.payableId), so goods
          // would arrive on supplier credit with no payable and no
          // DR Inventory / CR AP accrual. Re-point the PO at its live
          // receipt-created payable if one exists (approve() may have
          // overwritten that link), else clear it so receive() can create one.
          const linkedPo = await tx.purchaseOrder.findFirst({
            where: { payableId: payable.id, companyId: existing.companyId, deletedAt: null },
            select: { id: true },
          });
          if (linkedPo) {
            const receiptPayable = await tx.payable.findFirst({
              where: {
                companyId: existing.companyId,
                sourceType: 'PurchaseOrder',
                sourceId: linkedPo.id,
                status: { not: 'CANCELLED' },
                deletedAt: null,
              },
              select: { id: true },
            });
            await tx.purchaseOrder.update({
              where: { id: linkedPo.id },
              data: { payableId: receiptPayable?.id ?? null },
            });
          }
        }

        await this.syncSupplierBalance(tx, payable.companyId, payable.supplierId);
      }

      const updated = await tx.supplierInvoice.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          outstandingAmount: 0,
          // A reused receipt payable survives the void and belongs to the PO
          // again — detach it from the cancelled invoice so nothing reads the
          // live obligation through a dead document. An invoice-created payable
          // is CANCELLED alongside the invoice and the link stays as its trace.
          ...(reusedReceiptPayable ? { payableId: null } : {}),
        },
        include: { lines: true },
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'SUPPLIER_INVOICE_VOID',
        entityType: 'SupplierInvoice',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: existing as any,
        newValue: { invoice: updated, reason: dto?.reason ?? null } as any,
      });

      return { alreadyVoided: false, invoice: updated } as const;
    });

    if (result.alreadyVoided) {
      // Concurrent void won the race; return the current (cancelled) invoice.
      return this.findOne(id, user, AccessLevel.READ);
    }

    return result.invoice;
  }

  /**
   * Post the exact mirror-reversal of a supplier-invoice journal entry (each
   * debit becomes a credit and vice-versa), flipping the original POSTED entry
   * to REVERSED under an atomic claim FIRST so the swing posts exactly once,
   * and linking the reversal back to it. Mirrors
   * credit-notes.reverseCreditNoteJournal.
   */
  private async reverseSupplierInvoiceJournal(
    tx: Prisma.TransactionClient,
    invoice: {
      id: string;
      companyId: string;
      divisionId?: string | null;
      branchId?: string | null;
      supplierInvoiceNumber: string;
    },
    original: {
      id: string;
      lines: Array<{
        accountId: string;
        debit: Prisma.Decimal | number | null;
        credit: Prisma.Decimal | number | null;
        description: string | null;
        divisionId: string | null;
        branchId: string | null;
      }>;
    },
    reason: string | undefined,
    userId: string,
  ) {
    // Atomic claim: flip the original entry to REVERSED, guarded on it not being
    // already reversed, BEFORE posting anything. A concurrent void loses here and
    // must skip. A later failure rolls this back with the transaction.
    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: 'POSTED', deletedAt: null },
      data: {
        status: 'REVERSED',
        reversedById: userId,
        reversedAt: new Date(),
        reversalReason: reason ?? `Void of supplier invoice ${invoice.supplierInvoiceNumber}`,
      },
    });
    if (claim.count !== 1) {
      throw new ConflictException(
        'The supplier invoice journal entry was already reversed by another action',
      );
    }

    const reversedLines: PostingLine[] = original.lines.map((line) => ({
      accountId: line.accountId,
      // Swap each side: a debit becomes a credit of the same magnitude and
      // vice-versa. A zero stays zero.
      debit: this.fromCents(this.moneyToCents(line.credit ?? 0)),
      credit: this.fromCents(this.moneyToCents(line.debit ?? 0)),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    const reversal = await this.postingEngine.postLines(
      {
        companyId: invoice.companyId,
        divisionId: invoice.divisionId,
        branchId: invoice.branchId,
        transactionDate: new Date(),
        description: `Void of supplier invoice ${invoice.supplierInvoiceNumber}`,
        referenceType: 'SupplierInvoice',
        referenceId: invoice.id,
        moduleName: 'supplier_invoices',
        userId,
        lines: reversedLines,
      },
      tx,
    );

    // Link the reversal to the original (already flipped to REVERSED) so
    // reconciliation can pair them.
    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: original.id },
    });

    return reversal;
  }

  /**
   * Restore a receipt-created payable to its pre-invoice state after the
   * supplier invoice that reused it is voided. The receipt obligation itself
   * stands — goods were received on supplier credit and its accrual JE
   * (DR Inventory / CR AP, referenceType 'Payable') remains POSTED — so this
   * only rewinds what approve() overwrote on the subledger row: amount and
   * outstanding back to the receipt-created amount (read from the receipt JE's
   * own AP_CONTROL credit, so an approve that re-stated the amount to the
   * invoice total is exactly undone), and the source link back to the purchase
   * order that created it.
   */
  private async restoreReceiptPayable(
    tx: Prisma.TransactionClient,
    invoice: { companyId: string; purchaseOrderId?: string | null },
    payable: { id: string; paidAmount: Prisma.Decimal | number | null },
    receiptJournal: {
      transactionDate: Date;
      lines: Array<{ accountId: string; credit: Prisma.Decimal | number | null }>;
    },
  ) {
    // The PO that received on credit still points at this payable — approve()
    // writes PurchaseOrder.payableId for PO-linked invoices, and the receipt
    // path set it first, so looking the PO up BY payableId is authoritative
    // even if the invoice was (wrongly) linked to a different PO.
    const receiptPo = await tx.purchaseOrder.findFirst({
      where: { payableId: payable.id, companyId: invoice.companyId, deletedAt: null },
      select: {
        id: true,
        purchaseOrderNumber: true,
        divisionId: true,
        branchId: true,
        expectedDate: true,
        totalAmount: true,
      },
    });

    // Receipt-created amount: the AP_CONTROL credit on the receipt accrual JE
    // (createCreditPurchasePayable posts exactly amount = PO total there).
    const apAccount = await this.accountResolver.resolve(invoice.companyId, 'AP_CONTROL', tx);
    let receiptCents = 0;
    for (const line of receiptJournal.lines) {
      if (line.accountId === apAccount.id) {
        receiptCents += this.moneyToCents(line.credit ?? 0);
      }
    }
    if (receiptCents <= 0) {
      receiptCents = this.moneyToCents(receiptPo?.totalAmount ?? 0);
    }
    if (receiptCents <= 0) {
      throw new ConflictException(
        'Cannot determine the receipt-created payable amount to restore; void aborted',
      );
    }

    const receiptAmount = new Prisma.Decimal(this.fromCents(receiptCents)).toDecimalPlaces(2);
    await tx.payable.update({
      where: { id: payable.id },
      data: {
        amount: receiptAmount,
        // paidAmount is guaranteed 0 by the void guard, but derive outstanding
        // from it anyway so the arithmetic can never resurrect paid money.
        outstandingAmount: receiptAmount.minus(payable.paidAmount ?? 0).toDecimalPlaces(2),
        sourceType: 'PurchaseOrder',
        sourceId: receiptPo?.id ?? invoice.purchaseOrderId ?? null,
        issueDate: receiptJournal.transactionDate,
        dueDate: receiptPo?.expectedDate ?? null,
        ...(receiptPo
          ? {
              divisionId: receiptPo.divisionId,
              branchId: receiptPo.branchId,
              notes: `Auto-created from credit purchase ${receiptPo.purchaseOrderNumber}`,
            }
          : {}),
      },
    });
  }

  private buildInvoiceLines(lines: SupplierInvoiceLineDto[], submittedTotal?: number) {
    if (!lines?.length) throw new BadRequestException('Supplier invoice must have line items');

    let subtotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);
    let discountAmount = new Prisma.Decimal(0);

    const data = lines.map((line, index) => {
      const description = line.description.trim();
      if (!description) throw new BadRequestException(`Line ${index + 1}: description is required`);

      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const tax = new Prisma.Decimal(line.taxAmount ?? 0);
      const discount = new Prisma.Decimal(line.discountAmount ?? 0);
      const gross = quantity.mul(unitPrice);
      const lineTotal = gross.minus(discount).plus(tax);

      if (quantity.lte(0)) {
        throw new BadRequestException(`Line ${index + 1}: quantity must be greater than zero`);
      }
      if (unitPrice.lt(0) || tax.lt(0) || discount.lt(0)) {
        throw new BadRequestException(`Line ${index + 1}: amounts cannot be negative`);
      }
      if (
        line.lineTotal !== undefined &&
        !this.withinTolerance(lineTotal, new Prisma.Decimal(line.lineTotal), MONEY_TOLERANCE)
      ) {
        throw new BadRequestException(
          `Line ${index + 1}: line total does not match quantity/price`,
        );
      }

      subtotal = subtotal.plus(gross);
      taxAmount = taxAmount.plus(tax);
      discountAmount = discountAmount.plus(discount);

      return {
        productId: line.productId || undefined,
        description,
        quantity,
        unitId: line.unitId || undefined,
        unitPrice,
        taxAmount: tax,
        discountAmount: discount,
        lineTotal,
      };
    });

    const totalAmount = subtotal.minus(discountAmount).plus(taxAmount);
    if (
      submittedTotal !== undefined &&
      !this.withinTolerance(totalAmount, new Prisma.Decimal(submittedTotal), MONEY_TOLERANCE)
    ) {
      throw new BadRequestException('Invoice total does not match the line item totals');
    }

    return { lines: data, subtotal, taxAmount, discountAmount, totalAmount };
  }

  private async postSupplierInvoicePayable(
    invoice: any,
    payable: { id: string; amount: Prisma.Decimal },
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const payableCents = this.moneyToCents(payable.amount);
    if (payableCents <= 0) {
      throw new BadRequestException('Supplier invoice total must be greater than zero to post');
    }

    const productIds = Array.from(
      new Set((invoice.lines ?? []).map((line: any) => line.productId).filter(Boolean)),
    ) as string[];
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds }, companyId: invoice.companyId, deletedAt: null },
          select: { id: true, trackInventory: true },
        })
      : [];
    const stockProductIds = new Set(
      products.filter((product) => product.trackInventory).map((product) => product.id),
    );

    let inventoryCents = 0;
    let expenseCents = 0;
    for (const line of invoice.lines ?? []) {
      const cents = this.moneyToCents(line.lineTotal);
      if (line.productId && stockProductIds.has(line.productId)) {
        inventoryCents += cents;
      } else {
        expenseCents += cents;
      }
    }

    const roundingDelta = payableCents - inventoryCents - expenseCents;
    if (roundingDelta !== 0) {
      if (inventoryCents > 0) {
        inventoryCents += roundingDelta;
      } else {
        expenseCents += roundingDelta;
      }
    }
    if (inventoryCents < 0 || expenseCents < 0) {
      throw new BadRequestException(
        'Supplier invoice line totals cannot be reconciled to payable amount',
      );
    }

    // GL-vs-subledger reconciliation guard (audit finding): an INVENTORY_ASSET
    // debit here is the GL counterpart of a perpetual-inventory increase that is
    // ONLY ever booked by the goods-receipt path (GoodsReceivedNotesService.post
    // flips the GRN to POSTED and calls InventoryMovements.createMovement; and
    // PurchaseOrdersService.receive moves the subledger on RECEIVED /
    // PARTIALLY_RECEIVED). This module never moves the inventory subledger. So if
    // we would debit INVENTORY_ASSET for stock lines with no posted receipt
    // behind them, the GL inventory asset would overstate the subledger with no
    // offsetting movement and the two could never reconcile. Require a matching
    // posted receipt before allowing the inventory debit.
    if (inventoryCents > 0) {
      await this.assertStockLinesAreReceipted(invoice, tx);
    }

    const [inventoryAccount, expenseAccount, apAccount] = await Promise.all([
      this.accountResolver.resolve(invoice.companyId, 'INVENTORY_ASSET', tx),
      this.accountResolver.resolve(invoice.companyId, 'GENERAL_EXPENSE', tx),
      this.accountResolver.resolve(invoice.companyId, 'AP_CONTROL', tx),
    ]);

    const lines: PostingLine[] = [];
    if (inventoryCents > 0) {
      lines.push({
        accountId: inventoryAccount.id,
        debit: this.fromCents(inventoryCents),
        credit: 0,
        description: `Inventory from supplier invoice ${invoice.supplierInvoiceNumber}`,
      });
    }
    if (expenseCents > 0) {
      lines.push({
        accountId: expenseAccount.id,
        debit: this.fromCents(expenseCents),
        credit: 0,
        description: `Supplier invoice expense ${invoice.supplierInvoiceNumber}`,
      });
    }
    lines.push({
      accountId: apAccount.id,
      debit: 0,
      credit: this.fromCents(payableCents),
      description: `Accounts payable for supplier invoice ${invoice.supplierInvoiceNumber}`,
    });

    return this.postingEngine.postLines(
      {
        companyId: invoice.companyId,
        divisionId: invoice.divisionId,
        branchId: invoice.branchId,
        transactionDate: invoice.invoiceDate,
        description: `Supplier invoice ${invoice.supplierInvoiceNumber}`,
        referenceType: 'SupplierInvoice',
        referenceId: invoice.id,
        moduleName: 'supplier_invoices',
        userId,
        lines,
      },
      tx,
    );
  }

  /**
   * Assert that the goods behind this invoice's stock (INVENTORY_ASSET) lines
   * have actually been received into the perpetual-inventory subledger before we
   * post the offsetting GL inventory debit. A receipt exists when:
   *   - the invoice is linked to a GRN that has been POSTED (GRN.post ran the
   *     inventory movement), OR
   *   - the invoice's PO carries at least one POSTED GRN, OR
   *   - the invoice's PO is itself RECEIVED / PARTIALLY_RECEIVED (the
   *     PurchaseOrdersService.receive path moved the subledger directly).
   * Otherwise the inventory subledger was never moved and debiting
   * INVENTORY_ASSET would leave the GL permanently overstating the subledger.
   */
  private async assertStockLinesAreReceipted(
    invoice: {
      companyId: string;
      goodsReceivedNoteId?: string | null;
      purchaseOrderId?: string | null;
    },
    tx: Prisma.TransactionClient,
  ) {
    if (invoice.goodsReceivedNoteId) {
      const grn = await tx.goodsReceivedNote.findFirst({
        where: {
          id: invoice.goodsReceivedNoteId,
          companyId: invoice.companyId,
          status: 'POSTED' as any,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (grn) return;
    }

    if (invoice.purchaseOrderId) {
      const [postedGrn, receivedPo] = await Promise.all([
        tx.goodsReceivedNote.findFirst({
          where: {
            purchaseOrderId: invoice.purchaseOrderId,
            companyId: invoice.companyId,
            status: 'POSTED' as any,
            deletedAt: null,
          },
          select: { id: true },
        }),
        tx.purchaseOrder.findFirst({
          where: {
            id: invoice.purchaseOrderId,
            companyId: invoice.companyId,
            status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] as any },
            deletedAt: null,
          },
          select: { id: true },
        }),
      ]);
      if (postedGrn || receivedPo) return;
    }

    throw new BadRequestException(
      'Supplier invoice has stock (inventory) lines but no posted goods receipt. ' +
        'Post the goods-received note (or receive the purchase order) so the inventory ' +
        'subledger is moved before approving this invoice.',
    );
  }

  private moneyToCents(value: Prisma.Decimal | number | string): number {
    return Math.round(Number(value) * 100);
  }

  private fromCents(cents: number): number {
    return cents / 100;
  }

  private async assertInvoiceNumberAvailable(input: {
    companyId: string;
    supplierId: string;
    invoiceNumber: string;
    excludeInvoiceId?: string;
    purchaseOrderId?: string;
  }) {
    const existing = await this.prisma.supplierInvoice.findFirst({
      where: {
        companyId: input.companyId,
        supplierId: input.supplierId,
        supplierInvoiceNumber: {
          equals: input.invoiceNumber.trim(),
          mode: 'insensitive',
        },
        ...(input.excludeInvoiceId ? { id: { not: input.excludeInvoiceId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Supplier invoice number already exists for this supplier');
    }

    const purchaseOrder = input.purchaseOrderId
      ? await this.prisma.purchaseOrder.findFirst({
          where: {
            id: input.purchaseOrderId,
            companyId: input.companyId,
            deletedAt: null,
          },
          select: { supplierInvoiceNumber: true },
        })
      : null;
    if (
      purchaseOrder?.supplierInvoiceNumber &&
      purchaseOrder.supplierInvoiceNumber.localeCompare(input.invoiceNumber.trim(), undefined, {
        sensitivity: 'accent',
      }) !== 0
    ) {
      throw new ConflictException(
        `Purchase order already carries supplier invoice ${purchaseOrder.supplierInvoiceNumber}`,
      );
    }

    const duplicatePurchase = await this.prisma.purchaseOrder.findFirst({
      where: {
        companyId: input.companyId,
        supplierId: input.supplierId,
        deletedAt: null,
        supplierInvoiceNumber: {
          equals: input.invoiceNumber.trim(),
          mode: 'insensitive',
        },
        ...(input.purchaseOrderId ? { id: { not: input.purchaseOrderId } } : {}),
      },
      select: { purchaseOrderNumber: true },
    });
    if (duplicatePurchase) {
      throw new ConflictException(
        `Supplier invoice number is already recorded on ${duplicatePurchase.purchaseOrderNumber}`,
      );
    }
  }

  private async assertProcurementReferences(refs: {
    companyId: string;
    supplierId: string;
    divisionId?: string | null;
    branchId?: string | null;
    purchaseOrderId?: string;
    goodsReceivedNoteId?: string;
    currency?: string;
  }) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: refs.supplierId, companyId: refs.companyId, deletedAt: null },
      select: { id: true, divisionId: true, branchId: true },
    });
    if (!supplier) throw new BadRequestException('Supplier does not belong to this company');
    if (refs.divisionId && supplier.divisionId && refs.divisionId !== supplier.divisionId) {
      throw new BadRequestException('Supplier does not belong to the selected division');
    }
    if (refs.branchId && supplier.branchId && refs.branchId !== supplier.branchId) {
      throw new BadRequestException('Supplier does not belong to the selected branch/location');
    }

    let purchaseOrderId = refs.purchaseOrderId || undefined;
    let divisionId = refs.divisionId || supplier.divisionId || null;
    let branchId = refs.branchId || supplier.branchId || null;

    if (refs.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: refs.purchaseOrderId, companyId: refs.companyId, deletedAt: null },
        select: {
          id: true,
          supplierId: true,
          divisionId: true,
          branchId: true,
          currency: true,
          purchaseType: true,
        },
      });
      if (!po) throw new BadRequestException('Purchase order does not belong to this company');
      if (po.supplierId && po.supplierId !== refs.supplierId) {
        throw new BadRequestException('Purchase order supplier does not match invoice supplier');
      }
      // A cash purchase settles in full at receipt (DR Inventory / CR Cash) and has
      // no accounts-payable leg. Linking a supplier invoice to it would make the
      // invoice approve flow post a second inventory debit + a phantom AP credit,
      // double-counting the goods. Cash purchases never flow through AP.
      if (po.purchaseType === 'CASH_PURCHASE') {
        throw new BadRequestException(
          'Cannot link a supplier invoice to a cash-purchase order; it settles at receipt and carries no accounts payable',
        );
      }
      // Currency lock: the invoice must be denominated in the same currency as its
      // linked purchase order, otherwise the matched amounts are not comparable.
      // (GRNs carry no currency of their own, so the PO is the currency authority.)
      if (refs.currency && po.currency && refs.currency !== po.currency) {
        throw new BadRequestException(
          'Supplier invoice currency must match the purchase order currency',
        );
      }
      if (supplier.divisionId && po.divisionId && supplier.divisionId !== po.divisionId) {
        throw new BadRequestException('Purchase order is outside the supplier division');
      }
      if (supplier.branchId && po.branchId && supplier.branchId !== po.branchId) {
        throw new BadRequestException('Purchase order is outside the supplier branch/location');
      }
      if (refs.divisionId && po.divisionId && refs.divisionId !== po.divisionId) {
        throw new BadRequestException('Purchase order does not belong to the selected division');
      }
      if (refs.branchId && po.branchId && refs.branchId !== po.branchId) {
        throw new BadRequestException(
          'Purchase order does not belong to the selected branch/location',
        );
      }
      divisionId = po.divisionId || divisionId;
      branchId = po.branchId || branchId;
    }

    if (refs.goodsReceivedNoteId) {
      const grn = await this.prisma.goodsReceivedNote.findFirst({
        where: { id: refs.goodsReceivedNoteId, companyId: refs.companyId, deletedAt: null },
        select: {
          id: true,
          supplierId: true,
          purchaseOrderId: true,
          divisionId: true,
          branchId: true,
        },
      });
      if (!grn) throw new BadRequestException('GRN does not belong to this company');
      if (grn.supplierId !== refs.supplierId) {
        throw new BadRequestException('GRN supplier does not match invoice supplier');
      }
      if (supplier.divisionId && grn.divisionId && supplier.divisionId !== grn.divisionId) {
        throw new BadRequestException('GRN is outside the supplier division');
      }
      if (supplier.branchId && grn.branchId && supplier.branchId !== grn.branchId) {
        throw new BadRequestException('GRN is outside the supplier branch/location');
      }
      if (purchaseOrderId && grn.purchaseOrderId && grn.purchaseOrderId !== purchaseOrderId) {
        throw new BadRequestException('GRN is not linked to the selected purchase order');
      }
      if (refs.divisionId && grn.divisionId && refs.divisionId !== grn.divisionId) {
        throw new BadRequestException('GRN does not belong to the selected division');
      }
      if (refs.branchId && grn.branchId && refs.branchId !== grn.branchId) {
        throw new BadRequestException('GRN does not belong to the selected branch/location');
      }
      purchaseOrderId = purchaseOrderId || grn.purchaseOrderId || undefined;
      divisionId = grn.divisionId || divisionId;
      branchId = grn.branchId || branchId;
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== refs.companyId) {
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
      if (!division || division.companyId !== refs.companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    return { purchaseOrderId, divisionId, branchId };
  }

  private async createThreeWayMatch(
    invoice: any,
    userId: string,
    tx?: Prisma.TransactionClient,
    options?: { claimStandalone?: boolean },
  ) {
    if (!invoice.purchaseOrderId) {
      throw new BadRequestException('Purchase order is required for three-way matching');
    }
    const db = tx ?? this.prisma;

    const purchaseOrder = await db.purchaseOrder.findFirst({
      where: { id: invoice.purchaseOrderId, companyId: invoice.companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!purchaseOrder) throw new BadRequestException('Purchase order not found for invoice');
    if (purchaseOrder.supplierId && purchaseOrder.supplierId !== invoice.supplierId) {
      throw new BadRequestException('Purchase order supplier does not match invoice supplier');
    }

    const grn = invoice.goodsReceivedNoteId
      ? await db.goodsReceivedNote.findFirst({
          where: {
            id: invoice.goodsReceivedNoteId,
            companyId: invoice.companyId,
            supplierId: invoice.supplierId,
            deletedAt: null,
          },
          include: { lines: true },
        })
      : null;
    if (invoice.goodsReceivedNoteId && !grn) {
      throw new BadRequestException('GRN not found for invoice');
    }

    // Route both variance computations through the shared three-way-match
    // calculator so the SI approval flow and the standalone three-way-matching
    // register derive variances identically and can never drift. The calculator
    // aggregates ALL split PO lines per product (quantity-weighted average unit
    // cost) — the previous ad-hoc logic kept only the LAST PO line per product,
    // mis-valuing any product split across multiple PO lines — and compares the
    // full invoice total against the matched expected amount on the same basis
    // the standalone register uses.
    const { quantityVariance, amountVariance, matchStatus } = computeThreeWayMatch({
      invoice: { lines: invoice.lines ?? [], totalAmount: invoice.totalAmount },
      purchaseOrderLines: purchaseOrder.lines,
      grnLines: grn?.lines ?? null,
    });

    const nextInvoiceStatus = matchStatus === 'MATCHED' ? 'MATCHED' : 'DISPUTED';
    if (options?.claimStandalone) {
      // Serialize standalone runs on the invoice row. Once a caller changes the
      // pre-match status, concurrent/replayed calls cannot create another match.
      const claim = await db.supplierInvoice.updateMany({
        where: {
          id: invoice.id,
          companyId: invoice.companyId,
          deletedAt: null,
          status: { in: ['DRAFT', 'RECEIVED'] },
          updatedAt: invoice.updatedAt,
        },
        data: { status: nextInvoiceStatus },
      });
      if (claim.count !== 1) {
        const [current, activeMatch] = await Promise.all([
          db.supplierInvoice.findUnique({
            where: { id: invoice.id },
            select: { status: true },
          }),
          db.threeWayMatch.findFirst({
            where: { supplierInvoiceId: invoice.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        if (current && ['MATCHED', 'DISPUTED'].includes(current.status as string) && activeMatch) {
          return { match: activeMatch, created: false };
        }
        throw new ConflictException(
          'Supplier invoice match state changed or has no active match; refresh before retrying',
        );
      }

      // A DRAFT/RECEIVED invoice should not retain an active match, but retire
      // any stale row defensively before creating the sole current result.
      await db.threeWayMatch.updateMany({
        where: { supplierInvoiceId: invoice.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    const match = await db.threeWayMatch.create({
      data: {
        matchNumber: await this.codes.next({
          entityType: 'ThreeWayMatch',
          companyId: invoice.companyId,
          ...(tx ? { tx } : {}),
        }),
        companyId: invoice.companyId,
        purchaseOrderId: invoice.purchaseOrderId,
        goodsReceivedNoteId: invoice.goodsReceivedNoteId,
        supplierInvoiceId: invoice.id,
        matchStatus,
        quantityVariance,
        amountVariance,
        notes:
          matchStatus === 'MATCHED'
            ? 'PO, GRN, and supplier invoice matched'
            : 'Variance detected between PO/GRN and supplier invoice',
        matchedById: userId,
      },
    });

    if (!options?.claimStandalone) {
      await db.supplierInvoice.update({
        where: { id: invoice.id },
        data: { status: nextInvoiceStatus },
      });
    }

    return options?.claimStandalone ? { match, created: true } : match;
  }

  private withinTolerance(
    actual: Prisma.Decimal,
    expected: Prisma.Decimal,
    tolerance: Prisma.Decimal,
  ) {
    return actual.minus(expected).abs().lte(tolerance);
  }

  private async decorateInvoices(items: any[]) {
    if (!items.length) return items;

    const supplierIds = Array.from(new Set(items.map((item) => item.supplierId).filter(Boolean)));
    const purchaseOrderIds = Array.from(
      new Set(items.map((item) => item.purchaseOrderId).filter(Boolean)),
    );
    const payableIds = Array.from(new Set(items.map((item) => item.payableId).filter(Boolean)));
    const invoiceIds = items.map((item) => item.id);

    const [suppliers, purchaseOrders, payables, matches] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, name: true, supplierCode: true },
          })
        : [],
      purchaseOrderIds.length
        ? this.prisma.purchaseOrder.findMany({
            where: { id: { in: purchaseOrderIds } },
            select: { id: true, purchaseOrderNumber: true, totalAmount: true, status: true },
          })
        : [],
      payableIds.length
        ? this.prisma.payable.findMany({
            where: { id: { in: payableIds } },
            select: {
              id: true,
              payableNumber: true,
              status: true,
              paidAmount: true,
              outstandingAmount: true,
            },
          })
        : [],
      this.prisma.threeWayMatch.findMany({
        where: { supplierInvoiceId: { in: invoiceIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.id, po]));
    const payablesById = new Map(payables.map((payable) => [payable.id, payable]));
    const matchesByInvoiceId = new Map<string, any>();
    for (const match of matches) {
      if (match.supplierInvoiceId && !matchesByInvoiceId.has(match.supplierInvoiceId)) {
        matchesByInvoiceId.set(match.supplierInvoiceId, match);
      }
    }

    return items.map((item) => ({
      ...item,
      supplier: suppliersById.get(item.supplierId) ?? null,
      purchaseOrder: item.purchaseOrderId
        ? (purchaseOrdersById.get(item.purchaseOrderId) ?? null)
        : null,
      payable: item.payableId ? (payablesById.get(item.payableId) ?? null) : null,
      latestMatch: matchesByInvoiceId.get(item.id) ?? null,
    }));
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
