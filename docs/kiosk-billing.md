# Per-kiosk Meta API credentials

Kiosks can use their own Meta API key for cloud generation. Save a named credential and assign it
to one or more kiosks from **Admin → Kiosks**. Kiosks with no assignment continue using the site's
shared `META_API_KEY`.

## Server setup

1. Use the site's Vercel generation backend (`SPARKADE_GENERATION_BACKEND=vercel`).
2. Generate a storage encryption secret with `openssl rand -hex 32` and set it as the server-only
   `SPARKADE_KIOSK_META_SECRET` environment variable on the site. Use distinct secrets for
   production and preview; never expose this variable through `NEXT_PUBLIC_*`.
3. Deploy the updated site. Tables and job columns are created automatically through the existing
   schema initialization mechanism. Existing kiosks continue using shared billing until assigned.
4. In **Admin → Kiosks → Meta API credentials**, enter a name and the Meta API key. Assign
   that saved credential in each kiosk's **Meta API billing** section.

Portal already uses cloud generation and needs no new kiosk build for this feature. Pi cabinets
must use `SPARKADE_GENERATION_MODE=cloud`; local generation still uses local provider settings.
The retired standalone cloud worker does not support these overrides, and the console rejects
assignments unless the Vercel backend is enabled.

Keep the encryption secret backed up and stable across deployments. Changing it makes existing
credentials unreadable. To recover, restore the original secret or replace each affected API key
in the console so it is encrypted with the new secret.

## Billing behavior

- New jobs capture the kiosk's current credential assignment. Transcription uses the current
  assignment for each request. Text, image generation/editing, voice transcription and its fallback,
  and Meta segmentation calls all use the same request-specific Meta key.
- Running jobs and retries keep their captured credential reference even when a kiosk is reassigned
  or returned to shared billing. Jobs created before this feature bind once at their next provider
  request. Raw keys never enter workflow inputs, checkpoints, kiosk responses, or session tokens.
- **Replace key** keeps the same credential reference. All associated kiosks and unfinished jobs
  use the replacement on their next request. An already-running provider request may finish with
  the previous key.
- **Disable credential** deletes the encrypted key and blocks subsequent requests associated with
  it. It does not revoke the key at Meta. Disabled credentials cannot be re-enabled; save a new
  credential and assign it to the kiosks for future jobs.
- Authentication failures, exhausted quota, disabled credentials, and decryption failures never
  cause automatic fallback to the shared key. **Return to shared billing** is an explicit admin
  action and affects only new jobs and voice requests.
- Saving checks key format and storage configuration, without making a paid request. Meta verifies
  the key's validity, quota, and model permissions when a kiosk first uses it.

Credentials and assignments are separated by production/preview scope. Storage uses AES-256-GCM
with each credential's identifier and environment authenticated alongside the ciphertext. The
console returns only names, identifiers, last four characters, status, assignment counts, and billing
summaries. Create, replace, assign, clear, disable, and limit changes record non-secret audit events.

Billing mutations require the admin allowlist and ownership of the affected kiosk/credential.
The billing authorization entry point is separate so future scoped kiosk managers can receive
operational permissions without automatically receiving billing authority. Scoped admin accounts
and billing permissions themselves are not part of this change.

## Spend and limits

Every saved credential and the built-in shared key has **Today**, **This week**, **This month**,
and **Tracked lifetime** spend in Admin → Kiosks. The shared key includes website generation,
input/output content checks, and cloud kiosks without overrides. All kiosks assigned to one saved
credential share its totals and limits. Replacing a key keeps its history and limits; disabling it
keeps its history visible.

Amounts are estimates in USD using Sparkade's saved model pricing, returned token usage (including
cached-input discounts), returned image counts, and voice duration. They are not a Meta account
balance or invoice. Tracking starts with this deployment; earlier requests, local Pi generation,
and use of the key outside Sparkade's cloud service are not included. The console shows when the
first tracked request occurred. Reload the page to refresh totals.

Reserved amounts appear separately from estimated spend. Before each HTTP attempt, the service
atomically reserves a conservative cost and acquires per-key capacity. The reservation is replaced
with the estimated charge when usage is known. Timeouts, failures, and missing usage retain the
reservation because the request may have been charged; they still count against budgets. Every
retry or model fallback gets its own reservation. A workflow replay that reuses a saved result
does not add a charge. Requests rejected before HTTP dispatch release their reservations.

Use **Budgets and request limit** to set optional daily and weekly USD caps and a concurrent request
limit. Blank means no additional cap; a $0 budget pauses paid requests. Existing global/per-kiosk
capacity limits and website spending limits still apply. Shared-key limits affect both website and
kiosk requests, and require billing admin access.

Calendar periods use `America/Los_Angeles`, including daylight-saving changes. Daily budgets reset
at midnight; weekly budgets reset Monday at midnight. Monthly reporting starts on the first of the
month. Resets are calculated from request timestamps, preserving history without cron jobs or
counter deletion. A request's spend belongs to its admission period even if it finishes later.

Existing jobs wait when a key lacks capacity or budget: capacity is checked again after 10 seconds,
budgets after five minutes. Waiting does not consume the four paid-attempt allowance. New kiosk
jobs at an exhausted budget and busy/over-budget voice requests return HTTP 429 with an explanatory
message. Increasing a limit lets waiting jobs continue on their next check. In-flight requests can
finish after a limit is lowered. No limit failure switches to the shared key.

Missing model pricing blocks the request. If returned usage exceeds its reservation, the recorded
estimate is updated and that key's billing is paused; review pricing and use **Save limits and resume**
to restart. Limits are safeguards based on Sparkade's pricing estimates and tracking scope.

## Local verification

The automated integration test uses a disposable local PostgreSQL database and mocked Meta
responses; it exercises real credential queries, cloud job admission, provider workflow steps,
and transcription without paid API requests. Point these variables only at a disposable local
database:

```sh
SPARKADE_PGTEST_URL=postgresql://postgres@127.0.0.1:55447/kiosk_billing_test \
SPARKADE_PGTEST_ALLOW_WRITE=1 npx vitest run \
  apps/site/test/kiosk-billing-postgres.test.ts \
  apps/site/test/kiosk-billing-actions.test.ts \
  apps/site/test/kiosk-meta-secret.test.ts \
  apps/site/test/meta-request-cost.test.ts \
  apps/site/test/website-spend.test.ts \
  apps/site/test/arcade-postgres.test.ts \
  packages/server/test/meta-credential-context.test.ts \
  packages/server/test/provider-request-policy.test.ts
```

For a manual check against a real Meta key, save and assign a test credential, then make a voice
request and generate a game from a registered cloud kiosk. Disable the credential and confirm
the kiosk reports an error. Explicitly return that kiosk to shared billing to restore its previous
behavior for new requests. These manual generation requests incur normal Meta usage.
