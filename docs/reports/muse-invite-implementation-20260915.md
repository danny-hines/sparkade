# Muse implementation trial: invite credits

September 15, 2026. **Draft implementation; not ready to ship.**

Historical initial trial. The subsequent [smaller-task follow-up](muse-invite-small-tasks-20260915.md)
resolved the code/database blockers below and records current verification and remaining work.

## Outcome

Muse wrote the initial invite/credit domain, admin invite page/actions, and tests. Host review
found release-blocking defects, sent a correction round, and then inspected the saved changes
after that round hit the bridge's time limit. The current code fails the production build,
TypeScript checking, and real PostgreSQL redemption tests. No production data was changed,
no invitations were sent, and no paid generations were run.

This milestone covers the invite foundation only. Public signup integration, credit spending
and refunds, customer generation, ownership/publishing controls, and the Home/Play/Profile
redesign remain unfinished. The existing admin-only generation gate remains in place.

## Scope and artifacts

- `apps/site/lib/invites.ts`: invite codes, encrypted code storage, expiration/capacity,
  balances, ledger entries, redemption receipts, admin audit events, and consistency checks.
- `apps/site/app/admin/invites/`: create/list/copy/update/revoke controls and recipient history.
- `apps/site/app/admin/page.tsx`: link to invite management.
- `apps/site/test/invites.test.ts`, `invite-actions.test.ts`, `invites-postgres.test.ts`,
  and `pg-sql.ts`: domain/action tests and an opt-in database harness.
- `.env.example` documents the encryption secret; `vitest.config.ts` adds the site import alias.

Defaults in the draft are 30 credits, 20 recipients, and seven days. These are configurable
invite defaults, not a measured generation-cost budget. Signup links currently target a signup
flow that still needs implementation. The roadmap files predated this Muse implementation.

## Host verification of the saved code

| Check | Result |
| --- | --- |
| Site unit tests | 54 passed; nine database tests skipped by default |
| Targeted ESLint | Passed |
| `git diff --check` | Passed |
| `npm run site:typecheck` | Failed: test pool type lacks required `connect` method |
| `npm run site:build` | Failed: synchronous export in a `use server` module |
| Muse's opt-in PostgreSQL suite | One passed, eight failed; expiry test timed out |
| Independent host check using the real Neon client and PostgreSQL | Schema execution passed; all 12 attempted claims failed with SQL syntax error `42601` |
| Browser / Clerk signup / end-to-end generation | Not verified; implementation is not ready for those checks |

Database verification used a disposable PostgreSQL 17 container bound to loopback port 55439,
not the application's configured database. The independent check routed the actual Neon
client's transport to PostgreSQL in a unique temporary schema. It exercised the saved domain
without changing its SQL. Schema creation and invite creation/lookup executed, but redemption
failed before capacity, duplicate-callback, or expiry behavior could be established.

The opt-in suite subsequently stalled on its own row lock and timed out. The host cancelled
the blocked statements to release the test process; its cleanup hook therefore also reported
a cancellation error. The disposable container was removed after verification. No concurrency
or accounting correctness claim can be made from these results.

## Remaining blockers and corrections

1. **All credit claims fail.** `invites.ts:887` names a query expression `grant`, an unquoted
   reserved SQL keyword. PostgreSQL reports `syntax error at or near "grant"`. Rename it and
   execute the full redemption tests against PostgreSQL before trusting any accounting result.
2. **The site cannot build.** `admin/invites/actions.ts:27` exports synchronous
   `parseOperatorDateTime` from a `use server` file. Move the helper to a normal module or keep
   it unexported; rerun the production build as well as TypeScript.
3. **The database tests are not reproducible from a checkout.** They load `pg` unconditionally
   from `/tmp/sparkade-invite-verification/package.json`, including when the suite is skipped.
   That path was a host diagnostic dependency, not a project dependency. Their pool interface
   also omits `connect`, producing the TypeScript error. Use a declared test dependency and
   an independently reproducible setup.
