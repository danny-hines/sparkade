# Platformer presentation families — September 8, 2026

Platformer generation now selects one of three presentation families independently of its gameplay
package. The same blaster, wall jump or melee game can use any family.

| Family    | During play                                                      | Between stages and after play                                                     |
| --------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Storybook | Warm paper panels, hearts, chapter count, actual mechanic status | Illustrated chapters, journey results, Hall of Heroes, soft triangle chimes       |
| Tech      | Segmented health, instrument panels, weapon/charge/ascent status | Mission briefing, mission pause, debrief, mission records, sine interface signals |
| Arcade    | Compact HUD, large score, timer, mechanic status and boss health | Bold stage banners, prominent final score, high scores, square-wave blips         |

The controls card, pause controls, audio settings, introductions, chapter cards, boss cards, victory
and defeat stories, score tally, initials and records share the selected family. All rendering uses
bitmap text and rectangular pixel geometry. Artwork is fitted without stretching; chapter cards
reuse the corresponding generated level backdrop. This adds no generated asset slots.

## Generation and compatibility

The design prompt receives the family catalogue and a weighted recency preference. Explicit player
aesthetics take precedence. It also receives the family direction for its music brief. Family menu
sounds replace only UI move/select/back effects; combat sound definitions remain game-authored.

The bounded family enum is accepted in platformer designs and saved specs and rejected for other
archetypes. Assembly carries the choice, restores it after repairs, and records it in the final
mechanical fingerprint. Existing saved specs without a family keep their previous presentation.
New assemblies from cached designs without a family use arcade. No saved games were migrated.

Health, lives, ability state, collectibles, charge or strike readiness, boss health, stage count,
score and play time come from the running game. The elapsed timer excludes story cards and pauses.
Presentation does not add weapons, resources, damage rules, time limits or scoring rules. A
conventional gun still displays ordinary fire; it does not acquire a charge meter.

Long narrative text paginates instead of overflowing or being discarded. A/START first reveals
the current page and then advances. The new controls cards wait for A/START; legacy cards retain
their original automatic timeout. The existing font remains shared across families.

## Comparison and visual inspection

[Open the comparison](http://127.0.0.1:5173/?dev=presentation&game=g-hehhcnoczp&family=storybook&scene=opening).
Choose a family, ready platformer and screen. **Play** runs the real game. HUD previews hold a
common initial state; results and records use clearly identified sample numbers. Result confirmation
and initials follow the normal host flow but never submit scores. Each switch disposes the previous
host and audio context. The page starts muted. `clean=1` gives an exact 1024×600 capture.

All 36 combinations of three families and twelve inspection screens were visually checked using
Starforge Salvage. Additional HUD checks cover Wrenlight Belfry, Thunder Palm, Dustline Deputy,
Sky Post Pico Dash and Bolt: Sunken Pulse, including tower ascent, melee readiness, conventional
fire and compact character framing. Dustline shows **BLASTER / FIRE** with no charge progress.

These contact sheets place storybook, tech and arcade from left to right:

- [HUD, controls and pause](/Users/danny/sparkade/data/experiments/presentation-families-20260908/compare-game.png)
- [Introduction, chapter and boss cards](/Users/danny/sparkade/data/experiments/presentation-families-20260908/compare-cards.png)
- [Victory, defeat and records](/Users/danny/sparkade/data/experiments/presentation-families-20260908/compare-results.png)
- [Audio, boss HUD and initials](/Users/danny/sparkade/data/experiments/presentation-families-20260908/compare-details.png)
- [Five additional games](/Users/danny/sparkade/data/experiments/presentation-families-20260908/compare-other-games.png)

The playfield below the HUD is pixel-identical across all three families in both the initial-level
and boss previews. [Pixel comparison evidence](/Users/danny/sparkade/data/experiments/presentation-families-20260908/world-comparison.json).
This verifies the controlled scenes, not every possible gameplay frame.

Visual review corrected an arcade title/frame overlap, low-contrast health and audio segments,
and controls/records footer spacing. The comparison also recovers after a failed game fetch without
losing the canvas needed to retry.

## Verification

- Full `npm run verify`: **1,194 tests across 124 files**, typecheck, lint and all production builds passed.
- Final typecheck and lint passed after the visual/lifecycle corrections. All **79 engine tests**
  passed after the final input change, including two new escape-hold regressions.
- Unit coverage checks all five gameplay packages across three family choices, legacy/schema
  compatibility, recency, story pagination/completion, HUD values and bounds, and controls readability.
- The complete mock asset/publish pipeline persists all three families across the five package cases.
- Final `npm run test:e2e`: **16/16 browser tests passed** in one serial run. Coverage includes
  keyboard play/pause/controls/audio, host cleanup, fetch recovery, sample-score isolation, held-Start
  exit, keyboard family selection, and the existing generated armed-climber and combat checks.

The first browser run exposed a test synchronization mistake: the test queried the inspection
bridge while the old host was disposed and the new host was still loading. The test now waits for
its requested family to be ready and also verifies keyboard activation of the family selector.

The held-Start check then exposed an existing escape bug: entering Pause suppressed Start until
release and reset the exit timer. The broker now exposes the physical hold from its last poll for
that global timer, while ordinary game/menu input stays suppressed. Default and remapped keyboard
bindings are covered. The comparison also recreates Controls when quitting a session that was
already launched from that scene.

No paid generations were run for this milestone. The comparison reuses saved artwork. Human
playtesting is still needed to judge which family best fits each generated game's tone; these checks
do not claim that three presentation families solve encounter or difficulty variety by themselves.

Formatting and `git diff --check` passed. The comparison bridge is absent from the production
JavaScript bundle. Inspection browsers and test servers were closed; the existing API on 8080
and UI on 5173 remain available.
