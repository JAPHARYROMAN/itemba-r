import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import request from 'supertest';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';
import { MsaidiziEvaluatorMtlsGuard } from './msaidizi-evaluator-mtls.guard';
import { MsaidiziUpdateEvaluationOrchestrator } from './msaidizi-update-evaluation-orchestrator.service';
import { MsaidiziUpdateEvaluationService } from './msaidizi-update-evaluation.service';
import { MsaidiziUpdateVerifierController } from './msaidizi-updates.controller';

jest.mock('../msaidizi-devices/direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

describe('MsaidiziEvaluatorMtlsGuard', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue(peer());
  });

  it('fails before controller processing when no direct TLS peer exists', async () => {
    const { guard } = harness();
    jest.mocked(directMtlsPeer).mockImplementation(() => {
      throw new UnauthorizedException('A direct client TLS certificate is required');
    });

    await expect(guard.canActivate(context())).rejects.toThrow('direct client TLS certificate');
  });

  it('rejects an unauthorized chain and wrong certificate or SPKI pins', async () => {
    const unauthorized = harness();
    jest.mocked(directMtlsPeer).mockReturnValueOnce(peer({ chainAuthorized: false }));
    await expect(unauthorized.guard.canActivate(context())).rejects.toThrow(
      'chain is unauthorized',
    );
    expect(unauthorized.prisma.msaidiziDevice.count).not.toHaveBeenCalled();

    const wrongCertificate = harness({ MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256: 'd'.repeat(64) });
    await expect(wrongCertificate.guard.canActivate(context())).rejects.toThrow(
      'pin does not match',
    );

    const wrongSpki = harness({ MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256: 'e'.repeat(64) });
    await expect(wrongSpki.guard.canActivate(context())).rejects.toThrow('pin does not match');
  });

  it('refuses the ordinary listener and fails closed when the distinct listener is disabled', async () => {
    jest.mocked(directMtlsPeer).mockClear();
    const enabled = harness();
    await expect(enabled.guard.canActivate(context(3001))).rejects.toThrow(
      'only on the dedicated mTLS listener',
    );
    expect(directMtlsPeer).not.toHaveBeenCalled();

    const disabled = harness({ MSAIDIZI_EVALUATOR_MTLS_ENABLED: 'false' });
    await expect(disabled.guard.canActivate(context())).rejects.toThrow(
      'dedicated evaluator mTLS listener is disabled',
    );
  });

  it('rejects reuse of an enrolled device certificate or public key', async () => {
    const reusedCertificate = harness({}, { certificateCount: 1 });
    await expect(reusedCertificate.guard.canActivate(context())).rejects.toThrow(
      'device certificate cannot be an evaluator',
    );

    const reusedKey = harness({}, { devicePublicKeys: [evaluatorPublicKeyPem] });
    await expect(reusedKey.guard.canActivate(context())).rejects.toThrow(
      'device key cannot be an evaluator',
    );
  });

  it('admits only the authorized, pinned, non-device verifier identity', async () => {
    const { guard, prisma } = harness();
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(prisma.msaidiziDevice.count).toHaveBeenCalledWith({
      where: { certificateThumbprint: 'A'.repeat(64) },
    });
  });
});

describe('verifier guard ordering', () => {
  let app: INestApplication;
  const evaluation = {
    ingestTrustedArtifact: jest.fn(),
    submit: jest.fn(),
  };
  const orchestrator = {
    poll: jest.fn(),
    start: jest.fn(),
    heartbeat: jest.fn(),
    generationArtifact: jest.fn(),
  };

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('does not invoke Multer or controller code when the pre-controller guard fails', async () => {
    const before = evaluatorTempFiles();
    const module = await Test.createTestingModule({
      controllers: [MsaidiziUpdateVerifierController],
      providers: [
        { provide: MsaidiziUpdateEvaluationService, useValue: evaluation },
        { provide: MsaidiziUpdateEvaluationOrchestrator, useValue: orchestrator },
      ],
    })
      .overrideGuard(MsaidiziEvaluatorMtlsGuard)
      .useValue({ canActivate: () => false })
      .compile();
    app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/msaidizi/update-verifier/artifacts')
      .field('claimsJson', '{}')
      .field('signature', 'A'.repeat(86))
      .attach('file', Buffer.alloc(1024 * 1024), 'blocked.zip')
      .expect(403);

    expect(evaluation.ingestTrustedArtifact).not.toHaveBeenCalled();
    expect(evaluatorTempFiles()).toEqual(before);
  });

  it('removes the temp file when DTO validation rejects after Multer accepted the upload', async () => {
    const before = evaluatorTempFiles();
    const module = await Test.createTestingModule({
      controllers: [MsaidiziUpdateVerifierController],
      providers: [
        { provide: MsaidiziUpdateEvaluationService, useValue: evaluation },
        { provide: MsaidiziUpdateEvaluationOrchestrator, useValue: orchestrator },
      ],
    })
      .overrideGuard(MsaidiziEvaluatorMtlsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    await request(app.getHttpServer())
      .post('/msaidizi/update-verifier/artifacts')
      .field('claimsJson', '{}')
      .attach('file', Buffer.alloc(1024 * 1024), 'invalid-envelope.zip')
      .expect(400);

    expect(evaluation.ingestTrustedArtifact).not.toHaveBeenCalled();
    expect(evaluatorTempFiles()).toEqual(before);
  });
});

const evaluatorPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEn2vZJnIiDmMpIbuSoe07WUvLvlb
FUM1J8OyIbegFxoApBq0bSyvur3sHJUe16XRTyq59pnFbecIwIxWG6Y32Q==
-----END PUBLIC KEY-----`;

function harness(
  configOverrides: Record<string, string> = {},
  database: { certificateCount?: number; devicePublicKeys?: string[] } = {},
) {
  const values = {
    MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
    MSAIDIZI_EVALUATOR_MTLS_ENABLED: 'true',
    MSAIDIZI_EVALUATOR_MTLS_PORT: '3444',
    MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256: 'a'.repeat(64),
    MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256:
      'd9d3260d62d1bc93c8cbfa914ac615687db3c6beb4de0074263dd6d3ad8cd13c',
    ...configOverrides,
  };
  const config = {
    get: jest.fn((name: string) => values[name as keyof typeof values]),
  } as unknown as ConfigService;
  const prisma = {
    msaidiziDevice: {
      count: jest.fn().mockResolvedValue(database.certificateCount ?? 0),
      findMany: jest
        .fn()
        .mockResolvedValue((database.devicePublicKeys ?? []).map((publicKey) => ({ publicKey }))),
    },
  };
  return {
    guard: new MsaidiziEvaluatorMtlsGuard(config, prisma as never),
    prisma,
  };
}

function context(localPort = 3444) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ socket: { localPort } }),
    }),
  } as never;
}

function peer(overrides: Record<string, unknown> = {}) {
  return {
    certificateSha256: 'A'.repeat(64),
    publicKeyPem: evaluatorPublicKeyPem,
    publicKeySha256: 'B'.repeat(64),
    publicKeySpkiSha256: 'D9D3260D62D1BC93C8CBFA914AC615687DB3C6BEB4DE0074263DD6D3AD8CD13C',
    validFrom: new Date(0),
    validTo: new Date(Date.now() + 60_000),
    chainAuthorized: true,
    ...overrides,
  };
}

function evaluatorTempFiles(): string[] {
  return readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('msaidizi-evaluator-'))
    .sort();
}
