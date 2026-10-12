'use client';

import { useActionState } from 'react';
import { SubmitButton } from '../../components/game-controls';
import { inviteEmailsAction } from './actions';

export function InviteEmailsForm() {
  const [state, action] = useActionState(inviteEmailsAction, { error: '', notice: '', draft: '' });
  return (
    <form action={action} className="arc-admin-form">
      <label>
        Email addresses
        <textarea
          className="arc-input"
          name="emails"
          rows={3}
          defaultValue={state.draft}
          placeholder={'alex@example.com\nsam@example.com'}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <p className="admin-account-help">One per line, or separated by commas.</p>
      {state.error && (
        <p className="admin-notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="admin-notice success" role="status">
          {state.notice}
        </p>
      )}
      <SubmitButton>Invite</SubmitButton>
    </form>
  );
}
