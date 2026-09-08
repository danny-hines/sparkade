# Platformer encounter comparison — September 8, 2026

Branch `codex/platformer-encounters` adds twelve encounter patterns with three geometry variants, AI composition using recent delivered choices, placement checks, and combat pacing tailored to the player kit. Code checkpoints: `aa414de` and `f028906`, based on baseline checkpoint `aa8134d`.

**10/10 samples ready. Recorded spend: $5.714 of the $10 cap**, including 3 preserved failed experiments and their retries. The published application code has not been deployed from this branch. Use the local links below to test its combat timing.

| Style        | Sample                                                                        | Recorded cost | Levels generation calls | Controller routes       |
| ------------ | ----------------------------------------------------------------------------- | ------------: | ----------------------: | ----------------------- |
| acrobat      | [Sky Post Pico Dash](http://127.0.0.1:5173/?dev=playtest&game=g-bfr0cf9ev2)   |        $0.391 |                       1 | 3/3 exits; 0 lives lost |
| acrobat      | [Bell Orchard Hop](http://127.0.0.1:5173/?dev=playtest&game=g-tfgelpxkvu)     |        $0.392 |                       2 | 3/3 exits; 0 lives lost |
| runAndGun    | [Coral Current](http://127.0.0.1:5173/?dev=playtest&game=g-zj6cqhdjva)        |        $0.480 |                       1 | 3/3 exits; 0 lives lost |
| runAndGun    | [Dustline Deputy](http://127.0.0.1:5173/?dev=playtest&game=g-qmbx47w2ob)      |        $0.481 |                       1 | 3/3 exits; 0 lives lost |
| towerClimber | [Moonbell Ascent](http://127.0.0.1:5173/?dev=playtest&game=g-3op7twm3ic)      |        $0.391 |                       1 | 3/3 exits; 0 lives lost |
| towerClimber | [Glacier Signal: Mica](http://127.0.0.1:5173/?dev=playtest&game=g-yel1x51lun) |        $0.391 |                       1 | 3/3 exits; 0 lives lost |
| meleeAction  | [Thunder Palm](http://127.0.0.1:5173/?dev=playtest&game=g-gwj65cz1hv)         |        $0.432 |                       1 | 3/3 exits; 0 lives lost |
| meleeAction  | [Velvet Comet](http://127.0.0.1:5173/?dev=playtest&game=g-vkkohnkxqr)         |        $0.472 |                       1 | 3/3 exits; 0 lives lost |
| armedClimber | [Copper Comet: Rivet](http://127.0.0.1:5173/?dev=playtest&game=g-93ayhrabpd)  |        $0.524 |                       1 | 3/3 exits; 0 lives lost |
| armedClimber | [Solar Sprout](http://127.0.0.1:5173/?dev=playtest&game=g-k8dta3erxq)         |        $0.493 |                       1 | 3/3 exits; 0 lives lost |

Across the delivered samples: **12/12 patterns**, **36/36 pattern/variant combinations**, and **30/30 distinct level geometries with entity placements**. Names, music and provenance labels are excluded from that geometry comparison.

These are diversity checks, not a subjective uniqueness score. Games still share their movement controller and a finite encounter vocabulary. Recency is a model preference; it does not guarantee that future games will never repeat a sequence.

## What changed

- Horizontal patterns: bounce run, stepped route, high/low route, cover advance, overhead targets, patrol duel, jump-in approach and crossfire break.
- Climbing patterns: wall ascent, switchback climb, sheltered climb and armed ascent. Rest bridges keep later walls from burying earlier routes or checkpoints.
- Each level has 5–6 sections, at least three distinct patterns, no identical neighbors, an introduction and a final test. The AI selects order, variant, enemies, rewards and direction. Mixed armed climbers retain both horizontal and tower levels.
- The compiler writes ordinary tiles and entities plus an encounter plan. Validation recompiles that plan and rejects stale labels, incompatible kits, unsafe anchors, unsupported enemies and insufficient approach space.
- New-format turrets start a fresh firing interval when fully visible, with a 0.55-second pixel warning. Chasers wait while the player is more than two tiles away vertically. Bosses retain kit-specific telegraphs, recovery and late-phase limits; melee gets at least 0.7 seconds of warning and 1.4 seconds of recovery.
- The bounded composer currently does not author springs, moving platforms, ice or conveyors; those remain supported in legacy grids. Extending the catalog to expose those existing mechanics is a follow-up before treating it as a full replacement for free-form level authoring.
- Saved games without the new encounter version retain their previous timing. Existing tile-grid and tower-route compilation remains supported.

## Verification and limits

- `npm run verify`: 980 tests across 122 files, TypeScript, ESLint and production builds pass.
- A final design-template correction keeps story promises within the composer’s supported mechanics; all 23 affected prompt tests pass after that wording change.
- `npm run test:e2e`: 11 browser tests pass, including generated armed-climber playback and action assets.
- 81 encounter tests cover all twelve patterns, three variants, both directions, complete three-level games for every style, drift/placement rejection, schema compilation and recency labels. Additional real-controller tests cover turret first-shot grace, camera re-entry, chaser activation and final-phase boss openings.
- Live browser replay: 30/30 exits reached, 0 lives lost. Hostile actors are removed to isolate route physics; movement uses the production controller. This is not a full combat victory test. Scene screenshots use separate position setup.
- One initial automated Glacier Signal climb stalled while sprinting/jumping against an intermediate shelf; walking-speed climbing completed the route. Both attempts are retained. Test sprinting into these shelves manually when assessing feel.
- Browser sessions are launched muted and closed after inspection. Developer API and UI servers remain available.
- Automated reachability and spacing checks do not establish subjective combat balance, measured playtime, or the strength of the game’s branding. Human playtesting should focus on cover advances, tower landings, and melee boss openings.

## Suggested first playtests

- Compare Thunder Palm and Velvet Comet for melee approaches, airborne strikes, retreat room and boss recovery.
- Compare Coral Current’s plasma charging with Dustline Deputy’s conventional gun, which correctly uses `chargeShot: none`.
- Compare Copper Comet’s plasma armed climbing with Solar Sprout’s arcane charging and two tower stages. Both delivered mixed wall-jump/blaster structures.
- Compare Moonbell Ascent and Glacier Signal for changes in wall side, shelter placement and how shelves feel when running into a jump.

## Playtest correction: shots passing over enemies

Dustline Deputy exposed a combat bug that the route-only replay did not test: generated enemies
were drawn above their 14-pixel movement bodies, so a standing normal shot could visibly cross an
enemy without damage. Friendly projectiles now test the opaque artwork's bounding rectangle plus
the existing body, using the rendered scale and facing. Transparent outer padding is excluded;
movement, terrain collision and contact damage keep their existing bodies. Generated bosses use
the same correction.

The original miss was reproduced and then verified as a hit in Dustline Deputy. Browser checks
defeated its walkers, shooters and chasers from both directions and its elevated flyer with upward
fire. All 88 targeted platformer tests, typecheck, changed-file lint and production builds pass.
The fix applies when existing games reload; the sample assets and generation costs are unchanged.

## Artwork failures preserved

The new encounter layouts passed validation in the failed experiments. Their generated player poses exceeded the existing sprite canvas’s width-to-height limit. A locally rejected pose now leaves its reason in the generation feed. The experiment briefs were revised to supported upright silhouettes; the sprite quality gate was retained.

| Original experiment | Game ID        | Attempts | Recorded cost | Failure                                         |
| ------------------- | -------------- | -------: | ------------: | ----------------------------------------------- |
| Coral Current       | `g-9ncsqbiwot` |        2 |        $0.359 | Round/wide player poses failed scale validation |
| Moonbell Ascent     | `g-lbdlwxj1w9` |        2 |        $0.510 | Round/wide player poses failed scale validation |
| Copper Comet        | `g-hehhcnoczp` |        1 |        $0.400 | Round/wide player poses failed scale validation |

Glacier Signal required a same-brief retry after the image provider rejected a generated image. Velvet Comet required a saved-action retry for its airborne melee windup. Their successful job costs include the earlier attempts.

This exposes a separate limitation for future work: wide silhouettes, extended tails/wings and broad running strides need a deliberate per-character canvas/scale strategy. They should not be handled by silently stretching or shrinking individual animation frames.

## Delivered sequences

### Sky Post Pico Dash — acrobat

- **Windmill Rooftops**, horizontal/right: bounce-run v0 (none) → stepped-route v1 (walker) → patrol-duel v0 (walker) → high-low v1 (none) → jump-in v0 (flyer).
- **Postcard Crosswinds**, horizontal/left: high-low v0 (none) → bounce-run v2 (chaser) → stepped-route v0 (shooter) → jump-in v2 (flyer) → patrol-duel v1 (none) → high-low v2 (chaser).
- **Stamp Summit Row**, horizontal/right: jump-in v1 (walker) → high-low v1 (shooter) → patrol-duel v2 (chaser) → stepped-route v2 (flyer) → bounce-run v1 (walker) → jump-in v0 (shooter).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-bfr0cf9ev2-encounter.png)

### Coral Current — runAndGun

- **Sunken Intake Locks**, horizontal/right: cover-advance v1 (none) → overhead-targets v2 (flyer) → stepped-route v0 (walker) → high-low v1 (none) → cover-advance v0 (shooter).
- **Coral Lab Galleries**, horizontal/left: crossfire-break v2 (none) → overhead-targets v0 (shooter) → stepped-route v1 (chaser) → high-low v2 (flyer) → cover-advance v2 (shooter) → stepped-route v2 (walker).
- **Sonar Pump Causeway**, horizontal/right: high-low v0 (chaser) → cover-advance v1 (shooter) → crossfire-break v0 (shooter) → stepped-route v0 (chaser) → overhead-targets v1 (flyer) → high-low v2 (walker).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-zj6cqhdjva-encounter.png)

### Moonbell Ascent — towerClimber

- **Fallen Lens Stair**, tower/right: wall-ascent v0 (none) → switchback-climb v1 (walker) → sheltered-climb v0 (flyer) → wall-ascent v2 (none) → switchback-climb v0 (walker).
- **Clockwork Belfry**, tower/left: sheltered-climb v1 (none) → wall-ascent v1 (shooter) → switchback-climb v2 (walker) → sheltered-climb v2 (flyer) → wall-ascent v0 (shooter) → switchback-climb v1 (walker).
- **Indigo Spire**, tower/right: wall-ascent v2 (flyer) → sheltered-climb v0 (chaser) → switchback-climb v0 (shooter) → wall-ascent v1 (chaser) → switchback-climb v2 (flyer) → sheltered-climb v1 (chaser).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-3op7twm3ic-encounter.png)

### Thunder Palm — meleeAction

- **Plum Gate Path**, horizontal/right: patrol-duel v0 (none) → stepped-route v1 (walker) → patrol-duel v1 (walker) → high-low v0 (chaser) → jump-in v2 (walker).
- **Monsoon Terraces**, horizontal/left: jump-in v0 (none) → high-low v1 (flyer) → stepped-route v2 (flyer) → jump-in v1 (shooter) → high-low v2 (shooter) → stepped-route v0 (chaser).
- **Thunderbell Rise**, horizontal/right: patrol-duel v2 (chaser) → stepped-route v1 (shooter) → jump-in v0 (chaser) → high-low v1 (walker) → patrol-duel v0 (walker).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-gwj65cz1hv-encounter.png)

### Copper Comet: Rivet — armedClimber

- **Docking Causeway**, horizontal/right: cover-advance v1 (none) → overhead-targets v2 (shooter) → stepped-route v0 (walker) → crossfire-break v1 (shooter) → high-low v2 (chaser).
- **Switchback Stack**, tower/left: wall-ascent v0 (none) → armed-ascent v1 (shooter) → switchback-climb v2 (walker) → sheltered-climb v1 (flyer) → armed-ascent v0 (flyer) → wall-ascent v2 (chaser).
- **Comet Furnace Run**, horizontal/right: stepped-route v1 (flyer) → cover-advance v2 (shooter) → overhead-targets v0 (flyer) → high-low v1 (walker) → crossfire-break v0 (shooter) → stepped-route v2 (chaser).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-93ayhrabpd-encounter.png)

### Bell Orchard Hop — acrobat

- **Terrace Rows**, horizontal/right: bounce-run v0 (none) → patrol-duel v1 (walker) → jump-in v0 (walker) → high-low v1 (flyer) → stepped-route v2 (chaser).
- **Dusk Canopy**, horizontal/left: stepped-route v0 (none) → bounce-run v1 (chaser) → jump-in v1 (shooter) → patrol-duel v2 (walker) → high-low v2 (flyer).
- **Label Loft**, horizontal/right: patrol-duel v0 (none) → high-low v0 (shooter) → bounce-run v2 (walker) → jump-in v2 (chaser) → stepped-route v1 (flyer) → patrol-duel v1 (walker).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-tfgelpxkvu-encounter.png)

### Dustline Deputy — runAndGun

- **Dustline Platform**, horizontal/right: cover-advance v0 (none) → stepped-route v1 (walker) → overhead-targets v1 (flyer) → high-low v0 (none) → crossfire-break v2 (shooter).
- **Boxcar Run**, horizontal/left: stepped-route v2 (chaser) → overhead-targets v0 (flyer) → cover-advance v1 (shooter) → high-low v2 (walker) → crossfire-break v0 (shooter) → overhead-targets v2 (flyer).
- **Cinder Trestle**, horizontal/right: stepped-route v0 (none) → overhead-targets v1 (flyer) → crossfire-break v1 (shooter) → high-low v1 (chaser) → cover-advance v2 (shooter) → stepped-route v1 (walker).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-qmbx47w2ob-encounter.png)

### Glacier Signal: Mica — towerClimber

- **Base Relay Pines**, tower/right: wall-ascent v1 (none) → switchback-climb v0 (walker) → sheltered-climb v2 (flyer) → switchback-climb v1 (none) → wall-ascent v0 (chaser).
- **Blizzard Switchbacks**, tower/left: sheltered-climb v0 (none) → wall-ascent v2 (flyer) → switchback-climb v2 (walker) → wall-ascent v1 (shooter) → sheltered-climb v1 (none) → switchback-climb v0 (flyer).
- **Aurora Crown Mast**, tower/right: switchback-climb v1 (none) → sheltered-climb v2 (shooter) → wall-ascent v0 (chaser) → switchback-climb v2 (flyer) → sheltered-climb v1 (shooter) → wall-ascent v2 (chaser).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-yel1x51lun-encounter.png)

### Velvet Comet — meleeAction

- **Lobby of Tickers**, horizontal/right: patrol-duel v0 (none) → jump-in v0 (walker) → stepped-route v1 (none) → high-low v2 (flyer) → patrol-duel v1 (chaser).
- **Mezzanine Duels**, horizontal/left: high-low v0 (none) → stepped-route v2 (shooter) → patrol-duel v2 (chaser) → jump-in v2 (shooter) → high-low v1 (flyer) → stepped-route v0 (walker).
- **Chandelier Loft**, horizontal/right: stepped-route v1 (none) → jump-in v1 (flyer) → high-low v0 (shooter) → patrol-duel v0 (walker) → stepped-route v2 (flyer) → jump-in v0 (chaser).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-vkkohnkxqr-encounter.png)

### Solar Sprout — armedClimber

- **Glasshouse Approach**, horizontal/right: cover-advance v0 (none) → overhead-targets v1 (flyer) → stepped-route v2 (walker) → high-low v0 (shooter) → crossfire-break v1 (shooter).
- **Clockwork Vine Tower**, tower/left: wall-ascent v1 (none) → switchback-climb v0 (walker) → armed-ascent v0 (shooter) → sheltered-climb v2 (flyer) → switchback-climb v1 (chaser) → armed-ascent v1 (shooter).
- **Sun Dial Crossing**, tower/right: wall-ascent v2 (walker) → armed-ascent v2 (flyer) → switchback-climb v2 (shooter) → sheltered-climb v1 (chaser) → wall-ascent v0 (shooter) → armed-ascent v0 (shooter).

[Encounter screenshot](/Users/danny/sparkade/data/experiments/platformer-encounters-20260908/g-k8dta3erxq-encounter.png)

Raw prompts, specs, job feeds, cost ledgers, browser checks and screenshots are retained in `data/experiments/platformer-encounters-20260908/` (local, ignored by Git).
