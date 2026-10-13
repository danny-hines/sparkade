# Extending Sparkade

## The archetype extension interface

An archetype is a self-contained gameplay system implementing this interface
(`packages/archetypes/src/types.ts`):

```ts
interface Archetype {
  id: ArchetypeId; // add the id to ARCHETYPE_IDS in shared/constants.ts
  version: string; // recorded per-game; bump majors on breaking spec changes
  schema: Record<string, unknown>; // full game.json JSON Schema (shared/src/schemas/<id>.schema.json)
  lint(spec): LintError[]; // semantic checks: geometry, budgets, floors, references
  estimateDurationS(spec): number; // crude interactive-minutes estimator (five-minute rule)
  create(engine, spec): GameInstance; // the hand-written gameplay
  controlHelp: ControlLabel[]; // "how to play" card + pause Controls screen
  contentFloors: ContentFloors; // machine-checkable minimums (also quoted in prompts)
}
```

Everything the gameplay needs arrives through `EngineContext` (renderer, input snapshots, chiptune
player, SFX synth, sprite store with generated-likeness compositing, generated story/fighter assets,
particles, seeded RNG, camera, story cards and HUD). The host owns pause, the hold-START escape,
score tally, initials and leaderboards — a new archetype gets all of that for free. Follow
`platformer/game.ts` as the reference pattern.

Checklist for a new archetype:

1. **Schema** — self-contained file in `shared/src/schemas/`; copy the shared `$defs` block
   byte-for-byte (the `schemas.test.ts` parity test will hold you to it). Bound every array,
   number and string. Mirror it in `shared/src/types.ts`.
2. **Lint + estimator** — must be importable server-side (no DOM at module scope). Every error
   carries `{code, path, message}`; the repair model reads these verbatim, so make messages
   actionable ("add a key before the lock at …").
3. **Gameplay** — pooled entities/projectiles, no per-frame allocations, budgets from
   `BUDGET`, juice via `engine.shake/hitStop/particles`.
4. **Prompt template** — `generation/prompts/levels-<id>.md`, teaching the format AND what makes
   it fun. Add the archetype to `design.md`'s menu with controls + floors.
5. **Golden game** — a complete spec that passes `npx tsx scripts/check-golden.mts <id>` with zero
   repairs and a 360–540s duration estimate. It becomes a launch title, the few-shot example, and
   the mock-provider fixture automatically.
6. **UI** — nothing to do; the shell reads `controlHelp` and the library/detail screens are
   archetype-agnostic. Never present unsupported genres as playable options.

## Supported archetype controls

Racing is supported (hover cup — no combat items, no hop): **B** accelerate · **Y** brake ·
**A** boost/continue · **L/R** drift · d-pad steer. Remaining racing work is kart items,
multiplayer, and Pi tuning — not a deferred archetype.

The racing HUD shows corner severity and approach distance, the nearest rival's gap,
and brief position changes. Personal bests compare complete flying laps (lap 2 onward),
with checkpoint deltas against the same best lap. Records persist locally in the browser
or cabinet and are separated by generated game and course layout, including mirrored
variants. Autopilot laps do not earn records; restarting clears live comparisons while
keeping saved bests. The opening lap still counts toward the race and cup normally.

## Deferred archetypes (post-MVP) — canonical control maps

None remain — every documented archetype is built. The racing cabinet map lives in
`shared/constants.ts` → `RACING_CONTROL_MAP`.

Fighter is now a supported archetype: the model authors bounded roster data while the hand-written
runtime owns AI, hitboxes, and move/frame data. Muse Image generates a complete five-character
atlas roster after validation, and incomplete art fails the generation job instead of publishing a
body-piece fallback.

Racing is now a supported archetype: the model authors bounded cup data (circuit names,
one-of-each templates, same-slot rival cast, fair pace, themes) while the hand-written
simulation owns tracks, physics, and cup scoring. New designs commit a `racingIdentity`
for the pilot, art direction, world, five vehicle concepts, sound profile, and one boost
supply mode. Validation and repair preserve that identity verbatim in the game spec,
including the optional `discipline` (`hover` when omitted, `jetski` for water cups).
Each course adds an environment concept and road/ground/curb/edge/pad color treatment
(water roles — open water, shallows bank, shore edge, boost-surface water — for jetski).

