import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditChannel,
  AuditScopeKind,
  AuditSeverity,
  MsaidiziEffect,
  MsaidiziTaskMode,
} from '@prisma/client';
import { PermissionCacheService } from '../../../common/services';
import { exactActionEnvelopeDigest } from '../../../common/utils/action-envelope';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { JwtPayload } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy Msaidizi task delegation', () => {
  it('uses live human permissions intersected with the principal ceiling for Collaborative work', async () => {
    const harness = strategy({
      task: task(MsaidiziTaskMode.COLLABORATIVE, {
        scope: 'GROUP',
        permissions: ['expenses.read', 'expenses.write'],
      }),
      user: human('ACTIVE', [['expenses.read', 'customers.read']]),
    });

    const result = await harness.strategy.validate(payload());

    // expenses.write was revoked from the human and customers.read exceeds the
    // principal grant: neither survives the live intersection.
    expect(result.permissions).toEqual(['expenses.read']);
    expect(result).toMatchObject({
      id: 'user-1',
      roles: ['MSAIDIZI_SERVICE'],
      roleScopes: ['COMPANY'],
      role: { scope: 'COMPANY' },
      principalType: 'SERVICE',
      principalId: 'principal-1',
      initiatedByUserId: 'user-1',
      taskId: 'task-1',
      stepId: 'step-1',
      planVersion: 1,
      taskCapability: 'ExpensesController.findAll',
      taskArgsDigest: digest(),
    });
    expect(harness.permissionFindMany).not.toHaveBeenCalled();
    expect(harness.companyFindMany).not.toHaveBeenCalled();
    expect(harness.permissionCache.get).not.toHaveBeenCalled();
  });

  it('projects only live task-company access for a delegate whose primary company differs', async () => {
    const delegate = human('ACTIVE', [['expenses.read']]);
    delegate.companyId = 'company-b';
    delegate.companyAccess = [
      { companyId: 'company-a', accessLevel: 'WRITE' },
      { companyId: 'company-b', accessLevel: 'MANAGE' },
    ];
    delegate.divisionAccess = [
      {
        divisionId: 'division-a',
        accessLevel: 'WRITE',
        division: { companyId: 'company-a' },
      },
      {
        divisionId: 'division-b',
        accessLevel: 'MANAGE',
        division: { companyId: 'company-b' },
      },
    ];
    delegate.branchAccess = [
      {
        branchId: 'branch-a',
        accessLevel: 'READ',
        branch: { division: { companyId: 'company-a' } },
      },
      {
        branchId: 'branch-b',
        accessLevel: 'WRITE',
        branch: { division: { companyId: 'company-b' } },
      },
    ];
    const boundTask = task(MsaidiziTaskMode.COLLABORATIVE, {
      scope: 'COMPANY',
      permissions: ['expenses.read'],
    });
    boundTask.companyId = 'company-a';
    const harness = strategy({ task: boundTask, user: delegate });

    const result = await harness.strategy.validate(payload());

    expect(result.companyId).toBe('company-a');
    expect(result.companyAccess).toEqual([{ companyId: 'company-a', accessLevel: 'WRITE' }]);
    expect(result.divisionAccess).toEqual([{ divisionId: 'division-a', accessLevel: 'WRITE' }]);
    expect(result.branchAccess).toEqual([{ branchId: 'branch-a', accessLevel: 'READ' }]);
    expect(result.permissions).toEqual(['expenses.read']);
  });

  it('rejects a task company outside the delegate live company access', async () => {
    const delegate = human('ACTIVE', [['expenses.read']]);
    delegate.companyId = 'company-b';
    delegate.companyAccess = [{ companyId: 'company-b', accessLevel: 'MANAGE' }];
    delegate.divisionAccess = [
      {
        divisionId: 'division-b',
        accessLevel: 'MANAGE',
        division: { companyId: 'company-b' },
      },
    ];
    delegate.branchAccess = [
      {
        branchId: 'branch-b',
        accessLevel: 'WRITE',
        branch: { division: { companyId: 'company-b' } },
      },
    ];
    const boundTask = task(MsaidiziTaskMode.COLLABORATIVE, {
      scope: 'COMPANY',
      permissions: ['expenses.read'],
    });
    boundTask.companyId = 'company-a';
    const harness = strategy({ task: boundTask, user: delegate });

    await expect(harness.strategy.validate(payload())).rejects.toThrow(
      'Initiating account has no active task-company access',
    );

    expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.auditStrictInTransaction).toHaveBeenCalledTimes(1);
    expectTaskCredentialDenial(harness.auditStrictInTransaction, {
      companyId: 'company-a',
      reason: 'Initiating account has no active task-company access',
    });
  });

  it('intersects a broad human role with a narrower principal scope ceiling', async () => {
    const broadHuman = human('ACTIVE', [['expenses.read']]);
    broadHuman.userRoles[0].role.scope = 'GROUP';
    const harness = strategy({
      task: task(MsaidiziTaskMode.ASK, {
        scope: 'COMPANY',
        permissions: ['expenses.read'],
      }),
      user: broadHuman,
    });

    const result = await harness.strategy.validate(payload());
    expect(result.roleScopes).toEqual(['COMPANY']);
    expect(result.role).toEqual({ scope: 'COMPANY' });
  });

  it('rejects ASK and Collaborative execution when the initiating human is inactive', async () => {
    for (const mode of [MsaidiziTaskMode.ASK, MsaidiziTaskMode.COLLABORATIVE]) {
      const harness = strategy({
        task: task(mode, { scope: 'GROUP', permissions: ['expenses.read'] }),
        user: human('INACTIVE', [['expenses.read']]),
      });
      await expect(harness.strategy.validate(payload())).rejects.toThrow(
        new UnauthorizedException('Initiating account is not active'),
      );
    }
  });

  it('rejects running Collaborative and Autopilot tasks after deployment grant revocation', async () => {
    for (const mode of [MsaidiziTaskMode.COLLABORATIVE, MsaidiziTaskMode.AUTOPILOT]) {
      const running = task(mode, {
        scope: 'GROUP',
        permissions: ['expenses.read'],
      });
      if (mode === MsaidiziTaskMode.AUTOPILOT) {
        running.mandateId = 'mandate-1';
        running.mandate = activeMandate();
      }
      const harness = strategy({
        task: running,
        user: human('ACTIVE', [['expenses.read']]),
        deploymentGrants: ['customers.read'],
      });

      await expect(
        harness.strategy.validate(
          payload(mode === MsaidiziTaskMode.AUTOPILOT ? { mandateId: 'mandate-1' } : {}),
        ),
      ).rejects.toThrow('Autonomous task deployment grant is no longer active');
      expect(harness.userFindUnique).not.toHaveBeenCalled();
    }
  });

  it('narrows a persisted principal snapshot to the current deployment grant ceiling', async () => {
    const harness = strategy({
      task: task(MsaidiziTaskMode.COLLABORATIVE, {
        scope: 'GROUP',
        permissions: ['expenses.read', 'expenses.write'],
      }),
      user: human('ACTIVE', [['expenses.read', 'expenses.write']]),
      deploymentGrants: ['expenses.read'],
    });

    const result = await harness.strategy.validate(payload());
    expect(result.permissions).toEqual(['expenses.read']);
  });

  it('never borrows the principal creator when the task initiator was deleted', async () => {
    for (const mode of [MsaidiziTaskMode.COLLABORATIVE, MsaidiziTaskMode.AUTOPILOT]) {
      const orphaned = task(mode, { scope: 'GROUP', permissions: ['expenses.read'] });
      orphaned.initiatedByUserId = null;
      if (mode === MsaidiziTaskMode.AUTOPILOT) {
        orphaned.mandateId = 'mandate-1';
        orphaned.mandate = activeMandate();
      }
      const harness = strategy({ task: orphaned, user: { id: 'user-1' } });

      await expect(
        harness.strategy.validate(
          payload(mode === MsaidiziTaskMode.AUTOPILOT ? { mandateId: 'mandate-1' } : {}),
        ),
      ).rejects.toThrow('Autonomous task has no valid record anchor');
      expect(harness.userFindUnique).not.toHaveBeenCalled();
    }
  });

  it('keeps Autopilot on global principal grants and group scope even if the anchor is inactive', async () => {
    const autopilotTask = task(MsaidiziTaskMode.AUTOPILOT, {
      scope: 'GROUP',
      permissions: ['*'],
    });
    autopilotTask.mandateId = 'mandate-1';
    autopilotTask.mandate = activeMandate();
    const harness = strategy({
      task: autopilotTask,
      // Autopilot needs a durable FK anchor, not the human authorization
      // projection. The selected row intentionally has no status field.
      user: { id: 'user-1' },
      allPermissions: ['expenses.read', 'expenses.write'],
      companies: ['company-1', 'company-2'],
    });

    const result = await harness.strategy.validate(payload({ mandateId: 'mandate-1' }));

    expect(result).toMatchObject({
      roles: ['MSAIDIZI_SERVICE'],
      roleScopes: ['GROUP'],
      role: { scope: 'GROUP' },
      permissions: ['expenses.read', 'expenses.write'],
      companyAccess: [
        { companyId: 'company-1', accessLevel: 'MANAGE' },
        { companyId: 'company-2', accessLevel: 'MANAGE' },
      ],
      principalType: 'SERVICE',
      taskId: 'task-1',
      stepId: 'step-1',
      taskCapability: 'ExpensesController.findAll',
      taskArgsDigest: digest(),
    });
    expect(harness.permissionFindMany).toHaveBeenCalledTimes(1);
    expect(harness.companyFindMany).toHaveBeenCalledTimes(1);
  });

  it('requires the active mandate to grant the exact Autopilot step tuple', async () => {
    const mismatches = [
      { ...grant(), capability: 'CustomersController.findAll' },
      { ...grant(), version: '2' },
      { ...grant(), effects: [MsaidiziEffect.WRITE] },
      { ...grant(), dataClasses: ['restricted'] },
    ];
    for (const mismatchedGrant of mismatches) {
      const autopilotTask = task(MsaidiziTaskMode.AUTOPILOT, {
        scope: 'GROUP',
        permissions: ['expenses.read'],
      });
      autopilotTask.mandateId = 'mandate-1';
      autopilotTask.mandate = activeMandate({ capabilities: [mismatchedGrant] });
      const harness = strategy({ task: autopilotTask, user: { id: 'user-1' } });

      await expect(harness.strategy.validate(payload({ mandateId: 'mandate-1' }))).rejects.toThrow(
        'Autonomous task step is outside the active mandate',
      );
      expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(1);
      expect(harness.auditStrictInTransaction).toHaveBeenCalledTimes(1);
      expectTaskCredentialDenial(harness.auditStrictInTransaction, {
        mandateId: 'mandate-1',
        reason: 'Autonomous task step is outside the active mandate',
      });
      expect(harness.userFindUnique).not.toHaveBeenCalled();
    }
  });

  it('fails closed when any stored mandate grant is malformed', async () => {
    const autopilotTask = task(MsaidiziTaskMode.AUTOPILOT, {
      scope: 'GROUP',
      permissions: ['expenses.read'],
    });
    autopilotTask.mandateId = 'mandate-1';
    autopilotTask.mandate = activeMandate({
      capabilities: [grant(), { capability: 'malformed', effects: [MsaidiziEffect.READ] }],
    });
    const harness = strategy({ task: autopilotTask, user: { id: 'user-1' } });

    await expect(harness.strategy.validate(payload({ mandateId: 'mandate-1' }))).rejects.toThrow(
      'Autonomous task step is outside the active mandate',
    );
    expect(harness.userFindUnique).not.toHaveBeenCalled();
  });

  it('rejects an Autopilot task whose persisted budget exceeds the current mandate ceiling', async () => {
    const autopilotTask = task(MsaidiziTaskMode.AUTOPILOT, {
      scope: 'GROUP',
      permissions: ['expenses.read'],
    });
    autopilotTask.maxMutations = 2;
    autopilotTask.mandateId = 'mandate-1';
    autopilotTask.mandate = activeMandate({ budgets: { maxMutations: 1 } });
    const harness = strategy({ task: autopilotTask, user: { id: 'user-1' } });

    await expect(harness.strategy.validate(payload({ mandateId: 'mandate-1' }))).rejects.toThrow(
      'Autonomous task budget exceeds the active mandate',
    );
    expect(harness.userFindUnique).not.toHaveBeenCalled();
  });

  it('still rejects a changed exact action digest before projecting either identity', async () => {
    const harness = strategy({
      task: task(MsaidiziTaskMode.COLLABORATIVE, {
        scope: 'GROUP',
        permissions: ['expenses.read'],
      }),
      user: human('ACTIVE', [['expenses.read']]),
    });
    await expect(
      harness.strategy.validate(payload({ argsDigest: '0'.repeat(64) })),
    ).rejects.toThrow('Autonomous task action binding changed');
    expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.auditStrictInTransaction).toHaveBeenCalledTimes(1);
    expectTaskCredentialDenial(harness.auditStrictInTransaction, {
      argsDigest: '0'.repeat(64),
      reason: 'Autonomous task action binding changed',
    });
    expect(harness.userFindUnique).not.toHaveBeenCalled();
  });

  it('atomically permits only one concurrent presentation and strictly audits the replay', async () => {
    const harness = strategy({
      task: task(MsaidiziTaskMode.COLLABORATIVE, {
        scope: 'GROUP',
        permissions: ['expenses.read'],
      }),
      user: human('ACTIVE', [['expenses.read']]),
    });
    let available = true;
    harness.attemptUpdateMany.mockImplementation(async () => {
      await Promise.resolve();
      if (!available) return { count: 0 };
      available = false;
      return { count: 1 };
    });

    const results = await Promise.allSettled([
      harness.strategy.validate(payload()),
      harness.strategy.validate(payload()),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toEqual(
      new UnauthorizedException('Task token has already been consumed'),
    );
    expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(2);
    expect(harness.taskFindUnique).toHaveBeenCalledTimes(2);
    expect(harness.auditStrictInTransaction).toHaveBeenCalledTimes(1);
    expectTaskCredentialDenial(harness.auditStrictInTransaction, {
      reason: 'Task token has already been consumed',
      stage: 'one_shot',
    });
  });

  it.each([
    ['disabled deployment', { autonomyEnabled: 'false', killSwitch: 'false' }],
    ['active global kill switch', { autonomyEnabled: 'true', killSwitch: 'true' }],
  ])(
    'consumes and audits a first presentation when autonomy is blocked by %s',
    async (_, flags) => {
      const harness = strategy({
        task: task(MsaidiziTaskMode.COLLABORATIVE, {
          scope: 'GROUP',
          permissions: ['expenses.read'],
        }),
        user: human('ACTIVE', [['expenses.read']]),
        ...flags,
      });

      await expect(harness.strategy.validate(payload())).rejects.toThrow(
        'Autonomous task credentials are disabled',
      );

      expect(harness.transaction).toHaveBeenCalledTimes(1);
      expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(1);
      // Live-policy validation stops at configuration; the only task lookup is
      // the audit scope projection executed inside the same transaction.
      expect(harness.taskFindUnique).toHaveBeenCalledTimes(1);
      expect(harness.auditStrictInTransaction).toHaveBeenCalledTimes(1);
      expectTaskCredentialDenial(harness.auditStrictInTransaction, {
        reason: 'Autonomous task credentials are disabled',
      });
    },
  );
});

