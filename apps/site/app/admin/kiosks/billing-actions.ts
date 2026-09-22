'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireKioskBillingAdmin } from '@/lib/kiosk-billing-access';
import { KioskBillingError } from '@/lib/kiosk-meta-secret';
import { setMetaKeyLimits } from '@/lib/kiosk-meta-spend';
import {
  assignKioskMetaCredential,
  clearKioskMetaCredential,
  disableKioskMetaCredential,
  saveKioskMetaCredential,
} from '@/lib/kiosk-meta-credentials';

function field(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value !== 'string') throw new KioskBillingError('Complete the required fields.');
  return value;
}

async function mutate(
  work: (actorUserId: string) => Promise<void>,
  success: string,
): Promise<never> {
  const admin = await requireKioskBillingAdmin();
  let message = success;
  let tone = 'success';
  try {
    await work(admin.userId);
    revalidatePath('/admin/kiosks');
  } catch (error) {
    // Never log submitted secrets, database errors, or arbitrary exception text.
    message =
      error instanceof KioskBillingError
        ? error.message
        : 'Could not update kiosk billing. Try again.';
    tone = 'error';
  }
  redirect(`/admin/kiosks?${new URLSearchParams({ notice: message, tone })}`);
}

export async function saveMetaCredentialAction(data: FormData): Promise<never> {
  return mutate(
    (actorUserId) =>
      saveKioskMetaCredential({
        actorUserId,
        credentialId: field(data, 'credentialId') || undefined,
        label: field(data, 'label'),
        apiKey: field(data, 'apiKey'),
      }),
    'Meta credential saved. Assign it to the kiosks that should use it. Replacing a key also updates kiosks and jobs already using this credential.',
  );
}

export async function assignMetaCredentialAction(data: FormData): Promise<never> {
  return mutate(
    (actorUserId) =>
      assignKioskMetaCredential(actorUserId, field(data, 'kioskId'), field(data, 'credentialId')),
    'Meta credential assigned. New cloud jobs and voice requests use it immediately; existing jobs keep their assignment.',
  );
}

export async function useSharedMetaCredentialAction(data: FormData): Promise<never> {
  return mutate(
    (actorUserId) => clearKioskMetaCredential(actorUserId, field(data, 'kioskId')),
    'Shared Meta billing enabled for new cloud jobs and voice requests. Existing jobs keep their assignment.',
  );
}

export async function disableMetaCredentialAction(data: FormData): Promise<never> {
  return mutate(
    (actorUserId) => disableKioskMetaCredential(actorUserId, field(data, 'credentialId')),
    'Meta credential disabled. Its assigned kiosks and unfinished jobs cannot use it and will not fall back to shared billing.',
  );
}

export async function setMetaLimitsAction(data: FormData): Promise<never> {
  return mutate(
    (actorUserId) =>
      setMetaKeyLimits(actorUserId, field(data, 'keyId'), {
        dailyUsd: field(data, 'dailyUsd'),
        weeklyUsd: field(data, 'weeklyUsd'),
        concurrency: field(data, 'concurrency'),
      }),
    'Meta key limits saved. They apply across all requests using this key. Paused jobs will retry automatically.',
  );
}
