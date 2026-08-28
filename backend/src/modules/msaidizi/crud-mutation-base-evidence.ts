import { createHash } from 'node:crypto';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationBlocker,
  CrudMutationCompoundNamedEffect,
  CrudMutationValue,
  crudMutationAuditScopeKind,
} from './crud-mutation-evidence';
import {
  createFrameworkFieldsForModel,
  generatedFieldsForCapability,
} from './crud-mutation-generated-fields';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';

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
const idOf = (model: string) => binding(`model:${model}`);
const debitAccountA = binding('debitChartOfAccountA');
const creditAccountA = binding('creditChartOfAccountA');
const journalSequenceCodeA = binding('journalEntrySequenceCodeA');
const journalCreateDescription = unique('CRUD evidence balanced journal');
const journalCreateDebitDescription = unique('CRUD evidence debit line');
const journalCreateCreditDescription = unique('CRUD evidence credit line');
const journalCreateReferenceId = unique('CRUD-JOURNAL-REF');
const journalReverseReason = literal('CRUD evidence exact journal reversal');
const journalReverseOriginalNumber = literal('CE-REVERSAL-ORIGINAL-7F1A5D');

const PACK_ID = 'mutation-base-customers-journal';

function fixtureId(capabilityId: string): string {
  if (capabilityId === 'CustomersController.create') return 'customer-create-positive';
  if (capabilityId === 'CustomersController.update') return 'customer-update-positive';
  if (capabilityId === 'CustomersController.remove') return 'customer-delete-positive';
  if (capabilityId === 'JournalEntriesController.create') return 'journal-create-positive';
  if (capabilityId === 'JournalEntriesController.post') return 'journal-post-positive';
  if (capabilityId === 'JournalEntriesController.reverse') return 'journal-reverse-positive';
  return `mutation-base-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 16)}`;
}

const definitions: readonly Omit<
  CrudMutationAnyFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'packId'
