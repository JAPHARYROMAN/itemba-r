import { createHash } from 'node:crypto';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import { crudMutationAuditAttributionStatus } from './crud-mutation-audit-provenance';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationAuditContract,
  CrudMutationValue,
  crudMutationAuditScopeKind,
} from './crud-mutation-evidence';

type ValueMap = Readonly<Record<string, CrudMutationValue>>;
type FixtureDefinition = Omit<
  CrudMutationAnyFixtureRegistration,
  'audit' | 'controlKind' | 'description' | 'fixtureId' | 'fixtureVersion' | 'governance' | 'packId'
> & {
  audit: Omit<CrudMutationAuditContract, 'scopeKind'>;
  description: string;
};

const DELETE_PACK_ID = 'mutation-gap-database-deletes';
const CREATE_PACK_ID = 'mutation-gap-database-creates';
const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const unique = (prefix: string): CrudMutationValue => ({ unique: { prefix } });
const nowIso: CrudMutationValue = { now: 'iso' };
const companyA = binding('companyA');
const userA = binding('userA');
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);

function hardDelete(
  capabilityId: string,
  model: string,
  id: CrudMutationValue,
  path: ValueMap,
  preStateFields: ValueMap,
  audit: Omit<CrudMutationAuditContract, 'scopeKind'>,
  options: {
    executionPrincipal?: 'company' | 'group';
    setupModels?: readonly string[];
  } = {},
): FixtureDefinition {
  return {
    capabilityId,
    operation: 'delete',
    description:
      `Permanently delete one isolated ${model} row through ${capabilityId}, prove its exact ` +
      'pre-action identity and scalar state, reconcile the one-row model delta, attribute the audit, and restore the captured row.',
    request: { path },
    target: { model, id },
    preState: { model, id, fields: preStateFields },
    effect: {
      kind: 'delete',
      model,
      id,
      mode: 'hard',
      expectedFields: preStateFields,
    },
    audit,
    ...(options.executionPrincipal ? { executionPrincipal: options.executionPrincipal } : {}),
    ...(options.setupModels ? { setupModels: options.setupModels } : {}),
  };
}

function softDelete(
  capabilityId: string,
  model: string,
  id: CrudMutationValue,
  preStateFields: ValueMap,
  expectedFields: ValueMap,
  audit: Omit<CrudMutationAuditContract, 'scopeKind'>,
  options: { executionPrincipal?: 'company' | 'group' } = {},
): FixtureDefinition {
  return {
    capabilityId,
    operation: 'delete',
    description:
      `Soft-delete one isolated ${model} row through ${capabilityId}, prove every changed scalar, ` +
      'attribute the audit to the exact principal and company, and restore the captured pre-action row.',
    request: { path: { id } },
    target: { model, id },
    preState: { model, id, fields: preStateFields },
    effect: {
      kind: 'delete',
      model,
      id,
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields,
      allowedFields: ['updatedAt'],
    },
    audit,
    ...(options.executionPrincipal ? { executionPrincipal: options.executionPrincipal } : {}),
  };
}

const approvalStepId = binding('mutationGapApprovalStep');
const isolatedPermissionId = binding('mutationGapPermission');
const isolatedRoleId = binding('mutationGapRole');
const isolatedEmployeeId = binding('mutationGapEmployee');
const refundCreditNoteId = binding('mutationGapRefundCreditNote');
const auditEvidencePackItemId = idOf('AuditEvidencePackItem');
const customerSegmentMembershipId = idOf('CustomerSegmentMembership');
const supplierProductCategoryId = idOf('ProductCategory');
const supplierCode = unique('CE-GAP-SUPPLIER');
const supplierName = unique('CRUD gap supplier');

