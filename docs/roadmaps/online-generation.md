# Online generation: friends beta, credits, and editing

Implementation update, September 16, 2026. The friends-beta website is implemented locally,
including invite signup, credit-backed generation, discovery/profiles, favorites/plays, and manual
content review. Paid creation defaults to disabled until an operator configures spend caps.
Deployment and a live provider smoke test remain operational rollout work. Payments and editing
remain later phases. See the [implementation and verification report](../reports/website-beta-implementation-20260915.md).

The requirements below preserve the original design plan; the report records exact shipped
local behavior and intentional beta simplifications.

## Launch target and proposed defaults

A friend can sign up through Danny's invite link or enter an invite code, receive initial credits,
create a game, return to its progress after closing the browser, and play or share the completed
game. Each account has its own game library within its profile. A game enters public discovery
only when its owner chooses Publish.

- Open signup. A valid invite link/code automatically grants initial credits at registration;
  registration without an invite starts at zero credits and shows a payments-coming-soon message.
- Admin-created invites specify credits per registration, a maximum number of recipients, and
  an expiration. Proposed defaults: 20 credited accounts and seven days from invite creation.
- Proposed pricing remains 30 initial credits per recipient and 10 credits per completed game:
  three games to start. These amounts are not yet confirmed. This is subsidized beta pricing,
  not a dollar exchange rate or provider-cost estimate.
- One active generation per website user; no automatic credit replenishment.
- Typed prompts and explicit game-type selection first. Enable only archetypes that pass
  current cost and reliability checks. Optional reference photos follow upload/privacy checks.
- New completed games are unlisted and playable by anyone with the link after content approval.
- Redesign Home and Play and add owner/public Profile views for the online launch. Include
  search, game-type filters, sorting, and a proposed Favorites interaction; see the
  [website experience plan](website-experience.md).
- Payments, voice input, a full editor, and arbitrary asset uploads come later.

Signup and permission to spend are separate. Friends should never need administrator access.
Invites are Sparkade credit offers; registration remains open. Keep invite redemption in the
application's database alongside the credit ledger. Manual admin grants remain available for
support and discretionary top-ups, rather than being the normal friend-onboarding workflow.

## Existing foundation and gaps

| Area | Already exists | Needed |
| --- | --- | --- |
| Authentication | Clerk public signup/sign-in, safe returns, private account balance, operator allowlist | Full owner/public profiles and generation authorization |
| Invites | Admin codes/links, expiry/capacity, encrypted pending signup, verified once-only grants | Deployment configuration and staging OAuth checks |
| Generation | Vercel Workflow jobs, checkpoints, owner-scoped requests/progress | Website creation flow, credit-aware admission and settlement |
| Costs | Provider usage records, price snapshots, shared concurrency | Customer wallet and enforceable provider-spend budgets |
| Sharing | `/p/{id}`, browser player, previews, listed/unlisted visibility | Owner publishing controls and moderation on every public surface |
| Library | Owner-scoped job history and an operator game list | Customer library with explicit game ownership |
| Website pages | Promotional Home and newest-first, cabinet-focused Play | Game showcases, searchable/filterable Play, owner/public profiles |
| Engagement | No shared favorite or browser-play metrics | Authenticated favorites, qualified play events, aggregate popularity sorts |
| Integrity | Strict schemas, code/URL rejection, asset hashes/manifests | Content moderation, immutable versions, edit attribution |

Relevant code:

- [`session/route.ts`](../../apps/site/app/api/generation/session/route.ts) already constructs
  `user:{id}` owners but restricts website sessions to the admin allowlist.
- [`generation/v1/[...path]/route.ts`](../../apps/site/app/api/generation/v1/[...path]/route.ts)
  implements create, sync, estimate, transcription, cancel, retry, and bundle access.
- [`generation/store.ts`](../../apps/site/lib/generation/store.ts) and
  [`steps.ts`](../../apps/site/lib/generation/steps.ts) implement durable jobs and recorded usage.
