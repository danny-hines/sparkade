import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/generation/v1/:path*' }];
  },
  outputFileTracingIncludes: {
    '/*': ['../../packages/generation/prompts/**/*.md', '../../packages/generation/golden/*.json'],
    '/api/generation/v1/*': ['../../node_modules/@ffmpeg-installer/**/*'],
  },
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg'],
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
    '@sparkade/server',
    '@sparkade/generation',
    '@sparkade/engine',
    '@sparkade/archetypes',
    '@sparkade/web',
  ],
};

export default withWorkflow(nextConfig);
