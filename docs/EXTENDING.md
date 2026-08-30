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

## Deferred archetypes (post-MVP) — canonical control maps

Recorded here (and in `shared/constants.ts` → `DEFERRED_CONTROL_MAPS`) so they don't get lost:

| Archetype  | Controls                                                              |
| ---------- | --------------------------------------------------------------------- |
| **Racing** | **B** accelerate · **Y** brake · **A** item/boost · **L/R** hop/drift |

Fighter is now a supported archetype: the model authors bounded roster data while the hand-written
runtime owns AI, hitboxes, and move/frame data. Muse Image generates a complete five-character
atlas roster after validation, and incomplete art fails the generation job instead of publishing a
body-piece fallback.

Racing remains deferred because it needs validated track topology plus kart physics. When built,
its spec should follow the same pattern: the model authors bounded track data while the state
machine stays hand-written.

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
`platformerArtDensity: "detailed"` attempt an all-or-nothing five-pose 112×128 player set. The
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