- [`public-games.ts`](../../apps/site/lib/public-games.ts) has kiosk identity and feed visibility,
  but no explicit website-user owner, content-review state, or immutable versions.
- [`validate.ts`](../../packages/server/src/pipeline/validate.ts) validates structure and rejects
  executable content; it does not classify offensive text or images.

The [cloud rollout guide](cloud-generation.md) and [verification report](../reports/vercel-generation-verification.md)
document the infrastructure and historical live tests. This review inspected code and those
reports; it did not reverify the deployment or run paid generations.

## Customer experience

- The [website experience plan](website-experience.md) defines Home, Play, Profile, navigation,
  favorites, popularity metrics, and deletion behavior as explicit launch work.
- `/sign-up` and `/sign-in` preserve the intended destination; default to `/me`, the owner's
  profile. Guest Create returns to `/create` after authentication. Preserve admin access separately.
- Invite links prefill an optional signup code and show the initial credit offer. The same code
  can be entered manually at signup. Preserve it through email verification and OAuth redirects.
- The owner Profile has Created and private Favorites tabs, credits, active/completed/failed
  games, and Create. Other visitors see only that creator's published, approved games.
  `/my-games`, if introduced, redirects to `/me?tab=created` rather than becoming a second library.
- Completed owner cards have Play, Copy link, Publish/Unpublish, and Delete with clear state labels.
  Delete makes the game unavailable; Unpublish preserves the direct link. The full editor comes later.
- `/create` collects a premise, hero details, and game type, then shows the fixed credit price.
  Add a typed-input source to the shared contract, which currently supports only `voice`,
  `preset`, and `surprise`.
- Submission immediately creates a recoverable library entry. Reloading, changing devices,
  or renewing the five-minute generation token must not start another game.
- Accounts registering without an invite start at zero credits. Show: "Buying credits is coming
  soon. Have an invite code? Enter it when you sign up to receive your initial credits."
  On the signed-in balance screen, use: "You're out of credits. Buying more credits is coming
  soon." For a new zero-credit account, use "You have 0 credits" instead of "You're out of credits."
  Keep existing public games playable; do not present a working checkout or purchase button yet.
- Use a safe public creator name. Never fall back to exposing an email address.

Keep job status, content approval, feed visibility, and deletion state separate. The feed rules
also apply to Home showcases, search, rankings, and other visitors' views of creator profiles:

| State | Owner's library | Direct URL | Feed |
| --- | --- | --- | --- |
| Generating / failed | Progress or recovery | Generic status; no private inputs | Hidden |
| Awaiting review | Review status and authorized preview | No playable content or share artwork | Hidden |
| Ready, approved, unlisted | Play/share/publish | Playable anonymously | Hidden |
| Ready, approved, listed | Play/share/unpublish | Playable anonymously | Visible |
| Blocked / taken down | Reason and support route | Unavailable, including previews | Hidden |
| Deleted | Removed from normal library; proposed Undo period | Unavailable, including previews | Hidden |

Unlisted means anyone with the link can play; it is not private storage or an authorization
boundary. Prompts, source photos, checkpoints, billing details, and internal errors stay private.

In the product, Publish means joining the feed. The existing `publishGeneration` step means
finishing and installing a game in public storage; it must not automatically list website games.
Set website games explicitly to unlisted without changing existing kiosk visibility/defaults.
Use `published_at` for feed ordering; repeated publish toggles should not bump an old game.
Profile privacy, private favorites, deletion semantics, and play/like definitions are specified
in the [website experience plan](website-experience.md).

## Invite-based signup credits

### Create and distribute

Add an Invites section to the admin portal, proposed route `/admin/invites`. An operator creates
an invite with an internal label, positive integer credits per recipient, positive integer
recipient limit, and expiration. Default to 20 recipients and seven days from creation, while
allowing the operator to choose different finite limits. Expiration uses database time; store
UTC timestamps and show the local date/time clearly in admin and signup screens.

