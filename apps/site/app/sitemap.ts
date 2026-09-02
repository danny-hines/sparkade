import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://sparkade.dev',
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: 'https://sparkade.dev/play',
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ];
}
