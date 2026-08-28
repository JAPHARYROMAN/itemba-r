import { HttpStatus, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MsaidiziDeviceStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { directMtlsPeer } from './direct-mtls-peer';
import { ActionFencedReceiptDto, CapabilityManifestSnapshotDto } from './dto/msaidizi-device.dto';
import { MsaidiziDeviceChannelController } from './msaidizi-devices.controller';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

jest.mock('./direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const deviceId = 'device-1';
const certificateSha256 = 'A'.repeat(64);
const publicKey = 'test-device-public-key';
const publicKeySha256 = createHash('sha256').update(publicKey).digest('hex').toUpperCase();
const compactToken = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`;

function receipt(overrides: Partial<ActionFencedReceiptDto> = {}): ActionFencedReceiptDto {
  return {
    fenceId: '11111111-1111-4111-8111-111111111111',
    deviceId,
    actionId: 'action-1',
    taskId: 'task-1',
    stepId: 'step-1',
    oldLeaseId: 'lease-action-1',
    oldFencingToken: '7',
    oldActionTokenSha256: 'B'.repeat(64),
    fenceDispatchCount: 1,
    compactToken,
    fenceTokenSha256: createHash('sha256').update(compactToken).digest('hex').toUpperCase(),
    outcome: 'NoPrepared',
    journalPreviousSequence: 11,
    journalPreviousHash: 'C'.repeat(64),
    tombstoneSequence: 12,
    tombstonePreviousHash: 'C'.repeat(64),
    tombstoneEntryHash: 'D'.repeat(64),
    recordedAt: '2026-08-27T09:00:00.000Z',
    ...overrides,
  };
}

interface FenceSettlementSeam {
  settleActionFenceReceipt(
    dto: ActionFencedReceiptDto,
    authenticatedDeviceId: string,
  ): Promise<Record<string, unknown>>;
}

function serviceHarness() {
  const deviceFindUnique = jest.fn().mockResolvedValue({
    id: deviceId,
    status: MsaidiziDeviceStatus.ACTIVE,
    certificateThumbprint: certificateSha256,
    publicKey,
  });
  const service = new MsaidiziDevicesService(
    { msaidiziDevice: { findUnique: deviceFindUnique } } as never,
    { channelEnabled: true } as never,
    {} as never,
    {} as never,
  );
  const settleActionFenceReceipt = jest.fn().mockResolvedValue({
    accepted: true,
    replay: false,
    status: 'FAILED',
    taskStatus: 'NEEDS_ATTENTION',
  });
  (service as unknown as FenceSettlementSeam).settleActionFenceReceipt = settleActionFenceReceipt;
  return { deviceFindUnique, service, settleActionFenceReceipt };
}

describe('protocol-v3 action-fenced channel entry point', () => {
  const request = {} as Request;

  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue({
      certificateSha256,
      publicKeyPem: publicKey,
      publicKeySha256,
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      chainAuthorized: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('binds the receipt to the exact authenticated device before settlement', async () => {
    const dto = receipt();
    const { deviceFindUnique, service, settleActionFenceReceipt } = serviceHarness();

    await expect(service.actionFenced(dto, request)).resolves.toEqual({
      accepted: true,
      replay: false,
      status: 'FAILED',
      taskStatus: 'NEEDS_ATTENTION',
    });

    expect(directMtlsPeer).toHaveBeenCalledWith(request);
    expect(deviceFindUnique).toHaveBeenCalledWith({
      where: { certificateThumbprint: certificateSha256 },
    });
    expect(settleActionFenceReceipt).toHaveBeenCalledWith(dto, deviceId);
  });

  it('rejects a receipt that names a device other than the direct TLS peer', async () => {
    const { service, settleActionFenceReceipt } = serviceHarness();

    await expect(
      service.actionFenced(receipt({ deviceId: 'device-2' }), request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(settleActionFenceReceipt).not.toHaveBeenCalled();
  });

  it('publishes an exact POST 200 controller route and forwards its DTO untouched', async () => {
    const dto = receipt();
    const request = {} as Request;
    const actionFenced = jest.fn().mockResolvedValue({ accepted: true });
    const controller = new MsaidiziDeviceChannelController({ actionFenced } as never, {} as never);
    const handler = MsaidiziDeviceChannelController.prototype.actionFenced;

    await expect(controller.actionFenced(dto, request)).resolves.toEqual({ accepted: true });
    expect(actionFenced).toHaveBeenCalledWith(dto, request);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('channel/action-fenced');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
  });

  it('accepts only the closed receipt shape and protocol-v3 manifest bound', () => {
    expect(validateSync(plainToInstance(ActionFencedReceiptDto, receipt()))).toHaveLength(0);

    for (const invalid of [
      receipt({ outcome: 'Prepared' as never }),
      receipt({ fenceDispatchCount: 4 }),
      receipt({ fenceTokenSha256: 'not-a-digest' }),
      receipt({ tombstoneSequence: 0 }),
    ]) {
      expect(validateSync(plainToInstance(ActionFencedReceiptDto, invalid)).length).toBeGreaterThan(
        0,
      );
    }

    const manifest = {
      deviceId,
      commandProtocolVersion: 3,
      manifestSha256: 'E'.repeat(64),
      capabilities: [],
      generatedAt: '2026-08-27T09:00:00.000Z',
    };
    expect(validateSync(plainToInstance(CapabilityManifestSnapshotDto, manifest))).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(CapabilityManifestSnapshotDto, {
          ...manifest,
          commandProtocolVersion: 4,
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
