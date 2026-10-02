import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PartyKind = 'supplier' | 'customer';
type Db = PrismaService | Prisma.TransactionClient;

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
