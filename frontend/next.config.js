const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
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
