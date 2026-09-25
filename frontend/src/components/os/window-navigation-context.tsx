'use client';
import { createContext, useContext, type ReactNode } from 'react';

const WindowNavigationContext = createContext<HTMLElement | null>(null);
export function WindowNavigationProvider({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <WindowNavigationContext.Provider value={target}>{children}</WindowNavigationContext.Provider>
  );
}
export const useWindowNavigationTarget = () => useContext(WindowNavigationContext);
