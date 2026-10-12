import { cache } from 'react';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { adminIdentityFor, type AccessUser, type AdminIdentity } from './admin-auth';
import { findInvitedEmails } from './invited-emails';

export const INVITE_ONLY_PATH = '/invite-only';

export interface SiteMember {
  userId: string;
  email: string;
  createdAt: number;
  /** Primary-address verification as reported by Clerk's backend. */
  emailVerified: boolean;
  admin: AdminIdentity;
}

export type SiteAccess =
  | { status: 'signed-out' }
  | { status: 'denied'; userId: string; email: string; reason: 'not-invited' | 'unverified' }
  | ({ status: 'member' } & SiteMember);

/** Admins, or accounts holding a verified address that is on the invite list. */
export async function siteAccessFor(user: AccessUser): Promise<SiteAccess> {
  const admin = adminIdentityFor(user);
  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
  const email = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '';
  if (!admin.authorized) {
    const invited = new Set(
      await findInvitedEmails(user.emailAddresses.map((entry) => entry.emailAddress)),
    );
    const matches = user.emailAddresses.filter((entry) =>
      invited.has(entry.emailAddress.toLowerCase()),
    );
    if (!matches.some((entry) => entry.verification?.status === 'verified'))
      return matches.length
        ? {
            status: 'denied',
            userId: user.id,
            email: matches[0].emailAddress,
            reason: 'unverified',
          }
        : { status: 'denied', userId: user.id, email, reason: 'not-invited' };
  }
  return {
    status: 'member',
    userId: user.id,
    email,
    createdAt: user.createdAt,
    emailVerified: primary?.verification?.status === 'verified',
    admin,
  };
}

/**
 * Every website session check goes through here, so an account that is not
 * invited is treated as signed out everywhere. Invite-list changes apply on the
 * person's next request.
 */
export const getSiteAccess = cache(async (): Promise<SiteAccess> => {
  const { userId } = await auth();
  if (!userId) return { status: 'signed-out' };
  const client = await clerkClient();
  return siteAccessFor(await client.users.getUser(userId));
});

export async function getSiteMember(): Promise<SiteMember | null> {
  const access = await getSiteAccess();
  return access.status === 'member' ? access : null;
}

/** Clerk session only, for rate-limit keys and redirects. Never an access decision. */
export async function getSessionUserId(): Promise<string | null> {
  return (await auth()).userId;
}