function strategy(options: {
  task: ReturnType<typeof task>;
  user: Record<string, unknown>;
  allPermissions?: string[];
  companies?: string[];
  deploymentGrants?: string[];
  autonomyEnabled?: string;
  killSwitch?: string;
}) {
  const userFindUnique = jest.fn().mockResolvedValue(options.user);
  const permissionFindMany = jest
    .fn()
    .mockResolvedValue((options.allPermissions ?? []).map((code) => ({ code })));
  const companyFindMany = jest
    .fn()
    .mockResolvedValue((options.companies ?? []).map((id) => ({ id })));
  const attemptUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const attemptFindFirst = jest.fn().mockResolvedValue({
    argsDigest: digest(),
    resolvedInputProvenance: null,
    inputProvenanceSha256: null,
  });
  const taskFindUnique = jest.fn().mockResolvedValue(options.task);
  const auditStrictInTransaction = jest.fn().mockResolvedValue(undefined);
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    msaidiziTask: { findUnique: taskFindUnique },
    msaidiziToolAttempt: { updateMany: attemptUpdateMany, findFirst: attemptFindFirst },
    msaidiziPlanVersion: { findUnique: jest.fn().mockResolvedValue({ version: 1 }) },
    user: { findUnique: userFindUnique },
    permission: { findMany: permissionFindMany },
    company: { findMany: companyFindMany },
  };
  transaction.mockImplementation(async (callback: (client: typeof prisma) => Promise<unknown>) =>
    callback(prisma),
  );
  const config = {
    getOrThrow: jest.fn().mockReturnValue('a-secure-test-access-secret'),
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'MSAIDIZI_AUTONOMY_ENABLED') return options.autonomyEnabled ?? 'true';
      if (key === 'MSAIDIZI_GLOBAL_KILL_SWITCH') return options.killSwitch ?? 'false';
      if (key === 'MSAIDIZI_AUTONOMY_GRANTS') {
        return (options.deploymentGrants ?? ['*']).join(',');
      }
      return fallback;
    }),
  };
  const permissionCache = {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  };
  return {
    strategy: new JwtStrategy(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      permissionCache as unknown as PermissionCacheService,
      { logStrictInTransaction: auditStrictInTransaction } as unknown as AuditLogsService,
    ),
    transaction,
    attemptUpdateMany,
    taskFindUnique,
    auditStrictInTransaction,
    userFindUnique,
    permissionFindMany,
    companyFindMany,
    permissionCache,
  };
}

