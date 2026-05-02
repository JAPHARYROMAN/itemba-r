const nextVitals = require('eslint-config-next/core-web-vitals');

module.exports = [
  ...nextVitals,
  {
    ignores: [
      'coverage/**',
      'node_modules.corrupt-*/**',
      'scripts/format-baseline.json',
      'tsconfig.tsbuildinfo',
    ],
  },
  {
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
