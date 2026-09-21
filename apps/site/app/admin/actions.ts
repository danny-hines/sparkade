'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseKioskDisplayCopy } from '@sparkade/shared';
import { requireAdminIdentity } from '@/lib/admin-auth';
import {
  claimKioskPairing,
  isFeedVisibility,
  PairingCodeError,
  revokeManagedKiosk,
  updateManagedKiosk,
} from '@/lib/kiosks';
import { setPublicGameFeedVisibility } from '@/lib/public-games';

function adminRedirect(
  path: '/admin/kiosks' | '/admin/games',
  message: string,
  tone: 'success' | 'error' = 'success',
): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`${path}?${params.toString()}`);
}

function shortId(value: FormDataEntryValue | null): string | null {
  const id = String(value ?? '').trim();
  return id && id.length <= 80 ? id : null;
}

export async function pairKioskAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  let message = 'Kiosk paired.';
  let tone: 'success' | 'error' = 'success';
  try {
    const visibility = String(formData.get('defaultFeedVisibility') ?? 'unlisted');
    if (!isFeedVisibility(visibility)) throw new PairingCodeError('Choose a feed visibility.');
    const kiosk = await claimKioskPairing({
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      ownerUserId: admin.userId,
      defaultFeedVisibility: visibility,
    });
    message = `${kiosk.name} is paired and ready.`;
    revalidatePath('/admin/kiosks');
  } catch (error) {
    tone = 'error';
    message = error instanceof PairingCodeError ? error.message : 'Could not pair that kiosk.';
  }
  adminRedirect('/admin/kiosks', message, tone);
}

export async function renameKioskAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  const kioskId = shortId(formData.get('kioskId'));
  const name = String(formData.get('name') ?? '');
  const updated =
    kioskId !== null && (await updateManagedKiosk({ kioskId, ownerUserId: admin.userId, name }));
  if (updated) {
    revalidatePath('/admin/kiosks');
    revalidatePath('/admin/games');
    revalidatePath('/play');
  }
  adminRedirect(
    '/admin/kiosks',
    updated ? 'Kiosk renamed.' : 'Could not rename that kiosk.',
    updated ? 'success' : 'error',
  );
}

export async function setKioskVisibilityAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  const kioskId = shortId(formData.get('kioskId'));
  const visibility = String(formData.get('defaultFeedVisibility') ?? '');
  const updated =
    kioskId !== null &&
    isFeedVisibility(visibility) &&
    (await updateManagedKiosk({
      kioskId,
      ownerUserId: admin.userId,
      defaultFeedVisibility: visibility,
    }));
  revalidatePath('/admin/kiosks');
  adminRedirect(
    '/admin/kiosks',
    updated ? `New games will be ${visibility}.` : 'Could not update kiosk visibility.',
    updated ? 'success' : 'error',
  );
}

export async function setKioskDisplayCopyAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  const kioskId = shortId(formData.get('kioskId'));
  const displayCopy = parseKioskDisplayCopy({
    title: formData.get('title'),
    tagline: formData.get('tagline'),
  });
  const updated =
    kioskId !== null &&
    displayCopy !== null &&
    (await updateManagedKiosk({
      kioskId,
      ownerUserId: admin.userId,
      displayCopy,
    }));
  if (updated) revalidatePath('/admin/kiosks');
  adminRedirect(
    '/admin/kiosks',
    updated
      ? 'Kiosk copy saved. It will appear within a minute while the kiosk is online.'
      : 'Could not save kiosk copy. Use up to 40 characters for the title and 120 for the tagline.',
    updated ? 'success' : 'error',
  );
}

export async function revokeKioskAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  const kioskId = shortId(formData.get('kioskId'));
  const revoked = kioskId !== null && (await revokeManagedKiosk(kioskId, admin.userId));
  revalidatePath('/admin/kiosks');
  adminRedirect(
    '/admin/kiosks',
    revoked ? 'Kiosk access revoked.' : 'Could not revoke that kiosk.',
    revoked ? 'success' : 'error',
  );
}

export async function setGameVisibilityAction(formData: FormData): Promise<never> {
  await requireAdminIdentity();
  const gameId = shortId(formData.get('gameId'));
  const visibility = String(formData.get('feedVisibility') ?? '');
  const updated =
    gameId !== null &&
    isFeedVisibility(visibility) &&
    (await setPublicGameFeedVisibility(gameId, visibility));
  revalidatePath('/admin/games');
  revalidatePath('/play');
  if (gameId) revalidatePath(`/p/${gameId}`);
  adminRedirect(
    '/admin/games',
    updated
      ? visibility === 'listed'
        ? 'Game added to the public feed.'
        : 'Game removed from the public feed.'
      : 'Could not update that game.',
    updated ? 'success' : 'error',
  );
}
