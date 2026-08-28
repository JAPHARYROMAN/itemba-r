import { Controller, Get, HttpCode, HttpStatus, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  DIRECT_MTLS_DEVICE_KEY,
  DirectMtlsDevice,
} from '../decorators/direct-mtls-device.decorator';
import { MsaidiziAuditSignerController } from '../../modules/msaidizi-audit-signer/msaidizi-audit-signer.controller';
import {
  MsaidiziDeviceChannelController,
  MsaidiziDevicesController,
} from '../../modules/msaidizi-devices/msaidizi-devices.controller';
import {
  MsaidiziRecoveryController,
  MsaidiziRecoverySupervisorChannelController,
} from '../../modules/msaidizi-recovery/msaidizi-recovery.controller';
import {
  MsaidiziUpdatesController,
  MsaidiziUpdateSupervisorChannelController,
  MsaidiziUpdateVerifierController,
} from '../../modules/msaidizi-updates/msaidizi-updates.controller';
import { TransformInterceptor } from './transform.interceptor';

const wireResponses = {
  updatePoll: {
    deploymentId: '11111111-1111-4111-8111-111111111111',
    deliveryLeaseId: '22222222-2222-4222-8222-222222222222',
    manifestJson: '{"schemaVersion":2}',
    manifestSha256: 'a'.repeat(64),
    signature: 'signature',
    signingKeyId: 'update-key-1',
  },
  updateAck: { accepted: true, replay: false },
  updateProgress: { accepted: true },
  updateResult: { accepted: true, replay: false, status: 'SUCCEEDED' },
  recoveryPoll: {
    recoveryId: '33333333-3333-4333-8333-333333333333',
    manifestJson: '{"schemaVersion":2}',
    manifestSha256: 'b'.repeat(64),
    signature: 'signature',
    signingKeyId: 'recovery-key-1',
  },
  recoveryResult: { accepted: true, replay: false, status: 'ROLLED_BACK' },
  auditSegment: {
    events: [{ cursor: '1', eventHash: 'c'.repeat(64) }],
    nextCursor: '1',
    headHash: 'c'.repeat(64),
  },
  auditCheckpoint: {
    accepted: true,
    replay: false,
    cursor: '1',
    manifestSha256: 'd'.repeat(64),
  },
  pairing: {
    deviceId: '44444444-4444-4444-8444-444444444444',
    status: 'ACTIVE',
  },
  companionPoll: {
    commands: [{ kind: 'ping', serverTime: '2026-08-27T09:00:00.000Z' }],
  },
  companionFenceAck: {
    accepted: true,
    replay: false,
    status: 'FAILED',
    taskStatus: 'NEEDS_ATTENTION',
  },
} as const;

@DirectMtlsDevice()
@Controller('wire/direct')
class DirectWireFixtureController {
  @Post('update/poll')
  @HttpCode(HttpStatus.OK)
  updatePoll() {
    return wireResponses.updatePoll;
  }

  @Post('update/ack')
  @HttpCode(HttpStatus.OK)
  updateAck() {
    return wireResponses.updateAck;
  }

  @Post('update/progress')
  @HttpCode(HttpStatus.OK)
  updateProgress() {
    return wireResponses.updateProgress;
  }

  @Post('update/result')
  @HttpCode(HttpStatus.OK)
  updateResult() {
    return wireResponses.updateResult;
  }

  @Post('recovery/poll')
  @HttpCode(HttpStatus.OK)
  recoveryPoll() {
    return wireResponses.recoveryPoll;
  }

  @Post('recovery/result')
  @HttpCode(HttpStatus.OK)
  recoveryResult() {
    return wireResponses.recoveryResult;
  }

  @Post('audit/segment')
  @HttpCode(HttpStatus.OK)
  auditSegment() {
    return wireResponses.auditSegment;
  }

  @Post('audit/checkpoint')
  @HttpCode(HttpStatus.OK)
  auditCheckpoint() {
    return wireResponses.auditCheckpoint;
  }

  @Post('device/pairing')
  pairing() {
    return wireResponses.pairing;
  }

  @Post('device/poll')
  @HttpCode(HttpStatus.OK)
  companionPoll() {
    return wireResponses.companionPoll;
  }

  @Post('device/action-fenced')
  @HttpCode(HttpStatus.OK)
  companionFenceAck() {
    return wireResponses.companionFenceAck;
  }
}

@Controller('wire/ordinary')
class OrdinaryWireFixtureController {
  @Get()
  get() {
    return { id: 'human-api-response' };
  }
}

describe('direct mTLS HTTP response contracts', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DirectWireFixtureController, OrdinaryWireFixtureController],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['update poll', '/wire/direct/update/poll', 200, wireResponses.updatePoll],
    ['update ACK', '/wire/direct/update/ack', 200, wireResponses.updateAck],
    ['update progress', '/wire/direct/update/progress', 200, wireResponses.updateProgress],
    ['update result', '/wire/direct/update/result', 200, wireResponses.updateResult],
    ['recovery poll', '/wire/direct/recovery/poll', 200, wireResponses.recoveryPoll],
    ['recovery result', '/wire/direct/recovery/result', 200, wireResponses.recoveryResult],
    ['audit signer segment', '/wire/direct/audit/segment', 200, wireResponses.auditSegment],
    [
      'audit signer checkpoint',
      '/wire/direct/audit/checkpoint',
      200,
      wireResponses.auditCheckpoint,
    ],
    ['companion pairing', '/wire/direct/device/pairing', 201, wireResponses.pairing],
    ['companion poll', '/wire/direct/device/poll', 200, wireResponses.companionPoll],
    [
      'companion action-fenced receipt',
      '/wire/direct/device/action-fenced',
      200,
      wireResponses.companionFenceAck,
    ],
  ])('keeps the %s DTO at the JSON root', async (_name, path, status, expected) => {
    const response = await request(app.getHttpServer()).post(path).expect(status);

    expect(response.body).toEqual(expected);
    expect(response.body).not.toHaveProperty('success');
    expect(response.body).not.toHaveProperty('data');
    expect(response.body).not.toHaveProperty('timestamp');
  });

  it('keeps the production envelope for an ordinary API controller', async () => {
    const response = await request(app.getHttpServer()).get('/wire/ordinary').expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { id: 'human-api-response' },
      timestamp: expect.any(String),
    });
  });

  it('marks every deployed machine-wire controller, and no human oversight controller, exact', () => {
    for (const controller of [
      MsaidiziDeviceChannelController,
      MsaidiziUpdateVerifierController,
      MsaidiziUpdateSupervisorChannelController,
      MsaidiziRecoverySupervisorChannelController,
      MsaidiziAuditSignerController,
    ]) {
      expect(Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, controller)).toBe(true);
    }

    for (const controller of [
      MsaidiziDevicesController,
      MsaidiziUpdatesController,
      MsaidiziRecoveryController,
    ]) {
      expect(Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, controller)).not.toBe(true);
    }
  });
});
