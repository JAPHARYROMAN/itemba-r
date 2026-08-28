import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { resolve } from 'node:path';
import { AGENT_EXCLUDED_KEY } from '../../common/decorators/agent-excluded.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import {
  capabilityConsent,
  capabilityDataClass,
  capabilityEffect,
  capabilityRecovery,
  jsonSha256,
  pairingCodeDigest,
  pairingMarker,
  stableJson,
  validateCapabilityManifest,
} from './device-security';
import { directMtlsPeer } from './direct-mtls-peer';
import { ActionResultDto } from './dto/msaidizi-device.dto';
import {
  MsaidiziDeviceChannelController,
  MsaidiziDevicesController,
} from './msaidizi-devices.controller';
import { envValidate } from '../../config/env.validation';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

const strictSchema = { type: 'object', properties: {}, additionalProperties: false };

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'device-1',
    manifestSha256: 'A'.repeat(64),
    generatedAt: '2026-08-25T10:00:00.000Z',
    capabilities: [
      {
        id: 'system.status.read',
        version: '1.0.0',
        displayName: 'Status',
        description: 'Reads a safe status snapshot.',
        dataClass: 1,
        effect: 0,
        consent: 0,
        recovery: 0,
        requiredPrivilege: 0,
        idempotency: 0,
        supportedOperatingSystems: ['windows-11'],
        argumentsSchema: strictSchema,
        resultSchema: strictSchema,
        provenanceOutputs: ['system-status'],
        touchesTrustedRoot: false,
        ...overrides,
      },
    ],
  } as never;
}