function task(mode: MsaidiziTaskMode, grants: unknown) {
  return {
    id: 'task-1',
    status: 'RUNNING',
    mode,
    principalId: 'principal-1',
    initiatedByUserId: 'user-1' as string | null,
    companyId: 'company-1',
    mandateId: null as string | null,
    activePlanVersion: 1,
    maxWallTimeSeconds: 7_200,
    maxModelTurns: 200,
    maxAttemptedToolCalls: 500,
    maxMutations: 100,
    maxLocalBytes: 5_368_709_120n,
    maxExternalEgressBytes: 262_144_000n,
    maxModelCostUsd: 20,
    principal: {
      id: 'principal-1',
      status: 'ACTIVE',
      displayName: 'Msaidizi',
      createdByUserId: 'user-1',
      grants,
    },
    mandate: null as null | {
      id: string;
      status: string;
      startsAt: Date | null;
      expiresAt: Date | null;
      capabilities: unknown;
      budgets: unknown;
    },
    steps: [
      {
        id: 'step-1',
        status: 'RUNNING',
        capability: 'ExpensesController.findAll',
        capabilityVersion: '1',
        expectedEffect: MsaidiziEffect.READ,
        dataClass: 'internal',
        planVersionId: 'plan-1',
        arguments: actionArguments(),
      },
    ],
  };
}

