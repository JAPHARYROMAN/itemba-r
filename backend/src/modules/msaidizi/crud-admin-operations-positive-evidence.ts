import { createHash } from 'node:crypto';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationAuditContract,
  CrudMutationEffectValue,
  CrudMutationValue,
  crudMutationAuditScopeKind,
} from './crud-mutation-evidence';

type FixtureDefinition = Omit<
  CrudMutationAnyFixtureRegistration,
  'audit' | 'controlKind' | 'description' | 'fixtureId' | 'fixtureVersion' | 'governance' | 'packId'
> & {
  audit: Omit<CrudMutationAuditContract, 'scopeKind'>;
  description: string;
};

const PACK_ID = 'mutation-admin-operations-positive-v1';
const CAPITALIZATION_DATE = '2026-06-20T00:00:00.000Z';
const PROFORMA_DATE = '2031-03-10T00:00:00.000Z';
const DAILY_CLOSE_DATE = '2031-04-15T00:00:00.000Z';
const CAPITALIZATION_DESCRIPTION =
  'Capitalize fixed asset CE-CAP-ASSET - CRUD capitalization asset';

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const response = (...path: string[]): CrudMutationEffectValue => ({ response: { path } });
const effectRef = (effectId: string, path?: readonly string[]): CrudMutationEffectValue => ({
  effectRef: { effectId, ...(path ? { path } : {}) },
});
const array = (...values: CrudMutationValue[]): CrudMutationValue => ({ array: values });
const object = (values: Readonly<Record<string, CrudMutationValue>>): CrudMutationValue => ({
  object: values,
});
const unique = (prefix: string): CrudMutationValue => ({ unique: { prefix } });
const nowIso: CrudMutationValue = { now: 'iso' };

const companyA = binding('companyA');
const companyB = binding('companyB');
const userA = binding('userA');
const adminCompany = binding('adminOperationsCompany');
const adminDivision = binding('adminOperationsDivision');
const adminApiClient = binding('adminOperationsApiClient');
const adminProduct = binding('adminOperationsProduct');
const adminUser = binding('adminOperationsUser');
const adminRole = binding('adminOperationsRole');
const adminSchedule = binding('adminOperationsSchedule');
const fixedAsset = idOf('FixedAsset');
const fixedAssetAccount = binding('adminOperationsFixedAssetAccount');
const cashLedgerAccount = binding('adminOperationsCashLedgerAccount');
const accountingPeriod = binding('adminOperationsAccountingPeriod');
const mobileEmployee = binding('adminOperationsMobileEmployee');
const mobileCustomer = binding('adminOperationsMobileCustomer');
const mobileCashAccount = binding('adminOperationsMobileCashAccount');
const divisionA = binding('adminOperationsDivisionA');
const branchA = binding('adminOperationsBranchA');
const createdUserEmail = binding('adminOperationsCreatedUserEmail');

const nullAuditEntity = literal(null);

