import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getUser: vi.fn(), invited: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
  clerkClient: async () => ({ users: { getUser: mocks.getUser } }),
}));
vi.mock('../lib/invited-emails', async (original) => ({
  ...(await original<typeof import('../lib/invited-emails')>()),
  findInvitedEmails: mocks.invited,
}));

import type { AccessUser } from '../lib/admin-auth';
import { normalizeInvitedEmail, parseInvitedEmails } from '../lib/invited-emails';
import { getSiteAccess, getSiteMember, siteAccessFor } from '../lib/site-access';

type Address = { address: string; verified?: boolean };
function user(addresses: Address[], id = 'user-1'): AccessUser {
  return {
    id,
    createdAt: 1750000000000,
    primaryEmailAddressId: 'email-0',
    fullName: null,
    firstName: null,
    emailAddresses: addresses.map((entry, index) => ({
      id: `email-${index}`,
      emailAddress: entry.address,
      verification: { status: entry.verified === false ? 'unverified' : 'verified' },
    })),
  } as unknown as AccessUser;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('SPARKADE_ADMIN_EMAILS', 'owner@example.test');
  vi.stubEnv('SPARKADE_ADMIN_USER_IDS', '');
  mocks.invited.mockResolvedValue([]);
});

describe('invite list parsing', () => {
  it('lowercases, trims, and de-duplicates addresses in any common separator', () => {
    expect(
      parseInvitedEmails(' Alex@Example.test, sam@example.test;\nalex@example.test\tjo@ex.co '),
    ).toEqual({ emails: ['alex@example.test', 'sam@example.test', 'jo@ex.co'], invalid: [] });
  });
  it.each(['alex', 'alex@', '@example.test', 'alex@example', 'a@b@example.test', '<a@b.test>'])(
    'rejects %s',
    (value) => {
      expect(normalizeInvitedEmail(value)).toBeNull();
      expect(parseInvitedEmails(`ok@example.test ${value}`).invalid).toEqual([value]);
    },
  );
  it('rejects addresses longer than 254 characters', () => {
    expect(normalizeInvitedEmail(`${'a'.repeat(250)}@example.test`)).toBeNull();
  });
});

describe('site access', () => {
  it('admits a verified address on the invite list, case-insensitively', async () => {
    mocks.invited.mockResolvedValue(['guest@example.test']);
    const access = await siteAccessFor(user([{ address: 'Guest@Example.test' }]));
    expect(access).toMatchObject({ status: 'member', userId: 'user-1', emailVerified: true });
    expect(mocks.invited).toHaveBeenCalledWith(['Guest@Example.test']);
  });
  it('admits an account whose invited address is a verified secondary email', async () => {
    mocks.invited.mockResolvedValue(['work@example.test']);
    const access = await siteAccessFor(
      user([
        { address: 'personal@example.test', verified: false },
        { address: 'work@example.test' },
      ]),
    );
    expect(access).toMatchObject({ status: 'member', emailVerified: false });
  });
  it('denies an account that is not invited', async () => {
    expect(await siteAccessFor(user([{ address: 'stranger@example.test' }]))).toEqual({
      status: 'denied',
      userId: 'user-1',
      email: 'stranger@example.test',
      reason: 'not-invited',
    });
  });
  it('denies an invited address until it is verified', async () => {
    mocks.invited.mockResolvedValue(['guest@example.test']);
    expect(
      await siteAccessFor(user([{ address: 'guest@example.test', verified: false }])),
    ).toMatchObject({ status: 'denied', email: 'guest@example.test', reason: 'unverified' });
  });
  it('always admits configured admins without consulting the invite list', async () => {
    const access = await siteAccessFor(user([{ address: 'Owner@example.test' }]));
    expect(access).toMatchObject({ status: 'member', admin: { authorized: true } });
    expect(mocks.invited).not.toHaveBeenCalled();
  });
  it('treats signed-out visitors as signed out without calling Clerk', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect(await getSiteAccess()).toEqual({ status: 'signed-out' });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('gives uninvited sessions no member identity', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user-1' });
    mocks.getUser.mockResolvedValue(user([{ address: 'stranger@example.test' }]));
    expect(await getSiteMember()).toBeNull();
    mocks.invited.mockResolvedValue(['stranger@example.test']);
    expect(await getSiteMember()).toMatchObject({ userId: 'user-1' });
  });
});

describe('session boundary', () => {
  const root = path.resolve(__dirname, '..');
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) return sources(file);
      return /\.(ts|tsx)$/.test(name) ? [file] : [];
    });
  }
  it('resolves website sessions only through the invite-aware access layer', () => {
    const allowed = new Set(['lib/site-access.ts', 'lib/admin-auth.ts']);
    const offenders = ['app', 'lib', 'workflows']
      .flatMap((dir) => sources(path.join(root, dir)))
      .map((file) => path.relative(root, file))
      .filter((file) => !allowed.has(file))
      .filter((file) => {
        const text = readFileSync(path.join(root, file), 'utf8');
        return /import\s*{[^}]*\b(auth|currentUser)\b[^}]*}\s*from\s*'@clerk\/nextjs\/server'/.test(
          text,
        );
      });
    expect(offenders).toEqual([]);
  });
});
