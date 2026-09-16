'use client';
import { useActionState } from 'react';
import { ARCHETYPE_IDS } from '@sparkade/shared';
import { createGameAction } from '../components/arcade-actions';
import { gameTypeLabel } from '../components/arcade-ui';
import { SubmitButton } from '../components/game-controls';
export function CreateForm({
  price,
  disabled,
  submissionKey,
}: {
  price: number;
  disabled: boolean;
  submissionKey: string;
}) {
  const [state, action] = useActionState(createGameAction, { error: '' });
  return (
    <form action={action} className="arc-form">
      <input type="hidden" name="key" value={submissionKey} />
      <fieldset disabled={disabled}>
        <legend>Choose your game type</legend>
        <div className="arc-type-picker">
          {ARCHETYPE_IDS.map((type, i) => (
            <label key={type}>
              <input type="radio" name="archetype" value={type} defaultChecked={i === 0} />
              <span>{gameTypeLabel(type)}</span>
            </label>
          ))}
        </div>
        <label className="arc-label" htmlFor="prompt">
          What’s your game about?
        </label>
        <textarea
          id="prompt"
          className="arc-input"
          name="prompt"
          required
          minLength={1}
          maxLength={1200}
          rows={6}
          placeholder="A tiny astronaut races through an overgrown space station to rescue their robot friend…"
        />
        <p className="arc-fine-print">
          Describe the world, hero, and goal. Keep it appropriate for a public arcade. No personal
          information, hate, or explicit content.
        </p>
      </fieldset>
      <p>
        {price} credits are reserved when you submit. They’re returned if generation fails or review
        rejects the game.
      </p>
      {state.error && (
        <p className="arc-message" role="alert">
          {state.error}
        </p>
      )}
      <SubmitButton disabled={disabled}>Create game · {price} credits</SubmitButton>
    </form>
  );
}