The generated racing pack has ten required PNGs: three course panoramas, five vehicle
strips (rear, bank left, bank right), a roadside/collectible atlas, and a material atlas.
Roadside objects are generated separately, cached privately, and assembled locally into
the fixed atlas; the image model does not control cell layout. Panoramas preserve their
horizon-bearing lower band. New traversal panoramas request compatible horizontal edges
and a quiet distant horizon. Two heading-anchored bands reuse generated landmark
silhouettes at different depths; both repeat at integer intervals around a full turn.
This remains a layered wrapping backdrop, not a reconstructed 360-degree world.
The player vehicle is reviewed before it becomes the reference for key and story art;
new rival art is checked against the approved roster before the game becomes ready.
Bank corrections preserve the neutral vehicle and regenerate its left/right poses;
concept or silhouette rejections regenerate the full strip before another review.
Jetski cups require one visible seated adult rider astride each distinct compact-hull
watercraft (same rider and hull across rear/left/right, leaning together, hull touching
water; no face pasted into the hull) while hover cups stay vehicle-only; panoramas show
coherent water worlds, materials use water roles with no asphalt or curbs, and scenery
is floating or shoreline objects. Jetski prompts carry their own cache versions so old
hover approvals keep reusing correctly.
Water material tiles are generated independently and assembled into the same four-slot
atlas; water panoramas keep the sky and far shore and exclude course markers. Bank
repairs use a posed neutral reference for jetskis, then require the full roster review.
The runtime resolves discipline into a movement profile: jetskis carry lateral momentum,
coast down more readily, and use a gradual shallows response. They render wakes and
buoys and mix motor/water sound; legacy hover physics and record keys stay unchanged.
Steering presentation eases a continuous lean through the three sprite poses, with
hysteresis at pose switches and neutral presentation at rest. Jet-ski personal bests
use a separate record key.
Generic racers ride the composable `traversal` contract: `handling`
(`direct`/`grip`/`carve`/`flow`) plus `surface` (`ground`/`water`) resolve physics
through the shared bounded tables, while `rider`
(`none`/`seated`/`standing`/`onFoot`) plus `propulsion` (`motor`/`human`/`magic`)
are presentation-only and govern image fiction. Optional `motion`
(`static`/`pedal`/`stride`/`push`/`pulse`) adds locomotion independently of the
activity label; human-powered conveyances show no motor exhaust. Animated packs
expand each approved 192×64 three-pose strip into a 192×192 atlas: the original
row is preserved byte-for-byte, and two more rows hold six generated neutral-facing
cycle frames. All six must be distinct, complete and consistently scaled, then pass
an identity/anatomy/motion review. Animation advances with distance, eases through
the shared lean transform, and falls back to the original poses at rest, while
braking or airborne; push cycles require active acceleration. Player and rivals use
the same playback. Motion is an optional per-racer enhancement: rejected/unavailable animation
publishes the approved rear as an explicit 64×64 neutral image with full continuous lean.
Legacy 192×64 strips retain their genuine bank poses; approved 192×192 atlases retain
six distinct motion frames. `meta.racingArt.motion` records each racer as animated or
neutral with a reason. Terminal optional outcomes persist across unrelated retries,
including provider refusals (no automatic rephrase or repeat). Optional provider outages
skip retry/network waits; cancellation, storage, and required-art failures still stop
readiness. Private generation artifacts are scrubbed from the ready pack.
Missing/static motion retains the original asset contract.
For static cups, a provider refusal during a banking-only correction, for the
player or a rival, retains that racer's already-approved neutral as a 64×64 image
with continuous engine lean. The refusal and approved neutral persist in private
job checkpoints, so unrelated retries issue no replacement or repeat banking calls.
A refused racing key art or story scene gets one family-safe rephrase, as in
every other archetype, before the job fails.
A racer still rejected once its bounded repairs are spent does not fail the game.
The identity, camera, and player-art gates are unchanged; instead, one Muse Spark
call ranks that racer's reviewed candidates beside their rejections and picks the
least bad. On static cups it may keep only the chosen neutral (published as a
64×64 image with continuous engine lean) instead of bad bank poses; a rival whose
banking edit was refused keeps its retained neutral. The pick is approved under
the same keys as a passing strip, so unrelated retries neither repaint nor
re-rank it. `meta.racingArt.leastBad` records each pick, and
`meta.racingArt.banking` lists every racer publishing a neutral instead of
generated bank poses, with the reason.
Approved bases and cycles have private per-racer retry caches, scrubbed on publish. The creator offers Racing as a first-class
archetype choice alongside the others, and the surprise draw cycles through it.
Bounded hills and ramps are authorable per course: `elevation`
(`flat`/`rolling`/`ridge`) compiles a periodic analytic hill profile the engine
owns (no authored height points or grades), and `jumps: ramps` compiles 1-2
deterministic centered ramp zones with an avoidance line on each side. The design
stage seeds these in `levelPlan` summaries only on an explicit hills/jumps ask
(water courses stay flat by default); the levels stage authors them onto the three
existing templates, omitting both for legacy flat racing exactly. Ramps launch
racers off the lip at speed back onto the same circuit — no free flight, tricks,
or hop button. Optional `forks: split` offers coplanar branches on a safe
interval. Generation can select forks on all three templates at length 3600,
without ramps on that course (hills remain compatible). Coral and Ratchet use
explicit fork-compatible control cages; omitted forks retain the legacy geometry. It has a broad left route, narrower right route carrying the existing
boost supply, a physical island, and a shared-progress rejoin. The linter rejects
authored splits without a safe interval; curvature and checkpoint/landing
keepouts are never relaxed to fit one. Both sides use the same `s`, curvature, elevation, and lap gates. Still
unsupported: genuinely shorter shortcuts, per-branch elevation/overpasses,
combat items, and multiplayer.
Racing play and development playtest expose pointer controls on touch devices,
including menu navigation, independently held steering/acceleration and cleanup on
release, cancellation, blur and unmount. The game canvas fits portrait and landscape
viewports. `?touch=1` forces the controls only in development for browser verification;
the cabinet creator remains designed for its existing controller/voice workflow.

Incomplete new packs fail generation or loading. Reviewed selections survive retries
of unrelated assets. Legacy cups
without generated-art metadata keep their procedural renderer.

Sound identity selects electric, combustion, or arcane engines with bounded tone and
pitch controls. Speed, throttle, afterburner, rival proximity and stereo placement drive
the mix, alongside the generated musical score. Engine sources retain the existing
three-source budget and release on pause, results, restart, and disposal. No ambient
recordings or new audio provider are required.

