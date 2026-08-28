/**
 * Global test setup — runs once before any test file.
 *
 * - Configures Testing Library cleanup after each test.
 * - Wires jest-axe matchers (`expect(node).toHaveNoViolations()`).
 * - Provides a fetch shim so api-client tests can run without polyfilling per-test.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations as any);

// Testing Library's findBy* default is 1000ms, which is generous on a developer
// machine and tight on a shared CI runner - a component that fetches before it
// renders its label can lose the race and fail on an assertion about text.
//
// Raising it does not weaken anything, because the timeout is not what these
// tests assert. That distinction matters: the companion's process-timing tests
// were tiered rather than scaled precisely because there the clock IS the
// subject, and stretching it would have hidden the behaviour under test. Here
// it is plumbing, so give it room.
configure({ asyncUtilTimeout: process.env.CI ? 5_000 : 1_000 });

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
