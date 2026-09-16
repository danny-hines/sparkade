# Admin creation review bypass — September 16, 2026

Allowlisted website admins now start generation on submission and receive a playable, unlisted
result automatically. Other users retain both manual review gates pending the automated Spark
review follow-up in [the roadmap](../roadmaps/online-generation.md#admin-creation-and-automated-review-follow-up-september-16-2026).

The creation action uses the authenticated server admin identity, never submitted role fields.
An additive `admin_bypass` column records the policy on each generation (default false).
Successful completion atomically stores the immutable output version, approves public reads,
captures the existing credit hold, and completes the job. Both bypass decisions are audited.
Publishing remains an owner action. Existing caps, suspension, failure refunds, retries, source
photo privacy, and admin takedown gates remain in effect.

An admin can start their own previously queued game or recover interrupted dispatch from its
library page. Existing cron/admin queue recovery also handles approved, undispatched jobs.

## Verification

- All 221 site tests passed against disposable local PostgreSQL, including admin authorization,
  duplicate/concurrent completion, held/captured/refunded credits, retry policy, budget limits,
  unlisted visibility, stale/deleted/suspended jobs, integrity, and takedown behavior.
- Site typecheck, targeted ESLint, and diff whitespace checks passed.
- Browser: signed-in test admin submitted a racing game with an optional hero photo and name;
  the real local Workflow runtime, using mock providers, completed without manual approval.
  Verified one 10-credit charge, both audit events, anonymous playable canvas, unlisted state,
  private source-photo access, and admin takedown blocking both the page and hosted assets.
  No browser errors; no paid provider requests during verification.
- Existing development fighter `p7snw66` was already running when inspected. Verified its
  creator against Clerk and the configured server admin allowlist, then applied the persisted
  exemption with an audit event so its remaining output review will be skipped. Its existing
  submission, credit hold, workflow, and spending settings were preserved.

Automated AI moderation and deployment are not part of this change.