const deleteDefinitions: readonly FixtureDefinition[] = [
  softDelete(
    'ApprovalStepsController.remove',
    'ApprovalStep',
    approvalStepId,
    {
      deletedAt: literal(null),
      stepName: unique('CRUD gap approval step'),
      workflowId: binding('mutationGapApprovalStep', ['workflowId']),
    },
    { deletedAt: nowIso },
    {
      required: true,
      action: 'DELETE',
      entityType: 'ApprovalStep',
      companyId: { kind: 'exact', value: companyA },
    },
  ),
  hardDelete(
    'AuditEvidencePacksController.removeItem',
    'AuditEvidencePackItem',
    auditEvidencePackItemId,
    {
      id: binding('model:AuditEvidencePackItem', ['evidencePackId']),
      itemId: auditEvidencePackItemId,
    },
    {
      evidencePackId: binding('model:AuditEvidencePackItem', ['evidencePackId']),
      title: unique('CRUD gap evidence item'),
    },
    {
      required: true,
      action: 'DELETE',
      entityType: 'AuditEvidencePackItem',
      companyId: { kind: 'exact', value: companyA },
    },
  ),
  hardDelete(
    'ComplianceDocumentStatusController.remove',
    'ComplianceDocumentStatus',
    idOf('ComplianceDocumentStatus'),
    { id: idOf('ComplianceDocumentStatus') },
    {
      companyId: companyA,
      notes: unique('CRUD gap compliance status'),
    },
    {
      required: true,
      action: 'DELETE',
      entityType: 'ComplianceDocumentStatus',
      companyId: { kind: 'effect-company' },
    },
  ),
  hardDelete(
    'CustomerSegmentsController.removeMember',
    'CustomerSegmentMembership',
    customerSegmentMembershipId,
    {
      customerId: binding('model:CustomerSegmentMembership', ['customerId']),
      id: binding('model:CustomerSegmentMembership', ['customerSegmentId']),
    },
    {
      customerId: binding('model:CustomerSegmentMembership', ['customerId']),
      customerSegmentId: binding('model:CustomerSegmentMembership', ['customerSegmentId']),
      notes: unique('CRUD gap segment member'),
    },
    {
      required: true,
      action: 'REMOVE_MEMBER',
      entityType: 'CustomerSegment',
      entityId: binding('model:CustomerSegmentMembership', ['customerSegmentId']),
      companyId: { kind: 'exact', value: companyA },
    },
  ),
  hardDelete(
    'JobQueueConfigsController.remove',
    'JobQueueConfig',
    idOf('JobQueueConfig'),
    { id: idOf('JobQueueConfig') },
    {
      description: unique('CRUD gap queue'),
      queueName: binding('model:JobQueueConfig', ['queueName']),
    },
    {
      required: true,
      action: 'JOB_QUEUE_CONFIG_DELETED',
      entityType: 'JobQueueConfig',
      companyId: { kind: 'exact', value: literal(null) },
    },
    { executionPrincipal: 'group' },
  ),
  softDelete(
    'EmployeesController.remove',
    'Employee',
    isolatedEmployeeId,
    {
      deletedAt: literal(null),
      employmentStatus: literal('ACTIVE'),
    },
    {
      deletedAt: nowIso,
      employmentStatus: literal('INACTIVE'),
    },
    {
      required: true,
      action: 'DELETE',
      entityType: 'Employee',
      companyId: { kind: 'effect-company' },
    },
  ),
  hardDelete(
    'NotificationsController.remove',
    'Notification',
    idOf('Notification'),
    { id: idOf('Notification') },
    {
      companyId: companyA,
      recipientUserId: userA,
      title: unique('CRUD gap notification'),
    },
    {
      required: true,
      action: 'NOTIFICATION_DELETE',
      entityType: 'Notification',
      companyId: { kind: 'effect-company' },
    },
  ),
  hardDelete(
    'PermissionsController.remove',
    'Permission',
    isolatedPermissionId,
    { id: isolatedPermissionId },
    {
      code: binding('mutationGapPermission', ['code']),
      description: unique('CRUD gap permission'),
      isGroupControl: literal(false),
    },
    {
      required: true,
      action: 'PERMISSION_DELETE',
      entityType: 'Permission',
      companyId: { kind: 'exact', value: literal(null) },
    },
    { executionPrincipal: 'group' },
  ),
  softDelete(
    'PostingRulesController.remove',
    'AccountingPostingRule',
    idOf('AccountingPostingRule'),
    { deletedAt: literal(null) },
    { deletedAt: nowIso },
    {
      required: true,
      action: 'DELETE',
      entityType: 'AccountingPostingRule',
      companyId: { kind: 'effect-company' },
    },
  ),
  hardDelete(
    'PriceListsController.removeItem',
    'PriceListItem',
    idOf('PriceListItem'),
    { id: idOf('PriceListItem') },
    {
      price: literal(19.75),
      priceListId: binding('model:PriceListItem', ['priceListId']),
      productId: binding('model:PriceListItem', ['productId']),
      unitId: binding('model:PriceListItem', ['unitId']),
    },
    {
      required: true,
      action: 'PRICE_LIST_ITEM_DELETE',
      entityType: 'PriceListItem',
      companyId: { kind: 'exact', value: companyA },
    },
  ),
  hardDelete(
    'RolesController.remove',
    'Role',
    isolatedRoleId,
    { id: isolatedRoleId },
    {
      description: unique('CRUD gap role'),
      isSystem: literal(false),
      name: binding('mutationGapRole', ['name']),
    },
    {
      required: true,
      action: 'ROLE_DELETE',
      entityType: 'Role',
      companyId: { kind: 'exact', value: literal(null) },
    },
    { executionPrincipal: 'group' },
  ),
];

