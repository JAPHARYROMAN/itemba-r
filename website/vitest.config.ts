import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next; unit tests that import .tsx
  // modules (the UI kit, the OG card) need JSX compiled here.
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // `server-only` throws outside the react-server condition; unit tests
      // import server modules directly, so resolve it to its no-op build.
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 30_000,
  },
});
