# Website live generation rollout

## Setup verified

- The existing Neon connection works; the development creation environment started disabled,
  with zero spend caps and no pending website generations.
- The existing private generation Blob store passed a write/read round trip. Anonymous access
  returned 403, and the temporary probe object was deleted.
- The local Meta credential can list both configured models: `muse-spark-1.3-contributor` and
  `muse-image-1.0`. This was a read-only availability check, not a generation request.
- Added the missing private Blob token, provider key, durable backend setting, separate local
  signing secret, and local Workflow callback URL to the ignored website environment file.
  Existing database, authentication, admin, and invite settings were preserved.
- Added the missing invite encryption secret to the Vercel preview environment.

## Preview deployment

Preview: <https://sparkade-qcliy4wgz-danny-hines-projects.vercel.app>

Deployment: `dpl_DAEkSzH4c5zxqtN6fQZLB9acapD9`.
Credit environment: `website-live-20260916`, separate from development and production.
The production deployment was not changed.

The first preview compiled and passed TypeScript but failed during Vercel packaging because
its dependency trace referenced the removed `.next/lock` file. Excluding that build-only file
from function traces fixed the deployment. The subsequent remote production build and
deployment succeeded; local site TypeScript, targeted ESLint, and diff checks passed.

Browser checks on the deployed preview passed with two dedicated Clerk test identities:

- Admin authentication and creation controls.
- New user starts at zero credits and cannot submit a game.
- Account typeahead can find the new user by email.
- An audited 30-credit test grant reaches the correct account.
- Creation remains disabled even after the grant, until an operator enables spending.
- No browser runtime errors were observed.

## Credit pricing presentation

Audited creation, owner progress/library, public feed/player/profile, sharing metadata, and
public game JSON. Website customers do not receive provider dollar costs; the existing cost
displays are in the admin creation controls and kiosk application. Public game responses use
an explicit field projection without the generation usage/cost ledger.

The creation form now explicitly says that creating a game costs the quoted number of credits,
including artwork and the playable world. The insufficient-balance message also names the
credit unit. Removed provider implementation wording from the owner's pending-review message.
Documented future checkout copy in the online-generation roadmap: pack purchase price, exact
credits, current credits per game, and complete-game count/leftover credits, with no implied
conversion to provider dollars.

Local browser verification confirmed the revised 10-credit copy and absence of dollar amounts.
Site TypeScript, targeted ESLint, and diff checks passed. These copy changes are local and were
not present in the preview deployed above.

## Real generation, review, and sharing

The user approved $5 per game, $10 per UTC day, and $10 cumulative for the isolated preview
test. Saved those limits through the admin UI and enabled creation in `website-live-20260916`.
Development and production creation settings were not changed. The dedicated test maker
submitted horizontal shooter `mpzktyc` (`j-5qGpIzXjiV3N`): 10 credits were held, its balance
became 20, and its public JSON returned 404 while pending review. Approved the friendly robot
mail-carrier premise through the admin UI; real generation was dispatched.

The workflow produced **Seedpost Skies** in roughly nine minutes, including bounded artwork
repairs. It completed 25 provider requests. The spend ledger recorded $0.190001 at the configured
rates, with no unresolved reservations; this is application cost accounting, not a provider
invoice. The user's price remained 10 credits throughout.

Reviewed the generated story text and all 12 images (four backdrops, enemy atlas, boss, player
craft, key art, and four story cards). All assets loaded. Advanced through the intro cards and
played the game with movement/fire controls in the admin preview, then approved its saved
version through the admin form.

Verified on the deployed website:

- Output approval captures the original 10-credit hold; maker balance remains 20.
- Anonymous public JSON returns 404 before approval and 200 afterward.
- An unlisted game works by direct link, including actual browser gameplay, all assets, the
  web manifest, and its landscape share image, while absent from its creator's public profile.
- The owner progress page and public JSON contain no provider-cost amounts or usage fields.
- Publishing adds the game to Home, Play, and the creator's public profile. These rendered
  public pages show no dollar pricing.
- Unpublishing removes it from the public profile while preserving direct-link access.
- No browser runtime errors occurred during the admin or anonymous play checks.

Demo retained unlisted at:
<https://sparkade-qcliy4wgz-danny-hines-projects.vercel.app/p/mpzktyc>.
Normal Vercel preview protection still applies; it has not been disabled.

## Failure/refund verification

Submitted `v2cygsy` with a friendly paper-airplane premise, reserving another 10 credits
(balance 20 → 10). Paused creation through admin before approving its input. The actual
Workflow then failed at the runnability check and released its credit reservation. Verified:

- Terminal job status `failed`, settlement `released`.
- Exactly one -10 hold and one +10 release for this attempt; balance restored to 20.
- Owner progress shows the returned credits, and reloading does not add another refund.
- Provider request count remains 25 and recorded spending remains $0.190001, so the failure
  test performed no additional model work.

The preview is paused after verification, with the approved caps preserved. No held jobs or
unresolved provider reservations remain. The production deployment and development creation
settings were not changed. The temporary Clerk admin was deleted, while the test maker and
unlisted demo are retained with their credit, moderation, and spend audit history. Closed the
owned verification browser; the user's local development server continues running.

This verifies one real horizontal-shooter generation; it is not a live-provider test of every
archetype. The updated credit wording remains local until the next deployment.

