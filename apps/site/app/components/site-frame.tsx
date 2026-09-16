import { cache, type ReactNode } from 'react';
import { ClerkProvider, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { getAdminIdentity } from '@/lib/admin-auth';
import { ensureProfile } from '@/lib/arcade';
import { ArcadeHeader, ArcadeFooter, type ArcadeNavKey } from './arcade-ui';

export const viewer = cache(async () => {
  const { userId } = await auth();
  if (!userId) return null;
  const [profile, admin] = await Promise.all([ensureProfile(userId), getAdminIdentity()]);
  return { ...profile, admin: Boolean(admin?.authorized) };
});
export async function SiteFrame({
  children,
  active,
}: {
  children: ReactNode;
  active?: ArcadeNavKey;
}) {
  const user = await viewer();
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <ArcadeHeader
        active={active}
        viewer={user ? { ...user, accountMenu: <UserButton /> } : null}
      />
      <main className="arc-shell arc-main">{children}</main>
      <ArcadeFooter />
    </ClerkProvider>
  );
}
