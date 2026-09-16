import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getAdminIdentity } from '@/lib/admin-auth';

export const adminPageIdentity = cache(getAdminIdentity);

// Layouts persist across client navigation. Every page also checks access before
// reading privileged data; server actions retain their independent auth checks.
export async function getAdminPageIdentity(returnTo: string) {
  const identity = await adminPageIdentity();
  if (!identity) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  return identity.authorized ? identity : null;
}
