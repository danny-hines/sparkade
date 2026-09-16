'use client';

import { useActionState, useEffect, startTransition } from 'react';
import Link from 'next/link';
import { completeSignupAction } from '../actions';

export function CompletionForm() {
  const [state, action, pending] = useActionState(completeSignupAction, { error: null });
  // A POST action (not page rendering/prefetch) performs the grant. Duplicate
  // mounts and interrupted responses are safe because finalization is idempotent.
  useEffect(() => { startTransition(() => action(new FormData())); }, [action]);
  if (state.completion) {
    const result = state.completion;
    return <div className="signup-form" role="status">
      <h2>{result.status === 'credited' ? `${result.creditsAdded} invite credits added` : 'Your account is ready'}</h2>
      <p>You have <strong>{result.balance} credits</strong>.</p>
      {result.status === 'ineligible' && <p>Invite bonuses are for new signups with an invite saved before registration.</p>}
      {result.balance === 0 && <p>Buying credits is coming soon. You can play shared games now.</p>}
      <Link className="signup-button" href={result.returnPath}>Continue</Link>
    </div>;
  }
  return <form action={action} className="signup-form">
    {pending && <p role="status">Finishing your signup…</p>}
    {state.error && <p role="alert" className="signup-error">{state.error}</p>}
    <button className="signup-button" name="intent" value="redeem" disabled={pending}>Retry signup completion</button>
    <details><summary>Use a different invite</summary>
      <label htmlFor="replacement-invite">Replacement invite code</label>
      <input id="replacement-invite" name="invite" maxLength={100} autoComplete="off" spellCheck={false} />
      <button className="signup-button" name="intent" value="replace" disabled={pending}>Use this invite</button>
    </details>
    <button className="signup-text-button" name="intent" value="zero" disabled={pending}>Finish without invite credits</button>
    <p>This ends your signup offer. You can still play shared games.</p>
    <Link href="/sign-in?redirect_url=/sign-up/complete">Sign in again</Link>
  </form>;
}
