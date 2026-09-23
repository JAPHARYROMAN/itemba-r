import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { UnitsService } from '../units/units.service';
import { UnitsController } from '../units/units.controller';
import {
  PERMISSIONS_KEY,
  ANY_PERMISSIONS_KEY,
} from '../../common/decorators/require-permissions.decorator';
const user = { id: 'operator' } as never;
describe('Inventory definition source reads', () => {
  it('limits a family detail read to accessible companies and excludes deleted records', async () => {
    const record = {
      id: 'family',
      companyId: 'company',
      categoryId: 'category',
      defaultSellingPrice: '100',
      updatedAt: new Date(),
    };
    const findFirst = jest.fn().mockResolvedValue(record),
      companyWhereFor = jest.fn().mockResolvedValue({ companyId: { in: ['company'] } });
    const service = new ProductsService(
      { productFamily: { findFirst } } as never,
      {} as never,
      { companyWhereFor } as never,
      {} as never,
      {} as never,
    );
    const controller = new ProductsController(service);
    await expect(controller.findOneFamily('family', user)).resolves.toBe(record);
    expect(companyWhereFor).toHaveBeenCalledWith(user);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'family', deletedAt: null, companyId: { in: ['company'] } },
      }),
    );
    findFirst.mockResolvedValue(null);
    await expect(controller.findOneFamily('foreign-or-deleted', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, ProductsController.prototype.findOneFamily),
    ).toEqual(['products.view', 'operations.dashboard.view']);
  });
  it('does not read families when company scope resolution fails', async () => {
    const findFirst = jest.fn();
    const service = new ProductsService(
      { productFamily: { findFirst } } as never,
      {} as never,
      { companyWhereFor: jest.fn().mockRejectedValue(new ForbiddenException()) } as never,
      {} as never,
      {} as never,
    );
    await expect(service.findOneFamily('family', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('uses read access for conversion details and rejects inaccessible or missing records', async () => {
    const record = {
      id: 'conversion',
      companyId: 'company',
      fromUnit: { name: 'Crate', symbol: 'crt' },
      toUnit: { name: 'Piece', symbol: 'pc' },
      conversionFactor: '12',
    };
    const findFirst = jest.fn().mockResolvedValue(record),
      assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
    const controller = new UnitsController(
      new UnitsService(
        { unitConversion: { findFirst } } as never,
        {} as never,
        { assertCanAccessCompany } as never,
      ),
    );
    await expect(controller.findOneConversion('conversion', user)).resolves.toBe(record);
    expect(assertCanAccessCompany).toHaveBeenCalledWith(user, 'company', AccessLevel.READ);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversion', deletedAt: null },
        include: {
          fromUnit: { select: { id: true, name: true, symbol: true } },
          toUnit: { select: { id: true, name: true, symbol: true } },
        },
      }),
    );
    assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    await expect(controller.findOneConversion('conversion', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    findFirst.mockResolvedValue(null);
    await expect(controller.findOneConversion('missing', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, UnitsController.prototype.findOneConversion),
    ).toEqual(['units.view']);
  });
});
