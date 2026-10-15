import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { SubmitStockAdjustmentDto } from './dto/submit-stock-adjustment.dto';

describe('CreateStockAdjustmentDto', () => {
  it('accepts the revision and retry key in the closed shortcut payload', async () => {
    const dto = plainToInstance(CreateStockAdjustmentDto, {
      companyId: 'company-1',
      branchId: 'branch-1',
      reason: 'Count',
      idempotencyKey: 'count-attempt',
      lines: [
        { productId: 'product-1', unitId: 'unit-1', countedQuantity: 0, expectedRevision: 0 },
      ],
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });
  it('rejects an empty count and invalid stock revision', async () => {
    for (const lines of [
      [],
      [{ productId: 'product-1', unitId: 'unit-1', countedQuantity: 0, expectedRevision: -1 }],
      [{ productId: 'product-1', unitId: 'unit-1', countedQuantity: 0, expectedRevision: 1.5 }],
    ]) {
      const dto = plainToInstance(CreateStockAdjustmentDto, {
        companyId: 'company-1',
        branchId: 'branch-1',
        reason: 'Count',
        lines,
      });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
  it('keeps submission versions typed and rejects unknown body fields', async () => {
    const valid = plainToInstance(SubmitStockAdjustmentDto, {
      expectedUpdatedAt: '2026-10-13T12:00:00.000Z',
    });
    expect(await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const invalid = plainToInstance(SubmitStockAdjustmentDto, {
      expectedUpdatedAt: 'yesterday',
      status: 'POSTED',
    });
    expect((await validate(invalid, { whitelist: true, forbidNonWhitelisted: true })).length).toBe(
      2,
    );
  });
  it('accepts legacy systemQty/countedQty aliases without non-whitelisted errors', async () => {
    const dto = plainToInstance(
      CreateStockAdjustmentDto,
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        reason: 'Stock count correction',
        lines: [
          {
            productId: 'product-1',
            systemQty: 60,
            countedQty: 30,
            unitId: 'unit-1',
            reason: 'duplicate entry',
          },
        ],
      },
      { enableImplicitConversion: true },
    );

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.lines[0].systemQty).toBe(60);
    expect(dto.lines[0].countedQty).toBe(30);
  });
});
