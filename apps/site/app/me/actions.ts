'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ArcadeError } from '@/lib/arcade';
import { changeUsername } from '@/lib/profiles';
import { UsernameError } from '@/lib/usernames';

export async function changeUsernameAction(_previous: { error: string }, form: FormData) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/me/profile');
  const value = form.get('username');
  try {
    if (typeof value !== 'string') throw new UsernameError('Enter a username.');
    await changeUsername(userId, value);
  } catch (error) {
    return {
      username: typeof value === 'string' ? value.slice(0, 24) : '',
      error:
        error instanceof UsernameError || error instanceof ArcadeError
          ? error.message
          : 'Could not update your username. Please try again.',
    };
  }
  revalidatePath('/', 'layout');
  redirect('/me?notice=Username%20updated.');
}
