import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pnpm-workspace monorepo: trace server files from the repo ROOT so Next bundles
  // the real (de-symlinked) hoisted deps into the standalone output (Vercel's native
  // monorepo build uses this; required so server file tracing resolves the .pnpm store).
  outputFileTracingRoot: join(__dirname, '..', '..'),
  // @bandbox/core ships untranspiled TS via package "exports"; let Next compile it.
  transpilePackages: ['@bandbox/core'],
  experimental: {
    // core is consumed as source (.ts) across the workspace.
    externalDir: true,
  },
  // @bandbox/core's TS source uses NodeNext `.js` import specifiers (e.g.
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
