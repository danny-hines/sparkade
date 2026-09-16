'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { favoriteAction, manageGameAction } from './arcade-actions';

export function SubmitButton({
  children,
  className = 'arc-button',
  disabled = false,
  pressed,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={disabled || pending}
      type="submit"
      aria-pressed={pressed}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
export function FavoriteButton({
  id,
  saved,
  signedIn,
  returnTo = '/play',
}: {
  id: string;
  saved: boolean;
  signedIn: boolean;
  returnTo?: string;
}) {
  const [result, action] = useActionState(favoriteAction, { error: '' });
  if (!signedIn)
    return (
      <a
        className="arc-heart"
        href={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`}
        aria-label="Sign in to like and save this game"
      >
        ♡ Save
      </a>
    );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="wanted" value={String(!saved)} />
      <SubmitButton className="arc-heart" pressed={saved}>
        {saved ? '♥ Saved' : '♡ Save'}
      </SubmitButton>
      {result.error && (
        <p role="alert" className="arc-fine-print">
          {result.error}
        </p>
      )}
    </form>
  );
}
export function OwnerControls({
  id,
  published,
  deleted,
  ready,
  canDelete,
}: {
  id: string;
  published: boolean;
  deleted: boolean;
  ready: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="arc-owner-controls">
      {deleted ? (
        <form action={manageGameAction}>
          <input name="id" value={id} type="hidden" />
          <input name="action" value="restore" type="hidden" />
          <SubmitButton className="arc-button-secondary">Restore (within 7 days)</SubmitButton>
        </form>
      ) : (
        <>
          {ready && (
            <form action={manageGameAction}>
              <input name="id" value={id} type="hidden" />
              <input name="action" value={published ? 'unpublish' : 'publish'} type="hidden" />
              <SubmitButton className="arc-button-secondary">
                {published ? 'Unpublish' : 'Publish'}
              </SubmitButton>
            </form>
          )}
          {canDelete && (
            <form
              action={manageGameAction}
              onSubmit={(e) => {
                if (
                  !window.confirm(
                    'Delete this game? It will disappear from all links. You can restore it from your library within 7 days.',
                  )
                )
                  e.preventDefault();
              }}
            >
              <input name="id" value={id} type="hidden" />
              <input name="action" value="delete" type="hidden" />
              <SubmitButton className="arc-text-button">Delete</SubmitButton>
            </form>
          )}
        </>
      )}
    </div>
  );
}
