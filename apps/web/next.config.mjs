/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @phillybricks/core ships untranspiled TS via package "exports"; let Next compile it.
  transpilePackages: ['@phillybricks/core'],
  experimental: {
    // core is consumed as source (.ts) across the workspace.
    externalDir: true,
  },
  // @phillybricks/core's TS source uses NodeNext `.js` import specifiers (e.g.
  // `export * from './contracts/index.js'`); teach webpack to resolve those to the
  // real `.ts`/`.tsx` files so runtime VALUE imports (scoreDistress, selectComps)
  // from the workspace package resolve. (Type-only imports are erased and don't need this.)
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
