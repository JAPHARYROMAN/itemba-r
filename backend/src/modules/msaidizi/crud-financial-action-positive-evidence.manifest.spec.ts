import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_FINANCIAL_ACTION_POSITIVE_CLOSED_IDS,
  CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK,
  CRUD_FINANCIAL_ACTION_POSITIVE_REQUIRED_BINDINGS,
} from './crud-financial-action-positive-evidence';
import {
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const EXPECTED_PERMISSIONS = {
  'AuditAdjustmentsController.post': 'audit_adjustments.post',
  'AuditAdjustmentsController.reverse': 'audit_adjustments.post',
  'BankReconciliationsController.manualMatch': 'bank_reconciliations.update',
  'BankReconciliationsController.postAdjustment': 'bank_reconciliations.update',
  'BankReconciliationsController.runMatching': 'bank_reconciliations.update',
  'BankReconciliationsController.unmatch': 'bank_reconciliations.update',
  'CreditNotesController.create': 'receivables.manage',
  'CreditNotesController.issue': 'receivables.manage',
  'CustomerPaymentsController.create': 'customer-payments.manage',
  'CustomerPaymentsController.reverse': 'customer-payments.manage',
  'DepreciationController.postEntry': 'depreciation.post_entry',
  'ExpensesController.pay': 'expenses.pay',
  'GoodsReceivedNotesController.post': 'grn.post',
  'IntercompanyTransactionsController.post': 'intercompany.post',
  'LoanRepaymentSchedulesController.generateForLoan': 'loan_schedules.create',
  'LoanRepaymentSchedulesController.recordPayment': 'loan_schedules.pay',
  'LoansController.recordRepayment': 'loans.manage',
  'PayablesController.create': 'payables.manage',
  'PayablesController.recordPayment': 'payables.manage',
  'ReceivablesController.create': 'receivables.manage',
  'ReceivablesController.recordPayment': 'receivables.manage',
  'RefundsController.pay': 'refunds.manage',
  'SalaryAdvancesController.pay': 'salary_advances.pay',
  'TaxFilingEngineController.compute': 'finance.reports.view',
  'ThreeWayMatchingController.create': 'three_way_match.create',
} as const;

type ExpectedId = keyof typeof EXPECTED_PERMISSIONS;
const EXPECTED_IDS = Object.keys(EXPECTED_PERMISSIONS) as ExpectedId[];

describe('standalone finance/operations positive mutation evidence tranche', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK.fixtures;

  it('closes exactly the requested 25 live capabilities with positive controls', () => {
    expect([...CRUD_FINANCIAL_ACTION_POSITIVE_CLOSED_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(fixtures).toHaveLength(25);
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(25);
    expect(fixtures.every((fixture) => fixture.controlKind === 'positive')).toBe(true);

    const coverage = new Map(
      buildCrudCoverageReport(manifest).capabilities.map((entry) => [
        entry.capabilityId,
        entry.operation,
      ]),
    );
    for (const fixture of fixtures) {
      expect(fixture.operation).toBe(coverage.get(fixture.capabilityId));
    }
  });

  it('pins each exact route envelope, single permission and strict request body', () => {
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;
      expect(capability.verb).not.toBe('GET');
      expect(capability.agentExcluded).toBe(false);
      expect(capability.permissions).toEqual([
        EXPECTED_PERMISSIONS[fixture.capabilityId as ExpectedId],
      ]);
      expect(capability.anyPermissions).toEqual([]);
      expect(Object.keys(fixture.request.path ?? {}).sort()).toEqual(
        [...capability.params.path].sort(),
      );
      expect(Object.keys(fixture.request.query ?? {}).sort()).toEqual(
        [...capability.params.query].sort(),
      );
      if (!capability.params.hasBody) {
        expect(fixture.request.body).toBeUndefined();
        continue;
      }
      expect(capability.params.bodySchema?.quality).toBe('strict');
      expect(capability.params.bodySchema?.schema.additionalProperties).toBe(false);
      const schema = capability.params.bodySchema!.schema;
      const bodyKeys = Object.keys(fixture.request.body ?? {});
      expect((schema.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
      expect(bodyKeys.filter((key) => !schema.properties[key])).toEqual([]);
    }
  });

  it('uses valid closed contracts and complete scalar closure for every additive row', () => {
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      for (const state of [
        ...(fixture.preState ? [fixture.preState] : []),
        ...(fixture.preStates ?? []),
      ]) {
        assertScalarFields(state.model, Object.keys(state.fields));
      }

      if (fixture.effect.kind === 'create') {
        assertCompleteCreate(fixture.effect.model, {
          expected: Object.keys(fixture.effect.expectedFields),
          generated: Object.keys(fixture.effect.generatedFields),
          allowed: fixture.effect.allowedFields ?? [],
        });
      }
      if (fixture.effect.kind === 'compound') {
        for (const effect of fixture.effect.effects) {
          assertScalarFields(
            effect.model,
            effect.kind === 'scoped-row-create'
              ? [
                  ...Object.keys(effect.scope.equals),
                  ...effect.scope.identityFields,
                  ...Object.keys(effect.expectedFields),
                  ...Object.keys(effect.generatedFields),
                  ...(effect.allowedFields ?? []),
                ]
              : effect.kind === 'row-create'
                ? Object.keys(effect.expectedFields)
                : effect.kind === 'row-update' || effect.kind === 'row-delete'
                  ? [
                      ...Object.keys(effect.expectedFields),
                      ...(effect.kind === 'row-update' ? (effect.forbiddenFields ?? []) : []),
                    ]
                  : [...Object.keys(effect.scope.equals), ...effect.scope.identityFields],
          );
          if (effect.kind === 'scoped-row-create') {
            assertCompleteCreate(effect.model, {
              expected: Object.keys(effect.expectedFields),
              generated: Object.keys(effect.generatedFields),
              allowed: effect.allowedFields ?? [],
            });
          }
        }
      }

      expect([...crudMutationAllowedModels(fixture.effect)].sort()).toEqual(
        [
          'AuditLog',
          'AuditLogCompanyScope',
          ...crudMutationBusinessDeltaModels(fixture.effect),
        ].sort(),
      );
    }
  });

  it('requires exact explicit audit attribution and deterministic recovery for every control', () => {
    for (const fixture of fixtures) {
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.attributionStatus).toBe('EXPLICIT');
      expect(crudMutationRecoveryPlan(fixture.effect).length).toBeGreaterThan(0);
      expect(
        new Set(crudMutationRecoveryPlan(fixture.effect).map((item) => item.recoveryOrder)).size,
      ).toBe(crudMutationRecoveryPlan(fixture.effect).length);
    }

    expect(fixture('IntercompanyTransactionsController.post').audit).toMatchObject({
      action: 'INTERCOMPANY_POST',
      scopeKind: 'MULTI_COMPANY',
      companyId: { kind: 'exact', value: { literal: null } },
      companyScopeBindings: ['companyA', 'companyB'],
    });
    expect(fixture('BankReconciliationsController.manualMatch').audit).toMatchObject({
      action: 'MATCH',
      entityType: 'BankStatementLine',
      scopeKind: 'COMPANY',
    });
    expect(fixture('TaxFilingEngineController.compute').audit).toMatchObject({
      action: 'UPDATE',
      entityType: 'TaxReturn',
      scopeKind: 'COMPANY',
    });
  });

  it('pins the repaired bank ownership/audit, tax audit and additive schedule identity contracts', () => {
    expect(fixture('BankReconciliationsController.unmatch')).toMatchObject({
      request: {
        path: { id: { binding: 'financialPositiveBankMatchReconciliation' } },
        body: { statementLineId: { binding: 'financialPositiveBankMatchStatementLine' } },
      },
      effect: {
        kind: 'compound',
        auditEntityId: { binding: 'financialPositiveBankMatchStatementLine' },
      },
    });
    expect(fixture('TaxFilingEngineController.compute')).toMatchObject({
      effect: {
        kind: 'generated-transition',
        generatedFields: {
          notes: {
            kind: 'value-with-action-iso-suffix',
            suffix: '.',
          },
        },
      },
    });
    expect(fixture('LoanRepaymentSchedulesController.generateForLoan')).toMatchObject({
      effect: { kind: 'create', responseIdPath: ['scheduleIds', '0'] },
    });
    expect(CRUD_FINANCIAL_ACTION_POSITIVE_REQUIRED_BINDINGS).toContain(
      'financialPositiveBankExistingMatch',
    );
  });

  it('pins the live bank description and isolated customer-payment balance controls', () => {
    const adjustment = fixture('BankReconciliationsController.postAdjustment');
    expect(adjustment.effect.kind).toBe('compound');
    if (adjustment.effect.kind !== 'compound') throw new Error('fixture contract drifted');
    expect(
      adjustment.effect.effects.find((effect) => effect.effectId === 'cashLine'),
    ).toMatchObject({
      model: 'JournalEntryLine',
      expectedFields: { description: { literal: 'Fixture bank adjustment' } },
    });

    const create = fixture('CustomerPaymentsController.create');
    expect(create.request.body).toMatchObject({
      customerId: {
        binding: 'financialPositiveCustomerPaymentCreate',
        path: ['customer', 'id'],
      },
      cashAccountId: {
        binding: 'financialPositiveCustomerPaymentCreate',
        path: ['cashAccount', 'id'],
      },
    });
    expect(create.request.body?.allocations).toMatchObject({
      array: [
        {
          object: {
            receivableId: {
              binding: 'financialPositiveCustomerPaymentCreate',
              path: ['receivable', 'id'],
            },
          },
        },
      ],
    });
    expect(fixture('CustomerPaymentsController.reverse')).toMatchObject({
      request: {
        path: {
          id: {
            binding: 'financialPositiveCustomerPaymentReverse',
            path: ['payment', 'id'],
          },
        },
      },
      target: {
        id: {
          binding: 'financialPositiveCustomerPaymentReverse',
          path: ['payment', 'id'],
        },
      },
    });
    expect(CRUD_FINANCIAL_ACTION_POSITIVE_REQUIRED_BINDINGS).toEqual(
      expect.arrayContaining([
        'financialPositiveCustomerPaymentCreate',
        'financialPositiveCustomerPaymentReverse',
      ]),
    );
  });

  function fixture(capabilityId: ExpectedId) {
    const found = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
    expect(found).toBeDefined();
    return found!;
  }
});

function assertScalarFields(modelName: string, fields: readonly string[]): void {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalars = new Set(
    model?.fields.filter((field) => field.kind !== 'object').map((field) => field.name) ?? [],
  );
  expect(fields.filter((field) => !scalars.has(field))).toEqual([]);
}

function assertCompleteCreate(
  modelName: string,
  fields: { expected: readonly string[]; generated: readonly string[]; allowed: readonly string[] },
): void {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalars =
    model?.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort() ?? [];
  expect([...fields.expected, ...fields.generated, ...fields.allowed].sort()).toEqual(scalars);
}
