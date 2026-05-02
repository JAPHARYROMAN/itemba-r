/**
 * Global test setup — runs once before any test file.
 *
 * - Configures Testing Library cleanup after each test.
 * - Wires jest-axe matchers (`expect(node).toHaveNoViolations()`).
 * - Provides a fetch shim so api-client tests can run without polyfilling per-test.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations as any);

afterEach(() => {
  cleanup();
});

// jsdom doesn't ship a fetch implementation; tests that need it should mock
// per-suite, but we provide a sensible default that fails loudly so missing
// mocks don't silently produce undefined.
if (!globalThis.fetch) {
  globalThis.fetch = (() => {
    throw new Error('fetch was called in tests without being mocked');
  }) as any;
}
