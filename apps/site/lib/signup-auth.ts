import { getSiteMember } from './site-access';
import type { SignupIdentity } from './signup';

/** Never accept these fields from form data or Clerk unsafeMetadata. */
export async function getSignupIdentity(): Promise<SignupIdentity | null> {
  const member = await getSiteMember();
  if (!member) return null;
  return { userId: member.userId, createdAt: member.createdAt, emailVerified: member.emailVerified };
}
