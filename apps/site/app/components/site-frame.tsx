import { cache, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { ensureProfile } from '@/lib/arcade';
import { getSiteAccess, INVITE_ONLY_PATH } from '@/lib/site-access';
import { ArcadeHeader, ArcadeFooter, type ArcadeNavKey } from './arcade-ui';

export const viewer = cache(async () => {
  const access = await getSiteAccess();
  if (access.status === 'signed-out') return null;
  // Uninvited sessions see only the invite-only page until they sign out.
  if (access.status === 'denied') redirect(INVITE_ONLY_PATH);
  const profile = await ensureProfile(access.userId);
  return { ...profile, admin: access.admin.authorized };
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
    <>
      <ArcadeHeader
        active={active}
        viewer={user ? { ...user, accountMenu: <UserButton /> } : null}
      />
      <main className="arc-shell arc-main">{children}</main>
      <ArcadeFooter />
    </>
  );
}