## Local creation enabled after verification

Danny reported that the local Create page still showed the paused message and requested that
the local experience work. Confirmed `development` was disabled with zero spending caps and
no held jobs; the provider, private storage, and local Workflow callback were configured.
Enabled creation for `development` with $5 per-game, $10 UTC-daily, and $10 cumulative provider
caps, preserving the existing 10-credit game price. Recorded the change in `admin_audit_events`
under `codex:local-setup` and verified the persisted settings. Existing account balances were
preserved. The isolated preview remains paused and production is unchanged.

## Optional website hero name

Added a separate optional Hero name field to Create, matching the kiosk's 48-character limit.
Names are trimmed and passed through the shared creation brief into the design prompt; blank
names let Spark choose. The brief survives checkpoints and retries, and the requested name is
visible on the owner's progress page and both admin review screens. Submission fingerprints
include a supplied name while preserving compatibility with earlier unnamed submissions.
The game price is unchanged.

All 195 site tests passed, including real-PostgreSQL checks for name persistence, exact prompt
content, retries, duplicate submissions, blank names, and overlength rejection before a credit
hold. Site TypeScript, targeted ESLint, and diff checks passed. Browser checks on a disposable
local PostgreSQL database verified desktop/mobile layout, named and blank submissions, owner
and admin displays, the unchanged 10-credit hold, and refunds. A named racing job completed
the durable mock workflow and retained its creation brief through output review. The mock
uses a fixed story fixture, so this does not verify name compliance by a live model. No paid
generation was run for this field, and no browser runtime errors were observed. These changes
remain local until the next deployment.

## Optional website photo capture and upload

Create now offers an optional hero photo, from either a webcam or a JPEG, PNG, or WebP upload
up to 4 MB. Users see the square crop before submitting and can replace, retake, or remove it.
Camera access starts on an explicit button click, requests no audio, and tracks stop on capture,
cancel, or component teardown. Late permission responses after cancellation are also stopped.
Denied/unavailable cameras leave uploading available. Form errors preserve the photo, name,
idea, and game type; browser verification caught and fixed a native form reset of radio inputs.

The browser reuses the kiosk's photo decoding/cropping helpers. The server independently checks
size, format, decoded pixel count, and image validity, then normalizes to a bounded JPEG and
strips metadata before holding credits. Photo bytes participate in submission deduplication and
are stored in the existing private checkpoint, so the shared personalization pipeline and retries
receive them. The credit price is unchanged. The private source endpoint requires its owner or
an authorized admin and denies other users, other environments, deleted games, and completed,
canceled, or rejected submissions. Owner progress and both admin review screens show the source
while eligible; published files contain only generated assets. Checkpoint retention continues to
use the existing generation maintenance cleanup.

Verification: 215 tests passed (207 site tests plus eight existing kiosk photo-helper tests),
including real PostgreSQL tests, image validation, access control, and photo preservation on
retry. Site TypeScript, targeted ESLint, formatting, and diff checks passed. Desktop/mobile browser
checks covered upload, invalid/corrupt/oversize inputs, removal and photo-free submission, form
error recovery, simulated camera capture/retake/denial/cancellation, and stopping late streams.
An uploaded golden portrait completed the actual durable mock racing workflow, produced a
generated portrait, and remained available privately through output review; the source was absent
from finished game files. Rejection refunded test credits and closed source access. No browser
runtime errors occurred. This verifies the integration with mock generation, not live-model likeness
quality or physical camera hardware. No paid provider requests were made for these checks.

## Optional website game idea

The game idea is now optional in the form and server action. Blank and whitespace-only input
reuse the kiosk's creation-prompt helper, asking Spark to invent the story, enemies, setting,
and visual style. The structured brief omits missing details while preserving the chosen type,
hero name, and photo. Owner/admin summaries show the explicit automatic-choice request.
Supplied ideas still have a 1,200-character limit, and existing submission fingerprints and
credit handling are preserved.

All 29 targeted PostgreSQL/domain and shared creation-prompt tests passed, along with site
TypeScript, targeted ESLint, formatting, and diff checks. Browser verification submitted an
empty idea with a name/photo/type, checked the saved brief and owner/admin summaries, then
canceled and verified the refund. No provider requests or browser runtime errors occurred.

## Three simultaneous website games

All website users, including admins, can now have up to three games with held credit charges.
Creation and retries share an admission lock, count active jobs, and check the balance before
reserving credits. The former unique index enforcing one active game was replaced with a
non-unique lookup index. The development database migration was verified without changing
existing jobs, balances, or spending caps.

The Create page shows active-game counts and progress links. At capacity, it allows drafting
while disabling submission, then automatically unlocks as a slot becomes available. Race-time
rejections report the actual blocker instead of listing unrelated possible causes.

All 228 site tests passed, including concurrent admin/regular-user submissions, duplicate
requests for the final slot, insufficient balances, retries racing new submissions, slot release,
and isolation between users/environments. Site typecheck, targeted lint, and diff checks passed.
Browser verification created three ordinary-user submissions, confirmed the fourth was blocked,
canceled one and verified its refund, then confirmed automatic unlocking preserved the draft's
hero name, story, game type, and photo. The next submission succeeded. No paid provider requests
or browser runtime errors occurred during this verification.
