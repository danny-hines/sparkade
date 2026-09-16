'use client';

import { useActionState } from 'react';
import { changeUsernameAction } from '../actions';

export function UsernameForm({ handle, suspended }: { handle: string; suspended: boolean }) {
  const [result, action, pending] = useActionState(changeUsernameAction, {
    error: '',
    username: handle,
  });
  return (
    <form action={action} className="arc-form arc-username-form">
      <label htmlFor="username" className="arc-label">
        Username
      </label>
      <input
        id="username"
        name="username"
        type="text"
        className="arc-input"
        defaultValue={result.username}
        minLength={3}
        maxLength={24}
        required
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby={`username-help username-links${result.error ? ' username-error' : ''}`}
        aria-invalid={Boolean(result.error)}
        disabled={suspended || pending}
      />
      <p id="username-help" className="arc-fine-print">
        3–24 letters, numbers, underscores, or hyphens. Start and end with a letter or number.
        Usernames are saved in lowercase. Keep it friendly; staff names are reserved.
      </p>
      <p id="username-links" className="arc-fine-print">
        Your old profile links will still work.
      </p>
      {suspended && (
        <p className="arc-message" role="status">
          Your account is paused. Profile changes are unavailable.
        </p>
      )}
      {result.error && (
        <p id="username-error" className="arc-message arc-message-error" role="alert">
          {result.error}
        </p>
      )}
      <div className="arc-hero-actions">
        <button type="submit" className="arc-button" disabled={suspended || pending}>
          {pending ? 'Saving…' : 'Save username'}
        </button>
        <a href="/me" className="arc-button-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
