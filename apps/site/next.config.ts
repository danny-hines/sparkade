import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
        pathname: '/public-games/**',
      },
    ],
  },
  transpilePackages: [
    '@sparkade/shared',
    '@sparkade/engine',
    '@sparkade/archetypes',
    '@sparkade/web',
  ],
};

export default nextConfig;
