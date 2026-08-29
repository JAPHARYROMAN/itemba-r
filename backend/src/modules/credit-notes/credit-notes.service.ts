import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, AccountRole, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { ProfitService } from '../profit/profit.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { pagination } from '../../common/utils/pagination';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { QueryCreditNoteDto } from './dto/query-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';
import { CreditNoteStatus } from './credit-note-status.enum';
import { creditNoteDb, CreditNoteRow } from './credit-note.types';

const ZERO = new Prisma.Decimal(0);

/**
 * Credit notes = customer-facing reversals of a prior sale (returns, allowances,
 * billing corrections). Issuing one posts a BALANCED reversing journal entry
 * that unwinds the revenue + output VAT + AR of the original invoice:
 *
 *   Dr  Sales Returns & Allowances (SALES_REVENUE)   net
 *   Dr  VAT Output Payable (TAX_VAT_PAYABLE)          tax     (reverses output VAT)
 *   Cr  Accounts Receivable (AR_CONTROL)              gross
 *
 * Voiding an ISSUED credit note posts the exact reverse of that entry.
 *
 * The AR credit is mirrored in the receivable subledger + customer balance:
 * issue() relieves the linked receivable whether it is linked DIRECTLY
 * (receivableId) or only via the sales order (salesOrderId → the SO's
 * receivable), so the GL AR control never drifts from the AR subledger.
 *
 * PHYSICAL RETURNS (opt-in per line): a credit-note line MAY carry a
 * `returnedQuantity` > 0 to mark goods physically coming back into stock. For
 * those lines issue() ALSO, in the SAME transaction as the AR/revenue/VAT
 * reversal:
 *   (a) creates an inbound SALES_RETURN inventory movement (restocks the
 *       subledger — quantityOnHand / totalValue), and
 *   (b) posts the reversing  Dr Inventory (INVENTORY_ASSET) / Cr COGS
 *       (COST_OF_GOODS_SOLD)  for the returned cost,
 * mirroring the SALES_RETURN + COGS/Inventory reversal in sales-orders.cancel.
 * void() unwinds both legs. A line with no `returnedQuantity` (a pure price
 * adjustment / allowance) is financial-only and never restocks — so
 * financial-only credit notes are unchanged.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly profit: ProfitService,
  ) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  async findAll(query: QueryCreditNoteDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      customerId,
      salesOrderId,
      receivableId,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Record<string, unknown> = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (salesOrderId) where.salesOrderId = salesOrderId;
    if (receivableId) where.receivableId = receivableId;
    if (dateFrom || dateTo) {
      const issueDate: Record<string, Date> = {};
      if (dateFrom) issueDate.gte = dateRangeStart(dateFrom);
      if (dateTo) issueDate.lte = dateRangeEnd(dateTo);
      where.issueDate = issueDate;
    }

    const db = creditNoteDb(this.prisma);
    const [items, total] = await Promise.all([
      db.creditNote.findMany({
        where,
        include: this.includeListScope(),
        orderBy: { issueDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      db.creditNote.count({ where }),
    ]);

    return {
      items,
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await creditNoteDb(this.prisma).creditNote.findFirst({
      where: { id, deletedAt: null },
      include: this.includeDetailScope(),
    });
    if (!record) throw new NotFoundException('Credit note not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  // ─── Create (DRAFT) ──────────────────────────────────────────────────────────

  async create(dto: CreateCreditNoteDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('A credit note requires at least one line');
    }

    // Validate customer belongs to company (and capture display name / scope).
    let customerName = dto.customerName ?? '';
    let divisionId = dto.divisionId || null;
    let branchId = dto.branchId || null;
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true, name: true },
      });
      if (!customer || customer.companyId !== dto.companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
      customerName = customerName || customer.name;
      if (!divisionId && customer.divisionId) divisionId = customer.divisionId;
      if (!branchId && customer.branchId) branchId = customer.branchId;
    }
    if (!customerName) {
      throw new BadRequestException('customerName is required when no customer is linked');
    }

    // Validate the optional sales-order link belongs to the same company.
    if (dto.salesOrderId) {
      const so = await this.prisma.salesOrder.findFirst({
        where: { id: dto.salesOrderId, deletedAt: null },
        select: { companyId: true, customerId: true },
      });
      if (!so || so.companyId !== dto.companyId) {
        throw new BadRequestException('Sales order does not belong to this company');
      }
    }

    // Validate the optional receivable link belongs to the same company.
    if (dto.receivableId) {
      const receivable = await this.prisma.receivable.findFirst({
        where: { id: dto.receivableId, deletedAt: null },
        select: { companyId: true },
      });
      if (!receivable || receivable.companyId !== dto.companyId) {
        throw new BadRequestException('Receivable does not belong to this company');
      }
    }

    // Compute per-line + document totals with Decimal (never float).
    const computedLines = dto.lines.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity ?? 0);
      const unitPrice = new Prisma.Decimal(line.unitPrice ?? 0).toDecimalPlaces(2);
      const net = quantity.mul(unitPrice).toDecimalPlaces(2);
      const tax = new Prisma.Decimal(line.taxAmount ?? 0).toDecimalPlaces(2);
      if (net.lt(0) || tax.lt(0)) {
        throw new BadRequestException('Credit note line amounts cannot be negative');
      }
      const lineTotal = net.plus(tax).toDecimalPlaces(2);

      // Physical-return restock (opt-in). A returnedQuantity > 0 flags goods
      // physically coming back into stock; issue() restocks + reverses COGS for
      // it. Guard it here so a bad restock request never persists onto a DRAFT.
      const returnedRaw = new Prisma.Decimal(line.returnedQuantity ?? 0).toDecimalPlaces(4);
      let returnedQuantity: Prisma.Decimal | null = null;
      let restockUnitCost: Prisma.Decimal | null = null;
      if (returnedRaw.gt(0)) {
        if (!line.productId) {
          throw new BadRequestException(
            'returnedQuantity requires a productId — only stock lines can be restocked',
          );
        }
        if (returnedRaw.gt(quantity)) {
          throw new BadRequestException(
            'returnedQuantity cannot exceed the credited quantity on the line',
          );
        }
        returnedQuantity = returnedRaw;
        if (line.restockUnitCost != null) {
          const cost = new Prisma.Decimal(line.restockUnitCost).toDecimalPlaces(4);
          if (cost.lte(0)) {
            throw new BadRequestException('restockUnitCost must be greater than zero');
          }
          restockUnitCost = cost;
        }
      }

      return {
        productId: line.productId || null,
        unitId: line.unitId || null,
        description: line.description,
        quantity,
        unitPrice,
        netAmount: net,
        taxAmount: tax,
        lineTotal,
        returnedQuantity,
        restockUnitCost,
      };
    });

    const subtotal = computedLines
      .reduce((sum, l) => sum.plus(l.netAmount), ZERO)
      .toDecimalPlaces(2);
    const taxAmount = computedLines
      .reduce((sum, l) => sum.plus(l.taxAmount), ZERO)
      .toDecimalPlaces(2);
    const totalAmount = subtotal.plus(taxAmount).toDecimalPlaces(2);
    if (totalAmount.lte(0)) {
      throw new BadRequestException('Credit note total must be greater than zero');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const db = creditNoteDb(tx);
      const created: CreditNoteRow = await db.creditNote.create({
        data: {
          creditNoteNumber: await this.codes.next({
            entityType: 'CreditNote',
            companyId: dto.companyId,
            tx,
          }),
          companyId: dto.companyId,
          divisionId,
          branchId,
          customerId: dto.customerId || null,
          customerName,
          salesOrderId: dto.salesOrderId || null,
          receivableId: dto.receivableId || null,
          reason: dto.reason || null,
          subtotal,
          taxAmount,
          totalAmount,
          appliedAmount: ZERO,
          currency: dto.currency ?? 'TZS',
          issueDate: new Date(dto.issueDate),
          status: CreditNoteStatus.DRAFT,
          notes: dto.notes || null,
          createdById: userId,
        },
      });

      await db.creditNoteLine.createMany({
        data: computedLines.map((l) => ({
          creditNoteId: created.id,
          companyId: dto.companyId,
          productId: l.productId,
          unitId: l.unitId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          netAmount: l.netAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          returnedQuantity: l.returnedQuantity,
          restockUnitCost: l.restockUnitCost,
        })),
      });

      return created;
    });

    await this.auditLogs.log({
      action: 'CREDIT_NOTE_CREATE',
      entityType: 'CreditNote',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return this.findOne(record.id);
  }

  // ─── Issue (DRAFT -> ISSUED, post reversing JE) ───────────────────────────────

  async issue(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;

    if (existing.status !== CreditNoteStatus.DRAFT) {
      throw new ConflictException(
        `Only DRAFT credit notes can be issued (current status: ${existing.status})`,
      );
    }

    const subtotal = new Prisma.Decimal(existing.subtotal).toDecimalPlaces(2); // net
    const taxAmount = new Prisma.Decimal(existing.taxAmount).toDecimalPlaces(2);
    const totalAmount = new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2); // gross
    if (totalAmount.lte(0)) {
      throw new BadRequestException('Credit note total must be greater than zero to issue');
    }

    // [GL/subledger fix — HIGH salesOrderId-only relief] Determine which
    // receivable this credit note relieves. A note may link the debt EITHER
    // directly (receivableId) OR only via its sales order (salesOrderId). In the
    // latter case we must still resolve and relieve the underlying receivable —
    // otherwise issue() credits AR_CONTROL in the GL for the full total while the
    // receivable subledger + customer balance stay inflated (silent AR-vs-GL
    // divergence). We resolve the SO's receivable the SAME way sales-orders does
    // (SalesOrder.receivableId first, then Receivable.sourceType='SalesOrder').
    const effectiveReceivableId = await this.resolveLinkedReceivableId(
      this.prisma,
      existing.receivableId,
      existing.salesOrderId,
      existing.companyId,
    );

    // [GL guard — HIGH double-reversal] Refuse to credit a receivable that another
    // flow (write-off / cancellation) has already reversed. Crediting a
    // CANCELLED/WRITTEN_OFF receivable would double-relieve AR and re-inflate the
    // customer's credit position against a debt that no longer carries value.
    if (effectiveReceivableId) {
      const linked = await this.prisma.receivable.findFirst({
        where: { id: effectiveReceivableId, companyId: existing.companyId, deletedAt: null },
        select: { status: true },
      });
      if (linked && (linked.status === 'CANCELLED' || linked.status === 'WRITTEN_OFF')) {
        throw new ConflictException(
          `Cannot issue a credit note against a ${linked.status} receivable`,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const db = creditNoteDb(tx);

      // Atomic claim: DRAFT -> ISSUED, guarded on the row still being DRAFT.
      // Two concurrent issues race here; the loser sees count 0 and aborts, so
      // the reversing JE is posted exactly once.
      const claim = await db.creditNote.updateMany({
        where: { id, status: CreditNoteStatus.DRAFT, deletedAt: null },
        data: { status: CreditNoteStatus.ISSUED },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Credit note is no longer in DRAFT state');
      }

      // Resolve GL accounts the SAME way peers do (semantic roles, not codes).
      const roles: AccountRole[] = ['AR_CONTROL', 'SALES_REVENUE'];
      if (taxAmount.gt(0)) roles.push('TAX_VAT_PAYABLE');
      const accounts = await this.accountResolver.resolveMany(existing.companyId, roles, tx);

      // Reversing entry (mirror of the original sales invoice posting):
      //   Dr Sales Returns & Allowances (net) — contra-revenue against SALES_REVENUE
      //   Dr VAT Output Payable (tax)          — reverses output VAT liability
      //   Cr Accounts Receivable (gross)       — reduces amount owed by customer
      const lines = [
        ...(subtotal.gt(0)
          ? [
              {
                accountId: accounts.SALES_REVENUE.id,
                description: 'Sales returns & allowances',
                debit: subtotal,
                credit: ZERO,
              },
            ]
          : []),
        ...(taxAmount.gt(0)
          ? [
              {
                accountId: accounts.TAX_VAT_PAYABLE.id,
                description: 'Output VAT reversal',
                debit: taxAmount,
                credit: ZERO,
              },
            ]
          : []),
        {
          accountId: accounts.AR_CONTROL.id,
          description: `Accounts receivable credit: ${existing.customerName}`,
          debit: ZERO,
          credit: totalAmount,
        },
      ];

      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: existing.companyId,
          divisionId: existing.divisionId,
          branchId: existing.branchId,
          transactionDate: existing.issueDate,
          description: `Credit note ${existing.creditNoteNumber}`,
          referenceType: 'CreditNote',
          referenceId: existing.id,
          moduleName: 'credit-notes',
          userId,
          lines,
        },
        tx,
      );

      // Physical-return restock (opt-in per line). For every line that carries a
      // returnedQuantity > 0, put the goods back into the inventory subledger and
      // reverse their COGS in the SAME transaction as the financial reversal
      // above — mirroring sales-orders.cancel (SALES_RETURN movement + Dr
      // Inventory / Cr COGS). Lines with no returnedQuantity (price adjustments /
      // allowances) are financial-only and untouched here. The DRAFT->ISSUED claim
      // guards this whole block, so the restock + its JE post exactly once.
      await this.restockReturnedLines(tx, existing, userId);

      // If a receivable is linked (directly, or resolved from the sales order),
      // atomically reduce its outstanding — but never drive it negative. Any
      // excess credit is left un-applied on the credit note (appliedAmount <
      // totalAmount) and remains available as a customer credit for a future
      // invoice/refund.
      let appliedAmount = ZERO;
      if (effectiveReceivableId) {
        appliedAmount = await this.applyToReceivable(
          tx,
          effectiveReceivableId,
          existing.companyId,
          totalAmount,
          user,
        );
      }

      // Persist the resolved receivableId back onto the credit note when it was
      // only linked via the sales order. This keeps the subledger consistent with
      // the GL (the receivable we relieved is now recorded) and lets void()
      // restore the exact receivable via existing.receivableId on reversal.
      const updated: CreditNoteRow = await db.creditNote.update({
        where: { id },
        data: {
          journalEntryId: journalEntry.id,
          appliedAmount,
          ...(effectiveReceivableId && !existing.receivableId
            ? { receivableId: effectiveReceivableId }
            : {}),
        },
      });

      return { updated, journalEntry, appliedAmount };
    });

    await this.auditLogs.log({
      action: 'CREDIT_NOTE_ISSUE',
      entityType: 'CreditNote',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: { status: existing.status },
      newValue: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: result.journalEntry.id,
        appliedAmount: result.appliedAmount.toString(),
      },
    });

    return this.findOne(id);
  }

  // ─── Void (ISSUED -> VOID, reverse the issue JE) ──────────────────────────────

  async void(id: string, dto: VoidCreditNoteDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;

    if (existing.status !== CreditNoteStatus.ISSUED) {
      throw new ConflictException(
        `Only ISSUED credit notes can be voided (current status: ${existing.status})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const db = creditNoteDb(tx);

      // Refund creation takes this same transaction-scoped lock before it
      // validates the note and inserts its claim. Void must share that lock so
      // no DRAFT/PAID refund can appear after a zero-count check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refunds:credit-note'), hashtext(${id}))`;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "credit_notes"
        WHERE "id" = ${id} AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (locked.length !== 1) throw new NotFoundException('Credit note not found');
      const current = (await db.creditNote.findFirst({
        where: { id, deletedAt: null },
      })) as CreditNoteRow | null;
      if (!current) throw new NotFoundException('Credit note not found');
      if (current.companyId !== existing.companyId) {
        throw new ConflictException('Credit note ownership changed; refresh before voiding');
      }
      if (current.status !== CreditNoteStatus.ISSUED) {
        throw new ConflictException(
          `Only ISSUED credit notes can be voided (current status: ${current.status})`,
        );
      }

      // [GL guard — MEDIUM cross-module double-relief] A cash/bank refund draws
      // on this note's value. Count only while holding the shared advisory lock;
      // refund creation cannot pass its own note check until this tx finishes.
      const liveRefunds = await tx.refund.count({
        where: {
          creditNoteId: id,
          companyId: current.companyId,
          deletedAt: null,
          status: { in: ['DRAFT', 'PAID'] as never },
        },
      });
      if (liveRefunds > 0) {
        throw new ConflictException(
          'Cannot void a credit note that still has active refunds; void the refund(s) first',
        );
      }

      // Atomic claim: ISSUED -> VOID.
      const claim = await db.creditNote.updateMany({
        where: { id, status: current.status, updatedAt: current.updatedAt, deletedAt: null },
        data: { status: CreditNoteStatus.VOID },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Credit note is no longer in ISSUED state');
      }

      // Post the exact reverse of the issue JE by swapping every line's sides.
      const reversal = await this.reverseCreditNoteJournal(tx, current, dto.reason, userId);

      // [GL guard — LOW missing-swing] This note was ISSUED with a journalEntryId,
      // so a reversal MUST post. A null result means the offsetting GL swing did
      // not happen (JE missing, already REVERSED, or a lost claim race). Aborting
      // rolls back the ISSUED->VOID claim rather than marking VOID + restoring the
      // receivable with no counter-entry, which would leave the ledger unbalanced
      // against the customer subledger.
      if (!reversal && current.journalEntryId) {
        throw new ConflictException(
          'Credit note reversal could not be posted; void aborted to avoid an unbalanced ledger',
        );
      }

      // Unwind any physical-return restock: remove the returned stock again
      // (outbound ADJUSTMENT_OUT) and reverse the restock's Dr Inventory / Cr
      // COGS at its STORED amounts. No-ops for financial-only credit notes (no
      // returnedQuantity lines). The lines come from the pre-lock detail read —
      // credit-note lines are immutable after create, so they cannot have
      // changed; the lifecycle fields all come from the locked `current` row.
      //
      // [LOCK ORDER — deadlock avoidance] This MUST run BEFORE restoreReceivable.
      // issue() acquires the inventory-side locks first (the per-company
      // InventoryMovement number-sequence row and the inventory_balances row,
      // via restockReturnedLines) and the receivable FOR UPDATE second (via
      // applyToReceivable). void() has to take the same locks in the SAME order
      // — inventory before receivable — or a concurrent issue() of one note and
      // void() of another sharing a receivable (or merely the same company's
      // movement sequence row) form an ABBA cycle and Postgres kills one with a
      // 40P01 deadlock. The per-note pg_advisory_xact_lock above does NOT
      // serialize different notes, so ordering is the only protection. The two
      // steps are independent (unwindRestock reads only lines + the restock JE;
      // restoreReceivable reads only receivableId/appliedAmount), so the order
      // swap is behavior-preserving.
      await this.unwindRestock(tx, { ...current, lines: existing.lines }, userId);

      // Give back the outstanding we previously took off the linked receivable.
      const applied = new Prisma.Decimal(current.appliedAmount ?? 0).toDecimalPlaces(2);
      if (current.receivableId && applied.gt(0)) {
        await this.restoreReceivable(tx, current.receivableId, current.companyId, applied, user);
      }

      // NB: do NOT overwrite `notes` with the void reason — the reason is captured
      // on the audit log (and echoed in the reversing JE description). Clobbering
      // the note's original notes would destroy the operator's context.
      const updated: CreditNoteRow = await db.creditNote.update({
        where: { id },
        data: { appliedAmount: ZERO },
      });

      // Voiding changes the credit-note lifecycle, reverses the GL entry, and
      // restores the receivable subledger. The audit row is part of that same
      // financial fact: if it cannot be appended, Prisma must roll the entire
      // reversal back instead of committing an unaudited void.
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CREDIT_NOTE_VOID',
        entityType: 'CreditNote',
        entityId: id,
        userId,
        companyId: current.companyId,
        oldValue: { status: current.status },
        newValue: {
          status: CreditNoteStatus.VOID,
          reason: dto.reason,
          reversalJournalEntryId: reversal?.id ?? null,
        },
      });

      return { updated, reversal };
    });

    return this.findOne(id);
  }

  // ─── Internals ────────────────────────────────────────────────────────────────

  /**
   * Resolve the receivable a credit note relieves. Prefers the explicit
   * receivableId link; when that is absent but a salesOrderId is present, resolve
   * the sales order's receivable exactly the way sales-orders.service does:
   *   1. SalesOrder.receivableId (the direct FK set when a credit sale confirms), then
   *   2. Receivable where sourceType='SalesOrder' AND sourceId=salesOrderId.
   * Company-scoped throughout so we never resolve another tenant's receivable.
   * Returns null when nothing is linked (a standalone credit note that only
   * credits AR in the GL and leaves an available customer credit).
   */
  private async resolveLinkedReceivableId(
    client: Prisma.TransactionClient | PrismaService,
    receivableId: string | null,
    salesOrderId: string | null,
    companyId: string,
  ): Promise<string | null> {
    if (receivableId) return receivableId;
    if (!salesOrderId) return null;

    const so = await client.salesOrder.findFirst({
      where: { id: salesOrderId, companyId, deletedAt: null },
      select: { receivableId: true },
    });
    if (so?.receivableId) return so.receivableId;

    const rec = await client.receivable.findFirst({
      where: {
        companyId,
        sourceType: 'SalesOrder',
        sourceId: salesOrderId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return rec?.id ?? null;
  }

  /**
   * Physical-return restock for issue(). For every credit-note line carrying a
   * returnedQuantity > 0 (opt-in per line — set at create time), put the goods
   * back into the inventory subledger via an inbound SALES_RETURN movement and
   * post the reversing  Dr Inventory (INVENTORY_ASSET) / Cr COGS  for the
   * returned cost — the mirror of the sale's original DR COGS / CR Inventory.
   * Lines with no returnedQuantity (price adjustments / allowances) are skipped:
   * a financial-only credit note behaves exactly as before.
   *
   * Runs inside issue()'s DRAFT->ISSUED-claimed transaction, so it posts exactly
   * once alongside the AR/revenue/VAT reversal. Balanced + Decimal throughout.
   */
  private async restockReturnedLines(
    tx: Prisma.TransactionClient,
    note: {
      id: string;
      companyId: string;
      creditNoteNumber: string;
      divisionId: string | null;
      branchId: string | null;
      issueDate: Date;
      salesOrderId: string | null;
      lines?: Array<{
        productId: string | null;
        unitId: string | null;
        quantity: Prisma.Decimal | number | string;
        returnedQuantity: Prisma.Decimal | number | string | null;
        restockUnitCost: Prisma.Decimal | number | string | null;
      }>;
    },
    userId: string,
  ): Promise<Prisma.Decimal> {
    const lines = note.lines ?? [];
    const returnLines = lines.filter(
      (l) => l.productId && new Prisma.Decimal(l.returnedQuantity ?? 0).gt(0),
    );
    if (returnLines.length === 0) return ZERO;

    // A restock lands physical stock at a location; without a branch there is no
    // subledger row to credit. create() defaults branchId from the customer, so a
    // return credit note must be scoped to a branch to restock.
    if (!note.branchId) {
      throw new BadRequestException(
        'A credit note that restocks returned goods must have a branch/location',
      );
    }

    let cogsTotal = ZERO;

    for (const line of returnLines) {
      const productId = line.productId as string;
      const product = await tx.product.findUnique({ where: { id: productId } });
      // Only stock-tracked products carry inventory + COGS. A returnedQuantity on a
      // service / non-stock line has nothing to restock or reverse — skip it (its
      // original sale posted no COGS either), so we never inject phantom stock.
      if (!product || !this.profit.isStockProduct(product)) continue;

      if (!line.unitId) {
        throw new BadRequestException(
          `Returned line for product "${product.name}" is missing a unit and cannot be restocked`,
        );
      }

      const returnedQty = new Prisma.Decimal(line.returnedQuantity ?? 0).toDecimalPlaces(4);
      if (returnedQty.lte(0)) continue;

      const unitCost = await this.resolveRestockUnitCost(tx, note, line, product);
      if (unitCost.lte(0)) {
        throw new BadRequestException(
          `Cannot restock returned product "${product.name}": no positive unit cost is available`,
        );
      }

      // Inbound SALES_RETURN movement — restocks quantityOnHand / totalValue in the
      // subledger (same movement type sales-orders.cancel uses to unwind a sale).
      await this.inventoryMovements.createMovement({
        companyId: note.companyId,
        productId,
        movementType: 'SALES_RETURN',
        quantity: returnedQty.toNumber(),
        unitId: line.unitId,
        unitCost: unitCost.toNumber(),
        movementDate: note.issueDate,
        createdById: userId,
        referenceType: 'CreditNote',
        referenceId: note.id,
        notes: `Return restock: credit note ${note.creditNoteNumber}`,
        divisionId: note.divisionId ?? undefined,
        branchId: note.branchId,
        tx,
      });

      cogsTotal = cogsTotal.plus(returnedQty.mul(unitCost)).toDecimalPlaces(2);
    }

    if (cogsTotal.lte(0)) return ZERO;

    // Reversing COGS leg (mirror of the sale's DR COGS / CR Inventory):
    //   Dr Inventory asset (INVENTORY_ASSET)  — returned stock re-enters the books
    //   Cr Cost of goods sold (COST_OF_GOODS_SOLD) — unwind the profit hit
    // Posted as its OWN balanced JE referenced to the credit note, so it is
    // separable from the AR/revenue/VAT reversal and void() can find & reverse it.
    const accounts = await this.accountResolver.resolveMany(
      note.companyId,
      ['INVENTORY_ASSET', 'COST_OF_GOODS_SOLD'],
      tx,
    );
    await this.postingEngine.postLines(
      {
        companyId: note.companyId,
        divisionId: note.divisionId,
        branchId: note.branchId,
        transactionDate: note.issueDate,
        description: `Credit note ${note.creditNoteNumber} — returned goods restock`,
        referenceType: 'CreditNote',
        referenceId: note.id,
        moduleName: 'credit-notes',
        userId,
        lines: [
          {
            accountId: accounts.INVENTORY_ASSET.id,
            description: 'Inventory returned to stock',
            debit: cogsTotal,
            credit: ZERO,
          },
          {
            accountId: accounts.COST_OF_GOODS_SOLD.id,
            description: 'COGS reversal on returned goods',
            debit: ZERO,
            credit: cogsTotal,
          },
        ],
      },
      tx,
    );

    return cogsTotal;
  }

  /**
   * Per-unit cost the returned stock re-enters at, in priority order:
   *   1. restockUnitCost frozen on the line at create time (explicit operator cost),
   *   2. the matching sales-order line's frozen cost (unitCostAtSale, then
   *      cogsAmount / quantity) — the exact basis the original sale used,
   *   3. the product's branch average cost, then its defaultPurchasePrice.
   * Mirrors the fallback chain in sales-orders.cancel so a return re-enters stock
   * at the same cost the sale relieved it, keeping the COGS reversal exact.
   */
  private async resolveRestockUnitCost(
    tx: Prisma.TransactionClient,
    note: { companyId: string; branchId: string | null; salesOrderId: string | null },
    line: {
      productId: string | null;
      restockUnitCost: Prisma.Decimal | number | string | null;
    },
    product: { defaultPurchasePrice?: Prisma.Decimal | number | string | null },
  ): Promise<Prisma.Decimal> {
    if (line.restockUnitCost != null) {
      const frozen = new Prisma.Decimal(line.restockUnitCost).toDecimalPlaces(4);
      if (frozen.gt(0)) return frozen;
    }

    // Sales-order line cost basis (the sale's frozen per-unit cost).
    if (note.salesOrderId && line.productId) {
      const soLine = await tx.salesOrderLine.findFirst({
        where: { salesOrderId: note.salesOrderId, productId: line.productId },
        orderBy: { createdAt: 'asc' },
        select: { quantity: true, unitCostAtSale: true, cogsAmount: true },
      });
      if (soLine?.unitCostAtSale != null) {
        const c = new Prisma.Decimal(soLine.unitCostAtSale).toDecimalPlaces(4);
        if (c.gt(0)) return c;
      }
      if (soLine?.cogsAmount != null && soLine.quantity != null) {
        const qty = new Prisma.Decimal(soLine.quantity);
        if (qty.gt(0)) {
          const c = new Prisma.Decimal(soLine.cogsAmount).dividedBy(qty).toDecimalPlaces(4);
          if (c.gt(0)) return c;
        }
      }
    }

    // Product cost: branch average, then the product's default purchase price.
    if (note.branchId && line.productId) {
      const balance = await tx.inventoryBalance.findFirst({
        where: { companyId: note.companyId, productId: line.productId, branchId: note.branchId },
        select: { averageCost: true },
      });
      if (balance?.averageCost != null) {
        const c = new Prisma.Decimal(balance.averageCost).toDecimalPlaces(4);
        if (c.gt(0)) return c;
      }
    }
    const def = new Prisma.Decimal(product.defaultPurchasePrice ?? 0).toDecimalPlaces(4);
    return def.gt(0) ? def : ZERO;
  }

  /**
   * Void-time unwind of a physical-return restock. Two GL-review fixes are baked
   * in here:
   *
   * [FINDING 1 — cost asymmetry] The GL leg is NOT recomputed at void time. We
   *   find the ORIGINAL restock JE (Dr Inventory / Cr COGS, linked to the credit
   *   note) and post its exact mirror by swapping every stored line's
   *   debit<->credit at the STORED amounts — the same reverse-by-stored-lines
   *   pattern as reverseCreditNoteJournal / reverseSalesOrderJournal. This nets
   *   the restock to EXACTLY zero even if the cost basis (WAC, product default,
   *   SO line) has drifted between issue and void. The original restock JE is
   *   claimed REVERSED under a guarded update first, so a re-void is a no-op.
   *
   * [FINDING 2 — stock guards] The physical stock is removed with an
   *   ADJUSTMENT_OUT movement, NOT a SALE_ISSUE, and the movement escapes BOTH
   *   availability guards in applyMovementToBalance:
   *     - the reserved-availability guard gates ONLY SALE_ISSUE, so using
   *       ADJUSTMENT_OUT (a real physical depletion) never blocks on
   *       quantityReserved; and
   *     - the negative-stock guard is explicitly bypassed via
   *       `allowNegativeOnHand: true`, because interim sales may have consumed
   *       the restocked units — the compensating movement must still post (the
   *       restock never really happened, so negative on-hand is the truthful
   *       position and the resale was the over-issue).
   *   So voiding a return is never blocked just because the restocked stock was
   *   since re-sold, consumed, or reserved. The subledger is still reduced by
   *   the returned qty at the same cost, matching the reversing GL leg.
   *
   * Idempotent PER NOTE: the whole physical unwind runs inside void()'s single
   * transaction, so a prior void left either ALL compensating movements or none.
   * A re-void detects any compensating movement tagged CreditNoteVoid for this
   * note and skips the entire physical loop (the GL reversal carries its own
   * separate REVERSED-claim guard). The probe is deliberately NOT per product:
   * a per-product probe would break multi-line same-product notes, because line
   * 1's ADJUSTMENT_OUT (created earlier in this same transaction) would satisfy
   * line 2's probe and line 2 would never unwind, while the GL leg reverses the
   * ENTIRE stored restock JE.
   */
  private async unwindRestock(
    tx: Prisma.TransactionClient,
    note: {
      id: string;
      companyId: string;
      creditNoteNumber: string;
      divisionId: string | null;
      branchId: string | null;
      salesOrderId: string | null;
      lines?: Array<{
        productId: string | null;
        unitId: string | null;
        returnedQuantity: Prisma.Decimal | number | string | null;
        restockUnitCost: Prisma.Decimal | number | string | null;
      }>;
    },
    userId: string,
  ): Promise<void> {
    const returnLines = (note.lines ?? []).filter(
      (l) => l.productId && new Prisma.Decimal(l.returnedQuantity ?? 0).gt(0),
    );
    if (returnLines.length === 0) return;
    if (!note.branchId) return; // could not have restocked without a branch

    // ── Physical subledger unwind ────────────────────────────────────────────
    // Remove the returned stock again, one ADJUSTMENT_OUT per return line. We use
    // ADJUSTMENT_OUT (not SALE_ISSUE) so the reserved-availability guard in
    // applyMovementToBalance can never block the void when the restocked stock
    // has since been re-sold / reserved. The unwind qty comes from the line's
    // returnedQuantity; the cost keeps the subledger valuation consistent.
    //
    // Idempotency is PER NOTE, not per line/product: all compensating movements
    // below post inside void()'s single transaction, so a prior (re-)void left
    // either every movement or none. One probe up front — keyed on the note,
    // WITHOUT productId — decides for the whole loop. Probing inside the loop
    // per product would find line 1's just-created ADJUSTMENT_OUT (same-tx
    // own-writes visibility) and silently skip line 2 of a same-product note,
    // under-unwinding the stock while the GL leg reverses the full restock JE.
    const alreadyUnwound = await tx.inventoryMovement.findFirst({
      where: {
        companyId: note.companyId,
        movementType: 'ADJUSTMENT_OUT',
        referenceType: 'CreditNoteVoid',
        referenceId: note.id,
      },
      select: { id: true },
    });
    if (!alreadyUnwound) {
      for (const line of returnLines) {
        const productId = line.productId as string;
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !this.profit.isStockProduct(product) || !line.unitId) continue;

        const returnedQty = new Prisma.Decimal(line.returnedQuantity ?? 0).toDecimalPlaces(4);
        if (returnedQty.lte(0)) continue;

        const unitCost = await this.resolveRestockUnitCost(tx, note, line, product);

        await this.inventoryMovements.createMovement({
          companyId: note.companyId,
          productId,
          // ADJUSTMENT_OUT: real physical depletion, NOT gated by the reserved
          // guard (only SALE_ISSUE is) — so the void isn't blocked by later
          // reservations on the restocked stock.
          movementType: 'ADJUSTMENT_OUT',
          quantity: returnedQty.toNumber(),
          unitId: line.unitId,
          unitCost: unitCost.gt(0) ? unitCost.toNumber() : undefined,
          movementDate: new Date(),
          createdById: userId,
          referenceType: 'CreditNoteVoid',
          referenceId: note.id,
          notes: `Void reversal of return restock: credit note ${note.creditNoteNumber}`,
          divisionId: note.divisionId ?? undefined,
          branchId: note.branchId,
          // COMPENSATING movement: the restock being unwound never really
          // happened, so this ADJUSTMENT_OUT must post even when interim sales
          // already consumed the restocked units and would drive on-hand
          // negative. Without the bypass, the negative-stock guard would make
          // an erroneous ISSUED note permanently un-voidable (the whole void
          // transaction — AR/revenue/VAT reversal included — would roll back).
          allowNegativeOnHand: true,
          tx,
        });
      }
    }

    // ── GL unwind (reverse the ORIGINAL restock JE by its STORED lines) ───────
    // Find the original restock JE (Dr Inventory / Cr COGS) posted at issue time,
    // linked to this credit note, and reverse it by swapping each stored line's
    // debit<->credit at the STORED amounts. This nets the restock to exactly zero
    // regardless of any cost-basis change since issue. Claim it REVERSED under an
    // atomic guard first so a re-void does not double-post.
    const restockJe = await tx.journalEntry.findFirst({
      where: {
        companyId: note.companyId,
        referenceType: 'CreditNote',
        referenceId: note.id,
        description: { contains: 'returned goods restock' },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
    if (!restockJe || restockJe.lines.length === 0) return;

    const claim = await tx.journalEntry.updateMany({
      where: { id: restockJe.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId },
    });
    if (claim.count !== 1) return; // already reversed — do not double-post

    // Mirror of the original restock: each debit becomes a credit of the same
    // magnitude and vice-versa, at the STORED amounts (no recompute).
    const reversedLines = restockJe.lines.map((line) => ({
      accountId: line.accountId,
      debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
      credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    const reversal = await this.postingEngine.postLines(
      {
        companyId: restockJe.companyId,
        divisionId: restockJe.divisionId,
        branchId: restockJe.branchId,
        transactionDate: new Date(),
        description: `Void of credit note ${note.creditNoteNumber} — restock reversal`,
        referenceType: 'CreditNote',
        referenceId: note.id,
        moduleName: 'credit-notes',
        userId,
        lines: reversedLines,
      },
      tx,
    );

    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: restockJe.id },
    });
  }

  /**
   * Reduce a linked receivable's outstanding by up to `credit`, without driving
   * it below zero. Returns the amount actually applied (≤ credit). Any remainder
   * (credit − applied) is left as an available customer credit on the credit
   * note itself. Locks the receivable row FOR UPDATE so the read-modify-write is
   * atomic under concurrency (same pattern as receivables.recordPayment).
   */
  private async applyToReceivable(
    tx: Prisma.TransactionClient,
    receivableId: string,
    companyId: string,
    credit: Prisma.Decimal,
    user: AuthUser,
  ): Promise<Prisma.Decimal> {
    const [locked] = await tx.$queryRaw<
      Array<{
        id: string;
        companyId: string;
        customerId: string | null;
        outstandingAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
      }>
    >`SELECT "id", "companyId", "customerId", "outstandingAmount", "paidAmount"
      FROM "receivables"
      WHERE "id" = ${receivableId} AND "deletedAt" IS NULL
      FOR UPDATE`;

    if (!locked) throw new NotFoundException('Linked receivable not found');
    if (locked.companyId !== companyId) {
      throw new BadRequestException('Receivable does not belong to this company');
    }
    await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);

    const outstanding = new Prisma.Decimal(locked.outstandingAmount).toDecimalPlaces(2);
    // Never drive outstanding negative: apply at most the outstanding balance.
    const applied = Prisma.Decimal.min(credit, outstanding).toDecimalPlaces(2);
    if (applied.lte(0)) return ZERO;

    const nextOutstanding = outstanding.minus(applied).toDecimalPlaces(2);
    const nextStatus = nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';

    await tx.receivable.update({
      where: { id: receivableId },
      data: { outstandingAmount: nextOutstanding, status: nextStatus as never },
    });
    await this.syncCustomerBalance(tx, companyId, locked.customerId);
    return applied;
  }

  /**
   * Undo a prior credit-note application to a receivable when the note is voided:
   * add `amount` back onto outstanding and re-derive the status from the
   * receivable's real paid/outstanding state.
   *
   * [GL guards — MEDIUM] Two protections here:
   *   • Never resurrect a dead receivable. If it has since been CANCELLED or
   *     WRITTEN_OFF, another flow already reversed its GL/subledger impact;
   *     re-inflating its outstanding (and the customer balance) would double the
   *     relief. We skip the restore entirely in that case.
   *   • Never re-inflate outstanding past the receivable's original amount. The
   *     restored outstanding is capped at `amount − paid` (equivalently
   *     `originalAmount − paidAmount`), and the status is derived from that real
   *     state rather than blindly forced to OPEN/PARTIALLY_PAID.
   */
  private async restoreReceivable(
    tx: Prisma.TransactionClient,
    receivableId: string,
    companyId: string,
    amount: Prisma.Decimal,
    user: AuthUser,
  ): Promise<void> {
    const [locked] = await tx.$queryRaw<
      Array<{
        id: string;
        companyId: string;
        customerId: string | null;
        amount: Prisma.Decimal;
        outstandingAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        status: string;
      }>
    >`SELECT "id", "companyId", "customerId", "amount", "outstandingAmount", "paidAmount", "status"
      FROM "receivables"
      WHERE "id" = ${receivableId} AND "deletedAt" IS NULL
      FOR UPDATE`;
    if (!locked) return; // receivable gone — nothing to restore
    if (locked.companyId !== companyId) return;
    await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);

    // Do not resurrect a dead receivable / re-inflate the customer balance.
    if (locked.status === 'CANCELLED' || locked.status === 'WRITTEN_OFF') {
      return;
    }

    const originalAmount = new Prisma.Decimal(locked.amount).toDecimalPlaces(2);
    const outstanding = new Prisma.Decimal(locked.outstandingAmount).toDecimalPlaces(2);
    const paid = new Prisma.Decimal(locked.paidAmount).toDecimalPlaces(2);

    // Restore, but never let outstanding exceed what the receivable can actually
    // owe (original amount minus what has been paid on it).
    const maxOutstanding = Prisma.Decimal.max(originalAmount.minus(paid), ZERO).toDecimalPlaces(2);
    const nextOutstanding = Prisma.Decimal.min(
      outstanding.plus(amount),
      maxOutstanding,
    ).toDecimalPlaces(2);

    // Derive status from the real paid/outstanding position, not a blind reopen.
    let nextStatus: 'PAID' | 'PARTIALLY_PAID' | 'OPEN';
    if (nextOutstanding.lte(0)) {
      nextStatus = 'PAID';
    } else if (paid.gt(0)) {
      nextStatus = 'PARTIALLY_PAID';
    } else {
      nextStatus = 'OPEN';
    }

    await tx.receivable.update({
      where: { id: receivableId },
      data: { outstandingAmount: nextOutstanding, status: nextStatus as never },
    });
    await this.syncCustomerBalance(tx, companyId, locked.customerId);
  }

  private async syncCustomerBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId?: string | null,
  ) {
    if (!customerId) return;
    const summary = await tx.receivable.aggregate({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as never },
      },
      _sum: { outstandingAmount: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }

  /**
   * Post a balanced reversing journal entry that exactly unwinds the credit
   * note's issue entry, by swapping debit/credit on every original line. Marks
   * the original POSTED entry REVERSED under an atomic claim first so the swing
   * posts exactly once. Mirrors sales-orders.reverseSalesOrderJournal.
   */
  private async reverseCreditNoteJournal(
    tx: Prisma.TransactionClient,
    note: {
      id: string;
      companyId: string;
      creditNoteNumber: string;
      journalEntryId: string | null;
    },
    reason: string,
    userId: string,
  ): Promise<{ id: string; journalNumber: string } | null> {
    const original = note.journalEntryId
      ? await tx.journalEntry.findFirst({
          where: { id: note.journalEntryId, companyId: note.companyId, deletedAt: null },
          include: { lines: true },
        })
      : await tx.journalEntry.findFirst({
          where: {
            companyId: note.companyId,
            referenceType: 'CreditNote',
            referenceId: note.id,
            deletedAt: null,
          },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        });

    if (!original || original.lines.length === 0) return null;

    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId },
    });
    if (claim.count !== 1) return null;

    const reversedLines = original.lines.map((line) => ({
      accountId: line.accountId,
      debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
      credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    const reversal = await this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: new Date(),
        description: `Void of credit note ${note.creditNoteNumber}: ${reason}`.trim(),
        referenceType: 'CreditNote',
        referenceId: note.id,
        moduleName: 'credit-notes',
        userId,
        lines: reversedLines,
      },
      tx,
    );

    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: original.id },
    });

    return reversal;
  }

  private includeListScope() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      customer: { select: { id: true, customerCode: true, name: true, tin: true, vrn: true } },
      salesOrder: { select: { id: true, salesOrderNumber: true } },
      receivable: {
        select: {
          id: true,
          receivableNumber: true,
          outstandingAmount: true,
          status: true,
        },
      },
    };
  }

  private includeDetailScope() {
    return {
      ...this.includeListScope(),
      lines: {
        select: {
          id: true,
          productId: true,
          unitId: true,
          description: true,
          quantity: true,
          unitPrice: true,
          netAmount: true,
          taxAmount: true,
          lineTotal: true,
          returnedQuantity: true,
          restockUnitCost: true,
          product: { select: { id: true, productCode: true, sku: true, name: true } },
          unit: { select: { id: true, name: true, symbol: true } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      journalEntry: {
        select: {
          id: true,
          journalNumber: true,
          transactionDate: true,
          description: true,
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
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
    };
  }
}
