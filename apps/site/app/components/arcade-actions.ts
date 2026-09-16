'use server';
import { start } from 'workflow/api';
import { generateGameWorkflow } from '@/workflows/generate-game';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ArcadeError, ActiveGameError, manageGame, setFavorite } from '@/lib/arcade';
import {
  createWebsiteGame,
  cancelWebsiteGame,
  retryWebsiteGame,
  resumeAdminWebsiteGame,
} from '@/lib/website-generation';
import { getAdminIdentity, requireAdminIdentity } from '@/lib/admin-auth';
import type { ActiveWebsiteGame } from '@/lib/website-creation-policy';
import { getSignupIdentity } from '@/lib/signup-auth';

export async function favoriteAction(_previous: { error: string }, form: FormData) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/play');
  try {
    await setFavorite(userId, String(form.get('id')), form.get('wanted') === 'true');
    revalidatePath('/', 'layout');
    return { error: '' };
  } catch (error) {
    return {
      error:
        error instanceof ArcadeError
          ? error.message
          : 'Could not save that game. Please try again.',
    };
  }
}
export async function manageGameAction(form: FormData) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/me');
  let message = 'Game updated.';
  try {
    await manageGame(userId, String(form.get('id')), String(form.get('action')));
  } catch (error) {
    message = error instanceof ArcadeError ? error.message : 'Could not update your game.';
  }
  revalidatePath('/', 'layout');
  redirect(`/me?notice=${encodeURIComponent(message)}`);
}
export interface CreateGameState {
  error: string;
  activeGames?: ActiveWebsiteGame[];
}
export async function createGameAction(
  _previous: CreateGameState,
  form: FormData,
): Promise<CreateGameState> {
  const identity = await getSignupIdentity();
  if (!identity) redirect('/sign-in?redirect_url=/create');
  if (!identity.emailVerified) return { error: 'Verify your email before creating a game.' };
  let id: string;
  let notice = '';
  try {
    const admin = await getAdminIdentity();
    id = await createWebsiteGame(
      identity.userId,
      String(form.get('prompt') ?? ''),
      String(form.get('archetype')),
      String(form.get('key')),
      String(form.get('heroName') ?? ''),
      form.get('photo'),
      admin,
    );
    if (admin?.authorized && admin.userId === identity.userId) {
      try {
        const row = await resumeAdminWebsiteGame(admin, id);
        if (row) await start(generateGameWorkflow, [row.id, row.attempt]);
      } catch {
        notice =
          'Your game is saved. Generation has not started; use Start generation to try again.';
      }
    }
  } catch (error) {
    return {
      ...(error instanceof ActiveGameError ? { activeGames: error.games } : {}),
      error:
        error instanceof ArcadeError
          ? error.message
          : 'Could not submit your game. Please try again.',
    };
  }
  revalidatePath('/', 'layout');
  redirect(`/me/games/${id}${notice ? `?notice=${encodeURIComponent(notice)}` : ''}`);
}
export async function cancelGameAction(form: FormData) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/me');
  await cancelWebsiteGame(userId, String(form.get('jobId')));
  revalidatePath('/', 'layout');
  redirect('/me');
}

export async function retryGameAction(form: FormData) {
  const identity = await getSignupIdentity();
  if (!identity?.emailVerified) redirect('/sign-in?redirect_url=/me');
  let notice = 'Retry queued.';
  try {
    const row = await retryWebsiteGame(identity.userId, String(form.get('jobId')));
    await start(generateGameWorkflow, [row.id, row.attempt]);
  } catch (error) {
    notice =
      error instanceof ArcadeError ? error.message : 'Retry saved; dispatch may still be pending.';
  }
  revalidatePath('/', 'layout');
  redirect(`/me?notice=${encodeURIComponent(notice)}`);
}

export async function startAdminGameAction(form: FormData) {
  const admin = await requireAdminIdentity();
  const id = String(form.get('id'));
  let notice = 'Generation queued.';
  try {
    const row = await resumeAdminWebsiteGame(admin, id);
    if (row) await start(generateGameWorkflow, [row.id, row.attempt]);
    else notice = 'This game has already started or is no longer eligible to start.';
  } catch (error) {
    notice =
      error instanceof ArcadeError
        ? error.message
        : 'Generation could not start. Please try again.';
  }
  revalidatePath('/', 'layout');
  redirect(`/me/games/${encodeURIComponent(id)}?notice=${encodeURIComponent(notice)}`);
}
