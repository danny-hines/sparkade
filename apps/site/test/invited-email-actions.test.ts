import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/admin-auth', () => ({ requireAdminIdentity: vi.fn() }));
vi.mock('../lib/invited-emails', async (original) => ({
  ...(await original<typeof import('../lib/invited-emails')>()),
  addInvitedEmails: vi.fn(),
  removeInvitedEmail: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { revalidatePath } from 'next/cache';
import { requireAdminIdentity } from '../lib/admin-auth';
import { addInvitedEmails, removeInvitedEmail } from '../lib/invited-emails';
import { inviteEmailsAction, removeInvitedEmailAction } from '../app/admin/accounts/actions';

const empty = { error: '', notice: '', draft: '' };
function form(entries: Record<string, string>) {
  const data = new FormData();
  Object.entries(entries).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdminIdentity).mockResolvedValue({
    userId: 'admin-1',
    email: 'owner@example.test',
    displayName: 'Owner',
    authorized: true,
  });
});

describe('invite email actions', () => {
  it.each([
    ['invite', () => inviteEmailsAction(empty, form({ emails: 'guest@example.test' }))],
    ['remove', () => removeInvitedEmailAction(form({ email: 'guest@example.test' }))],
  ])('%s refuses non-admins before touching the list', async (_name, run) => {
    vi.mocked(requireAdminIdentity).mockRejectedValue(new Error('Admin access denied.'));
    await expect(run()).rejects.toThrow('Admin access denied.');
    expect(addInvitedEmails).not.toHaveBeenCalled();
    expect(removeInvitedEmail).not.toHaveBeenCalled();
  });

  it('adds nothing when any entry is invalid, and keeps the draft', async () => {
    const draft = 'guest@example.test, not-an-email';
    expect(await inviteEmailsAction(empty, form({ emails: draft }))).toEqual({
      error: 'Not valid email addresses: not-an-email. Nothing was added.',
      notice: '',
      draft,
    });
    expect(addInvitedEmails).not.toHaveBeenCalled();
  });

  it('invites normalized addresses as the verified admin and reports duplicates', async () => {
    vi.mocked(addInvitedEmails).mockResolvedValue(['sam@example.test']);
    const result = await inviteEmailsAction(
      empty,
      form({ emails: 'Guest@Example.test\nsam@example.test', invitedByUserId: 'forged' }),
    );
    expect(addInvitedEmails).toHaveBeenCalledWith(
      ['guest@example.test', 'sam@example.test'],
      'admin-1',
    );
    expect(result).toEqual({
      error: '',
      notice: 'Invited 1 address. 1 already on the list.',
      draft: '',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
  });

  it('removes a normalized address and refreshes every signed-in page', async () => {
    vi.mocked(removeInvitedEmail).mockResolvedValue(true);
    await expect(removeInvitedEmailAction(form({ email: ' Guest@Example.test ' }))).rejects.toThrow(
      'REDIRECT:/admin/accounts?notice=Invite+removed.',
    );
    expect(removeInvitedEmail).toHaveBeenCalledWith('guest@example.test', 'admin-1');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });
});
