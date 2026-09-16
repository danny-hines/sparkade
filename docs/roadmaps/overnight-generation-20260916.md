# Overnight implementation — September 16, 2026

Branch: `codex/overnight-generation`, starting at `dc4bbde` (also on origin/main).
Scheduled continuation: `sparkade-overnight-improvements`, hourly heartbeat on this task.
Pause that automation when all objectives and verification are complete.

## Objectives and acceptance

1. **Fighter AI:** reproduce new opponents' passive/repeated jumping behavior, fix the underlying
   control loop while preserving readable reactions and punish windows, cover all combat
   profiles/difficulties and legacy games with deterministic simulation tests and browser play.
2. **Automated review:** remove required manual input/output approvals. Review submitted name,
   optional photo and game idea before expensive work through Spark with a versioned policy:
   PG-13-or-lower; ordinary profanity and light sporting/fantasy violence allowed; sexual content,
   racist/homophobic/hateful content and other unsuitable material rejected. No identity-based
   exclusion of ordinary people/photos. Persist outcomes, refund rejection/failure, bound cost and
   retries, fail safely on service/parse errors, and keep admin inspection/takedowns. Review exact
   generated output before sharing as appropriate to preserve the content boundary.
3. **Generation feed:** owner-authorized progress with real persisted milestones, generated asset
   previews and concise review summaries. Reuse kiosk semantics. No private model reasoning,
   source photos, secrets, provider dollar amounts, or raw internal failures in public surfaces.
   Handle refresh/reconnect, deduplication, completion/failure and mobile/accessibility.
4. **Notifications:** persistent owner-only game outcome notifications, unread bell badge, mark
   read/open game controls, and deduplicated toasts across pages. Persist read/toast state across
   navigation; exclude other users/environments and avoid repeating historical toasts on login.

## Operating constraints

- Work directly; no subagents unless the user separately authorizes them.
- Existing website limits stay: 3 active games/user, credits held atomically, failure refunds,
  $5 per game / $10 UTC day / $10 total in development. Do not raise caps or change credentials.
- Preserve user's running dev/kiosk servers and games. Use scratch PostgreSQL, mock providers
  and owned browser sessions for tests; no production mutations or primary-branch push/deploy.
- Checkpoint coherent milestones locally, record checks and known limits, then deliver a final
  reviewable handoff. Existing source photo privacy, immutable outputs, owner publish/unpublish
  and admin takedowns remain enforced.

## Progress

- Initial repository inspection complete; clean starting tree.
- Fighter investigation: profiled AI returns early while airborne, freezing `aiT`, but a cached
  `jump` intent is reused on landing. Investigating a second ranged-control spacing dead zone.
- Fighter fixes implemented: consume jump/defense decisions once; ranged retreat reaches a real
  firing lane and holds its spacing while recharging. Regressions reproduced before fixing.
  Deterministic tests cover 4 profiles (including legacy) × 3 difficulties × 6 seeds × 4 starting
  distances plus existing guard/counter fairness. Browser gameplay remains for final verification.
- All four implementation objectives and verification are complete; see results below.
- Implementation checkout is `/Users/danny/sparkade-overnight`; the user's original checkout and
  servers at `/Users/danny/sparkade` remain on the previous checkpoint.

## Implemented website flow

- New submissions (including admins) use versioned `pg13-v1` automatic checks. The existing workflow
  sequence is unchanged: its claim step checks the submitted plot/name/photo before any build requests;
  its publication step checks the exact generated spec and a bounded contact sheet of finished images.
  Approval makes the game playable and unlisted; the owner still explicitly publishes to the feed.
- Decisions, model, version hash, attempt count and timestamps are persisted. A shared capacity slot,
  leased review record, two-attempt provider bound and existing per-request spending reservations
  protect replay/concurrency. Malformed or unavailable reviews fail closed. Rejected/failed games refund
  once; service failures allow the existing single customer retry. Rejected content cannot be retried.
