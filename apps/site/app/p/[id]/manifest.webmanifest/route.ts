import { getPublicGame } from '@/lib/public-games';

type PublicGameManifestProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: PublicGameManifestProps) {
  const { id } = await params;
  const game = await getPublicGame(id);
  if (!game) return new Response(null, { status: 404 });

  const gameUrl = `/p/${game.id}`;
  const gameName = game.title ?? `Sparkade Game ${game.id.toUpperCase()}`;
  return Response.json(
    {
      id: gameUrl,
      name: `${gameName} · Sparkade`,
      short_name: gameName,
      description: 'A game made with Sparkade.',
      start_url: gameUrl,
      scope: '/',
      display: 'fullscreen',
      background_color: '#070912',
      theme_color: '#070912',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/manifest+json',
      },
    },
  );
}
