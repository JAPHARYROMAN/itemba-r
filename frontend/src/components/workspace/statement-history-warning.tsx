import { formatAccountMoney } from '@/lib/account-consolidation';

export interface StatementSettlementHistory {
  status: 'COMPLETE' | 'INCOMPLETE';
  recoveredLegacySettlements: number;
  unresolvedAmount: string;
  gaps: { documentId: string; reference: string; amount: string; reason: string }[];
}

export function StatementHistoryWarning({
  history,
  currency,
}: {
  history?: StatementSettlementHistory;
  currency: string;
}) {
  if (history?.status !== 'INCOMPLETE') return null;
  return (
    <p className="mt-1 text-xs" role="status" style={{ color: 'var(--aurora-warning)' }}>
      Provisional balance · settlement history incomplete. Unresolved evidence:{' '}
      {formatAccountMoney(history.unresolvedAmount, currency)}.
    </p>
  );
}
