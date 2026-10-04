import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { PosDraftsService } from './pos-drafts.service';
import { PosDraftsController } from './pos-drafts.controller';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { MobilePosSessionGuard } from '../../common/guards/mobile-pos-session.guard';
import { AGENT_EXCLUDED_KEY } from '../../common/decorators/agent-excluded.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { MOBILE_POS_SESSION_ROLES } from '../../common/decorators/mobile-pos-session.decorator';
import { decimal, digest, eatDay, saleSignature } from './pos-drafts.types';
import { assertLegacyPosWriteAllowed } from '../../common/services/pos-draft-policy';

const administrator: any = {
  id: 'admin',
  permissions: [
    'pos_drafts.view',
    'pos_drafts.create',
    'pos_drafts.approve',
    'pos_drafts.reject',
    'pos_drafts.direct_post',
  ],
  roles: [],
  roleScopes: ['COMPANY'],
};
function fixture(overrides: Record<string, any> = {}) {
  const decisions: any[] = [];
  let draft: any = {
    id: 'draft',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    originUserId: 'cashier',
    originRole: 'CASHIER',
    terminalId: 'terminal',
    requestId: 'capture-request-123456',
    revision: 1,
    kind: 'SALE',
    status: 'SUBMITTED',
    businessDate: new Date('2026-10-04'),
    capturedAt: new Date('2026-10-04T06:00:00Z'),
    amount: new Prisma.Decimal(100),
    pendingMoney: new Prisma.Decimal(100),
    currency: 'TZS',
    payload: {
      customerId: 'customer',
      paymentMethod: 'CASH',
      expectedTotal: 100,
      lines: [{ productId: 'product', quantity: 1, unitPrice: 100 }],
      _sale: {
        lines: [{ productId: 'product', quantity: 1, unitPrice: 100, unitId: 'unit' }],
        cashAccountId: 'cash',
      },
      _captureDigest: 'capture',
    },
    ...overrides,
  };
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    posDraft: {
      findUnique: jest.fn(async () => draft),
      findUniqueOrThrow: jest.fn(async () => draft),
      update: jest.fn(async ({ data }: any) => {
        draft = {
          ...draft,
          ...data,
          pendingMoney:
            data.pendingMoney !== undefined
              ? new Prisma.Decimal(data.pendingMoney)
              : draft.pendingMoney,
          revision: data.revision?.increment
            ? draft.revision + data.revision.increment
            : draft.revision,
        };
        return draft;
      }),
    },
    posDraftDecision: {
      create: jest.fn(async ({ data }) => {
        decisions.push(data);
        return data;
      }),
      findFirst: jest.fn(async () => decisions.at(-1) ?? null),
    },
    mobilePosEnrollment: {
      findFirst: jest.fn(async () => ({ id: 'active-stockist', terminalId: 'stockist-terminal' })),
    },
    mobilePosTerminal: { findFirst: jest.fn(async () => ({ id: 'stockist-terminal' })) },
    stockAdjustment: { create: jest.fn() },
    product: {
      findMany: jest.fn(async () => [{ id: 'product' }]),
      findFirst: jest.fn(async () => ({
        id: 'product',
        defaultSellingPrice: 100,
        trackInventory: false,
      })),
    },
    posDraftReservation: {
      findMany: jest.fn(async () => [{ productId: 'product', quantity: new Prisma.Decimal(1) }]),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => {
      const before = draft;
      try {
        return await fn(tx);
      } catch (error) {
        draft = before;
        throw error;
      }
    }),
  };
  const audit = { logStrictInTransaction: jest.fn(async () => ({})) },
    sales = {
      createAndConfirmInTransaction: jest.fn(async () => ({ id: 'sale' })),
      assertDraftSaleProfitable: jest.fn(async () => undefined),
    };
  const service: any = new PosDraftsService(
    prisma,
    {} as any,
    {} as any,
    audit as any,
    sales as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  service.accountingControl = {
    assertPostingAllowed: jest.fn().mockResolvedValue({ id: 'period' }),
  };
  service.visible = jest.fn(async () => draft);
  service.scope = jest.fn(async () => ({
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
  }));
  service.roleFor = jest.fn(async () => 'ADMIN');
  service.expire = jest.fn();
  service.release = jest.fn();
  service.reserve = jest.fn();
  service.assertOriginActive = jest.fn(async () => ({
    id: 'cashier',
    permissions: ['pos_drafts.create'],
  }));
  service.validateCapturedSale = jest.fn();
  service.checkDuplicates = jest.fn(async () => ({ reviewedCandidateIds: [] }));
  service.balance = jest.fn(async () => ({
    physicalRevision: 1,
    quantityOnHand: new Prisma.Decimal(2),
    quantityReserved: new Prisma.Decimal(0),
  }));
  return { service, tx, prisma, sales, audit, getDraft: () => draft };
}

