import { AuditSeverity } from '@prisma/client';
import { auditFor } from './audit-action.helper';

/**
 * P2-06 regression — canonical audit action + severity.
 *
 * Action format: `<ENTITY_PREFIX>_<VERB>` (PascalCase → SCREAMING_SNAKE_CASE).
 * Severity: max of entity-floor, verb-floor, and explicit override.
 */

describe('auditFor (P2-06)', () => {
  it('produces SCREAMING_SNAKE_CASE action prefix for PascalCase entities', () => {
    expect(auditFor('BankAccount', 'CREATE').action).toBe('BANK_ACCOUNT_CREATE');
    expect(auditFor('JournalEntry', 'POST').action).toBe('JOURNAL_ENTRY_POST');
    expect(auditFor('User', 'CREATE').action).toBe('USER_CREATE');
    expect(auditFor('GoodsReceivedNote', 'CREATE').action).toBe(
      'GOODS_RECEIVED_NOTE_CREATE',
    );
  });

  it('promotes Group-Control entities to HIGH severity even on harmless verbs', () => {
    expect(auditFor('BankAccount', 'VIEW').severity).toBe(AuditSeverity.HIGH);
    expect(auditFor('Loan', 'UPDATE').severity).toBe(AuditSeverity.HIGH);
    expect(auditFor('Contract', 'CREATE').severity).toBe(AuditSeverity.HIGH);
  });

  it('promotes financial-mutation verbs to HIGH regardless of entity', () => {
    expect(auditFor('Customer', 'POST').severity).toBe(AuditSeverity.HIGH);
    expect(auditFor('SalesOrder', 'APPROVE').severity).toBe(AuditSeverity.HIGH);
    expect(auditFor('Receivable', 'REVERSE').severity).toBe(AuditSeverity.HIGH);
    expect(auditFor('PayrollRun', 'PAY').severity).toBe(AuditSeverity.HIGH);
  });

  it('keeps low-risk operational verbs LOW', () => {
    expect(auditFor('Customer', 'VIEW').severity).toBe(AuditSeverity.LOW);
    expect(auditFor('Product', 'CREATE').severity).toBe(AuditSeverity.LOW);
  });

  it('computes the max of entity, verb, and explicit floor', () => {
    expect(
      auditFor('Customer', 'CREATE', { severityFloor: AuditSeverity.MEDIUM })
        .severity,
    ).toBe(AuditSeverity.MEDIUM);
    expect(
      auditFor('BankAccount', 'CREATE', { severityFloor: AuditSeverity.LOW })
        .severity,
    ).toBe(AuditSeverity.HIGH); // entity floor still wins
  });

  it('falls back gracefully for unknown entity', () => {
    const meta = auditFor('SomeNewModel', 'CREATE');
    expect(meta.action).toBe('SOME_NEW_MODEL_CREATE');
    expect(meta.severity).toBe(AuditSeverity.LOW);
  });

  it('appends a suffix when provided', () => {
    expect(
      auditFor('BankAccount', 'VIEW', { actionSuffix: 'STATEMENT' }).action,
    ).toBe('BANK_ACCOUNT_VIEW_STATEMENT');
  });
});
