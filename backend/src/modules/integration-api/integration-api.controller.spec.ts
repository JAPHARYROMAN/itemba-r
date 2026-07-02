import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExternalMessageStatus } from '@prisma/client';
import { IntegrationApiController } from './integration-api.controller';

const prisma = {
  webhookEvent: {
    findFirst: jest.fn(),
  },
  externalMessage: {
    findFirst: jest.fn(),
    update: jest.fn(),
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

describe('IntegrationApiController — messageDeliveryCallback', () => {
  let controller: IntegrationApiController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new IntegrationApiController(
      externalPayments,
      externalMessages,
      prisma as any,
    );
  });

  it('marks the message DELIVERED and sets deliveredAt, scoped to the key company', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-1',
      status: ExternalMessageStatus.SENT,
    });
    prisma.externalMessage.update.mockImplementation(async ({ data }: any) => ({
      id: 'msg-1',
      messageNumber: 'MSG-ABC',
      status: data.status,
      deliveredAt: data.deliveredAt ?? null,
      errorMessage: data.errorMessage ?? null,
      externalReference: data.externalReference ?? null,
      updatedAt: new Date(),
    }));

    const result = await controller.messageDeliveryCallback(
      { messageId: 'msg-1', status: 'DELIVERED', timestamp: '2026-07-01T10:00:00.000Z' } as any,
      makeReq('company-1'),
    );

    // Lookup MUST be scoped by the key's company.
    expect(prisma.externalMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
    const updateArg = prisma.externalMessage.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'msg-1' });
    expect(updateArg.data.status).toBe(ExternalMessageStatus.DELIVERED);
    expect(updateArg.data.deliveredAt).toEqual(new Date('2026-07-01T10:00:00.000Z'));
    expect(updateArg.data.errorMessage).toBeNull();
    expect(result).toMatchObject({ accepted: true, applied: true });
  });

  it('resolves the message by messageNumber or externalReference', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-2',
      status: ExternalMessageStatus.SENT,
    });
    prisma.externalMessage.update.mockResolvedValue({ id: 'msg-2' });

    await controller.messageDeliveryCallback(
      { messageId: 'MSG-ABC', status: 'failed' } as any,
      makeReq('company-1'),
    );

    const where = prisma.externalMessage.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { id: 'MSG-ABC' },
      { messageNumber: 'MSG-ABC' },
      { externalReference: 'MSG-ABC' },
    ]);
  });

  it('maps FAILED and records the failure reason', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-3',
      status: ExternalMessageStatus.SENT,
    });
    prisma.externalMessage.update.mockResolvedValue({ id: 'msg-3' });

    await controller.messageDeliveryCallback(
      { messageId: 'msg-3', status: 'UNDELIVERABLE', failureReason: 'invalid number' } as any,
      makeReq('company-1'),
    );

    const data = prisma.externalMessage.update.mock.calls[0][0].data;
    expect(data.status).toBe(ExternalMessageStatus.FAILED);
    expect(data.errorMessage).toBe('invalid number');
    expect(data.deliveredAt).toBeUndefined();
  });

  it('is idempotent: replaying the same terminal callback re-applies the same status', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-4',
      status: ExternalMessageStatus.DELIVERED,
    });
    prisma.externalMessage.update.mockResolvedValue({ id: 'msg-4' });

    await controller.messageDeliveryCallback(
      { messageId: 'msg-4', status: 'DELIVERED' } as any,
      makeReq('company-1'),
    );

    expect(prisma.externalMessage.update.mock.calls[0][0].data.status).toBe(
      ExternalMessageStatus.DELIVERED,
    );
  });

  it('acknowledges an unrecognised status without corrupting the stored status', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-5',
      status: ExternalMessageStatus.SENT,
    });

    const result = await controller.messageDeliveryCallback(
      { messageId: 'msg-5', status: 'pending' } as any,
      makeReq('company-1'),
    );

    expect(prisma.externalMessage.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accepted: true,
      applied: false,
      status: ExternalMessageStatus.SENT,
    });
  });

  it('persists providerReference even for an unrecognised status', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue({
      id: 'msg-6',
      status: ExternalMessageStatus.SENT,
    });
    prisma.externalMessage.update.mockResolvedValue({ id: 'msg-6' });

    await controller.messageDeliveryCallback(
      { messageId: 'msg-6', status: 'pending', providerReference: 'carrier-xyz' } as any,
      makeReq('company-1'),
    );

    expect(prisma.externalMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-6' },
      data: { externalReference: 'carrier-xyz' },
    });
  });

  it('throws NotFound (fail-closed) when the message is not in the key company', async () => {
    prisma.externalMessage.findFirst.mockResolvedValue(null);

    await expect(
      controller.messageDeliveryCallback(
        { messageId: 'other-tenant-msg', status: 'DELIVERED' } as any,
        makeReq('company-1'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.externalMessage.update).not.toHaveBeenCalled();
  });

  it('rejects when messageId is missing', async () => {
    await expect(
      controller.messageDeliveryCallback({ status: 'DELIVERED' } as any, makeReq('company-1')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the API key is not bound to a company', async () => {
    await expect(
      controller.messageDeliveryCallback(
        { messageId: 'msg-1', status: 'DELIVERED' } as any,
        makeReq(null),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.externalMessage.findFirst).not.toHaveBeenCalled();
  });
});
