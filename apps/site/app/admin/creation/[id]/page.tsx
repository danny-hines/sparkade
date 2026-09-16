import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAdminPageIdentity } from '../../page-access';
import { getSql } from '@/lib/db';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { readWebsiteFinal } from '@/lib/website-generation';
import { reviewAction } from '../actions';
import { PublicGamePlayer } from '../../../p/[id]/public-game-player';
export const metadata = { title: 'Admin · Game review' };
export const dynamic = 'force-dynamic';
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getAdminPageIdentity(`/admin/creation/${id}`))) return null;
  await ensureArcadeSchema();
  const [game] =
    await getSql()`SELECT p.*,g.job_id,g.prompt FROM public_games p JOIN arcade_generations g ON g.game_id=p.id WHERE p.id=${id} AND p.environment=${env()}`;
  if (!game || game.deleted_at) notFound();
  const final = await readWebsiteFinal(id);
  if (!final) notFound();
  return (
    <>
      <Link className="admin-back-link" href="/admin/creation">
        ← Creation queue
      </Link>
      <section className="admin-hero">
        <span className="admin-kicker">Private review</span>
        <h1>{final.bundle.spec.meta.title}</h1>
        <p>{game.prompt}</p>
      </section>
      <section className="arc-panel">
        <h2>Play the generated game</h2>
        <PublicGamePlayer
          trackPlays={false}
          id={id}
          spec={final.bundle.spec}
          assets={game.assets_json}
        />
      </section>
      <section className="arc-section">
        <h2>Review every asset</h2>
        <p>
          Check artwork, story cards, text, and the playable experience. Approval applies to this
          exact saved version.
        </p>
        <div className="arc-review-grid">
          {final.bundle.manifest.assets.map((a) => (
            <figure key={a.filename}>
              <img src={`/api/games/${id}/assets/${a.filename}`} alt={a.filename} />
              <figcaption>{a.filename}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="arc-section">
        <h2>Generated text & game data</h2>
        <pre className="arc-panel arc-review-json">
          {JSON.stringify(final.bundle.spec, null, 2)}
        </pre>
      </section>
      <section className="arc-panel arc-section">
        <form action={reviewAction} className="arc-admin-form">
          <input name="jobId" type="hidden" value={game.job_id} />
          <input name="version" type="hidden" value={game.version_hash} />
          <label>
            Review note
            <input className="arc-input" name="reason" required maxLength={1000} />
          </label>
          <p>
            Approval makes this game playable by direct link. Its creator decides whether to publish
            it to the feed.
          </p>
          <div className="arc-hero-actions">
            <button className="arc-button" name="decision" value="approve-output">
              Approve this version
            </button>
            <button className="arc-button-secondary" name="decision" value="reject">
              Reject & return credits
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
