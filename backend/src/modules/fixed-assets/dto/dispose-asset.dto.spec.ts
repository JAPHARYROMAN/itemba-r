import { FixedAssetStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DisposeAssetDto } from './dispose-asset.dto';

const validBody = {
  disposalStatus: FixedAssetStatus.SOLD,
  disposalDate: '2026-08-26',
};

describe('DisposeAssetDto', () => {
  it.each([
    FixedAssetStatus.DISPOSED,
    FixedAssetStatus.SOLD,
    FixedAssetStatus.WRITTEN_OFF,
    FixedAssetStatus.LOST,
  ])('accepts the terminal disposal status %s', async (disposalStatus) => {
    const dto = plainToInstance(DisposeAssetDto, { ...validBody, disposalStatus });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    FixedAssetStatus.ACTIVE,
    FixedAssetStatus.UNDER_MAINTENANCE,
    FixedAssetStatus.TRANSFERRED,
  ])('rejects the non-disposal status %s', async (disposalStatus) => {
    const dto = plainToInstance(DisposeAssetDto, { ...validBody, disposalStatus });

    const errors = await validate(dto);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'disposalStatus',
          constraints: expect.objectContaining({ isIn: expect.any(String) }),
        }),
      ]),
    );
  });
});