Boost supply is exclusive per cup: pads give track-based bursts, pickups bank energy
once per racer per lap, and reserve-only cups have neither track source. Manual boost
uses the same bounded reserve; pickups substantially reduce passive regeneration.
Records separate different boost modes. Remaining racing work includes combat items,
multiplayer, and Pi frame-rate tuning.

## Generated asset pipeline

Muse Image is live and deliberately separate from the text/audio `Provider` interface. Its adapter
is `packages/server/src/providers/meta-image.ts`, its settings live under `imageGeneration` in
`config.json`, and it uses Meta's image generation/edit endpoints. Every generated game receives
key art plus intro, boss, victory and defeat scenes. Platformers branch three isolated 192×192
boss candidates from the boss story scene, then use a labeled Muse Spark review board to select the
strongest story-faithful silhouette; the density-4 winner renders at 48×48 without changing the
runtime's boss AI or collision body. Platformers also generate two candidates for each of the four
ordinary enemy behaviors and four extra-wide panoramic background plates (one per level plus the
boss arena) from the key art. Background plates are distant, low-contrast scenery only; the
hand-written tile map remains the sole source of collision geometry. They are generated in parallel,
normalized to 1536×600, and gently camera-panned without horizontal tiling, so model edge
imperfections cannot create a repeating seam. Five small gameplay props—the collectible, health,
power-up, hero projectile, and enemy projectile—are also generated independently from the key art.
Each is checkpointed and falls back independently, and all five calls run alongside the other
platformer art work rather than serializing the pipeline. Foreground geometry uses curated Muse Image packs for
all eighteen platformer themes, checked into `packages/engine/src/library/platformer-hd.generated.json`.
Each provides density-four cap/body atlases, platforms, hazards, checkpoints, exits, decorations,
and a moving platform plus an animated spring. The runtime transparently upgrades the existing family selected by Spark,
scales the richer pixels over the same validated collision geometry, and retains the original 16px
art for custom or unknown families. This removes all per-game foreground image calls. Author a
reviewable replacement pack without
touching gameplay with:

```sh
npm run tilesets:generate -- --theme cave --concept "rough crystal caverns"
```

The command saves raw outputs, prompts, processed assets, and a cost manifest under
`data/experiments/platformer-tilesets/`. After visual review, promote the candidate path printed by
the command with `npm run tilesets:promote`. Promotion palette-indexes the art and checks it into the
runtime library; it never happens automatically. Photo games additionally require neutral and
story-aware defeat-expression portraits plus generated player-head sprites. Fighter games generate
an atomic five-character roster: the player, three opponents, and the boss. Each character starts
with three identity candidates; Spark selects the foundation, twelve action states branch from that
exact anchor, weak states receive bounded targeted retries, and the thirteen selected states are
packed into a 4x4 atlas of 96px cells. A supplied player photo is identity truth; key art and boss
story art guide the remaining roster. Platformer photo games whose design selects
`platformerArtDensity: "detailed"` require a complete five-pose 112×128 base player set. New `actionPoseVersion: 1` games also require the mechanic-specific actions described below. The
neutral side view anchors two opposing run contacts and the jump, while the runtime uses a
speed-driven gait from those coherent key frames. Pair validation measures the
lower-body alpha silhouette, rejects arm/prop drift without an opposing stride, and regenerates only
the second contact with a targeted legs-only edit. Hero concepts are costume guidance only for
player poses; held story objects must not leak into a single animation frame. The platformer's
`platformerScale` controls camera framing independently from source-art density.

Generated binaries must be normalized and validated locally, written through the versioned asset
workspace, and recorded in `assets/manifest.json` with model, prompt-version and content hashes.
Do not silently substitute local placeholder art in a real-provider run. The deterministic fixture
path is only for `SPARKADE_PROVIDER=mock`; documented runtime fallbacks must stay visually stable
and activate atomically rather than mixing partial generated sets.

### Fighter pose experiments

Run `npm run dev` and open `/?dev=fighter-poses` before changing the production Fighter pose graph.
The isolated lab mirrors one roster member's production flow without generating a game: three identity foundations, Spark
selection, two ordered six-state sheets, deterministic local splitting, independent cell validation,
semantic review, bounded retries for weak poses, atlas packing, and a human accept/reject verdict.
Connected foreground components are labeled across the full sheet and owned by the cell containing most
of their pixels. The splitter may reclaim an owned component up to 64 source pixels beyond its nominal
cell while excluding neighbor-owned pixels, so a limb or head is neither duplicated nor amputated by the
grid. Remaining clipped or distant islands are removed only when a centered primary fighter is clearly
dominant; two plausible subjects remain a validation error.
When a sheet cell still fails mechanical validation, keep the other five and recover only that pose with
up to two bounded isolated attempts. The lab also exposes the original twelve-isolated-pose mode for direct quality,
latency, and cost comparisons. Production always uses sheet mode for all five roster members, retaining
isolated generation only for rejected cells and one bounded Spark-directed retry round. A semantic
rejection selects the highest-scoring locally valid combination; a mechanically missing state reuses
the closest valid pose so one frame cannot fail the game. Production checkpoints each completed roster
atlas and resumes only unfinished fighters after a job retry. A design-stage Fighter art contract locks
the roster's proportions/rendering and the player's exact outfit across key art, story scenes, and pose
generation. The runtime alternates idle and walk cells while moving. Production also spends one image
call on a stacked ladder/boss arena sheet, normalizes it into two fixed panels, and falls back to the
procedural arena when that optional asset is unavailable. The lab exposes prompts and review evidence at every stage and stores
the complete run under `data/experiments/fighter-poses/<run-id>/`. Append `&run=<run-id>` to reopen a
persisted run after a dev-server restart.

