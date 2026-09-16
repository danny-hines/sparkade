import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('../lib/profiles', () => ({ changeUsername: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { changeUsername } from '../lib/profiles';
import { UsernameError } from '../lib/usernames';
import { changeUsernameAction } from '../app/me/actions';

beforeEach(() => vi.resetAllMocks());
function form() {
  const data = new FormData();
  data.set('username', 'moon-racer');
  data.set('userId', 'someone-else');
  return data;
}
function signedIn() {
  vi.mocked(auth).mockResolvedValue({ userId: 'session-owner' } as Awaited<
    ReturnType<typeof auth>
  >);
}
describe('username action authorization', () => {
  it('requires a session before mutating', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as Awaited<ReturnType<typeof auth>>);
    await expect(changeUsernameAction({ error: '' }, form())).rejects.toThrow(
      'REDIRECT:/sign-in?redirect_url=/me/profile',
    );
    expect(changeUsername).not.toHaveBeenCalled();
  });
  it('uses the authenticated owner, refreshes shared UI, and redirects after success', async () => {
    signedIn();
    vi.mocked(changeUsername).mockResolvedValue('moon-racer');
    await expect(changeUsernameAction({ error: '' }, form())).rejects.toThrow(
      'REDIRECT:/me?notice=Username%20updated.',
    );
    expect(changeUsername).toHaveBeenCalledWith('session-owner', 'moon-racer');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });
  it('returns actionable domain errors without claiming success', async () => {
    signedIn();
    vi.mocked(changeUsername).mockRejectedValue(
      new UsernameError('That username is already taken.'),
    );
    expect(await changeUsernameAction({ error: '' }, form())).toEqual({
      username: 'moon-racer',
      error: 'That username is already taken.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('does not leak database errors and rejects missing input', async () => {
    signedIn();
    expect(await changeUsernameAction({ error: '' }, new FormData())).toEqual({
      username: '',
      error: 'Enter a username.',
    });
    expect(changeUsername).not.toHaveBeenCalled();
    vi.mocked(changeUsername).mockRejectedValue(new Error('private connection details'));
    expect(await changeUsernameAction({ error: '' }, form())).toEqual({
      username: 'moon-racer',
      error: 'Could not update your username. Please try again.',
    });
  });
});
