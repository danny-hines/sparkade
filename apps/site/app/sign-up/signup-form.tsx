'use client';

import { useActionState } from 'react';
import { startSignupAction } from './actions';

export function SignupForm({ code = '', returnPath = '/me' }: { code?: string; returnPath?: string }) {
  const [state, action, pending] = useActionState(startSignupAction, { error: null });
  return (
    <form action={action} className="signup-form">
      <input type="hidden" name="returnPath" value={returnPath} />
      <label htmlFor="invite">Invite code <span>(optional)</span></label>
      <input id="invite" name="invite" defaultValue={code} maxLength={100} autoComplete="off"
        autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH-JKMN-PQRS" aria-describedby="invite-help" />
      <p id="invite-help">An invite adds free starting credits after you verify your email. Without one, you start with 0 credits. Buying credits is coming soon.</p>
      {state.error && <p role="alert" className="signup-error">{state.error}</p>}
      <button className="signup-button" name="intent" value="invite" disabled={pending}>
        {pending ? 'Saving…' : 'Continue to signup'}
      </button>
      <button className="signup-text-button" name="intent" value="zero" disabled={pending}>Continue without invite credits</button>
    </form>
  );
}
