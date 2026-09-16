import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Isolated builds keep browser verification from touching a running dev server.
  distDir: process.env.SPARKADE_SITE_DIST_DIR || '.next',
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/generation/v1/:path*' }];
  },
  outputFileTracingIncludes: {
    '/*': ['../../packages/generation/prompts/**/*.md', '../../packages/generation/golden/*.json'],
    '/api/generation/v1/*': ['../../node_modules/@ffmpeg-installer/**/*'],
  },
  // Next removes its build lock before Vercel packages the traced functions.
  // It is a build-only file and must never be copied into a runtime bundle.
  outputFileTracingExcludes: {
    '/*': [`./${process.env.SPARKADE_SITE_DIST_DIR || '.next'}/lock`],
  },
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@vercel/blob'],
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