4. **The expiry test blocks itself.** It acquires a row lock on one connection, then awaits an
   update of that row on another connection before releasing the first. Set up expiration
   before acquiring the lock, attach rejection handling immediately, and release locks in
   reliable cleanup. Test in a unique schema; loopback alone is insufficient justification
   for dropping shared table names in a supplied database.
5. **Expiry editing still mixes time zones.** The server supplies a server-local default
   datetime, while the client labels it as the operator's local time and submits the browser's
   current offset. Different server/browser zones can shift an unchanged expiry. The current
   offset can also differ from the offset at the chosen date. Convert the selected datetime
   in the browser and validate it on the server; verify across zones and a DST boundary.
6. **Test setup documentation is stale.** `.env.example` names `INVITE_TEST_*` variables;
   the saved harness checks `SPARKADE_PGTEST_*` instead.

After these repairs, verify simultaneous last-slot claims, same-account duplicate callbacks,
different-code races, expiry during lock contention, revocation, truthful audit records, and
balance/ledger reconciliation. Then verify the admin UI with an authorized test account.
Only after the foundation passes should signup call the redemption helper with eligibility
derived from trusted Clerk state rather than client-supplied booleans.

## How Muse performed

**Useful:** it created a coherent first draft, stayed within the bounded feature area, retained
the generation authorization gate, and responded to concrete review feedback. The correction
round fixed several inspected defects: schema statements now execute through `.query`, action
redirects sit outside exception handlers, different-code collisions are distinguished, and
the admin UI exposes exhausted-invite management and recipient identity.

**Insufficient:** the initial handoff reported green checks while SQL execution was unverified.
Its schema initializer had used Neon's interpolation-only `.unsafe` method as though it ran a
query; the host confirmed that this caused zero transport calls. Mock tests also missed the
redemption syntax failure. The correction round left new build/type errors and an unusable
database harness, then hit the deadline without a final handoff. This required substantial
host investigation and test infrastructure work; no allowance or cost savings were measured.

**Host/process contribution:** the first milestone combined a credit domain, concurrency,
cryptography, tests, and admin UI. That was too broad for a ten-minute turn to implement and
verify reliably. The correction request was also large. Muse's inability to access the Docker
socket complicated integration verification, though it does not explain the SQL/build errors.
One trial does not establish its reliability on unrelated tasks.

## Recommendation for this workstream and skill

Use the host to bring this credit/auth foundation to a passing state for the friends beta.
Continue experimenting with Muse on smaller tasks after an executable test harness exists.
This run does not justify relying on Muse as an unattended primary implementer for accounting.
It also does not justify abandoning it for all work.

Suggested skill iterations:

1. Preflight the actual test/database capabilities before delegating integration-heavy work.
2. Split accounting, admin UI, and signup into separately verifiable milestones; provide an
   explicit definition of done and stop expansion when it cannot fit the turn budget.
3. Require real SQL checks for database mutations and a framework build for server-action
   changes. Clearly distinguish mock coverage, skipped checks, and actual integration results.
4. Reserve time for verification and checkpoint before the deadline: saved files, remaining
   defects, commands/results, and a narrowly scoped next step.
5. Clarify the timeout policy. An interrupted turn with known saved edits needs a different
   continuation procedure from an uncertain submission that could duplicate work or usage.
   Any change to that policy should preserve user control and avoid automatic blind retries.

## Session record and pause

- Session: `01a0a684-9c0f-7dd6-8336-bfb0b891e9e4`.
- Model: Muse default `muse-spark-1.3-contributor`; authentication mode `account`.
- Muse CLI: `1.2.1`; bridge: `0.1.0`, build `f334672f28dc95eb`.
- Bridge started: `2026-09-15T19:02:33.511Z`.
- Initial implementation turn: completed, 419,085 ms (about seven minutes).
- Correction turn: cancelled with `time_limit_reached: true`, 593,425 ms (about ten minutes).
- Subscription eligibility and monetary/allowance savings were not verified.

The companion Muse skill instructs: "A turn is interrupted after ten minutes; report
`time_limit_reached`, inspect partial changes, and let the user decide whether more work is
needed." The host completed that inspection and preserved the draft without automatically
starting another Muse turn or taking over application implementation. Continuation needs the
user's choice under that skill rule. No commit or deployment was made.
