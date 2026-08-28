import {
  CrudMutationAnyFixtureRegistration,
  CrudMutationCompoundEffect,
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  crudMutationUnexpectedModels,
  reconcileCrudMutationModelDeltas,
  resolveCrudMutationScopedRowCreateIdentityDelta,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';
import { fixtureContractDigest } from './crud-execution-evidence';

function compoundEffect(): CrudMutationCompoundEffect {
  return {
    kind: 'compound',
    effects: [
      {
        effectId: 'createdChild',
        kind: 'row-create',
        model: 'Child',
        id: { response: { path: ['childId'] } },
        expectedFields: { companyId: { binding: 'companyA' } },
        recovery: 'delete-created',
        recoveryOrder: 20,
      },
      {
        effectId: 'createdChildEvent',
        kind: 'scoped-row-create',
        model: 'ChildEvent',
        scope: {
          equals: { companyId: { binding: 'companyA' } },
          identityFields: ['id'],
        },
        expectedFields: {
          childId: { effectRef: { effectId: 'createdChild' } },
          eventType: { literal: 'CREATED' },
        },
        generatedFields: { createdAt: { kind: 'action-time' } },
        allowedFields: ['id', 'updatedAt'],
        recovery: 'restore-scope',
        recoveryOrder: 25,
      },
      {
        effectId: 'updatedParent',
        kind: 'row-update',
        model: 'Parent',
        id: { binding: 'model:Parent' },
        expectedFields: { childId: { effectRef: { effectId: 'createdChild' } } },
        forbiddenFields: ['companyId'],
        recovery: 'restore-row',
        recoveryOrder: 10,
      },
      {
        effectId: 'linkCount',
        kind: 'count-delta',
        model: 'ParentChildLink',
        scope: {
          equals: { companyId: { binding: 'companyA' } },
          identityFields: ['id'],
        },
        expectedDelta: 1,
        recovery: 'restore-scope',
        recoveryOrder: 30,
      },
      {
        effectId: 'linkSet',
        kind: 'set-delta',
        model: 'LinkProjection',
        scope: {
          equals: { companyId: { binding: 'companyA' } },
          identityFields: ['id'],
        },
        expectedAdded: [{ id: { response: { path: ['projectionId'] } } }],
        expectedRemoved: [],
        recovery: 'restore-scope',
        recoveryOrder: 40,
      },
    ],
    allowedTableExceptions: [
      {
        reason: 'denormalized_projection',
        detail: 'A database trigger advances the exact projection revision row.',
        effect: {
          effectId: 'projectionRevision',
          kind: 'row-update',
          model: 'ProjectionRevision',
          id: { binding: 'model:ProjectionRevision' },
          expectedFields: { revision: { literal: 2 } },
          recovery: 'restore-row',
          recoveryOrder: 50,
        },
      },
    ],
    auditEntityId: { effectRef: { effectId: 'createdChild' } },
  };
}

function fixture(effect = compoundEffect()): CrudMutationAnyFixtureRegistration {
  return {
    fixtureId: 'compound-contract-test',
    fixtureVersion: 1,
    capabilityId: 'CompoundController.execute',
    controlKind: 'positive',
    description: 'Exercises a fully declared multi-table database mutation.',
    governance: { scope: 'not_applicable', audit: 'required' },
    packId: 'compound-contract-tests',
    operation: 'action',
    request: { path: { id: { binding: 'model:Parent' } }, body: {} },
    effect,
    audit: {
      required: true,
      action: 'EXECUTE',
      entityType: 'Child',
      companyId: { kind: 'effect-company' },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    },
  };
}

describe('compound CRUD mutation evidence contract', () => {
  it('requires a signed exact AuditLog company binding', () => {
    const governed = fixture();
    const missingCompany = {
      ...governed,
      audit: { required: true, action: 'EXECUTE', entityType: 'Child' },
    } as unknown as CrudMutationAnyFixtureRegistration;
    const exactGlobal = {
      ...governed,
      audit: { ...governed.audit, companyId: { kind: 'exact' as const, value: { literal: null } } },
    };

    expect(validateCrudMutationFixtureContract(missingCompany)).toContain(
      'audit.companyId must carry an exact signed binding contract',
    );
    expect(fixtureContractDigest(exactGlobal)).not.toBe(fixtureContractDigest(governed));
  });

  it('requires exact null compatibility attribution and distinct snapshots for multi-company audits', () => {
    const governed = fixture();
    const bilateral: CrudMutationAnyFixtureRegistration = {
      ...governed,
      audit: {
        ...governed.audit,
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'MULTI_COMPANY',
        companyScopeBindings: ['companyA', 'companyB'],
      },
    };
    const missingSnapshot: CrudMutationAnyFixtureRegistration = {
      ...bilateral,
      audit: { ...bilateral.audit, companyScopeBindings: ['companyA'] },
    };
    const nonNullCompatibility: CrudMutationAnyFixtureRegistration = {
      ...bilateral,
      audit: {
        ...bilateral.audit,
        companyId: { kind: 'exact', value: { binding: 'companyA' } },
      },
    };

    expect(validateCrudMutationFixtureContract(bilateral)).toEqual([]);
    expect(validateCrudMutationFixtureContract(missingSnapshot)).toContain(
      'MULTI_COMPANY audit must bind at least two exact company snapshots',
    );
    expect(validateCrudMutationFixtureContract(nonNullCompatibility)).toContain(
      'MULTI_COMPANY audit.companyId must be the exact null compatibility value',
    );
    expect(fixtureContractDigest(bilateral)).not.toBe(fixtureContractDigest(governed));
  });

  it('cryptographically binds an optional parent audit entity override', () => {
    const governed = fixture();
    const parentAudit = {
      ...governed,
      audit: {
        ...governed.audit,
        entityId: { binding: 'model:Parent' } as const,
        companyId: { kind: 'exact' as const, value: { binding: 'companyA' } as const },
      },
    };

    expect(validateCrudMutationFixtureContract(parentAudit)).toEqual([]);
    expect(fixtureContractDigest(parentAudit)).not.toBe(fixtureContractDigest(governed));
  });

  it('keeps legacy preState compatible and binds additive prerequisite rows', () => {
    const legacy: CrudMutationAnyFixtureRegistration = {
      ...fixture(),
      preState: {
        model: 'Parent',
        id: { binding: 'model:Parent' },
        fields: { status: { literal: 'READY' } },
      },
    };
    const additive: CrudMutationAnyFixtureRegistration = {
      ...legacy,
      preStates: [
        {
          model: 'Period',
          id: { binding: 'model:Period' },
          fields: { status: { literal: 'OPEN' } },
        },
        {
          model: 'Year',
          id: { binding: 'model:Year' },
          fields: { status: { literal: 'OPEN' } },
        },
      ],
    };
    const empty: CrudMutationAnyFixtureRegistration = { ...legacy, preStates: [] };

    expect(validateCrudMutationFixtureContract(legacy)).toEqual([]);
    expect(validateCrudMutationFixtureContract(additive)).toEqual([]);
    expect(validateCrudMutationFixtureContract(empty)).toContain(
      'preStates must not be empty when declared',
    );
    expect(fixtureContractDigest(additive)).not.toBe(fixtureContractDigest(legacy));
  });

  it('validates closed scopes, prior effect references and exact recovery declarations', () => {
    expect(validateCrudMutationFixtureContract(fixture())).toEqual([]);
    expect(crudMutationRecoveryPlan(compoundEffect())).toEqual([
      expect.objectContaining({ contractId: 'updatedParent', recoveryOrder: 10 }),
      expect.objectContaining({ contractId: 'createdChild', recoveryOrder: 20 }),
      expect.objectContaining({
        contractId: 'createdChildEvent',
        recovery: 'restore-scope',
        recoveryOrder: 25,
      }),
      expect.objectContaining({ contractId: 'linkCount', recoveryOrder: 30 }),
      expect.objectContaining({ contractId: 'linkSet', recoveryOrder: 40 }),
      expect.objectContaining({
        source: 'allowed-table-exception',
        contractId: 'projectionRevision',
        recoveryOrder: 50,
      }),
    ]);
  });

  it('rejects restoring a deleted row before reconciling a same-model replacement scope', () => {
    const governed = compoundEffect();
    const invalid = fixture({
      ...governed,
      effects: [
        ...governed.effects,
        {
          effectId: 'deletedReceipt',
          kind: 'row-delete',
          model: 'Receipt',
          id: { binding: 'model:Receipt' },
          mode: 'hard',
          expectedFields: { parentId: { binding: 'model:Parent' } },
          recovery: 'restore-row',
          recoveryOrder: 60,
        },
        {
          effectId: 'replacementReceipt',
          kind: 'scoped-row-create',
          model: 'Receipt',
          scope: {
            equals: { parentId: { binding: 'model:Parent' } },
            identityFields: ['id'],
          },
          expectedFields: { parentId: { binding: 'model:Parent' } },
          generatedFields: {},
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 70,
        },
      ],
    });

    expect(validateCrudMutationFixtureContract(invalid)).toContain(
      'replacementReceipt restore-scope recoveryOrder 70 must precede deletedReceipt restore-row recoveryOrder 60 for model Receipt',
    );
  });

  it('fails closed when a dynamically identified child create is not scope- and field-complete', () => {
    const governed = compoundEffect();
    const scoped = governed.effects[1];
    if (scoped.kind !== 'scoped-row-create') throw new Error('test fixture drifted');
    const invalidScoped = {
      ...scoped,
      scope: { equals: {}, identityFields: [] },
      expectedFields: {
        createdAt: { literal: 'caller-controlled' as const },
      },
      generatedFields: {
        createdAt: { kind: 'action-time' as const, offsetMs: Number.MAX_SAFE_INTEGER },
        entityCode: { kind: 'entity-code' as const, entityType: 'ChildEvent' },
      },
      allowedFields: ['createdAt', 'createdAt'],
    };
    const errors = validateCrudMutationFixtureContract(
      fixture({
        ...governed,
        effects: [governed.effects[0], invalidScoped, ...governed.effects.slice(2)],
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'effect createdChildEvent scope.equals must not be empty',
        'effect createdChildEvent identityFields must not be empty',
        'createdChildEvent.allowedFields must be unique',
        'createdChildEvent.generated field createdAt is already a required expected field',
        'createdChildEvent.generated field createdAt is also allowed without a validator',
        'createdChildEvent.generated field createdAt has an invalid action-time offset',
        'createdChildEvent.allowed field createdAt is already a required expected field',
        'createdChildEvent.generated field entityCode must declare its sequence as a separate compound effect',
      ]),
    );
  });

  it('binds the scoped child field closure and generated-value semantics into the digest', () => {
    const original = compoundEffect();
    const scoped = original.effects[1];
    if (scoped.kind !== 'scoped-row-create') throw new Error('test fixture drifted');
    const changed = fixture({
      ...original,
      effects: [
        original.effects[0],
        {
          ...scoped,
          generatedFields: { createdAt: { kind: 'action-time', offsetMs: 1_000 } },
        },
        ...original.effects.slice(2),
      ],
    });

    expect(validateCrudMutationFixtureContract(fixture(original))).toEqual([]);
    expect(fixtureContractDigest(changed)).not.toBe(fixtureContractDigest(fixture(original)));
  });

  it.each([
    {
      name: 'one new dynamic identity',
      before: ['child-1'],
      after: ['child-1', 'child-2'],
      exact: true,
      added: ['child-2'],
      removed: [],
    },
    {
      name: 'two new identities',
      before: ['child-1'],
      after: ['child-1', 'child-2', 'child-3'],
      exact: false,
      added: ['child-2', 'child-3'],
      removed: [],
    },
    {
      name: 'one create hidden behind one removal',
      before: ['child-1'],
      after: ['child-2'],
      exact: false,
      added: ['child-2'],
      removed: ['child-1'],
    },
    {
      name: 'a duplicate declared identity',
      before: ['child-1'],
      after: ['child-1', 'child-2', 'child-2'],
      exact: false,
      added: ['child-2'],
      removed: [],
    },
  ])(
    'recognizes scoped row creation only for $name',
    ({ before, after, exact, added, removed }) => {
      const delta = resolveCrudMutationScopedRowCreateIdentityDelta(before, after);

      expect(delta.isExactCreate).toBe(exact);
      expect(delta.added).toEqual(added);
      expect(delta.removed).toEqual(removed);
    },
  );

  it('derives a default-deny table policy and never treats external effects as recoverable', () => {
    expect([...crudMutationAllowedModels(compoundEffect())].sort()).toEqual([
      'AuditLog',
      'AuditLogCompanyScope',
      'Child',
      'ChildEvent',
      'LinkProjection',
      'Parent',
      'ParentChildLink',
      'ProjectionRevision',
    ]);
    expect([...crudMutationBusinessDeltaModels(compoundEffect())].sort()).toEqual([
      'Child',
      'ChildEvent',
      'LinkProjection',
      'Parent',
      'ParentChildLink',
      'ProjectionRevision',
    ]);
    expect(
      crudMutationUnexpectedModels(compoundEffect(), [
        'Parent',
        'AuditLog',
        'ProjectionRevision',
        'EmailOutbox',
        'FilesystemArtifact',
      ]),
    ).toEqual(['EmailOutbox', 'FilesystemArtifact']);
  });

  it('rejects unstable/raw scopes, duplicate recovery order and forward references', () => {
    const invalid = compoundEffect();
    const first = invalid.effects[0];
    const second = invalid.effects[2];
    const third = invalid.effects[3];
    if (
      first.kind !== 'row-create' ||
      second.kind !== 'row-update' ||
      third.kind !== 'count-delta'
    ) {
      throw new Error('test fixture drifted');
    }
    const errors = validateCrudMutationFixtureContract(
      fixture({
        ...invalid,
        effects: [
          {
            ...second,
            expectedFields: {
              childId: { effectRef: { effectId: 'createdChild' } },
            },
            recoveryOrder: 20,
          },
          first,
          {
            ...third,
            scope: {
              equals: { companyId: { object: { raw: { literal: '$gt' } } } },
              identityFields: ['$raw'],
            },
          },
        ],
        allowedTableExceptions: [
          {
            ...invalid.allowedTableExceptions![0],
            reason: 'email' as never,
          },
        ],
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('references unavailable prior effect createdChild'),
        expect.stringContaining('recoveryOrder 20 is duplicated'),
        expect.stringContaining('contains an unsafe field name $raw'),
        expect.stringContaining('is not a stable scalar equality value'),
        expect.stringContaining('not an allowed database-only exception reason'),
      ]),
    );
  });

  it('cryptographically binds nested effects, recovery, audit and scope definitions', () => {
    const original = fixture();
    const changedEffect = compoundEffect();
    const count = changedEffect.effects[3];
    if (count.kind !== 'count-delta') throw new Error('test fixture drifted');
    const changed = fixture({
      ...changedEffect,
      effects: [
        ...changedEffect.effects.slice(0, 3),
        { ...count, expectedDelta: 2 },
        ...changedEffect.effects.slice(4),
      ],
    });

    expect(fixtureContractDigest(original)).toMatch(/^[a-f0-9]{64}$/);
    expect(fixtureContractDigest(changed)).not.toBe(fixtureContractDigest(original));
  });

  it.each([
    {
      name: 'expected count plus an unrelated scalar update',
      deltas: [
        {
          model: 'Child',
          created: ['{"id":"child-1"}'],
          deleted: [],
          updated: [{ identity: '{"id":"child-2"}', fields: ['status'] }],
        },
      ],
      claims: [
        {
          claimId: 'childCount',
          model: 'Child',
          kind: 'create' as const,
          identity: '{"id":"child-1"}',
        },
      ],
      expected: 'undeclared delta Child.update[{"id":"child-2"}].status',
    },
    {
      name: 'expected set delta plus an unrelated scalar mutation',
      deltas: [
        {
          model: 'Link',
          created: ['{"id":"link-1"}'],
          deleted: [],
          updated: [{ identity: '{"id":"link-2"}', fields: ['weight'] }],
        },
      ],
      claims: [
        {
          claimId: 'linkSet',
          model: 'Link',
          kind: 'create' as const,
          identity: '{"id":"link-1"}',
        },
      ],
      expected: 'undeclared delta Link.update[{"id":"link-2"}].weight',
    },
    {
      name: 'a declared row create plus an extra same-model row',
      deltas: [
        {
          model: 'Child',
          created: ['{"id":"child-1"}', '{"id":"child-2"}'],
          deleted: [],
          updated: [],
        },
      ],
      claims: [
        {
          claimId: 'createdChild',
          model: 'Child',
          kind: 'create' as const,
          identity: '{"id":"child-1"}',
        },
      ],
      expected: 'undeclared delta Child.create[{"id":"child-2"}]',
    },
    {
      name: 'a declared row update plus an undeclared field',
      deltas: [
        {
          model: 'Parent',
          created: [],
          deleted: [],
          updated: [{ identity: '{"id":"parent-1"}', fields: ['childId', 'updatedAt'] }],
        },
      ],
      claims: [
        {
          claimId: 'updatedParent',
          model: 'Parent',
          kind: 'update' as const,
          identity: '{"id":"parent-1"}',
          fields: ['childId'],
        },
      ],
      expected: 'undeclared delta Parent.update[{"id":"parent-1"}].updatedAt',
    },
  ])('rejects $name', ({ deltas, claims, expected }) => {
    expect(reconcileCrudMutationModelDeltas(deltas, claims)).toContain(expected);
  });

  it('rejects overlapping claims and claims for absent deltas', () => {
    const identity = '{"id":"parent-1"}';
    const errors = reconcileCrudMutationModelDeltas(
      [{ model: 'Parent', created: [], deleted: [], updated: [{ identity, fields: ['status'] }] }],
      [
        { claimId: 'semantic', model: 'Parent', kind: 'update', identity, fields: ['status'] },
        { claimId: 'exception', model: 'Parent', kind: 'update', identity, fields: ['status'] },
        { claimId: 'absent', model: 'Parent', kind: 'update', identity, fields: ['updatedAt'] },
      ],
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('overlapping delta Parent.update'),
        expect.stringContaining('claimed delta absent Parent.update'),
      ]),
    );
  });
});
