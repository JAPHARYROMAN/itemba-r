const path = require('path');
const { execSync } = require('child_process');
const { version } = require('./package.json');

/**
 * The build's short commit: APP_BUILD_SHA from the production deploy (the
 * Docker build has no .git), Vercel's own variable, or local git. Empty when
 * none is available; never fails the build.
 */
function buildRevision() {
  const given = process.env.APP_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (given) return given.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// Shown in the POS settings ("Toleo la programu"), so a support call can say
// exactly which build a till is running. An explicit value still wins.
const revision = buildRevision();
const appVersion =
  process.env.NEXT_PUBLIC_APP_VERSION || (revision ? `${version} (${revision})` : version);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  async redirects() {
    return [
      { source: '/operations/inventory', destination: '/inventory?tab=overview&view=overview', permanent: false },
      { source: '/operations/inventory-balances', destination: '/inventory?tab=stock&view=balances', permanent: false },
      { source: '/operations/inventory-movements', destination: '/inventory?tab=stock&view=movements', permanent: false },
      { source: '/operations/stock-adjustments', destination: '/inventory?tab=controls&view=adjustments', permanent: false },
      { source: '/operations/products', destination: '/inventory?tab=catalog&view=products', permanent: false },
      { source: '/operations/products/:id', destination: '/inventory/products/:id', permanent: false },
      { source: '/operations/product-categories', destination: '/inventory?tab=catalog&view=categories', permanent: false },
      { source: '/operations/units', destination: '/inventory?tab=catalog&view=units', permanent: false },
      { source: '/westsides/inventory/live', destination: '/inventory?tab=stock&view=live', permanent: false },
      { source: '/westsides/product-batches', destination: '/inventory?tab=stock&view=batches', permanent: false },
      { source: '/westsides/stock-damage', destination: '/inventory?tab=controls&view=damage', permanent: false },
    ];
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

module.exports = nextConfig;
