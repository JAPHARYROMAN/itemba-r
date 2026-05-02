import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SalesPaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostFolioChargeDto } from './dto/post-charge.dto';

const HOSPITALITY_PRODUCT_CODE = 'HOSP-SVC';
const HOSPITALITY_CATEGORY_NAME = 'Hospitality Services';
const SERVICE_UNIT_SYMBOL = 'svc';

/**
 * Guest folio service — the running tab for a hospitality stay.
 *
 * Lifecycle:
 *   1. Operator checks a guest in → `openForBooking()` creates an OPEN folio
 *      (auto-called from RoomBookingsService.checkIn)
 *   2. Through the stay, charges accumulate via `postCharge()`:
 *      - Front desk posts food/bar/laundry/etc. as needed
 *      - On check-out, `postRoomNightsCharge()` posts the final ROOM charge
 *      - (Future W5.5) RestaurantOrder.complete auto-posts to the folio
 *   3. `checkout()` totalizes and closes the folio. A future iteration will
 *      simultaneously create a settlement SalesOrder so the GL captures
 *      revenue; for the MVP, the folio itself is the bill.
 */
@Injectable()
export class FoliosService {
  private readonly logger = new Logger(FoliosService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly salesOrders: SalesOrdersService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  /** Find or create the folio for a booking. Idempotent. */
  async openForBooking(bookingId: string, userId?: string) {
    const existing = await this.prisma.guestFolio.findUnique({
      where: { bookingId },
    });
    if (existing) return existing;

    const booking = await this.prisma.roomBooking.findFirst({
      where: { id: bookingId, deletedAt: null },
      select: { id: true, companyId: true, guestId: true, currency: true, bookingNumber: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const folioNumber = await this.codes.next({ entityType: 'GuestFolio', companyId: booking.companyId });
    const folio = await this.prisma.guestFolio.create({
      data: {
        folioNumber,
        companyId: booking.companyId,
        bookingId: booking.id,
        guestId: booking.guestId,
        currency: booking.currency,
      },
    });

    if (userId) {
      await this.audit.log({
        userId,
        action: 'CREATE',
        entityType: 'GuestFolio',
        entityId: folio.id,
        companyId: folio.companyId,
        newValue: { folioNumber, bookingId } as unknown as Record<string, unknown>,
      });
    }
    return folio;
  }

  async findOne(id: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id, deletedAt: null },
      include: this.fullInclude(),
    });
    if (!folio) throw new NotFoundException('Folio not found');
    return folio;
  }

  async findByBooking(bookingId: string) {
    const folio = await this.prisma.guestFolio.findUnique({
      where: { bookingId },
      include: this.fullInclude(),
    });
    if (!folio) return null;
    return folio;
  }

  /** Append a charge to an OPEN folio and re-totalize. */
  async postCharge(folioId: string, dto: PostFolioChargeDto, userId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: folioId, deletedAt: null },
      select: { id: true, status: true, companyId: true },
    });
    if (!folio) throw new NotFoundException('Folio not found');
    if (folio.status !== 'OPEN') {
      throw new BadRequestException('Charges can only be posted to an OPEN folio');
    }

    const amount = round2(dto.quantity * dto.unitPrice);
    const tax = round2(dto.taxAmount ?? 0);

    await this.prisma.$transaction([
      this.prisma.folioCharge.create({
        data: {
          folioId,
          chargeType: dto.chargeType,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          amount,
          taxAmount: tax,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          notes: dto.notes,
          postedById: userId,
        },
      }),
      this.prisma.guestFolio.update({
        where: { id: folioId },
        data: {
          subtotal: { increment: amount },
          taxAmount: { increment: tax },
          totalAmount: { increment: amount + tax },
        },
      }),
    ]);

    await this.audit.log({
      userId,
      action: 'POST_CHARGE',
      entityType: 'GuestFolio',
      entityId: folioId,
      companyId: folio.companyId,
      newValue: { ...dto, amount, tax } as unknown as Record<string, unknown>,
    });

    return this.findOne(folioId);
  }

  /**
   * Post the room-nights charge during checkout. Computes nights as:
   *   - actualCheckOut − actualCheckIn (if both timestamps set, rounded up
   *     to whole days; minimum 1 night even if same-day checkout)
   *   - else falls back to booking.nights
   *
   * Idempotent: if a ROOM charge already exists with sourceId = bookingId,
   * skip — operators can run check-out twice without duplicating.
   */
  async postRoomNightsCharge(folioId: string, userId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: folioId, deletedAt: null },
      include: { booking: true },
    });
    if (!folio) throw new NotFoundException('Folio not found');
    const booking = folio.booking;

    const existing = await this.prisma.folioCharge.findFirst({
      where: { folioId, chargeType: 'ROOM', sourceId: booking.id },
    });
    if (existing) return existing;

    const checkIn = booking.actualCheckIn ?? booking.expectedCheckIn;
    const checkOut = booking.actualCheckOut ?? new Date();
    const ms = checkOut.getTime() - checkIn.getTime();
    const computedNights = Math.max(1, Math.ceil(ms / (24 * 3600 * 1000)));
    const nights = booking.actualCheckIn ? computedNights : booking.nights;
    const rate = Number(booking.ratePerNight);

    return this.postCharge(
      folioId,
      {
        chargeType: 'ROOM',
        description: `Room ${nights} night${nights === 1 ? '' : 's'} × TZS ${rate.toFixed(2)}`,
        quantity: nights,
        unitPrice: rate,
        sourceType: 'RoomBooking',
        sourceId: booking.id,
      },
      userId,
    );
  }

  /**
   * Close the folio. Computes final totals from charge rows (defensive — in
   * case any direct DB writes bypassed `postCharge()`), records who closed
   * it. Future W5.5 will create a settlement SalesOrder here so the GL
   * captures revenue and the cash account is credited.
   */
  async checkout(folioId: string, userId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: folioId, deletedAt: null },
      include: { charges: true },
    });
    if (!folio) throw new NotFoundException('Folio not found');
    if (folio.status !== 'OPEN') {
      throw new BadRequestException('Folio is already closed');
    }

    const subtotal = folio.charges.reduce((s, c) => s + Number(c.amount), 0);
    const taxAmount = folio.charges.reduce((s, c) => s + Number(c.taxAmount), 0);
    const totalAmount = round2(subtotal + taxAmount);

    const updated = await this.prisma.guestFolio.update({
      where: { id: folioId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
        subtotal: round2(subtotal),
        taxAmount: round2(taxAmount),
        totalAmount,
      },
    });

    await this.audit.log({
      userId,
      action: 'CHECKOUT',
      entityType: 'GuestFolio',
      entityId: folioId,
      companyId: folio.companyId,
      newValue: { totalAmount } as unknown as Record<string, unknown>,
    });

    return this.findOne(updated.id);
  }

  /**
   * Settle the folio — close it AND create a settlement SalesOrder. This is
   * the front-desk checkout path: operator picks payment method + cash
   * account, system creates the SalesOrder via the existing payment-routing
   * built in W1 (CASH/MOBILE_MONEY etc → cash account credited; CREDIT →
   * Receivable created; either way → revenue lands on the GL).
   *
   * Each FolioCharge becomes one SalesOrderLine pointing at the lazily-
   * created "Hospitality Service" Product so the SalesOrder schema's
   * required productId is honored. The line description preserves the
   * charge type (e.g. "RESTAURANT — dinner for 2") so audit reads cleanly.
   *
   * Idempotent against re-runs: if `settlementSalesOrderId` is already set,
   * returns the existing settlement.
   */
  async settle(
    folioId: string,
    user: import('../../common/decorators/current-user.decorator').AuthUser,
    dto: { paymentMethod: SalesPaymentMethod; cashAccountId?: string; paymentReference?: string },
  ) {
    const userId = user.id;
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: folioId, deletedAt: null },
      include: {
        charges: { orderBy: { postedAt: 'asc' } },
        // RoomBooking has no branchId/divisionId — those live on
        // HospitalityFacility. For settlement we can leave them off the
        // SalesOrder; the SalesOrder's company + customer is enough.
        booking: { select: { id: true, currency: true } },
        guest: { select: { id: true, fullName: true, customerId: true } },
      },
    });
    if (!folio) throw new NotFoundException('Folio not found');
    if (folio.status === 'CLOSED' && folio.settlementSalesOrderId) {
      // Already settled — return the existing SalesOrder for traceability.
      return this.salesOrders.findOne(folio.settlementSalesOrderId, user);
    }
    if (folio.status === 'CANCELLED') {
      throw new BadRequestException('Cannot settle a CANCELLED folio');
    }
    if (folio.charges.length === 0) {
      throw new BadRequestException('Cannot settle an empty folio — post at least one charge first.');
    }
    if (dto.paymentMethod !== 'CREDIT' && !dto.cashAccountId) {
      throw new BadRequestException('Pick a cash / bank account for non-CREDIT payments.');
    }
    if (dto.paymentMethod !== 'CREDIT' && dto.cashAccountId) {
      const acct = await this.prisma.cashAccount.findFirst({
        where: { id: dto.cashAccountId, companyId: folio.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!acct) throw new BadRequestException('Selected cash account does not belong to this company.');
    }

    const product = await this.ensureHospitalityProduct(folio.companyId);

    // Resolve the customer to bill: prefer the customer linked to the guest,
    // otherwise treat as walk-in (customerName).
    const customerId = folio.guest.customerId ?? undefined;
    const customerName = !customerId ? folio.guest.fullName : undefined;

    const lines = folio.charges.map((c) => ({
      productId: product.id,
      description: `${c.chargeType} — ${c.description}`,
      quantity: Number(c.quantity),
      unitId: product.baseUnitId,
      unitPrice: Number(c.unitPrice),
      taxAmount: Number(c.taxAmount),
      discountAmount: 0,
      // Hospitality services don't issue inventory; inventoryLocationId is
      // intentionally omitted so SalesOrder.confirm() skips the stock
      // movement (the service is non-inventory).
    }));

    // Create the SalesOrder (DRAFT) then confirm it — this triggers the
    // payment routing built in W1: cash account credited or receivable
    // created, plus salesperson commission (if any).
    const created = await this.salesOrders.create(
      {
        companyId: folio.companyId,
        customerId,
        customerName,
        salesType: 'SERVICE' as any,
        orderDate: new Date().toISOString(),
        currency: folio.currency as any,
        paymentMethod: dto.paymentMethod,
        cashAccountId: dto.cashAccountId,
        paymentReference: dto.paymentReference,
        notes: `Folio ${folio.folioNumber} settlement`,
        lines,
        createdById: userId,
      } as any,
      user,
    );
    const confirmed = await this.salesOrders.confirm(created.id, user);

    // Defensive total recompute (in case stray writes bypassed postCharge)
    // and link the settlement SalesOrder.
    const subtotal = folio.charges.reduce((s, c) => s + Number(c.amount), 0);
    const taxAmount = folio.charges.reduce((s, c) => s + Number(c.taxAmount), 0);
    await this.prisma.guestFolio.update({
      where: { id: folio.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
        subtotal: round2(subtotal),
        taxAmount: round2(taxAmount),
        totalAmount: round2(subtotal + taxAmount),
        settlementSalesOrderId: confirmed.id,
      },
    });

    await this.audit.log({
      userId,
      action: 'SETTLE',
      entityType: 'GuestFolio',
      entityId: folio.id,
      companyId: folio.companyId,
      newValue: { paymentMethod: dto.paymentMethod, salesOrderId: confirmed.id, total: subtotal + taxAmount } as unknown as Record<string, unknown>,
    });

    return this.findOne(folio.id);
  }

  /**
   * Find or create the per-company hospitality service Product so folio
   * settlements have a valid productId for SalesOrderLine. Reuses the
   * system-wide "Service" UnitOfMeasure (no per-company seed needed).
   *
   * Lazy: creates on first settle, then idempotent forever after.
   */
  private async ensureHospitalityProduct(companyId: string) {
    const existing = await this.prisma.product.findFirst({
      where: { companyId, productCode: HOSPITALITY_PRODUCT_CODE, deletedAt: null },
      select: { id: true, baseUnitId: true },
    });
    if (existing) return existing;

    // Find or create the "Hospitality Services" category.
    let category = await this.prisma.productCategory.findFirst({
      where: { companyId, name: HOSPITALITY_CATEGORY_NAME, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      const created = await this.prisma.productCategory.create({
        data: {
          companyId,
          name: HOSPITALITY_CATEGORY_NAME,
          categoryType: 'SERVICE',
          description: 'Auto-created for guest folio settlement.',
        },
      });
      category = { id: created.id };
    }

    // Find the system "Service" unit (companyId=null, isSystemUnit=true).
    const unit = await this.prisma.unitOfMeasure.findFirst({
      where: { symbol: SERVICE_UNIT_SYMBOL, isSystemUnit: true },
      select: { id: true },
    });
    if (!unit) {
      throw new BadRequestException(
        'System "Service" unit (svc) is missing — re-run the seed.',
      );
    }

    const product = await this.prisma.product.create({
      data: {
        companyId,
        productCode: HOSPITALITY_PRODUCT_CODE,
        categoryId: category.id,
        name: 'Hospitality Service',
        description: 'Generic non-inventory service line for guest folio settlements.',
        productType: 'SERVICE',
        baseUnitId: unit.id,
        trackInventory: false,
        trackBatch: false,
        trackExpiry: false,
        isTaxable: false,
        status: 'ACTIVE',
      },
      select: { id: true, baseUnitId: true },
    });
    return product;
  }

  /** Cancel a folio (only when OPEN with no charges). */
  async cancel(folioId: string, userId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: folioId, deletedAt: null },
      include: { _count: { select: { charges: true } } },
    });
    if (!folio) throw new NotFoundException('Folio not found');
    if (folio.status !== 'OPEN') throw new BadRequestException('Only OPEN folios can be cancelled');
    if (folio._count.charges > 0) throw new BadRequestException('Cannot cancel a folio with posted charges; check it out instead.');

    return this.prisma.guestFolio.update({
      where: { id: folioId },
      data: { status: 'CANCELLED' },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private fullInclude() {
    return {
      booking: {
        select: {
          id: true,
          bookingNumber: true,
          expectedCheckIn: true,
          expectedCheckOut: true,
          actualCheckIn: true,
          actualCheckOut: true,
          nights: true,
          ratePerNight: true,
          status: true,
          room: { select: { id: true, roomCode: true, roomType: true } },
        },
      },
      guest: { select: { id: true, guestCode: true, fullName: true, phone: true, email: true } },
      charges: { orderBy: { postedAt: Prisma.SortOrder.asc } },
      closedBy: { select: { id: true, fullName: true } },
    } as const;
  }

}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
