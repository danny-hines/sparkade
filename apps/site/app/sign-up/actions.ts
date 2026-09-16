'use server';

import { auth } from '@clerk/nextjs/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSignupIdentity } from '@/lib/signup-auth';
import {
  finishSignup, limitSignupRequests, SIGNUP_COOKIE, SIGNUP_TTL_SECONDS,
  SignupRateLimitError, startSignupAttempt, type SignupCompletion,
} from '@/lib/signup';
import {
  InviteAlreadyClaimedError, InviteCodeInvalidError, InviteExpiredError, InviteFullError,
  InviteNotEligibleError, InviteRevokedError, SignupChangedError,
} from '@/lib/invites';

export interface SignupActionState { error: string | null; completion?: SignupCompletion }

function message(error: unknown): string {
  if (error instanceof InviteCodeInvalidError || error instanceof InviteExpiredError
    || error instanceof InviteFullError || error instanceof InviteRevokedError
    || error instanceof InviteNotEligibleError || error instanceof InviteAlreadyClaimedError
    || error instanceof SignupChangedError || error instanceof SignupRateLimitError) return error.message;
  // Do not send SQL, credentials, raw invite codes, or provider responses to the browser/logs.
  console.error('Signup operation failed', { type: error instanceof Error ? error.name : 'unknown' });
  return 'We could not finish this step. Please try again. Any saved signup progress will be kept.';
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function startSignupAction(_state: SignupActionState, form: FormData): Promise<SignupActionState> {
  const { userId } = await auth();
  if (userId) redirect('/sign-up/complete');
  try {
    const requestHeaders = await headers();
    // Vercel owns this header. Elsewhere, use a shared anonymous limit rather
    // than trusting a client-supplied forwarding chain as an identity.
    const network = process.env.VERCEL ? requestHeaders.get('x-vercel-forwarded-for') ?? 'anonymous' : 'anonymous';
    await limitSignupRequests(network, false);
    const code = field(form, 'intent') === 'zero' ? '' : field(form, 'invite').slice(0, 100);
    const token = await startSignupAttempt(code, field(form, 'returnPath'));
    (await cookies()).set(SIGNUP_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/', maxAge: SIGNUP_TTL_SECONDS,
    });
  } catch (error) {
    return { error: message(error) };
  }
  redirect('/sign-up');
}

export async function completeSignupAction(_state: SignupActionState, form: FormData): Promise<SignupActionState> {
  // Identity and verification are read afresh for every call, including retries.
  try {
    const { userId } = await auth();
    if (!userId) return { error: 'Sign in to finish your signup.' };
    // Bound provider lookups as well as database mutations.
    await limitSignupRequests(userId, true);
    const identity = await getSignupIdentity();
    if (!identity) return { error: 'Sign in to finish your signup.' };
    const jar = await cookies();
    const intent = field(form, 'intent');
    const choice = intent === 'zero' ? { kind: 'zero' as const }
      : intent === 'replace' ? { kind: 'replace' as const, code: field(form, 'invite').slice(0, 100) }
        : { kind: 'redeem' as const };
    const completion = await finishSignup(identity, jar.get(SIGNUP_COOKIE)?.value, choice);
    jar.delete(SIGNUP_COOKIE);
    return { error: null, completion };
  } catch (error) {
    return { error: message(error) };
  }
}
