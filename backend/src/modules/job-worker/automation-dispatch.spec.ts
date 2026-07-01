import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobWorkerService } from './job-worker.service';

/**
 * Automation dispatch (ux-backend-wave-2b): due-selection + idempotency tests
 * for the three passes wired into the job-worker tick loop:
 *   (1) enqueueDueOverdueReminders
 *   (2) enqueueDueLowStockAlerts
 *   (3) enqueueDueScheduledReports
 *
 * These are pure-in-process: Prisma / EmailService / NotificationsService /
 * ScheduledReportsService are all mocked. The focus is the *policy* — what is
 * selected as due, how the atomic claim gates double-sends, and that the
 * feature flag keeps everything off by default.
 */

type Mocked = Record<string, any>;

function makeService(opts: {
  prisma: Mocked;
  email?: Mocked;
  notifications?: Mocked;
  scheduledReports?: Mocked;
  config?: Record<string, string>;
}): any {
  return new JobWorkerService(
    opts.prisma as unknown as PrismaService,
    new JobHandlerRegistry(),
    new ConfigService(opts.config ?? {}),
    opts.email as any,
    opts.notifications as any,
    opts.scheduledReports as any,
  );
}

describe('Automation dispatch — activation gate', () => {
  it('runAutomationDispatch is only reachable when AUTOMATION_DISPATCH_ENABLED is truthy', () => {
    const parse = (v: string | undefined) =>
      ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) expect(parse(v)).toBe(true);
    for (const v of ['false', '0', 'no', '', undefined, 'enabled']) expect(parse(v)).toBe(false);
  });

  it('runAutomationDispatch isolates a failing pass and still returns the others', async () => {
    const prisma = {
      receivable: {
        findMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      scheduledReport: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = makeService({ prisma });

    const result = await service.runAutomationDispatch();

    // Reminders threw but was caught; low-stock/reports still ran and returned.
    expect(result.reminders.error).toBe('db down');
    expect(result.reminders.processed).toBe(0);
    expect(result.lowStock.processed).toBe(0);
    expect(result.scheduledReports.processed).toBe(0);
  });
});

describe('enqueueDueOverdueReminders', () => {
  const baseReceivable = {
    id: 'rcv-1',
    companyId: 'co-1',
    receivableNumber: 'AR-001',
    customerName: 'Acme Ltd',
    currency: 'TZS',
    dueDate: new Date('2026-06-01T00:00:00Z'),
    outstandingAmount: new Prisma.Decimal('150000.00'),
    lastReminderAt: null,
    customer: { email: 'ap@acme.co.tz' },
  };

  it('claims each due receivable atomically (guard on observed lastReminderAt) and stamps now', async () => {
    const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      receivable: {
        findMany: jest.fn().mockResolvedValue([baseReceivable]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userCompanyAccess: { findMany: jest.fn().mockResolvedValue([{ userId: 'u-1' }]) },
    };
    const service = makeService({ prisma, email, notifications });

    const result = await service.enqueueDueOverdueReminders(25);

    expect(result.processed).toBe(1);
    expect(result.emailed).toBe(1);
    // The claim must be a compare-and-set on the exact value we read (null here).
    expect(prisma.receivable.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'rcv-1',
          companyId: 'co-1',
          lastReminderAt: null,
        }),
        data: expect.objectContaining({ lastReminderAt: expect.any(Date) }),
      }),
    );
    // Money is Decimal-formatted, never a float.
    expect(email.sendEmail).toHaveBeenCalledWith(
      'ap@acme.co.tz',
      expect.stringContaining('AR-001'),
      expect.stringContaining('TZS 150000.00'),
      expect.stringContaining('TZS 150000.00'),
    );
  });

  it('does NOT double-send when the atomic claim loses the race (count = 0)', async () => {
    const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      receivable: {
        findMany: jest.fn().mockResolvedValue([baseReceivable]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // another worker claimed it
      },
      userCompanyAccess: { findMany: jest.fn() },
    };
    const service = makeService({ prisma, email, notifications });

    const result = await service.enqueueDueOverdueReminders(25);

    expect(result.processed).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(notifications.sendNotification).not.toHaveBeenCalled();
  });

  it('selects only OPEN/PARTIALLY_PAID, past-due, positive-balance, stale-reminder receivables', async () => {
    const prisma = {
      receivable: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      userCompanyAccess: { findMany: jest.fn() },
    };
    const service = makeService({
      prisma,
      config: { AUTOMATION_OVERDUE_REMINDER_INTERVAL_HOURS: '72' },
    });

    await service.enqueueDueOverdueReminders(25);

    const where = prisma.receivable.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['OPEN', 'PARTIALLY_PAID'] });
    expect(where.deletedAt).toBeNull();
    expect(where.outstandingAmount).toEqual({ gt: 0 });
    expect(where.dueDate.lt).toBeInstanceOf(Date);
    // Idempotency window: never reminded OR reminded before the stale cutoff.
    expect(where.OR).toEqual([
      { lastReminderAt: null },
      { lastReminderAt: { lt: expect.any(Date) } },
    ]);
  });

  it('isolates a failing recipient so the rest of the batch still sends (side effects try/caught)', async () => {
    const r2 = {
      ...baseReceivable,
      id: 'rcv-2',
      receivableNumber: 'AR-002',
      customer: { email: 'ap@beta.co.tz' },
    };
    // First recipient's email throws; the second must still be processed.
    const email = {
      sendEmail: jest
        .fn()
        .mockRejectedValueOnce(new Error('smtp bounce'))
        .mockResolvedValue(undefined),
    };
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      receivable: {
        findMany: jest.fn().mockResolvedValue([baseReceivable, r2]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userCompanyAccess: { findMany: jest.fn().mockResolvedValue([{ userId: 'u-1' }]) },
    };
    const service = makeService({ prisma, email, notifications });

    const result = await service.enqueueDueOverdueReminders(25);

    // Both claimed; the first send failed but did not abort the batch.
    expect(result.processed).toBe(2);
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    // The second receivable's notification still fired despite the first failure.
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ linkedEntityId: 'rcv-2' }),
    );
  });

  it('still records the in-app notification when the customer has no email', async () => {
    const email = { sendEmail: jest.fn() };
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      receivable: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...baseReceivable, customer: { email: null } }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userCompanyAccess: { findMany: jest.fn().mockResolvedValue([{ userId: 'u-1' }]) },
    };
    const service = makeService({ prisma, email, notifications });

    const result = await service.enqueueDueOverdueReminders(25);

    expect(result.emailed).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'u-1',
        companyId: 'co-1',
        notificationType: 'PAYMENT_DUE',
        linkedEntityType: 'Receivable',
        linkedEntityId: 'rcv-1',
      }),
    );
  });
});