- Existing games retain their legacy review/admin-bypass policy. No current live job or production
  configuration was mutated by this run. Legacy admin inspection/approval and takedowns remain available.
- Owner-only progress and preview endpoints project safe fields from persisted kiosk events. The feed
  includes concept/music decisions, stage updates, generated art, content-check milestones and outcomes.
  It catches up after navigation/offline periods and does not scroll away from older activity being read.
- Persistent notification history, unread badge, mark-read/all-read and cross-page toasts cover ready,
  rejected, failed and taken-down games. Server claims deduplicate simultaneous tabs; the first visit
  establishes a baseline without replaying historical toast messages. Latest 50 notifications are shown.
- Root authentication now stays mounted across public play pages as well as account/admin pages, keeping
  sessions fresh for notifications during longer play sessions. Polling pauses while the page is hidden.
- Account polling and the progress endpoint reconcile workflow-runtime failures once per minute per job,
  so refunds/notifications do not depend on the next daily maintenance run.

## Verification so far

- 240 website tests passed against isolated PostgreSQL; combined with fighter tests, 298 tests passed.
  Checks include strict review response validation, rejection/refunds, replay, output-version integrity,
  spending controls, source-photo/preview privacy, account/environment isolation, toast claims and reads.
- Both TypeScript checks and targeted ESLint passed.
- Browser: a non-admin submitted a fighter with name/photo/plot; both checks completed automatically;
  private art previews loaded; completion toast appeared on the Play page; bell persisted/read the update;
  final game stayed unlisted and was playable. Anonymous progress access returned 404. No page errors.
- Browser fighter: after story/tutorial screens, an idle player's health fell from full to roughly half
  over twelve seconds as the opponent approached and attacked. Seeded tests provide the broader
  profile/difficulty/distance coverage, including the ranged dead zone and jump-intent regression.
- Scratch artifacts: `/tmp/sparkade-overnight-verification/` (screenshots and test logs). Auth helpers
  live outside the repo; the test user already existed and was not removed or changed in Clerk.

## Limits / release notes

- Verification uses deterministic mock generation and explicit allow/reject fixtures. No paid provider
  requests were made; live Spark classification quality has not been calibrated in this run. Before a
  broad rollout, run a small labeled set covering profanity/MMA/ordinary portraits versus prohibited
  themes and prompt injection. An AI check is probabilistic, so admin takedowns remain necessary.
- Final image checks use 256px contact-sheet panels (at most 64 images) and the complete spec text
  (bounded at 160KB). Missing/oversized/unreadable content fails closed. Instrumental procedural audio
  is not sent for speech classification. No future manual editor is enabled by these changes.
- Notifications are in-app updates while the site is open, not email, OS push, or background browser push.
- Schema additions are idempotent. No payment integration, credit-price change, cap increase, deployment
  or primary-branch push is included.
- Final production build passed (`next build --webpack`), including workflow compilation and all new
  routes. The verification-only SQL transport initially wrote to stdout and confused TypeScript's
  `--showConfig`; removing that harness log resolved it, with no application workaround needed.
- Final browser session stayed authenticated on the public player beyond the normal token lifetime
  (70 seconds), received a new failure toast there, and did not repeat it after reload. Private feed
  auto-scroll was checked with image loading, deliberate upward scrolling and Jump to latest.
- A digit-boundary test caught PostgreSQL sorting the string-cast notification ID lexically. The query
  now orders by the underlying numeric column; the regression explicitly crosses IDs 99/100.
- Scratch browser/server/PostgreSQL have been stopped; screenshots/logs remain for reference.
  Original checkout `/Users/danny/sparkade` is clean and unchanged. No primary-branch push or deployment.
- Checkpoints: fighter fix `f2d6dd2`; the subsequent website commit contains automated review, feed,
  notifications, session/recovery fixes and this verification report. Scheduled continuation can pause.
