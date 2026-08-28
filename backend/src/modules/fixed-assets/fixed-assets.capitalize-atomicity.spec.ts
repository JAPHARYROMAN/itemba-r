import { BadRequestException } from '@nestjs/common';
import {
  AssetFinancingStatus,
  AssetOwnershipLevel,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';
import { FixedAssetCapitalizationSource } from './dto/capitalize-fixed-asset.dto';
import { FixedAssetsService } from './fixed-assets.service';

const USER = { id: 'user-1' } as any;
const ASSET = {
  id: 'asset-1',
  assetCode: 'FA-1',
  name: 'Evidence asset',
  ownershipLevel: AssetOwnershipLevel.COMPANY,
  companyId: 'company-1',
  groupId: null,
  divisionId: null,
  branchId: null,
  status: FixedAssetStatus.ACTIVE,
  financingStatus: AssetFinancingStatus.OWNED_OUTRIGHT,
  acquisitionCost: new Prisma.Decimal(100),
  acquisitionDate: new Date('2031-01-01T00:00:00.000Z'),
} as any;

function harness(status: FixedAssetStatus = FixedAssetStatus.ACTIVE) {
  const current = { ...ASSET, status };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ASSET.id }]),
    fixedAsset: { findFirst: jest.fn().mockResolvedValue(current) },
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
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) => ({ id: `account-${role}` })),
  } as any;
  const journalEntry = { id: 'journal-1', journalNumber: 'JE-1' };
  const postingEngine = { postLines: jest.fn().mockResolvedValue(journalEntry) } as any;
  const service = new FixedAssetsService(
    prisma,
    audit,
    companyScope,
    accountResolver,
    postingEngine,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue(ASSET);
  return { audit, current, journalEntry, postingEngine, service, tx };
}

describe('FixedAssetsService capitalization/disposal serialization', () => {
  it('locks the register row, checks current live state, posts, then strictly audits', async () => {
    const { audit, current, journalEntry, postingEngine, service, tx } = harness();

    await expect(
      service.capitalize(ASSET.id, { source: FixedAssetCapitalizationSource.CASH }, USER),
    ).resolves.toEqual({ asset: current, journalEntry });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.journalEntry.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.journalEntry.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      postingEngine.postLines.mock.invocationCallOrder[0],
    );
    expect(postingEngine.postLines.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'fixed_asset.capitalize',
        entityId: ASSET.id,
        companyId: ASSET.companyId,
        metadata: {
          source: FixedAssetCapitalizationSource.CASH,
          amount: '100',
          journalEntryId: journalEntry.id,
        },
      }),
    );
  });

  it.each([FixedAssetStatus.DISPOSED, FixedAssetStatus.SOLD, FixedAssetStatus.WRITTEN_OFF])(
    'refuses to capitalize current terminal state %s after taking the row lock',
    async (status) => {
      const { audit, postingEngine, service, tx } = harness(status);

      await expect(service.capitalize(ASSET.id, {}, USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(postingEngine.postLines).not.toHaveBeenCalled();
      expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
    },
  );

  it('fails the capitalization transaction when its mandatory audit append fails', async () => {
    const { audit, service } = harness();
    const failure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.capitalize(ASSET.id, {}, USER)).rejects.toBe(failure);
  });
});
