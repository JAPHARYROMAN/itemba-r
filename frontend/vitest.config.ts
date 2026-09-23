import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Frontend test runner.
 *
 * Run with:
 *   npm run test       — once
 *   npm run test:watch — watch mode
 *   npm run test:ui    — vitest UI
 *
 * Setup files configure Testing Library + jest-axe matchers globally.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The suite is written against the ITEMBA OS shell. The switched-off shell
    // has its own tests that stub this back (itemba-os-flag.test.tsx).
    env: { NEXT_PUBLIC_ITEMBA_OS_ENABLED: 'true' },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
      ],
    },
  },
});
