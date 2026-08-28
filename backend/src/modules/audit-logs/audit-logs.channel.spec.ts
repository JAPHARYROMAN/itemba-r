/**
 * Channel attribution — the audit trail must record what drove an action, not
 * only whose authority it used.
 *
 * The distinction only matters once something other than a person can act under
 * a user's permissions, which is why these tests exist before that something
 * does: `userId` alone cannot answer "did I do this, or did I ask for it?"
 */

import { AuditChannel, AuditScopeKind, AuditSeverity } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';

type CreateArgs = { data: Record<string, unknown> };

function makeService() {
  const create = jest.fn().mockResolvedValue({});
  const prisma = { auditLog: { create } };
  const service = new AuditLogsService(prisma as never);
  return { service, create, dataOf: () => (create.mock.calls[0][0] as CreateArgs).data };
}

describe('AuditLogsService.log — channel attribution', () => {
  it('defaults to WEB when the caller says nothing', async () => {
    const { service, dataOf } = makeService();
    await service.log({ action: 'LOGIN', entityType: 'User', userId: 'u1' });
    expect(dataOf().channel).toBe(AuditChannel.WEB);
  });

  it('records the channel the caller declares', async () => {
    for (const channel of [AuditChannel.API, AuditChannel.SYSTEM, AuditChannel.AGENT]) {
      const { service, dataOf } = makeService();
      await service.log({ action: 'PAYABLE_CREATE', entityType: 'Payable', channel });
      expect(dataOf().channel).toBe(channel);
    }
  });

  it('keeps userId and channel independent — an agent acts as a real user', async () => {
    const { service, dataOf } = makeService();
    await service.log({
      action: 'PURCHASE_ORDER_CREATE',
      entityType: 'PurchaseOrder',
      userId: 'u1',
      channel: AuditChannel.AGENT,
      agentSessionId: 'sess-1',
    });
    const data = dataOf();
    // Whose authority was used, and what exercised it, are both recorded.
    expect(data.userId).toBe('u1');
    expect(data.channel).toBe(AuditChannel.AGENT);
    expect(data.agentSessionId).toBe('sess-1');
  });

  it('correlates an agent run so it can be reviewed or reversed as a unit', async () => {
    const { service, create } = makeService();
    await service.log({
      action: 'A',
      entityType: 'X',
      channel: AuditChannel.AGENT,
      agentSessionId: 'run-7',
    });
    await service.log({
      action: 'B',
      entityType: 'Y',
      channel: AuditChannel.AGENT,
      agentSessionId: 'run-7',
    });
    const sessions = create.mock.calls.map((c) => (c[0] as CreateArgs).data.agentSessionId);
    expect(sessions).toEqual(['run-7', 'run-7']);
  });

  it('drops a session id that did not come from the agent path', async () => {
    // A correlation id on a non-agent row would make the trail assert a
    // relationship that does not exist. Better to lose the field than to lie.
    const { service, dataOf } = makeService();
    await service.log({
      action: 'INVOICE_CREATE',
      entityType: 'Invoice',
      channel: AuditChannel.WEB,
      agentSessionId: 'smuggled',
    });
    expect(dataOf().agentSessionId).toBeUndefined();
  });

  it('leaves severity derivation untouched', async () => {
    const { service, dataOf } = makeService();
    await service.log({
      action: 'PERMISSION_CHANGE',
      entityType: 'Role',
      channel: AuditChannel.AGENT,
      agentSessionId: 's1',
    });
    // Channel is a new axis, not a replacement for severity.
    expect(dataOf().severity).toBe(AuditSeverity.CRITICAL);
  });

  it.each(['VIEW_SENSITIVE', 'VIEW_SENSITIVE_DENIED'])(
    'classifies %s as a critical security event',
    async (action) => {
      const { service, dataOf } = makeService();
      await service.log({ action, entityType: 'Contract', scopeKind: AuditScopeKind.GROUP });
      expect(dataOf().severity).toBe(AuditSeverity.CRITICAL);
    },
  );

  it('warns, but still writes, when an agent entry has no run to correlate to', async () => {
    const { service, dataOf } = makeService();
    const warn = jest
      .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await service.log({
      action: 'PO_CREATE',
      entityType: 'PurchaseOrder',
      channel: AuditChannel.AGENT,
    });

    // Losing the action would be worse than losing the correlation.
    expect(dataOf().channel).toBe(AuditChannel.AGENT);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentSessionId'));
    warn.mockRestore();
  });

  it('still never throws — audit failure must not block the business operation', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new AuditLogsService({ auditLog: { create } } as never);
    await expect(
      service.log({ action: 'X', entityType: 'Y', channel: AuditChannel.AGENT }),
    ).resolves.toBeUndefined();
  });

  it('propagates the same append failure from logStrict for fail-closed callers', async () => {
    const failure = new Error('mandatory audit unavailable');
    const create = jest.fn().mockRejectedValue(failure);
    const service = new AuditLogsService({ auditLog: { create } } as never);

    await expect(
      service.logStrict({ action: 'SENSITIVE_READ', entityType: 'Contract' }),
    ).rejects.toBe(failure);
  });

  it('rejects malformed explicit scope in logStrict before attempting the append', async () => {
    const { service, create } = makeService();

    await expect(
      service.logStrict({
        action: 'SENSITIVE_READ',
        entityType: 'Contract',
        scopeKind: AuditScopeKind.MULTI_COMPANY,
        companyScopeIds: ['only-one-company'],
      }),
    ).rejects.toThrow('MULTI_COMPANY scope requires at least two');
    expect(create).not.toHaveBeenCalled();
  });

  it('warns and appends UNATTRIBUTED for malformed best-effort scope', async () => {
    const { service, create, dataOf } = makeService();
    const warn = jest
      .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await service.log({
      action: 'LEGACY_EVENT',
      entityType: 'Contract',
      scopeKind: AuditScopeKind.COMPANY,
      companyScopeIds: [],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(dataOf().scopeKind).toBe(AuditScopeKind.UNATTRIBUTED);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('COMPANY scope requires'));
    warn.mockRestore();
  });
});
