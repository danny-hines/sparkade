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
- Remaining: automated review, feed, notifications, and complete verification.
- Implementation checkout is `/Users/danny/sparkade-overnight`; the user's original checkout and
  servers at `/Users/danny/sparkade` remain on the previous checkpoint.
