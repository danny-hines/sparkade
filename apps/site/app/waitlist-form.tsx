'use client';

import { useActionState } from 'react';
import { joinWaitlist, type WaitlistState } from './actions';

const initialWaitlistState: WaitlistState = {
  status: 'idle',
  message: '',
};

export function WaitlistForm() {
  const [state, formAction, pending] = useActionState(joinWaitlist, initialWaitlistState);
  const complete = state.status === 'joined' || state.status === 'duplicate';

  if (complete) {
    return (
      <div className="waitlist-success" role="status">
        <span aria-hidden="true">✓</span>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form className="waitlist-form" action={formAction}>
      <label className="sr-only" htmlFor="waitlist-email">
        Email address
      </label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        disabled={pending}
        aria-describedby="waitlist-terms waitlist-status"
      />
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="waitlist-website">Website</label>
        <input id="waitlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" disabled={pending}>
        <span>{pending ? 'Joining…' : 'Join the waitlist'}</span>
        <span aria-hidden="true">→</span>
      </button>
      <p
        id="waitlist-status"
        className={state.status === 'idle' ? 'sr-only' : 'waitlist-message'}
        role={state.status === 'invalid' || state.status === 'unavailable' ? 'alert' : 'status'}
      >
        {state.message || 'Ready for an email address.'}
      </p>
      <p id="waitlist-terms" className="waitlist-terms">
        Product updates only. Unsubscribe whenever you like.
      </p>
    </form>
  );
}
