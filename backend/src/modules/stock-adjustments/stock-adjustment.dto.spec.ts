import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

describe('CreateStockAdjustmentDto', () => {
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
