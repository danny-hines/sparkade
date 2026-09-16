# Muse follow-up: smaller invite tasks

September 15, 2026. The invite/credit foundation now passes local code and database checks.
It is not yet a complete friends-beta signup or generation flow, and nothing was deployed.
This report supersedes the current-state conclusions in the
[initial implementation trial](muse-invite-implementation-20260915.md), which remains a historical record.

## Outcome

Muse repaired the draft through seven bounded tasks in the same session. The host reviewed
each handoff, supplied concrete failing cases, installed the declared test dependencies when
Muse's sandbox could not, and performed database/build/browser verification.

The foundation includes admin invite creation and management, configurable recipient/credit
limits and expiration, code/link copying, recipient history, revocation, zero-balance lookup,
and atomic signup-credit redemption with a ledger and one bonus per account. Redemption is
still a server-side helper: public signup does not call it yet. The customer generation gate
remains admin-only until credit-aware admission is implemented.

## Task results

Durations are bridge-reported turn durations, not total host effort or billing measurements.

| Task | Duration | Host result |
| --- | --- | --- |
| Rename reserved SQL expression | 1m 26s | Claims execute; concurrent recipient cap holds |
| Check expiry after acquiring the invite lock | 2m 49s | A claim waiting beyond expiry is denied |
| Make the PostgreSQL harness reproducible and isolated | 4m 26s | Declared dependencies; 11 tests pass; temporary schema removed |
| Repair admin expiry form and server-action export | 4m 34s | Production build passes; browser/server time zones separated |
| Reject invalid calendar values and preserve refreshed instants | 1m 25s | February 30/hour 24 rejected; exact untouched timestamps retained |
| Make admin audit payloads truthful under concurrent changes | 2m 31s | Records requested fields and actual database results |
| Correct an audit SQL parameter type | 30s | Revocation tests pass again after an explicit text cast |

Every turn completed normally. No time-limit interruption occurred in this follow-up.

## Verification

- **Final site suite: 76 tests passed**, including all 11 PostgreSQL integration tests.
- **Final site TypeScript check, targeted ESLint, production build, and diff whitespace check passed.**
- **Repository-wide `npm run verify` passed:** 1,950 tests, root typecheck, lint, and build.
  This broader run preceded the final audit-only repair; the complete site suite, site build,
  site typecheck, and relevant lint were rerun after that repair. The broader run skipped the
  11 database tests by default; the final site run explicitly enabled and passed them.
- The independent host diagnostic used the actual Neon client with its transport connected
  to disposable PostgreSQL. Seven checks passed: schema execution, recipient-cap concurrency,
  duplicate callbacks, competing-code redemption, expiry during a pure row-lock wait,
  environment/eligibility/capacity guards, and balance/ledger reconciliation.
- Browser verification used the actual `ExpiryForm` component in a temporary fixture, rendered
  on a UTC server and hydrated in an America/New_York browser. An unchanged form preserved
  `2027-05-01T12:34:56.789Z`; January and July selections used their respective time-zone
  offsets; the spring DST gap and blank input disabled submission; a refreshed timestamp
  preserved seconds and milliseconds. No hydration warning appeared in the browser console.
- The full-page local browser check encountered a **Clerk session-refresh redirect loop**.
  It was stopped without changing authentication or credentials. Full authenticated admin
  interaction remains unverified; the expiry fixture is not a substitute for that check.
- The site build still reports existing dynamic-filesystem tracing warnings from
  `packages/server/src/assets/manifest.ts`; they did not fail the build.

Database checks ran only against a disposable PostgreSQL 17 container bound to loopback,
with each harness run confined to a randomly named schema. The container and local browser
verification servers were stopped afterward. No production database changes, paid generations,
live invites, commits, or deployments were made.

### Running the database suite

Install workspace dependencies normally, provide a disposable local PostgreSQL database, then:

```sh
SPARKADE_PGTEST_ALLOW_WRITE=1 \
SPARKADE_PGTEST_URL=postgresql://postgres@127.0.0.1:55439/sparkade_invite_test \
npx vitest run apps/site/test/invites-postgres.test.ts
```

The harness requires both explicit settings, uses repository dependencies, and cleans up only
its own schema. It does not use the application's `DATABASE_URL`.

## Assessment of muse-implement

**Keep experimenting with it using small, testable tasks and host verification.** The narrower
scope prevented deadline failures and produced reviewable handoffs. Most turns stayed within
scope and clearly acknowledged database checks that the sandbox could not run.

It still required substantive host review. The host identified the lock-wait expiry bug,
incomplete date validation, and misleading audit snapshots. The audit repair introduced a SQL
typing regression that mocked tests missed; a real PostgreSQL run caught it immediately. Some
handoffs still used broad "all green" wording before integration checks. These were repairs
with precise host-supplied findings, so this experiment does not establish autonomous success
on a new feature or prove time/cost savings.

The host verification also needed correction: its temporary Neon transport initially serialized
PostgreSQL dates as JavaScript ISO strings instead of raw PostgreSQL wire text, producing a
false revocation failure. Correcting the adapter resolved that false result; the separate
lock-wait expiry failure reproduced afterward and was a real application defect.

Recommended skill changes:

1. Aim for a two-to-five-minute implement-and-check scope, with one clear acceptance boundary.
2. Preflight dependencies and local database access; let the host run unavailable integration
   checks rather than spending the turn repairing the agent's environment.
3. Make real SQL execution and framework builds required gates for relevant changes.
4. Report completed, skipped, blocked, and host-pending checks separately; avoid blanket green
   claims from mock-only tests.
5. Keep the same session for precise follow-ups, but checkpoint before the ten-minute cutoff.

## Next milestones

1. Diagnose the local Clerk redirect loop and verify normal sign-in/admin authorization.
2. Add public signup with invite-link/manual-code persistence through verification/OAuth;
   call redemption only with eligibility established from trusted Clerk state.
3. Add the zero-credit/payments-coming-soon experience and a visible balance.
4. Add credit reservation/settlement/refunds and spending limits before allowing customer
   generation; then ownership, publishing controls, and the planned Home/Play/Profile work.

No payments or editor work was introduced in this milestone. Invite-credit amounts remain
configurable defaults rather than measured provider-cost guarantees.

Session: `01a0a684-9c0f-7dd6-8336-bfb0b891e9e4`. Muse default model
`muse-spark-1.3-contributor`, account auth mode, CLI `1.2.1`, bridge `0.1.0`
build `f334672f28dc95eb`. No subscription, usage-saving, or billing claim was verified.
