'use client';

import { useAuth } from './use-auth';
import { useWorkspaceResource } from './use-workspace-resource';

export interface PartyCreditBalance {
  partyId: string;
  companyId: string;
  baseCurrency: string;
  creditLimit: string;
  creditAvailable: string | null;
  total: { currency: string; amount: string }[];
}

/** Credit limits and exposure keep their company denomination regardless of document currency. */
export function usePartyCredit(
  kind: 'customer' | 'supplier',
  partyId?: string | null,
  companyId?: string,
) {
  const { hasPermission } = useAuth();
  const result = useWorkspaceResource<PartyCreditBalance>(
    `/party-balance/${kind}s/${encodeURIComponent(partyId ?? '')}`,
    {},
    Boolean(partyId && companyId && hasPermission(`${kind}s.view`)),
  );
  return {
    ...result,
    data: result.data?.companyId === companyId ? result.data : null,
  };
}