describe('POS Draft approval boundaries', () => {
  it('first cashier approval reserves and audits without creating a canonical sale', async () => {
    const f = fixture();
    const result = await f.service.approve('draft', { revision: 1 }, administrator);
    expect(result.status).toBe('AWAITING_STOCKIST');
    expect(result.revision).toBe(2);
    expect(f.service.reserve).toHaveBeenCalledWith(f.tx, expect.objectContaining({ id: 'draft' }));
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    expect(f.audit.logStrictInTransaction).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'POS_DRAFT_APPROVE', userId: 'admin' }),
    );
    expect(f.service.validateCapturedSale).toHaveBeenCalled();
  });
  it('a stale first approval cannot skip preparation or release an existing reservation', async () => {
    const f = fixture({
      status: 'AWAITING_STOCKIST',
      revision: 2,
      reservedUntil: new Date(Date.now() + 86400000),
    });
    await expect(f.service.approve('draft', { revision: 1 }, administrator)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.getDraft().status).toBe('AWAITING_STOCKIST');
    expect(f.service.release).not.toHaveBeenCalled();
    expect(f.tx.posDraft.update).not.toHaveBeenCalled();
  });
  it('an invalid current-stage approve also leaves the stock hold intact', async () => {
    const f = fixture({ status: 'AWAITING_STOCKIST', revision: 2 });
    await expect(f.service.approve('draft', { revision: 2 }, administrator)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.service.release).not.toHaveBeenCalled();
    expect(f.getDraft().status).toBe('AWAITING_STOCKIST');
  });
  it('a closed accounting period prevents first approval from reserving stock', async () => {
    const f = fixture();
    f.service.accountingControl.assertPostingAllowed.mockRejectedValue(
      new BadRequestException('Accounting period is not OPEN'),
    );
    await expect(f.service.approve('draft', { revision: 1 }, administrator)).rejects.toThrow(
      'Accounting period is not OPEN',
    );
    expect(f.service.reserve).not.toHaveBeenCalled();
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    expect(f.getDraft().status).toBe('NEEDS_ATTENTION');
  });
  it('only final approval creates the sale through the exact caller-owned transaction', async () => {
    const f = fixture({
      status: 'READY_FINAL',
      revision: 3,
      reservedUntil: new Date(Date.now() + 86400000),
    });
    const result = await f.service.approve('draft', { revision: 3 }, administrator);
    expect(result.status).toBe('POSTED');
    expect(result.pendingMoney).toBe(0);
    expect(result.revision).toBe(4);
    expect(f.sales.createAndConfirmInTransaction).toHaveBeenCalledTimes(1);
    expect(f.sales.createAndConfirmInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company', branchId: 'branch' }),
      administrator,
      f.tx,
      expect.objectContaining({ originUserId: 'cashier', mobilePosTerminalId: 'terminal' }),
    );
    expect(f.service.release).toHaveBeenCalledWith(f.tx, expect.objectContaining({ id: 'draft' }));
  });
  it('stockist-origin sale posts after one approval without a second reservation stage', async () => {
    const f = fixture({ originRole: 'STOCKIST', originUserId: 'stockist' });
    expect((await f.service.approve('draft', { revision: 1 }, administrator)).status).toBe(
      'POSTED',
    );
    expect(f.service.reserve).not.toHaveBeenCalled();
    expect(f.sales.createAndConfirmInTransaction).toHaveBeenCalledTimes(1);
  });
  describe('reviewing a matching stockist capture as a genuine second purchase', () => {
    const continuation = () =>
      fixture({
        originRole: 'STOCKIST',
        originUserId: 'stockist',
        status: 'NEEDS_ATTENTION',
        pendingMoney: new Prisma.Decimal(0),
        payload: {
          customerId: 'customer',
          paymentMethod: 'CASH',
          lines: [{ productId: 'product', quantity: 1, unitPrice: 100 }],
          _sale: {
            lines: [{ productId: 'product', quantity: 1, unitPrice: 100, unitId: 'unit' }],
            cashAccountId: 'cash',
          },
          _captureDigest: 'capture',
          _continuesDraftId: 'cashier-draft',
        },
      });
    const review = {
      revision: 1,
      duplicateReason: 'The customer made a separate second purchase',
      reviewedCandidateIds: ['cashier-draft'],
    };
    it('keeps default continuation and its single money claim until an explicit office review', async () => {
      const f = continuation();
      expect(f.service.present(f.getDraft(), administrator).allowedActions).toContain('approve');
      await expect(f.service.approve('draft', { revision: 1 }, administrator)).rejects.toThrow(
        'Continue the cashier transaction',
      );
      expect(f.getDraft().payload._continuesDraftId).toBe('cashier-draft');
      expect(Number(f.getDraft().pendingMoney)).toBe(0);
      expect(f.tx.posDraft.update).not.toHaveBeenCalled();
      expect(f.service.release).not.toHaveBeenCalled();
      expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    });
    it('posts a fully reviewed stockist repeat once without using the cashier draft hold', async () => {
      const f = continuation();
      f.service.checkDuplicates.mockResolvedValue({ ...review, captureDigest: 'capture' });
      const posted = await f.service.approve('draft', review, administrator);
      expect(posted.status).toBe('POSTED');
      expect(posted.pendingMoney).toBe(0);
      expect(f.getDraft().payload._continuesDraftId).toBeUndefined();
      expect(f.getDraft().payload._separateRepeatOfDraftId).toBe('cashier-draft');
      expect(f.service.reserve).not.toHaveBeenCalled();
      expect(f.service.release).toHaveBeenCalledTimes(1);
      expect(f.service.release).toHaveBeenCalledWith(
        f.tx,
        expect.objectContaining({ id: 'draft', originUserId: 'stockist' }),
      );
      expect(f.sales.createAndConfirmInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        administrator,
        f.tx,
        expect.objectContaining({ originUserId: 'stockist' }),
      );
      expect(f.tx.posDraftDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REPEAT_REVIEW',
          actorUserId: 'admin',
          metadata: expect.objectContaining({
            continuedDraftId: 'cashier-draft',
            resolution: 'GENUINE_REPEAT',
            reviewedCandidateIds: ['cashier-draft'],
          }),
        }),
      });
    });
    it('cannot promote an alias after the administrator omits another current matching purchase', async () => {
      const f = continuation();
      f.service.checkDuplicates = (PosDraftsService.prototype as any).checkDuplicates;
      f.service.candidates = jest.fn(async () => [
        { id: 'cashier-draft', reviewable: true },
        { id: 'another-current-match', reviewable: true },
      ]);
      f.service.reviewableCandidates = jest.fn(async (candidates) => candidates);
      await expect(f.service.approve('draft', review, administrator)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.getDraft().payload._continuesDraftId).toBe('cashier-draft');
      expect(Number(f.getDraft().pendingMoney)).toBe(0);
      expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    });
    it.each([
      { label: 'stock shortage', error: new BadRequestException('Not enough unreserved stock') },
      { label: 'unexpected posting failure', error: new Error('Posting failed') },
    ])(
      'retains reviewed repeat funds and identity after a posting failure ($label)',
      async ({ error }) => {
        const f = continuation();
        f.service.checkDuplicates.mockResolvedValue({ ...review, captureDigest: 'capture' });
        f.sales.createAndConfirmInTransaction.mockRejectedValueOnce(error);
        await expect(f.service.approve('draft', review, administrator)).rejects.toThrow(error);
        expect(f.getDraft().status).toBe('NEEDS_ATTENTION');
        expect(Number(f.getDraft().pendingMoney)).toBe(100);
        expect(f.getDraft().requestId).toBe('capture-request-123456');
        expect(f.getDraft().payload._continuesDraftId).toBeUndefined();
        expect(f.getDraft().payload._separateRepeatOfDraftId).toBe('cashier-draft');
        expect(f.getDraft().postedEntityId).toBeUndefined();
      },
    );
  });
  it('canonical failure rolls back final state and retains the pending money for reconciliation', async () => {
    const f = fixture({ originRole: 'STOCKIST' });
    f.sales.createAndConfirmInTransaction.mockRejectedValueOnce(
      new BadRequestException('Posting period is locked'),
    );
    await expect(f.service.approve('draft', { revision: 1 }, administrator)).rejects.toThrow(
      'Posting period is locked',
    );
    expect(f.getDraft().status).toBe('NEEDS_ATTENTION');
    expect(Number(f.getDraft().pendingMoney)).toBe(100);
    expect(f.getDraft().postedEntityId).toBeUndefined();
  });
  it('PIN accounts and ordinary self approval are denied before posting', async () => {
    const f = fixture({ originUserId: 'admin', originRole: 'ADMIN' });
    await expect(
      f.service.approve('draft', { revision: 1 }, { ...administrator, tokenUse: 'mobile-pos' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.approve('draft', { revision: 1 }, administrator)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    expect(f.service.reserve).not.toHaveBeenCalled();
    expect((await f.service.approve('draft', { revision: 1 }, administrator, true)).status).toBe(
      'POSTED',
    );
  });
  it('stockist preparation uses READ organisation scope and increments the decision revision', async () => {
    const f = fixture({
      status: 'AWAITING_STOCKIST',
      revision: 2,
      reservedUntil: new Date(Date.now() + 86400000),
    });
    f.service.roleFor.mockResolvedValue('STOCKIST');
    const stockist: any = {
      id: 'stockist',
      tokenUse: 'mobile-pos',
      mobilePosRole: 'STOCKIST',
      permissions: ['pos_drafts.view', 'pos_drafts.dispatch'],
    };
    const result = await f.service.prepare('draft', { revision: 2 }, stockist);
    expect(result.status).toBe('READY_FINAL');
    expect(result.revision).toBe(3);
    expect(f.service.scope).toHaveBeenCalledWith(expect.any(Object), stockist, AccessLevel.READ);
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
  });
  it('a count must recount when physical revision changed even if quantity returned to its baseline', async () => {
    const f = fixture({
      kind: 'COUNT',
      payload: {
        lines: [
          {
            productId: 'product',
            unitId: 'unit',
            baselineQuantity: 2,
            countedQuantity: 1,
            physicalRevision: 0,
          },
        ],
      },
    });
    await expect(f.service.post(f.tx, f.getDraft(), administrator)).rejects.toThrow('Recount');
    expect(f.tx.stockAdjustment.create).not.toHaveBeenCalled();
  });
  it('prevents paused or revoked stockists from preparing through a regular ERP session', async () => {
    const f = fixture({
      status: 'AWAITING_STOCKIST',
      revision: 2,
      reservedUntil: new Date(Date.now() + 86400000),
    });
    f.service.roleFor.mockResolvedValue('STOCKIST');
    f.tx.mobilePosEnrollment.findFirst.mockResolvedValue(null);
    const stockist = { ...administrator, id: 'stockist', permissions: ['pos_drafts.dispatch'] };
    await expect(f.service.prepare('draft', { revision: 2 }, stockist)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.service.scope).toHaveBeenCalledWith(expect.any(Object), stockist, AccessLevel.READ);
    expect(f.tx.posDraft.update).not.toHaveBeenCalled();
    expect(f.service.expire).not.toHaveBeenCalled();
  });
  it('rejection retains the captured money claim without creating financial records', async () => {
    const f = fixture();
    const result = await f.service.reject(
      'draft',
      { revision: 1, reason: 'Customer cancelled' },
      administrator,
    );
    expect(result.status).toBe('REJECTED');
    expect(result.pendingMoney).toBe(100);
    expect(result.blockingReason).toContain('Money reconciliation');
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
  });
});

describe('POS correction custody', () => {
  const recorder = { ...administrator, id: 'cashier' };
  const capture = {
    revision: 2,
    requestId: 'capture-request-123456',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    kind: 'SALE' as const,
    businessDate: '2026-10-04',
    capturedAt: '2026-10-04T06:00:00Z',
    payload: { customerId: 'customer', paymentMethod: 'CASH', expectedTotal: 100, lines: [] },
  };
  function correctionFixture(stage = 'AWAITING_STOCKIST') {
    const f = fixture({
      status: stage,
      revision: 2,
      reservedUntil: new Date(Date.now() + 86400000),
    });
    f.service.normalize = jest.fn(async () => ({
      payload: capture.payload,
      pendingMoney: new Prisma.Decimal(100),
      amount: new Prisma.Decimal(100),
      duplicateSignature: 'new-sale-signature',
    }));
    return f;
  }
  it.each(['AWAITING_STOCKIST', 'READY_FINAL'])(
    'returns a corrected %s sale to review and releases its old dispatch hold',
    async (stage) => {
      const f = correctionFixture(stage);
      const result = await f.service.correct('draft', capture, recorder);
      expect(result.status).toBe('SUBMITTED');
      expect(result.pendingMoney).toBe(100);
      expect(result.reservedUntil).toBeNull();
      expect(result.revision).toBe(3);
      expect(f.service.release).toHaveBeenCalledWith(
        f.tx,
        expect.objectContaining({ id: 'draft' }),
      );
      expect(f.tx.posDraftDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CORRECT', actorUserId: 'cashier' }),
      });
      expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    },
  );
  it('refuses to replace already collected funds and leaves the approved reservation intact', async () => {
    const f = correctionFixture();
    f.service.normalize.mockResolvedValue({
      payload: { ...capture.payload, expectedTotal: 80 },
      amount: new Prisma.Decimal(80),
      pendingMoney: new Prisma.Decimal(80),
    });
    await expect(f.service.correct('draft', capture, recorder)).rejects.toThrow(
      'Collected funds cannot change',
    );
    expect(f.service.release).not.toHaveBeenCalled();
    expect(f.getDraft().pendingMoney.toString()).toBe('100');
    expect(f.getDraft().status).toBe('AWAITING_STOCKIST');
  });
  it('refuses to relabel cash already collected as another tender', async () => {
    const f = correctionFixture();
    f.service.normalize.mockResolvedValue({
      payload: { ...capture.payload, paymentMethod: 'BANK_TRANSFER', paymentReference: 'new' },
      amount: new Prisma.Decimal(100),
      pendingMoney: new Prisma.Decimal(100),
    });
    await expect(f.service.correct('draft', capture, recorder)).rejects.toThrow(
      'Collected funds cannot change',
    );
    expect(f.service.release).not.toHaveBeenCalled();
  });
  it('cannot move a correction to another capture day to escape the duplicate window', async () => {
    const f = correctionFixture();
    await expect(
      f.service.correct('draft', { ...capture, businessDate: '2026-10-05' }, recorder),
    ).rejects.toThrow('original capture date');
    expect(f.service.normalize).not.toHaveBeenCalled();
    expect(f.service.release).not.toHaveBeenCalled();
  });
  it('cannot correct another recorder or a posted sale', async () => {
    const f = correctionFixture('POSTED');
    await expect(f.service.correct('draft', capture, recorder)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.service.release).not.toHaveBeenCalled();
    const other = correctionFixture();
    await expect(other.service.correct('draft', capture, administrator)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(other.service.release).not.toHaveBeenCalled();
  });
});

describe('POS rejected funds reconciliation', () => {
  const confirmation = {
    revision: 1,
    fundsReturned: true as const,
    reason: 'Cash returned in full to the customer',
    reference: 'RETURN-001',
  };
  it('records the full physical return without posting cash, stock or a sale and makes retry idempotent', async () => {
    const f = fixture({ status: 'REJECTED' });
    const result = await f.service.confirmReturn('draft', confirmation, administrator);
    expect(result.status).toBe('REJECTED');
    expect(result.pendingMoney).toBe(0);
    expect(result.revision).toBe(2);
    expect(f.tx.posDraftDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'RETURN_FUNDS',
        actorUserId: 'admin',
        metadata: expect.objectContaining({
          originalPendingMoney: '100.00',
          currency: 'TZS',
          reference: 'RETURN-001',
        }),
      }),
    });
    expect(f.audit.logStrictInTransaction).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'POS_DRAFT_RETURN_FUNDS' }),
    );
    expect(f.sales.createAndConfirmInTransaction).not.toHaveBeenCalled();
    const retry = await f.service.confirmReturn('draft', confirmation, administrator);
    expect(retry.pendingMoney).toBe(0);
    expect(f.tx.posDraftDecision.create).toHaveBeenCalledTimes(1);
  });
  it('requires a rejected capture, current revision and explicit full return confirmation', async () => {
    await expect(
      fixture().service.confirmReturn('draft', confirmation, administrator),
    ).rejects.toBeInstanceOf(ConflictException);
    const f = fixture({ status: 'REJECTED' });
    await expect(
      f.service.confirmReturn('draft', { ...confirmation, fundsReturned: false }, administrator),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      f.service.confirmReturn('draft', { ...confirmation, revision: 2 }, administrator),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.posDraft.update).not.toHaveBeenCalled();
  });
  it('denies restricted PIN and legacy staff accounts even if approval permission is present', async () => {
    const f = fixture({ status: 'REJECTED' });
    await expect(
      f.service.confirmReturn('draft', confirmation, {
        ...administrator,
        tokenUse: 'mobile-pos',
        mobilePosRole: 'CASHIER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    f.service.roleFor.mockResolvedValue('STOCKIST');
    await expect(
      f.service.confirmReturn('draft', confirmation, administrator),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('POS scoped metadata', () => {
  it('provides authorized active branch metadata using only POS Draft read permission', async () => {
    const f = fixture();
    (f.service as any).companyScope.accessibleCompanyIds = jest.fn(async () => ['company']);
    (f.service as any).organizationScope.accessibleIds = jest.fn(async () => ({
      unrestricted: false,
      divisionIds: [],
      branchIds: ['branch'],
    }));
    f.prisma.company = { findMany: jest.fn(async () => [{ id: 'company', name: 'Company' }]) };
    f.prisma.branch = {
      findMany: jest.fn(async () => [
        {
          id: 'branch',
          name: 'Branch',
          divisionId: 'division',
          division: { id: 'division', name: 'Division', companyId: 'company' },
        },
      ]),
    };
    const result = await f.service.scopes({ ...administrator, permissions: ['pos_drafts.view'] });
    expect(result.branches).toEqual([
      { id: 'branch', name: 'Branch', divisionId: 'division', companyId: 'company' },
    ]);
    expect(f.prisma.branch.findMany.mock.calls[0][0].where.OR).toContainEqual({
      id: { in: ['branch'] },
    });
    const pin = { ...administrator, permissions: ['pos_drafts.view'], tokenUse: 'mobile-pos' };
    await f.service.scopes(pin);
    expect(f.prisma.branch.findMany.mock.calls[1][0].where.id).toBe('branch');
    expect(f.service.scope).toHaveBeenCalledWith({}, pin);
  });
});

describe('office legacy terminal references', () => {
  const manager = {
    ...administrator,
    companyId: 'company',
    companyAccess: [{ companyId: 'company', accessLevel: AccessLevel.READ }],
    permissions: ['pos_drafts.view', 'mobile_pos_lite.manage'],
  };
  const branchManager = {
    ...manager,
    roleScopes: ['BRANCH'],
    divisionAccess: [],
    branchAccess: [{ branchId: 'branch', accessLevel: AccessLevel.READ }],
  };
  function references() {
    const f = fixture();
    f.service.companyScope = new CompanyScopeService(f.prisma);
    f.service.organizationScope = new OrganizationScopeService(f.prisma);
    f.prisma.mobilePosTerminal = {
      findMany: jest.fn(async () => [
        { id: 'paused', terminalCode: 'MPL-PAUSED', name: 'Earlier till', status: 'SUSPENDED' },
        { id: 'revoked', terminalCode: 'MPL-REVOKED', name: 'Replaced till', status: 'REVOKED' },
      ]),
    };
    f.prisma.branch = {
      findUnique: jest.fn(async () => ({
        divisionId: 'division',
        division: { companyId: 'company' },
      })),
    };
    return f;
  }
  it('lets a company manager reconcile suspended/revoked terminals using only minimal read references', async () => {
    const f = references();
    await expect(f.service.legacyTerminals({}, manager)).resolves.toEqual([
      { id: 'paused', code: 'MPL-PAUSED', name: 'Earlier till' },
      { id: 'revoked', code: 'MPL-REVOKED', name: 'Replaced till' },
    ]);
    expect(f.prisma.mobilePosTerminal.findMany).toHaveBeenCalledWith({
      where: { AND: [{ companyId: { in: ['company'] } }, {}] },
      select: { id: true, terminalCode: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('narrows a branch manager to their READ branch grant without requiring an active terminal', async () => {
    const f = references();
    await f.service.legacyTerminals({ companyId: 'company', branchId: 'branch' }, branchManager);
    expect(f.prisma.mobilePosTerminal.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        { companyId: 'company' },
        { OR: [{ branchId: { in: ['branch'] } }] },
        { branchId: 'branch' },
      ],
    });
    expect(f.prisma.branch.findUnique).toHaveBeenCalledWith({
      where: { id: 'branch' },
      select: { divisionId: true, division: { select: { companyId: true } } },
    });
  });
  it('rejects an explicitly requested foreign company before reading any terminal references', async () => {
    const f = references();
    await expect(
      f.service.legacyTerminals({ companyId: 'foreign-company' }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.mobilePosTerminal.findMany).not.toHaveBeenCalled();
  });
  it('rejects an explicitly requested ungranted branch before reading terminal references', async () => {
    const f = references();
    await expect(
      f.service.legacyTerminals(
        { companyId: 'company', branchId: 'foreign-branch' },
        branchManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.mobilePosTerminal.findMany).not.toHaveBeenCalled();
  });
  it.each(['pos_drafts.view', 'mobile_pos_lite.manage'])(
    'requires %s for the read',
    async (missing) => {
      const f = references();
      await expect(
        f.service.legacyTerminals(
          {},
          { ...manager, permissions: manager.permissions.filter((p: string) => p !== missing) },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.prisma.mobilePosTerminal.findMany).not.toHaveBeenCalled();
    },
  );
  it.each(['CASHIER', 'STOCKIST'])(
    'denies a %s PIN principal at both the global guard and service',
    async (role) => {
      const f = references();
      const pin = { ...manager, tokenUse: 'mobile-pos', mobilePosRole: role };
      await expect(f.service.legacyTerminals({}, pin)).rejects.toBeInstanceOf(ForbiddenException);
      const guard = new MobilePosSessionGuard(new Reflector(), f.prisma);
      await expect(
        guard.canActivate({
          getHandler: () => PosDraftsController.prototype.legacyTerminals,
          getClass: () => PosDraftsController,
          switchToHttp: () => ({ getRequest: () => ({ method: 'GET', user: pin }) }),
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.prisma.mobilePosTerminal.findMany).not.toHaveBeenCalled();
    },
  );
  it('keeps the route office-only, excluded from agents and behind both existing permissions', () => {
    const handler = PosDraftsController.prototype.legacyTerminals;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(manager.permissions);
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(MOBILE_POS_SESSION_ROLES, handler)).toBeUndefined();
  });
});

describe('POS identity and branch policy', () => {
  it('normalizes reordered and split product lines independently of actor or branch', () => {
    const lines = [
      { productId: 'a', quantity: 1, unitPrice: 10 },
      { productId: 'b', quantity: 3, unitPrice: 20 },
      { productId: 'a', quantity: 2, unitPrice: 10 },
    ];
    expect(saleSignature('company', '2026-10-04', 'customer', lines, 90)).toBe(
      saleSignature(
        'company',
        '2026-10-04',
        'customer',
        [
          { productId: 'b', quantity: 3, unitPrice: 20 },
          { productId: 'a', quantity: 3, unitPrice: 10 },
        ],
        90,
      ),
    );
    expect(saleSignature('company', '2026-10-04', 'customer', lines, 90)).not.toBe(
      saleSignature('company', '2026-10-05', 'customer', lines, 90),
    );
    expect(eatDay('2026-10-03T21:01:00Z')).toBe('2026-10-04');
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
    expect(() => decimal(-1, 'Quantity', 4)).toThrow();
    expect(() => decimal(1.001, 'Money')).toThrow();
  });
  it('denies revoked enrolled workers in regular ERP sessions, including transactions with no supplied branch', async () => {
    const db: any = {
      mobilePosEnrollment: { findFirst: jest.fn(async () => ({ id: 'revoked' })) },
    };
    await expect(assertLegacyPosWriteAllowed(db, administrator, 'company')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.mobilePosEnrollment.findFirst.mock.calls[0][0].where.status).toBeUndefined();
  });
  it('denies old terminal-assigned workers in an approval branch while preserving authorized office management', async () => {
    const db: any = {
      mobilePosEnrollment: { findFirst: jest.fn(async () => null) },
      mobilePosTerminal: { findMany: jest.fn(async () => [{ branchId: 'branch' }]) },
      mobilePosBranchSetup: { findFirst: jest.fn(async () => ({ id: 'setup' })) },
    };
    await expect(
      assertLegacyPosWriteAllowed(
        db,
        { ...administrator, permissions: ['mobile_pos_lite.use'] },
        'company',
        'branch',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertLegacyPosWriteAllowed(
        db,
        { ...administrator, permissions: ['mobile_pos_lite.manage'] },
        'company',
        'branch',
      ),
    ).resolves.toBeUndefined();
  });
  it('keeps enrolled and legacy terminal staff restricted when POS capture is paused', async () => {
    const db: any = {
      mobilePosEnrollment: {
        findFirst: jest.fn(async ({ where }) =>
          where.branchSetup.enabled === undefined ? { id: 'paused-enrollment' } : null,
        ),
      },
      mobilePosTerminal: { findMany: jest.fn(async () => [{ branchId: 'branch' }]) },
      mobilePosBranchSetup: {
        findFirst: jest.fn(async ({ where }) =>
          where.enabled === undefined ? { id: 'paused-setup', enabled: false } : null,
        ),
      },
    };
    const worker = { ...administrator, permissions: ['mobile_pos_lite.use'] };
    await expect(
      assertLegacyPosWriteAllowed(db, worker, 'company', 'branch'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    db.mobilePosEnrollment.findFirst.mockResolvedValue(null);
    await expect(
      assertLegacyPosWriteAllowed(db, worker, 'company', 'branch'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const f = fixture();
    (f.service as any).prisma.mobilePosEnrollment = db.mobilePosEnrollment;
    (f.service as any).prisma.mobilePosTerminal = db.mobilePosTerminal;
    (f.service as any).prisma.mobilePosBranchSetup = db.mobilePosBranchSetup;
    delete f.service.roleFor;
    await expect((f.service as any).roleFor(worker, 'branch')).resolves.toBe('CASHIER');
  });
  it('restricts a worker assigned to any configured terminal, even when the first assignment is unconfigured', async () => {
    const db: any = {
      mobilePosEnrollment: { findFirst: jest.fn(async () => null) },
      mobilePosTerminal: {
        findMany: jest.fn(async () => [
          { branchId: 'unconfigured-branch' },
          { branchId: 'paused-approval-branch' },
        ]),
      },
      mobilePosBranchSetup: {
        findFirst: jest.fn(async ({ where }) =>
          where.branchId.in.includes('paused-approval-branch') ? { id: 'setup' } : null,
        ),
      },
    };
    const worker = { ...administrator, permissions: ['mobile_pos_lite.use'] };
    await expect(assertLegacyPosWriteAllowed(db, worker, 'company')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const f = fixture();
    Object.assign(f.prisma, db);
    delete f.service.roleFor;
    await expect(f.service.roleFor(worker)).resolves.toBe('CASHIER');
  });
});