function activeMandate(
  overrides: Partial<{
    capabilities: unknown;
    budgets: unknown;
  }> = {},
) {
  return {
    id: 'mandate-1',
    status: 'ACTIVE',
    startsAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    capabilities: [grant()],
    budgets: {},
    ...overrides,
  };
}

function grant() {
  return {
    capability: 'ExpensesController.findAll',
    version: '1',
    effects: [MsaidiziEffect.READ],
    // Exercise the same wildcard semantics used by schedule templates.
    dataClasses: ['*'],
  };
}

function human(status: 'ACTIVE' | 'INACTIVE', permissionGroups: string[][]) {
  return {
    id: 'user-1',
    email: 'human@example.com',
    fullName: 'Human Initiator',
    status,
    companyId: 'company-1',
    userRoles: permissionGroups.map((permissions, index) => ({
      role: {
        name: `Role ${index + 1}`,
        scope: 'COMPANY',
        rolePermissions: permissions.map((code) => ({ permission: { code } })),
      },
    })),
    companyAccess: [{ companyId: 'company-1', accessLevel: 'WRITE' }],
    divisionAccess: [
      {
        divisionId: 'division-1',
        accessLevel: 'READ',
        division: { companyId: 'company-1' },
      },
    ],
    branchAccess: [
      {
        branchId: 'branch-1',
        accessLevel: 'READ',
        branch: { division: { companyId: 'company-1' } },
      },
    ],
  };
}

