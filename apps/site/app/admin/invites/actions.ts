'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminIdentity } from '@/lib/admin-auth';
import {
  createCreditInvite,
  InviteAdminError,
  InviteSecretMissingError,
  InviteValidationError,
  parsePositiveInt,
  revokeCreditInvite,
  updateCreditInvite,
} from '@/lib/invites';
import { InviteExpiryError, parseInviteExpiryIso } from './invite-datetime';

function inviteRedirect(message: string, tone: 'success' | 'error' = 'success'): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`/admin/invites?${params.toString()}`);
}

function isExpiryError(error: unknown): boolean {
  return error instanceof InviteExpiryError;
}

export async function createInviteAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  let message = 'Invite created.';
  let tone: 'success' | 'error' = 'success';
  try {
    const label = String(formData.get('label') ?? '');
    const credits = parsePositiveInt(
      formData.get('creditsPerRecipient'),
      'Credits per recipient',
      10_000,
    );
    const maxRecipients = parsePositiveInt(
      formData.get('maxRecipients'),
      'Recipient limit',
      100_000,
    );
    const days = parsePositiveInt(formData.get('expiresInDays'), 'Expiry days', 366);
    const created = await createCreditInvite({
      label,
      creditsPerRecipient: credits,
      maxRecipients,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      createdByUserId: admin.userId,
    });
    message = `Invite "${created.invite.label}" created; codes remain available on this page.`;
    revalidatePath('/admin/invites');
  } catch (error) {
    tone = 'error';
    message =
      error instanceof InviteValidationError ||
      error instanceof InviteSecretMissingError ||
      error instanceof InviteAdminError
        ? error.message
        : 'Could not create that invite.';
  }
  inviteRedirect(message, tone);
}

export async function revokeInviteAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  let message = 'Invite revoked.';
  let tone: 'success' | 'error' = 'success';
  try {
    const id = String(formData.get('inviteId') ?? '').trim();
    const reason = String(formData.get('reason') ?? '').trim();
    if (!id) throw new InviteAdminError('Invite not found.');
    await revokeCreditInvite({ id, actorUserId: admin.userId, reason });
    message = 'Invite revoked. Credits already issued are unaffected.';
    revalidatePath('/admin/invites');
  } catch (error) {
    tone = 'error';
    message = error instanceof InviteAdminError ? error.message : 'Could not revoke that invite.';
  }
  inviteRedirect(message, tone);
}

export async function updateInviteAction(formData: FormData): Promise<never> {
  const admin = await requireAdminIdentity();
  let message = 'Invite updated.';
  let tone: 'success' | 'error' = 'success';
  try {
    const id = String(formData.get('inviteId') ?? '').trim();
    const rawLimit = String(formData.get('maxRecipients') ?? '').trim();
    const rawExpiry = String(formData.get('expiresAt') ?? '').trim();
    if (!id) throw new InviteAdminError('Invite not found.');
    if (!rawLimit && !rawExpiry) throw new InviteAdminError('Nothing to update.');
    await updateCreditInvite({
      id,
      actorUserId: admin.userId,
      ...(rawLimit
        ? { maxRecipients: parsePositiveInt(rawLimit, 'Recipient limit', 100_000) }
        : {}),
      // The browser form always submits a canonical ISO instant with an
      // explicit zone (or nothing when untouched); bare datetime-local
      // values are rejected because the server cannot know the zone.
      ...(rawExpiry ? { expiresAt: parseInviteExpiryIso(rawExpiry) } : {}),
    });
    message = 'Invite updated.';
    revalidatePath('/admin/invites');
  } catch (error) {
    tone = 'error';
    message =
      error instanceof InviteAdminError ||
      error instanceof InviteValidationError ||
      isExpiryError(error)
        ? (error as Error).message
        : 'Could not update that invite.';
  }
  inviteRedirect(message, tone);
}
