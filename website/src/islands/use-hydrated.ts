import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the server HTML and during hydration, true once the island is
 * live in the browser. Controls that only work with JavaScript (the enquiry
 * form's submit button) stay disabled until then, so a visitor without
 * JavaScript can never submit the form natively.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