Return a shareable signup link containing the invite code and the equivalent code for manual
entry. Both redeem the same invite and share one limit. Use a cryptographically random code,
normalize its display separators/case consistently, and rate-limit code lookups/redemptions.
Keep code-bearing URLs out of analytics and logs, avoid leaking them through referrers, and
remove the code from the visible URL once the signup flow has safely retained it.

For the proposed 30-credit offer, a 20-recipient invite authorizes at most 600 signup credits
(60 games at the proposed 10-credit price). Show issued credits and remaining possible grants
in admin. This is credit exposure, not a cap on provider dollars; actual spending limits remain
necessary. Anyone holding the code can claim an available slot, so these controls limit the
number and timing of redemptions rather than restricting them to named individuals.

### Signup and redemption

1. Opening a link or entering a code checks the offer and displays its credits and availability.
   Link previews, crawlers, visits, and abandoned registrations consume no slots.
2. Retain pending invite intent in server-controlled signup state through authentication and
   email verification. It is not a credit grant and does not reserve a slot. If a user changes
   the code, update that intent explicitly so an old link cannot override the new choice.
3. After a new account is authenticated and its email is verified (including a verified identity
   from a supported sign-in provider), finalize signup on the server. Recheck that the account
   is eligible, the invite is active, database time is before expiry, and capacity remains.
4. In one database transaction, claim capacity, record the redemption, append the invite credit
   grant, and update the account balance. The transaction grants all of the offered credits or
   changes nothing. Mark signup-bonus eligibility consumed with the successful grant.
5. Show a receipt such as "30 invite credits added" and the actual balance in the owner's Profile.
   Repeating signup finalization returns the existing receipt without another grant or slot.

The recipient limit counts distinct accounts successfully credited, not link visits or signup
attempts. Enforce one initial invite bonus per account across all codes; a second code cannot
top up an existing account. Existing users can receive discretionary admin grants. A newly
created account can finish a pending signup redemption after a callback interruption; this is
recovery of the same signup, not a general post-signup redemption feature.

Clerk account creation and the Neon credit transaction cannot be one transaction. Persist
pending completion and make the authenticated finalization safe to retry. If the database is
temporarily unavailable, show credits as pending and retry; do not silently lose the offer or
claim a grant succeeded. Do not grant based on browser-supplied user IDs, credit amounts, or
untrusted signup metadata. Delayed/duplicate auth callbacks must not create additional grants.

Availability is checked at redemption, not at first click. If the last slot is taken or the code
expires during signup, explain that no bonus was granted and let the user provide another code
or explicitly continue with zero credits. Invalid or revoked codes likewise do not prevent
ordinary registration. Do not show a successful bonus message before the transaction commits.

Invite expiry/revocation affects future grants only. Credits already issued remain available
under the normal credit policy. Deleting an account, refunding a game, or reversing a grant does
not automatically reopen an invite slot. Account limits do not establish one claim per human;
keep authentication abuse controls, rate limits, audit history, and the global spend cap.

### Admin monitoring and management

- List label, status (active, exhausted, expired, revoked), credits per recipient, redemptions /
  limit, remaining slots, total credits issued, creation time, expiry, and creating operator.
- Create invites and copy links/codes. Show redemption details: account, time, amount, and linked
  ledger entry, with access to that account's generation/spend history.
- Revoke immediately; extend expiry or change capacity with an audit trail. Capacity cannot be
  reduced below completed redemptions. Expired invites can be explicitly extended; revoked codes
  stay revoked. Rotate a leaked code while retaining the offer's redemption history and limits,
  or duplicate an offer as an explicitly new allocation with its own maximum credit exposure.
- Keep the per-recipient credit amount fixed once the invite has been issued; create a new offer
  to change it. Previously issued grants are immutable accounting events.
- Serialize redemption against revocation, rotation, expiry changes, and capacity changes so
  simultaneous requests cannot exceed the cap or use a code after committed revocation.
