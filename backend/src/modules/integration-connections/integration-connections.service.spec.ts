import { BadRequestException } from '@nestjs/common';
import { IntegrationConnectionStatus } from '@prisma/client';
import { EventEmitter } from 'events';
import * as dns from 'dns';
import { IntegrationConnectionsService } from './integration-connections.service';

/**
 * Builds a fake ClientRequest/IncomingMessage pair so we can assert on the
 * pinned connection options without opening a real socket. `capture` receives
 * the request options the service passed to http(s).request.
 */
function mockRequest(options: {
  statusCode: number;
  body?: string;
  capture?: (reqOptions: any) => void;
}) {
  return jest.fn().mockImplementation((reqOptions: any, callback: (res: any) => void) => {
    options.capture?.(reqOptions);

    const res = new EventEmitter() as any;
    res.statusCode = options.statusCode;

    const req = new EventEmitter() as any;
    req.end = jest.fn(() => {
      // Deliver the response asynchronously, like the real client.
      setImmediate(() => {
        callback(res);
        if (options.body) res.emit('data', Buffer.from(options.body));
        res.emit('end');
      });
    });
    req.destroy = jest.fn((err?: Error) => {
      if (err) req.emit('error', err);
    });
    return req;
  });
}

describe('IntegrationConnectionsService', () => {
  let prisma: any;
  let auditLogs: any;
  let companyScope: any;
  let service: IntegrationConnectionsService;

  const user = { id: 'user-1' } as any;

  /**
   * Substitutes the service's transport seam with a stub `{ request }`, so no
   * real socket is opened and we avoid mutating Node's frozen http(s) modules.
   */
  function stubRequest(spy: jest.Mock) {
    jest.spyOn(service as any, 'httpTransport').mockReturnValue({ request: spy });
  }

  beforeEach(() => {
    prisma = {
      integrationConnection: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLogs = { log: jest.fn() };
    companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    service = new IntegrationConnectionsService(
      prisma,
      auditLogs,
      {
        encrypt: jest.fn((value: string) => `encrypted:${value}`),
      } as any,
      companyScope,
    );
  });

  afterEach(() => {
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

    const captured: any = {};
    const requestSpy = mockRequest({
      statusCode: 204,
      capture: (opts) => Object.assign(captured, opts),
    });
    stubRequest(requestSpy as any);
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    await expect(service.testConnection('connection-1', user)).resolves.toMatchObject({
      status: IntegrationConnectionStatus.ACTIVE,
    });

    // The request must have been pinned to the vetted IP (custom lookup),
    // while addressing the original hostname for Host header + TLS SNI.
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(captured.hostname).toBe('provider.example');
    expect(captured.path).toBe('/api/health');
    expect(captured.method).toBe('GET');
    expect(captured.servername).toBe('provider.example');
    expect(typeof captured.lookup).toBe('function');

    // The pinned lookup returns ONLY the validated IP, regardless of hostname.
    const pinned = await new Promise<string>((resolve) => {
      captured.lookup('provider.example', {}, (_e: any, address: string) => resolve(address));
    });
    expect(pinned).toBe('93.184.216.34');

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
    const requestSpy = mockRequest({ statusCode: 200 });
    stubRequest(requestSpy as any);

    await expect(service.testConnection('connection-1', user)).rejects.toBeInstanceOf(
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
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('refuses to probe when the host resolves to a private/metadata address (rebind attempt)', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: { testUrl: 'https://rebind.attacker.example/health' },
      provider: { baseUrl: null },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ERROR,
    });

    // Host resolves to the cloud metadata address at validation time.
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);
    const requestSpy = mockRequest({ statusCode: 200 });
    stubRequest(requestSpy as any);

    await expect(service.testConnection('connection-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // No outbound request may be attempted once validation fails.
    expect(requestSpy).not.toHaveBeenCalled();
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IntegrationConnectionStatus.ERROR,
          lastErrorMessage: expect.stringContaining('non-public address'),
        }),
      }),
    );
  });

  it('pins the connection to the validated public IP so a later rebind cannot redirect it', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: { testUrl: 'https://short-ttl.example/health' },
      provider: { baseUrl: null },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ACTIVE,
    });

    // Validation sees a public IP.
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '203.0.113.10', family: 4 }] as any);

    const captured: any = {};
    const requestSpy = mockRequest({
      statusCode: 200,
      capture: (opts) => Object.assign(captured, opts),
    });
    stubRequest(requestSpy as any);

    await expect(service.testConnection('connection-1', user)).resolves.toMatchObject({
      status: IntegrationConnectionStatus.ACTIVE,
    });

    // The connection is pinned: the request's custom lookup returns the vetted
    // IP even if the resolver would now return a private address (rebind).
    const pinned = await new Promise<string>((resolve) => {
      captured.lookup('short-ttl.example', {}, (_e: any, address: string) => resolve(address));
    });
    expect(pinned).toBe('203.0.113.10');
  });

  it('rejects non-http(s) probe protocols', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: { testUrl: 'file:///etc/passwd' },
      provider: { baseUrl: null },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ERROR,
    });
    const requestSpy = mockRequest({ statusCode: 200 });
    stubRequest(requestSpy as any);

    await expect(service.testConnection('connection-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(requestSpy).not.toHaveBeenCalled();
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IntegrationConnectionStatus.ERROR,
          lastErrorMessage: expect.stringContaining('http or https'),
        }),
      }),
    );
  });

  it('does not follow redirects — a 3xx response fails the probe', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'connection-1',
      publicConfig: { testUrl: 'https://provider.example/health' },
      provider: { baseUrl: null },
    });
    prisma.integrationConnection.update.mockResolvedValue({
      id: 'connection-1',
      status: IntegrationConnectionStatus.ERROR,
    });
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    const requestSpy = mockRequest({ statusCode: 302 });
    stubRequest(requestSpy as any);

    await expect(service.testConnection('connection-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IntegrationConnectionStatus.ERROR,
          lastErrorMessage: expect.stringContaining('redirect'),
        }),
      }),
    );
  });
});
