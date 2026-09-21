import type { ArcadeCard } from '@/lib/arcade';
import { ArcadeGameCard, ArcadeEmpty } from './arcade-ui';
import { FavoriteButton, OwnerControls, RetryGameControl } from './game-controls';
import { HighScoresButton } from './high-scores-button';
export function GameGrid({
  games,
  signedIn = false,
  owner = false,
}: {
  games: ArcadeCard[];
  signedIn?: boolean;
  owner?: boolean;
}) {
  if (!games.length)
    return (
      <ArcadeEmpty
        title={owner ? 'Your arcade starts here' : 'No games here yet'}
        description={
          owner
            ? 'Describe an idea and create your first game.'
            : 'Try another search, or come back for something new.'
        }
        action={
          <a className="arc-button" href="/create">
            Create a game →
          </a>
        }
      />
    );
  return (
    <div className="arc-grid">
      {games.map((game) => (
        <ArcadeGameCard
          key={game.id}
          game={{ ...game, href: owner && game.jobId ? `/me/games/${game.id}` : undefined }}
          action={
            game.status === 'ready' && game.moderation === 'approved' && !game.deleted ? (
              <>
                <FavoriteButton id={game.id} saved={game.favorite} signedIn={signedIn} />
                <HighScoresButton id={game.id} title={game.title} />
              </>
            ) : undefined
          }
        >
          {owner && (
            <>
              <p className="arc-game-status">
                {game.deleted
                  ? 'Deleted'
                  : game.moderation === 'rejected'
                    ? 'Unavailable'
                    : game.status === 'ready'
                      ? game.feedVisibility === 'listed'
                        ? 'Published'
                        : 'Unlisted · shareable by link'
                      : game.inputReview === 'pending' && game.jobStatus === 'queued'
                        ? 'Waiting for prompt review'
                        : game.jobStatus === 'review'
                          ? 'Waiting for game review'
                          : game.jobStatus === 'canceled'
                            ? 'Canceled · credits returned'
                            : game.jobStatus === 'failed'
                              ? 'Failed · credits returned'
                              : `Creating · ${game.stage.replaceAll('-', ' ')}`}
              </p>
              {game.failure && <p className="arc-fine-print">{game.failure}</p>}
              <OwnerControls
                id={game.id}
                published={game.feedVisibility === 'listed'}
                deleted={game.deleted}
                ready={game.status === 'ready' && game.moderation === 'approved'}
                canDelete={['done', 'failed', 'canceled'].includes(game.jobStatus ?? 'done')}
                retry={game.retry}
              />
              {game.retry && !game.retry.available && <RetryGameControl retry={game.retry} />}
            </>
          )}
        </ArcadeGameCard>
      ))}
    </div>
  );
}
