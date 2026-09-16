import { getAdminPageIdentity } from '../page-access';
import { getSql } from '@/lib/db';
import { env, settings } from '@/lib/arcade';
import { SubmitButton } from '../../components/game-controls';
import { SourcePhoto } from '../../components/source-photo';
import { resumeApprovedAction, reviewAction, saveCreationSettings } from './actions';
export const metadata = { title: 'Admin · Creation' };
export const dynamic = 'force-dynamic';
export default async function CreationAdmin({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  if (!(await getAdminPageIdentity('/admin/creation'))) return null;
  const config = await settings(),
    sql = getSql();
  const [queue, spend] = await Promise.all([
    sql`SELECT g.*,j.status,j.attempt,j.updated_at,p.title,p.version_hash,p.moderation,u.handle,
      j.state->'job'->'creationBrief'->>'heroName' AS hero_name,
      j.state->'job'->>'hasPhoto'='true' AND j.checkpoint<>'' AND NOT j.cleanup_pending
        AND j.status NOT IN ('done','canceled') AND g.input_review<>'rejected' AND p.deleted_at IS NULL AS has_photo,
      (SELECT COALESCE(sum(COALESCE(charged,reserved)),0) FROM arcade_spend s WHERE s.job_id=g.job_id) AS cost
      FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id JOIN public_games p ON p.id=g.game_id
      JOIN arcade_profiles u ON u.environment=g.environment AND u.user_id=g.user_id
      WHERE g.environment=${env()} ORDER BY (g.settlement='held') DESC,g.created_at DESC LIMIT 100`,
    sql`SELECT COALESCE(sum(COALESCE(charged,reserved)),0) AS total,
      COALESCE(sum(COALESCE(charged,reserved)) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS today,
      COALESCE(sum(reserved) FILTER(WHERE charged IS NULL),0) AS uncertain FROM arcade_spend WHERE environment=${env()}`,
  ]);
  const notice = (await searchParams).notice;
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Friends beta · {env()}</span>
        <h1>Creation control room</h1>
        <p>
          Manage games and keep provider spending within your limits. Admin-created games skip
          manual review; you can still take them down here.
        </p>
      </section>
      {notice && (
        <p className="arc-message" role="status">
          {notice}
        </p>
      )}
      <div className="arc-metrics">
        <p>
          <strong>${Number(spend[0].today).toFixed(2)}</strong>Today · UTC
        </p>
        <p>
          <strong>${Number(spend[0].total).toFixed(2)}</strong>Total exposure
        </p>
        <p>
          <strong>${Number(spend[0].uncertain).toFixed(2)}</strong>Reserved or unknown
        </p>
      </div>
      <section className="arc-panel arc-section">
        <h2>Generation settings</h2>
        <p>
          Exposure includes conservative reservations for requests whose billing is unknown.
          Lowering limits stops new requests; calls already in flight can finish.
        </p>
        <form action={saveCreationSettings} className="arc-admin-form">
          <label>
            <span>
              <input name="enabled" type="checkbox" defaultChecked={config.enabled} /> Enable
              website creation
            </span>
          </label>
          <label>
            Credits per game
            <input
              className="arc-input"
              type="number"
              name="price"
              min={1}
              max={10000}
              required
              defaultValue={config.price}
            />
          </label>
          {[
            ['gameCap', 'Provider cap per game (USD)', config.gameCap],
            ['dailyCap', 'Daily provider cap (USD, UTC)', config.dailyCap],
            ['totalCap', 'Total beta provider cap (USD)', config.totalCap],
          ].map(([name, label, value]) => (
            <label key={name}>
              {label}
              <input
                className="arc-input"
                type="number"
                name={String(name)}
                min={0}
                max={10000}
                step="0.01"
                required
                defaultValue={value}
              />
            </label>
          ))}
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </section>
      <section className="arc-section">
        <div className="arc-section-heading">
          <h2>Review & generation queue</h2>
          <form action={resumeApprovedAction}>
            <SubmitButton className="arc-button-secondary">Resume approved jobs</SubmitButton>
          </form>
        </div>
        <div className="arc-review-list">
          {queue.length === 0 && <p>No games submitted yet.</p>}
          {queue.map((g) => (
            <article id={`game-${g.game_id}`} key={g.job_id}>
              <span className="arc-kicker">
                {g.status} · {g.input_review === 'pending' ? 'Prompt review' : g.moderation}
              </span>
              {g.admin_bypass && (
                <p className="arc-fine-print">Admin creator · manual review bypassed</p>
              )}
              <h3>
                {g.title || 'New game'} · @{g.handle}
              </h3>
              {g.hero_name && (
                <p>
                  Hero name: <strong>{g.hero_name}</strong>
                </p>
              )}
              <p>{g.prompt}</p>
              {g.has_photo && <SourcePhoto gameId={g.game_id} />}
              <p>
                {g.price} credits {g.settlement} · ${Number(g.cost).toFixed(2)} provider exposure ·
                attempt {g.attempt}
              </p>
              {g.status === 'review' ? (
                <a className="arc-button" href={`/admin/creation/${g.game_id}`}>
                  Review game & assets →
                </a>
              ) : g.input_review === 'pending' && g.status === 'queued' ? (
                <form action={reviewAction} className="arc-admin-form">
                  <input type="hidden" name="jobId" value={g.job_id} />
                  <label>
                    Review note
                    <input
                      className="arc-input"
                      name="reason"
                      required
                      maxLength={1000}
                      placeholder="Why this idea and any photo are appropriate, or why they were rejected"
                    />
                  </label>
                  <div className="arc-hero-actions">
                    <button className="arc-button" name="decision" value="approve-input">
                      Approve idea & generate
                    </button>
                    <button className="arc-button-secondary" name="decision" value="reject">
                      Reject & refund
                    </button>
                  </div>
                </form>
              ) : g.status === 'done' && g.moderation === 'approved' ? (
                <form action={reviewAction} className="arc-admin-form">
                  <a href={`/p/${g.game_id}`}>View game ↗</a>
                  <input type="hidden" name="jobId" value={g.job_id} />
                  <input type="hidden" name="decision" value="takedown" />
                  <label>
                    Takedown reason
                    <input className="arc-input" name="reason" required maxLength={1000} />
                  </label>
                  <SubmitButton className="arc-button-secondary">Take down game</SubmitButton>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
