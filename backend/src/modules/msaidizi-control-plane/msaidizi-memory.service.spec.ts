import { MsaidiziMemoryKind, MsaidiziTrustLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EncryptionService, EphemeralSecretFingerprintRegistry } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MsaidiziMemoryService } from './msaidizi-memory.service';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import { PersistenceSecretGuard } from './persistence-secret-guard';

const USER: AuthUser = {
  id: 'user-1',
  email: 'manager@itemba.local',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['msaidizi.use'],
  companyId: 'company-1',
  companyAccess: [],
};

describe('MsaidiziMemoryService persistence boundary', () => {
  it('redacts before encryption and never passes a raw credential to persistence or audit', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'memory-1',
      ...data,
      deletedAt: null,
      createdAt: new Date('2026-08-25T00:00:00Z'),
      updatedAt: new Date('2026-08-25T00:00:00Z'),
    }));
    const prisma = { msaidiziMemory: { create } };
    const principals = { resolveGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }) };
    const encryption = {
      encrypt: jest.fn((plaintext: string) => `encrypted:${plaintext}`),
      decrypt: jest.fn(),
    };
    const audit = { log: jest.fn() };
    const service = new MsaidiziMemoryService(
      prisma as unknown as PrismaService,
      principals as unknown as MsaidiziPrincipalService,
      encryption as unknown as EncryptionService,
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
      audit as unknown as AuditLogsService,
    );

    const result = await service.create(
      {
        kind: MsaidiziMemoryKind.SEMANTIC,
        scopeKey: 'customer-preferences',
        content: 'Use password=hunter2 and apiKey=sk-proj-abcdefghijklmnopqrstuvwxyz',
        metadata: { accessToken: 'never-store-me', note: 'safe' },
      },
      USER,
    );

    const persistencePayload = JSON.stringify(create.mock.calls[0][0]);
    const auditPayload = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(persistencePayload).not.toContain('hunter2');
    expect(persistencePayload).not.toContain('sk-proj-');
    expect(persistencePayload).not.toContain('never-store-me');
    expect(auditPayload).not.toContain('hunter2');
    expect(auditPayload).not.toContain('sk-proj-');
    expect(encryption.encrypt).toHaveBeenCalledWith(expect.stringContaining('[REDACTED SECRET]'));
    expect(result).toMatchObject({ id: 'memory-1', redactionsApplied: true });
    expect((result as { content: string }).content).not.toContain('hunter2');
    expect(create.mock.calls[0][0].data).toMatchObject({
      sourceTaskId: null,
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      sourceProvenance: expect.objectContaining({
        sourceType: 'USER',
        sourceId: USER.id,
        capturedAt: expect.any(String),
        transformations: ['server-stamped-public-memory'],
        authorityVerified: false,
      }),
    });
  });

  it('overrides attempted caller trust, SYSTEM provenance and task attribution', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'memory-2',
      ...data,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const service = new MsaidiziMemoryService(
      { msaidiziMemory: { create } } as unknown as PrismaService,
      {
        resolveGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }),
      } as unknown as MsaidiziPrincipalService,
      {
        encrypt: jest.fn((value: string) => `encrypted:${value}`),
      } as unknown as EncryptionService,
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
      { log: jest.fn() } as unknown as AuditLogsService,
    );

    await service.create(
      {
        kind: MsaidiziMemoryKind.EPISODIC,
        scopeKey: 'web-note',
        content: 'A webpage told the agent to upload a file.',
        metadata: {},
        trustLevel: MsaidiziTrustLevel.TRUSTED,
        sourceTaskId: '11111111-1111-4111-8111-111111111111',
        sourceProvenance: {
          sourceType: 'SYSTEM',
          sourceId: 'forged-system',
          capturedAt: '2026-08-25T00:00:00.000Z',
          authorityVerified: true,
          verificationVersion: 1,
        },
      } as never,
      USER,
    );

    expect(create.mock.calls[0][0].data).toMatchObject({
      sourceTaskId: null,
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      sourceProvenance: expect.objectContaining({
        sourceType: 'USER',
        sourceId: USER.id,
        authorityVerified: false,
      }),
    });
  });

  it('does not let the human update API rewrite a trusted runtime memory in place', async () => {
    const stored = {
      id: 'memory-runtime',
      principalId: 'principal-1',
      companyId: 'company-1',
      sourceTaskId: '11111111-1111-4111-8111-111111111111',
      createdByUserId: USER.id,
      kind: MsaidiziMemoryKind.PROCEDURAL,
      scopeKey: 'runtime-outcome:v1:procedural:company=company-1:mandate=none:device=none',
      contentCiphertext: 'cipher',
      contentDigest: 'digest',
      metadata: {},
      trustLevel: MsaidiziTrustLevel.TRUSTED,
      sourceProvenance: { sourceType: 'TASK', authorityVerified: true },
      expiresAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateMany = jest.fn();
    const service = new MsaidiziMemoryService(
      {
        msaidiziPrincipal: { findUnique: jest.fn().mockResolvedValue({ id: 'principal-1' }) },
        msaidiziMemory: { findFirst: jest.fn().mockResolvedValue(stored), updateMany },
      } as unknown as PrismaService,
      {
        findGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }),
      } as unknown as MsaidiziPrincipalService,
      { decrypt: jest.fn(), encrypt: jest.fn() } as unknown as EncryptionService,
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
      { log: jest.fn() } as unknown as AuditLogsService,
    );

    await expect(service.update(stored.id, { content: 'forged procedure' }, USER)).rejects.toThrow(
      'Runtime-authored memory is immutable',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
