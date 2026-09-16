# Website experience: Home, Play, and Profile

Implementation update, September 16, 2026. Home, Play, Create, owner/public profiles, and
engagement controls are implemented locally. See the [implementation and verification report](../reports/website-beta-implementation-20260915.md)
for exact behavior, checks, and rollout setup. The original requirements below remain useful
for later refinements, including editable profile fields and guest favorite-intent recovery.

## Page roles and navigation

| Page | Purpose | Main actions |
| --- | --- | --- |
| Home `/` | Discover games and understand that you can make one | Play a game, browse a section, Create a game |
| Play `/play` | Search and explore the published catalogue | Search, filter, sort, play, favorite |
| Profile `/u/{handle}` | See a creator's published games; owners also manage their collection | View creator, play, or manage your own games |
| My profile `/me` | Authenticated shortcut to your profile | Created games, Favorites, balance, Create |
| Create `/create` | Describe and generate a game at an upfront credit price | Submit, follow progress, return to profile |
| Admin `/admin` | Operate the service | Invites, credit grants, review, takedown, spend controls |

Use a shared header with Home, Play, and a prominent Create a game action. Guests see Sign in
and Sign up. Signed-in users see their profile entry, credit balance, and account menu. Keep
admin navigation restricted to operators. Use the same navigation language on game detail pages.

The Create action always leads toward `/create`. Guests authenticate first, then return to Create
with invite intent and any draft input preserved. General signup/sign-in without an intended
destination leads to `/me`. Validate return destinations against same-origin allowed routes.
No paid generation starts automatically after authentication. Users with zero credits can see
the creation flow and the payments-coming-soon state, but cannot submit a paid job.

Replace the separate planned My games dashboard with the owner's Profile view. Keep `/my-games`
as a redirect to `/me?tab=created` if that route has already been introduced; avoid duplicate
libraries with different visibility or management behavior.

## Home: a playable catalogue and creation entrypoint

Keep Sparkade's visual identity while giving game artwork, titles, and creators the primary space.
Replace the large cabinet/waitlist presentation with a concise introduction and Create a game CTA.
Retain any useful product explanation farther down the page; signup becomes the main onboarding
action. Existing waitlist data remains available to the operator.

Proposed page order:

1. Shared navigation and a compact introduction with Create a game and Explore games actions.
2. **Recently published:** newest approved, listed games, with a View all link to the corresponding
   Play query. Use publication time rather than generation completion time.
3. **Top games:** an explicit metric, initially Most liked, with a matching View all destination.
   Use real engagement. When there is no meaningful activity yet, hide this section or replace it
   with Explore by game type; do not label arbitrary games as popular or invent counts.
4. **Browse by game type:** shortcuts such as Platformer, Adventure, Fighter, and the shooter types,
   populated from supported types present in the catalogue.

All Home sections use the same published/approved/not-deleted eligibility rule as Play. They must
not reveal unlisted games, including through counts, artwork, structured metadata, or cached cards.
With no published games, show an honest empty state and the creation entrypoint.

## Play: search, filters, and sorting

Redesign `/play` around a compact browsing toolbar and reusable game cards. Update page copy,
empty states, metadata, and share descriptions to include games made on the website and cabinets.
Use creator attribution for website games. Cabinet-origin games may retain truthful cabinet
attribution without implying every game comes from a cabinet or assigning it to the cabinet owner.

- **Free-form search:** match approved public titles, descriptions/taglines, and public creator
  names. Never search private creation prompts, email addresses, unlisted games, or draft versions.
- **Game type:** All plus supported catalogue types, including Racing when present. Derive labels
  from a shared registry. Browsing existing playable games is independent of which types are
  currently enabled for paid generation.
- **Sort:** Most recent, Most played, and Most liked. Use all-time engagement for the first release,
  with explicit labels; time windows and more complex trending algorithms can follow.
- Store search, type, and sort in the URL, for example `/play?q=space&type=shooter&sort=played`.
  Filters combine, survive reload/back navigation, and carry through pagination. Reset pagination
  when the query changes. Use deterministic tie-breakers such as publication time and game ID.
- Support clearing individual filters and all filters, result counts, loading/error states, and
  an informative no-results state. Bound query length and pagination; parameterize search queries.
- Keep search in the existing database initially, with indexes appropriate to the selected search
  behavior. A new external search service is not required for the beta catalogue.

Game cards share artwork, title, type, creator link, Play affordance, and a heart action. Show real
play/like counts where useful. Owner cards additionally show generation/review/visibility status
and management actions. Keep the heart/menu controls independent of the game navigation target,
with keyboard and touch support. Use readable text alongside the existing pixel-art styling.

## Favorites, likes, and play counts

### Proposed first-release interaction

Recommendation pending preference: one heart action both likes a game and saves it to Favorites.
Use consistent labels, for example "Like and save" and "Unlike and remove from Favorites."
This supplies the Most liked ranking without introducing two similar buttons. If Likes and
Favorites are chosen as separate features, keep separate records and never treat private saves
as public endorsements implicitly.

- Favoriting requires authentication but consumes no credits. Guests sign in and return to the
  same game; preserve an explicit pending action and apply it at most once after authentication.
- Favorites can contain anyone's games, including the user's own. A private list is visible only
  to its owner. Public like counts are aggregates; do not publish who favorited a game.
- One active favorite per account/game. Save and remove are idempotent operations, not blind
  toggles that can reverse intent on retry. Derive counts from records or reconcile cached totals.
- Approved unlisted games may be saved from their direct URLs and remain in the owner's private
  Favorites when unpublished. They never enter search, Home, public profiles, or rankings.
- Removed or blocked games must not leave stale artwork or prohibited text in Favorites; hide
  them or show a generic unavailable item with a Remove action.

### What counts as a play

