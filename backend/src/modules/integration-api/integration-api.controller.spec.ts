import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntegrationApiController } from './integration-api.controller';

const prisma = {
  webhookEvent: {
    findFirst: jest.fn(),
  },
};

const externalPayments = {} as any;
const externalMessages = {} as any;

function makeReq(companyId: string | null | undefined) {
  return {
    apiKey: {
      id: 'key-1',
      apiClientId: 'client-1',
      apiClient: companyId === undefined ? undefined : { companyId },
    },
  } as any;
}

describe('IntegrationApiController — getWebhookEvent', () => {
  let controller: IntegrationApiController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new IntegrationApiController(
      externalPayments,
      externalMessages,
      prisma as any,
    );
  });

  it('returns a webhook event scoped to the API key company', async () => {
    const record = {
      id: 'evt-1',
      webhookEventNumber: 'WEV-0001',
      companyId: 'company-1',
      eventName: 'payment.settled',
    };
    prisma.webhookEvent.findFirst.mockResolvedValue(record);

    const result = await controller.getWebhookEvent('evt-1', makeReq('company-1'));

    expect(result).toBe(record);
    // The query MUST be scoped by the key's bound company (cross-tenant isolation).
    expect(prisma.webhookEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1', companyId: 'company-1' },
      }),
    );
  });

  it('never selects sensitive payload/headers on the read route', async () => {
    prisma.webhookEvent.findFirst.mockResolvedValue({ id: 'evt-1', companyId: 'company-1' });

    await controller.getWebhookEvent('evt-1', makeReq('company-1'));

    const call = prisma.webhookEvent.findFirst.mock.calls[0][0];
    expect(call.select.payload).toBeUndefined();
    expect(call.select.headers).toBeUndefined();
  });

  it('throws NotFoundException when the event is not in the key company (cross-tenant)', async () => {
    // A row belonging to another tenant is filtered out by the companyId scope,
    // so findFirst returns null and the caller cannot probe it.
    prisma.webhookEvent.findFirst.mockResolvedValue(null);

    await expect(
      controller.getWebhookEvent('evt-other', makeReq('company-1')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the API key is not bound to a company', async () => {
    await expect(
      controller.getWebhookEvent('evt-1', makeReq(null)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.webhookEvent.findFirst).not.toHaveBeenCalled();
  });
});
