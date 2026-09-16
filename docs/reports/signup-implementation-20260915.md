# Public signup and invite credits

September 15, 2026. Implemented directly in the existing working tree; not deployed.
This extends the earlier invite/admin foundation. Muse was not used for this milestone.

## Result

- `/sign-up` accepts an optional code, including a code prefilled by an invite link. An explicit
  Continue saves the choice before Clerk registration and redirects to a clean URL. The next
  screen shows the available credit offer. Visits and abandoned registrations consume no slots.
- An opaque seven-day HttpOnly, SameSite=Lax cookie identifies a server-owned signup attempt.
  The token is hashed in PostgreSQL; the selected invite is encrypted. Signup pages specify
  `no-referrer` and `noindex` and do not load Clerk's form until the choice is saved.
- Completion is an authenticated Server Action, never a GET/render/prefetch side effect.
  Clerk's backend supplies the user ID, account creation timestamp, and primary-email
  verification. Form values and editable Clerk metadata cannot supply eligibility or amounts.
- A new user can bind an attempt created before their account. Attempts expire in seven days
  and bind to at most one account; an account binds to at most one attempt per environment.
  Timestamp comparison is strict and fails closed; infrastructure clocks need to be synchronized.
- The signup row is locked before the invite row. Capacity, redemption, ledger, wallet, and
  completed signup status commit together. Retrying returns the same receipt. Changing a code
  or declining the offer cannot race a grant or reopen completed eligibility.
- Failed/expired/revoked/full offers remain pending: retry, enter a replacement, or explicitly
  finish without invite credits. Once bound, pending completion can be recovered by account
  even if the cookie disappears. No-invite signup completes with zero credits.
- `/me` requires authentication and displays the owner's balance, pending-signup recovery,
  account menu, a payments-coming-soon message, and a link to Play. It is the initial account
  screen; the full games/favorites profile is still future work.
- Sign-in defaults to `/me`, preserves allowlisted application destinations, and retains
  explicit admin return paths. Home now links to Sign in and Join. Customer identities do
  not gain admin or generation permissions.
- Shared database rate limits: 200 attempts per minute globally per environment, 20 per
  anonymous network, and 30 per authenticated account. Outside Vercel, anonymous callers share
  the anonymous bucket; Vercel's forwarded network identity is hashed. Authenticated limits run
  before the Clerk backend lookup. Old counters and expired unbound attempts are cleaned up.

## Verification

- Repository `npm run verify`: passed, 184 test files / 1,998 tests, including real PostgreSQL.
  After final rate-limit ordering and responsive-layout refinements, the site suite passed
  111 tests, including 22 real PostgreSQL tests; site typecheck, ESLint, and production build passed.
- Database checks cover concurrent duplicate callbacks, one bonus across competing invites,
  capacity limits, expiry while blocked on a row lock, existing/unverified accounts, environment
  isolation, cookie-free recovery, code replacement, declining while a grant runs, and an
  intentionally failed wallet update that rolls back the entire grant and leaves signup pending.
- HTTP/action tests cover forged user/eligibility/credit fields, signed-out requests, safe
  redirects, cookie flags, private errors, pending-state preservation, and throttling before
  provider calls.
- Browser checks used the real production Next server, actual Clerk development authentication,
  and a disposable local PostgreSQL database behind a temporary Neon HTTP transport adapter.
  The app's auth, signup, and grant code ran unchanged. No test hooks or auth bypass were added
  to the application. The temporary harness lives outside the repository.
- Clerk's official testing helper and reserved `+clerk_test` addresses exercised email-code
  verification without sending real verification emails. See Clerk's
  [test-address documentation](https://clerk.com/docs/guides/development/testing/test-emails-and-phones)
  and [testing-token documentation](https://clerk.com/docs/guides/development/testing/overview).
- Browser outcomes: invite saved with a clean URL; 30-credit receipt after verification;
  `/me` balance of 30; repeated completion returned the receipt; a second signup without an
  invite showed 0 and the payments placeholder; following a signup link while signed in did
  not top up the account; the customer was denied `/admin/invites`.
- Database reconciliation after the browser flows: one credited signup, one zero-credit signup,
  one ledger grant for 30, one redemption, and exactly one used slot on a one-recipient invite.
- Desktop and 390px mobile screens were inspected. Fixed grid sizing and Clerk card widths
  after discovering clipped mobile content. Clean localhost sessions loaded the auth screens;
  the earlier local redirect-loop warning did not prevent verified signup in this run.
- The final mobile account fits without horizontal overflow and its account menu exposes
  Manage account and Sign out. Both reserved Clerk test accounts were deleted (zero remain),
  and the temporary browser, application server, and disposable database container were stopped.
- The build still emits existing generation asset filesystem-tracing warnings. They are outside
  this change. Live OAuth, another-device recovery before the first binding, and production
  Clerk settings were not exercised. Before first binding, recovery needs the original cookie;
  after binding, it uses the authenticated account.

## Before rollout

1. Configure the matching Clerk instance keys, dedicated signup/sign-in URLs, and redirect
   defaults listed in `apps/site/.env.example`. Enable public registration and verified email
   (including verified primary email for supported OAuth providers). Check the app's branding
   and OAuth callbacks in staging.
2. Configure a durable server-only `SPARKADE_INVITE_CODE_SECRET` in every intended environment.
   A persistent secret is now configured in the ignored local `.env.local` for manual testing;
   automated verification used a separate disposable process override.
   Do not rotate it casually: pending signup choices and stored invite codes use this key.
3. Use the correct database and credit environment; do not mix preview and production balances.
   Schema setup is additive and follows the existing lazy initialization convention.
4. Redact invite query values in hosting/request logs and keep signup URLs out of analytics.
   Application errors exclude raw codes and provider responses; initial inbound link URLs may
   still appear in infrastructure logs before the clean redirect.
5. Complete credit-backed generation admission/settlement, provider spend limits, ownership,
   moderation and sharing rules, and the remaining website work before inviting friends to
   generate games. This milestone does not enable customer generation or payments.

## Implementation approach

Direct implementation was appropriate for the coupled Clerk/accounting transaction boundary.
Real database and browser checks still found integration issues that static review missed:
cross-clock test assumptions, local Neon transport setup, and mobile layout sizing. These were
ordinary implementation/verification costs, without Muse handoffs or overlapping implementation
and host-review loops. There is no measured counterfactual usage saving. Keep Muse optional for
small tasks with a fixed contract and a cheap, decisive check.