- Restrict all management actions and recipient details to operators. Public invite validation
  returns only signup-facing offer information, not the recipient list or internal notes.

Protect stored code material and redact it from normal logs. If codes are retrievable for later
admin copying, protect that representation server-side; a lookup digest alone is not sufficient
to recover the original code. Keep all invite, redemption, and grant records environment-scoped.

## Credits and protection for Danny's bill

### Separate credits from provider spending

Customer credits are integer grants, reservations, charges, releases, and refunds. Actual
provider spending includes failed jobs, retries, moderation, and eventually transcription.
Refunding customer credits does not erase provider spend. The existing usage ledger helps with
cost accounting; it is not a customer wallet or a complete bill. Track compute, storage, and
delivery separately, and treat unknown usage explicitly.

| Event | Credit behavior |
| --- | --- |
| Successful invite signup | Grant the configured bonus once, linked to the invite and redemption |
| Signup without a valid redeemed invite | Start at zero credits; show payments coming soon |
| Invalid/rejected input or insufficient balance | No generation charge; throttle checks themselves |
| Job admitted | Reserve quoted credits in the same transaction that creates the job |
| Identical resubmission | Return the original job/reservation |
| Automatic transient retry | Keep the reservation; no extra customer charge |
| Approved game becomes playable | Capture once, atomically with completion |
| Terminal failure or output rejection | Release once |
| Customer retries a terminal failure | Reserve the original quoted price again; reuse valid work within the retry-chain budget |
| Queued cancellation before paid work | Cancel and release atomically |
| Administrative refund after a charge | Add a compensating ledger entry with a reason |

Do not offer cancellation of running jobs in the initial customer UI; enforce that restriction
on the API too. Later, define an explicit cancellation price policy. Operator intervention can
stop a job, but in-flight provider requests can still finish and cost money.

Use database locks or atomic conditional updates, unique operation keys, and transactions.
Checking balance and then deducting in separate requests lets two tabs spend the same credits.
Make grants, captures, and refunds safe to repeat. Workflow retries require this explicitly;
see its installed [idempotency guidance](../../node_modules/workflow/docs/foundations/idempotency.mdx).

Commit the approved version, playable status, and credit capture together. Settle every terminal
path: pipeline-reported failure, workflow failure, cancellation, output rejection, and checkpoint
expiry. Recover undispatched jobs and orphaned reservations. Never release a hold just because
it is old: first establish a terminal state that prevents late completion.

### Spending controls required before invitations

- Website-generation feature flag and operator stop switch checked before paid work.
- Operator-set daily and total beta model budgets, plus per-job budgets spanning retries.
  Select dollar amounts before launch; this document does not configure or authorize spending.
- Reserve conservative cost allowances before each provider attempt, including parallel calls.
  Count settled costs plus in-flight and uncertain requests. A timeout is not evidence of zero
  spend. Bound tokens, images, and retries; reconcile allowances with known usage. Missing
  pricing prevents further paid work instead of counting as zero.
- Recheck account status, job status, credit hold, and spend allowance immediately before calls.
  A still-valid signed token is insufficient after an account has been suspended.
- One active website game per user, a small global website queue, and existing provider slots.
  Apply admission checks to retries too. Allocate kiosk capacity explicitly so website traffic
  cannot starve the cabinet or use kiosk routes to evade its own limits.
- Rate limits on creation, retries, rejected prompts, uploads, and content checks. Start with
  one customer-initiated resume per failed game, then operator review for repeated failures.
- Disable customer access to the paid transcription endpoint while voice is deferred; hiding
  the microphone does not close the spending path. Preserve the kiosk transcription policy.
- Admin view of grants, available/reserved credits, per-job/cumulative costs, unknown usage,
  failures, pending reviews, and controls to pause one account or new website work globally.

These controls bound authorized provider attempts; they cannot undo accepted charges or cap
unrelated hosting/storage costs. Reserve headroom and track those separately.

