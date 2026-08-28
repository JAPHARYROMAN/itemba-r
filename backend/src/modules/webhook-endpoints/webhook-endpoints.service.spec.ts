import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { responseSecretDigestMatches } from '../msaidizi/crud-mutation-generated-field-verifiers';
import { WebhookEndpointsService } from './webhook-endpoints.service';

const actor = { id: 'admin-1' } as any;

function webhookEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    webhookCode: 'WEBHOOK-1',
    companyId: 'company-1',
    providerId: null,
    connectionId: null,
    name: 'Evidence webhook',
    endpointPath: '/evidence-webhook',
    status: 'ACTIVE',
    allowedEvents: ['evidence.created'],
    secretHash: null,
    createdById: 'admin-1',
    deletedAt: null,
    ...overrides,
  };
}

function safeWebhookEndpoint(overrides: Record<string, unknown> = {}) {
  const { secretHash: _secretHash, ...safe } = webhookEndpoint(overrides);
  return safe;
}

function makeHarness(options: { denyAccess?: boolean; existingCompanyId?: string | null } = {}) {
  const existing = webhookEndpoint({
    companyId: 'existingCompanyId' in options ? (options.existingCompanyId ?? null) : 'company-1',
  });
  const webhookEndpointDelegate = {
    findFirst: jest.fn(async ({ where }: any) => (where.webhookCode ? null : existing)),
    create: jest.fn(async ({ data }: any) => {
      const { secretHash: _secretHash, ...safeData } = data;
      return safeWebhookEndpoint({
        id: 'webhook-created',
        ...safeData,
        companyId: data.companyId ?? null,
      });
    }),
    update: jest.fn(async ({ data }: any) => safeWebhookEndpoint({ ...existing, ...data })),
  };
  const prisma = {
    webhookEndpoint: webhookEndpointDelegate,
    integrationProvider: { findFirst: jest.fn() },
    integrationConnection: { findFirst: jest.fn() },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn(async () => {
      if (options.denyAccess) throw new ForbiddenException('Company access denied');
    }),
    companyWhereFor: jest.fn(),
  } as any;
  return {
    service: new WebhookEndpointsService(prisma, auditLogs, companyScope),
    webhookEndpointDelegate,
    auditLogs,
    companyScope,
  };
}

describe('WebhookEndpointsService governed persistence', () => {
  it('returns a one-time secret while persisting only its digest and auditing only safe fields', async () => {
    const { service, webhookEndpointDelegate, auditLogs, companyScope } = makeHarness();

    const result = await service.create(
      {
        webhookCode: 'WEBHOOK-CREATE',
        companyId: 'company-1',
        name: 'Created webhook',
        endpointPath: '/created-webhook',
        allowedEvents: ['evidence.created'],
      },
      actor,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      actor,
      'company-1',
      AccessLevel.WRITE,
    );
    const persisted = webhookEndpointDelegate.create.mock.calls[0][0].data;
    expect(result.rawSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(responseSecretDigestMatches(persisted.secretHash, result.rawSecret)).toBe(true);
    expect(result).not.toHaveProperty('secretHash');
    expect(persisted).not.toHaveProperty('rawSecret');
    expect(auditLogs.log).toHaveBeenCalledTimes(1);
    const audit = auditLogs.log.mock.calls[0][0];
    expect(audit).toEqual(
      expect.objectContaining({
        action: 'WEBHOOK_ENDPOINT_CREATED',
        entityType: 'WebhookEndpoint',
        entityId: 'webhook-created',
        userId: 'admin-1',
        companyId: 'company-1',
      }),
    );
    expect(audit.newValue).not.toHaveProperty('rawSecret');
    expect(audit.newValue).not.toHaveProperty('secretHash');
  });

  it('updates only declared endpoint fields without rotating or returning secret material', async () => {
    const { service, webhookEndpointDelegate, auditLogs } = makeHarness();

    const result = await service.update('webhook-1', { name: 'Updated webhook' }, actor);

    expect(webhookEndpointDelegate.update).toHaveBeenCalledWith({
      where: { id: 'webhook-1' },
      data: { name: 'Updated webhook' },
      select: expect.any(Object),
    });
    const data = webhookEndpointDelegate.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('rawSecret');
    expect(data).not.toHaveProperty('secretHash');
    expect(result).not.toHaveProperty('rawSecret');
    expect(result).not.toHaveProperty('secretHash');
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WEBHOOK_ENDPOINT_UPDATED',
        entityType: 'WebhookEndpoint',
        entityId: 'webhook-1',
        userId: 'admin-1',
        companyId: 'company-1',
      }),
    );
  });

  it('attributes global create, update, and delete audits to explicit global scope', async () => {
    const globalCreate = makeHarness();
    await globalCreate.service.create(
      {
        webhookCode: 'WEBHOOK-GLOBAL',
        name: 'Global webhook',
        endpointPath: '/global-webhook',
      },
      actor,
    );
    expect(globalCreate.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_ENDPOINT_CREATED', companyId: null }),
    );

    const globalMutation = makeHarness({ existingCompanyId: null });
    await globalMutation.service.update('webhook-1', { name: 'Updated global webhook' }, actor);
    expect(globalMutation.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_ENDPOINT_UPDATED', companyId: null }),
    );

    globalMutation.auditLogs.log.mockClear();
    await globalMutation.service.remove('webhook-1', actor);
    expect(globalMutation.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_ENDPOINT_DELETED', companyId: null }),
    );
  });

  it.each(['create', 'update'] as const)(
    'denies a foreign-company %s before endpoint persistence or audit',
    async (operation) => {
      const { service, webhookEndpointDelegate, auditLogs } = makeHarness({ denyAccess: true });

      const call =
        operation === 'create'
          ? service.create(
              {
                webhookCode: 'WEBHOOK-DENIED',
                companyId: 'company-1',
                name: 'Denied webhook',
                endpointPath: '/denied-webhook',
              },
              actor,
            )
          : service.update('webhook-1', { name: 'Denied webhook' }, actor);
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);

      expect(webhookEndpointDelegate.create).not.toHaveBeenCalled();
      expect(webhookEndpointDelegate.update).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    },
  );
});