### Sprite background-removal comparisons

Open `/?dev=platformer-poses` with the dev server running. The **Compare background removal**
panel accepts a raw generated sprite, or a raw candidate from a loaded pose run (`&run=<run-id>`).
Enter one short subject concept such as `person`, `knight`, or `spaceship`, then select **Compare
masks**. It compares the existing chroma pipeline, a SAM 3.1 silhouette, color-only cleanup along
SAM's one-pixel inner boundary, and a SAM-guided chroma hybrid. All four use the same oriented,
unscaled source; the three SAM variants share one API call.

The hybrid preserves all colors in the interior of SAM's mask, including green shirt logos. In a
narrow band on either side of the boundary it removes obvious key green (including dark, nearly
pure green spill) and recovers non-green source pixels that SAM excluded. Mixed green fringe
within that band is recolored by clamping green to the larger of red and blue when green excess
is at least 40; its alpha is retained. The band radius is
`ceil(max(subject width, subject height) / 112)`, clamped to 1–24 source pixels, approximately one
game pixel. It requires a mostly green outer image border. The saved result records its radius,
removed, restored and recolored pixel counts, and protected interior green count. This is binary keying, not
soft-alpha matting; legitimate green near the boundary can be removed or recolored, nearby unrelated content
can be recovered, and green background incorrectly deep inside SAM's mask remains protected.

Use the view selector for normalized sprites, full-resolution cutouts, and alpha masks. Switch
between checkerboard, white, dark, and pink backgrounds and open an image for native-resolution
inspection. Check curls, frizzy strands, gaps inside hair, and green clothing for both leftover
background and lost foreground. Boundary cleanup does not change alpha, but can recolor legitimate
green edges, so review it separately. Save a preferred result (or none) and notes.

The lab uses the existing `imageGeneration.baseUrl`, `apiKeyEnv`, and timeout with the separate
`sam-3.1` model. It requires live Meta access and deliberately rejects mock mode. One successful
image segmentation is estimated at $0.0025 using the 2026-09-19 published rate; failed requests show
unknown cost. Empty or multiple subject matches are recorded as failures, with no automatic
fallback or paid retries. At most two comparisons run concurrently in one server process.

Evidence lives under `data/experiments/sprite-masks/<id>/`: original upload, canonical source,
source hash, SAM response, masks, cutouts, normalized sprites, timings, cost estimate, and review.
The page sets `&maskRun=<id>` so the same comparison can be reopened without another model call.
**Rerun saved mask (no API call)** creates a new comparison using the original source and saved
SAM response with the current processor. It records `reusedFrom`, zero new calls and zero new cost,
and preserves the old artifacts and review. This allows deterministic comparisons across processor
changes without variation from a fresh model response. Old three-option comparisons remain readable.
Completed runs survive server restarts; an interrupted run is reported as failed on reload.
This experiment does not change production generation, prompt backgrounds, or published assets.

The initial live integration check used a saved curly-haired pixel-art character and completed in
about 2.5 seconds. SAM altered some fine hair edges and retained some green pixels, so that sample
did not establish a quality improvement. Use a broader difficult-sprite corpus before promotion.

### Platformer pose experiments

Run `npm run dev` and open `/?dev=platformer-poses` before changing the production pose graph. The
lab executes an isolated photo → three parallel front-idle foundations → Spark identity selection →
neutral right-facing anchor pipeline, then branches three Phase A edits with the camera-side leg
leading and three inverse Phase B edits with the far-side leg leading from the exact same side
anchor. Mechanical image requirements (decoding, green-screen keying, crop, scale and ground
anchoring) remain deterministic. Symmetric opaque panels surrounding a full-height/full-width green
screen can be recovered locally; irregular extra subjects still fail closed. Spark compares each
surviving idle's raw high-resolution edit seed and normalized sprite directly with the source,
including an explicit eyewear/artifact gate, before that identity can propagate downstream. One
bounded three-candidate retry incorporates its guidance when the first idle batch is rejected.
Semantic requirements—identity and apparent-age preservation, hair/accessories, costume, visible
leading-leg motion, arm reversal and pair coherence—are scored by the configured design-stage model
from labeled review boards. Action-candidate quality is judged independently, then all nine possible A+B
combinations are compared directly; generation labels are never treated as proof of limb depth. A
pair cannot pass unless its legs visibly alternate, even when the model returns `accepted`; the
judge may reject every pair, and its result is normalized fail-closed.

The page streams every stage, exposes the exact Muse Image and Muse Spark prompts, and shows the raw
Spark response and final pair selection. Accepted pairs animate as
`A → neutral side idle → B → neutral side idle`; this reuses the shared anchor as a third unique
frame to make small foreground/background limb changes more legible. Each of the four beats has an
independent live timing control, plus starting-point presets. Complete experiment evidence is stored under
`data/experiments/platformer-poses/<run-id>/`, including the source image, raw and normalized
candidates, judge board, event log and manifest. The page also records a human-selected pair or
reject-all verdict in `human-verdict.json` and the manifest without replacing Spark's raw or
normalized decision. This directory is local and gitignored; it is intentionally separate from
published game assets and generation incidents.
Append `&run=<run-id>` to the lab URL to reopen any persisted run after a dev-server restart.