function payload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'msaidizi@itemba.local',
    tokenUse: 'msaidizi-task',
    jti: '6ed4093e-6bed-4708-a5da-93da75c2842a',
    principalId: 'principal-1',
    taskId: 'task-1',
    stepId: 'step-1',
    planVersion: 1,
    capability: 'ExpensesController.findAll',
    argsDigest: digest(),
    ...overrides,
  };
}

function actionArguments() {
  return { path: {}, query: { page: 1 } };
}

function digest(): string {
  return exactActionEnvelopeDigest(actionArguments())!;
}

function expectTaskCredentialDenial(
  auditStrictInTransaction: jest.Mock,
  overrides: {
    mandateId?: string;
    argsDigest?: string;
    companyId?: string;
    reason: string;
    stage?: 'one_shot' | 'live_policy';
  },
): void {
  const companyId = overrides.companyId ?? 'company-1';
  expect(auditStrictInTransaction).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      action: 'MSAIDIZI_TASK_CREDENTIAL_DENIED',
      entityType: 'MsaidiziTaskStep',
      entityId: 'step-1',
      userId: 'user-1',
      companyId,
      scopeKind: AuditScopeKind.COMPANY,
      severity: AuditSeverity.HIGH,
      channel: AuditChannel.AGENT,
      agentSessionId: 'task_task1',
      principalType: 'SERVICE',
      principalId: 'principal-1',
      mandateId: overrides.mandateId,
      initiatedByUserId: 'user-1',
      taskId: 'task-1',
      stepId: 'step-1',
      metadata: expect.objectContaining({
        stage: overrides.stage ?? 'live_policy',
        reason: overrides.reason,
        capability: 'ExpensesController.findAll',
        argsDigest: overrides.argsDigest ?? digest(),
      }),
    }),
  );
}
