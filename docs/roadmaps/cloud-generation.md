# Generation on Vercel

Sparkade's existing Next.js Vercel project runs the generation API and Vercel Workflows.
No separate container host, persistent disk, or cloud SQLite database is required.

## Runtime

1. The registered kiosk obtains a five-minute generation session from `/api/generation/session`.
   Website sessions are currently restricted to the existing Clerk admin allowlist.
2. `/v1/jobs` validates the creation brief and records an owner-scoped idempotency key in Neon.
   The reference photo and initial checkpoint go to a separate **private** Blob store.
3. A workflow claims the job. Processing steps reconstruct a temporary working directory,
   reuse validated specs/assets, and identify missing model responses. Independent model
   requests run as separate durable steps. Completed responses are persisted before continuing.
4. Neon holds the canonical job, attempts, progress, usage ledger, workflow ownership and
   shared expiring provider slots. Blob holds checkpoints and model inputs/outputs; these
   large payloads are not copied into Workflow arguments or event streams.
5. Publication uploads only manifest-declared runtime assets to the existing public Blob store.
   The public game and downloadable bundle become ready atomically in Neon. Cancellation
   is serialized against this final transaction.
6. The kiosk uses one cursor-based batch poll, then downloads and hashes assets serially.
   Installation is atomic. A disconnect, reboot or partial download does not regenerate a game.
   Gameplay remains local and works offline after installation.

Voice recordings also travel to Vercel. The generation API bundles FFmpeg to convert browser
WebM/Opus recordings to WAV before calling the transcription provider; it does not depend
on an FFmpeg installation in the Vercel base image.

The processing adapter reuses the existing generation and image-validation code. It does
not hold a server function open for an entire generation. It may repeat deterministic
processing between checkpoints, but persisted provider responses are reused without paying
for the same completed request again. A provider accepting a request immediately before a
crash, before its response is persisted, remains an unavoidable at-least-once boundary unless
that provider supports idempotency. Usage records cover every persisted provider response,
including results completed after cancellation.

## Vercel configuration

Use the existing `sparkade` project with the repository root as its Vercel root directory,
`npm run site:build` as its build command, `apps/site/.next` as its output directory, and Node 24.

| Variable | Purpose |
| --- | --- |
| `SPARKADE_GENERATION_BACKEND=vercel` | Enables the Vercel generation endpoint |
| `SPARKADE_GENERATION_SECRET` | Random server-only signing secret, at least 32 characters |
| `META_API_KEY` | Existing Meta model credential; never sent to the kiosk/browser |
| `DATABASE_URL` | Existing Neon database |
| `GENERATION_BLOB_READ_WRITE_TOKEN` | Separate **private** generation store |
| `BLOB_READ_WRITE_TOKEN` | Existing **public** finished-game store |
| `CRON_SECRET` | Authentication for the daily maintenance endpoint |
| `SPARKADE_CLOUD_CONCURRENCY=1024` | Global leased model-request slots; no fixed 32-slot ceiling |
| `SPARKADE_CLOUD_OWNER_CONCURRENCY=16` | Maximum slots shared by any one kiosk/user's games |
| `SPARKADE_CLOUD_MAX_PENDING_JOBS=10000` | Admission ceiling for the website queue and the kiosk API's active-job check |

These are defaults; environment overrides must be positive integers. The request cap manages
provider and service capacity independently of website spending budgets. It can be raised as
provider quotas and load tests allow; 1,024 simultaneous requests is not a guarantee of 1,024
games generating at full speed. Each game makes multiple model calls, and per-owner slots are
shared across their active games. Thousands of simultaneous generations require sufficient
provider quota and measured database/workflow capacity, as well as these configurable limits.

Use different generation signing secrets in preview and production. Jobs and object paths
are scoped by environment; preview publications are unlisted. Existing public-game storage
credentials must not be replaced with private-store credentials.

The workflow snapshots generation configuration when a job is created. Completed games from
the same owner supply the anti-repetition context; another owner's private prompts and game
history are never included. Retries use a new attempt namespace and preserve completed
validated work from the previous attempt. Actual provider attempts are capped at four per
request; waits for shared capacity do not spend that provider retry budget and can continue
for up to a day during a backlog. There are at most
50 pending games per kiosk owner and, by default, 10,000 active jobs in the kiosk API's admission
check. Website admission allows three active games per user and 10,000 across its queue.
Admission and provider-slot claims use database
transactions, so multiple server instances cannot exceed these limits through a race.

The daily Vercel cron removes successful-job intermediates missed by immediate cleanup and
expires failed/canceled checkpoints after seven days. It retains final game bundles/assets.
Expired jobs require a new creation request. Generation metadata and cost history remain in
Neon. The cron only runs in production; preview test artifacts need explicit cleanup.

## Rollout

1. Deploy a preview and test the authenticated image probe and a real complete generation.
2. Verify replay, cancellation/retry, ownership, shared concurrency, publication and downloads.
3. Configure production secrets and deploy the site. Keep existing workflow deployments
   available until their in-flight runs finish; runs are pinned to their deployment.
4. Update the kiosk application, retain its registration and game data, and add
   `SPARKADE_GENERATION_MODE=cloud` to its service environment. Restart only when no game is
   being played. Check cloud progress and installation while another installed game runs.
5. To roll back the kiosk, remove the cloud-mode setting and restart. Installed games remain.

The retained standalone service module is a local integration-test harness for the shared
kiosk protocol. The Render/Docker deployment template has been removed; it is not part of
this deployment. The public website uses credit-backed server actions and a separate review
queue, described below and in the [online-generation roadmap](online-generation.md).

## Website generation

Signed-in website users submit through `/create`; they do not use the admin-only generation
session endpoint above. Submission reserves credits and creates an owned, unlisted game.
Each user can have up to three active games, subject to available credits and shared spending
caps. Allowlisted admin creators bypass input and output review: submission starts the durable
workflow immediately, and successful completion makes the exact generated version playable.
Other users' ideas and finished games still require approval at `/admin/creation` until automated
review is implemented. Assets remain in private storage behind the public-read approval gates.
The owner can play, share the direct link, and separately publish to public discovery.

Before enabling a credit environment, configure the backend and private Blob token above,
the provider credential, Clerk, Neon, and `SPARKADE_INVITE_CODE_SECRET`. Set finite per-game,
daily, and total provider caps in `/admin/creation`. Defaults are disabled with zero caps.
The website's local Next.js process reads `apps/site/.env.local`; the root `.env` used by the
kiosk/server does not automatically supply its model key. Local Workflow callbacks should use
`WORKFLOW_LOCAL_BASE_URL=http://localhost:3000` (or the actual local port).

Pull remote development variables into a temporary file and copy only missing values into
an existing local environment file; preserve the existing database, Clerk, and invite secret.
Vercel Secret values cannot be pulled back and appear as `[SENSITIVE]` placeholders. These
placeholders are not usable credentials. Use the existing local provider key and a separate
local generation signing secret instead.

The Next.js production build uses Webpack. Its temporary build-lock file is excluded from
function traces because Next removes it before Vercel packages the deployment.
