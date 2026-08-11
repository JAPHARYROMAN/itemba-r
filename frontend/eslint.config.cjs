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
      // Simplification plan phase 4: failures must be visible. A swallowed
      // rejection renders a false empty state or fakes a successful save —
      // surface it (toast/ErrorState) or at minimum log it deliberately.
      // Warn (not error) while the ~200 legacy sites are burned down; do not
      // add new ones.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0] > BlockStatement[body.length=0]",
          message:
            'Swallowed rejection: surface the failure to the user (showToast/ErrorState) instead of an empty .catch(() => {}).',
        },
        {
          selector: 'CatchClause > BlockStatement[body.length=0]',
          message:
            'Empty catch block: surface the failure to the user (showToast/ErrorState) or comment why ignoring is safe.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'][arguments.0.type='MemberExpression'][arguments.0.object.name='console']",
          message:
            'Console-only rejection handler: the user sees a false empty state. Surface the failure (showToast/ErrorState) as well.',
        },
      ],
    },
  },
];
