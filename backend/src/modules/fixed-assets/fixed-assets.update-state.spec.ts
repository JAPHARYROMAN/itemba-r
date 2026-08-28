import { BadRequestException } from '@nestjs/common';
import { FixedAssetStatus } from '@prisma/client';
import { FixedAssetsService } from './fixed-assets.service';

const USER = { id: 'user-1' } as any;
const ASSET = {
  id: 'asset-1',
  assetCode: 'FA-1',
  companyId: 'company-1',
  status: FixedAssetStatus.ACTIVE,
  collateralStatus: null,
} as any;

function harness(currentStatus: FixedAssetStatus = FixedAssetStatus.ACTIVE) {
  const current = { ...ASSET, status: currentStatus };
  const updated = { ...current, name: 'Updated asset' };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ASSET.id }]),
    fixedAsset: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(updated),
    },
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
  const service = new FixedAssetsService(prisma, audit, companyScope, {} as any, {} as any);
  jest.spyOn(service, 'findOne').mockResolvedValue(ASSET);
  return { audit, service, tx, updated };
}

describe('FixedAssetsService terminal-state update boundary', () => {
  it('locks and re-reads a live asset before updating and strictly auditing it', async () => {
    const { audit, service, tx, updated } = harness();

    await expect(service.update(ASSET.id, { name: 'Updated asset' }, USER)).resolves.toBe(updated);

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.fixedAsset.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.fixedAsset.update.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('rejects an update that observes a terminal state after its initial snapshot', async () => {
    const { audit, service, tx } = harness(FixedAssetStatus.DISPOSED);

    await expect(service.update(ASSET.id, { name: 'Late edit' }, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.fixedAsset.update).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('requires the governed disposal action for a requested terminal transition', async () => {
    const { service, tx } = harness();

    await expect(
      service.update(ASSET.id, { status: FixedAssetStatus.DISPOSED }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.fixedAsset.update).not.toHaveBeenCalled();
  });

  it('fails the update transaction when its mandatory audit append fails', async () => {
    const { audit, service } = harness();
    const failure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.update(ASSET.id, { name: 'Updated asset' }, USER)).rejects.toBe(failure);
  });
});
