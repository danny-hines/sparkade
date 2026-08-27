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
runtime owns AI, hitboxes, move/frame data and the procedural renderer. A photographed player may
receive a complete Muse Image pose set after spec validation; opponents, the boss and any rejected
or incomplete player set use the procedural renderer.

Racing remains deferred because it needs validated track topology plus kart physics. When built,
its spec should follow the same pattern: the model authors bounded track data while the state
machine stays hand-written.

## Generated asset pipeline

Muse Image is live and deliberately separate from the text/audio `Provider` interface. Its adapter
is `packages/server/src/providers/meta-image.ts`, its settings live under `imageGeneration` in
`config.json`, and it uses Meta's image generation/edit endpoints. Every generated game receives
key art plus intro, boss, victory and defeat scenes. Photo games additionally require neutral and
story-aware defeat-expression portraits plus generated player-head sprites; Fighter photo games
attempt an all-or-nothing 11-pose player set.

Generated binaries must be normalized and validated locally, written through the versioned asset
workspace, and recorded in `assets/manifest.json` with model, prompt-version and content hashes.
Do not silently substitute local placeholder art in a real-provider run. The deterministic fixture
path is only for `SPARKADE_PROVIDER=mock`; documented runtime fallbacks must stay visually stable
and activate atomically rather than mixing partial generated sets.

An accepted player photo is sent to Muse Image. The configured design-stage provider sees it only
when the separately disclosed `likeness.describeInStory` option is enabled; production does not
reduce identity to the old finite face-feature taxonomy. The source photo remains in staging only
while the job is retryable and is removed before a successful game is published; photos and audio
must never be logged.
