import { auth, clerkClient } from '@clerk/nextjs/server';
import type { SignupIdentity } from './signup';

/** Never accept these fields from form data or Clerk unsafeMetadata. */
export async function getSignupIdentity(): Promise<SignupIdentity | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  return { userId, createdAt: user.createdAt, emailVerified: primary?.verification?.status === 'verified' };
}
