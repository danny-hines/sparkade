# Platformer combat, terrain and character framing — September 8, 2026

This continues the [encounter comparison](platformer-encounters-20260908.md) on
`codex/platformer-encounters`. It adds combat regression coverage, exposes existing terrain
mechanics to the encounter composer, and preserves broad character proportions in generated
animation frames.

## Combat correction and coverage

The ten existing samples pass **80 controlled combat scenarios** and **147 authored enemy
placements**. The checks use their actual generated artwork and the production movement,
projectiles, enemy AI and damage logic. No saved games are edited by these checks.

The sweep found another firing-line problem after the earlier visible-hitbox correction: some
short walkers and chasers still sat below a normal shot. Level fire now originates three world
pixels lower, at the player's waist. A regression covers a short generated target while the
existing raised-shot regression continues to check the artwork hitbox. The correction applies
to existing games on reload.

Controlled scenarios cover standing/running fire, airborne fire, upward shots through platforms,
cover and advancing past it, charged piercing, conventional fire without charging, firing away
from walls, ground melee, descending melee, stomps, and damaging a late-phase boss during its
recovery opening. Each style runs its relevant subset. These are isolated scenarios, not a
complete boss fight or full-game victory.

For authored targets, the harness searches nearby supported, body-clear positions, then uses
controller input to defeat the isolated enemy without losing health. A passing result establishes
a viable local attack, not a safe journey from the level spawn or measured subjective balance.

- [Combat results](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/complete/summary.json)
- [Reusable browser harness](/Users/danny/sparkade/tests/helpers/platformer-combat.js)
- [Batch runner](/Users/danny/sparkade/scripts/check-platformer-combat.mjs)

```sh
node scripts/check-platformer-combat.mjs \
  data/experiments/platformer-encounters-20260908/batch.json \
  data/experiments/platformer-combat-20260908/complete --authored
```

## Terrain choices for the AI

Each encounter may now select one compatible modifier. The prompts ask for 1–3 modified
horizontal sections per level when they fit the fiction, and for a teaching encounter before
a harder use. The schema, compiler, placement validation and recency fingerprint carry the
same choices. Omitted modifiers preserve the exact geometry of saved encounter plans.

| Modifier          | Compatible patterns                 | Result                                        |
| ----------------- | ----------------------------------- | --------------------------------------------- |
| Spring            | Bounce run, high/low, jump-in       | Launch to an optional high reward ledge       |
| Moving platform   | High/low, overhead targets, jump-in | Horizontal ride above a supported lower route |
| Ice               | All horizontal patterns             | A 4–6 tile stretch with reduced traction      |
| Forward conveyor  | All horizontal patterns             | Push in the level's direction                 |
| Backward conveyor | All horizontal patterns             | Resist progress                               |
| None              | All patterns                        | Existing geometry                             |

Ice and conveyors retain normal ground at both ends for stopping and recovery. Mirrored levels
reverse conveyor direction and moving-platform travel. Tower encounters retain their required
wall climbs and accept only `none`. Springs and moving platforms provide optional routes;
completion never depends on their timing. Ice markings now retain contrast on bright artwork.

There are **262 encounter tests**, including every compatible modifier/pattern/variant/direction
combination, existing style validation and incompatible-modifier rejection. Six browser checks
also exercised actual controller behavior: ordinary braking, ice momentum, both conveyor
directions, spring launch above ordinary jump height, and moving-platform carry.

- [Terrain results](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/terrain/summary.json)
- [Spring screenshot](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/terrain/spring.png)
- [Moving platform screenshot](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/terrain/moving-platform.png)
- [Ice screenshot](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/terrain/ice.png)
- [Conveyor screenshot](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/terrain/conveyor-forward.png)

These screenshots use compiled in-memory fixtures and Pico's existing art. The original ten
comparison games retain their original saved layouts.

```sh
npx tsx scripts/check-platformer-terrain.mts g-bfr0cf9ev2 \
  data/experiments/platformer-combat-20260908/terrain
```

## Broad character framing

