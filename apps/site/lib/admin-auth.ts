import { auth, clerkClient, type User } from '@clerk/nextjs/server';

export interface AdminIdentity {
  userId: string;
  email: string;
  displayName: string;
  authorized: boolean;
  reason?: string;
}

/** The Clerk fields admin and site-access checks read. */
export type AccessUser = Pick<
  User,
  'id' | 'createdAt' | 'primaryEmailAddressId' | 'emailAddresses' | 'fullName' | 'firstName'
>;

function configuredValues(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function adminIdentityFor(user: AccessUser): AdminIdentity {
  const userId = user.id;
  const primaryEmail =
    user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    '';
  const normalizedEmail = primaryEmail.toLowerCase();
  const allowedEmails = configuredValues('SPARKADE_ADMIN_EMAILS');
  const allowedUserIds = configuredValues('SPARKADE_ADMIN_USER_IDS');
  const configured = allowedEmails.size > 0 || allowedUserIds.size > 0;
  const authorized =
    configured && (allowedEmails.has(normalizedEmail) || allowedUserIds.has(userId.toLowerCase()));
  return {
    userId,
    email: primaryEmail,
    displayName: user.fullName || user.firstName || primaryEmail || 'Sparkade admin',
    authorized,
    ...(!configured
      ? { reason: 'Admin access has not been configured for this deployment.' }
      : !authorized
        ? { reason: 'This account is not on the Sparkade admin allowlist.' }
        : {}),
  };
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  return adminIdentityFor(await client.users.getUser(userId));
}

export async function requireAdminIdentity(): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (!identity) throw new Error('You must sign in to manage Sparkade.');
  if (!identity.authorized) throw new Error(identity.reason ?? 'Admin access denied.');
  return identity;
}