describe('enqueueDueLowStockAlerts', () => {
  const product = {
    id: 'prod-1',
    companyId: 'co-1',
    name: 'Cement 50kg',
    productCode: 'CEM-50',
    reorderLevel: new Prisma.Decimal('100'),
  };

  function prismaWith(opts: {
    products: any[];
    onHand: Array<{ productId: string; sum: string }>;
    recentAlerts?: any[];
    txCreated?: boolean;
  }) {
    const tx = {
      alertEvent: {
        findFirst: jest.fn().mockResolvedValue(opts.txCreated === false ? { id: 'a-x' } : null),
        create: jest.fn().mockResolvedValue({ id: 'a-new' }),
      },
    };
    return {
      tx,
      prisma: {
        product: { findMany: jest.fn().mockResolvedValue(opts.products) },
        inventoryBalance: {
          groupBy: jest.fn().mockResolvedValue(
            opts.onHand.map((o) => ({
              productId: o.productId,
              _sum: { quantityOnHand: new Prisma.Decimal(o.sum) },
            })),
          ),
        },
        alertEvent: {
          findMany: jest.fn().mockResolvedValue(opts.recentAlerts ?? []),
        },
        userCompanyAccess: { findMany: jest.fn().mockResolvedValue([{ userId: 'u-1' }]) },
        $transaction: jest.fn((cb: any) => cb(tx)),
      },
    };
  }

  it('creates a LOW_STOCK AlertEvent + notification when on-hand is at/below reorder level', async () => {
    const { prisma, tx } = prismaWith({
      products: [product],
      onHand: [{ productId: 'prod-1', sum: '80' }], // 80 <= 100 → alert
    });
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const service = makeService({ prisma, notifications });

    const result = await service.enqueueDueLowStockAlerts(25);

    expect(result.processed).toBe(1);
    expect(tx.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alertType: 'LOW_STOCK',
          companyId: 'co-1',
          linkedEntityType: 'Product',
          linkedEntityId: 'prod-1',
          status: 'OPEN',
        }),
      }),
    );
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ notificationType: 'INVENTORY_ALERT', linkedEntityId: 'prod-1' }),
    );
  });

  it('does NOT alert when on-hand is strictly above reorder level (Decimal compare)', async () => {
    const { prisma, tx } = prismaWith({
      products: [product],
      onHand: [{ productId: 'prod-1', sum: '100.0001' }], // just above 100
    });
    const notifications = { sendNotification: jest.fn() };
    const service = makeService({ prisma, notifications });

    const result = await service.enqueueDueLowStockAlerts(25);

    expect(result.processed).toBe(0);
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
    expect(notifications.sendNotification).not.toHaveBeenCalled();
  });

  it('is idempotent: skips products already alerted within the window', async () => {
    const { prisma, tx } = prismaWith({
      products: [product],
      onHand: [{ productId: 'prod-1', sum: '10' }],
      recentAlerts: [{ linkedEntityId: 'prod-1' }],
    });
    const notifications = { sendNotification: jest.fn() };
    const service = makeService({ prisma, notifications });

    const result = await service.enqueueDueLowStockAlerts(25);

    expect(result.processed).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
  });

  it('treats a product with no inventory balance as zero on-hand (below reorder)', async () => {
    const { prisma, tx } = prismaWith({
      products: [product],
      onHand: [], // no balance rows → 0 on hand
    });
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const service = makeService({ prisma, notifications });

    const result = await service.enqueueDueLowStockAlerts(25);

    expect(result.processed).toBe(1);
    expect(tx.alertEvent.create).toHaveBeenCalled();
  });

  it('respects the concurrent-create guard inside the transaction (skips if another worker won)', async () => {
    const { prisma, tx } = prismaWith({
      products: [product],
      onHand: [{ productId: 'prod-1', sum: '10' }],
      txCreated: false, // findFirst inside tx returns an existing event
    });
    const notifications = { sendNotification: jest.fn() };
    const service = makeService({ prisma, notifications });

    const result = await service.enqueueDueLowStockAlerts(25);

    expect(result.processed).toBe(0);
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
    expect(notifications.sendNotification).not.toHaveBeenCalled();
  });
});