const definitions: readonly FixtureDefinition[] = [
  {
    capabilityId: 'ApiKeysController.create',
    operation: 'create',
    description:
      'Create one API key under a dedicated same-company client, prove the complete row while checking the one-time raw key against its peppered HMAC and prefix entirely in memory, then delete only the created key.',
    request: {
      body: {
        apiClientId: adminApiClient,
        name: literal('CRUD evidence API key'),
        scopes: array(literal('customers.read')),
      },
    },
    preState: {
      model: 'ApiClient',
      id: adminApiClient,
      fields: {
        companyId: adminCompany,
        deletedAt: literal(null),
        status: literal('ACTIVE'),
      },
    },
    effect: {
      kind: 'create',
      model: 'ApiKey',
      responseIdPath: ['id'],
      expectedFields: {
        apiClientId: adminApiClient,
        name: literal('CRUD evidence API key'),
        scopes: array(literal('customers.read')),
        createdById: userA,
      },
      generatedFields: {
        apiKeyCode: {
          kind: 'timestamp-id',
          prefix: 'KEY-',
          timestampEncoding: 'base36-upper',
          randomSuffix: { alphabet: 'hex-upper', length: 8, separator: '-' },
        },
        keyPrefix: {
          kind: 'response-secret-prefix',
          responsePath: ['rawKey'],
          length: 8,
        },
        keyHash: {
          kind: 'response-secret-digest',
          responsePath: ['rawKey'],
          algorithm: 'hmac-sha256-app-encryption-key',
          encoding: 'hex',
        },
        expiresAt: { kind: 'exact', value: literal(null) },
        lastUsedAt: { kind: 'exact', value: literal(null) },
        revokedAt: { kind: 'exact', value: literal(null) },
        status: { kind: 'exact', value: literal('ACTIVE') },
        deletedAt: { kind: 'exact', value: literal(null) },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      companyId: { kind: 'exact', value: adminCompany },
      payload: {
        severity: 'MEDIUM',
        responseSecretsAbsent: [['rawKey']],
        forbiddenKeys: ['rawKey', 'keyHash'],
      },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'CompaniesController.create',
    operation: 'create',
    description:
      'Create one new company and the actor MANAGE grant in the same transaction, prove both complete rows plus the exact company audit, then remove the grant before the company.',
    request: {
      body: {
        groupId: idOf('Group'),
        code: unique('CE-ADMIN-COMPANY'),
        name: unique('CRUD admin company'),
      },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'company',
          kind: 'scoped-row-create',
          model: 'Company',
          scope: { equals: { code: unique('CE-ADMIN-COMPANY') }, identityFields: ['id'] },
          expectedFields: {
            groupId: idOf('Group'),
            code: unique('CE-ADMIN-COMPANY'),
            name: unique('CRUD admin company'),
          },
          generatedFields: {
            industryType: { kind: 'exact', value: literal(null) },
            status: { kind: 'exact', value: literal('ACTIVE') },
            phone: { kind: 'exact', value: literal(null) },
            email: { kind: 'exact', value: literal(null) },
            website: { kind: 'exact', value: literal(null) },
            logoUrl: { kind: 'exact', value: literal(null) },
            employeeCodePrefix: { kind: 'exact', value: literal(null) },
            deletedAt: { kind: 'exact', value: literal(null) },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'actorAccess',
          kind: 'scoped-row-create',
          model: 'UserCompanyAccess',
          scope: { equals: { userId: userA }, identityFields: ['id'] },
          expectedFields: {
            userId: userA,
            companyId: effectRef('company'),
            accessLevel: literal('MANAGE'),
            grantedById: userA,
          },
          generatedFields: { grantedAt: { kind: 'action-time' } },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: response('id'),
    },
    audit: {
      required: true,
      action: 'COMPANY_CREATED',
      entityType: 'Company',
      companyId: { kind: 'effect-company' },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'CompaniesController.remove',
    operation: 'delete',
    description:
      'Soft-delete a dedicated company that owns no divisions or branches, prove its sole deletion timestamp and attributable audit, then restore the company before later controls run.',
    request: { path: { id: adminCompany } },
    target: { model: 'Company', id: adminCompany },
    preState: {
      model: 'Company',
      id: adminCompany,
      fields: { deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'delete',
      model: 'Company',
      id: adminCompany,
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields: { deletedAt: nowIso },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'COMPANY_DELETED',
      entityType: 'Company',
      companyId: { kind: 'exact', value: adminCompany },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'DivisionsController.remove',
    operation: 'delete',
    description:
      'Soft-delete one dedicated branch-free division, prove the exact active/deleted transition and company audit, then restore the row.',
    request: { path: { id: adminDivision } },
    target: { model: 'Division', id: adminDivision },
    preState: {
      model: 'Division',
      id: adminDivision,
      fields: { companyId: companyA, deletedAt: literal(null), isActive: literal(true) },
    },
    effect: {
      kind: 'delete',
      model: 'Division',
      id: adminDivision,
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields: { deletedAt: nowIso, isActive: literal(false) },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'DIVISION_DELETE',
      entityType: 'Division',
      companyId: { kind: 'exact', value: companyA },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'EntityCodeGeneratorController.runBackfill',
    operation: 'action',
    description:
      'Run the sequence backfill against a dedicated company with no target entity rows, prove the reviewed zero-update branch has only its attributable audit effect, and retain the untouched company anchor.',
    request: { query: { companyId: adminCompany } },
    target: { model: 'Company', id: adminCompany },
    preState: {
      model: 'Company',
      id: adminCompany,
      fields: { deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'audit-only',
      model: 'Company',
      id: adminCompany,
      expectedFields: {},
      auditEntityId: adminCompany,
    },
    audit: {
      required: true,
      action: 'ENTITY_CODE_BACKFILL',
      entityType: 'DocumentNumberSequence',
      entityId: nullAuditEntity,
      companyId: { kind: 'exact', value: adminCompany },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'FixedAssetsController.capitalize',
    operation: 'action',
    description:
      'Capitalize one isolated company asset through the cash branch, prove the complete two-line posted journal and exact fixed-asset audit while confirming the register row itself is unchanged, then delete lines before the journal.',
    request: {
      path: { id: fixedAsset },
      body: { source: literal('CASH'), transactionDate: literal(CAPITALIZATION_DATE) },
    },
    target: { model: 'FixedAsset', id: fixedAsset },
    preStates: [
      {
        model: 'FixedAsset',
        id: fixedAsset,
        fields: {
          ownershipLevel: literal('COMPANY'),
          companyId: companyA,
          groupId: literal(null),
          divisionId: literal(null),
          branchId: literal(null),
          assetCode: literal('CE-CAP-ASSET'),
          name: literal('CRUD capitalization asset'),
          acquisitionDate: literal(CAPITALIZATION_DATE),
          acquisitionCost: literal(100),
          currentBookValue: literal(100),
          financingStatus: literal('OWNED_OUTRIGHT'),
          status: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'ChartOfAccount',
        id: fixedAssetAccount,
        fields: {
          companyId: companyA,
          accountSubType: literal('fixed_asset'),
          isActive: literal(true),
          deletedAt: literal(null),
        },
      },
      {
        model: 'ChartOfAccount',
        id: cashLedgerAccount,
        fields: {
          companyId: companyA,
          accountSubType: literal('cash_on_hand'),
          isActive: literal(true),
          deletedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'journal',
          kind: 'scoped-row-create',
          model: 'JournalEntry',
          scope: {
            equals: {
              companyId: companyA,
              referenceType: literal('FixedAsset'),
              referenceId: fixedAsset,
            },
            identityFields: ['id'],
          },
          expectedFields: {
            companyId: companyA,
            divisionId: literal(null),
            branchId: literal(null),
            accountingPeriodId: accountingPeriod,
            transactionDate: literal(CAPITALIZATION_DATE),
            description: literal(CAPITALIZATION_DESCRIPTION),
            referenceType: literal('FixedAsset'),
            referenceId: fixedAsset,
            status: literal('POSTED'),
            totalDebit: literal(100),
            totalCredit: literal(100),
            createdById: userA,
            postedById: userA,
            postedAt: literal(CAPITALIZATION_DATE),
            reversedById: literal(null),
            reversedAt: literal(null),
            reversalReason: literal(null),
            reversalOfId: literal(null),
            deletedAt: literal(null),
          },
          generatedFields: {
            journalNumber: {
              kind: 'timestamp-id',
              prefix: 'JE-FIXED_ASSETS-',
              timestampEncoding: 'base36-upper',
            },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'assetDebit',
          kind: 'scoped-row-create',
          model: 'JournalEntryLine',
          scope: {
            equals: {
              accountId: fixedAssetAccount,
              description: literal(CAPITALIZATION_DESCRIPTION),
            },
            identityFields: ['id'],
          },
          expectedFields: {
            journalEntryId: effectRef('journal'),
            accountId: fixedAssetAccount,
            description: literal(CAPITALIZATION_DESCRIPTION),
            debit: literal(100),
            credit: literal(0),
            companyId: companyA,
            divisionId: literal(null),
            branchId: literal(null),
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
        {
          effectId: 'cashCredit',
          kind: 'scoped-row-create',
          model: 'JournalEntryLine',
          scope: {
            equals: {
              accountId: cashLedgerAccount,
              description: literal('Asset cash acquisition: CE-CAP-ASSET'),
            },
            identityFields: ['id'],
          },
          expectedFields: {
            journalEntryId: effectRef('journal'),
            accountId: cashLedgerAccount,
            description: literal('Asset cash acquisition: CE-CAP-ASSET'),
            debit: literal(0),
            credit: literal(100),
            companyId: companyA,
            divisionId: literal(null),
            branchId: literal(null),
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 11,
        },
      ],
      auditEntityId: fixedAsset,
    },
    audit: {
      required: true,
      action: 'fixed_asset.capitalize',
      entityType: 'FixedAsset',
      companyId: { kind: 'exact', value: companyA },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'MobilePosLiteController.counterDeliveryBackfill',
    operation: 'action',
    description:
      'Run the counter-delivery repair against the dedicated company with no sales orders, prove the zero-scan path writes only its exact run audit, and retain the untouched company anchor.',
    request: { query: { companyId: adminCompany } },
    target: { model: 'Company', id: adminCompany },
    preState: {
      model: 'Company',
      id: adminCompany,
      fields: { deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'audit-only',
      model: 'Company',
      id: adminCompany,
      expectedFields: {},
      auditEntityId: literal('counter-delivery-backfill'),
    },
    audit: {
      required: true,
      action: 'MOBILE_POS_LITE_COUNTER_DELIVERY_BACKFILL',
      entityType: 'SalesOrder',
      entityId: literal('counter-delivery-backfill'),
      companyId: { kind: 'exact', value: adminCompany },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'MobilePosLiteController.createTerminal',
    operation: 'create',
    description:
      'Create one fully validated Mobile POS terminal with one CASH account, prove the terminal, payment child, ephemeral activation-code hash and audit, then delete the payment before the terminal.',
    request: {
      body: {
        companyId: companyA,
        divisionId: divisionA,
        branchId: branchA,
        salespersonId: mobileEmployee,
        generalCustomerId: mobileCustomer,
        name: literal('CRUD evidence terminal'),
        paymentMethods: array(
          object({
            paymentMethod: literal('CASH'),
            cashAccountId: mobileCashAccount,
            label: literal('Evidence cash'),
          }),
        ),
        creditEnabled: literal(false),
        offlineCashEnabled: literal(false),
      },
    },
    preStates: [
      {
        model: 'Employee',
        id: mobileEmployee,
        fields: {
          companyId: companyA,
          divisionId: divisionA,
          branchId: branchA,
          userId: binding('adminOperationsMobileEmployee', ['userId']),
          employmentStatus: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'Customer',
        id: mobileCustomer,
        fields: {
          companyId: companyA,
          divisionId: divisionA,
          branchId: branchA,
          status: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'CashAccount',
        id: mobileCashAccount,
        fields: {
          companyId: companyA,
          divisionId: divisionA,
          branchId: branchA,
          accountType: literal('CASH_ON_HAND'),
          isActive: literal(true),
          deletedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'terminal',
          kind: 'scoped-row-create',
          model: 'MobilePosTerminal',
          scope: { equals: { name: literal('CRUD evidence terminal') }, identityFields: ['id'] },
          expectedFields: {
            name: literal('CRUD evidence terminal'),
            companyId: companyA,
            divisionId: divisionA,
            branchId: branchA,
            assignedUserId: binding('adminOperationsMobileEmployee', ['userId']),
            salespersonId: mobileEmployee,
            generalCustomerId: mobileCustomer,
            creditEnabled: literal(false),
            offlineCashEnabled: literal(false),
          },
          generatedFields: {
            terminalCode: { kind: 'response-exact', responsePath: ['terminal', 'code'] },
            status: { kind: 'exact', value: literal('ACTIVE') },
            configVersion: { kind: 'exact', value: literal(1) },
            uiVersion: { kind: 'exact', value: literal(1) },
            activationTokenHash: {
              kind: 'response-secret-digest',
              responsePath: ['activation', 'activationCode'],
              algorithm: 'sha256',
              encoding: 'hex',
            },
            activationExpiresAt: {
              kind: 'response-exact',
              responsePath: ['activation', 'expiresAt'],
            },
            deviceSecretHash: { kind: 'exact', value: literal(null) },
            deviceName: { kind: 'exact', value: literal(null) },
            activatedAt: { kind: 'exact', value: literal(null) },
            lastSeenAt: { kind: 'exact', value: literal(null) },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'payment',
          kind: 'scoped-row-create',
          model: 'MobilePosTerminalPayment',
          scope: {
            equals: { cashAccountId: mobileCashAccount, paymentMethod: literal('CASH') },
            identityFields: ['id'],
          },
          expectedFields: {
            terminalId: effectRef('terminal'),
            paymentMethod: literal('CASH'),
            cashAccountId: mobileCashAccount,
            label: literal('Evidence cash'),
            isEnabled: literal(true),
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: response('terminal', 'id'),
    },
    audit: {
      required: true,
      action: 'MOBILE_POS_LITE_TERMINAL_CREATED',
      entityType: 'MobilePosTerminal',
      companyId: { kind: 'exact', value: companyA },
      payload: {
        severity: 'HIGH',
        responseSecretsAbsent: [['activation', 'activationCode']],
        forbiddenKeys: ['activationCode', 'activationTokenHash'],
      },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'ProductsController.removeImage',
    operation: 'delete',
    description:
      'Clear the image on a dedicated product that has no image URL or tagged image document, prove the reviewed no-business-delta branch writes only its exact product audit, and leave the product untouched.',
    request: { path: { id: adminProduct } },
    target: { model: 'Product', id: adminProduct },
    preState: {
      model: 'Product',
      id: adminProduct,
      fields: { companyId: companyA, imageUrl: literal(null), deletedAt: literal(null) },
    },
    effect: {
      kind: 'audit-only',
      model: 'Product',
      id: adminProduct,
      expectedFields: {},
      auditEntityId: adminProduct,
    },
    audit: {
      required: true,
      action: 'PRODUCT_UPDATE',
      entityType: 'Product',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'ProfitController.backfillSales',
    operation: 'action',
    description:
      'Run the historical-profit backfill against the dedicated company with no sales lines, prove the exact zero-scan branch has only its attributable audit effect, and retain the company anchor.',
    request: { query: { companyId: adminCompany } },
    target: { model: 'Company', id: adminCompany },
    preState: {
      model: 'Company',
      id: adminCompany,
      fields: { deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'audit-only',
      model: 'Company',
      id: adminCompany,
      expectedFields: {},
      auditEntityId: adminCompany,
    },
    audit: {
      required: true,
      action: 'PROFIT_BACKFILL_RUN',
      entityType: 'Profit',
      entityId: nullAuditEntity,
      companyId: { kind: 'exact', value: adminCompany },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'ProfitController.validateSaleLines',
    operation: 'action',
    description:
      'Validate one profitable non-stock sale line, prove the successful validator remains business-read-only while appending its exact user/company audit, and retain the product anchor.',
    request: {
      body: {
        companyId: companyA,
        lines: array(
          object({
            productId: adminProduct,
            quantity: literal(1),
            unitPrice: literal(100),
            discountAmount: literal(0),
          }),
        ),
      },
    },
    target: { model: 'Product', id: adminProduct },
    preState: {
      model: 'Product',
      id: adminProduct,
      fields: {
        companyId: companyA,
        productType: literal('SERVICE'),
        trackInventory: literal(false),
        deletedAt: literal(null),
      },
    },
    effect: {
      kind: 'audit-only',
      model: 'Product',
      id: adminProduct,
      expectedFields: {},
      auditEntityId: adminProduct,
    },
    audit: {
      required: true,
      action: 'PROFIT_VALIDATION_RUN',
      entityType: 'ProfitValidation',
      entityId: nullAuditEntity,
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'ProformaInvoicesController.create',
    operation: 'create',
    description:
      'Create a same-company, line-free DRAFT proforma, prove the complete header and independently derived count-based number with no child rows, then delete the proforma.',
    request: {
      body: {
        companyId: companyA,
        customerId: idOf('Customer'),
        proformaDate: literal(PROFORMA_DATE),
        currency: literal('TZS'),
        lines: array(),
      },
    },
    preState: {
      model: 'Customer',
      id: idOf('Customer'),
      fields: { companyId: companyA, deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'create',
      model: 'ProformaInvoice',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        companyId: companyA,
        customerId: idOf('Customer'),
        proformaDate: literal(PROFORMA_DATE),
        currency: literal('TZS'),
        createdById: userA,
      },
      generatedFields: {
        proformaNumber: {
          kind: 'scoped-sequence-id',
          separator: '-',
          prefixParts: [{ kind: 'literal', value: 'PRF' }, { kind: 'action-year' }],
          scope: { companyId: companyA },
          counter: { strategy: 'count-prefix', padding: 5 },
        },
        divisionId: { kind: 'exact', value: literal(null) },
        branchId: { kind: 'exact', value: literal(null) },
        customerName: { kind: 'exact', value: literal(null) },
        validUntil: { kind: 'exact', value: literal(null) },
        subtotal: { kind: 'exact', value: literal(0) },
        discountAmount: { kind: 'exact', value: literal(0) },
        taxAmount: { kind: 'exact', value: literal(0) },
        totalAmount: { kind: 'exact', value: literal(0) },
        status: { kind: 'exact', value: literal('DRAFT') },
        quotationId: { kind: 'exact', value: literal(null) },
        convertedSalesOrderId: { kind: 'exact', value: literal(null) },
        notes: { kind: 'exact', value: literal(null) },
        deletedAt: { kind: 'exact', value: literal(null) },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'PROFORMA_INVOICE_CREATE',
      entityType: 'ProformaInvoice',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'ScheduledReportsController.run',
    operation: 'action',
    description:
      'Run one inactive CSV schedule over an empty supported dataset, prove the exact ReportRun, DataExportLog and lastRunAt transition including the persisted response artifact, then restore the schedule and delete both generated rows.',
    request: { path: { id: adminSchedule } },
    target: { model: 'ScheduledReport', id: adminSchedule },
    preState: {
      model: 'ScheduledReport',
      id: adminSchedule,
      fields: {
        companyId: adminCompany,
        isActive: literal(false),
        lastRunAt: literal(null),
        nextRunAt: literal(null),
        deletedAt: literal(null),
      },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'schedule',
          kind: 'row-update',
          model: 'ScheduledReport',
          id: adminSchedule,
          expectedFields: { lastRunAt: nowIso, updatedAt: nowIso },
          forbiddenFields: ['isActive', 'nextRunAt', 'deletedAt'],
          recovery: 'restore-row',
          recoveryOrder: 5,
        },
        {
          effectId: 'reportRun',
          kind: 'scoped-row-create',
          model: 'ReportRun',
          scope: {
            equals: {
              reportDefinitionId: binding('adminOperationsSchedule', ['reportDefinitionId']),
              companyId: adminCompany,
              requestedById: userA,
            },
            identityFields: ['id'],
          },
          expectedFields: {
            reportDefinitionId: binding('adminOperationsSchedule', ['reportDefinitionId']),
            savedReportViewId: literal(null),
            companyId: adminCompany,
            requestedById: userA,
            filters: object({
              scheduleId: adminSchedule,
              scheduleCode: literal('CE-ADMIN-SCHEDULE'),
              scheduleConfig: object({ source: literal('crud-admin-operations') }),
            }),
            status: literal('COMPLETED'),
            rowCount: literal(1),
            errorMessage: literal(null),
          },
          generatedFields: {
            reportRunNumber: {
              kind: 'timestamp-id',
              prefix: 'RPT-SCHED-',
              timestampEncoding: 'decimal',
            },
            executionTimeMs: { kind: 'response-exact', responsePath: ['executionTimeMs'] },
            resultSummary: { kind: 'response-exact', responsePath: ['artifact'] },
            completedAt: { kind: 'response-exact', responsePath: ['completedAt'] },
          },
          allowedFields: ['id', 'createdAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'exportLog',
          kind: 'scoped-row-create',
          model: 'DataExportLog',
          scope: {
            equals: { notes: literal('Generated from scheduled report CE-ADMIN-SCHEDULE') },
            identityFields: ['id'],
          },
          expectedFields: {
            companyId: adminCompany,
            exportedById: userA,
            exportType: literal('FINANCIAL_REPORT'),
            filters: effectRef('reportRun', ['filters']),
            fileName: response('export', 'filename'),
            filePath: literal(null),
            status: literal('COMPLETED'),
            notes: literal('Generated from scheduled report CE-ADMIN-SCHEDULE'),
          },
          generatedFields: {
            exportNumber: {
              kind: 'timestamp-id',
              prefix: 'EXP-',
              timestampEncoding: 'decimal',
            },
            completedAt: { kind: 'action-time' },
          },
          allowedFields: ['id', 'createdAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: adminSchedule,
    },
    audit: {
      required: true,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      companyId: { kind: 'exact', value: adminCompany },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'UsersController.assignRoles',
    operation: 'action',
    description:
      'Assign one isolated company role to a dedicated role-free user, prove the complete UserRole row and exact user/company audit, then delete only the assignment.',
    request: { path: { id: adminUser }, body: { roleIds: array(adminRole) } },
    target: { model: 'User', id: adminUser },
    preState: {
      model: 'User',
      id: adminUser,
      fields: { companyId: companyA, deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'roleAssignment',
          kind: 'scoped-row-create',
          model: 'UserRole',
          scope: { equals: { userId: adminUser, roleId: adminRole }, identityFields: ['id'] },
          expectedFields: { userId: adminUser, roleId: adminRole, assignedById: userA },
          generatedFields: { assignedAt: { kind: 'action-time' } },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: adminUser,
    },
    audit: {
      required: true,
      action: 'USER_ROLES_ASSIGNED',
      entityType: 'User',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'UsersController.create',
    operation: 'create',
    description:
      'Create one role-free company user, prove every persisted scalar while verifying the Argon2 password hash against the signed request only in memory, then delete the created user.',
    request: {
      body: {
        email: createdUserEmail,
        password: literal('CRUD-Evidence-Password-31!'),
        fullName: literal('CRUD Evidence Created User'),
        companyId: companyA,
      },
    },
    effect: {
      kind: 'create',
      model: 'User',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        email: createdUserEmail,
        fullName: literal('CRUD Evidence Created User'),
        companyId: companyA,
      },
      generatedFields: {
        passwordHash: {
          kind: 'request-secret-hash',
          requestPath: ['password'],
          algorithm: 'argon2',
        },
        phoneNumber: { kind: 'exact', value: literal(null) },
        title: { kind: 'exact', value: literal(null) },
        status: { kind: 'exact', value: literal('ACTIVE') },
        mustChangePassword: { kind: 'exact', value: literal(false) },
        lastLoginAt: { kind: 'exact', value: literal(null) },
        passwordChangedAt: { kind: 'exact', value: literal(null) },
        failedLoginAttempts: { kind: 'exact', value: literal(0) },
        lockedUntil: { kind: 'exact', value: literal(null) },
        avatarUrl: { kind: 'exact', value: literal(null) },
        deletedAt: { kind: 'exact', value: literal(null) },
        lastPasswordVerifiedAt: { kind: 'exact', value: literal(null) },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'USER_CREATED',
      entityType: 'User',
      companyId: { kind: 'effect-company' },
      payload: {
        severity: 'MEDIUM',
        forbiddenKeys: ['password', 'passwordHash'],
      },
    },
  },
  {
    capabilityId: 'UsersController.grantCompanyAccess',
    operation: 'action',
    description:
      'Replace the dedicated user’s empty company-access set with one company-B MANAGE grant, prove the complete row and exact affected-company audit scope, then remove only that grant.',
    request: {
      path: { id: adminUser },
      body: {
        access: array(object({ companyId: companyB, accessLevel: literal('MANAGE') })),
      },
    },
    target: { model: 'User', id: adminUser },
    preState: {
      model: 'User',
      id: adminUser,
      fields: { companyId: companyA, deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'companyAccess',
          kind: 'scoped-row-create',
          model: 'UserCompanyAccess',
          scope: { equals: { userId: adminUser }, identityFields: ['id'] },
          expectedFields: {
            userId: adminUser,
            companyId: companyB,
            accessLevel: literal('MANAGE'),
            grantedById: userA,
          },
          generatedFields: { grantedAt: { kind: 'action-time' } },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: adminUser,
    },
    audit: {
      required: true,
      action: 'USER_COMPANY_ACCESS_GRANTED',
      entityType: 'User',
      companyId: { kind: 'exact', value: companyB },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'WestsidesReportsController.saveDailyClose',
    operation: 'action',
    description:
      'Create one isolated company-level daily close, prove its exact monetary JSON, local-day key, supervisor sign-off and company audit, then delete the created close.',
    request: {
      body: {
        companyId: adminCompany,
        closeDate: literal(DAILY_CLOSE_DATE),
        countedByMethod: object({ CASH: literal(100), MOBILE_MONEY: literal(50) }),
        expectedTotal: literal(150),
        countedTotal: literal(150),
        varianceTotal: literal(0),
        notes: literal('CRUD evidence daily close'),
      },
    },
    effect: {
      kind: 'create',
      model: 'WestsidesDailyClose',
      responseIdPath: ['id'],
      expectedFields: {
        companyId: adminCompany,
        branchId: literal(null),
        countedByMethod: object({ CASH: literal(100), MOBILE_MONEY: literal(50) }),
        expectedTotal: literal(150),
        countedTotal: literal(150),
        varianceTotal: literal(0),
        notes: literal('CRUD evidence daily close'),
        closedById: userA,
        closedByName: binding('adminOperationsActor', ['fullName']),
      },
      generatedFields: {
        closeDate: { kind: 'exact', value: literal(DAILY_CLOSE_DATE) },
        closedAt: { kind: 'action-time' },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'WESTSIDES_DAILY_CLOSE_CREATE',
      entityType: 'WestsidesDailyClose',
      companyId: { kind: 'effect-company' },
    },
    executionPrincipal: 'group',
  },
];

export const CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS: readonly string[] = Object.freeze(
  definitions.map((definition) => definition.capabilityId),
);

export const CRUD_ADMIN_OPERATIONS_POSITIVE_REQUIRED_BINDINGS: readonly string[] = Object.freeze([
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

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 76);
  return `mutation-admin-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

export const CRUD_ADMIN_OPERATIONS_POSITIVE_EVIDENCE_PACK: CrudMutationAnyFixturePack =
  Object.freeze({
    packId: PACK_ID,
    packVersion: 1,
    fixtures: Object.freeze(
      definitions.map((definition) => {
        const scopeKind = crudMutationAuditScopeKind(definition.audit.companyId);
        return Object.freeze({
          ...definition,
          audit: Object.freeze({
            ...definition.audit,
            scopeKind,
            attributionStatus: definition.audit.attributionStatus ?? 'EXPLICIT',
          }),
          controlKind: 'positive' as const,
          fixtureId: fixtureId(definition.capabilityId),
          fixtureVersion: 1 as const,
          governance: CRUD_MUTATION_GOVERNANCE,
          packId: PACK_ID,
        });
      }),
    ),
  });
