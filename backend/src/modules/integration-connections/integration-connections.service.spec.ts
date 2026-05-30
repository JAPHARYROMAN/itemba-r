import { BadRequestException } from '@nestjs/common';
import { IntegrationConnectionStatus } from '@prisma/client';
import * as dns from 'dns';
import { IntegrationConnectionsService } from './integration-connections.service';

describe('IntegrationConnectionsService', () => {
  const originalFetch = global.fetch;

  let prisma: any;
  let auditLogs: any;
  let service: IntegrationConnectionsService;

  beforeEach(() => {
    prisma = {
      integrationConnection: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLogs = { log: jest.fn() };
    service = new IntegrationConnectionsService(prisma, auditLogs, {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('marks the connection active only after a real provider probe succeeds', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: { testPath: 'health', expectedStatus: 204 },
      provider: { baseUrl: 'https://provider.example/api' },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ACTIVE,
    });
    global.fetch = jest.fn().mockResolvedValue({
      status: 204,
      text: jest.fn(),
    } as any);
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    await expect(service.testConnection('connection-1', 'user-1')).resolves.toMatchObject({
      status: IntegrationConnectionStatus.ACTIVE,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://provider.example/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'connection-1' },
        data: expect.objectContaining({
          status: IntegrationConnectionStatus.ACTIVE,
          lastSuccessAt: expect.any(Date),
          lastErrorAt: null,
          lastErrorMessage: null,
        }),
      }),
    );
  });

  it('marks the connection errored when no provider probe target is configured', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: {},
      provider: { baseUrl: null },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ERROR,
    });

    await expect(service.testConnection('connection-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'connection-1' },
        data: expect.objectContaining({
          status: IntegrationConnectionStatus.ERROR,
          lastErrorAt: expect.any(Date),
          lastErrorMessage: expect.stringContaining('No provider test URL configured'),
        }),
      }),
    );
    expect(global.fetch).toBe(originalFetch);
  });
});