describe('device security invariants', () => {
  it('uses deterministic UTF-8 JSON hashing, not the ERP action digest encoding', () => {
    const json = stableJson({ z: 1, a: { y: true, x: 'value' } });
    expect(json).toBe('{"a":{"x":"value","y":true},"z":1}');
    expect(jsonSha256(JSON.parse(json))).toMatch(/^[0-9A-F]{64}$/);
  });

  it('stores only a peppered pairing digest marker', () => {
    const code = 'ABCD-EF12-3456';
    const digest = pairingCodeDigest('p'.repeat(64), 'device-1', code);
    const marker = pairingMarker(digest);
    expect(marker).toMatch(/^PAIRING_DIGEST_V1:[0-9a-f]{64}$/);
    expect(marker).not.toContain(code);
  });

  it('accepts numeric C# enums but rejects trusted-root and loose-schema capabilities', () => {
    expect(() => validateCapabilityManifest(manifest())).not.toThrow();
    expect(capabilityEffect(0)).toBe('READ');
    expect(() => validateCapabilityManifest(manifest({ id: 'supervisor.kill-switch' }))).toThrow(
      BadRequestException,
    );
    expect(() => validateCapabilityManifest(manifest({ id: 'powershell.execute' }))).toThrow(
      BadRequestException,
    );
    expect(() => validateCapabilityManifest(manifest({ id: 'audio.microphone.capture' }))).toThrow(
      'Raw sensor capture capabilities cannot cross the governed device boundary',
    );
    expect(() =>
      validateCapabilityManifest(manifest({ id: 'filesystem.file.read', version: '1.0.0' })),
    ).toThrow('REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY');
    expect(() =>
      validateCapabilityManifest(
        manifest({ id: 'filesystem.file.disclose.ephemeral', version: '1.0.0' }),
      ),
    ).toThrow('REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY');
    expect(() =>
      validateCapabilityManifest(manifest({ argumentsSchema: { type: 'object' } })),
    ).toThrow(BadRequestException);
  });

  it('accepts the governed privileged-command descriptor with exact Windows enum semantics', () => {
    const privileged = manifest({
      id: 'command.privileged.execute',
      version: '1.0.0',
      dataClass: 4,
      effect: 6,
      consent: 3,
      recovery: 5,
      requiredPrivilege: 2,
      idempotency: 1,
      supportedOperatingSystems: ['windows-11-x64'],
      provenanceOutputs: ['privileged-command-output'],
    });

    expect(() => validateCapabilityManifest(privileged)).not.toThrow();
    expect(capabilityDataClass(4)).toBe('Credential');
    expect(capabilityEffect(6)).toBe('IRREVERSIBLE');
    expect(capabilityConsent(3)).toBe('OneShotApproval');
    expect(capabilityRecovery(5)).toBe('Irreversible');
  });

  it('never accepts a proxy certificate header in place of a direct TLS socket', () => {
    const request = {
      headers: { 'x-forwarded-client-cert': 'trusted-looking-but-untrusted' },
      socket: {},
    } as unknown as Request;
    expect(() => directMtlsPeer(request)).toThrow(UnauthorizedException);
  });

  it('keeps human administration permission-gated and excludes both controllers from tools', () => {
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, MsaidiziDevicesController)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziDevicesController)).toEqual([
      'msaidizi.use',
      'msaidizi.oversight',
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MsaidiziDevicesController)).not.toBe(true);
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, MsaidiziDeviceChannelController)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MsaidiziDeviceChannelController)).toBe(true);
  });

  it('accepts the companion default numeric outcome and nullable result fields', () => {
    const dto = plainToInstance(ActionResultDto, {
      actionId: 'action-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionTokenSha256: 'a'.repeat(64),
      leaseId: 'lease-1',
      fencingToken: '7',
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      outcome: 0,
      outputJson: null,
      outputSha256: null,
      mutationCommitted: false,
      outcomeUncertain: false,
      isIdempotentReplay: false,
      errorCode: null,
      provenance: [],
      journalPrepareSequence: null,
      journalPrepareEntryHash: null,
      journalPreparePreviousHash: null,
      journalRecoveryPreparedSequence: null,
      journalRecoveryPreparedEntryHash: null,
      journalRecoveryPreparedPreviousHash: null,
      journalSequence: null,
      journalEntryHash: null,
      journalPreviousHash: null,
      preStateSha256: null,
      recoveryProvenanceSha256: null,
      recoveryHandleSha256: null,
      localBytesRead: 0,
      localBytesWritten: 0,
      externalEgressBytes: 0,
      brokerExternalEgressBytes: 0,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 65_536,
      uncertainExternalEgressBytes: 0,
    });
    expect(validateSync(dto)).toEqual([]);
  });

  it('refuses device activation unless direct mTLS and distinct external keys are configured', () => {
    const base = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/itemba',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
      MSAIDIZI_DEVICE_LEASE_PEPPER: 'l'.repeat(64),
      MSAIDIZI_ACTION_SIGNING_KEY_PATH: resolve('action-signing.pem'),
      MSAIDIZI_ACTION_SIGNING_KEY_ID: 'test-action-key',
    };
    expect(() => envValidate(base)).toThrow(/DIRECT_MTLS_ENABLED/);
    expect(() =>
      envValidate({
        ...base,
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('server-key.pem'),
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('server-cert.pem'),
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('client-ca.pem'),
      }),
    ).not.toThrow();
  });

  it('selects only queued actions from a stopping task for offline central cancellation', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'action-queued' }]);
    const settle = jest.fn().mockResolvedValue(undefined);
    const service = new MsaidiziDevicesService(
      { msaidiziHostAction: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (
      service as unknown as {
        settleInterruptedAction: typeof settle;
      }
    ).settleInterruptedAction = settle;

    await service.cancelUndispatchedTaskActions('task-cancelling');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        taskId: 'task-cancelling',
        status: 'QUEUED',
        task: { status: { in: ['CANCELLING', 'CANCELLED'] } },
      },
      select: { id: true },
    });
    expect(settle).toHaveBeenCalledWith(
      'action-queued',
      'CANCELLED_BEFORE_HOST_DISPATCH',
      false,
      true,
    );
  });
});
