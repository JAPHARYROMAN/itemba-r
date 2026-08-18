'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ScopeValue } from '@/components/ui';

export interface InventoryWorkspaceContextValue {
  scope: ScopeValue;
  searchQuery: string;
  embedded: boolean;
}

const InventoryWorkspaceContext = createContext<InventoryWorkspaceContextValue | null>(null);

export function InventoryWorkspaceProvider({
  scope,
  searchQuery,
  children,
}: {
  scope: ScopeValue;
  searchQuery: string;
  children: ReactNode;
}) {
  return (
    <InventoryWorkspaceContext.Provider value={{ scope, searchQuery, embedded: true }}>
      {children}
    </InventoryWorkspaceContext.Provider>
  );
}

/**
 * Inventory views use this when mounted by the consolidated workspace. Legacy
 * routes intentionally receive null so they retain their standalone behavior.
 */
export function useInventoryWorkspace() {
  return useContext(InventoryWorkspaceContext);
}
