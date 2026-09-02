import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/p/',
    },
    sitemap: 'https://sparkade.dev/sitemap.xml',
  };
}
