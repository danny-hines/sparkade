# Website friends beta — implementation and verification

September 15–16, 2026. Local implementation; not deployed and no paid generation run.

## What is implemented

- Home showcases recently published games and real player favorites, with creation and game-type entrypoints.
- Play supports parameterized search, all six game types, pagination, and recent/plays/likes ordering.
- Shared navigation shows authentication, balance, profile, and privileged admin access.
- `/create` accepts a typed prompt and game type. `/me` contains created games and private Favorites; `/u/{handle}` exposes only published games. Public handles never fall back to email addresses or unreviewed login-account names. Users can choose a screened username from `/me/profile`.
- Atomic admission creates a durable generation job, owned unlisted game, and original-price credit hold together. Duplicate submission keys cannot double charge; one active game per customer. One retry uses the original price and cumulative provider budget. Terminal failures/rejections refund once per attempt.
- `/me/games/{id}` shows durable progress and allows queued cancellation, a single eligible retry, publishing/unpublishing, and terminal deletion with seven-day restore. Running jobs cannot be deleted or canceled through customer actions.
- One heart both likes and saves. Private favorites include approved unlisted games, but hide deleted/rejected content. Public counters expose aggregates only.
- A play requires a loaded engine, ten visible/focused seconds, a server-issued ticket, and rolling thirty-minute deduplication. Creator/admin preview plays are excluded. Metrics are approximate; no credits depend on them.
- `/admin/creation` contains the review queue, price/caps/pause control, spend exposure, game takedown, and recovery dispatch. `/admin/accounts` contains audited credit grants and account suspension.
- Human review happens before provider work and again before sharing. Approval binds to a SHA-256 hash of the exact saved game and asset bytes. Website assets remain in private storage and are served only through eligibility-checked routes. Kiosk credentials cannot mutate website-owned games.
- Provider admission runs before **every HTTP attempt**, including model fallbacks. Reservations are serialized per environment and checked against per-game, UTC daily, and total caps. Failed/unknown requests retain their reservation; known usage reconciles it. Unknown prices/operations fail closed. Existing kiosk/operator generation remains separate.
- The maintenance endpoint recovers undispatched approved jobs, settles failed holds, and expires website jobs stuck for over 24 hours. Manual review queues are not expired automatically.

## Operational setup before inviting friends

1. Use the existing Clerk, Neon, invite encryption secret, private generation Blob store, provider key, and Vercel Workflow configuration. Keep credit environment values consistent across requests and workers.
2. Open `/admin/creation`. Set credits/game (default 10), per-game USD cap, daily cap, and total beta cap, then enable creation. It starts disabled, with caps of zero. No real budgets were enabled by this implementation.
3. Create an invite at `/admin/invites` (existing defaults: 30 credits, 20 recipients, 7 days).
4. Approve submitted ideas in the creation queue. Review the generated text, all assets, and playable game before approving the exact output version.
5. Friends receive an unlisted playable link after review and can publish it themselves.

Provider caps use the configured price snapshot and conservative request bounds. They are not a provider billing guarantee if prices or billing semantics change. An observed charge above its reservation pauses new website work. Verify one live game in the intended deployment before broad invitations; provider credentials, private Blob permissions, callback origin, and real output quality are not established by mock tests.

## Local testing without provider charges

Use a **scratch** database and Clerk test instance. Set `SPARKADE_PROVIDER=mock`, `SPARKADE_LOCAL_GENERATION_STORAGE_DIR` to an absolute local directory, and `WORKFLOW_LOCAL_BASE_URL` to the exact local server URL. The optional `WORKFLOW_LOCAL_DATA_DIR` keeps test workflows separate. Mock storage is explicit and rejects non-mock providers; it is never a fallback after a Blob failure.

Run `npm run site:dev`. Configure limits/enable creation in the local admin portal, grant a test account credits, then exercise the same review and publication path. Local mock limits are still required, though mock provider requests cost zero.

## Verification

- `npm run verify`: 187 test files / 2,016 tests passed, plus root TypeScript, ESLint, and application builds. A subsequent recovery regression test also passed.
- Final site checks: 129 tests passed, including 34 genuine PostgreSQL tests; site TypeScript and targeted ESLint passed.
- Browser: actual Clerk authentication, zero-credit blocking, audited admin grant, budget settings, atomic submission, input approval, a complete durable mock generation, private output review, approval/capture, publishing, Favorites, unpublish, deletion, and restore.
- Public page, JSON, manifest, share-image, and asset routes all returned 404 after deletion and 200 after restore. Public profiles excluded unlisted games. A loaded browser engine produced exactly one qualified anonymous play. Wallet balance finished at 20 after one game from a 30-credit grant.
- Desktop and 390px mobile Home/Create/library layouts inspected; no horizontal overflow.
- Production site build verified with Webpack. The normal build script now selects Webpack because Turbopack panicked while tracing an existing workspace FFmpeg directory; trace exclusions did not resolve it. Development bundling is unchanged.

Browser verification used a disposable PostgreSQL container, two reserved Clerk test accounts, local mock storage, and a separate server on port 4177. The user's server on port 3000 was left running. No paid provider calls or live database test writes were made.

Cleanup completed: both verified Clerk test accounts were deleted, the disposable database and verification servers were stopped, and the isolated browser and build outputs were removed. Existing development configuration was restored; the user's development server remains running.

The full workflow test exposed an unnecessary 100ms relative sleep causing a local runtime replay divergence. Removing it allowed the complete workflow to finish. Terminal runtime failures are now reconciled by the owner's progress page and maintenance, so failures outside the workflow catch block can still release held credits. The real-PostgreSQL recovery regression test covers this path.

