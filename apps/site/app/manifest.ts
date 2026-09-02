import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sparkade',
    short_name: 'Sparkade',
    description: 'Your idea. Your arcade.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070912',
    theme_color: '#070912',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
