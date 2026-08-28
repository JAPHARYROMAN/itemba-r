import { BadRequestException } from '@nestjs/common';
import { FixedAssetStatus, Prisma } from '@prisma/client';
import { FixedAssetsService } from './fixed-assets.service';

const USER = { id: 'group-user', roleScopes: ['GROUP'] } as any;
const ASSET = {
  id: 'asset-1',
  assetCode: 'FA-1',
  name: 'Evidence asset',
  companyId: 'company-1',
  divisionId: null,
  branchId: null,
  status: FixedAssetStatus.ACTIVE,
  acquisitionCost: new Prisma.Decimal(100),
} as any;

function harness() {
  const updated = {
    ...ASSET,
    status: FixedAssetStatus.DISPOSED,
    currentBookValue: new Prisma.Decimal(0),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ASSET.id }]),
    fixedAsset: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValueOnce(ASSET).mockResolvedValueOnce(updated),
    },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  } as any;
  const audit = {
    log: jest.fn(),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const companyScope = {
    assertGroupScoped: jest.fn(),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new FixedAssetsService(prisma, audit, companyScope, {} as any, {} as any);
  jest.spyOn(service, 'findOne').mockResolvedValue(ASSET);
  return { audit, prisma, service, tx, updated };
}

describe('FixedAssetsService disposal audit atomicity', () => {
  it('strictly appends the disposal audit before the financial transaction commits', async () => {
    const { audit, service, tx, updated } = harness();

    await expect(
      service.dispose(
        ASSET.id,
        {
          disposalDate: '2031-07-01T00:00:00.000Z',
          disposalStatus: FixedAssetStatus.DISPOSED,
          disposalValue: '25.50',
        },
        USER,
      ),
    ).resolves.toBe(updated);

    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'fixed_asset.dispose',
        entityId: ASSET.id,
        companyId: ASSET.companyId,
        newValue: expect.objectContaining({
          status: FixedAssetStatus.DISPOSED,
          disposalValue: '25.5',
          journalEntryId: null,
        }),
      }),
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.fixedAsset.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.fixedAsset.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fixed_asset.dispose' }),
    );
  });

  it('fails the disposal transaction when its mandatory audit append fails', async () => {
    const { audit, service } = harness();
    const failure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(
      service.dispose(
        ASSET.id,
        {
          disposalDate: '2031-07-01T00:00:00.000Z',
          disposalStatus: FixedAssetStatus.DISPOSED,
          disposalValue: '25.50',
        },
        USER,
      ),
    ).rejects.toBe(failure);
  });

  it('rejects a terminal state committed after the authorization snapshot', async () => {
    const { audit, service, tx } = harness();
    tx.fixedAsset.findFirst.mockReset().mockResolvedValueOnce({
      ...ASSET,
      status: FixedAssetStatus.DISPOSED,
    });

    await expect(
      service.dispose(
        ASSET.id,
        {
          disposalDate: '2031-07-01T00:00:00.000Z',
          disposalStatus: FixedAssetStatus.DISPOSED,
          disposalValue: '25.50',
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.fixedAsset.updateMany).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });
});
