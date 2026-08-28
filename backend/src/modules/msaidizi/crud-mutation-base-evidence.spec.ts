import { Prisma } from '@prisma/client';
import {
  CRUD_MUTATION_BASE_BLOCKERS,
  CRUD_MUTATION_BASE_EVIDENCE_PACK,
} from './crud-mutation-base-evidence';
import { validateCrudMutationFixtureDmmfContract } from './crud-mutation-evidence-registry';
import {
  CrudMutationAnyFixtureRegistration,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

describe('declarative Customer and JournalEntry mutation evidence', () => {
  const fixtures = CRUD_MUTATION_BASE_EVIDENCE_PACK.fixtures;
  const fixtureByCapability = new Map(
    fixtures.map((fixture) => [fixture.capabilityId, fixture] as const),
  );

  function fixture(capabilityId: string): CrudMutationAnyFixtureRegistration {
    const found = fixtureByCapability.get(capabilityId);
    if (!found) throw new Error(`Missing base fixture ${capabilityId}`);
    return found;
  }

  it('registers all six customer and journal positives with valid contracts', () => {
    expect(fixtures.map((fixture) => fixture.capabilityId)).toEqual([
      'CustomersController.create',
      'CustomersController.update',
      'CustomersController.remove',
      'JournalEntriesController.create',
      'JournalEntriesController.post',
      'JournalEntriesController.reverse',
    ]);
    expect(fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      'customer-create-positive',
      'customer-update-positive',
      'customer-delete-positive',
      'journal-create-positive',
      'journal-post-positive',
      'journal-reverse-positive',
    ]);
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      expect(validateCrudMutationFixtureDmmfContract(fixture)).toEqual([]);
      expect(fixture.governance).toEqual({ scope: 'not_applicable', audit: 'required' });
      expect(fixture.audit.companyId).toEqual(
        fixture.effect.kind === 'compound'
          ? { kind: 'exact', value: { binding: 'companyA' } }
          : { kind: 'effect-company' },
      );
    }
  });

  it('closes every scalar and recovers children before the journal and sequence on create', () => {
    const journal = fixture('JournalEntriesController.create');
    expect(journal.operation).toBe('create');
    expect(journal.request.body).toMatchObject({
      accountingPeriodId: { binding: 'model:AccountingPeriod' },
      companyId: { binding: 'companyA' },
      lines: {
        array: [
          { object: { accountId: { binding: 'debitChartOfAccountA' } } },
          { object: { accountId: { binding: 'creditChartOfAccountA' } } },
        ],
      },
    });
    expect(journal.effect.kind).toBe('compound');
    if (journal.effect.kind !== 'compound') throw new Error('journal create fixture drifted');
    expect(journal.effect.effects.map((effect) => effect.effectId)).toEqual([
      'journalSequence',
      'journal',
      'debitLine',
      'creditLine',
    ]);
    for (const effect of journal.effect.effects) {
      expect(effect.kind).toBe('scoped-row-create');
      if (effect.kind !== 'scoped-row-create') continue;
      const model = Prisma.dmmf.datamodel.models.find((item) => item.name === effect.model);
      const scalarFields = model?.fields
        .filter((field) => field.kind !== 'object')
        .map((field) => field.name)
        .sort();
      expect(
        [
          ...Object.keys(effect.expectedFields),
          ...Object.keys(effect.generatedFields),
          ...(effect.allowedFields ?? []),
        ].sort(),
      ).toEqual(scalarFields);
    }
    expect(journal.effect.effects[0]).toMatchObject({
      model: 'DocumentNumberSequence',
      scope: { equals: { sequenceCode: { binding: 'journalEntrySequenceCodeA' } } },
      expectedFields: { currentNumber: { literal: 1 }, resetFrequency: { literal: 'YEARLY' } },
      generatedFields: { lastResetAt: { kind: 'action-time' } },
    });
    expect(journal.effect.auditEntityId).toEqual({ effectRef: { effectId: 'journal' } });
    expect(crudMutationRecoveryPlan(journal.effect).map((item) => item.contractId)).toEqual([
      'debitLine',
      'creditLine',
      'journal',
      'journalSequence',
    ]);
  });

  it('binds Customer service-derived fields and actor attribution exactly', () => {
    expect(fixtureByCapability.get('CustomersController.create')).toMatchObject({
      operation: 'create',
      effect: {
        kind: 'create',
        model: 'Customer',
        companyPath: ['companyId'],
        generatedFields: {
          divisionId: { kind: 'exact', value: { binding: 'model:Branch', path: ['divisionId'] } },
          createdById: { kind: 'exact', value: { binding: 'userA' } },
          updatedById: { kind: 'exact', value: { binding: 'userA' } },
          creditLimit: { kind: 'exact', value: { literal: 0 } },
          status: { kind: 'exact', value: { literal: 'ACTIVE' } },
        },
      },
      audit: { action: 'CUSTOMER_CREATE', entityType: 'Customer' },
    });
    expect(fixtureByCapability.get('CustomersController.update')).toMatchObject({
      effect: {
        kind: 'update',
        expectedFields: { updatedById: { binding: 'userA' } },
      },
      audit: { action: 'CUSTOMER_UPDATE', entityType: 'Customer' },
    });
    expect(fixtureByCapability.get('CustomersController.remove')).toMatchObject({
      effect: {
        kind: 'delete',
        mode: 'soft',
        expectedFields: { deletedAt: { now: 'iso' } },
      },
      audit: { action: 'CUSTOMER_DELETE', entityType: 'Customer' },
    });
  });

  it('uses the distinct poster principal for the exact journal transition', () => {
    expect(fixtureByCapability.get('JournalEntriesController.post')).toMatchObject({
      operation: 'action',
      executionPrincipal: 'poster',
      setupModels: ['AccountingPeriod', 'FiscalYear', 'JournalEntry'],
      preState: {
        model: 'JournalEntry',
        fields: {
          status: { literal: 'DRAFT' },
          postedAt: { literal: null },
          postedById: { literal: null },
        },
      },
      preStates: [
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
      ],
      effect: {
        kind: 'transition',
        expectedFields: {
          status: { literal: 'POSTED' },
          postedById: { binding: 'userA' },
          postedAt: { now: 'iso' },
        },
      },
      audit: { action: 'JOURNAL_ENTRY_POST', entityType: 'JournalEntry' },
    });
  });

  it('closes the reversal transition, created aggregate, swapped lines, and recovery graph', () => {
    const journal = fixture('JournalEntriesController.reverse');
    expect(journal.operation).toBe('action');
    expect(journal.preState).toMatchObject({
      model: 'JournalEntry',
      fields: {
        journalNumber: { literal: 'CE-REVERSAL-ORIGINAL-7F1A5D' },
        status: { literal: 'POSTED' },
        reversedAt: { literal: null },
      },
    });
    expect(journal.effect.kind).toBe('compound');
    if (journal.effect.kind !== 'compound') throw new Error('journal reverse fixture drifted');
    expect(journal.effect.effects.map((effect) => effect.effectId)).toEqual([
      'journalSequence',
      'original',
      'reversal',
      'reversalDebitLine',
      'reversalCreditLine',
    ]);
    const original = journal.effect.effects[1];
    expect(original).toMatchObject({
      kind: 'row-update',
      expectedFields: {
        status: { literal: 'REVERSED' },
        reversedById: { binding: 'userA' },
        reversedAt: { now: 'iso' },
        updatedAt: { now: 'iso' },
      },
    });
    if (original.kind !== 'row-update') throw new Error('original transition drifted');
    const journalScalars = Prisma.dmmf.datamodel.models
      .find((item) => item.name === 'JournalEntry')!
      .fields.filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort();
    expect(
      [...Object.keys(original.expectedFields), ...(original.forbiddenFields ?? [])].sort(),
    ).toEqual(journalScalars);
    expect(journal.effect.effects[2]).toMatchObject({
      kind: 'scoped-row-create',
      model: 'JournalEntry',
      expectedFields: {
        reversalOfId: { effectRef: { effectId: 'original' } },
        status: { literal: 'POSTED' },
        totalDebit: { literal: 125 },
        totalCredit: { literal: 125 },
      },
    });
    expect(journal.effect.effects[3]).toMatchObject({
      expectedFields: {
        accountId: { binding: 'creditChartOfAccountA' },
        debit: { literal: 125 },
        credit: { literal: 0 },
      },
    });
    expect(journal.effect.effects[4]).toMatchObject({
      expectedFields: {
        accountId: { binding: 'debitChartOfAccountA' },
        debit: { literal: 0 },
        credit: { literal: 125 },
      },
    });
    expect(journal.effect.auditEntityId).toEqual({ effectRef: { effectId: 'original' } });
    expect(crudMutationRecoveryPlan(journal.effect).map((item) => item.contractId)).toEqual([
      'reversalDebitLine',
      'reversalCreditLine',
      'reversal',
      'original',
      'journalSequence',
    ]);
  });

  it('has no remaining base blockers', () => {
    expect(CRUD_MUTATION_BASE_BLOCKERS).toEqual([]);
  });
});
