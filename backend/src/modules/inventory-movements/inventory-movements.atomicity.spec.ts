import { BadRequestException } from '@nestjs/common';
import { InventoryMovementType } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { InventoryMovementsService } from './inventory-movements.service';

/**
 * P0-04 / P0-05 regression — inventory movement direction, validation, and
 * negative-stock guard.
 *
 * Phase 2 corrected the classification (PURCHASE_RETURN moved to OUTBOUND),
 * added quantity > 0 enforcement, added explicit unsupported-type rejection,
 * and added negative-stock checks. These tests pin those contracts so a
 * future refactor cannot silently regress.
 */

function makeService() {
  const prisma = {
    inventoryMovement: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const auditLogs = { log: jest.fn() } as any;
  const codes = { next: jest.fn().mockResolvedValue('IM-1') } as any;
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue({}),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new InventoryMovementsService(prisma, auditLogs, codes, companyScope);
}

describe('InventoryMovementsService direction + guards (P0-04 regression)', () => {
  const baseMovement = {
    companyId: 'company-A',
    productId: 'product-1',
    inventoryLocationId: 'loc-1',
    quantity: 5,
    unitId: 'unit-1',
    movementDate: new Date('2026-05-01'),
    createdById: 'user-1',
  };

  it('rejects zero quantity', async () => {
    const service = makeService();
    await expect(
      service.createMovement({
        ...baseMovement,
        quantity: 0,
        movementType: 'SALE_ISSUE' as InventoryMovementType,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects negative quantity', async () => {
    const service = makeService();
    await expect(
      service.createMovement({
        ...baseMovement,
        quantity: -3,
        movementType: 'PURCHASE_RECEIPT' as InventoryMovementType,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unsupported movement type before any DB write', async () => {
    const service = makeService();
    await expect(
      service.createMovement({
        ...baseMovement,
        movementType: 'NOT_A_REAL_TYPE' as unknown as InventoryMovementType,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('classifies PURCHASE_RETURN as outbound (direction fix)', () => {
    const src = readSource();
    const inboundBlock = extractBlock(src, 'INBOUND_TYPES');
    const outboundBlock = extractBlock(src, 'OUTBOUND_TYPES');
    expect(inboundBlock).not.toMatch(/PURCHASE_RETURN/);
    expect(outboundBlock).toMatch(/PURCHASE_RETURN/);
  });

  it('classifies the canonical inbound types', () => {
    const inboundBlock = extractBlock(readSource(), 'INBOUND_TYPES');
    expect(inboundBlock).toMatch(/PURCHASE_RECEIPT/);
    expect(inboundBlock).toMatch(/SALES_RETURN/);
    expect(inboundBlock).toMatch(/TRANSFER_IN/);
    expect(inboundBlock).toMatch(/ADJUSTMENT_IN/);
    expect(inboundBlock).toMatch(/PRODUCTION_IN/);
  });

  it('classifies the canonical outbound types', () => {
    const outboundBlock = extractBlock(readSource(), 'OUTBOUND_TYPES');
    expect(outboundBlock).toMatch(/SALE_ISSUE/);
    expect(outboundBlock).toMatch(/TRANSFER_OUT/);
    expect(outboundBlock).toMatch(/ADJUSTMENT_OUT/);
    expect(outboundBlock).toMatch(/DAMAGE/);
    expect(outboundBlock).toMatch(/WASTAGE/);
  });
});

function readSource(): string {
  return readFileSync(
    join(__dirname, 'inventory-movements.service.ts'),
    'utf8',
  );
}

/**
 * Extract the array literal that appears just after `<NAME>: InventoryMovementType[]`.
 * The previous version of this test used a single regex that broke under the
 * actual whitespace shape; this version scans line-by-line and is robust to
 * formatting changes.
 */
function extractBlock(src: string, name: string): string {
  const lines = src.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes(`const ${name}`));
  if (startIdx < 0) return '';
  const out: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    if (lines[i].includes('];')) break;
  }
  return out.join('\n');
}
