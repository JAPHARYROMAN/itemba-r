import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { ApiKeysService } from './api-keys.service';

function makeService(allowedScopes: unknown) {
  const apiClient = {
    findFirst: jest.fn().mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
      allowedScopes,
    }),
  };
  const apiKey = {
    create: jest.fn(async ({ data }: any) => ({
      id: 'key-1',
      ...data,
      apiClient: { id: 'client-1', name: 'Inventory client', companyId: 'company-1' },
      createdAt: new Date('2026-08-26T00:00:00Z'),
      updatedAt: new Date('2026-08-26T00:00:00Z'),
    })),
  };
  const prisma = { apiClient, apiKey } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const config = { getOrThrow: jest.fn().mockReturnValue('test-api-key-pepper') } as any;
  const service = new ApiKeysService(prisma, auditLogs, companyScope, config);

  return { service, apiClient, apiKey, auditLogs, companyScope, config };
}

const user = { id: 'user-1' } as any;

describe('ApiKeysService.create scope containment', () => {
  it('creates a key when every requested scope is allowed by the API client', async () => {
    const { service, apiKey, companyScope } = makeService(['inventory.read', 'inventory.write']);

    const result = await service.create(
      {
        apiClientId: 'client-1',
        name: 'Read-only inventory key',
        scopes: ['inventory.read'],
      },
      user,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-1',
      AccessLevel.MANAGE,
    );
    expect(apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopes: ['inventory.read'] }),
      }),
    );
    expect(result.rawKey).toEqual(expect.any(String));
  });

  it('rejects a requested scope outside the client allowlist before minting a key', async () => {
    const { service, apiKey, auditLogs, config } = makeService(['inventory.read']);

    await expect(
      service.create(
        {
          apiClientId: 'client-1',
          name: 'Escalated key',
          scopes: ['inventory.read', 'payments.write'],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKey.create).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
    expect(config.getOrThrow).not.toHaveBeenCalled();
  });

  it('fails closed when the persisted client scope policy is malformed', async () => {
    const { service, apiKey } = makeService({ scope: 'inventory.read' });

    await expect(
      service.create(
        {
          apiClientId: 'client-1',
          name: 'Inventory key',
          scopes: ['inventory.read'],
        },
        user,
      ),
    ).rejects.toThrow('API client allowed scopes are invalid');

    expect(apiKey.create).not.toHaveBeenCalled();
  });
});
