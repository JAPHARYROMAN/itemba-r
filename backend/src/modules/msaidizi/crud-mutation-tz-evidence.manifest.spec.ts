import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_MUTATION_TZ_BLOCKERS,
  CRUD_MUTATION_TZ_EVIDENCE_PACKS,
} from './crud-mutation-tz-evidence';
import {
  CrudMutationValue,
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
} from './crud-mutation-evidence';

describe('T-Z mutation evidence against the live capability manifest', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const tranche = manifest
    .filter(
      (capability) =>
        /^[T-Z]/.test(capability.controller) &&
        capability.verb !== 'GET' &&
        !capability.agentExcluded &&
        (capability.permissions.length > 0 || capability.anyPermissions.length > 0),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const fixtures = CRUD_MUTATION_TZ_EVIDENCE_PACKS.flatMap((pack) => pack.fixtures);
  const capabilityById = new Map(manifest.map((capability) => [capability.id, capability]));
  const prismaModels = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));

  it('partitions the exact 65-route live T-Z mutation inventory', () => {
    const registered = fixtures.map((fixture) => fixture.capabilityId);
    const blocked = CRUD_MUTATION_TZ_BLOCKERS.map((blocker) => blocker.capabilityId);

    expect(tranche).toHaveLength(65);
    expect(new Set(tranche.map((capability) => capability.controller)).size).toBe(19);
    expect(
      CRUD_MUTATION_TZ_EVIDENCE_PACKS.map((pack) => [pack.packId, pack.fixtures.length]),
    ).toEqual([
      ['mutation-tz-tasks-tax', 36],
      ['mutation-tz-units-shifts', 9],
      ['mutation-tz-users-integrations', 10],
    ]);
    expect(fixtures).toHaveLength(55);
    expect(CRUD_MUTATION_TZ_BLOCKERS).toHaveLength(10);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(blocked).size).toBe(blocked.length);
    expect(registered.filter((capabilityId) => blocked.includes(capabilityId))).toEqual([]);
    expect([...registered, ...blocked].sort((left, right) => left.localeCompare(right))).toEqual(
      tranche.map((capability) => capability.id),
    );
  });

  it('binds every positive to the exact strict manifest envelope', () => {
    for (const fixture of fixtures) {
      const capability = capabilityById.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;

      expect(Object.keys(fixture.request.path ?? {}).sort()).toEqual(
        [...capability.params.path].sort(),
      );
      expect(Object.keys(fixture.request.query ?? {}).sort()).toEqual(
        [...capability.params.query].sort(),
      );
      if (capability.params.hasBody) {
        expect(capability.params.bodySchema?.quality).toBe('strict');
        const schema = capability.params.bodySchema!.schema;
        const bodyKeys = Object.keys(fixture.request.body ?? {});
        expect((schema.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
        expect(bodyKeys.filter((key) => !schema.properties[key])).toEqual([]);
      } else {
        expect(fixture.request.body).toBeUndefined();
      }

      Object.values(fixture.request.path ?? {}).forEach(assertStrictValue);
      Object.values(fixture.request.query ?? {}).forEach(assertStrictValue);
      Object.values(fixture.request.body ?? {}).forEach(assertStrictValue);
    }
  });

  it('declares real seed/effect models and attributable audits', () => {
    for (const fixture of fixtures) {
      expect(fixture.setupModels?.every((model) => prismaModels.has(model)) ?? true).toBe(true);
      if (fixture.target) expect(prismaModels.has(fixture.target.model)).toBe(true);
      if (fixture.preState) expect(prismaModels.has(fixture.preState.model)).toBe(true);
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.action).toMatch(/^[A-Za-z0-9_.]+$/);
      expect(fixture.audit.entityType).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      if (fixture.effect.kind === 'compound') {
        const namedEffects = [
          ...fixture.effect.effects,
          ...(fixture.effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
        ];
        expect(namedEffects.length).toBeGreaterThanOrEqual(2);
        expect(namedEffects.every((effect) => prismaModels.has(effect.model))).toBe(true);
        continue;
      }

      expect(prismaModels.has(fixture.effect.model)).toBe(true);
      if (fixture.effect.kind === 'create') {
        expect(fixture.effect.responseIdPath).toEqual(['id']);
      } else if (fixture.effect.kind === 'delete') {
        expect(fixture.effect.mode).toBe('soft');
        expect(fixture.effect.deletedAtPath).toEqual(['deletedAt']);
      } else {
        expect(Object.keys(fixture.effect.expectedFields)).not.toHaveLength(0);
      }
    }
  });

  it('models set-default as a recoverable existing preference transition', () => {
    const fixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'UserDashboardPreferencesController.setDefault',
    );
    expect(fixture).toMatchObject({
      operation: 'action',
      request: { path: { dashboardId: { binding: 'model:DashboardDefinition' } } },
      target: {
        model: 'UserDashboardPreference',
        id: { binding: 'model:UserDashboardPreference' },
      },
      preState: {
        model: 'UserDashboardPreference',
        fields: {
          userId: { binding: 'userA' },
          dashboardDefinitionId: { binding: 'model:DashboardDefinition' },
          isDefault: { literal: false },
        },
      },
      effect: {
        kind: 'transition',
        model: 'UserDashboardPreference',
        expectedFields: { isDefault: { literal: true } },
        allowedFields: ['updatedAt'],
      },
    });
  });

  it('declares user deactivation and refresh-token revocation as one recoverable effect', () => {
    const fixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'UsersController.remove',
    );
    expect(fixture?.effect).toEqual({
      kind: 'compound',
      effects: [
        expect.objectContaining({
          effectId: 'user',
          kind: 'row-delete',
          model: 'User',
          id: { binding: 'posterUserA' },
          expectedFields: {
            deletedAt: { now: 'iso' },
            status: { literal: 'INACTIVE' },
            updatedAt: { now: 'iso' },
          },
          recovery: 'restore-row',
          recoveryOrder: 20,
        }),
        expect.objectContaining({
          effectId: 'refreshToken',
          kind: 'row-update',
          model: 'RefreshToken',
          id: { binding: 'posterRefreshToken' },
          expectedFields: {
            revokedAt: { now: 'iso' },
            revokedReason: { literal: 'USER_DEACTIVATED' },
          },
          recovery: 'restore-row',
          recoveryOrder: 10,
        }),
      ],
      auditEntityId: { binding: 'posterUserA' },
    });
    expect(fixture?.audit.companyId).toEqual({
      kind: 'exact',
      value: { binding: 'companyA' },
    });
    if (!fixture) throw new Error('UsersController.remove fixture is absent');
    expect([...crudMutationAllowedModels(fixture.effect)].sort()).toEqual([
      'AuditLog',
      'AuditLogCompanyScope',
      'RefreshToken',
      'User',
    ]);
    expect([...crudMutationBusinessDeltaModels(fixture.effect)].sort()).toEqual([
      'RefreshToken',
      'User',
    ]);
    expect(crudMutationRecoveryPlan(fixture.effect)).toEqual([
      expect.objectContaining({ contractId: 'refreshToken', recoveryOrder: 10 }),
      expect.objectContaining({ contractId: 'user', recoveryOrder: 20 }),
    ]);
  });

  it('requires real transition deltas for units, webhooks, and three-way approval', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'UnitsController.updateUnit')?.request
        .body,
    ).toEqual({ name: { unique: { prefix: 'Updated evidence unit' } } });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'WebhookEventsController.reprocess')
        ?.preState,
    ).toMatchObject({
      fields: {
        processingStatus: { literal: 'FAILED' },
        errorMessage: { literal: 'CRUD evidence webhook failure' },
        processedAt: { literal: '2026-08-25T00:00:00.000Z' },
      },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'ThreeWayMatchingController.approve')
        ?.effect,
    ).toMatchObject({
      expectedFields: {
        approvedAt: { now: 'iso' },
        approvedById: { binding: 'userA' },
      },
    });
  });

  it('proves security-profile and webhook CRUD without embedding secret material', () => {
    const userCreate = fixtures.find(
      (fixture) => fixture.capabilityId === 'UserSecurityProfilesController.create',
    );
    const userUpdate = fixtures.find(
      (fixture) => fixture.capabilityId === 'UserSecurityProfilesController.update',
    );
    expect(userCreate).toMatchObject({
      operation: 'create',
      request: {
        body: {
          userId: { binding: 'posterUserA' },
          forcePasswordChange: { literal: true },
          forceTwoFactorSetup: { literal: true },
          securityRiskLevel: { literal: 'MEDIUM' },
        },
      },
      effect: { kind: 'create', model: 'UserSecurityProfile' },
      audit: {
        action: 'USER_SECURITY_PROFILE_CREATED',
        companyId: { kind: 'exact', value: { binding: 'companyA' } },
      },
    });
    expect(userUpdate).toMatchObject({
      operation: 'update',
      request: { body: { forcePasswordChange: { literal: true } } },
      effect: {
        kind: 'update',
        model: 'UserSecurityProfile',
        expectedFields: { forcePasswordChange: { literal: true } },
      },
      audit: {
        action: 'USER_SECURITY_PROFILE_UPDATED',
        companyId: { kind: 'exact', value: { binding: 'companyA' } },
      },
    });
    for (const fixture of [userCreate, userUpdate]) {
      expect(fixture).toBeDefined();
      expect(Object.keys(fixture?.request.body ?? {})).not.toContain('twoFactorSecretEncrypted');
      expect(Object.keys(fixture?.request.body ?? {})).not.toContain('backupCodesHash');
    }

    const webhookCreate = fixtures.find(
      (fixture) => fixture.capabilityId === 'WebhookEndpointsController.create',
    );
    const webhookUpdate = fixtures.find(
      (fixture) => fixture.capabilityId === 'WebhookEndpointsController.update',
    );
    expect(webhookCreate?.request.body).toEqual({
      webhookCode: { unique: { prefix: 'CEWEBHOOK' } },
      companyId: { binding: 'companyA' },
      name: { unique: { prefix: 'CRUD webhook endpoint' } },
      endpointPath: { literal: '/crud-evidence-webhook' },
      allowedEvents: { array: [{ literal: 'crud.evidence.created' }] },
    });
    if (webhookCreate?.effect.kind !== 'create') throw new Error('webhook create drifted');
    expect(webhookCreate.effect.generatedFields).toMatchObject({
      createdById: { kind: 'exact', value: { binding: 'userA' } },
      secretHash: {
        kind: 'response-secret-digest',
        responsePath: ['rawSecret'],
        algorithm: 'sha256',
        encoding: 'hex',
      },
    });
    expect(webhookCreate.request.body).not.toHaveProperty('rawSecret');
    expect(webhookCreate.request.body).not.toHaveProperty('secretHash');
    expect(webhookUpdate).toMatchObject({
      operation: 'update',
      request: { body: { name: { unique: { prefix: 'Updated webhook endpoint' } } } },
      effect: {
        kind: 'update',
        model: 'WebhookEndpoint',
        expectedFields: { name: { unique: { prefix: 'Updated webhook endpoint' } } },
      },
    });
  });

  it('declares every task and tax actor/timestamp side field', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'TasksController.complete'),
    ).toMatchObject({
      preState: {
        fields: {
          completedAt: { literal: null },
          completedById: { literal: null },
        },
      },
      effect: {
        expectedFields: {
          status: { literal: 'COMPLETED' },
          completedAt: { now: 'iso' },
          completedById: { binding: 'userA' },
        },
      },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'TaxRatesController.approve'),
    ).toMatchObject({
      effect: {
        expectedFields: {
          status: { literal: 'ACTIVE' },
          approvedAt: { now: 'iso' },
          approvedById: { binding: 'userA' },
        },
      },
    });

    const taxReturnFields = {
      'TaxReturnsController.prepare': { preparedById: { binding: 'userA' } },
      'TaxReturnsController.review': { reviewedById: { binding: 'userA' } },
      'TaxReturnsController.approve': { approvedById: { binding: 'userA' } },
      'TaxReturnsController.submit': {
        submissionDate: { now: 'iso' },
        submittedById: { binding: 'userA' },
      },
      'TaxReturnsController.markPaid': {
        paidById: { binding: 'userA' },
        paymentDate: { now: 'iso' },
      },
    } as const;
    for (const [capabilityId, expectedFields] of Object.entries(taxReturnFields)) {
      expect(
        fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.effect,
      ).toMatchObject({ expectedFields });
    }

    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'TaxTransactionsController.post'),
    ).toMatchObject({
      effect: {
        expectedFields: {
          status: { literal: 'POSTED' },
          postedAt: { now: 'iso' },
          postedById: { binding: 'userA' },
        },
      },
    });
  });

  it('keeps every blocker precise and machine readable', () => {
    for (const blocker of CRUD_MUTATION_TZ_BLOCKERS) {
      expect(capabilityById.has(blocker.capabilityId)).toBe(true);
      expect(blocker.detail).toContain(blocker.capabilityId);
      expect(blocker.detail.length).toBeGreaterThan(40);
    }
  });
});

function assertStrictValue(value: CrudMutationValue): void {
  const keys = Object.keys(value);
  expect(keys).toHaveLength(1);
  const key = keys[0];
  expect(['literal', 'binding', 'unique', 'now', 'array', 'object']).toContain(key);
  if ('binding' in value) {
    expect(value.binding).toMatch(/^[A-Za-z][A-Za-z0-9:]*$/);
  } else if ('unique' in value) {
    expect(value.unique.prefix).toMatch(/^[A-Za-z0-9 _.-]{1,64}$/);
  } else if ('array' in value) {
    value.array.forEach(assertStrictValue);
  } else if ('object' in value) {
    Object.values(value.object).forEach(assertStrictValue);
  }
}
