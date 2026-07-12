# Extending Sparkade

## The archetype extension interface

An archetype is a self-contained gameplay system implementing this interface
(`packages/archetypes/src/types.ts`):

```ts
interface Archetype {
  id: ArchetypeId;                 // add the id to ARCHETYPE_IDS in shared/constants.ts
  version: string;                 // recorded per-game; bump majors on breaking spec changes
  schema: Record<string, unknown>; // full game.json JSON Schema (shared/src/schemas/<id>.schema.json)
  lint(spec): LintError[];         // semantic checks: geometry, budgets, floors, references
  estimateDurationS(spec): number; // crude interactive-minutes estimator (five-minute rule)
  create(engine, spec): GameInstance; // the hand-written gameplay
  controlHelp: ControlLabel[];     // "how to play" card + pause Controls screen
  contentFloors: ContentFloors;    // machine-checkable minimums (also quoted in prompts)
}
```

Everything the gameplay needs arrives through `EngineContext` (renderer, input snapshots, chiptune
player, SFX synth, sprite store with likeness compositing, particles, seeded RNG, camera, story
cards, HUD). The host owns pause, the hold-START escape, score tally, initials and leaderboards —
a new archetype gets all of that for free. Follow `platformer/game.ts` as the reference pattern.

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

| Archetype | Controls |
|---|---|
| **Fighter** | **Y** high punch · **X** high kick · **B** low punch · **A** low kick · **L/R** block |
| **Racing**  | **B** accelerate · **Y** brake · **A** item/boost · **L/R** hop/drift |

Why deferred: a competent fighting game needs opponent AI, frame data and animation state
machines that don't fit a one-shot generation budget; racing needs track topology + kart physics
with the same problem. When built, their specs should follow the same pattern: the model authors
rosters/movesets/tracks as bounded data; the state machines stay hand-written.

## Reserved provider slot: image generation

The `Provider` interface deliberately has room for an optional `generateImage()` method should a
sprite-generation pipeline ever be wanted. It is not configured anywhere; the likeness pipeline is
deterministic local processing (sharp) by design — no player photo ever reaches a remote
image model.
