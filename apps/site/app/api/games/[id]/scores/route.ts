import { getPublicGame } from '@/lib/public-games';
import { addScore, topScores } from '@/lib/scores';
import { resolveCreditEnvironment } from '@/lib/invites';
import { limitSignupRequests, SignupRateLimitError } from '@/lib/signup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const headers = { 'cache-control': 'no-store' };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const game = await getPublicGame(id);
  if (!game || game.status !== 'ready')
    return Response.json({ error: 'Game not found' }, { status: 404, headers });
  return Response.json(await topScores(game.id), { headers });
}

export async function POST(request: Request, { params }: RouteContext) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  if (Number(request.headers.get('content-length')) > 1024)
    return Response.json({ error: 'Request too large' }, { status: 413, headers });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024)
      return Response.json({ error: 'Request too large' }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid score' }, { status: 400, headers });
  }
  const { initials, score } = (body ?? {}) as { initials?: unknown; score?: unknown };
  if (
    typeof initials !== 'string' ||
    !/^[A-Z0-9.]{3}$/i.test(initials) ||
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 99_999_999
  )
    return Response.json({ error: 'Enter 3 initials and a valid score' }, { status: 400, headers });

  const { id } = await params;
  const game = await getPublicGame(id);
  if (!game || game.status !== 'ready')
    return Response.json({ error: 'Game not found' }, { status: 404, headers });
  try {
    const network = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for') ?? 'anonymous')
      : 'anonymous';
    await limitSignupRequests(network, false, `${resolveCreditEnvironment()}:scores`);
    return Response.json(await addScore(game.id, initials.toUpperCase(), score), { headers });
  } catch (error) {
    if (error instanceof SignupRateLimitError)
      return Response.json(
        { error: 'Too many scores. Try again in a minute.' },
        { status: 429, headers },
      );
    return Response.json({ error: 'Could not save your score' }, { status: 503, headers });
  }
}
