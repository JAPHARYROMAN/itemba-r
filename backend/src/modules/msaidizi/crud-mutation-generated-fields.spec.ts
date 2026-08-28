import { Prisma } from '@prisma/client';
import { CRUD_MUTATION_AM_EVIDENCE_PACKS } from './crud-mutation-am-evidence';
import { CRUD_MUTATION_BASE_EVIDENCE_PACK } from './crud-mutation-base-evidence';
import { CRUD_MUTATION_NS_EVIDENCE_PACKS } from './crud-mutation-ns-evidence';
import { CRUD_MUTATION_TZ_EVIDENCE_PACKS } from './crud-mutation-tz-evidence';
import {
  mutationEvidencePacksForManifest,
  validateCrudMutationFixtureDmmfContract,
} from './crud-mutation-evidence-registry';
import {
  CrudMutationAnyFixtureRegistration,
  crudMutationAllowedModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const fixtures = [
  CRUD_MUTATION_BASE_EVIDENCE_PACK,
  ...CRUD_MUTATION_AM_EVIDENCE_PACKS,
  ...CRUD_MUTATION_NS_EVIDENCE_PACKS,
  ...CRUD_MUTATION_TZ_EVIDENCE_PACKS,
].flatMap((pack) => pack.fixtures);

function fixture(capabilityId: string): CrudMutationAnyFixtureRegistration {
  const found = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
  if (!found) throw new Error(`Missing test fixture ${capabilityId}.`);
  return found;
}

describe('closed-world create generated-field evidence', () => {
  it('preflights every create against live DMMF with no required scalar gap', () => {
    expect(() => mutationEvidencePacksForManifest([])).not.toThrow();
    const creates = fixtures.filter((candidate) => candidate.effect.kind === 'create');
    expect(creates).toHaveLength(133);
    expect(
      creates.filter(
        (candidate) =>
          candidate.effect.kind === 'create' &&
          Object.keys(candidate.effect.generatedFields).length > 0,
      ),
    ).toHaveLength(81);
    const requiredGeneratedFieldCount = creates.reduce((total, candidate) => {
      const effect = candidate.effect;
      if (effect.kind !== 'create') return total;
      const model = Prisma.dmmf.datamodel.models.find((item) => item.name === effect.model);
      if (!model) throw new Error(`Missing DMMF model ${effect.model}.`);
      return (
        total +
        Object.keys(effect.generatedFields).filter((fieldName) => {
          const field = model.fields.find((item) => item.name === fieldName);
          return (
            field &&
            field.kind !== 'object' &&
            field.isRequired &&
            !field.isList &&
            !field.hasDefaultValue &&
            !(field as { isUpdatedAt?: boolean }).isUpdatedAt
          );
        }).length
      );
    }, 0);
    expect(requiredGeneratedFieldCount).toBe(107);
  });

  it('keeps request aliases out of persisted field declarations', () => {
    const automation = fixture('AutomationRunsController.trigger');
    expect(automation.request.body).toHaveProperty('ruleId');
    expect(automation.effect).toMatchObject({
      kind: 'create',
      expectedFields: { companyId: { binding: 'companyA' } },
      generatedFields: {
        automationRuleId: {
          kind: 'exact',
          value: { binding: 'model:AutomationRule' },
        },
      },
    });

    const dashboard = fixture('UserDashboardPreferencesController.setDefault');
    expect(dashboard.request.path).toHaveProperty('dashboardId');
    expect(dashboard.preState).toEqual({
      model: 'UserDashboardPreference',
      id: { binding: 'model:UserDashboardPreference' },
      fields: {
        userId: { binding: 'userA' },
        dashboardDefinitionId: { binding: 'model:DashboardDefinition' },
        isDefault: { literal: false },
      },
    });
    expect(dashboard.effect).toMatchObject({
      kind: 'transition',
      model: 'UserDashboardPreference',
      id: { binding: 'model:UserDashboardPreference' },
      expectedFields: { isDefault: { literal: true } },
    });
  });

  it('declares service-owned actor and sequence defaults exactly', () => {
    for (const capabilityId of [
      'ContractsController.create',
      'DebtsController.create',
      'FixedAssetsController.create',
      'LoansController.create',
    ]) {
      expect(fixture(capabilityId).effect).toMatchObject({
        kind: 'create',
        generatedFields: {
          createdById: { kind: 'exact', value: { binding: 'userA' } },
        },
      });
    }
    expect(fixture('DocumentNumberSequencesController.create').effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        currentNumber: { kind: 'exact', value: { literal: 1 } },
      },
    });
    expect(fixture('WebhookEndpointsController.create').effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        createdById: { kind: 'exact', value: { binding: 'userA' } },
        secretHash: {
          kind: 'response-secret-digest',
          responsePath: ['rawSecret'],
          algorithm: 'sha256',
          encoding: 'hex',
        },
      },
    });
  });

  it('declares derived organization and supplier-review fields independently', () => {
    for (const capabilityId of [
      'AttendanceController.create',
      'EmploymentDisputesController.create',
      'EmploymentDisputesController.createDirectGrievance',
      'LeaveRequestsController.create',
    ]) {
      expect(fixture(capabilityId).effect).toMatchObject({
        kind: 'create',
        generatedFields: {
          divisionId: {
            kind: 'exact',
            value: { binding: 'model:Employee', path: ['divisionId'] },
          },
        },
      });
    }
    expect(fixture('PerformanceController.create').effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        divisionId: {
          kind: 'exact',
          value: { binding: 'model:Employee', path: ['divisionId'] },
        },
        branchId: {
          kind: 'exact',
          value: { binding: 'model:Employee', path: ['branchId'] },
        },
      },
    });
    expect(fixture('SupplierPerformanceController.create').effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        lastReviewedAt: { kind: 'action-time' },
        reviewedById: { kind: 'exact', value: { binding: 'userA' } },
      },
    });
  });

  it('fails closed when a required actor binding is removed', () => {
    const original = fixture('AccountingLocksController.create');
    if (original.effect.kind !== 'create') throw new Error('test fixture drifted');
    const invalid: CrudMutationAnyFixtureRegistration = {
      ...original,
      effect: {
        ...original.effect,
        generatedFields: {},
      },
    };
    expect(validateCrudMutationFixtureDmmfContract(invalid)).toContain(
      'required scalar AccountingLock.createdById has no exact create contract',
    );
  });

  it('fails closed when a response-secret digest path is empty', () => {
    const original = fixture('WebhookEndpointsController.create');
    if (original.effect.kind !== 'create') throw new Error('webhook fixture drifted');
    const invalid: CrudMutationAnyFixtureRegistration = {
      ...original,
      effect: {
        ...original.effect,
        generatedFields: {
          ...original.effect.generatedFields,
          secretHash: {
            kind: 'response-secret-digest',
            responsePath: [],
            algorithm: 'sha256',
            encoding: 'hex',
          },
        },
      },
    };
    expect(validateCrudMutationFixtureContract(invalid)).toContain(
      'generated field secretHash has an invalid secret response path',
    );
  });

  it('admits DocumentNumberSequence only for an exact entity-code contract', () => {
    const sequenceBacked = fixture('AuditAdjustmentsController.create');
    const direct = fixture('AlertRulesController.create');
    expect(crudMutationAllowedModels(sequenceBacked.effect)).toContain('DocumentNumberSequence');
    expect(crudMutationAllowedModels(direct.effect)).not.toContain('DocumentNumberSequence');
    expect(crudMutationRecoveryPlan(sequenceBacked.effect)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'generated-field',
          contractId: 'generated:adjustmentNumber',
          model: 'DocumentNumberSequence',
          recovery: 'restore-scope',
        }),
      ]),
    );
  });

  it('uses independent source aggregates and calendar-aware schedule evidence', () => {
    for (const capabilityId of [
      'CustomerStatementsController.generate',
      'SupplierStatementsController.generate',
    ]) {
      const statement = fixture(capabilityId);
      if (statement.effect.kind !== 'create') throw new Error('statement fixture drifted');
      expect(
        Object.values(statement.effect.generatedFields)
          .filter((validator) => validator.kind === 'independent-domain-aggregate')
          .map((validator) => validator.source),
      ).toEqual(
        Array(4).fill(
          capabilityId.startsWith('Customer') ? 'customer-statement' : 'supplier-statement',
        ),
      );
    }

    const financial = fixture('FinancialStatementsController.generate');
    expect(financial.effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        resultSummary: {
          kind: 'independent-domain-aggregate',
          source: 'financial-trial-balance',
        },
      },
    });
    const scheduled = fixture('ScheduledReportsController.create');
    expect(scheduled.effect).toMatchObject({
      kind: 'create',
      generatedFields: {
        nextRunAt: { kind: 'action-local-calendar-days', offsetDays: 1 },
      },
    });
    expect(
      fixtures.flatMap((candidate) =>
        candidate.effect.kind === 'create'
          ? Object.values(candidate.effect.generatedFields).map((validator) => validator.kind)
          : [],
      ),
    ).not.toContain('response-path');
  });

  it('admits UTC day boundaries only for DateTime generated fields', () => {
    const scheduled = fixture('ScheduledReportsController.create');
    if (scheduled.effect.kind !== 'create') throw new Error('scheduled fixture drifted');
    const validUtcBoundary: CrudMutationAnyFixtureRegistration = {
      ...scheduled,
      effect: {
        ...scheduled.effect,
        generatedFields: {
          ...scheduled.effect.generatedFields,
          nextRunAt: {
            kind: 'utc-day-start',
            value: { literal: '2026-08-27T12:00:00.000Z' },
          },
        },
      },
    };
    expect(validateCrudMutationFixtureDmmfContract(validUtcBoundary)).toEqual([]);

    const invalidUtcBoundary: CrudMutationAnyFixtureRegistration = {
      ...scheduled,
      effect: {
        ...scheduled.effect,
        generatedFields: {
          ...scheduled.effect.generatedFields,
          createdById: {
            kind: 'utc-day-end',
            value: { literal: '2026-08-27T12:00:00.000Z' },
          },
        },
      },
    };
    expect(validateCrudMutationFixtureDmmfContract(invalidUtcBoundary)).toContain(
      'generated UTC day boundary ScheduledReport.createdById is not DateTime',
    );
    expect(validateCrudMutationFixtureDmmfContract(invalidUtcBoundary)).not.toContain(
      'generated field ScheduledReport.createdById requires a String scalar validator',
    );
  });
});
