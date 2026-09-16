import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/admin-auth', () => ({
  requireAdminIdentity: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireAdminIdentity } from '../lib/admin-auth';
import * as invitesLib from '../lib/invites';
import { createInviteAction, revokeInviteAction, updateInviteAction } from '../app/admin/invites/actions';

const adminAuth = vi.mocked(requireAdminIdentity);

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function redirectOf(action: Promise<never>): Promise<{ path: string; notice: string; tone: string }> {
  const error = await action.catch((value: unknown) => value);
  if (!(error instanceof Error) || !error.message.startsWith('REDIRECT:')) throw error;
  const url = new URL(error.message.slice('REDIRECT:'.length), 'http://localhost');
  return {
    path: url.pathname,
    notice: url.searchParams.get('notice') ?? '',
    tone: url.searchParams.get('tone') ?? '',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.SPARKADE_INVITE_CODE_SECRET = 'test-only-secret-not-a-real-credential';
  adminAuth.mockResolvedValue({ userId: 'admin-1', email: 'op@example.com', displayName: 'Op', authorized: true });
});

describe('admin invite actions recheck auth on every mutation', () => {
  const cases: Array<
    [string, 'createCreditInvite' | 'revokeCreditInvite' | 'updateCreditInvite', () => Promise<never>]
  > = [
    ['create', 'createCreditInvite', () => createInviteAction(form({ label: 'x', creditsPerRecipient: '30', maxRecipients: '5', expiresInDays: '7' }))],
    ['revoke', 'revokeCreditInvite', () => revokeInviteAction(form({ inviteId: 'inv-1', reason: 'leak' }))],
    ['update', 'updateCreditInvite', () => updateInviteAction(form({ inviteId: 'inv-1', maxRecipients: '9' }))],
  ];
  it.each(cases)('%s refuses unauthenticated callers without touching the domain', async (_name, mutation, run) => {
    adminAuth.mockRejectedValue(new Error('You must sign in to manage Sparkade.'));
    const domainSpy = vi.spyOn(invitesLib, mutation);
    await expect(run()).rejects.toThrow('You must sign in');
    expect(domainSpy).not.toHaveBeenCalled();
  });
});

describe('create invite action', () => {
  it('redirects success (not a failure notice) after creating', async () => {
    const spy = vi.spyOn(invitesLib, 'createCreditInvite').mockResolvedValue({
      invite: { label: 'Wave 1' } as invitesLib.InviteSummary,
      code: 'ABCD-EFGH-JKMN-PQRS',
      signupPath: '/sign-up?invite=x',
    });
    const result = await redirectOf(
      createInviteAction(form({ label: 'Wave 1', creditsPerRecipient: '30', maxRecipients: '20', expiresInDays: '7' })),
    );
    expect(result.path).toBe('/admin/invites');
    expect(result.tone).toBe('success');
    expect(result.notice).toContain('Wave 1');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ creditsPerRecipient: 30, maxRecipients: 20, createdByUserId: 'admin-1' }),
    );
  });

  it('rejects malformed integers instead of coercing them', async () => {
    const spy = vi.spyOn(invitesLib, 'createCreditInvite');
    for (const credits of ['1.5', '20junk', '0', '-3']) {
      const result = await redirectOf(
        createInviteAction(form({ label: 'x', creditsPerRecipient: credits, maxRecipients: '20', expiresInDays: '7' })),
      );
      expect(result.tone).toBe('error');
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('revoke and update actions', () => {
  it('redirects success after revoke and update', async () => {
    vi.spyOn(invitesLib, 'revokeCreditInvite').mockResolvedValue({} as invitesLib.InviteSummary);
    const revoked = await redirectOf(revokeInviteAction(form({ inviteId: 'inv-1', reason: 'leak' })));
    expect(revoked.tone).toBe('success');

    vi.spyOn(invitesLib, 'updateCreditInvite').mockResolvedValue({} as invitesLib.InviteSummary);
    const updated = await redirectOf(
      updateInviteAction(form({ inviteId: 'inv-1', maxRecipients: '30', expiresAt: '2027-01-01T10:00:00.000Z' })),
    );
    expect(updated.tone).toBe('success');
  });

  it('rejects malformed limits and datetimes', async () => {
    const spy = vi.spyOn(invitesLib, 'updateCreditInvite');
    const badLimit = await redirectOf(updateInviteAction(form({ inviteId: 'inv-1', maxRecipients: '2.5' })));
    expect(badLimit.tone).toBe('error');
    const badDate = await redirectOf(updateInviteAction(form({ inviteId: 'inv-1', expiresAt: 'not-a-date' })));
    expect(badDate.tone).toBe('error');
    // Bare datetime-local carries no zone; the server must not guess it.
    const bareDate = await redirectOf(updateInviteAction(form({ inviteId: 'inv-1', expiresAt: '2027-01-01T10:00' })));
    expect(bareDate.tone).toBe('error');
    // A blank submission with no other change is not an update.
    const blank = await redirectOf(updateInviteAction(form({ inviteId: 'inv-1', expiresAt: '' })));
    expect(blank.tone).toBe('error');
    expect(spy).not.toHaveBeenCalled();
  });
});
