'use client';
import { useActionState, useState } from 'react';
import { ARCHETYPE_IDS } from '@sparkade/shared';
import { MAX_ACTIVE_WEBSITE_GAMES, type ActiveWebsiteGame } from '@/lib/website-creation-policy';
import { createGameAction, type CreateGameState } from '../components/arcade-actions';
import { gameTypeLabel } from '../components/arcade-ui';
import { SubmitButton } from '../components/game-controls';
import { HeroPhotoInput } from './hero-photo-input';
export function CreateForm({
  price,
  activeGames,
  disabled,
  submissionKey,
}: {
  price: number;
  activeGames: ActiveWebsiteGame[];
  disabled: boolean;
  submissionKey: string;
}) {
  const atCapacity = activeGames.length >= MAX_ACTIVE_WEBSITE_GAMES;
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [heroName, setHeroName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [archetype, setArchetype] = useState<string>(ARCHETYPE_IDS[0]);
  const [state, action, pending] = useActionState(
    async (previous: CreateGameState, form: FormData): Promise<CreateGameState> => {
      if (photoBusy)
        return {
          error: 'Finish selecting your photo or cancel the camera before creating your game.',
        };
      if (photo) form.set('photo', photo, 'hero.jpg');
      return createGameAction(previous, form);
    },
    { error: '' },
  );
  return (
    <form
      action={action}
      className="arc-form"
      // A returned action result is an error; success redirects. Keep the
      // browser from resetting radio selections while the user corrects it.
      onReset={(event) => event.preventDefault()}
    >
      {activeGames.length > 0 && (
        <div className="arc-message" role="status">
          <strong>
            {activeGames.length} of {MAX_ACTIVE_WEBSITE_GAMES} games in progress
          </strong>
          <ul>
            {activeGames.map((game) => (
              <li key={game.id}>
                <a href={`/me/games/${game.id}`} target="_blank" rel="noreferrer">
                  {game.title}: view progress ↗
                </a>
              </li>
            ))}
          </ul>
          {atCapacity
            ? 'You can prepare your next idea below. Creation unlocks automatically when one of these games finishes.'
            : 'You can create another game while these are in progress.'}
        </div>
      )}
      <input type="hidden" name="key" value={submissionKey} />
      <fieldset disabled={disabled || pending}>
        <legend>Choose your game type</legend>
        <div className="arc-type-picker">
          {ARCHETYPE_IDS.map((type) => (
            <label key={type}>
              <input
                type="radio"
                name="archetype"
                value={type}
                checked={archetype === type}
                onChange={() => setArchetype(type)}
              />
              <span>{gameTypeLabel(type)}</span>
            </label>
          ))}
        </div>
        <HeroPhotoInput photo={photo} onChange={setPhoto} onBusyChange={setPhotoBusy} />
        <label className="arc-label" htmlFor="hero-name">
          Hero name (optional)
        </label>
        <input
          id="hero-name"
          className="arc-input"
          name="heroName"
          type="text"
          maxLength={48}
          autoComplete="off"
          spellCheck={false}
          placeholder="Spark decides"
          aria-describedby="hero-name-help"
          value={heroName}
          onChange={(event) => setHeroName(event.target.value)}
        />
        <p id="hero-name-help" className="arc-fine-print">
          Leave blank to let Spark choose a name.
        </p>
        <label className="arc-label" htmlFor="prompt">
          What’s your game about? (optional)
        </label>
        <textarea
          id="prompt"
          className="arc-input"
          name="prompt"
          maxLength={1200}
          rows={6}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Spark decides — or add your own idea…"
          aria-describedby="game-idea-help"
        />
        <p id="game-idea-help" className="arc-fine-print">
          Leave blank to let Spark invent the story, enemies, setting, and visual style. If you add
          details, keep them appropriate for a public arcade: no personal information, hate, or
          explicit content.
        </p>
      </fieldset>
      <p>
        Creating a game costs {price} credits, including its artwork and playable world. Credits are
        reserved when you submit and returned if generation fails or review rejects the game.
      </p>
      {state.error && (
        <p className="arc-message" role="alert">
          {state.error}
          {state.activeGames && (
            <>
              <br />
              <a href="/me" target="_blank" rel="noreferrer">
                View your games in progress ↗
              </a>
            </>
          )}
        </p>
      )}
      <SubmitButton disabled={disabled || photoBusy || atCapacity}>
        {atCapacity ? 'Waiting for an open game slot' : `Create game · ${price} credits`}
      </SubmitButton>
    </form>
  );
}