Mechanic-specific action experiments reuse approved base artwork without generating a whole game:
`npx tsx scripts/platformer-action-lab.mts --style armedClimber --out data/experiments/platformer-actions/my-run`.
The default is mock. Add `--live` to use configured image and design providers; `--game` and `--assets`
select another saved spec and its approved base sprites. The output contains exact prompts, references,
raw candidates, normalized accepted actions, review boards/responses and per-invocation costs.
With the dev server running, preview the default golden source in gameplay at
`/?dev=playtest&style=armedClimber&actionRun=my-run`. For another source, also supply `&game=<id>`.

The shared `requiredPlatformerActionPoses` function is the generation/loading contract. Blaster kits
need standing, running-contact and airborne shots in forward/upward aim; wall jumping adds a slide;
armed climber also adds wall shots; melee adds grounded/airborne windup and strike. Action canvases
are 160×128 at the same render density as the 112×128 base, providing room for extended arms without
shrinking the character. Frames edit approved base references; wall-shot frames edit the accepted wall slide to preserve its grip. All undergo independent semantic review
in batches of six with one guided retry. Each accepted action has its own prompt/reference hash.
An action whose four candidates are all rejected ships Muse's best-scoring rejected frame instead of
failing the game, or its related base frame (never the front idle) when no candidate could be
processed; it is promoted before wall shots start, so they still edit a wall slide.
`meta.platformerPlayerArt.leastBadActions` records each. A provider failure preserves the base and
other accepted actions for retry, and a new game still cannot publish or load with an incomplete
required set. Legacy saves retain the original five-frame fallback. Every base and action frame is
re-anchored to the canvas floor after fitting, so a toe row lost to downscaling cannot fail a set.

An accepted player photo is sent to Muse Image. Spark's design-stage `heroConcept` is the canonical
game-world wardrobe contract shared by key art, story scenes, portraits, and detailed platformer
poses. For photographed players, the photo remains immutable identity truth from the neck up
(including hair, facial hair, eyewear, and headwear), while source clothing below the neck is
deliberately replaced by the premise-specific outfit. For detailed platformers, the source photo also
appears in the locally assembled identity and pose review boards sent to the configured design-stage
provider. Those judges compare head identity to the photo and costume to `heroConcept`; they do not
mistake source-photo clothing for identity. The separately disclosed `likeness.describeInStory`
option controls whether the earlier design pass itself sees the photo. Production does not reduce
identity to the old finite face-feature taxonomy. The source photo remains in staging only while the
job is retryable and is removed before a successful game is published; photos and audio must never be
logged.

### Platformer run in-betweens

Generated platformer players run on an eight-beat gait. `@sparkade/shared/run-inbetweens` makes two
in-between frames from the three generated run frames (contact A, side idle, contact B) by pixel
shift. Block matching estimates how each part of a contact frame moves toward the side idle, and the
contact's pixels move one third of the way along that smoothed field, so no new colors appear. A
third keeps fast hands and feet from stretching.

After the generated poses load, `packages/web/src/run-inbetweens.ts` computes `runMid1` and
`runMid2` in a module worker and caches them per device in IndexedDB, keyed by the three frames'
pixels and `RUN_INBETWEEN_VERSION`. The game starts immediately with the six-beat gait and switches
to the eight-beat gait when the frames arrive. Without workers, or if the computation fails, the
game keeps its original run; without IndexedDB it recomputes on every load. Nothing is stored in
game bundles, so every existing game gets it. Bump `RUN_INBETWEEN_VERSION` whenever the algorithm's
output changes. Actions such as firing still replace the run frame. Every generated-player run, with
or without in-betweens, now squashes one world pixel on the beat after contact, rises one world
pixel on passing beats, and kicks a two-particle dust puff from the trailing foot at each contact.
Lean was dropped because the renderer snaps to whole world pixels.

Measured on the kiosk Pi 3B+ (2026-10-12): the worker took 5.4 seconds in Chromium on a game's first
load (3.5 s median, 5.2 s max per game in Node across the stored games). While it ran, gameplay
averaged 37 fps against 40 fps with cached frames, but median frame time rose from 17 to 33 ms.
Later loads of the same game read the cache.

Games can also carry their in-betweens as two optional assets, `platformer-player-run-mid-1.png` and
`-run-mid-2.png`, and the player uses those first. `packages/server/src/assets/platformer-run-rig.ts`
makes them from SAM 3.1 parts.

- **Rigid limbs:** each arm and leg turns as one piece a third of the way toward straight down, so
  the art's own knee and elbow bends survive.
- **Per frame:** fully rigid when SAM separated both legs and an arm; rigid arms over the
  pixel-shift body and legs when it separated only arms; otherwise the pixel-shift frame.
- **When stored:** only when at least one frame used the rig.

The generation step after the hero's poses costs 12 SAM calls (about $0.03) and never fails a game.
It runs only when `SPARKADE_PLATFORMER_RUN_RIG=1`, which stays off until every kiosk runs a build that
knows the two roles: older builds reject manifests with roles they don't know. Readers now skip
well-formed entries for unknown roles instead (`knownGameAssets` in `@sparkade/shared`), so later
roles won't need this wait. `scripts/backfill-run-rig.mts` adds the frames to:

- **Local data folders.**
- **The repo's golden-platformer:** its frames are committed and checked against recorded SAM
  responses in `platformer-run-rig.test.ts`.
- **Published games whose art is in public Blob storage:** website-created games keep their art in
  a private bundle behind moderation and are skipped.

Bump `PLATFORMER_RUN_RIG_VERSION` whenever the rig's output changes.

### Platformer template-board experiments

`scripts/platformer-template-lab.mts` tests a different recipe for the player's base poses: pose
truth comes from pixels instead of prose. Muse Image edits accept one input image, so one 3x2 board
carries both truths: cell 1 holds a saved game's approved front idle and cells 2–6 hold two-tone
side-view mannequins for `sideIdle`, `walk1`, `walk2`, `jump`, and an extra running `runPass`
frame. Light-gray limbs mark the camera-side arm and leg; dark-gray limbs mark the far side. One
edit asks Muse to redraw every mannequin as the identity character in that exact pose. Production
does not use this recipe.

```sh
npx tsx scripts/platformer-template-lab.mts                  # mock: the unedited board stands in for Muse
npx tsx scripts/platformer-template-lab.mts --live --boards 2
```

`--games a,b` picks saved games from `data/games` (default: ten varied body plans), `--boards`
sets independent edits per game, `--identity sideIdle` swaps the identity cell for the saved side
view, and `--no-judge` / `--no-production-judge` skip review calls. Mannequins are drawn in code at
the identity's native height and widened for broad characters, then nearest-neighbor upscaled with
the identity on one ground line. `--style outline` draws the same figures as hollow line art (dark
near limbs, pale far limbs) and `--style skeleton` as stick figures; the prompt describes whichever
style is on the board. `--reuse <run>` reprocesses saved Muse outputs without image calls. `--templates <dir>` replaces them with `<pose>.png` cutouts, for
example SAM-segmented frames of a video-generated mannequin. Imported templates scale uniformly from
their side idle so relative stride heights survive.

Each board is split with the Fighter sheet splitter's component ownership, then keyed, fitted and
foot-anchored by the production platformer processor. The report records per-cell normalization,
the production set validation, and silhouette IoU against every template. IoU is only a pose signal:
broad characters overlap a slim mannequin less. `walk1` and `walk2` mannequins share one silhouette,
so only the depth coding and Spark can separate them. Each board is judged on its own with the
production pose-pair and jump judges, using the game's key art as source and that board's side idle
as anchor. The game's existing production frames are re-judged once as a baseline. They were
selected from about nine candidates, while each template board is one edit with no retry. Evidence,
prompts, judge boards and responses, `summary.json`, and a browsable `report.html` with animated
gait previews are written to `data/experiments/platformer-templates/<run>/`.

First live results (2026-10-11, `muse-image-1.0`, ten saved games × two boards, $0.21–0.23 per
run including judging):

- Muse followed the mannequin poses closely. The side-idle cell came out fully dressed on all 38
  boards and passed Spark's side-anchor gates on 37. Production spends a separate call on that frame.
- On 19 of 38 boards, Muse painted a head or tunic onto the mannequin but left gray limbs or a gray
  body in the action cells. The robot, koala and pangolin fail most often, consistent with the
  humanoid mannequin body plan. Prompt v2's explicit dressing rule did not help: fully dressed
  boards went from 11/18 to 8/20.
- On dressed boards, Spark usually rejected the run pair for no visible leg swap (3 of 19 accepted).
  Once both legs wear the same trousers, contact A and B look nearly identical. Re-judging the
  saved production frames gave the same verdict on 9 of 19 judgments. v2's darker far-limb shading
  produced accepted pairs only occasionally.
- Template jumps were accepted on 18 of 38 boards (16 of 19 dressed) against 17 of 19 production
  re-judges. The Spark judge is noisy at this sample size: the same production frames flipped
  between runs.

Evidence is in `data/experiments/platformer-templates/20261011-live-v1` and `-v2`; `-v1-rescore` is
the zero-cost `--reuse` reprocessing that added the mannequin-gray metric.

Template styles (same ten games × two boards, prompt v3; production re-judged in each run):

| Style             |     Cells left as template | Run pair accepted | Jump accepted | Full set on a board | Characters with a full set in two boards |
| ----------------- | -------------------------: | ----------------: | ------------: | ------------------: | ---------------------------------------: |
| Filled mannequin  |                33/100 gray |              5/20 |          9/20 |                2/20 |                                     2/10 |
| Outline           |                 1/100 gray |             10/20 |         12/20 |                7/20 |                                     5/10 |
| Skeleton          | 7/100 failed normalization |       5/17 judged |         12/20 |                4/20 |                                     3/10 |
| Production frames |                        n/a |            5–6/10 |       9–10/10 |                 n/a |                                     5/10 |

Outline templates nearly always get dressed, and with two image calls they matched production's
full-set rate, which spends about 13 calls per character. They succeeded on different characters,
which favors trying templates first and falling back per character. In the boards reviewed, accepted outline pairs shade the far limbs darker, which makes the leg swap visible. The round robot still grew humanoid legs.
Skeletons were often left as stick figures with only shoes painted.

