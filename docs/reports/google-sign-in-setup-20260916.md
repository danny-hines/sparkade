# Google sign-in setup — approved publication plan

Snapshot before production rollout on September 16, 2026. The user approved publishing the reviewed privacy and terms pages and finishing Google sign-in. Provider status and validation below describe the pre-rollout state.

## Provider configuration

- Clerk application: `clerk-byzantium-ball` (`app_3Imfcr4sRtYOT8GRWyswbumTTfl`).
- Production instance: `ins_3ImfcocBaJatXfuAeKALekxjnGT`, frontend `clerk.sparkade.dev`.
- Development instance: `ins_3ImfcobZv65vnsP157dHEyLJyef`; Google was already enabled with shared credentials.
- Google Cloud project: **Sparkade**, project ID `robotic-gasket-508819-h8`.
- OAuth client: **Sparkade Production**, Web application.
- Authorized origin: `https://sparkade.dev`.
- Callback: `https://clerk.sparkade.dev/v1/oauth_callback`.
- Google User Data Policy accepted with explicit user approval.
- OAuth client ID and secret entered and saved in Clerk; secrets are not in this repository.
- Google remains in Testing. Clerk production Google connection remains disabled pending public policy pages.
- Facebook is deferred at the user's request. No Facebook application or connection was created.

## Approved website changes

`/privacy` and `/terms`, linked from the shared footer, are prepared in this branch.
The user reviewed and approved publication with these statements:

- Operator is Danny Hines; contact is dannyhines@gmail.com.
- No sale of personal data; Google sign-in data is not used for advertising or sent to generation models.
- Generation prompts/photos are processed by AI providers; some configured Meta tiers may use inputs and responses for training (disclosed in the repository README).
- Retention describes current recovery behavior without promising immediate erasure or a fixed response deadline.
- Terms cover submission rights, a service-operation license, public game sharing, credits, moderation, and beta availability.

The policy text was checked against signup identity handling, website generation inputs, source photo access checks, the credits/profile code, game deletion and restore controls, and generation cleanup. The operator approved publication as a public statement of business practices and terms.

## Validation

- Site TypeScript check passed.
- Production build passed; existing `@vercel/queue` dynamic-dependency warning remains.
- Both draft pages rendered in the browser and navigation between them worked.
- No live OAuth login, account linking, or invite-credit flow has been verified yet.

## Approved rollout steps

1. Review current main and integrate only this branch's policy pages/footer changes; deploy to Sparkade.
2. Verify public `/privacy` and `/terms` URLs and homepage links.
3. Set those URLs in Google Auth Platform → Branding and save.
4. Set Google Audience publishing status to In production; complete any required verification.
5. Enable the saved production Google connection in Clerk for signup and sign-in.
6. Verify the live Google redirect, login/account linking, and signup completion behavior.

Google setup: https://console.cloud.google.com/auth/overview?project=robotic-gasket-508819-h8
Clerk settings: https://dashboard.clerk.com/apps/app_3Imfcr4sRtYOT8GRWyswbumTTfl/instances/ins_3ImfcocBaJatXfuAeKALekxjnGT/user-authentication/sso-connections