Most played requires new instrumentation; the current browser player does not record shared play
counts. Recommended beta definition: a successfully loaded game with at least ten seconds of
active gameplay, counting at most once per game/viewer within a 30-minute window. These thresholds
are proposed defaults. Page views, loading failures, share previews, and repeated Start clicks
within that window do not add plays.

Support anonymous play with a first-party session identifier, and use account identity for signed-in
players. A server-issued session/event key plus database uniqueness deduplicates retries. Validate
game availability server-side, rate-limit events, and exclude development/preview sessions and
identified creator testing from public rankings. These are approximate play sessions, not verified
unique people; anonymous identifiers can be reset and client events can be forged.

Persist the current favorite state and deduplicated play events; maintain aggregate stats keyed
by game ID. No backfill of invented historical cabinet play counts. Existing games start with
observed engagement only. Counts survive ordinary approved version updates; unpublish, deletion,
or takedown removes the game from discovery regardless of its count. No rewards or credits depend
on popularity in this beta.

## Profile: public creator page and private owner tools

Use a stable internal user ID for ownership and a separate unique public handle for profile URLs.
Generate a safe initial handle or let the user choose one during setup; validate reserved names
and moderate public display fields. Start with a display name and safe default avatar. Custom
bios/avatar uploads can follow the same content-review rules when introduced. Do not expose
email addresses or use a public profile field as an authorization key.

| Profile information | Owner viewing their profile | Other visitors |
| --- | --- | --- |
| Public display name/handle | Visible | Visible |
| Published, approved games | Visible with management controls | Visible and playable |
| Unlisted, generating, failed, or pending-review creations | Visible with status/recovery | Hidden, including counts and metadata |
| Favorites made by any creator | Private Favorites tab | Hidden |
| Credits, invite receipt, account controls | Visible | Hidden |
| Publish/Unpublish/Delete | Available on eligible own games | Unavailable |
| Future Edit/version history tools | Owner-only | Public attribution only |

The owner view has **Created** and **Favorites** tabs. Created shows all current creations,
including active/failed jobs and unlisted games, with useful status filters. Credits and Create
remain prominent. Public profiles show published games and public counts only. A creator with
no published games has a real empty profile; their drafts or favorites cannot fill that space.

Prefer an explicit View public profile action for owners to preview the visitor experience.
The profile's share URL always resolves according to the viewer's permissions. Fetch private
owner data separately or render it with private, non-shared caching; never cache one owner's
private tabs, credit balance, or unpublished counts into a public response.

### Management and deletion

- **Publish:** an eligible approved game joins Home, Play/search, and the creator's public profile.
- **Unpublish:** removes it from all those discovery surfaces, including cached results/counts,
  while preserving direct play and any existing private favorites.
- **Delete:** distinct from Unpublish. Remove it from the owner's normal library and all discovery,
  make the direct URL unavailable, and invalidate previews/metadata. Propose soft deletion with
  an Undo period and a clear confirmation explaining the effect on shared links. Retain billing,
  moderation, and audit records; deleting a completed game does not refund generation credits.
- Handle active jobs under the existing cancellation policy; initially offer Delete only for
  terminal jobs/games. Workers cannot resurrect a deleted game. Physical asset cleanup follows
  the retention policy, with the same cache/download limits as takedown.
- **Edit:** later, through the versioned draft/review workflow in the generation roadmap. Do not
  expose a dead Edit button as if the editor already works.

## Implementation work and launch scope

Add these explicit tasks to the launch plan:

1. Page layouts for Home, Play, own Profile, public Profile, and auth/zero-credit states at mobile
   and desktop sizes. Build a shared header, creator attribution, and game-card components.
2. Profile handles and public fields, owner/private query paths, favorites, play events and stats,
   indexed catalogue search/filter/sort, and consistent discovery eligibility.
3. Wire guest Create and favorite actions through authentication without losing invite intent.
4. Add owner Publish/Unpublish/Delete and invalidate all affected pages and cached counts.
5. Update the direct game page with creator links and favorite actions; update cabinet-only copy
   and launch metadata throughout the site. Make sure these changes preserve actual gameplay.

Home, redesigned Play, and owner/public Profile belong in this week's target. Include favorites
and simple popularity sorts as proposed first-release work; confirm the heart interaction choice.
This expands the earlier implementation scope. If time is constrained, an explicit reduced pilot
can launch the redesigned pages with Recent, game-type filtering, search, and profile management,
then enable Top/Most played once event collection is verified. Do not expose placeholder rankings.
Sophisticated trending, public favorite lists, follows, comments, and a full game editor are later.

### Verification

- Guest Create returns to the intended creation page after signup/sign-in; invites and draft data
  survive the redirect. Zero credits prevents paid submission but permits browsing and favoriting.
- Home sections, search, filtering, all sorts, result counts, and public profiles expose only
  approved listed games. A single eligibility rule also excludes deleted and blocked games.
- Search/type/sort combinations and pagination survive navigation, handle empty results, and
  include every supported published archetype. Private prompts and account emails never match.
- Owner Profile shows Created/Favorites/credits and management controls. Another account and an
  anonymous visitor get only the public projection, including through APIs, metadata, and caches.
- Duplicate favorite/save/remove requests cannot inflate counts. Unlisted favorites stay private;
  deleted/blocked content is absent. Guest authentication preserves one intended action.
- Play counts require the qualified event, ignore preview/loading/replay noise, and deduplicate
  repeated submissions. Empty rankings remain honest and existing games get no fabricated history.
- Unpublish and Delete have the distinct behavior above across links, Home, search, profiles,
  favorites, previews, and cached counts; another user cannot perform either operation.
- Verify responsive layouts, keyboard focus, independent card actions, clear states, and game
  playback at mobile/desktop sizes before the friend pilot.
