import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PartyKind = 'supplier' | 'customer';
type Db = PrismaService | Prisma.TransactionClient;

/** Party linkage (Phase 3): the stored party columns a polymorphic row derives. */
export interface PartyRef {
  partyType: 'NONE' | 'SUPPLIER' | 'CUSTOMER';
  supplierId: string | null;
  customerId: string | null;
}
const NO_PARTY: PartyRef = { partyType: 'NONE', supplierId: null, customerId: null };
type PartyLookup = (db: Db, id: string) => Promise<{ kind: PartyKind; id: string | null }>;
/**
 * Which document types carry which party, by their own column. Keys are entity types with
 * case, spaces, hyphens and underscores removed, so "Purchase Order", "PURCHASE_ORDER" and
 * "PurchaseOrder" all resolve. A type not listed, or a document without the party, derives
 * NONE: a missing party is a finding, never an error.
 */
const ENTITY_PARTY: Record<string, PartyLookup> = {
  SUPPLIER: async (_db, id) => ({ kind: 'supplier', id }),
  CUSTOMER: async (_db, id) => ({ kind: 'customer', id }),
  PAYABLE: async (db, id) => ({
    kind: 'supplier',
    id:
      (await db.payable.findFirst({ where: { id }, select: { supplierId: true } }))?.supplierId ??
      null,
  }),
  SUPPLIERINVOICE: async (db, id) => ({
    kind: 'supplier',
    id:
      (await db.supplierInvoice.findFirst({ where: { id }, select: { supplierId: true } }))
        ?.supplierId ?? null,
  }),
  SUPPLIERPAYMENT: async (db, id) => ({
    kind: 'supplier',
    id:
      (await db.supplierPayment.findFirst({ where: { id }, select: { supplierId: true } }))
        ?.supplierId ?? null,
  }),
  PURCHASEORDER: async (db, id) => ({
    kind: 'supplier',
    id:
      (await db.purchaseOrder.findFirst({ where: { id }, select: { supplierId: true } }))
        ?.supplierId ?? null,
  }),
  EXPENSE: async (db, id) => ({
    kind: 'supplier',
    id:
      (await db.expense.findFirst({ where: { id }, select: { supplierId: true } }))?.supplierId ??
      null,
  }),
  RECEIVABLE: async (db, id) => ({
    kind: 'customer',
    id:
      (await db.receivable.findFirst({ where: { id }, select: { customerId: true } }))
        ?.customerId ?? null,
  }),
  CUSTOMERPAYMENT: async (db, id) => ({
    kind: 'customer',
    id:
      (await db.customerPayment.findFirst({ where: { id }, select: { customerId: true } }))
        ?.customerId ?? null,
  }),
  SALESORDER: async (db, id) => ({
    kind: 'customer',
    id:
      (await db.salesOrder.findFirst({ where: { id }, select: { customerId: true } }))
        ?.customerId ?? null,
  }),
  CREDITNOTE: async (db, id) => ({
    kind: 'customer',
    id:
      (await db.creditNote.findFirst({ where: { id }, select: { customerId: true } }))
        ?.customerId ?? null,
  }),
  REFUND: async (db, id) => ({
    kind: 'customer',
    id:
      (await db.refund.findFirst({ where: { id }, select: { customerId: true } }))?.customerId ??
      null,
  }),
};

/**
 * Existence check for polymorphic party references (contact persons, communication
 * logs, documents, tasks, approval requests). Those tables store `entityType` +
 * `entityId` with no foreign key, so a typo or a stale id used to be accepted
 * silently. This service refuses a SUPPLIER / CUSTOMER reference whose master does
 * not exist, is soft-deleted, or belongs to another company.
 *
 * It is deliberately narrow: entity types other than supplier / customer pass
 * through untouched, and the check is input validation (400), never authorisation.
 */
@Injectable()
export class PartyExistsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Maps the loose entity-type strings used across modules onto a party kind. */
  static partyKind(entityType: string | null | undefined): PartyKind | null {
    const value = entityType?.trim().toUpperCase();
    if (value === 'SUPPLIER') return 'supplier';
    if (value === 'CUSTOMER') return 'customer';
    return null;
  }

  /**
   * Asserts that a supplier or customer reference points at a live master. When
   * `companyId` is given the master must belong to that company; when it is null or
   * undefined (group-level rows) only existence is required. No-op for other kinds.
   */
  async assertParty(
    entityType: string | null | undefined,
    entityId: string | null | undefined,
    companyId: string | null | undefined,
    db: Db = this.prisma,
  ): Promise<void> {
    const kind = PartyExistsService.partyKind(entityType);
    if (!kind) return;
    if (!entityId?.trim())
      throw new BadRequestException(`Choose the ${kind} this record belongs to.`);
    if (kind === 'supplier') await this.assertSupplier(companyId, entityId, db);
    else await this.assertCustomer(companyId, entityId, db);
  }

  /** The entity-type key {@link ENTITY_PARTY} is looked up by. */
  static entityKey(entityType: string | null | undefined): string {
    return (entityType ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  }

  /**
   * Party linkage (Phase 3): the supplier or customer behind a polymorphic reference, read
   * from the referenced document's own party column. NONE for unknown types, blank ids and
   * documents without a party; it never throws for a missing party.
   */
  async partyOfEntity(
    entityType: string | null | undefined,
    entityId: string | null | undefined,
    db: Db = this.prisma,
  ): Promise<PartyRef> {
    const lookup = ENTITY_PARTY[PartyExistsService.entityKey(entityType)];
    const id = entityId?.trim();
    if (!lookup || !id) return NO_PARTY;
    const found = await lookup(db, id);
    if (!found.id) return NO_PARTY;
    return found.kind === 'supplier'
      ? { partyType: 'SUPPLIER', supplierId: found.id, customerId: null }
      : { partyType: 'CUSTOMER', supplierId: null, customerId: found.id };
  }

  async assertSupplier(companyId: string | null | undefined, id: string, db: Db = this.prisma) {
    const row = await db.supplier.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException(
        companyId
          ? 'Supplier not found in this company. Choose an existing supplier.'
          : 'Supplier not found. Choose an existing supplier.',
      );
  }

  async assertCustomer(companyId: string | null | undefined, id: string, db: Db = this.prisma) {
    const row = await db.customer.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException(
        companyId
          ? 'Customer not found in this company. Choose an existing customer.'
          : 'Customer not found. Choose an existing customer.',
      );
  }
}
