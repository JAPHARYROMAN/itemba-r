import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS,
  CRUD_ADMIN_OPERATIONS_POSITIVE_EVIDENCE_PACK,
  CRUD_ADMIN_OPERATIONS_POSITIVE_REQUIRED_BINDINGS,
} from './crud-admin-operations-positive-evidence';
import {
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const EXPECTED_AUTH = {
  'ApiKeysController.create': { permissions: ['api_keys.create'], anyPermissions: [] },
  'CompaniesController.create': { permissions: ['companies.create'], anyPermissions: [] },
  'CompaniesController.remove': { permissions: ['companies.delete'], anyPermissions: [] },
  'DivisionsController.remove': { permissions: ['divisions.delete'], anyPermissions: [] },
  'EntityCodeGeneratorController.runBackfill': {
    permissions: ['doc_sequences.update'],
    anyPermissions: [],
  },
  'FixedAssetsController.capitalize': {
    permissions: ['fixed-assets.update'],
    anyPermissions: [],
  },
  'MobilePosLiteController.counterDeliveryBackfill': {
    permissions: ['mobile_pos_lite.manage'],
    anyPermissions: [],
  },
  'MobilePosLiteController.createTerminal': {
    permissions: ['mobile_pos_lite.manage'],
    anyPermissions: [],
  },
  'ProductsController.removeImage': { permissions: ['products.update'], anyPermissions: [] },
  'ProfitController.backfillSales': {
    permissions: [],
    anyPermissions: ['profit.manage_costs'],
  },
  'ProfitController.validateSaleLines': {
    permissions: [],
    anyPermissions: ['profit.view', 'sales.create', 'pos.create'],
  },
  'ProformaInvoicesController.create': { permissions: ['proformas.create'], anyPermissions: [] },
  'ScheduledReportsController.run': {
    permissions: ['scheduled_reports.run'],
    anyPermissions: [],
  },
  'UsersController.assignRoles': { permissions: ['users.assign_roles'], anyPermissions: [] },
  'UsersController.create': { permissions: ['users.create'], anyPermissions: [] },
  'UsersController.grantCompanyAccess': {
    permissions: ['users.assign_roles'],
    anyPermissions: [],
  },
  'WestsidesReportsController.saveDailyClose': {
    permissions: ['westsides.daily_close.manage'],
    anyPermissions: [],
  },
} as const;

const EXPECTED_AUDITS: Readonly<
  Record<keyof typeof EXPECTED_AUTH, { action: string; entityType: string }>
> = {
  'ApiKeysController.create': { action: 'API_KEY_CREATED', entityType: 'ApiKey' },
  'CompaniesController.create': { action: 'COMPANY_CREATED', entityType: 'Company' },
  'CompaniesController.remove': { action: 'COMPANY_DELETED', entityType: 'Company' },
  'DivisionsController.remove': { action: 'DIVISION_DELETE', entityType: 'Division' },
  'EntityCodeGeneratorController.runBackfill': {
    action: 'ENTITY_CODE_BACKFILL',
    entityType: 'DocumentNumberSequence',
  },
  'FixedAssetsController.capitalize': {
    action: 'fixed_asset.capitalize',
    entityType: 'FixedAsset',
  },
  'MobilePosLiteController.counterDeliveryBackfill': {
    action: 'MOBILE_POS_LITE_COUNTER_DELIVERY_BACKFILL',
    entityType: 'SalesOrder',
  },
  'MobilePosLiteController.createTerminal': {
    action: 'MOBILE_POS_LITE_TERMINAL_CREATED',
    entityType: 'MobilePosTerminal',
  },
  'ProductsController.removeImage': { action: 'PRODUCT_UPDATE', entityType: 'Product' },
  'ProfitController.backfillSales': { action: 'PROFIT_BACKFILL_RUN', entityType: 'Profit' },
  'ProfitController.validateSaleLines': {
    action: 'PROFIT_VALIDATION_RUN',
    entityType: 'ProfitValidation',
  },
  'ProformaInvoicesController.create': {
    action: 'PROFORMA_INVOICE_CREATE',
    entityType: 'ProformaInvoice',
  },
  'ScheduledReportsController.run': { action: 'UPDATE', entityType: 'ScheduledReport' },
  'UsersController.assignRoles': { action: 'USER_ROLES_ASSIGNED', entityType: 'User' },
  'UsersController.create': { action: 'USER_CREATED', entityType: 'User' },
  'UsersController.grantCompanyAccess': {
    action: 'USER_COMPANY_ACCESS_GRANTED',
    entityType: 'User',
  },
  'WestsidesReportsController.saveDailyClose': {
    action: 'WESTSIDES_DAILY_CLOSE_CREATE',
    entityType: 'WestsidesDailyClose',
  },
};

type ExpectedId = keyof typeof EXPECTED_AUTH;
const EXPECTED_IDS = Object.keys(EXPECTED_AUTH) as ExpectedId[];

describe('standalone administrative/operations positive mutation evidence tranche', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_ADMIN_OPERATIONS_POSITIVE_EVIDENCE_PACK.fixtures;

  it('closes exactly the requested 17 live capabilities with positive controls', () => {
    expect([...CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(fixtures).toHaveLength(17);
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(17);
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
    expect(fixtures.filter((fixture) => fixture.operation === 'create')).toHaveLength(5);
    expect(fixtures.filter((fixture) => fixture.operation === 'delete')).toHaveLength(3);
    expect(fixtures.filter((fixture) => fixture.operation === 'action')).toHaveLength(9);
  });

  it('pins every live route envelope, permission policy and strict DTO', () => {
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;
      const auth = EXPECTED_AUTH[fixture.capabilityId as ExpectedId];

      expect(capability.verb).not.toBe('GET');
      expect(capability.agentExcluded).toBe(false);
      expect(capability.permissions).toEqual(auth.permissions);
      expect(capability.anyPermissions).toEqual(auth.anyPermissions);
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

    for (const id of [
      'MobilePosLiteController.counterDeliveryBackfill',
      'ProfitController.backfillSales',
    ] as const) {
      expect(byId.get(id)?.params.querySchema).toMatchObject({
        quality: 'strict',
        schema: { additionalProperties: false },
      });
    }
  });

  it('declares valid closed contracts and complete scalar closure for every additive row', () => {
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

  it('pins exact attributable audits and deterministic child-before-parent recovery', () => {
    for (const candidate of fixtures) {
      const id = candidate.capabilityId as ExpectedId;
      expect(candidate.audit).toMatchObject({
        required: true,
        attributionStatus: 'EXPLICIT',
        scopeKind: 'COMPANY',
        ...EXPECTED_AUDITS[id],
      });
      const recovery = crudMutationRecoveryPlan(candidate.effect);
      if (candidate.effect.kind === 'audit-only') {
        expect(recovery).toEqual([]);
      } else {
        expect(recovery.length).toBeGreaterThan(0);
        expect(recovery.map((item) => item.recoveryOrder)).toEqual(
          [...recovery.map((item) => item.recoveryOrder)].sort((left, right) => left - right),
        );
        expect(new Set(recovery.map((item) => item.recoveryOrder)).size).toBe(recovery.length);
      }
    }

    expect(recoveryModels('CompaniesController.create')).toEqual(['UserCompanyAccess', 'Company']);
    expect(recoveryModels('FixedAssetsController.capitalize')).toEqual([
      'JournalEntryLine',
      'JournalEntryLine',
      'JournalEntry',
    ]);
    expect(recoveryModels('MobilePosLiteController.createTerminal')).toEqual([
      'MobilePosTerminalPayment',
      'MobilePosTerminal',
    ]);
    expect(recoveryModels('ScheduledReportsController.run')).toEqual([
      'ScheduledReport',
      'DataExportLog',
      'ReportRun',
    ]);
  });

  it('proves generated secrets in memory and fixes every zero-row branch to a dedicated anchor', () => {
    expect(fixture('ApiKeysController.create')).toMatchObject({
      effect: {
        generatedFields: {
          apiKeyCode: {
            kind: 'timestamp-id',
            prefix: 'KEY-',
            timestampEncoding: 'base36-upper',
            randomSuffix: { alphabet: 'hex-upper', length: 8, separator: '-' },
          },
          keyPrefix: { kind: 'response-secret-prefix', responsePath: ['rawKey'], length: 8 },
          keyHash: {
            kind: 'response-secret-digest',
            responsePath: ['rawKey'],
            algorithm: 'hmac-sha256-app-encryption-key',
            encoding: 'hex',
          },
        },
      },
      audit: {
        payload: {
          responseSecretsAbsent: [['rawKey']],
          forbiddenKeys: ['rawKey', 'keyHash'],
        },
      },
    });
    expect(fixture('UsersController.create')).toMatchObject({
      request: { body: { email: { binding: 'adminOperationsCreatedUserEmail' } } },
      effect: {
        generatedFields: {
          passwordHash: {
            kind: 'request-secret-hash',
            requestPath: ['password'],
            algorithm: 'argon2',
          },
        },
      },
      audit: { payload: { forbiddenKeys: ['password', 'passwordHash'] } },
    });
    expect(fixture('MobilePosLiteController.createTerminal')).toMatchObject({
      effect: {
        effects: expect.arrayContaining([
          expect.objectContaining({
            effectId: 'terminal',
            generatedFields: expect.objectContaining({
              terminalCode: { kind: 'response-exact', responsePath: ['terminal', 'code'] },
              activationTokenHash: {
                kind: 'response-secret-digest',
                responsePath: ['activation', 'activationCode'],
                algorithm: 'sha256',
                encoding: 'hex',
              },
            }),
          }),
        ]),
      },
      audit: {
        payload: {
          responseSecretsAbsent: [['activation', 'activationCode']],
          forbiddenKeys: ['activationCode', 'activationTokenHash'],
        },
      },
    });

    for (const id of [
      'EntityCodeGeneratorController.runBackfill',
      'MobilePosLiteController.counterDeliveryBackfill',
      'ProductsController.removeImage',
      'ProfitController.backfillSales',
      'ProfitController.validateSaleLines',
    ] as const) {
      expect(fixture(id).effect.kind).toBe('audit-only');
    }
    expect(fixture('DivisionsController.remove').preState).toMatchObject({
      fields: { companyId: { binding: 'companyA' } },
    });
    expect(fixture('CompaniesController.remove').preState).toMatchObject({
      id: { binding: 'adminOperationsCompany' },
    });
  });

  it('exports the exact deterministic seed/binding contract for loopback execution', () => {
    expect([...CRUD_ADMIN_OPERATIONS_POSITIVE_REQUIRED_BINDINGS]).toEqual([
      'adminOperationsActor',
      'adminOperationsAccountingPeriod',
      'adminOperationsApiClient',
      'adminOperationsBranchA',
      'adminOperationsCashLedgerAccount',
      'adminOperationsCompany',
      'adminOperationsCreatedUserEmail',
      'adminOperationsDivision',
      'adminOperationsDivisionA',
      'adminOperationsFixedAssetAccount',
      'adminOperationsMobileCashAccount',
      'adminOperationsMobileCustomer',
      'adminOperationsMobileEmployee',
      'adminOperationsProduct',
      'adminOperationsRole',
      'adminOperationsSchedule',
      'adminOperationsUser',
    ]);
  });

  function fixture(capabilityId: ExpectedId) {
    const found = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
    expect(found).toBeDefined();
    return found!;
  }

  function recoveryModels(capabilityId: ExpectedId): string[] {
    return crudMutationRecoveryPlan(fixture(capabilityId).effect).map((item) => item.model);
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