Historical verification recorded about $0.17 for several H-scroll games and $0.51 for one
platformer with cancel/resume. These are individual runs, not current price guarantees or
worst-case budgets. The estimator varies substantially by archetype and reference photo. Use
representative current runs and failures to calibrate launch limits.

## Ownership and minimum data model

Keep Clerk for identity and Neon for product state. Extend the existing game/job records.

| Record | Responsibility |
| --- | --- |
| `user_accounts` | Stable Clerk ID, active/suspended state, unique public handle, safe public display name |
| `credit_invites` | Environment, protected code material, label, credits, recipient cap/count, expiry, revocation, creator |
| `invite_redemptions` | Invite, stable user ID, grant amount snapshot, redemption time, unique ledger grant reference |
| `credit_signup_attempts` | Server-owned invite intent, eligible new account, recoverable finalization state (implemented) |
| `credit_signup_limits` | Shared signup rate-limit windows with hashed network/user identifiers (implemented) |
| `credit_accounts` | Environment/user, settled balance, reserved total, database invariants |
| `credit_ledger` | Append-only credit events: amount, operation ID, actor, reason, timestamp |
| `credit_reservations` | Job/operation, price snapshot, amount, held/captured/released state |
| `generation_jobs` additions | Reservation/charge-cycle reference, price version, operation kind, retry-chain budget |
| `public_games` additions | User owner/source type, current approved version, published timestamp, takedown/deletion state |
| `game_favorites` | Environment/user/game uniqueness, saved time; proposed source of aggregate likes |
| `game_play_events` / `game_stats` | Deduplicated qualified browser plays and aggregate counts for ranking |
| `game_versions` | Immutable spec/manifest, parent version, author/action origin, generation reference, content hash |
| `content_reviews` | Exact version/hash, decision, policy version, automated/manual reviewer, timestamps |
| Spend reservations/controls | Per-attempt allowances, uncertain costs, job/user/global limits, pause flags |

Derive credit balances from the ledger or maintain transactional cached balances with
reconciliation; do not create independently editable balances. Hold rows and ledger events
must agree. Admin grants use a stable user ID, idempotency key, and operator reason.
Invite grants use a unique signup-bonus key per environment/account, with database uniqueness
across all invites. Lock/conditionally update invite capacity and commit the redemption, ledger
grant, and balance together. Account eligibility and invite administration must participate in
the same transaction rules; application-only checks do not protect simultaneous redemptions.

Derive ownership from server-verified identity, never form fields. Check it on every job read
and game mutation, not just page layouts. Keep credit grants and moderation behind admin auth.
Preserve `kiosk:` versus `user:` ownership. Backfill user ownership only from verified job
relationships, not titles, names, or kiosk owners. Audit existing upload/publication routes so
legacy and kiosk credentials cannot overwrite website-owned versions. Customers must not get
trusted publication credentials.

Scope balances, credit operations, and spend limits by environment. Preview work must not use
production credits. Use additive migrations and preserve compatibility with in-flight workflows.

## Content integrity now, editing later

### Beta requirements

- Define a short content policy covering offensive slurs, targeted harassment, sexual content,
  and graphic violence in inputs, names, text, and images. Distinguish normal arcade combat
  from prohibited imagery so fighting games are not automatically rejected.
- Check inputs before generation and final text/assets before public upload and playability.
  Include story cards and share artwork. Schema checks and provider restrictions are not the
  full product policy. Evaluate the text/image moderation approach early in implementation.
- Uncertain or unavailable automated review leaves content pending and private for operator
  review. Manual review of every game is a temporary fallback for a small cohort, with a clear
  wait state in the UI. Approval before direct sharing is still required.
- Bind approval to exact spec and asset hashes. Store generated version 1 immutably with
  versioned or content-addressed asset paths. Current publication overwrites fixed public
  paths; an editor cannot safely reuse that behavior.
- Keep provenance in trusted server records. A client-provided hash or watermark is not proof
  of who created content; hashes are useful when compared with trusted records.
