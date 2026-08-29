import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_MUTATION_AM_BLOCKERS,
  CRUD_MUTATION_AM_EVIDENCE_PACKS,
} from './crud-mutation-am-evidence';
import {
  CRUD_MUTATION_BASE_BLOCKERS,
  CRUD_MUTATION_BASE_EVIDENCE_PACK,
} from './crud-mutation-base-evidence';
import {
  CrudMutationEffectValue,
  CrudMutationValue,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
} from './crud-mutation-evidence';

const PRISMA_MODEL_BY_NAME = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
);
const PRISMA_ENUM_VALUES = new Map(
  Prisma.dmmf.datamodel.enums.map((definition) => [
    definition.name,
    new Set<string>(
      definition.values.map((value) => (typeof value === 'string' ? value : value.name)),
    ),
  ]),
);

const RESOLVED_SCHEMA_ROUTES = new Set([
  'ActiveSessionsController.create',
  'ActiveSessionsController.revoke',
  'AlertEventsController.acknowledge',
  'AlertEventsController.dismiss',
  'AlertEventsController.resolve',
  'AlertRulesController.create',
  'AlertRulesController.update',
  'ApiClientsController.create',
  'ApiClientsController.update',
  'ApiKeysController.create',
  'ApprovalDelegationsController.update',
  'AutomationRulesController.create',
  'AutomationRulesController.update',
  'AutomationRunsController.trigger',
  'BackgroundJobsController.enqueue',
  'BackupJobsController.create',
  'BackupJobsController.update',
  'BackupRunsController.create',
  'BackupRunsController.trigger',
  'BankReconciliationsController.manualMatch',
  'BankReconciliationsController.postAdjustment',
  'BankReconciliationsController.runMatching',
  'BankReconciliationsController.unmatch',
  'BidComparisonsController.create',
  'BidComparisonsController.update',
  'CacheManagementController.set',
  'CustomerSegmentsController.create',
  'CustomerSegmentsController.update',
  'CustomerCreditProfilesController.create',
  'CustomerCreditProfilesController.update',
  'DataExportsController.create',
  'DataIsolationTestsController.addIssue',
  'DataIsolationTestsController.complete',
  'DataIsolationTestsController.create',
  'DepreciationController.addEntry',
  'DepreciationController.create',
  'DepreciationController.generateEntries',
  'DocumentTemplatesController.create',
  'DocumentTemplatesController.update',
  'EmployeesController.requestTermination',
  'EmploymentContractsController.terminate',
  'FinancialStatementsController.generate',
  'GoodsReceivedNotesController.create',
  'IntegrationConnectionsController.create',
  'IntegrationConnectionsController.update',
  'IntegrationMappingsController.create',
  'IntegrationMappingsController.update',
  'InternalControlsController.create',
  'InternalControlsController.update',
  'JobQueueConfigsController.create',
  'JobQueueConfigsController.update',
  'LeaveBalancesController.upsertAllocation',
  'LeaveRequestsController.approve',
  'LeaveRequestsController.approveHr',
  'LeaveRequestsController.cancel',
  'LeaveRequestsController.reject',
  'LoanRepaymentSchedulesController.create',
  'LoanRepaymentSchedulesController.recordPayment',
  'MessageTemplatesController.create',
  'MessageTemplatesController.update',
]);

