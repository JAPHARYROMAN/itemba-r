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

const PACK_ID = 'mutation-next-bounded-finance-operations';

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const effectRef = (effectId: string, path?: readonly string[]): CrudMutationEffectValue => ({
  effectRef: { effectId, ...(path ? { path } : {}) },
});
const nowIso: CrudMutationValue = { now: 'iso' };
const companyA = binding('companyA');
const divisionA = binding('divisionA');
const userA = binding('userA');

const definitions: readonly FixtureDefinition[] = [
  {
    capabilityId: 'DisbursementsController.generate',
    operation: 'action',
    description:
      "Generate the inline disbursement manifest for one isolated CALCULATED payroll run, prove that the attributable company audit is the command's only persistent effect because file content remains response-only, and restore the run prerequisite.",
    request: { path: { id: idOf('PayrollRun') } },
    target: { model: 'PayrollRun', id: idOf('PayrollRun') },
    preState: {
      model: 'PayrollRun',
      id: idOf('PayrollRun'),
      fields: {
        deletedAt: literal(null),
        status: literal('CALCULATED'),
      },
    },
    effect: {
      kind: 'audit-only',
      model: 'PayrollRun',
      id: idOf('PayrollRun'),
      expectedFields: {},
      auditEntityId: idOf('PayrollRun'),
    },
    audit: {
      required: true,
      action: 'PAYROLL_DISBURSEMENT_FILES_GENERATED',
      entityType: 'PayrollRun',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'CreditNotesController.void',
    operation: 'action',
    description:
      'Void one isolated ISSUED credit note whose zero applied amount and absent journal/receivable links select the bounded no-ledger branch, prove the exact status transition and company audit, then restore the note.',
    request: {
      path: { id: idOf('CreditNote') },
      body: { reason: literal('CRUD evidence bounded credit-note void') },
    },
    target: { model: 'CreditNote', id: idOf('CreditNote') },
    preState: {
      model: 'CreditNote',
      id: idOf('CreditNote'),
      fields: {
        appliedAmount: literal(0),
        deletedAt: literal(null),
        journalEntryId: literal(null),
        receivableId: literal(null),
        status: literal('ISSUED'),
      },
    },
    effect: {
      kind: 'transition',
      model: 'CreditNote',
      id: idOf('CreditNote'),
      expectedFields: { status: literal('VOID') },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'CREDIT_NOTE_VOID',
      entityType: 'CreditNote',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'FixedAssetsController.dispose',
    operation: 'action',
    description:
      'Dispose one isolated company-A-owned ACTIVE asset with no capitalization journal, prove the exact register-only status, date, proceeds, and book-value transition plus the company audit and sensitive-access observation, then restore the asset.',
    request: {
      path: { id: idOf('FixedAsset') },
      body: {
        disposalDate: literal('2031-07-01T00:00:00.000Z'),
        disposalStatus: literal('DISPOSED'),
        disposalValue: literal('25.50'),
      },
    },
    target: { model: 'FixedAsset', id: idOf('FixedAsset') },
    preState: {
      model: 'FixedAsset',
      id: idOf('FixedAsset'),
      fields: {
        companyId: companyA,
        currentBookValue: literal(100),
        deletedAt: literal(null),
        disposalDate: literal(null),
        disposalValue: literal(null),
        groupId: literal(null),
        ownershipLevel: literal('COMPANY'),
        status: literal('ACTIVE'),
      },
    },
    effect: {
      kind: 'transition',
      model: 'FixedAsset',
      id: idOf('FixedAsset'),
      expectedFields: {
        currentBookValue: literal(0),
        disposalDate: literal('2031-07-01T00:00:00.000Z'),
        disposalValue: literal(25.5),
        status: literal('DISPOSED'),
      },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'fixed_asset.dispose',
      entityType: 'FixedAsset',
      companyId: { kind: 'effect-company' },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'PayablesController.writeOff',
    operation: 'action',
    description:
      'Write off one isolated OPEN payable whose zero outstanding amount and absent supplier link select the no-ledger, no-projection branch, prove the exact status/reason transition and company audit, then restore the payable.',
    request: {
      path: { id: idOf('Payable') },
      body: { reason: literal('CRUD evidence zero-balance payable write-off') },
    },
    target: { model: 'Payable', id: idOf('Payable') },
    preState: {
      model: 'Payable',
      id: idOf('Payable'),
      fields: {
        deletedAt: literal(null),
        notes: literal(null),
        outstandingAmount: literal(0),
        status: literal('OPEN'),
        supplierId: literal(null),
      },
    },
    effect: {
      kind: 'transition',
      model: 'Payable',
      id: idOf('Payable'),
      expectedFields: {
        notes: literal('CRUD evidence zero-balance payable write-off'),
        status: literal('WRITTEN_OFF'),
      },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'PAYABLE_WRITE_OFF',
      entityType: 'Payable',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'PurchaseOrdersController.receive',
    operation: 'action',
    description:
      'Receive one isolated one-line CONFIRMED stock purchase at a real branch, prove the exact inventory movement, weighted-average balance, numbering sequence, header transition and both attributable audits, then restore every effect.',
    setupModels: [
      'Branch',
      'InventoryBalance',
      'Product',
      'PurchaseOrder',
      'PurchaseOrderLine',
      'UnitOfMeasure',
    ],
    request: { path: { id: idOf('PurchaseOrder') }, body: {} },
    target: { model: 'PurchaseOrder', id: idOf('PurchaseOrder') },
    preStates: [
      {
        model: 'Branch',
        id: idOf('Branch'),
        fields: {
          divisionId: divisionA,
          isActive: literal(true),
          deletedAt: literal(null),
        },
      },
      {
        model: 'Product',
        id: idOf('Product'),
        fields: {
          companyId: companyA,
          trackInventory: literal(true),
          status: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'UnitOfMeasure',
        id: idOf('UnitOfMeasure'),
        fields: {
          companyId: companyA,
          status: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'InventoryBalance',
        id: idOf('InventoryBalance'),
        fields: {
          companyId: companyA,
          divisionId: divisionA,
          productId: idOf('Product'),
          branchId: idOf('Branch'),
          quantityOnHand: literal(10),
          quantityReserved: literal(0),
          averageCost: literal(2),
          totalValue: literal(20),
          lastMovementAt: literal(null),
        },
      },
      {
        model: 'PurchaseOrder',
        id: idOf('PurchaseOrder'),
        fields: {
          companyId: companyA,
          divisionId: divisionA,
          branchId: idOf('Branch'),
          deletedAt: literal(null),
          journalEntryId: literal(null),
          payableId: literal(null),
          purchaseType: literal('STOCK_PURCHASE'),
          receivedAt: literal(null),
          receivedById: literal(null),
          status: literal('CONFIRMED'),
        },
      },
      {
        model: 'PurchaseOrderLine',
        id: idOf('PurchaseOrderLine'),
        fields: {
          purchaseOrderId: idOf('PurchaseOrder'),
          productId: idOf('Product'),
          description: literal('CRUD evidence received stock'),
          quantity: literal(2),
          unitId: idOf('UnitOfMeasure'),
          unitCost: literal(5),
          discountAmount: literal(0),
          taxAmount: literal(0),
          lineTotal: literal(10),
          batchNumber: literal(null),
          expiryDate: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'movement',
          kind: 'scoped-row-create',
          model: 'InventoryMovement',
          scope: {
            equals: {
              companyId: companyA,
              referenceType: literal('PurchaseOrder'),
              referenceId: idOf('PurchaseOrder'),
            },
            identityFields: ['id'],
          },
          expectedFields: {
            companyId: companyA,
            divisionId: divisionA,
            branchId: idOf('Branch'),
            productId: idOf('Product'),
            movementType: literal('PURCHASE_RECEIPT'),
            quantity: literal(2),
            unitId: idOf('UnitOfMeasure'),
            unitCost: literal(5),
            totalCost: literal(10),
            referenceType: literal('PurchaseOrder'),
            referenceId: idOf('PurchaseOrder'),
            batchNumber: literal(null),
            expiryDate: literal(null),
            createdById: userA,
            notes: literal(null),
          },
          generatedFields: {
            movementNumber: {
              kind: 'entity-code',
              entityType: 'InventoryMovement',
              companyId: companyA,
            },
            movementDate: { kind: 'action-time' },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
        {
          effectId: 'inventoryBalance',
          kind: 'row-update',
          model: 'InventoryBalance',
          id: idOf('InventoryBalance'),
          expectedFields: {
            quantityOnHand: literal(12),
            averageCost: literal(2.5),
            totalValue: literal(30),
            lastMovementAt: nowIso,
            updatedAt: nowIso,
          },
          forbiddenFields: ['companyId', 'divisionId', 'productId', 'branchId', 'quantityReserved'],
          recovery: 'restore-row',
          recoveryOrder: 11,
        },
        {
          effectId: 'order',
          kind: 'row-update',
          model: 'PurchaseOrder',
          id: idOf('PurchaseOrder'),
          expectedFields: {
            receivedAt: nowIso,
            receivedById: userA,
            status: literal('RECEIVED'),
            updatedAt: nowIso,
          },
          forbiddenFields: [
            'companyId',
            'divisionId',
            'branchId',
            'purchaseType',
            'journalEntryId',
            'payableId',
            'deletedAt',
          ],
          recovery: 'restore-row',
          recoveryOrder: 12,
        },
        {
          effectId: 'movementSequence',
          kind: 'scoped-row-create',
          model: 'DocumentNumberSequence',
          scope: {
            equals: { companyId: companyA, entityType: literal('InventoryMovement') },
            identityFields: ['id'],
          },
          expectedFields: {
            companyId: companyA,
            entityType: literal('InventoryMovement'),
            prefix: literal('IM-{YYYY}-'),
            suffix: literal(null),
            currentNumber: literal(1),
            padding: literal(7),
            resetFrequency: literal('YEARLY'),
            isActive: literal(true),
            deletedAt: literal(null),
          },
          generatedFields: {
            sequenceCode: {
              kind: 'value-with-prefix',
              prefix: 'InventoryMovement_',
              value: companyA,
            },
            lastResetAt: { kind: 'action-time' },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
      ],
      auditEntityId: idOf('PurchaseOrder'),
    },
    audit: {
      required: true,
      action: 'PURCHASE_ORDER_RECEIVE',
      entityType: 'PurchaseOrder',
      companyId: { kind: 'exact', value: companyA },
      additionalAudits: [
        {
          action: 'INVENTORY_MOVEMENT_CREATE',
          entityType: 'InventoryMovement',
          entityId: effectRef('movement'),
          companyId: { kind: 'exact', value: companyA },
          scopeKind: 'COMPANY',
          attributionStatus: 'EXPLICIT',
        },
      ],
    },
  },
  {
    capabilityId: 'ReceivablesController.writeOff',
    operation: 'action',
    description:
      'Write off one isolated OPEN receivable whose zero outstanding amount and absent customer link select the no-ledger, no-projection branch, prove the exact status/reason transition and company audit, then restore the receivable.',
    request: {
      path: { id: idOf('Receivable') },
      body: { reason: literal('CRUD evidence zero-balance receivable write-off') },
    },
    target: { model: 'Receivable', id: idOf('Receivable') },
    preState: {
      model: 'Receivable',
      id: idOf('Receivable'),
      fields: {
        customerId: literal(null),
        deletedAt: literal(null),
        notes: literal(null),
        outstandingAmount: literal(0),
        status: literal('OPEN'),
      },
    },
    effect: {
      kind: 'transition',
      model: 'Receivable',
      id: idOf('Receivable'),
      expectedFields: {
        notes: literal('CRUD evidence zero-balance receivable write-off'),
        status: literal('WRITTEN_OFF'),
      },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'RECEIVABLE_WRITE_OFF',
      entityType: 'Receivable',
      companyId: { kind: 'effect-company' },
    },
  },
];

export const CRUD_NEXT_ACTION_CLOSED_IDS: readonly string[] = Object.freeze(
  definitions.map((definition) => definition.capabilityId),
);

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 76);
  return `mutation-next-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

export const CRUD_NEXT_ACTION_EVIDENCE_PACK: CrudMutationAnyFixturePack = Object.freeze({
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
