import { createHash } from 'node:crypto';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationAuditContract,
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

const PACK_ID = 'mutation-action-database-tranche';
const ACTIVATION_TTL_MS = 20 * 60 * 1_000;

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const unique = (prefix: string): CrudMutationValue => ({ unique: { prefix } });
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const companyA = binding('companyA');
const userA = binding('userA');
const nowIso: CrudMutationValue = { now: 'iso' };

const offlineClientBatchId = unique('CE-ACTION-SYNC');
const proforma = binding('actionTrancheProforma');
const proformaCustomer = binding('actionTrancheProformaCustomer');
const convertedOrderNote = binding('actionTrancheConvertedOrderNote');
const supplierInvoice = binding('actionTrancheSupplierInvoice');
const purchaseOrder = binding('actionTranchePurchaseOrder');
const threeWaySequence = binding('actionTrancheThreeWayMatchSequence');

const definitions: readonly FixtureDefinition[] = [
  {
    capabilityId: 'MobilePosLiteController.issueActivation',
    operation: 'action',
    executionPrincipal: 'group',
    description:
      'Issue one activation code for an isolated active terminal, prove the ephemeral response secret against its persisted SHA-256 digest without retaining the secret, prove the exact expiry window and audit, then restore the terminal.',
    request: { path: { id: idOf('MobilePosTerminal') } },
    target: { model: 'MobilePosTerminal', id: idOf('MobilePosTerminal') },
    preState: {
      model: 'MobilePosTerminal',
      id: idOf('MobilePosTerminal'),
      fields: {
        activationExpiresAt: literal(null),
        activationTokenHash: literal(null),
        status: literal('ACTIVE'),
      },
    },
    effect: {
      kind: 'generated-transition',
      model: 'MobilePosTerminal',
      id: idOf('MobilePosTerminal'),
      expectedFields: {},
      generatedFields: {
        activationExpiresAt: { kind: 'action-time', offsetMs: ACTIVATION_TTL_MS },
        activationTokenHash: {
          kind: 'response-secret-digest',
          responsePath: ['activationCode'],
          algorithm: 'sha256',
          encoding: 'hex',
        },
      },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'MOBILE_POS_LITE_ACTIVATION_ISSUED',
      entityType: 'MobilePosTerminal',
      companyId: { kind: 'effect-company' },
      payload: {
        severity: 'HIGH',
        oldValue: literal(null),
        newValue: literal(null),
        metadata: literal(null),
        responseSecretsAbsent: [['activationCode']],
        forbiddenKeys: ['activationCode', 'activationPath'],
      },
    },
  },
  {
    capabilityId: 'OfflineSyncController.createBatch',
    operation: 'create',
    description:
      'Create one intentionally empty, company-scoped offline-sync batch, prove every request-backed and service-generated scalar plus the timestamp-derived batch number, audit it, and delete only the created batch.',
    request: {
      body: {
        clientBatchId: offlineClientBatchId,
        companyId: companyA,
        records: { array: [] },
        syncDirection: literal('BIDIRECTIONAL'),
      },
    },
    effect: {
      kind: 'create',
      model: 'OfflineSyncBatch',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        clientBatchId: offlineClientBatchId,
        companyId: companyA,
        syncDirection: literal('BIDIRECTIONAL'),
      },
      generatedFields: {
        batchNumber: { kind: 'timestamp-id', prefix: 'SYNC-', timestampEncoding: 'base36-upper' },
        completedAt: { kind: 'exact', value: literal(null) },
        conflictCount: { kind: 'exact', value: literal(0) },
        deviceId: { kind: 'exact', value: literal(null) },
        errorMessage: { kind: 'exact', value: literal(null) },
        failedCount: { kind: 'exact', value: literal(0) },
        processedCount: { kind: 'exact', value: literal(0) },
        recordCount: { kind: 'exact', value: literal(0) },
        startedAt: { kind: 'exact', value: literal(null) },
        status: { kind: 'exact', value: literal('RECEIVED') },
        userId: { kind: 'exact', value: userA },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'SYNC_BATCH_CREATED',
      entityType: 'OfflineSyncBatch',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'ProformaInvoicesController.convertToSalesOrder',
    operation: 'action',
    description:
      'Convert one isolated ACCEPTED proforma with one catalogue line into an unposted credit DRAFT, prove the complete created sales-order and line scalars plus the exact source transition and timestamp identifier, attribute the audit, then remove children before the order and restore the proforma.',
    request: { path: { id: proforma } },
    target: { model: 'ProformaInvoice', id: proforma },
    preState: {
      model: 'ProformaInvoice',
      id: proforma,
      fields: {
        convertedSalesOrderId: literal(null),
        deletedAt: literal(null),
        status: literal('ACCEPTED'),
      },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'salesOrder',
          kind: 'scoped-row-create',
          model: 'SalesOrder',
          scope: {
            equals: { companyId: companyA, customerId: proformaCustomer },
            identityFields: ['id'],
          },
          expectedFields: {
            branchId: binding('actionTrancheProforma', ['branchId']),
            cashAccountId: literal(null),
            companyId: companyA,
            confirmedAt: literal(null),
            confirmedById: literal(null),
            currency: binding('actionTrancheProforma', ['currency']),
            customerId: proformaCustomer,
            customerName: literal(null),
            deletedAt: literal(null),
            discountAmount: binding('actionTrancheProforma', ['discountAmount']),
            documentDiscount: literal(0),
            dueDate: literal(null),
            journalEntryId: literal(null),
            mobilePosTerminalId: literal(null),
            notes: convertedOrderNote,
            outstandingAmount: binding('actionTrancheProforma', ['totalAmount']),
            paidAmount: literal(0),
            paymentMethod: literal('CREDIT'),
            paymentReference: literal(null),
            paymentStatus: literal('UNPAID'),
            receivableId: literal(null),
            salespersonId: literal(null),
            salesType: literal('CREDIT_SALE'),
            status: literal('DRAFT'),
            subtotal: binding('actionTrancheProforma', ['subtotal']),
            taxAmount: binding('actionTrancheProforma', ['taxAmount']),
            totalAmount: binding('actionTrancheProforma', ['totalAmount']),
            divisionId: binding('actionTrancheProforma', ['divisionId']),
          },
          generatedFields: {
            createdById: { kind: 'exact', value: userA },
            idempotencyKey: {
              kind: 'value-with-prefix',
              prefix: 'proforma:',
              value: proforma,
            },
            orderDate: { kind: 'action-time' },
            salesOrderNumber: {
              kind: 'timestamp-id',
              prefix: 'SO-',
              actionLocalCalendarYear: { separator: '-' },
              timestampEncoding: 'base36-upper',
            },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'salesOrderLine',
          kind: 'scoped-row-create',
          model: 'SalesOrderLine',
          scope: {
            equals: { productId: binding('actionTrancheProformaLine', ['productId']) },
            identityFields: ['id'],
          },
          expectedFields: {
            batchId: literal(null),
            cogsAmount: literal(null),
            description: binding('actionTrancheProformaLine', ['description']),
            discountAmount: binding('actionTrancheProformaLine', ['discountAmount']),
            grossMarginPct: literal(null),
            grossProfitAmount: literal(null),
            lineTotal: binding('actionTrancheProformaLine', ['lineTotal']),
            productId: binding('actionTrancheProformaLine', ['productId']),
            profitCostSource: literal(null),
            quantity: binding('actionTrancheProformaLine', ['quantity']),
            salesOrderId: { effectRef: { effectId: 'salesOrder' } },
            taxAmount: binding('actionTrancheProformaLine', ['taxAmount']),
            unitCostAtSale: literal(null),
            unitId: binding('actionTrancheProformaLine', ['unitId']),
            unitPrice: binding('actionTrancheProformaLine', ['unitPrice']),
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
        {
          effectId: 'proforma',
          kind: 'row-update',
          model: 'ProformaInvoice',
          id: proforma,
          expectedFields: {
            convertedSalesOrderId: { effectRef: { effectId: 'salesOrder' } },
            status: literal('CONVERTED'),
            updatedAt: nowIso,
          },
          recovery: 'restore-row',
          recoveryOrder: 30,
        },
      ],
      auditEntityId: proforma,
    },
    audit: {
      required: true,
      action: 'PROFORMA_INVOICE_CONVERTED',
      entityType: 'ProformaInvoice',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'RecordBookController.auditExport',
    operation: 'action',
    description:
      'Record one exact report-export observation and prove through the whole-schema sentinel that the attributable audit ledger is the command’s only persistent effect.',
    request: {
      body: {
        companyId: companyA,
        format: literal('json'),
        reportKey: literal('daily-sales'),
        rowCount: literal(0),
        scope: literal('report'),
      },
    },
    target: { model: 'Company', id: companyA },
    effect: {
      kind: 'audit-only',
      model: 'Company',
      id: companyA,
      expectedFields: {},
      auditEntityId: literal('daily-sales'),
    },
    audit: {
      required: true,
      action: 'RECORD_BOOK_EXPORT',
      entityType: 'RecordBookReport',
      companyId: { kind: 'exact', value: companyA },
      payload: {
        severity: 'MEDIUM',
        oldValue: literal(null),
        newValue: {
          object: {
            companyId: companyA,
            format: literal('json'),
            reportKey: literal('daily-sales'),
            rowCount: literal(0),
            scope: literal('report'),
          },
        },
        metadata: literal(null),
      },
    },
  },
  {
    capabilityId: 'SupplierInvoicesController.runMatch',
    operation: 'action',
    description:
      'Match one isolated supplier invoice to a same-company purchase order, prove the complete dynamically numbered match row, exact invoice status and sequence deltas, audit attribution, and ordered recovery.',
    request: { path: { id: supplierInvoice } },
    target: { model: 'SupplierInvoice', id: supplierInvoice },
    preState: {
      model: 'SupplierInvoice',
      id: supplierInvoice,
      fields: { deletedAt: literal(null), status: literal('DRAFT') },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'match',
          kind: 'scoped-row-create',
          model: 'ThreeWayMatch',
          scope: { equals: { supplierInvoiceId: supplierInvoice }, identityFields: ['id'] },
          expectedFields: {
            amountVariance: literal(0),
            approvedAt: literal(null),
            approvedById: literal(null),
            companyId: companyA,
            deletedAt: literal(null),
            goodsReceivedNoteId: literal(null),
            matchStatus: literal('MATCHED'),
            matchedById: userA,
            notes: literal('PO, GRN, and supplier invoice matched'),
            purchaseOrderId: purchaseOrder,
            quantityVariance: literal(0),
            supplierInvoiceId: supplierInvoice,
          },
          generatedFields: {
            matchDate: { kind: 'action-time' },
            matchNumber: { kind: 'entity-code', entityType: 'ThreeWayMatch', companyId: companyA },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
        {
          effectId: 'invoice',
          kind: 'row-update',
          model: 'SupplierInvoice',
          id: supplierInvoice,
          expectedFields: { status: literal('MATCHED'), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'sequence',
          kind: 'row-update',
          model: 'DocumentNumberSequence',
          id: threeWaySequence,
          expectedFields: { currentNumber: literal(301), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 30,
        },
      ],
      auditEntityId: supplierInvoice,
    },
    audit: {
      required: true,
      action: 'SUPPLIER_INVOICE_MATCH',
      entityType: 'SupplierInvoice',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'SupplierOrderDraftsController.auditExport',
    operation: 'action',
    description:
      'Record one supplier-draft export observation and prove that the exact attributable audit ledger is the only persistent database effect.',
    request: { path: { id: idOf('SupplierOrderDraft') }, body: { format: literal('PDF') } },
    target: { model: 'SupplierOrderDraft', id: idOf('SupplierOrderDraft') },
    effect: {
      kind: 'audit-only',
      model: 'SupplierOrderDraft',
      id: idOf('SupplierOrderDraft'),
      expectedFields: {},
      auditEntityId: idOf('SupplierOrderDraft'),
    },
    audit: {
      required: true,
      action: 'SUPPLIER_ORDER_DRAFT_EXPORT',
      entityType: 'SupplierOrderDraft',
      companyId: { kind: 'exact', value: companyA },
      payload: {
        severity: 'LOW',
        oldValue: literal(null),
        newValue: {
          object: {
            format: literal('PDF'),
            draftNumber: binding('model:SupplierOrderDraft', ['draftNumber']),
          },
        },
        metadata: literal(null),
      },
    },
  },
];

export const CRUD_ACTION_TRANCHE_CLOSED_IDS: readonly string[] = Object.freeze(
  definitions.map((definition) => definition.capabilityId),
);

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 76);
  return `mutation-action-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

export const CRUD_ACTION_TRANCHE_EVIDENCE_PACK: CrudMutationAnyFixturePack = Object.freeze({
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