The local Blob transport experiment could write but did not successfully intercept the SDK's private reads inside the compiled server. Final end-to-end generation therefore used the explicit local mock-storage mode. This does not establish live private-Blob connectivity; that remains part of the deployment smoke test.

## Muse assessment

Muse handled only two new presentation files: the shared header/game cards/footer/empty state and scoped CSS. Session `01a0a7b0-54da-76fc-bc6b-fddb11dc89e2` completed in one turn without follow-up implementation loops. The host reviewed its output, added owner-card destinations, integrated the pages, and adjusted the Home layout to give games more room.

This was a suitable bounded Muse task. Ownership, credit accounting, provider admission, moderation, route gating, and end-to-end verification were implemented directly. There is no measured token-usage comparison, so no usage savings are claimed.

## Editable usernames

From `/me`, choose **Edit profile**. Usernames use 3–24 ASCII letters, numbers, underscores, or hyphens, start/end with a letter or number, and are stored in lowercase. Reserved staff/system names and a basic English profanity/slur filter are checked on the server. This deterministic filter covers common terms and simple substitutions; it is not comprehensive automated moderation.

Claims and renames are transactional and scoped to the credit environment. Previous usernames stay reserved to their owner. Old links resolve directly to the latest name using temporary redirects, so renaming back does not create permanently cached redirect loops. Games, credits, and favorites remain attached to the unchanged account ID. Paused accounts cannot rename; their current and historical public profile URLs return 404. The additive schema setup backfills existing generated usernames automatically.

Verification for this addition: all 159 site tests passed, including 39 real PostgreSQL tests, plus site TypeScript, targeted ESLint, and the production build. Regression cases cover competing claims, multiple simultaneous renames, alias ownership, environment separation, suspension, and authenticated-only actions.

Browser checks with a disposable Clerk test account and scratch PostgreSQL database passed: guest sign-in gating, the Edit profile entrypoint, reserved/taken-name feedback with input preservation, successful save, anonymous old-link redirects with pagination, repeated renames and reverting, and desktop/390px layouts without overflow or runtime errors. Testing exposed and fixed a form reset after rejected submissions. The test account, database, browser, server, and isolated build were cleaned up; the existing server on port 3000 was left running.

## Admin console sections

The console now has a shared header and responsive navigation on every page, including private game review. The current section is marked visually and with `aria-current`.

- `/admin`: overview with links to every tool and recent admin activity.
- `/admin/kiosks`: pairing, names, default visibility, and device revocation.
- `/admin/games`: recent cabinet and online games, visibility filters, cabinet publishing controls, and links to creation management. Deleted games and online games from other credit environments are excluded.
- `/admin/invites`: invite creation, codes, links, limits, expiry, and recipient history.
- `/admin/creation`: generation settings, spending, review queue, and private review pages.
- `/admin/accounts`: credit grants and account access.

Kiosk, game, and account actions return to their respective pages. Existing invite/creation URLs still work, and old `/admin?visibility=...` bookmarks redirect to Games. The shared layout and each data-loading page check admin access; server actions continue to authenticate independently.

Verification: 174 site tests passed across the suite and a retry of the invite database tests after the disposable PostgreSQL server finished starting. Site TypeScript, targeted ESLint, and the production build passed. Browser checks covered client navigation across all six sections, active menu states, kiosk pairing/rename, game feed controls and filters, invite creation, a persisted account credit grant, disabled creation settings, private game review/back navigation, all sections at 390px, and denied access to every admin page for a signed-in non-admin. No browser runtime errors were observed. All mutations used a scratch database and disposable Clerk test accounts; no live settings or accounts were changed.

Cleanup completed: both test accounts were deleted, the scratch database and browser/server were stopped, isolated build output was removed, and development configuration was restored. The user's server on port 3000 remains running.

## Admin account typeahead

The Account selector on `/admin/accounts` now searches current usernames (with or without `@`) and email addresses after two characters. The search uses environment-scoped profile queries and Clerk email lookup instead of preloading the 100 newest profiles. Each result shows the current username, matching or primary email, credit balance, and paused status. Broad searches show up to 10 matches and ask the admin to refine the query.

The combobox supports arrow keys, Enter, Escape, pointer selection, and a Change button. Editing the search clears the selected account and disables submission until another result is chosen. Requests are debounced and canceled as the query changes; delayed responses cannot replace current results. Loading, empty, and retryable error states are included. Leading/trailing whitespace does not leave the input stuck loading.

Email search is independently admin-authorized and returned with `Cache-Control: private, no-store`. Results exclude profiles in other environments and deleted Clerk identities. Account mutations still authenticate independently and now reject absent or unknown profile IDs rather than implicitly creating a profile. Credit grants retain their idempotency and audit trail.

Verification: all 192 site tests passed, including real PostgreSQL lookup, environment separation, invalid target, and duplicate grant cases. TypeScript, targeted ESLint, and the production build passed. Browser checks used live Clerk test identities and a scratch PostgreSQL database: username/email matching, keyboard/pointer selection, whitespace edits, selection invalidation, grant persistence and audit targeting, selection reset after success, empty results, retry, out-of-order responses, mobile layout, and guest/non-admin API denial. Desktop and 390px screenshots were inspected; no browser runtime errors were observed.

The two disposable Clerk accounts, scratch database, verification server/browser, and isolated build were cleaned up. Development configuration was restored and the user's server on port 3000 was left running.

## Deliberately later

Payments, separate display names/bios/uploads, arbitrary game editing, asset regeneration, and automated game moderation. Current game review is manual; generated versions are immutable. Favorites are not automatically applied after guest sign-in; the user returns to the game and confirms the heart action.