describe('enqueueDueScheduledReports', () => {
  const report = {
    id: 'sr-1',
    scheduleCode: 'SR-AR-AGING',
    name: 'AR Aging',
    companyId: 'co-1',
    frequency: 'DAILY',
    recipients: { emails: ['fin@itemba-r.co.tz', 'not-an-email'] },
    nextRunAt: new Date('2026-06-30T00:00:00Z'),
  };

  // A real, active company member. run() persists ReportRun.requestedById and
  // DataExportLog.exportedById (FKs to User), so the principal MUST carry a real
  // user id — a fabricated one throws a Postgres FK violation.
  const companyMember = {
    accessLevel: 'MANAGE',
    user: { id: 'real-user-1', email: 'manager@itemba-r.co.tz' },
  };
  const groupUser = { id: 'real-group-1', email: 'director@itemba-r.co.tz' };

  it('claims the due window (CAS on nextRunAt), runs the report as a REAL company member, and emails valid recipients', async () => {
    const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const scheduledReports = {
      run: jest.fn().mockResolvedValue({ export: { filename: 'ar-aging.xls' } }),
    };
    const prisma = {
      scheduledReport: {
        findMany: jest.fn().mockResolvedValue([report]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userCompanyAccess: { findFirst: jest.fn().mockResolvedValue(companyMember) },
      user: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, email, scheduledReports });

    const result = await service.enqueueDueScheduledReports(25);

    expect(result.processed).toBe(1);
    // The company member is resolved from a REAL, active user with access.
    expect(prisma.userCompanyAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'co-1',
          user: { status: 'ACTIVE', deletedAt: null },
        }),
      }),
    );
    // CAS on the exact observed nextRunAt, advancing it to the next window.
    expect(prisma.scheduledReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'sr-1', nextRunAt: report.nextRunAt }),
        data: { nextRunAt: expect.any(Date) },
      }),
    );
    // Runs via the existing service with a REAL user id scoped to just this company.
    expect(scheduledReports.run).toHaveBeenCalledWith(
      'sr-1',
      expect.objectContaining({
        id: 'real-user-1',
        companyAccess: [{ companyId: 'co-1', accessLevel: 'MANAGE' }],
        roleScopes: [],
      }),
    );
    // Only the valid email is used; the junk string is filtered out.
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledWith(
      'fin@itemba-r.co.tz',
      expect.stringContaining('AR Aging'),
      expect.stringContaining('ar-aging.xls'),
      expect.any(String),
    );
  });

  it('does NOT re-run the same due window when the CAS claim is lost (count = 0)', async () => {
    const email = { sendEmail: jest.fn() };
    const scheduledReports = { run: jest.fn() };
    const prisma = {
      scheduledReport: {
        findMany: jest.fn().mockResolvedValue([report]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userCompanyAccess: { findFirst: jest.fn().mockResolvedValue(companyMember) },
      user: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, email, scheduledReports });

    const result = await service.enqueueDueScheduledReports(25);

    expect(result.processed).toBe(0);
    expect(scheduledReports.run).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('uses a REAL group-scoped user for group-level (companyId = null) reports', async () => {
    const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const scheduledReports = {
      run: jest.fn().mockResolvedValue({ export: { filename: 'grp.json' } }),
    };
    const prisma = {
      scheduledReport: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...report, companyId: null, recipients: ['ceo@itemba-r.co.tz'] }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(groupUser) },
      userCompanyAccess: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, email, scheduledReports });

    await service.enqueueDueScheduledReports(25);

    // The group principal is resolved from a real user holding a GROUP role.
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          deletedAt: null,
          userRoles: { some: { role: { scope: 'GROUP' } } },
        }),
      }),
    );
    expect(scheduledReports.run).toHaveBeenCalledWith(
      'sr-1',
      expect.objectContaining({
        id: 'real-group-1',
        roleScopes: ['GROUP'],
        companyAccess: [],
      }),
    );
    expect(email.sendEmail).toHaveBeenCalledWith(
      'ceo@itemba-r.co.tz',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('SKIPS gracefully (no claim, no burned window) when no usable user exists for the company', async () => {
    const email = { sendEmail: jest.fn() };
    const scheduledReports = { run: jest.fn() };
    const prisma = {
      scheduledReport: {
        findMany: jest.fn().mockResolvedValue([report]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userCompanyAccess: { findFirst: jest.fn().mockResolvedValue(null) }, // no member
      user: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, email, scheduledReports });

    const result = await service.enqueueDueScheduledReports(25);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    // The due window is left intact — nextRunAt is never advanced.
    expect(prisma.scheduledReport.updateMany).not.toHaveBeenCalled();
    expect(scheduledReports.run).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('SKIPS group-level report (no advance) when no GROUP-scoped user exists', async () => {
    const scheduledReports = { run: jest.fn() };
    const prisma = {
      scheduledReport: {
        findMany: jest.fn().mockResolvedValue([{ ...report, companyId: null }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) }, // no group user
      userCompanyAccess: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, scheduledReports });

    const result = await service.enqueueDueScheduledReports(25);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.scheduledReport.updateMany).not.toHaveBeenCalled();
    expect(scheduledReports.run).not.toHaveBeenCalled();
  });

  it('RE-ARMS nextRunAt back to the observed value when run() throws (window retried, not lost)', async () => {
    const email = { sendEmail: jest.fn() };
    const scheduledReports = { run: jest.fn().mockRejectedValue(new Error('materialize failed')) };
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // claim advances nextRunAt
      .mockResolvedValueOnce({ count: 1 }); // re-arm restores it
    const prisma = {
      scheduledReport: {
        findMany: jest.fn().mockResolvedValue([report]),
        updateMany,
      },
      userCompanyAccess: { findFirst: jest.fn().mockResolvedValue(companyMember) },
      user: { findFirst: jest.fn() },
    };
    const service = makeService({ prisma, email, scheduledReports });

    const result = await service.enqueueDueScheduledReports(25);

    // Not counted as processed since the run failed and the window was restored.
    expect(result.processed).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
    // Two updateMany calls: (1) claim advancing nextRunAt, (2) re-arm restoring it.
    expect(updateMany).toHaveBeenCalledTimes(2);
    const claimCall = updateMany.mock.calls[0][0];
    const rearmCall = updateMany.mock.calls[1][0];
    // Claim advanced nextRunAt off the observed value.
    expect(claimCall.where.nextRunAt).toEqual(report.nextRunAt);
    expect(claimCall.data.nextRunAt).not.toEqual(report.nextRunAt);
    // Re-arm restores the observed value, guarded on the value the claim wrote.
    expect(rearmCall.where.nextRunAt).toEqual(claimCall.data.nextRunAt);
    expect(rearmCall.data.nextRunAt).toEqual(report.nextRunAt);
  });

  it('short-circuits cleanly when ScheduledReportsService is not wired in', async () => {
    const prisma = { scheduledReport: { findMany: jest.fn(), updateMany: jest.fn() } };
    const service = makeService({ prisma }); // no scheduledReports collaborator

    const result = await service.enqueueDueScheduledReports(25);

    expect(result.processed).toBe(0);
    expect(result.note).toContain('ScheduledReportsService not available');
    expect(prisma.scheduledReport.findMany).not.toHaveBeenCalled();
  });
});
