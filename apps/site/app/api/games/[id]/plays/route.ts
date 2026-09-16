import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { startPlay, finishPlay } from '@/lib/plays';
import { limitSignupRequests } from '@/lib/signup';
import { env } from '@/lib/arcade';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const { id } = await params;
  if (Number(request.headers.get('content-length')) > 1024)
    return new Response(null, { status: 413 });
  const { userId } = await auth(),
    jar = await cookies();
  let anon = jar.get('sparkade_player')?.value;
  if (!anon || !/^[-a-f0-9]{36}$/.test(anon)) {
    anon = randomUUID();
    jar.set('sparkade_player', anon, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 86400 * 365,
    });
  }
  const viewer = userId ? `user:${userId}` : `guest:${anon}`;
  try {
    const network = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for') ?? 'anonymous')
      : 'anonymous';
    await limitSignupRequests(network, false, `${env()}:plays`);
    const body = await request.json();
    if (body.ticket) {
      if (typeof body.ticket !== 'string' || body.ticket.length > 64)
        return new Response(null, { status: 400 });
      return Response.json(
        { counted: await finishPlay(id, viewer, body.ticket, userId) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return Response.json(
      { ticket: (await startPlay(id, viewer, userId)) ?? null },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'Could not record this play' }, { status: 429 });
  }
}
