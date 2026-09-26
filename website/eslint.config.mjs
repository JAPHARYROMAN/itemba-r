// ESLint flat config. `next lint` is deprecated in Next 15.5, so lint runs as
// `eslint .`. eslint-config-next 15 ships eslintrc-style presets, bridged here
// with FlatCompat; jsx-a11y (already registered by the Next preset) and the
// Tailwind 3 plugin add their recommended rules on top.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tailwind from 'eslint-plugin-tailwindcss';

const root = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: root });

// Byte-for-byte frozen files (see tests/frozen-files.json once it lands):
// they are linted for information but can never be edited to satisfy a rule.
const FROZEN = [
  'src/app/api/enquiries/route.ts',
  'src/app/api/health/route.ts',
  'src/lib/analytics.ts',
  'src/components/Analytics.tsx',
  'src/components/ConversionTracker.tsx',
  'src/components/JsonLd.tsx',
  'src/components/CompanyProfilePrintScope.tsx',
  'scripts/generate-profile-pdfs.mjs',
];

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'images/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      'coverage/**',
      'tests/baseline/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  ...tailwind.configs['flat/recommended'],
  {
    settings: {
      tailwindcss: {
        config: path.join(root, 'tailwind.config.ts'),
        callees: ['cn', 'clsx', 'cva'],
      },
    },
    rules: {
      // Class order and h-x/w-x → size-x shorthands are cosmetic; keep the
      // signal for real problems.
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      // Undefined utility classes (e.g. a colour step that does not exist)
      // are the bug this plugin is here to catch. Warn while the legacy
      // pages still use the retired palette and the legacy classes in
      // src/styles/utilities.css (both deleted in WP3.1).
      'tailwindcss/no-custom-classname': 'warn',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{mjs,ts}', 'tests/**/*.{ts,mjs}'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    files: FROZEN,
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
];

export default config;