`scripts/platformer-template-review.mts` combines runs into one self-contained
`data/experiments/platformer-templates/review.html`. Each board plays the in-game six-beat gait,
the same rhythm with the passing frame, and a jump arc beside the production frames. It has speed,
scale, step, and filter controls. Pass `--runs "Label=run-dir,..."` to choose runs.

`scripts/platformer-video-templates.mts` sources templates from video. It animates the volume
mannequin with an image-to-video model: fal (Kling 2.5 Turbo by default, `FAL_KEY`), Runway
(`gen4_turbo`, `RUNWAYML_API_SECRET`), or OpenAI (`sora-2`, `OPENAI_API_KEY`). It keys the green
frames and picks templates from measured stride width and which colored leg leads. It writes
`templates/<pose>.png`, the measured jump lift, one full run cycle, and contact sheets for checking.
`--pick walk1=run:42` overrides a choice, and `--run-video`/`--jump-video` import local clips instead.
The output directory then feeds the lab's `--templates`. These providers author one-time templates
only; game generation stays on Meta models.

The script also writes `templates-outline/`, which redraws the selected frames as the lab's line art
with filled `silhouette/` cutouts for metrics; pass it with `--style outline`. The first fal run
(2026-10-12, Kling 2.5 Turbo, two 5-second clips, about $0.42) produced a clean, steady run cycle
that kept the near/far colors, and a real airborne tuck jump. All five automatic picks were correct.
On the same ten games:

| Template source             | Cells left as template | Run pair |  Jump | Characters with a full set in two boards |
| --------------------------- | ---------------------: | -------: | ----: | ---------------------------------------: |
| Code-drawn outline          |                  1/100 |    10/20 | 12/20 |                                     5/10 |
| Video, solid mannequin      |             19/99 gray |     8/20 |  9/19 |                                     4/10 |
| Video, converted to outline |                  0/100 |     6/20 | 14/20 |                                     3/10 |

Video motion did not raise Spark acceptance of single frames. Solid video frames repeat the filled
mannequin's gray-limb failure; outline conversion fixes that. Muse often turned the tuck jump into a
running leap. Video's advantage is coherent in-between frames, which the five-cell board and the
three-frame runtime gait do not use yet.

`scripts/platformer-cycle-lab.mts` tests a full run cycle. A 3x3 board holds the identity in cell 1
and eight consecutive outline phases of the video run cycle (`cycle8/` from the video script) in
cells 2–9; one Muse edit redraws all eight. The splitter gives each connected figure to the cell
holding most of its pixels. Unlike the per-pose fit, normalization uses one scale (the board
upscale), ground line, head-and-torso anchor, and 32-color palette for the whole cycle, so the bob
survives and the character does not pulse in size. The game's run cycle is normalized the same way
from filled cutouts for comparison. There is no Spark judge for cycles yet; review them as
animation with `platformer-template-review.mts`, which plays each cycle at game cycle time, at ⅓
speed, and next to the requested motion.

```sh
npx tsx scripts/platformer-cycle-lab.mts --live --boards 2
```

First run (2026-10-12, ten games × two boards, $0.20): all 20 boards produced eight valid,
consistently scaled frames, and 153 of 160 frames were dressed. Pose following was weaker than on
the five-pose board. Eleven boards kept eight distinct poses, but Muse often copied one stride into
several cells (one raccoon board kept only three distinct poses). Output frames overlap each other
more than the requested frames do (mean pairwise IoU 0.51–0.82 against 0.50), so motion is damped.
Some boards drew the pale far-limb lines as translucent gray limbs. Some also redrew the identity
cell, for example a darker skin tone, which then carried into every frame.

Cycle board v2 (same games and boards, 2026-10-12, $0.20 per run) adds three fixes. Each cell gets a
written stride phase (contact, down, passing, or up for each leg) and a rule against copying.
Far-limb lines are magenta and described as a depth label, not a color or transparency. The prompt
also requires cell 1 to stay unchanged. The video script now writes `cycle8-magenta/` and
`cycle6-magenta/` with a `cycle.json` that the cycle lab reads. `--reuse <run>` rescores saved
boards without image calls; v1 below is rescored that way.

| Cycle board  | Complete cycles | Frames dressed | All poses distinct | Mean distinct | Mean frame overlap (requested 0.50) | Identity drift |
| ------------ | --------------: | -------------: | -----------------: | ------------: | ----------------------------------: | -------------: |
| v1, 8 frames |           20/20 |        153/160 |              10/20 |         6.9/8 |                                0.69 |           2/20 |
| v2, 8 frames |           20/20 |        160/160 |              16/20 |         7.8/8 |                                0.57 |           0/20 |
| v2, 6 frames |           18/20 |        108/108 |              15/18 |         5.8/6 |                                0.52 |           1/20 |

v2 removed the translucent far limbs; far limbs are now drawn solid and darker. The six-frame board
leaves two cells empty, and Muse reflowed its frames into those cells on both golden boards. That
left a required cell empty, so those boards produced no cycle. Purple or pink costumes register as
magenta, so the magenta-left metric is only meaningful against the v1 baseline.

`--cycle code` replaces the video frames with a hand-posed eight-phase mannequin cycle
(`renderPlatformerCycleTemplates`): contact, down, passing, and an airborne up for each leg, on one
shared canvas, as outline art with magenta far lines and the same v2 prompt. On the same ten games
(2026-10-12, $0.20) it matched the video cycle on reliability and followed its phases better:

| Eight-frame cycle (v2 prompt) | Complete | Dressed | All poses distinct | Frames nearest their own phase | Frame overlap (requested) | Identity drift |
| ----------------------------- | -------: | ------: | -----------------: | -----------------------------: | ------------------------: | -------------: |
| From video                    |    20/20 | 160/160 |              16/20 |                         64/160 |               0.57 (0.50) |           0/20 |
| Hand-posed                    |    20/20 | 160/160 |              17/20 |                         93/160 |               0.55 (0.52) |           0/20 |

The identity-drift metric compares mean color only; one hand-posed board turned the identity cell
into a three-quarter view without being flagged. Which cycle reads better in motion is a visual
judgment; compare them in `review.html`.

### Platformer run-gait review

`scripts/platformer-gait-review.mts` explores smoother runs without any new generation. It reads
each saved game's production `walk-1`, `side-idle`, and `walk-2` frames and writes
`data/experiments/platformer-gait/review.html` (add `--all` for every saved platformer). Each game
plays four ways on one clock, at the runtime's gait beat rate and run speed:

- **Game today:** the six-beat runtime gait (contact, contact, idle, contact, contact, idle).
- **+ runtime polish:** the same frames with a bob on the passing beat, a squash on the beat after
  contact, a small forward lean of the head and torso, and dust puffs at contact. The default unit is
  one world pixel (4 sprite pixels), the step the renderer's unused `compression` hook already
  supports.
- **+ procedural in-betweens:** an eight-beat cycle in the same cycle time with two in-between
  frames from `platformer-inbetween.ts`. Pixel shift moves a contact frame's pixels toward the side
  idle along a smoothed motion field, halfway or a third of the way; the shorter move stretches
  fast hands and feet less. Dither smear checkerboards two frames. Both reuse existing colors only.
  Two other approaches were dropped: moving parts rigidly broke hands and feet into fragments, and
  splicing one frame's upper body onto another's legs at the waist read as two bodies, with legs
  that popped.
- **+ both.**

Header controls toggle each polish effect, its strength, the in-between method, speed, scale
(1× is about in-game size), and a strip of the generated frames. Every method looks worst when a
character's side idle is drawn differently from its run frames.

The runtime now plays pixel shift (see [Platformer run in-betweens](#platformer-run-in-betweens)).

### Platformer SAM rig experiment

`scripts/platformer-sam-rig-lab.mts` builds run in-betweens by moving whole limbs, using SAM 3.1
masks. The approach now ships as `packages/server/src/assets/platformer-run-rig.ts` (see
[Platformer run in-betweens](#platformer-run-in-betweens)). `platformer-sam-rig.ts` keeps only the
lab's SAM response cache and debug overlays. It reads the same three frames as the
gait review and writes `data/experiments/platformer-sam-rig/<run>/review.html`. SAM responses are
cached under `cache/`, so a rebuild costs nothing. Pass `--live` to call SAM for uncached frames,
`--compare-run <run>` to show an earlier run's tile, and `--contact-concepts a,b` to try other
prompts. Rigid frames cost about $0.03 of SAM per game at generation time.

- **Parts:** contact frames ask for "arm", "upper arm", "hand", "leg", "foot", and "head".
  "Upper arm" finds upper arms that "arm" leaves on the body (sleeves, fur). "Whole arm", "arm and
  hand", "sleeve", "thigh", and "whole leg" found nothing new. Limb pieces that meet end to end are
  joined, along with any band between them (a wristband). Then, while a frame still has more than
  two arms or legs, the pieces sharing the longest border are joined (an arm split at a bent elbow).
  A near arm takes over its own dark outline, so swinging it leaves no ghost outline behind.
- **Motion:** each limb turns as one piece a third of the way toward straight down, so knees and
  elbows keep the bends the art drew. Bending at an estimated knee was tried first and produced
  backward knees: the estimate fell mid-shin.
  - **Camera-facing arm:** turns about its own topmost visible point.
  - **Back arm:** turns about the midpoint of the two arms' tops, behind the body.
  - **Legs:** turn about the midpoint of their tops, raised into the body when they start lower
    than 30% of the figure's height (thighs under a robe).
  - **Hidden extension:** legs and the back arm are extended toward their joint under the body, so
    turning them opens no gap at a hem or shoulder.
  - **Height:** legs are squashed vertically so the figure rises at most a third of how much taller
    it stands in the side idle. Unsquashed, it hopped.
- **Per mid frame:**
  - **All rigid:** both legs found, believably long, and starting near the hip, plus at least one
    arm long enough to swing that starts near the shoulder.
  - **Rigid arms only:** SAM separated the arms but not the legs. The body and legs then move exactly
    as pixel shift moves them (the frame with its arms taken out), and the rigid arms ride pixel
    shift's motion at the shoulder.
  - **Pixel shift:** anything else, including any arm with more than one hand piece or a hand
    attached to no arm (decorations read as hands, which would be left behind).
  - **Results (10 saved games):** all rigid for the human-like heroes; rigid arms only on the robot,
    armadillo, and leaf creature; pixel shift for the sunflower.
- **Known gap:** where a front arm swings away from the torso, the body behind it is guessed from
  the nearest body pixels. On the koala that guess is the bead necklace. Taking those pixels from
  the side idle, where the arm hangs down, would fix it.