const createDefinitions: readonly FixtureDefinition[] = [
  {
    capabilityId: 'RefundsController.create',
    operation: 'create',
    description:
      'Create one DRAFT refund against an isolated ISSUED credit note, prove every request-backed and service-generated scalar, reconcile the entity-code sequence and audit, then remove the row and restore the sequence and credit-note prerequisite.',
    request: {
      body: {
        amount: literal(25.5),
        cashAccountId: idOf('CashAccount'),
        companyId: companyA,
        creditNoteId: refundCreditNoteId,
        refundDate: literal('2031-06-15T00:00:00.000Z'),
      },
    },
    preState: {
      model: 'CreditNote',
      id: refundCreditNoteId,
      fields: {
        appliedAmount: literal(0),
        deletedAt: literal(null),
        status: literal('ISSUED'),
        totalAmount: literal(100),
      },
    },
    effect: {
      kind: 'create',
      model: 'Refund',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        amount: literal(25.5),
        cashAccountId: idOf('CashAccount'),
        companyId: companyA,
        creditNoteId: refundCreditNoteId,
        refundDate: literal('2031-06-15T00:00:00.000Z'),
      },
      generatedFields: {
        branchId: { kind: 'exact', value: binding('model:CashAccount', ['branchId']) },
        createdById: { kind: 'exact', value: userA },
        currency: { kind: 'exact', value: literal('TZS') },
        divisionId: { kind: 'exact', value: binding('model:CashAccount', ['divisionId']) },
        refundNumber: { kind: 'entity-code', entityType: 'Refund', companyId: companyA },
        status: { kind: 'exact', value: literal('DRAFT') },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'REFUND_CREATE',
      entityType: 'Refund',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'SuppliersController.create',
    operation: 'create',
    description:
      'Create one isolated supplier and its one requested product-category link, prove complete scalar closure for both rows, attribute the exact company audit, and recover the child scope before the parent scope.',
    request: {
      body: {
        companyId: companyA,
        divisionId: idOf('Division'),
        name: supplierName,
        productCategoryIds: { array: [supplierProductCategoryId] },
        supplierCode,
        supplierType: literal('GENERAL_SUPPLIER'),
      },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'supplier',
          kind: 'scoped-row-create',
          model: 'Supplier',
          scope: {
            equals: { companyId: companyA, supplierCode },
            identityFields: ['id'],
          },
          expectedFields: {
            address: literal(null),
            branchId: literal(null),
            companyId: companyA,
            contactPerson: literal(null),
            createdById: userA,
            creditLimit: literal(0),
            currentBalance: literal(0),
            deletedAt: literal(null),
            divisionId: idOf('Division'),
            email: literal(null),
            legalName: literal(null),
            name: supplierName,
            notes: literal(null),
            paymentTerms: literal(null),
            phone: literal(null),
            status: literal('ACTIVE'),
            supplierCode,
            supplierType: literal('GENERAL_SUPPLIER'),
            tin: literal(null),
            updatedById: userA,
            vrn: literal(null),
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          effectId: 'supplierCategory',
          kind: 'scoped-row-create',
          model: 'SupplierProductCategory',
          scope: {
            equals: { productCategoryId: supplierProductCategoryId },
            identityFields: ['id'],
          },
          expectedFields: {
            productCategoryId: supplierProductCategoryId,
            supplierId: { effectRef: { effectId: 'supplier' } },
          },
          generatedFields: {
            createdAt: { kind: 'action-time' },
          },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: { effectRef: { effectId: 'supplier' } },
    },
    audit: {
      required: true,
      action: 'SUPPLIER_CREATE',
      entityType: 'Supplier',
      companyId: { kind: 'exact', value: companyA },
    },
  },
];

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 76);
  return `mutation-gap-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

export const CRUD_MUTATION_GAP_TRANCHE_CLOSED_IDS: readonly string[] = Object.freeze(
  [...deleteDefinitions, ...createDefinitions].map((definition) => definition.capabilityId),
);

function pack(
  packId: string,
  definitions: readonly FixtureDefinition[],
): CrudMutationAnyFixturePack {
  return Object.freeze({
    packId,
    packVersion: 1,
    fixtures: Object.freeze(
      definitions.map((definition) => {
        const scopeKind = crudMutationAuditScopeKind(definition.audit.companyId);
        return Object.freeze({
          ...definition,
          audit: Object.freeze({
            ...definition.audit,
            scopeKind,
            attributionStatus:
              definition.audit.attributionStatus ??
              crudMutationAuditAttributionStatus(definition.capabilityId),
          }),
          controlKind: 'positive' as const,
          fixtureId: fixtureId(definition.capabilityId),
          fixtureVersion: 1 as const,
          governance: CRUD_MUTATION_GOVERNANCE,
          packId,
        });
      }),
    ),
  });
}

export const CRUD_MUTATION_GAP_TRANCHE_EVIDENCE_PACK: CrudMutationAnyFixturePack = pack(
  DELETE_PACK_ID,
  deleteDefinitions,
);

export const CRUD_MUTATION_GAP_CREATE_EVIDENCE_PACK: CrudMutationAnyFixturePack = pack(
  CREATE_PACK_ID,
  createDefinitions,
);