- Add Report a problem and operator takedown. Gate player, public JSON, feed, Open Graph
  metadata/images, and manifest. Remove blocked public Blob objects as appropriate and test
  cache expiry. Downloaded files and third-party screenshots cannot be recalled.

### Editor rollout

1. **Text fields:** title, description/tagline, and story copy through allowlisted fields,
   length limits, schema/security checks, and content review. Manual edits can be free with
   rate limits on saves and review calls.
2. **Regenerate a piece:** key art or one story card first, followed by sprites/animation sets.
   Quote credits for the operation and reuse credit reservation/settlement.
3. **Broader adjustments:** bounded gameplay fields after preview and validation tools mature.
   Arbitrary code and arbitrary external asset URLs do not fit this data-driven engine model.

Each edit creates a draft version. The approved version stays on the direct URL and feed during
editing/review. An explicit Apply update atomically switches to an approved version. Detect
concurrent edits instead of silently overwriting them; preserve history and rollback to approved,
non-blocked versions. A takedown must also prevent restoring a now-blocked historical version.

Shared pages and previews should show server-controlled provenance:

- "Generated with Sparkade" for an unchanged generated version.
- "Generated with Sparkade · edited by Alex" when there are manual changes.
- Record system regeneration separately from manual editing in asset/version history.

The original generated output can also be offensive, so version 1 needs review. Attribution
explains what happened; it does not replace moderation or prevent misrepresentation elsewhere.

Targeted regeneration needs dependency tracking: title changes may require updated previews,
story changes may invalidate card artwork, and sprite replacements must preserve dimensions,
atlas layouts, animation mappings, and collision assumptions. Price and review the actual
affected operation; replacing one visible asset may require more than one image call.

Successful-job cleanup currently removes intermediate prompts/responses and private reference
assets, retaining the final bundle. Before promising faithful regeneration of beta games,
retain a minimal private recipe: art direction, model/prompt versions, asset roles/dependencies,
and selected generated reference anchors. A prompt hash cannot reconstruct its contents.
Define retention/deletion rules; do not silently retain original photos forever. If a necessary
likeness reference has expired, the editor must request a new one.

## Payments later

A purchase joins invite bonuses and admin grants as another credit-grant source; generation
remains independent of the payment provider. Start with one-time packs when this phase begins.

- Create checkout sessions server-side from a fixed product/credit catalogue.
- Grant credits only from verified, confirmed payment events, once per purchase despite
  repeated events. A browser success redirect is not proof of payment.
- Record purchaser, payment ID, credit-pack/price version, and corresponding ledger grant.
- Define refunds/disputes for both unused and spent credits; handle delayed/out-of-order events.
- Preserve stable account identity; a reused email must not inherit someone else's credits.

