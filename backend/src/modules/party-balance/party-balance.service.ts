import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  PartyBalance,
  PartyBalanceSummary,
  PartyKind,
  computePartyBalance,
  computePartyBalanceList,
  refreshCachedPartyBalance,
} from './party-balance.helper';

const partySelect = { id: true, companyId: true, creditLimit: true, currentBalance: true } as const;

/**
 * The party balance resolver (party linkage, W5): one place that answers "what does this
 * supplier / customer owe or is owed", per currency, with the ERP, desk and NoteBook
 * breakdown and the credit position. Profiles, Cash Desk, CRM, POS and the credit check
 * read this (or its helper) instead of keeping their own arithmetic.
 */
@Injectable()
export class PartyBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async supplier(user: AuthUser, supplierId: string, asOf?: Date): Promise<PartyBalance> {
    const party = await this.prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: partySelect,
    });
    if (!party) throw new NotFoundException('Supplier not found');
    await this.companyScope.assertCanAccessCompany(user, party.companyId);
    return computePartyBalance(this.prisma, 'supplier', party, asOf);
  }

  async customer(user: AuthUser, customerId: string, asOf?: Date): Promise<PartyBalance> {
    const party = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: partySelect,
    });
    if (!party) throw new NotFoundException('Customer not found');
    await this.companyScope.assertCanAccessCompany(user, party.companyId);
    return computePartyBalance(this.prisma, 'customer', party, asOf);
  }

  /** Every supplier in the company scope with a balance, set-wise (Phase 2 lists). */
  async suppliers(
    user: AuthUser,
    companyId?: string | null,
    asOf?: Date,
  ): Promise<PartyBalanceSummary[]> {
    const where = await this.companyScope.companyWhereFor(user, companyId);
    return computePartyBalanceList(this.prisma, 'supplier', where, asOf);
  }

  /** Every customer in the company scope with a balance, set-wise (Phase 2 lists). */
  async customers(
    user: AuthUser,
    companyId?: string | null,
    asOf?: Date,
  ): Promise<PartyBalanceSummary[]> {
    const where = await this.companyScope.companyWhereFor(user, companyId);
    return computePartyBalanceList(this.prisma, 'customer', where, asOf);
  }

  /** For callers that already hold an access-checked party row (control centres). */
  forParty(
    kind: PartyKind,
    party: {
      id: string;
      companyId: string;
      creditLimit: Prisma.Decimal | number | string;
      currentBalance: Prisma.Decimal | number | string;
    },
    asOf?: Date,
  ): Promise<PartyBalance> {
    return computePartyBalance(this.prisma, kind, party, asOf);
  }

  /** The single writer of the cached party balance. */
  refreshCached(
    tx: Prisma.TransactionClient,
    kind: PartyKind,
    companyId: string,
    partyId?: string | null,
  ): Promise<void> {
    return refreshCachedPartyBalance(tx, kind, companyId, partyId);
  }
}
