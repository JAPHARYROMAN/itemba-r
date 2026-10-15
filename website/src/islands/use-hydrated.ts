import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the server HTML and during hydration, true once the island is
 * live in the browser. Controls that need JavaScript, such as the contact
 * card's company selector, stay disabled until then. Direct contact links
 * remain available in server HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
