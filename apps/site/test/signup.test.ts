import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), getUser: vi.fn(), setCookie: vi.fn(), deleteCookie: vi.fn(),
  cookie: 'browser-token', limit: vi.fn(), start: vi.fn(), finish: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
  clerkClient: async () => ({ users: { getUser: mocks.getUser } }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => ({ value: mocks.cookie }), set: mocks.setCookie, delete: mocks.deleteCookie }),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('../lib/signup', async (original) => ({
  ...await original<typeof import('../lib/signup')>(),
  limitSignupRequests: mocks.limit, startSignupAttempt: mocks.start, finishSignup: mocks.finish,
}));

import { safeReturnPath, SignupRateLimitError } from '../lib/signup';
import { getSignupIdentity } from '../lib/signup-auth';
import { completeSignupAction, startSignupAction } from '../app/sign-up/actions';
import { InviteExpiredError } from '../lib/invites';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  Object.entries(entries).forEach(([key, value]) => data.set(key, value));
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'trusted-user' });
  mocks.getUser.mockResolvedValue({
    createdAt: 1750000000000, primaryEmailAddressId: 'primary',
    emailAddresses: [{ id: 'primary', verification: { status: 'verified' } }],
    unsafeMetadata: { emailVerified: false, credits: 9999 },
  });
  mocks.finish.mockResolvedValue({ status: 'credited', balance: 30, creditsAdded: 30, returnPath: '/me' });
});

describe('auth destinations', () => {
  it.each(['/me', '/create', '/play?sort=recent', '/admin/invites'])('preserves %s', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/admin/../sign-out', '/me%2f..', '/me\n', '/api/delete', '/sign-in', '/sign-up/complete', '/meevil', '/me//evil'])('rejects unsafe destination %s', (path) => {
    expect(safeReturnPath(path)).toBe('/me');
  });
});

describe('signup auth boundary', () => {
  it('uses only the primary email verification from the Clerk backend', async () => {
    mocks.getUser.mockResolvedValue({ createdAt: 123, primaryEmailAddressId: 'primary', emailAddresses: [
      { id: 'secondary', verification: { status: 'verified' } },
      { id: 'primary', verification: { status: 'unverified' } },
    ], unsafeMetadata: { emailVerified: true } });
    expect(await getSignupIdentity()).toEqual({ userId: 'trusted-user', createdAt: 123, emailVerified: false });
  });
  it('denies signed-out finalization before database access', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await completeSignupAction({ error: null }, form({}))).error).toContain('Sign in');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it('ignores forged identity, eligibility, amount, and signup state fields', async () => {
    await completeSignupAction({ error: null }, form({ userId: 'victim', isNewAccount: 'true', emailVerified: 'true', createdAt: '0', amount: '9999', signupAttemptId: 'forged' }));
    expect(mocks.finish).toHaveBeenCalledWith({ userId: 'trusted-user', createdAt: 1750000000000, emailVerified: true }, 'browser-token', { kind: 'redeem' });
    expect(mocks.deleteCookie).toHaveBeenCalledWith('sparkade_signup');
  });
  it('limits authenticated attempts before calling the Clerk backend', async () => {
    mocks.limit.mockRejectedValue(new SignupRateLimitError('Wait a minute.'));
    expect((await completeSignupAction({ error: null }, form({}))).error).toBe('Wait a minute.');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });
  it('preserves the cookie and reports an expired offer rather than false success', async () => {
    mocks.finish.mockRejectedValue(new InviteExpiredError('This invite has expired.'));
    expect(await completeSignupAction({ error: null }, form({}))).toEqual({ error: 'This invite has expired.' });
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });
  it('keeps unexpected database errors private and recoverable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.finish.mockRejectedValue(new Error('postgres://secret-credential raw-invite'));
    const result = await completeSignupAction({ error: null }, form({}));
    expect(result.error).toContain('try again');
    expect(result.error).not.toContain('secret');
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    log.mockRestore();
  });
  it('persists an opaque HttpOnly cookie before redirecting to a clean signup URL', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.start.mockResolvedValue('opaque-token');
    await expect(startSignupAction({ error: null }, form({ invite: 'the-code', returnPath: '/create' }))).rejects.toThrow('REDIRECT:/sign-up');
    expect(mocks.start).toHaveBeenCalledWith('the-code', '/create');
    expect(mocks.setCookie).toHaveBeenCalledWith('sparkade_signup', 'opaque-token', expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 604800, path: '/' }));
  });
  it('refuses to start another signup while authenticated', async () => {
    await expect(startSignupAction({ error: null }, form({ invite: 'the-code' }))).rejects.toThrow('REDIRECT:/sign-up/complete');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('explicit no-invite signup discards the entered code', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.start.mockResolvedValue('opaque-token');
    await expect(startSignupAction({ error: null }, form({ invite: 'invalid', intent: 'zero' }))).rejects.toThrow('REDIRECT:/sign-up');
    expect(mocks.start).toHaveBeenCalledWith('', '');
  });
});
