import {
  includingSoftDeletedWhere,
  physicallyDeleteDisposableRecord,
} from './crud-evidence-disposable-recovery';

describe('CRUD evidence disposable recovery', () => {
  it('opts soft-deletable models into tombstone visibility', () => {
    expect(includingSoftDeletedWhere('AccountingLock', { id: 'lock-1' })).toEqual({
      AND: [{ id: 'lock-1' }, { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] }],
    });
    expect(includingSoftDeletedWhere('AuditLog', { id: 'audit-1' })).toEqual({ id: 'audit-1' });
    expect(
      includingSoftDeletedWhere('Customer', {
        companyId: 'company-1',
        customerCode: { in: ['SERVICE-1'] },
      }),
    ).toEqual({
      AND: [
        { companyId: 'company-1', customerCode: { in: ['SERVICE-1'] } },
        { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] },
      ],
    });
  });

  it('physically removes an exact service-lane customer instead of leaving a hidden tombstone', async () => {
    const executeRaw = jest.fn(async () => 1);

    await physicallyDeleteDisposableRecord(
      executeRaw,
      'msaidizi_crud_evidence_12345678',
      'Customer',
      { id: 'service-customer-1' },
    );

    expect(executeRaw).toHaveBeenCalledWith(
      'DELETE FROM "msaidizi_crud_evidence_12345678"."customers" WHERE "id" = $1',
      'service-customer-1',
    );
  });

  it('physically deletes one exact identity through parameterized raw SQL', async () => {
    const executeRaw = jest.fn(async () => 1);

    await physicallyDeleteDisposableRecord(
      executeRaw,
      'msaidizi_crud_evidence_12345678',
      'AccountingLock',
      { id: 'lock-1' },
    );

    expect(executeRaw).toHaveBeenCalledWith(
      'DELETE FROM "msaidizi_crud_evidence_12345678"."accounting_locks" WHERE "id" = $1',
      'lock-1',
    );
  });

  it('resolves generated-sequence table names without using soft-delete delegates', async () => {
    const executeRaw = jest.fn(async () => 1);

    await physicallyDeleteDisposableRecord(
      executeRaw,
      'msaidizi_crud_evidence_12345678',
      'DocumentNumberSequence',
      { id: 'sequence-1' },
    );

    expect(executeRaw).toHaveBeenCalledWith(
      'DELETE FROM "msaidizi_crud_evidence_12345678"."document_number_sequences" WHERE "id" = $1',
      'sequence-1',
    );
  });

  it('refuses physical deletes outside the isolated evidence schema', async () => {
    const executeRaw = jest.fn(async () => 1);

    await expect(
      physicallyDeleteDisposableRecord(executeRaw, 'public', 'AccountingLock', { id: 'lock-1' }),
    ).rejects.toThrow('outside a disposable evidence schema');
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('fails closed when the exact row was not physically deleted', async () => {
    await expect(
      physicallyDeleteDisposableRecord(
        async () => 0,
        'msaidizi_crud_evidence_12345678',
        'AccountingLock',
        { id: 'lock-1' },
      ),
    ).rejects.toThrow('expected one AccountingLock row but deleted 0');
  });
});