Stripe Checkout is a plausible fit. Confirm its integration during that phase rather than
adding payment dependencies during the friends beta. Its [fulfillment guidance](https://docs.stripe.com/checkout/fulfillment)
explicitly covers repeated and concurrent fulfillment calls; deduplicate the resulting credit grant.

## This week's sequence

Expanded work sequence, not a verified delivery estimate. The three page redesigns, profiles,
search, and engagement add work to the earlier backend-focused scope. A small friend pilot is
still the end-of-week target; moderation, recovery, and verified ranking data are schedule risks.

1. **Page design and shared UI:** Home, Play, owner/public Profile, navigation/cards, mobile and
   desktop layouts, authenticated/guest/zero-credit states. See [website experience](website-experience.md).
2. **Accounts, invites, ownership, credits:** customer auth, signup code/link flow, profile handles,
   ownership migration, ledger/holds, atomic signup bonuses, admin invite management and grants, balance
   display, and payments-coming-soon states; verify that customers cannot use admin controls.
3. **Credit-backed creation:** atomic admission/settlement, spending caps, bounded retries,
   typed Create flow, recoverable progress within the owner's Profile.
4. **Discovery and profiles:** Home sections, Play search/type filters/sorts, public creator pages,
   private Favorites, play recording, aggregate stats, and ownership-aware game cards.
5. **Approved sharing and management:** input/output checks, immutable originals, owner publish/
   unpublish/delete, creator attribution, all public read gates, reporting/takedown, cache updates.
6. **Recovery and pilot:** concurrency/failure tests, staging browser checks with two users,
   bounded real-provider sample, production configuration, then onboard a few friends.

If time is tight, reduce supported archetypes, omit photo/voice, and use explicit manual review.
Keep ownership checks, finite credits, spend controls, and approval before sharing. Include the
redesigned pages with Recent, search, filters, and profile management in any reduced pilot scope;
enable Top/Most played once engagement is verified instead of displaying invented rankings.
Payments, sophisticated trending, and the full editor should not delay the beta.

### Acceptance checks before invitations

- Link signup and manual-code signup each grant the configured initial credits after verification;
  signup without a code succeeds with zero credits and the payments-coming-soon placeholder.
- A 20-recipient code never credits a 21st account, including concurrent claims for the last slot.
  Visits, link previews, failed verification, and abandoned signups do not consume capacity.
- Expiry, exhausted capacity, and revocation show accurate signup states and prevent new grants.
  Test the exact expiry boundary, a code expiring during OAuth, and revocation racing redemption.
- Duplicate callbacks, refreshes, and signup retries create one bonus/slot; multiple different
  codes cannot produce multiple signup bonuses for the same account. Existing accounts cannot
  redeem signup offers. Invalid codes never silently grant credits or block ordinary signup.
- A database failure after auth signup leaves a recoverable pending grant; a retry after commit
  returns the receipt even if the invite has subsequently expired. Ledger/balance/capacity cannot
  partially commit, and account deletion or refunds do not silently reopen slots.
- Admin can create, copy, inspect, revoke, extend, change capacity, and rotate invites with an audit
  trail; non-admins cannot. Credits already granted survive invite expiry and revocation.
- Concurrent submissions cannot overspend the last credits; identical submissions create one
  job/reservation/charge. Repeating a grant or refund also has only one effect.
- User A cannot read B's private jobs, inputs, or wallet, or alter B's game visibility.
- Refresh, logout/login, session expiry, and workflow retries preserve one recoverable game.
- Terminal failures release once; retries require a hold; cancel/completion races cannot yield
  a free playable game or charge for a failed result. Test reconciliation of stranded holds.
- Retry/transcription/upload/moderation paths cannot bypass budgets; uncertain provider calls
  stay accounted for, and stop controls prevent new paid attempts.
- A ready approved game plays anonymously at its URL, enters the feed only on Publish, and
  leaves the feed on Unpublish while retaining its playable link.
- Run the [website acceptance checks](website-experience.md#verification): guest Create redirects,
  search/filter/sort, owner/public Profile isolation, favorites/play deduplication, deletion,
  public cache behavior, responsive layouts, and direct gameplay.
- Pending/rejected content cannot escape through public APIs, previews, manifests, or raw
  pre-approval asset URLs. Existing upload routes cannot replace approved bytes.
- Takedown gates all hosted public surfaces and prevents republishing; cache behavior is tested.
- Preview balances are isolated, existing kiosk behavior passes regression checks, and eventual
  code changes pass the repository's required verification.

### Decisions to finalize before launch

- Initial invite grant amount and game price; proposed starting point is 30 credits / three games
  each. Signup is confirmed open, with invite-based initial credits and zero-credit direct signup.
- Default invite capacity/lifetime; the requested example is 20 credited accounts over seven days.
- Daily/total dollar budgets, per-job caps, and archetypes passing cost/reliability checks.
- Moderation policy/provider and whether initial games can wait for manual review.
- Whether reference photos and the retained regeneration recipe are in this week's scope.
- One heart action for both likes and Favorites (recommended) or separate actions; proposed play
  thresholds and whether engagement is ready to power Top/Most played for the initial pilot.
