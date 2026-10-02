import { BadRequestException } from '@nestjs/common';
import { PartyExistsService } from './party-exists.service';

function makePrisma(found: { supplier?: boolean; customer?: boolean } = {}) {
  return {
    supplier: { findFirst: jest.fn().mockResolvedValue(found.supplier ? { id: 'sup-1' } : null) },
    customer: { findFirst: jest.fn().mockResolvedValue(found.customer ? { id: 'cus-1' } : null) },
  } as any;
}

describe('PartyExistsService', () => {
  it('maps loose entity type strings onto supplier / customer and ignores the rest', () => {
    expect(PartyExistsService.partyKind('SUPPLIER')).toBe('supplier');
    expect(PartyExistsService.partyKind('supplier')).toBe('supplier');
    expect(PartyExistsService.partyKind(' Customer ')).toBe('customer');
    expect(PartyExistsService.partyKind('TENANT')).toBeNull();
    expect(PartyExistsService.partyKind('Receivable')).toBeNull();
    expect(PartyExistsService.partyKind(undefined)).toBeNull();
  });

  it('passes non-party entity types through without touching the database', async () => {
    const prisma = makePrisma();
    const service = new PartyExistsService(prisma);
    await expect(service.assertParty('TENANT', 'ten-1', 'company-A')).resolves.toBeUndefined();
    await expect(service.assertParty(undefined, undefined, 'company-A')).resolves.toBeUndefined();
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('accepts a live supplier in the same company and scopes the lookup to that company', async () => {
    const prisma = makePrisma({ supplier: true });
    const service = new PartyExistsService(prisma);
    await expect(service.assertParty('SUPPLIER', 'sup-1', 'company-A')).resolves.toBeUndefined();
    expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
      where: { id: 'sup-1', deletedAt: null, companyId: 'company-A' },
      select: { id: true },
    });
  });

  it('refuses a supplier that is missing, soft-deleted or in another company', async () => {
    const service = new PartyExistsService(makePrisma());
    await expect(service.assertParty('SUPPLIER', 'sup-x', 'company-A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a party reference with no id', async () => {
    const prisma = makePrisma({ customer: true });
    const service = new PartyExistsService(prisma);
    await expect(service.assertParty('CUSTOMER', '  ', 'company-A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('requires only existence for group-level rows with no company', async () => {
    const prisma = makePrisma({ customer: true });
    const service = new PartyExistsService(prisma);
    await expect(service.assertParty('CUSTOMER', 'cus-1', null)).resolves.toBeUndefined();
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'cus-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('runs inside a caller-supplied transaction client when one is given', async () => {
    const prisma = makePrisma();
    const tx = makePrisma({ supplier: true });
    const service = new PartyExistsService(prisma);
    await expect(
      service.assertParty('SUPPLIER', 'sup-1', 'company-A', tx),
    ).resolves.toBeUndefined();
    expect(tx.supplier.findFirst).toHaveBeenCalled();
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });
});
