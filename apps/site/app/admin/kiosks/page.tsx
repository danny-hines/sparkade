import { listManagedKiosks } from '@/lib/kiosks';
import {
  DEFAULT_KIOSK_DISPLAY_COPY,
  KIOSK_TITLE_MAX_LENGTH,
  KIOSK_TAGLINE_MAX_LENGTH,
} from '@sparkade/shared';
import { getAdminPageIdentity } from '../page-access';
import { AdminNotice, type AdminQuery } from '../admin-notice';
import {
  pairKioskAction,
  renameKioskAction,
  revokeKioskAction,
  setKioskVisibilityAction,
  setKioskDisplayCopyAction,
} from '../actions';
export const metadata = { title: 'Admin · Kiosks' };
export const dynamic = 'force-dynamic';
function relativeTime(value: string | null): string {
  if (!value) return 'Never connected';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return 'Connected just now';
  if (elapsedMinutes < 60) return `Seen ${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `Seen ${hours}h ago`;
  return `Seen ${Math.floor(hours / 24)}d ago`;
}

export default async function KiosksPage({ searchParams }: { searchParams: Promise<AdminQuery> }) {
  const identity = await getAdminPageIdentity('/admin/kiosks');
  if (!identity) return null;
  const [kiosks, query] = await Promise.all([listManagedKiosks(identity.userId), searchParams]);
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Device management</span>
        <h1>Kiosks</h1>
        <p>Pair cabinets, customize their screens, and choose where their new games appear.</p>
      </section>
      <AdminNotice query={query} />
      <section className="admin-section" aria-labelledby="pair-title">
        <div className="admin-section-heading">
          <div>
            <span>Device setup</span>
            <h2 id="pair-title">Pair a kiosk</h2>
          </div>
          <p>Enter the code shown in Settings → Registration on the cabinet.</p>
        </div>
        <form className="admin-pair-form" action={pairKioskAction}>
          <label>
            Pairing code
            <input
              name="code"
              placeholder="K7M4-PQ9D"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={9}
              required
            />
          </label>
          <label>
            Kiosk name
            <input name="name" placeholder="Meta SEA" maxLength={80} required />
          </label>
          <label>
            New game visibility
            <select name="defaultFeedVisibility" defaultValue="unlisted">
              <option value="unlisted">Unlisted by default</option>
              <option value="listed">List in public feed</option>
            </select>
          </label>
          <button type="submit">Pair kiosk</button>
        </form>
      </section>

      <section className="admin-section" aria-labelledby="kiosks-title">
        <div className="admin-section-heading">
          <div>
            <span>Fleet</span>
            <h2 id="kiosks-title">Kiosks</h2>
          </div>
          <p>{kiosks.length} registered</p>
        </div>
        {kiosks.length ? (
          <div className="admin-kiosk-grid">
            {kiosks.map((kiosk) => (
              <article
                className={`admin-kiosk-card ${kiosk.revokedAt ? 'revoked' : ''}`}
                key={kiosk.id}
              >
                <div className="admin-card-topline">
                  <span className={`admin-status-dot ${kiosk.revokedAt ? 'revoked' : ''}`} />
                  <span>{kiosk.revokedAt ? 'Revoked' : relativeTime(kiosk.lastSeenAt)}</span>
                  <strong>{kiosk.gameCount} games</strong>
                </div>
                <p className="admin-kiosk-runtime">
                  {kiosk.runtime ? (
                    <>
                      {kiosk.runtime.model} · Sparkade {kiosk.runtime.version}
                      <br />
                      {kiosk.runtime.channel === 'pilot' ? 'Pilot' : 'Stable'} updates ·{' '}
                      {kiosk.runtime.updateState}
                      <br />
                      <small>
                        Version report: {relativeTime(kiosk.runtimeReportedAt).toLowerCase()}
                      </small>
                    </>
                  ) : (
                    'Version not reported yet'
                  )}
                </p>
                <form action={renameKioskAction} className="admin-inline-form">
                  <input type="hidden" name="kioskId" value={kiosk.id} />
                  <label>
                    Name
                    <input
                      name="name"
                      defaultValue={kiosk.name}
                      maxLength={80}
                      disabled={!!kiosk.revokedAt}
                    />
                  </label>
                  <button type="submit" disabled={!!kiosk.revokedAt}>
                    Save
                  </button>
                </form>
                <form action={setKioskVisibilityAction} className="admin-inline-form">
                  <input type="hidden" name="kioskId" value={kiosk.id} />
                  <label>
                    New games
                    <select
                      name="defaultFeedVisibility"
                      defaultValue={kiosk.defaultFeedVisibility}
                      disabled={!!kiosk.revokedAt}
                    >
                      <option value="unlisted">Unlisted</option>
                      <option value="listed">Listed publicly</option>
                    </select>
                  </label>
                  <button type="submit" disabled={!!kiosk.revokedAt}>
                    Update
                  </button>
                </form>
                <form action={setKioskDisplayCopyAction} className="admin-kiosk-copy-form">
                  <input type="hidden" name="kioskId" value={kiosk.id} />
                  <label>
                    Screen title
                    <input
                      name="title"
                      defaultValue={kiosk.displayCopy.title}
                      placeholder={DEFAULT_KIOSK_DISPLAY_COPY.title}
                      maxLength={KIOSK_TITLE_MAX_LENGTH}
                      disabled={!!kiosk.revokedAt}
                    />
                  </label>
                  <label>
                    Attract screen tagline
                    <input
                      name="tagline"
                      defaultValue={kiosk.displayCopy.tagline}
                      placeholder={DEFAULT_KIOSK_DISPLAY_COPY.tagline}
                      maxLength={KIOSK_TAGLINE_MAX_LENGTH}
                      disabled={!!kiosk.revokedAt}
                    />
                  </label>
                  <p>
                    The title appears on the attract and game selection screens. Leave a field blank
                    to restore its default. Online kiosks update within a minute and keep the last
                    saved copy offline.
                  </p>
                  <button type="submit" disabled={!!kiosk.revokedAt}>
                    Save screen copy
                  </button>
                </form>
                {!kiosk.revokedAt ? (
                  <details className="admin-danger-zone">
                    <summary>Revoke access</summary>
                    <p>This cabinet will stop publishing and must pair again.</p>
                    <form action={revokeKioskAction}>
                      <input type="hidden" name="kioskId" value={kiosk.id} />
                      <button type="submit">Revoke {kiosk.name}</button>
                    </form>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No kiosks yet. Open Registration on a cabinet to begin.</div>
        )}
      </section>
    </>
  );
}
