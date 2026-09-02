import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: [
    '@sparkade/shared',
    '@sparkade/engine',
    '@sparkade/archetypes',
    '@sparkade/web',
  ],
};

export default nextConfig;