>[] = [
  {
    capabilityId: 'CustomersController.create',
    operation: 'create',
    description:
      'Create a company-scoped customer and prove every request-backed and service-generated scalar.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['Branch'],
    request: {
      body: {
        branchId: idOf('Branch'),
        companyId: companyA,
        customerCode: unique('CE-CUSTOMER'),
        customerType: literal('INDIVIDUAL'),
        name: unique('CRUD evidence customer'),
      },
    },
    effect: {
      kind: 'create',
      model: 'Customer',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        branchId: idOf('Branch'),
        companyId: companyA,
        customerCode: unique('CE-CUSTOMER'),
        customerType: literal('INDIVIDUAL'),
        name: unique('CRUD evidence customer'),
      },
      generatedFields: generatedFieldsForCapability('CustomersController.create'),
      allowedFields: createFrameworkFieldsForModel('Customer'),
    },
    audit: {
      required: true,
      action: 'CUSTOMER_CREATE',
      entityType: 'Customer',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'CustomersController.update',
    operation: 'update',
    description:
      'Update a seeded customer while proving company immutability and exact actor attribution.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['Customer'],
    request: {
      path: { id: idOf('Customer') },
      body: { name: unique('CRUD evidence updated customer') },
    },
    target: { model: 'Customer', id: idOf('Customer') },
    preState: {
      model: 'Customer',
      id: idOf('Customer'),
      fields: { deletedAt: literal(null), updatedById: literal(null) },
    },
    effect: {
      kind: 'update',
      model: 'Customer',
      id: idOf('Customer'),
      expectedFields: {
        name: unique('CRUD evidence updated customer'),
        updatedById: userA,
      },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'CUSTOMER_UPDATE',
      entityType: 'Customer',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'CustomersController.remove',
    operation: 'delete',
    description: 'Soft-delete a seeded customer and recover the exact pre-action row.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['Customer'],
    request: { path: { id: idOf('Customer') } },
    target: { model: 'Customer', id: idOf('Customer') },
    preState: {
      model: 'Customer',
      id: idOf('Customer'),
      fields: { deletedAt: literal(null) },
    },
    effect: {
      kind: 'delete',
      model: 'Customer',
      id: idOf('Customer'),
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields: { deletedAt: nowIso },
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'CUSTOMER_DELETE',
      entityType: 'Customer',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'JournalEntriesController.create',
    operation: 'create',
    description:
      'Create one balanced draft journal and prove the exact sequence, complete header, two distinct-account lines, audit attribution, and dependency-ordered recovery.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['AccountingPeriod', 'ChartOfAccount', 'FiscalYear'],
    request: {
      body: {
        accountingPeriodId: idOf('AccountingPeriod'),
        companyId: companyA,
        description: journalCreateDescription,
        lines: {
          array: [
            {
              object: {
                accountId: debitAccountA,
                credit: literal(0),
                debit: literal(37.25),
                description: journalCreateDebitDescription,
              },
            },
            {
              object: {
                accountId: creditAccountA,
                credit: literal(37.25),
                debit: literal(0),
                description: journalCreateCreditDescription,
              },
            },
          ],
        },
        referenceId: journalCreateReferenceId,
        referenceType: literal('CRUD_EVIDENCE'),
        transactionDate: literal('2026-08-25T12:00:00.000Z'),
      },
    },
    preStates: [
      {
        model: 'AccountingPeriod',
        id: idOf('AccountingPeriod'),
        fields: { status: literal('OPEN') },
      },
      {
        model: 'FiscalYear',
        id: idOf('FiscalYear'),
        fields: { status: literal('OPEN') },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        journalSequenceCreateEffect(40),
        {
          effectId: 'journal',
          kind: 'scoped-row-create',
          model: 'JournalEntry',
          scope: {
            equals: { companyId: companyA, description: journalCreateDescription },
            identityFields: ['id'],
          },
          expectedFields: {
            accountingPeriodId: idOf('AccountingPeriod'),
            branchId: literal(null),
            companyId: companyA,
            createdById: userA,
            deletedAt: literal(null),
            description: journalCreateDescription,
            divisionId: literal(null),
            postedAt: literal(null),
            postedById: literal(null),
            referenceId: journalCreateReferenceId,
            referenceType: literal('CRUD_EVIDENCE'),
            reversalOfId: literal(null),
            reversalReason: literal(null),
            reversedAt: literal(null),
            reversedById: literal(null),
            status: literal('DRAFT'),
            totalCredit: literal(37.25),
            totalDebit: literal(37.25),
            transactionDate: literal('2026-08-25T12:00:00.000Z'),
          },
          generatedFields: {
            journalNumber: {
              kind: 'entity-code',
              entityType: 'JournalEntry',
              companyId: companyA,
            },
            createdAt: { kind: 'action-time' },
            updatedAt: { kind: 'action-time' },
          },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 30,
        },
        journalLineCreateEffect({
          effectId: 'debitLine',
          accountId: debitAccountA,
          description: journalCreateDebitDescription,
          debit: 37.25,
          credit: 0,
          journalEffectId: 'journal',
          recoveryOrder: 10,
        }),
        journalLineCreateEffect({
          effectId: 'creditLine',
          accountId: creditAccountA,
          description: journalCreateCreditDescription,
          debit: 0,
          credit: 37.25,
          journalEffectId: 'journal',
          recoveryOrder: 20,
        }),
      ],
      auditEntityId: { effectRef: { effectId: 'journal' } },
    },
    audit: {
      required: true,
      action: 'JOURNAL_ENTRY_CREATE',
      entityType: 'JournalEntry',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'JournalEntriesController.post',
    operation: 'action',
    description: 'Post a seeded balanced draft journal through a distinct maker/checker principal.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['AccountingPeriod', 'FiscalYear', 'JournalEntry'],
    request: { path: { id: idOf('JournalEntry') } },
    target: { model: 'JournalEntry', id: idOf('JournalEntry') },
    preState: {
      model: 'JournalEntry',
      id: idOf('JournalEntry'),
      fields: {
        postedAt: literal(null),
        postedById: literal(null),
        status: literal('DRAFT'),
      },
    },
    preStates: [
      {
        model: 'AccountingPeriod',
        id: idOf('AccountingPeriod'),
        fields: { status: literal('OPEN') },
      },
      {
        model: 'FiscalYear',
        id: idOf('FiscalYear'),
        fields: { status: literal('OPEN') },
      },
    ],
    effect: {
      kind: 'transition',
      model: 'JournalEntry',
      id: idOf('JournalEntry'),
      expectedFields: {
        postedAt: nowIso,
        postedById: userA,
        status: literal('POSTED'),
      },
      forbiddenFields: [
        'companyId',
        'createdById',
        'journalNumber',
        'reversalOfId',
        'reversedAt',
        'reversedById',
      ],
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'JOURNAL_ENTRY_POST',
      entityType: 'JournalEntry',
      companyId: { kind: 'effect-company' },
    },
    executionPrincipal: 'poster',
  },
  {
    capabilityId: 'JournalEntriesController.reverse',
    operation: 'action',
    description:
      'Reverse one isolated posted journal and prove the original claim, exact sequence, posted reversal header, swapped distinct-account lines, audit attribution, and dependency-ordered recovery.',
    governance: CRUD_MUTATION_GOVERNANCE,
    setupModels: ['AccountingPeriod', 'ChartOfAccount', 'FiscalYear', 'JournalEntry'],
    request: {
      path: { id: idOf('JournalEntry') },
      body: {
        accountingPeriodId: idOf('AccountingPeriod'),
        reversalReason: journalReverseReason,
        transactionDate: literal('2026-08-26T12:00:00.000Z'),
      },
    },
    target: { model: 'JournalEntry', id: idOf('JournalEntry') },
    preState: {
      model: 'JournalEntry',
      id: idOf('JournalEntry'),
      fields: {
        accountingPeriodId: idOf('AccountingPeriod'),
        deletedAt: literal(null),
        journalNumber: journalReverseOriginalNumber,
        postedAt: literal('2026-08-25T12:00:01.000Z'),
        postedById: binding('posterUserA'),
        reversalOfId: literal(null),
        reversalReason: literal(null),
        reversedAt: literal(null),
        reversedById: literal(null),
        status: literal('POSTED'),
        totalCredit: literal(125),
        totalDebit: literal(125),
        transactionDate: literal('2026-08-25T12:00:00.000Z'),
      },
    },
    preStates: [
      {
        model: 'AccountingPeriod',
        id: idOf('AccountingPeriod'),
        fields: { status: literal('OPEN') },
      },
      {
        model: 'FiscalYear',
        id: idOf('FiscalYear'),
        fields: { status: literal('OPEN') },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        journalSequenceCreateEffect(40),
        {
          effectId: 'original',
          kind: 'row-update',
          model: 'JournalEntry',
          id: idOf('JournalEntry'),
          expectedFields: {
            reversalReason: journalReverseReason,
            reversedAt: nowIso,
            reversedById: userA,
            status: literal('REVERSED'),
            updatedAt: nowIso,
          },
          forbiddenFields: [
            'accountingPeriodId',
            'branchId',
            'companyId',
            'createdAt',
            'createdById',
            'deletedAt',
            'description',
            'divisionId',
            'id',
            'journalNumber',
            'postedAt',
            'postedById',
            'referenceId',
            'referenceType',
            'reversalOfId',
            'totalCredit',
            'totalDebit',
            'transactionDate',
          ],
          recovery: 'restore-row',
          recoveryOrder: 30,
        },
        {
          effectId: 'reversal',
          kind: 'scoped-row-create',
          model: 'JournalEntry',
          scope: {
            equals: { reversalOfId: idOf('JournalEntry') },
            identityFields: ['id'],
          },
          expectedFields: {
            accountingPeriodId: idOf('AccountingPeriod'),
            branchId: literal(null),
            companyId: companyA,
            createdById: userA,
            deletedAt: literal(null),
            description: literal(
              'Reversal of CE-REVERSAL-ORIGINAL-7F1A5D: CRUD evidence exact journal reversal',
            ),
            divisionId: literal(null),
            postedAt: nowIso,
            postedById: userA,
            referenceId: literal(null),
            referenceType: literal(null),
            reversalOfId: { effectRef: { effectId: 'original' } },
            reversalReason: literal(null),
            reversedAt: literal(null),
            reversedById: literal(null),
            status: literal('POSTED'),
            totalCredit: literal(125),
            totalDebit: literal(125),
            transactionDate: literal('2026-08-26T12:00:00.000Z'),
          },
          generatedFields: {
            journalNumber: {
              kind: 'entity-code',
              entityType: 'JournalEntry',
              companyId: companyA,
            },
            createdAt: { kind: 'action-time' },
            updatedAt: { kind: 'action-time' },
          },
          allowedFields: ['id'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        journalLineCreateEffect({
          effectId: 'reversalDebitLine',
          accountId: creditAccountA,
          description: literal(null),
          debit: 125,
          credit: 0,
          journalEffectId: 'reversal',
          recoveryOrder: 0,
        }),
        journalLineCreateEffect({
          effectId: 'reversalCreditLine',
          accountId: debitAccountA,
          description: literal(null),
          debit: 0,
          credit: 125,
          journalEffectId: 'reversal',
          recoveryOrder: 10,
        }),
      ],
      auditEntityId: { effectRef: { effectId: 'original' } },
    },
    audit: {
      required: true,
      action: 'JOURNAL_ENTRY_REVERSE',
      entityType: 'JournalEntry',
      companyId: { kind: 'exact', value: companyA },
    },
  },
];

export const CRUD_MUTATION_BASE_EVIDENCE_PACK: CrudMutationAnyFixturePack = Object.freeze({
  packId: PACK_ID,
  packVersion: 1,
  fixtures: Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ...definition,
        audit: {
          ...definition.audit,
          scopeKind:
            definition.audit.scopeKind ?? crudMutationAuditScopeKind(definition.audit.companyId),
          attributionStatus: definition.audit.attributionStatus ?? 'EXPLICIT',
        },
        fixtureId: fixtureId(definition.capabilityId),
        fixtureVersion: 1 as const,
        controlKind: 'positive' as const,
        packId: PACK_ID,
      }),
    ),
  ),
});

export const CRUD_MUTATION_BASE_BLOCKERS: readonly CrudMutationBlocker[] = Object.freeze([]);

function journalSequenceCreateEffect(
  recoveryOrder: number,
): Extract<CrudMutationCompoundNamedEffect, { kind: 'scoped-row-create' }> {
  return {
    effectId: 'journalSequence',
    kind: 'scoped-row-create',
    model: 'DocumentNumberSequence',
    scope: {
      equals: { sequenceCode: journalSequenceCodeA },
      identityFields: ['id'],
    },
    expectedFields: {
      companyId: companyA,
      currentNumber: literal(1),
      deletedAt: literal(null),
      entityType: literal('JournalEntry'),
      isActive: literal(true),
      padding: literal(6),
      prefix: literal('JE-{YYYY}-'),
      resetFrequency: literal('YEARLY'),
      sequenceCode: journalSequenceCodeA,
      suffix: literal(null),
    },
    generatedFields: {
      createdAt: { kind: 'action-time' },
      lastResetAt: { kind: 'action-time' },
      updatedAt: { kind: 'action-time' },
    },
    allowedFields: ['id'],
    recovery: 'restore-scope',
    recoveryOrder,
  };
}

function journalLineCreateEffect(input: {
  effectId: string;
  accountId: CrudMutationValue;
  description: CrudMutationValue;
  debit: number;
  credit: number;
  journalEffectId: string;
  recoveryOrder: number;
}): Extract<CrudMutationCompoundNamedEffect, { kind: 'scoped-row-create' }> {
  return {
    effectId: input.effectId,
    kind: 'scoped-row-create',
    model: 'JournalEntryLine',
    scope: {
      equals: {
        accountId: input.accountId,
        companyId: companyA,
        credit: literal(input.credit),
        debit: literal(input.debit),
        description: input.description,
      },
      identityFields: ['id'],
    },
    expectedFields: {
      accountId: input.accountId,
      branchId: literal(null),
      companyId: companyA,
      credit: literal(input.credit),
      debit: literal(input.debit),
      description: input.description,
      divisionId: literal(null),
      journalEntryId: { effectRef: { effectId: input.journalEffectId } },
    },
    generatedFields: {
      createdAt: { kind: 'action-time' },
      updatedAt: { kind: 'action-time' },
    },
    allowedFields: ['id'],
    recovery: 'restore-scope',
    recoveryOrder: input.recoveryOrder,
  };
}