describe('A-M mutation evidence against the live capability manifest', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const tranche = manifest
    .filter(
      (capability) =>
        /^[A-M]/.test(capability.controller) &&
        capability.verb !== 'GET' &&
        !capability.agentExcluded &&
        (capability.permissions.length > 0 || capability.anyPermissions.length > 0),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const packs = [CRUD_MUTATION_BASE_EVIDENCE_PACK, ...CRUD_MUTATION_AM_EVIDENCE_PACKS];
  const fixtures = packs.flatMap((pack) => pack.fixtures);
  const eligibleCapabilityIds = new Set(tranche.map((capability) => capability.id));
  const blockers = [...CRUD_MUTATION_BASE_BLOCKERS, ...CRUD_MUTATION_AM_BLOCKERS].filter(
    (blocker) => eligibleCapabilityIds.has(blocker.capabilityId),
  );
  const capabilityById = new Map(manifest.map((capability) => [capability.id, capability]));

  it('partitions the exact live A-M agent-eligible mutation inventory', () => {
    const registered = fixtures.map((fixture) => fixture.capabilityId);
    const blocked = blockers.map((blocker) => blocker.capabilityId);
    const controllers = new Set(tranche.map((capability) => capability.controller));

    expect(tranche).toHaveLength(323);
    expect(controllers.size).toBe(89);
    expect(packs.map((pack) => pack.fixtures.length)).toEqual([6, 81, 73, 121]);
    expect(registered).toHaveLength(281);
    expect(blocked).toHaveLength(42);
    expect(blockers.filter((blocker) => blocker.reason === 'body_schema_not_strict')).toHaveLength(
      0,
    );
    expect(
      blockers.filter((blocker) => blocker.reason === 'audit_attribution_not_persisted'),
    ).toHaveLength(0);
    expect(
      blockers.filter((blocker) => blocker.reason === 'irreversible_without_recovery_control'),
    ).toHaveLength(8);
    expect(
      blockers.filter((blocker) => blocker.reason === 'exact_effect_not_represented'),
    ).toHaveLength(34);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(blocked).size).toBe(blocked.length);
    expect(registered.filter((capabilityId) => blocked.includes(capabilityId))).toEqual([]);
    expect([...registered, ...blocked].sort((left, right) => left.localeCompare(right))).toEqual(
      tranche.map((capability) => capability.id),
    );
    expect([...registered, ...blocked].filter((id) => !/^[A-M]/.test(id))).toEqual([]);
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
        expect(fixture.request.body).toBeDefined();
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

  it('declares real seed/effect models and exact attributable audit contracts', () => {
    for (const fixture of fixtures) {
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.entityType).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(fixture.audit.action).toMatch(/^[A-Za-z0-9_.]+$/);
      expect(fixture.setupModels?.every((model) => PRISMA_MODEL_BY_NAME.has(model))).toBe(true);
      if (fixture.target) expect(PRISMA_MODEL_BY_NAME.has(fixture.target.model)).toBe(true);
      if (fixture.preState) {
        expect(PRISMA_MODEL_BY_NAME.has(fixture.preState.model)).toBe(true);
        assertModelValues(fixture.preState.model, fixture.preState.fields);
      }
      for (const preState of fixture.preStates ?? []) {
        expect(PRISMA_MODEL_BY_NAME.has(preState.model)).toBe(true);
        assertModelValues(preState.model, preState.fields);
      }

      if (fixture.effect.kind === 'compound') {
        const namedEffects = [
          ...fixture.effect.effects,
          ...(fixture.effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
        ];
        expect(namedEffects.length).toBeGreaterThanOrEqual(2);
        for (const namedEffect of namedEffects) {
          const model = PRISMA_MODEL_BY_NAME.get(namedEffect.model);
          expect(model).toBeDefined();
          if (!model) continue;
          if (
            namedEffect.kind === 'row-create' ||
            namedEffect.kind === 'row-update' ||
            namedEffect.kind === 'row-delete'
          ) {
            assertModelValues(namedEffect.model, namedEffect.expectedFields);
          } else {
            for (const fieldName of [
              ...Object.keys(namedEffect.scope.equals),
              ...namedEffect.scope.identityFields,
            ]) {
              expect(model.fields.some((field) => field.name === fieldName)).toBe(true);
            }
          }
        }
      } else if (fixture.effect.kind === 'create') {
        expect(PRISMA_MODEL_BY_NAME.has(fixture.effect.model)).toBe(true);
        expect(fixture.operation).toBe('create');
        expect(fixture.effect.responseIdPath).toEqual(
          fixture.capabilityId === 'FinancialStatementsController.generate'
            ? ['run', 'id']
            : ['id'],
        );
      } else if (fixture.effect.kind === 'delete') {
        expect(PRISMA_MODEL_BY_NAME.has(fixture.effect.model)).toBe(true);
        expect(fixture.operation).toBe('delete');
        expect(fixture.effect.mode).toBe('soft');
        expect(fixture.effect.deletedAtPath).toEqual(['deletedAt']);
        expect(
          PRISMA_MODEL_BY_NAME.get(fixture.effect.model)?.fields.some(
            (field) => field.name === 'deletedAt',
          ),
        ).toBe(true);
      } else {
        expect(PRISMA_MODEL_BY_NAME.has(fixture.effect.model)).toBe(true);
        expect(Object.keys(fixture.effect.expectedFields).length).toBeGreaterThan(0);
        assertModelValues(fixture.effect.model, fixture.effect.expectedFields);
      }
    }
  });

  it('keeps every blocker precise and machine readable', () => {
    for (const blocker of blockers) {
      expect(capabilityById.has(blocker.capabilityId)).toBe(true);
      expect(blocker.detail).toContain(blocker.capabilityId);
      expect(blocker.detail.length).toBeGreaterThan(40);
    }
  });

  it('tracks every formerly schema-blocked route as strict evidence or a precise blocker', () => {
    const remaining = blockers.filter((blocker) => blocker.reason === 'body_schema_not_strict');
    const formerInventory = new Set([
      ...RESOLVED_SCHEMA_ROUTES,
      ...remaining.map((blocker) => blocker.capabilityId),
    ]);

    expect(formerInventory.size).toBe(60);
    for (const capabilityId of RESOLVED_SCHEMA_ROUTES) {
      const capability = capabilityById.get(capabilityId);
      expect(capability?.params.bodySchema?.quality).toBe('strict');
      const registered = fixtures.some((fixture) => fixture.capabilityId === capabilityId);
      const blocker = blockers.find((candidate) => candidate.capabilityId === capabilityId);
      if (capability?.agentExcluded) {
        expect(registered).toBe(false);
        expect(blocker).toBeUndefined();
        expect(capability.agentExclusionReason).toBeDefined();
        continue;
      }
      expect(registered || blocker !== undefined).toBe(true);
      expect(blocker?.reason).not.toBe('body_schema_not_strict');
    }

    for (const blocker of remaining) {
      expect(capabilityById.get(blocker.capabilityId)?.params.bodySchema?.quality).not.toBe(
        'strict',
      );
    }
  });

  it('pins mutation preconditions and service-owned deltas to their exact contracts', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'AttendanceController.update'),
    ).toMatchObject({
      preState: { fields: { attendanceStatus: { literal: 'UNPAID_ABSENT' } } },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'BackgroundJobsController.retry')?.effect,
    ).toEqual(
      expect.objectContaining({
        expectedFields: expect.not.objectContaining({
          attempts: expect.anything(),
          completedAt: expect.anything(),
        }),
        forbiddenFields: ['attempts', 'completedAt'],
      }),
    );

    for (const capabilityId of [
      'BusinessLicensesController.create',
      'CashAccountsController.create',
    ]) {
      expect(
        fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.request.body,
      ).toEqual(
        expect.objectContaining({
          divisionId: { binding: 'model:Division' },
          branchId: { binding: 'model:Branch' },
        }),
      );
    }
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'DebtsController.create')?.request.body,
    ).toEqual(expect.objectContaining({ amount: { literal: 100 } }));
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'CustomerCreditProfilesController.create')
        ?.request.body,
    ).toEqual(
      expect.objectContaining({ customerId: { binding: 'customerCreditProfileCreateCustomer' } }),
    );
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'CompaniesController.upsertProfile')
        ?.effect,
    ).toMatchObject({
      expectedFields: {
        brelaRegNumber: { unique: { prefix: 'CEBRELA' } },
        registeredAddress: { literal: 'CRUD evidence address' },
        registeredName: { literal: 'CRUD registered company' },
        tin: { unique: { prefix: 'CETIN' } },
      },
    });

    const employeeUpdate = fixtures.find(
      (fixture) => fixture.capabilityId === 'EmployeesController.update',
    );
    expect(employeeUpdate?.effect).toMatchObject({
      kind: 'update',
      expectedFields: {
        notes: { unique: { prefix: 'Updated employee' } },
        divisionId: { binding: 'model:Branch', path: ['divisionId'] },
      },
    });

    const transferApproval = fixtures.find(
      (fixture) => fixture.capabilityId === 'EmployeeAssignmentsController.approveTransfer',
    );
    expect(transferApproval?.preStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: 'EmployeeAssignment',
          fields: expect.objectContaining({ divisionId: { binding: 'model:Division' } }),
        }),
        expect.objectContaining({
          model: 'Employee',
          fields: expect.objectContaining({ divisionId: { literal: null } }),
        }),
      ]),
    );
    expect(transferApproval?.effect).toMatchObject({
      kind: 'compound',
      effects: expect.arrayContaining([
        expect.objectContaining({
          effectId: 'employeeProjection',
          expectedFields: expect.objectContaining({
            divisionId: { binding: 'model:Division' },
          }),
        }),
      ]),
    });
  });

  it('binds every bilateral intercompany audit to the exact A+B immutable scope', () => {
    for (const capabilityId of [
      'IntercompanyTransactionsController.create',
      'IntercompanyTransactionsController.update',
      'IntercompanyTransactionsController.submit',
      'IntercompanyTransactionsController.approve',
      'IntercompanyTransactionsController.reject',
      'IntercompanyTransactionsController.remove',
    ]) {
      expect(
        fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.audit,
      ).toMatchObject({
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'MULTI_COMPANY',
        companyScopeBindings: ['companyA', 'companyB'],
      });
    }
  });

  it('pins recovered prerequisite rows and normalized persistence values', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'DataIsolationTestsController.complete')
        ?.preState,
    ).toEqual({
      model: 'DataIsolationTestRun',
      id: { binding: 'model:DataIsolationTestRun' },
      fields: { failedChecks: { literal: 1 }, status: { literal: 'RUNNING' } },
    });

    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'HrDocumentsController.update')?.preState,
    ).toEqual({
      model: 'HRDocument',
      id: { binding: 'model:HRDocument' },
      fields: { isSensitive: { literal: false } },
    });

    const fixedAsset = fixtures.find(
      (fixture) => fixture.capabilityId === 'FixedAssetsController.create',
    );
    if (fixedAsset?.effect.kind !== 'create') throw new Error('fixed-asset fixture drifted');
    expect(fixedAsset.request.body).toEqual({
      acquisitionCost: { literal: '1000.00' },
      acquisitionDate: { literal: '2026-08-25' },
      assetCode: { unique: { prefix: 'CEASSET' } },
      category: { literal: 'EQUIPMENT' },
      companyId: { binding: 'companyA' },
      currentBookValue: { literal: '1000.00' },
      name: { unique: { prefix: 'CRUD fixed asset' } },
      ownershipLevel: { literal: 'COMPANY' },
    });
    expect(fixedAsset.effect.expectedFields).toEqual({
      acquisitionCost: { literal: 1000 },
      acquisitionDate: { literal: '2026-08-25' },
      assetCode: { unique: { prefix: 'CEASSET' } },
      category: { literal: 'EQUIPMENT' },
      companyId: { binding: 'companyA' },
      currentBookValue: { literal: 1000 },
      name: { unique: { prefix: 'CRUD fixed asset' } },
      ownershipLevel: { literal: 'COMPANY' },
    });
    expect(fixedAsset.effect.generatedFields.createdById).toEqual({
      kind: 'exact',
      value: { binding: 'userA' },
    });

    const journalPreStates = [
      {
        model: 'AccountingPeriod',
        id: { binding: 'model:AccountingPeriod' },
        fields: { status: { literal: 'OPEN' } },
      },
      {
        model: 'FiscalYear',
        id: { binding: 'model:FiscalYear' },
        fields: { status: { literal: 'OPEN' } },
      },
    ];
    for (const capabilityId of [
      'JournalEntriesController.post',
      'JournalEntriesController.update',
      'JournalEntriesController.remove',
    ]) {
      expect(fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.preStates).toEqual(
        journalPreStates,
      );
    }

    const mobileMoney = fixtures.find(
      (fixture) => fixture.capabilityId === 'MobileMoneyAccountsController.create',
    );
    if (mobileMoney?.effect.kind !== 'create') throw new Error('mobile-money fixture drifted');
    expect(mobileMoney.request.body).toEqual({
      employeeId: { binding: 'model:Employee' },
      msisdn: { literal: '0712345678' },
      provider: { literal: 'M_PESA' },
    });
    expect(mobileMoney.effect.expectedFields).toEqual({
      employeeId: { binding: 'model:Employee' },
      msisdn: { literal: '+255712345678' },
      provider: { literal: 'M_PESA' },
    });

    const terminal = fixtures.find(
      (fixture) => fixture.capabilityId === 'MobilePosLiteController.updateTerminal',
    );
    if (terminal?.effect.kind !== 'update') throw new Error('mobile-POS fixture drifted');
    expect(terminal.preState).toEqual({
      model: 'MobilePosTerminal',
      id: { binding: 'model:MobilePosTerminal' },
      fields: { configVersion: { literal: 1 } },
    });
    expect(terminal.preStates).toEqual([
      {
        model: 'MobilePosTerminalPayment',
        id: { binding: 'model:MobilePosTerminalPayment' },
        fields: {
          cashAccountId: { binding: 'model:CashAccount' },
          isEnabled: { literal: true },
          paymentMethod: { literal: 'CASH' },
        },
      },
    ]);
    expect(terminal.effect.expectedFields).toEqual({
      name: { unique: { prefix: 'Updated POS terminal' } },
      configVersion: { literal: 2 },
    });
  });

  it('keeps Loans.create on the documented singular opening-balance branch', () => {
    const loan = fixtures.find((fixture) => fixture.capabilityId === 'LoansController.create');
    if (loan?.effect.kind !== 'create') throw new Error('loan fixture drifted');
    expect(loan.request.body).toEqual({
      borrowerLevel: { literal: 'COMPANY' },
      companyId: { binding: 'companyA' },
      disbursementDate: { literal: '2026-08-25' },
      interestRate: { literal: '5.00' },
      lenderName: { unique: { prefix: 'CRUD lender' } },
      maturityDate: { literal: '2027-08-25' },
      outstandingBalance: { literal: '900.00' },
      principalAmount: { literal: '1000.00' },
    });
    expect(loan.effect.expectedFields).toEqual({
      borrowerLevel: { literal: 'COMPANY' },
      companyId: { binding: 'companyA' },
      disbursementDate: { literal: '2026-08-25' },
      interestRate: { literal: 5 },
      lenderName: { unique: { prefix: 'CRUD lender' } },
      maturityDate: { literal: '2027-08-25' },
      outstandingBalance: { literal: 900 },
      principalAmount: { literal: 1000 },
    });
    expect(loan.effect.generatedFields.createdById).toEqual({
      kind: 'exact',
      value: { binding: 'userA' },
    });
  });

  it('binds child-create audits to their parent aggregate and exact company', () => {
    for (const [capabilityId, parentModel] of [
      ['ApprovalRequestsController.addComment', 'ApprovalRequest'],
      ['CustomerSegmentsController.addMember', 'CustomerSegment'],
    ] as const) {
      expect(fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.audit).toEqual(
        expect.objectContaining({
          entityId: { binding: `model:${parentModel}` },
          companyId: { kind: 'exact', value: { binding: 'companyA' } },
        }),
      );
    }
  });

  it('models bank-account CRUD and its receipt-account projection as exact recoverable effects', () => {
    const bankFixtures = new Map(
      fixtures
        .filter((fixture) => fixture.capabilityId.startsWith('BankAccountsController.'))
        .map((fixture) => [fixture.capabilityId, fixture]),
    );

    expect([...bankFixtures.keys()].sort()).toEqual([
      'BankAccountsController.create',
      'BankAccountsController.remove',
      'BankAccountsController.update',
    ]);
    for (const fixture of bankFixtures.values()) {
      expect(fixture.executionPrincipal).toBe('group');
      expect(fixture.audit.companyId).toEqual({
        kind: 'exact',
        value: { binding: 'companyA' },
      });
      if (fixture.effect.kind !== 'compound') throw new Error('bank fixture drifted');
      expect([...crudMutationBusinessDeltaModels(fixture.effect)].sort()).toEqual([
        'BankAccount',
        'CashAccount',
      ]);
      expect(crudMutationRecoveryPlan(fixture.effect)).toEqual([
        expect.objectContaining({
          contractId: 'receiptCashAccount',
          model: 'CashAccount',
          recoveryOrder: 10,
        }),
        expect.objectContaining({
          contractId: 'bankAccount',
          model: 'BankAccount',
          recoveryOrder: 20,
        }),
      ]);
    }

    expect(bankFixtures.get('BankAccountsController.create')?.effect).toMatchObject({
      kind: 'compound',
      effects: [
        expect.objectContaining({ kind: 'row-create', model: 'BankAccount' }),
        expect.objectContaining({
          kind: 'set-delta',
          model: 'CashAccount',
          expectedAdded: [
            expect.objectContaining({
              linkedBankAccountId: { effectRef: { effectId: 'bankAccount' } },
              accountType: { literal: 'BANK' },
            }),
          ],
        }),
      ],
    });
    expect(bankFixtures.get('BankAccountsController.update')?.effect).toMatchObject({
      kind: 'compound',
      effects: [
        expect.objectContaining({ kind: 'row-update', model: 'BankAccount' }),
        expect.objectContaining({ kind: 'row-update', model: 'CashAccount' }),
      ],
    });
    expect(bankFixtures.get('BankAccountsController.remove')?.effect).toMatchObject({
      kind: 'compound',
      effects: [
        expect.objectContaining({ kind: 'row-delete', model: 'BankAccount', mode: 'soft' }),
        expect.objectContaining({ kind: 'row-delete', model: 'CashAccount', mode: 'soft' }),
      ],
    });
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

function assertModelValues(
  modelName: string,
  values: Readonly<Record<string, CrudMutationEffectValue>>,
): void {
  const model = PRISMA_MODEL_BY_NAME.get(modelName);
  expect(model).toBeDefined();
  if (!model) return;

  for (const [fieldName, value] of Object.entries(values)) {
    const field = model.fields.find((candidate) => candidate.name === fieldName);
    expect(field).toBeDefined();
    if (!field || field.kind !== 'enum' || !('literal' in value) || value.literal === null) {
      continue;
    }
    expect(PRISMA_ENUM_VALUES.get(field.type)?.has(String(value.literal))).toBe(true);
  }
}