Generated base poses retain a 128-pixel canvas height and 112-pixel subject height. The normalizer
preserves aspect ratio and selects a width of **112, 160, 192 or 224 pixels**. It then pads all
five base frames to the widest accepted canvas without resampling their pixels. Existing saved
112×128 sets remain supported. Action frames use at least 160 pixels of width and may widen too.

The prompt explicitly preserves round bodies, tails, wings and broad strides. Review boards use
a common canvas aspect and bottom alignment so wider frames are not squeezed or shown at a
different body scale. Local sprite validation and semantic identity/animation review remain in
place. Extreme silhouettes that cannot fit 224 pixels at the common height still fail with an
explicit reason; this is bounded support, not unlimited aspect ratios.

Synthetic regressions cover round and wide silhouettes, proportional normalization, pixel-preserving
padding, identical visible review framing, and rejection beyond the supported width.

## Live retry results

**3/3 original briefs are now ready**, with their round robot, dormouse and pangolin concepts
preserved. The pipeline redesigned titles and encounters to avoid recent duplicates. Each delivered
base set uses a shared 160×128 canvas, and every required action frame is present. The 192- and
224-pixel options have synthetic coverage; these three deliveries did not need them.

| Original brief                    | Delivered game                                                              | Poses | Added cost |
| --------------------------------- | --------------------------------------------------------------------------- | ----: | ---------: |
| Coral Current, round diving robot | [Bolt: Sunken Pulse](http://127.0.0.1:5173/?dev=playtest&game=g-9ncsqbiwot) |    13 |     $0.482 |
| Moonbell Ascent, dormouse         | [Wrenlight Belfry](http://127.0.0.1:5173/?dev=playtest&game=g-lbdlwxj1w9)   |     6 |     $0.391 |
| Copper Comet, pangolin            | [Starforge Salvage](http://127.0.0.1:5173/?dev=playtest&game=g-hehhcnoczp)  |    16 |     $0.533 |

The retries added **$1.406**, bringing all recorded experiment spending to **$7.120 of the original
$10 cap**. Starforge's upward wall-shot frame failed semantic review on the first retry. Its
accepted artwork was retained; one further retry generated the missing frame successfully for
$0.0104. The failed attempt and its cost remain in the ledger. No sprite review was bypassed.

The three delivered games pass another **29 controlled combat scenarios and 46 authored target
checks**, with no browser errors. Across all 13 games, that is **109 controlled scenarios and 193
authored target checks**. The same isolated-combat limits described above apply.

Bolt's model-authored levels use all five new terrain modifiers across the game. Wren's tower
stages correctly retain `none`. Bolt uses compact camera framing; Wren and Starforge use heroic
framing. Gameplay screenshots and the base-pose strip were visually inspected.

- [Live retry ledger](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/batch.json)
- [New-game combat results](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/combat-summary.json)
- [Delivered pose dimensions](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/pose-dimensions.json)
- [Bolt base animation](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/bolt-base-poses.png)
- [Bolt gameplay](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/g-9ncsqbiwot-play.png)
- [Wren gameplay](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/g-lbdlwxj1w9-play.png)
- [Starforge gameplay](/Users/danny/sparkade/data/experiments/platformer-combat-20260908/framing/g-hehhcnoczp-play.png)

## Verification

- Full `npm run verify`: **1,171 tests across 122 files**, typecheck, lint and production builds passed.
- After the final review-preview correction, **34 pose/reviewer tests** passed.
- After the ice-contrast adjustment, **39 platformer style tests** and all six terrain browser
  checks passed.
- `npm run test:e2e`: **11 browser tests passed**, including generated armed-climber action assets
  and the controlled combat regression. The production shell is tested on port 8098; the combat
  harness uses a separate dev shell on 5198 backed by the same isolated mock API.
- Final typecheck, lint, formatting checks, `git diff --check`, and production builds passed.

An initial browser attempt missed the ready-to-play key while the full verification suite was
running concurrently; two subsequent serial runs passed that transition. The new combat test's
first integration attempted to use the dev-only harness in a production build. The separate
test dev server corrects that setup without exposing the harness in production.

All inspection browsers launch muted and close after use. The user's API and UI servers remain
available. Application deployment is outside this checkpoint.
