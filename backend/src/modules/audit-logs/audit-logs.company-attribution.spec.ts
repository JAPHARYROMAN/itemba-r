import { AuditLogsService } from './audit-logs.service';
import { AuditAttributionStatus, AuditChannel, AuditScopeKind } from '@prisma/client';
import {
  recordValidatedCompanyScope,
  runWithRequestContext,
} from '../../common/context/request-context';

describe('AuditLogsService company attribution', () => {
  function makeService(delegates: Record<string, unknown> = {}) {
    const create = jest.fn().mockResolvedValue({});
    return {
      service: new AuditLogsService({ auditLog: { create }, ...delegates } as never),
      data: () => create.mock.calls[0][0].data,
    };
  }

  it('derives one company from a trusted pre-action snapshot', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'UPDATE',
      entityType: 'Customer',
      entityId: 'customer-1',
      oldValue: { companyId: 'company-1', name: 'Before' },
      newValue: { company: { id: 'untrusted-request-company' }, name: 'After' },
    });

    expect(data().companyId).toBe('company-1');
  });

  it('never derives a company from newValue request data', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'UPDATE',
      entityType: 'Customer',
      newValue: { companyId: 'company-2' },
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.UNATTRIBUTED,
        attributionStatus: AuditAttributionStatus.FAILED,
        companyScopes: undefined,
      }),
    );
  });

  it('lets an explicit global null override snapshot inference', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'GROUP_POLICY_UPDATE',
      entityType: 'Policy',
      companyId: null,
      newValue: { companyId: 'company-1' },
    });

    expect(data().companyId).toBeNull();
    expect(data().scopeKind).toBe(AuditScopeKind.GLOBAL);
    expect(data().attributionStatus).toBe(AuditAttributionStatus.EXPLICIT);
  });

  it('preserves an existing explicit companyId caller as an immutable company snapshot', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'CREATE',
      entityType: 'Customer',
      companyId: 'company-explicit',
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: 'company-explicit',
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: { create: [{ companyId: 'company-explicit' }] },
      }),
    );
  });

  it('persists a modern explicit company scope and its immutable company snapshot', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'CREATE',
      entityType: 'StatutoryDeductionRule',
      scopeKind: AuditScopeKind.COMPANY,
      companyScopeIds: ['company-explicit'],
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: 'company-explicit',
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: { create: [{ companyId: 'company-explicit' }] },
      }),
    );
  });

  it('persists a modern explicit global scope without a company snapshot', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'CREATE',
      entityType: 'TaxAuthority',
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.GLOBAL,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: undefined,
      }),
    );
  });

  it('records an explicit group action without conflating it with global or unattributed', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'GROUP_POLICY_UPDATE',
      entityType: 'Policy',
      scopeKind: AuditScopeKind.GROUP,
      companyScopeIds: [],
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.GROUP,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: undefined,
      }),
    );
  });

  it('binds a Company entity action to the affected company id', async () => {
    const { service, data } = makeService();
    await service.log({ action: 'COMPANY_UPDATE', entityType: 'Company', entityId: 'company-1' });
    expect(data().companyId).toBe('company-1');
    expect(data()).toEqual(
      expect.objectContaining({
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.RESOLVED,
        companyScopes: { create: [{ companyId: 'company-1' }] },
      }),
    );
  });

  it('records application-policy-proven ambient scope as explicit attribution', async () => {
    const { service, data } = makeService();

    await runWithRequestContext({ channel: AuditChannel.AGENT, agentSessionId: 'agent-1' }, () => {
      recordValidatedCompanyScope('COMPANY', ['company-policy']);
      return service.log({ action: 'CREATE', entityType: 'EmployeeAssignment' });
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: 'company-policy',
        companyScopes: { create: [{ companyId: 'company-policy' }] },
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
      }),
    );
  });

  it('never promotes a caller-supplied metadata company into the foreign key', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'VIEW_SENSITIVE_DENIED',
      entityType: 'Contract',
      metadata: { requestedCompanyId: 'untrusted-company' },
    });
    expect(data().companyId).toBeNull();
    expect(data().scopeKind).toBe(AuditScopeKind.UNATTRIBUTED);
  });

  it('resolves a direct company from the persisted affected entity', async () => {
    const findUnique = jest.fn().mockResolvedValue({ companyId: 'company-1' });
    const { service, data } = makeService({ customer: { findUnique } });
    await service.log({ action: 'DELETE', entityType: 'Customer', entityId: 'customer-1' });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      select: { companyId: true },
    });
    expect(data().companyId).toBe('company-1');
    expect(data().companyScopes).toEqual({ create: [{ companyId: 'company-1' }] });
  });

  it('writes an explicit multi-company scope atomically without choosing a lossy primary FK', async () => {
    const { service, data } = makeService();
    await service.log({
      action: 'GROUP_REPORT_EXPORT',
      entityType: 'ReportRun',
      companyId: 'legacy-primary-is-not-authoritative',
      scopeKind: AuditScopeKind.MULTI_COMPANY,
      companyScopeIds: ['company-2', 'company-1', 'company-2'],
    });

    expect(data()).toEqual(
      expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.MULTI_COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: {
          create: [{ companyId: 'company-2' }, { companyId: 'company-1' }],
        },
      }),
    );
  });

  it('retries an explicitly soft-deleted entity without the live-only filter', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ companyId: 'company-deleted' });
    const { service, data } = makeService({ customer: { findUnique } });
    await service.log({ action: 'DELETE', entityType: 'Customer', entityId: 'customer-deleted' });

    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'customer-deleted' },
      select: { companyId: true },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'customer-deleted', deletedAt: { not: null } },
      select: { companyId: true },
    });
    expect(data().companyId).toBe('company-deleted');
  });

  it('keeps the trusted old snapshot fallback when the entity was hard-deleted', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const { service, data } = makeService({ customer: { findUnique } });
    await service.log({
      action: 'DELETE',
      entityType: 'Customer',
      entityId: 'customer-hard-deleted',
      oldValue: { id: 'customer-hard-deleted', companyId: 'company-before-delete' },
      newValue: { companyId: 'untrusted-request-company' },
    });

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(data().companyId).toBe('company-before-delete');
  });

  it('prefers persisted state over a conflicting newValue DTO company', async () => {
    const findUnique = jest.fn().mockResolvedValue({ companyId: 'company-1' });
    const { service, data } = makeService({ customer: { findUnique } });
    await service.log({
      action: 'UPDATE',
      entityType: 'Customer',
      entityId: 'customer-1',
      newValue: { companyId: 'attacker-selected-company' },
    });

    expect(data().companyId).toBe('company-1');
  });

  it('resolves reviewed parent-company paths for child and indirect entities', async () => {
    const findUnique = jest.fn().mockResolvedValue({ division: { companyId: 'company-1' } });
    const { service, data } = makeService({ branch: { findUnique } });
    await service.log({ action: 'BRANCH_UPDATE', entityType: 'Branch', entityId: 'branch-1' });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'branch-1' },
      select: { division: { select: { companyId: true } } },
    });
    expect(data().companyId).toBe('company-1');
  });

  it('still writes the audit when persisted company enrichment is unavailable', async () => {
    const findUnique = jest.fn().mockRejectedValue(new Error('read unavailable'));
    const { service, data } = makeService({ customer: { findUnique } });
    await service.log({ action: 'DELETE', entityType: 'Customer', entityId: 'customer-1' });
    expect(data().companyId).toBeNull();
    expect(data().attributionStatus).toBe(AuditAttributionStatus.FAILED);
  });

  it('uses the caller transaction for a fail-closed company-scoped append', async () => {
    const rootCreate = jest.fn().mockResolvedValue({});
    const transactionCreate = jest.fn().mockResolvedValue({});
    const service = new AuditLogsService({ auditLog: { create: rootCreate } } as never);

    await service.logStrictInTransaction({ auditLog: { create: transactionCreate } } as never, {
      action: 'MSAIDIZI_ERP_READ_REQUESTED',
      entityType: 'MsaidiziToolAttempt',
      entityId: 'attempt-1',
      companyId: 'company-1',
      channel: AuditChannel.AGENT,
      agentSessionId: 'task_task1',
      taskId: 'task-1',
    });

    expect(rootCreate).not.toHaveBeenCalled();
    expect(transactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: { create: [{ companyId: 'company-1' }] },
        taskId: 'task-1',
      }),
    });
  });

  it('writes an explicit global transaction scope without company children', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditLogsService({ auditLog: { create: jest.fn() } } as never);

    await service.logStrictInTransaction({ auditLog: { create } } as never, {
      action: 'MSAIDIZI_AUTOPILOT_DISABLED',
      entityType: 'MsaidiziPrincipal',
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.GLOBAL,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: undefined,
      }),
    });
  });

  it('rejects malformed transaction scope before writing state-adjacent audit evidence', async () => {
    const create = jest.fn();
    const service = new AuditLogsService({ auditLog: { create: jest.fn() } } as never);

    await expect(
      service.logStrictInTransaction({ auditLog: { create } } as never, {
        action: 'MSAIDIZI_ERP_READ_REQUESTED',
        entityType: 'MsaidiziToolAttempt',
        scopeKind: AuditScopeKind.COMPANY,
        companyScopeIds: [],
      }),
    ).rejects.toThrow('COMPANY scope requires exactly one companyScopeId');
    expect(create).not.toHaveBeenCalled();
  });

  it('applies the same DLP and ambient attribution on the transaction path', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditLogsService({ auditLog: { create: jest.fn() } } as never);

    await runWithRequestContext(
      {
        channel: AuditChannel.AGENT,
        agentSessionId: 'task_ambient',
        principalType: 'MSAIDIZI',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'user-1',
        taskId: 'task-1',
        stepId: 'step-1',
        deviceId: 'device-1',
      },
      () =>
        service.logStrictInTransaction({ auditLog: { create } } as never, {
          action: 'MSAIDIZI_HOST_ACTION_SETTLED',
          entityType: 'MsaidiziHostAction',
          companyId: 'company-1',
          newValue: { password: 'do-not-persist', nested: { apiKey: 'do-not-persist' } },
        }),
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: AuditChannel.AGENT,
        agentSessionId: 'task_ambient',
        principalType: 'MSAIDIZI',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'user-1',
        taskId: 'task-1',
        stepId: 'step-1',
        deviceId: 'device-1',
        newValue: { password: '[REDACTED]', nested: { apiKey: '[REDACTED]' } },
      }),
    });
  });
});
