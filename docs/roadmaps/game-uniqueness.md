# Game uniqueness: a design catalogue and recommended sequence

Discussion proposal, September 7, 2026. This is a catalogue of directions, not committed release
scope. Current capabilities below were checked against the local code and generation prompts.
Historical references illustrate design patterns; the suggested Sparkade mechanics and presentation
packages are original adaptations, not plans to reproduce those games. Effort labels are relative
judgments, not estimates based on prototypes.

## Implemented platformer milestones

Platformer now accepts five bounded `playStyle` packages. Existing saved games without the field
retain acrobat behavior. The design pass chooses the package before levels and artwork; generation
and repair receive that same choice.

| Package        | Gameplay and controls                                                                        | Level direction                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `acrobat`      | A jumps; B spin-jumps; X/Y run and use a selected projectile pickup                          | Momentum, bounces and horizontal jump courses                                                    |
| `runAndGun`    | Permanent blaster; Y fires; X fires or charges when enabled; UP aims upward; A jumps; B runs | Firing lanes, overhead threats and approach choices; contact hurts                               |
| `towerClimber` | Permanent wall slide/jump; A/B jump while pressing toward a wall; X/Y run                    | Tall ascents with rest ledges, required wall climbs and checkpoints at different heights         |
| `armedClimber` | Blaster plus wall slide/jump; A jumps, B runs, Y fires, X fires or charges, UP aims          | Horizontal, tower, or mixed stages; charge survives jumps and wall shots fire away from the wall |
| `meleeAction`  | Permanent energy strike on Y, with windup and recovery; A jumps; B runs                      | Ground approaches and jump-in strikes; active landing strikes damage enemies and bounce safely   |

The runtime reads `mechanics.traversal`, `mechanics.combat`, and `mechanics.structure` independently.
The five presets constrain AI to tested combinations. Armed climber defaults to mixed structure,
which requires at least one horizontal stage and one tower; pure horizontal or tower versions are
also supported. Its fingerprint records both the blaster and wall jump.

The HUD reports charge, melee readiness or ascent. New games generate five shared base frames
(128 pixels high, with a shared width of 112, 160, 192 or 224 pixels) plus mechanic-specific
actions (at least 160×128, with extra horizontal room for arms and strides):

| Mechanics                      | Additional frames                                           | Total |
| ------------------------------ | ----------------------------------------------------------- | ----- |
| Acrobat without projectile     | None                                                        | 5     |
| Acrobat with projectile pickup | Stand, two running contacts, airborne fire                  | 9     |
| Blaster                        | The four forward-fire frames plus four upward-fire variants | 13    |
| Wall jump                      | Wall slide; base jump handles the launch                    | 6     |
| Melee                          | Ground/air windup and strike                                | 9     |
| Armed climber                  | Blaster set, wall slide, wall fire away, upward wall fire   | 16    |

The design pass selects `chargeShot: none | plasma | arcane` for blasters. Conventional weapons use
`none`, with both fire buttons shooting immediately. Energy/magic charging reuses the aiming pose
with a dithered pixel core and gathering pixel sparks at the weapon. A full charge produces a larger projectile,
deals three boss damage, and pierces up to three ordinary enemies. Existing blaster saves without
the option retain plasma charging. Charging remains intact through wall jumps.

Melee uses a thin, broken pixel wave with a small descending foot sweep. Hits are checked throughout
the active window, once per target per swing. An active landing strike defeats an ordinary enemy or
deals two boss damage and bounces the hero clear; ordinary jump contact, windup and recovery remain
vulnerable. The same swing cannot trade boss body damage after its successful hit. Projectiles and
attacks outside the strike's coverage remain dangerous.

Wall rendering aligns each pose's opaque bounds with the wall, including the departure frame.
Short solid ledges, the visible eight-pixel side of one-way platforms, and moving-platform sides
support wall jumps. One-way undersides and transparent space below slabs remain passable; drop-through
still works. Collision uses stable surface geometry rather than treating decorative image pixels as
new terrain.

Running and airborne attacks
retain their movement silhouette. Wall sprites use a right-hand wall as their canonical orientation
and mirror for the other side. The character keeps empty hands; the runtime draws the energy bolt
or strike arc. Old saves without `actionPoseVersion: 1` keep their base animation.

Each action edits the approved running, jump, side, or wall-slide reference and passes local normalization plus
identity/costume/action review. Failed actions get one guided retry. Accepted poses are cached
individually; a missing required action prevents publication rather than substituting an idle frame. Tower route
validation replays the same wall controller and collision code as gameplay; its solver is conservative
and proves climbs from supported approaches to rest ledges. Invalid towers cannot fall
back to horizontal corridor repair. Legacy towerRoute and compact tile-grid authoring remain
supported for saved work. New platformer generations use the encounter composer described below.
Style/loadout conflicts are rejected during design.

Vertical shooters now offer three independent weapon styles: switching focus/spread, committed
piercing charge, and lock-on missile salvos. Each has required matching encounters, boss openings,
controls and HUD state. The [shooter roadmap](shooter.md#kiosk-slice-distinct-weapon-styles) records
the runtime and generation contracts and links to the three authored references.

Adventure now offers three objective styles: dungeon expedition, puzzle quest, and rescue raid.
They share the directional combat and tool kit while changing room composition, progression,
objective HUD, and victory conditions. Puzzle quests finish with a block-and-plate seal; rescue
raids finish only after rescuing captives, defeating the guardian, and returning to extract.
The [Adventure roadmap](adventure.md#objective-styles-expedition-puzzle-quest-and-rescue-raid)
describes the generator contracts, validation limits, and playable references.

All five archetypes now have a mechanical fingerprint derived from the final spec. New games save
it in `mechanics.json`; generation also derives it from recent saved specs, so old games participate
without a migration. The platformer catalogue uses a recency preference, with explicit player requests
taking precedence. This is selection guidance, not a guarantee of novel encounter layouts.

With `npm run dev`, open [the playable comparison](http://127.0.0.1:5173/?dev=playtest&style=acrobat)
and use its five style links. Keyboard: arrows move; **X** is A/jump; **Z** is B; **A** is X/charge;
**S** is Y/fire/strike; Enter is Start. The comparison reuses local golden art; the tower has an authored
reference course, armed climber combines both layouts, and other styles reuse the horizontal course to make controller differences
easy to compare. Real generation selects encounter compositions from the selected package brief.

Verification covers controller timing/damage, wall obstruction, physical tower completion, route
validation, tall coordinates, style-preserving repair, prompt selection, and all five packages through
the complete mock asset/publish pipeline. Browser checks use the real GameHost and loaded assets.
Live action experiments use the production pipeline; broader character coverage and human difficulty balancing still need playtests. Additional packages for other archetypes and new archetypes remain roadmap work. Platformer
presentation families are implemented below. The audit tables describe the earlier baseline.

Live pose previews (local experiment files must be present):
[armed climber](http://127.0.0.1:5173/?dev=playtest&style=armedClimber&actionRun=armed-climber-v2-live-20260907)
and [melee action](http://127.0.0.1:5173/?dev=playtest&style=meleeAction&actionRun=melee-v2-live-20260907).
The September 7 pilot passed review for all 11 armed-climber actions and all four melee actions.
Gameplay replay loaded the complete sets, rendered wall/air/ground attacks, retained charge on a
wall jump, and reached the tower exit. Reopening the armed-climber experiment reused every accepted
pose with zero image or review calls. This validates one character; it does not establish success
rates across arbitrary photos and costumes.

## Encounter composition milestone — September 8

New generation chooses 5–6 bounded encounters per level from twelve patterns, with three terrain
variants each. Eight horizontal patterns cover bouncing, stepped routes, high/low routes, cover,
overhead targets, patrol duels, jump-in attacks and crossfire. Four climbing patterns cover continuous
faces, switchbacks, sheltered landings and armed ascents. Each level needs at least three distinct
patterns, different neighbors, an introduction and a final test. The AI chooses order, variants,
direction, enemies and rewards; the engine compiles the geometry.

Saved encounter plans are checked against their compiled tiles and entities. Repairs cannot retain
stale labels after changing a route. Delivered pattern/variant labels feed the next game's recency
guidance. New-format turrets have a visible warning and a fresh firing interval on camera entry;
chasers wait until the player approaches their elevation; bosses retain kit-specific warning and
recovery windows. Existing saved games retain their previous timing.

See the [accepted scope](platformer-encounters.md) and
[live comparison report](../reports/platformer-encounters-20260908.md). Human combat balance and
broader character shapes remain areas for playtesting; the comparison preserves artwork failures
and records the limits of automated route checks.

## Presentation milestone — September 8

Platformers now choose `presentationFamily: storybook | tech | arcade` independently of play style.
Every family covers the HUD, controls, introduction, illustrated chapter/boss/story cards, pause and
audio menus, score tally, initials and records. Storybook uses warm paper, hearts and chapter wording;
tech uses segmented health and mission panels; arcade prioritizes score and bold banners. All use
the existing bitmap glyphs and pixel geometry. Additional typefaces remain future work.

The design prompt includes a recency preference with explicit aesthetics taking precedence. The
selection is preserved through assembly, repair and the final `mechanics.json`. Omitted fields in
old saved games retain the previous shell; new assemblies from old cached designs default to arcade.
The UI displays actual health, abilities, charge/strike readiness, ascent, score and elapsed play time.
Conventional guns do not gain charge indicators. No mechanics or score rules are selected by a family.

Story text now paginates within each layout. Family controls wait for A/START, so all eight bindings
can be read before beginning. Menu sounds use family-specific chimes; the music brief receives the
family direction. Existing artwork is reused and no additional image slots are required.

Open the [same-game comparison](http://127.0.0.1:5173/?dev=presentation&game=g-hehhcnoczp)
to switch families, saved games and screens. It starts muted; choose **play** for live gameplay.
Its result/record screens use sample numbers and do not write scores or alter saved games. Append
`&clean=1` for a full 1024×600 capture. See the [implementation report](../reports/platformer-presentation-families-20260908.md)
for visual comparisons and verification.

## Recommendation

Make each generated game choose a coherent **play style** within an archetype: a signature action,
a structure that makes that action useful, and presentation that communicates both. Prioritize
complete playable packages over independently selectable feature flags.

The first milestone should produce four platformers that players can distinguish with the same
placeholder graphics: a jumping course, an armed action game, a tower ascent, and a melee action
game. Then apply the same approach to Adventure, both shooters, and Fighter. Add an arena bomber
as the first new archetype; consider an action puzzler next. A scrolling brawler is especially
attractive for personalized heroes, but requires more animation and combat work.

## What currently limits variety

| Area               | Present today                                                                                                      | Constraint on perceived uniqueness                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platformer         | Five movement profiles; one or two of double jump, projectile, shield; ice/conveyors; springs and moving platforms | The main route must work with ordinary jumps. Abilities and moving platforms cannot define required traversal. Weapons are acquired powerups, not a selectable starting combat identity. |
| Adventure          | Close/sweep/reach primary attacks; shot/returning/blast secondary; keys, gates, switches, blocks, room graph       | Different equipment still serves a similar dungeon progression and boss preparation loop.                                                                                                |
| Vertical shooter   | Waves, formations, several paths, spread/rapid/shield/bomb pickups, charge shot and boss patterns                  | A narrow common weapon and resource loop; most differences are encounter timing and art.                                                                                                 |
| Horizontal shooter | Similar combat vocabulary plus collidable corridors and mounted turrets                                            | Stronger terrain identity, but still a similar player kit from game to game.                                                                                                             |
| Fighter            | Generated roster, three builds, bounded speed/power variation, best-of-three ladder                                | Every character shares the same move table and frame data. Costumes suggest differences the move sets cannot express.                                                                    |
| Diversity checks   | Recent titles/taglines, palettes, backdrop/library selections; title similarity check                              | The design pass does not receive a structured history of movement, weapons, objectives, or encounter structure.                                                                          |
| Presentation       | Extensive generated art and musical direction; a common HUD for most archetypes, a dedicated fighting HUD          | Layout, information hierarchy, health metaphor, transitions, and results structure have fewer choices than the art.                                                                      |

Evidence: [design prompt](../../packages/generation/prompts/design.md),
[platformer level rules](../../packages/generation/prompts/levels-platformer.md),
[game types](../../packages/shared/src/types.ts),
[design prompt assembly](../../packages/server/src/pipeline/prompts.ts),
[recent-game context](../../packages/server/src/pipeline/runner.ts),
[title similarity](../../packages/server/src/pipeline/validate.ts),
[fighter runtime](../../packages/archetypes/src/fighter/game.ts), and
[shared HUD](../../packages/engine/src/hud.ts).

Two constraints deserve particular attention:

- Platformer generation normally targets 14–18 rows, and the level schema caps height at 32 rows.
  The runtime already follows the player in both axes. A sustained ascent needs taller or connected
  regions, vertical framing and enemy activation review, and matching traversal validation; it is
  more than changing the camera direction.
- The ordinary-jump route rule is a useful guarantee for the existing platformer. A wall-jump game
  needs a different guarantee: a route proven reachable using the abilities actually available at
  each point. Removing the existing rule without replacing that proof would trade variety for
  broken games.

## SNES reference catalogue

This is a representative sample chosen for mechanical contrast, not an exhaustive popularity ranking.
The final column describes proposed Sparkade treatments, not exact historical HUD reproductions.
Linked game references support the historical mechanics.

### Platformers and side-view action

| Reference                                                                  | Distinctive mechanics or structure                                         | Sparkade package to explore                                                                   | Suggested presentation                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Super Mario World](https://en.wikipedia.org/wiki/Super_Mario_World)       | Momentum, spin jumps, cape flight, rideable companion, alternate exits     | Acrobat: jump chains, optional secrets, branching exits; glide as a later extension           | Rounded display lettering, reserve-item slot, illustrated route map               |
| [Mega Man X](https://en.wikipedia.org/wiki/Mega_Man_X_%28video_game%29)    | Arm cannon, charge shots, dash, wall climbing/jumping, acquired weapons    | Armed climber: starting weapon, wall slide/jump, short vertical combat shafts                 | Segmented energy meter, weapon indicator, technical stage cards                   |
| [Contra III](https://en.wikipedia.org/wiki/Contra_III:_The_Alien_Wars)     | Two switchable weapons, varied shots, bombs, combat set pieces             | Run-and-gun: starting gun, aim lock, weapon swap, fortified encounter gates                   | Weapon silhouettes, ammunition/bomb emphasis, mission briefings                   |
| [Super Castlevania IV](https://en.wikipedia.org/wiki/Super_Castlevania_IV) | Eight-direction whip, swinging from rings, limited secondary weapons       | Melee action: deliberate attack recovery, reach control, arc projectiles; swing anchors later | Ornamental frame, separate life and tool resource, dramatic encounter reveals     |
| [Donkey Kong Country](https://en.wikipedia.org/wiki/Donkey_Kong_Country)   | Roll attacks, barrel launches, minecarts, ropes, distinct level set pieces | Momentum course: launch chains and ride sections, each with its own timing challenge          | Sparse counters, dimensional material treatment, strong stage landmarks           |
| [Yoshi's Island](https://en.wikipedia.org/wiki/Yoshi%27s_Island)           | Flutter jump, aimed bouncing eggs, ground pound; coloring-book aesthetic   | Throwing platformer: hover burst plus bounded ricochet targets                                | Handmade frame and icons, visible projectile reserve, collection-focused results  |
| [Kirby Super Star](https://en.wikipedia.org/wiki/Kirby_Super_Star)         | Enemy-derived abilities, helpers, multiple game modes                      | Transformation platformer: replace one complete kit at specified stations or pickups          | Large current-form icon, soft shapes, ability-specific effects and help           |
| [Super Metroid](https://en.wikipedia.org/wiki/Super_Metroid)               | Interconnected exploration, traversal upgrades, revisiting earlier spaces  | Compact exploration: one connected map, one or two permanent unlocks, useful shortcuts        | Quiet environmental framing, map and equipment emphasis, restrained score display |
| [The Lost Vikings](https://en.wikipedia.org/wiki/The_Lost_Vikings)         | Switching between characters with complementary abilities to solve levels  | Puzzle platformer: start with one hero switching two tool modes; multiple heroes later        | Clear active-role indicators, objective checklist, room-reset control             |

Treat the tower ascent as its own recipe even though it can borrow from several references.
A climb changes the player's attention, level silhouette, fall consequences, camera anticipation,
enemy placements, and success condition. A cosmetic tower wrapped around a horizontal exit route
would miss those differences.

### Adventure and shooters

| Reference                                                                                   | Distinctive mechanics or structure                                              | Sparkade package to explore                                                                                       | Suggested presentation                                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [A Link to the Past](https://en.wikipedia.org/wiki/The_Legend_of_Zelda:_A_Link_to_the_Past) | Dungeon items, gates, secrets, travel between related worlds                    | Tool dungeon: a discovered tool solves traversal and the finale; paired world states much later                   | Equipment slot, room map, readable gate symbols                             |
| [Secret of Mana](https://en.wikipedia.org/wiki/Secret_of_Mana)                              | Real-time combat with a replenishing attack-power gauge and ring menu           | Action adventure: committed attacks, stamina timing, a small selectable spell/tool kit                            | Action gauge and compact radial selection; spell color motifs               |
| [Goof Troop](https://en.wikipedia.org/wiki/Goof_Troop_%28video_game%29)                     | Puzzles, thrown objects and kicked blocks instead of direct attacks             | Puzzle adventure: blocks, switches, carrying and throwing, resettable rooms                                       | Tool pockets, clear puzzle completion feedback, low-pressure musical pacing |
| [Zombies Ate My Neighbors](https://en.wikipedia.org/wiki/Zombies_Ate_My_Neighbors)          | Rescue objectives, unusual weapons, navigation through threatened neighborhoods | Rescue mission: locate targets, choose routes, manage ammunition, reach extraction                                | Rescue tally, radar, urgent radio-style messages                            |
| [Gradius III](https://en.wikipedia.org/wiki/Gradius_III)                                    | Selectable/customized weapon configurations                                     | Upgrade shooter: choose between immediate power and saving toward another upgrade                                 | Upgrade ladder as the main HUD feature                                      |
| [R-Type III](https://en.wikipedia.org/wiki/R-Type_III:_The_Third_Lightning)                 | Different Force units, charge cannon, temporary Hyper fire with overheating     | Tactical corridor shooter: attachable defense/offense pod or charge/heat management                               | Pod state, prominent charge/heat indicator, deliberate warning language     |
| [U.N. Squadron](https://en.wikipedia.org/wiki/U.N._Squadron)                                | Energy bar, money, aircraft and special-weapon purchasing                       | Mission shooter: buy one of a few loadout options between missions                                                | Pilot identity, hangar choices, mission map, hull and ammunition gauges     |
| [Axelay](https://en.wikipedia.org/wiki/Axelay)                                              | Stage-earned weapons and alternating vertical/horizontal stages                 | Loadout progression first; mixed-orientation campaign only after both runtimes support a common campaign contract | Weapon rack and route briefing; stage-specific camera cues                  |

For the current **vertical shooter**, prioritize focused versus wide fire, a defensive counter ability,
and objective variants such as intercepting a convoy or defending a target. For the current
**horizontal shooter**, prioritize terrain-linked combat, charge/heat tradeoffs, and a deployable pod.
Share weapon implementations where practical while retaining separate encounter and collision rules.
Pursuit, defense, and counter mechanics in this paragraph are proposals, not currently supported choices.

### Fighting and possible new archetypes

| Reference                                                                                      | Distinctive mechanics or structure                                                                   | Sparkade direction                                                      | Main new work                                                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Street Fighter II Turbo](https://en.wikipedia.org/wiki/Street_Fighter_II_Turbo)               | Character-specific special moves and matchups                                                        | Fighter profiles: rushdown, ranged control, grappler, counterattacker   | Tested move kits, distinct AI intent, telegraphs and matching poses                     |
| [Killer Instinct](https://en.wikipedia.org/wiki/Killer_Instinct_%281994_video_game%29)         | Combos and combo breakers                                                                            | Later Fighter ruleset with short chains and a defensive escape resource | Combo state, escape windows, balance; do not simply increase attack speed               |
| [Super Punch-Out!!](https://en.wikipedia.org/wiki/Super_Punch-Out!!)                           | Behind-the-boxer viewpoint, dodge/block/duck, timed counterattacks                                   | Separate timing-duel candidate                                          | Opponent pattern language, large expressive tells, dedicated camera and input model     |
| [Turtles in Time](https://en.wikipedia.org/wiki/Teenage_Mutant_Ninja_Turtles:_Turtles_in_Time) | Scrolling group combat, throws, attacks involving nearby enemies                                     | New scrolling brawler                                                   | Ground-plane depth plus jump height, crowd spacing, grabs, action poses                 |
| [Super Bomberman](https://www.konami.com/games/bomberman/collection/us/en/)                    | Bomb placement, destructible mazes, powerups; series variants add different bomb behaviors           | New arena bomber                                                        | Timed blast grid, chain reactions, escape planning, enemies and map validation          |
| [Tetris Attack / Panel de Pon](https://en.wikipedia.org/wiki/Tetris_Attack)                    | Swapping adjacent panels, rising stack, chains and combos                                            | New action puzzle                                                       | Board simulation, match/chain timing, pressure curve; a solver for authored puzzle mode |
| [Wild Guns](https://en.wikipedia.org/wiki/Wild_Guns)                                           | Foreground movement, aiming into depth; holding fire changes directional control to reticle movement | New gallery shooter                                                     | Clear aim/move mode, depth telegraphs, dodge windows; compatible with one stick         |
| [F-Zero](https://en.wikipedia.org/wiki/F-Zero_%28video_game%29)                                | High-speed racing, vehicle durability, repair areas                                                  | Later racer focused on handling and time trials                         | Track representation, driving physics, camera, AI and track validation                  |
| [Super Mario Kart](https://en.wikipedia.org/wiki/Super_Mario_Kart)                             | Handling, items, races and arena battles                                                             | Later combat-racing variation                                           | Racing foundation plus item interactions, rival AI and fair pickups                     |

Nintendo also hosts the original [SNES Classic manuals](https://www.nintendo.co.jp/clvs/manuals/en_us/index.html),
a useful primary-source reference set for a subsequent control, HUD and screen-layout study.

## A bounded vocabulary for the generator

Use three levels of design data:

1. **Archetype:** the runtime family, its collision model and overall rules.
2. **Play style:** a curated compatible package with a signature mechanic and level patterns.
3. **Game identity:** the selected package's permitted modifiers, objectives, encounters, fiction,
   artwork, interface and music.

The following categories are a proposed option catalogue. Most entries are extensions; only the
capabilities explicitly listed in the current-state table are confirmed as supported.

| Dimension           | Candidate options                                                                                         | Selection rule                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Movement            | Precision, momentum, heavy, floaty; wall jump, dash, climb, glide, swim, limited flight                   | One base profile and usually one signature traversal mechanic                           |
| Primary interaction | Stomp, melee, direct shot, charged shot, spread, returning shot, thrown object, placed bomb               | Must change timing, positioning or targets; a new projectile picture is identity only   |
| Defense             | Health, limited armor, shield, directional block, parry, dodge, protective companion                      | Pick a coherent damage/recovery model that does not remove required traversal abilities |
| Space and camera    | Horizontal course, tower, descent, locked rooms, connected map, arena, autoscroll                         | Must agree with spawn activation, safe sightlines, art composition and reachability     |
| Objective           | Reach exit, climb to summit, rescue, collect then extract, survive, defend, defeat target, solve puzzle   | Select one main objective; use supporting objectives sparingly                          |
| Progression         | Fixed starting kit, temporary pickup, permanent unlock, between-stage choice, small shop, branching route | Declare acquisition, persistence, loss, and checkpoint behavior explicitly              |
| World interaction   | Ice, conveyor, spring, moving platform; breakables, switches, blocks, rising hazard, launchers            | Build recurring encounter patterns around the chosen interaction                        |
| Enemy response      | Patrol, chase, ranged attack; directional armor, shields, weak points, counters, retreat, ambush          | Enemies should require different player decisions, with consistent readable cues        |
| Finale              | Duel, multi-part target, pursuit escape, defense holdout, puzzle resolution                               | Resolve the signature mechanic; new finale types need host and schema support           |
| Rewards             | Score, secrets, rescue grade, time medal, ammunition, energy, shop currency                               | Reward the behavior the game is intended to emphasize                                   |

Each supported mechanic needs a contract covering input, runtime behavior, allowed parameters,
required assets, compatible cameras/objectives, acquisition and persistence, validation and repair.
Keep numeric balance engine-owned initially. A finite collection of reviewed action modules is
enough; this does not require building a general-purpose game scripting language.

### Make signature mechanics matter

A package should contain several parameterized encounter patterns, not one reusable level.
For wall jumping: a safe practice shaft, an offset shaft, a shaft with timed threats, a branching
climb, and a finale that asks the player to climb while reading danger. Compose and vary these
patterns across games so the package itself does not become another obvious template.

Validate ability acquisition before gates, route feasibility with the actual movement profile,
recovery from optional detours, and checkpoint restoration. Timed surfaces and moving platforms
need temporal checks. A required weapon needs enough ammunition or a renewable resource; a puzzle
needs recoverable state or a reset. Geometry alone cannot establish all of these guarantees.

Use the signature action early, reinforce it in different situations, and make it relevant in the
finale. Not every ability must be mandatory: a defensive or score-focused signature can change
decisions without becoming a traversal gate.

## Branding and UI as authored design

Three platformer families are implemented above. The broader catalogue below remains a design
direction; expedition and tournament are not released presentation choices:

| Family              | Information hierarchy                                         | Visual and audio direction                                                           |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Technical action    | Energy, selected weapon, charge, altitude or mission progress | Narrow display type, segmented meters, hard-edged panels, restrained electronic cues |
| Storybook adventure | Health, tool, collection or quest progress                    | Rounded display type, handmade borders and icons, soft transitions, playful cues     |
| Expedition          | Map, equipment, resources, discoveries                        | Compact panels, environmental framing, quieter UI, exploratory music                 |
| Tournament          | Opposing health, timer, rounds, special resource              | Large names/portraits, strong versus composition, emphatic round transitions         |
| Arcade challenge    | Score, multiplier, time, rank                                 | Large numerals, punchy feedback, short transitions, energetic results                |

Within each family select title composition, border treatment, curated font, icon language,
HUD arrangement, stage transition, defeat/retry treatment, results categories, musical motif and
sound-effect timbre. HUD choice must follow real mechanics: show a charge meter only when charge
exists, and put rescue progress ahead of incidental score in a rescue game.

Keep live text, numbers, bar fills, hitboxes and interaction cues rendered from real state. Generate
decorative frames, emblems and title art where worthwhile. A few tested layouts protect readability
on the 512×300 logical screen while allowing substantial visual difference. Font expansion needs
reviewed glyph coverage and text measurement. New attack or climbing states also need an explicit
pose budget; visual coherence must extend into the new actions.

## Selecting for diversity

1. Extract a mechanical fingerprint from recent ready games: archetype, play style, starting verbs,
   traversal, weapon behavior, objective, topology, progression, damage model and presentation family.
2. Choose a small number of candidate designs using only released capability contracts. Respect
   explicit player choices first, then favor candidates different from recent games of that archetype.
3. Compare mechanical dimensions more strongly than names, palette or musical key. Start with
   interpretable categorical rules; tune weights using playtests rather than claiming a theoretical
   number of combinations equals a number of distinct games.
4. Commit the selected package before expensive artwork. Pass the same contract to level, entity,
   music, UI and art generation. Package-specific examples should replace the single broad example
   where it would otherwise bias generation toward one structure.
5. Inspect the final repaired spec. If repairs remove the defining mechanic or its encounters,
   regenerate those encounters or select another valid design. Record the final fingerprint,
   not just what the first design pass promised.

Use a recency penalty, not a permanent ban: a small catalogue will eventually repeat, and users may
explicitly want another game in a favorite style. Also track which encounter patterns were used,
because two games can share a signature mechanic while having meaningfully different layouts.

## Recommended implementation sequence

| Priority | Deliverable                                                                                 | Why it earns its place                                                        | Main dependency/cost                                                                |
| -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1        | Mechanical fingerprints, play-style field, existing-capability recipes                      | Exposes and measures repetition; improves selection before new mechanics ship | Design/spec integration and final-spec recording; modest art cost                   |
| 2        | Starting ranged kit and a melee platformer kit                                              | Changes moment-to-moment decisions using the current side-view foundation     | Input separation, attack poses, combat encounters and validation                    |
| 3        | Wall slide/jump plus a genuine tower route                                                  | Large, visible change to movement and spatial structure                       | Tall/connected regions, camera/activation review, traversal solver, wall poses      |
| 4        | Three presentation families and mechanic-aware HUDs                                         | Makes the new identities apparent in gameplay and menus                       | Layout constraints, fonts/icons and asset contract; mostly reusable per-game assets |
| 5        | Adventure puzzle/rescue packages; shooter weapon/resource packages; Fighter combat profiles | Extends the same system across all five archetypes                            | Puzzle/objective validation; shooter pattern budgets; fighter balance and pose cost |
| 6        | Arena bomber, then evaluate action puzzle versus scrolling brawler                          | Adds decisions and game structures absent from the current library            | New runtimes, generation contracts, validators, demo behavior and content model     |

Priorities are dependency-oriented, not a schedule. Presentation work can accompany the first
mechanics. Within priority 5, Fighter deserves particular attention if repeat Fighter generation is
common: shared moves impose a direct ceiling on gameplay differentiation.
The [first Fighter combat-profile slice](fighter.md) now implements rushdown,
counter and ranged-control kits with mixed opponent ladders; see the
[verification report](../reports/fighter-styles-20260911.md).

Defer large interconnected adventures, arbitrary copied enemy abilities, unrestricted grappling,
multiple controllable heroes, long RPG campaigns and mixed-runtime campaigns until simpler packages
prove out. These introduce persistent state, solver complexity, content demands or many new poses.
Racing is a strong later addition, but is a larger foundation investment than an arena bomber.

A new archetype should earn its own runtime when its simulation or rules genuinely differ. A tower
climber belongs within Platformer. A bomber's timed blast grid and a brawler's depth-aware crowd
combat justify new archetypes. A top-down rescue shooter could begin as an Adventure package; split
it only if that progression/input model stops fitting cleanly.

## Proving the result

First build small authored reference games to establish that each package is fun. Then generate a
batch from each and inspect gameplay, not only screenshots.

- Can players describe the unique action and objective after the first minute?
- With names and art neutralized, can they still distinguish the platformer packages?
- Does the signature mechanic recur in different useful situations and influence the finale?
- Do repeated generations vary encounters and route structure within a package?
- Are requested mechanics retained after validation and repair?
- Do games complete without softlocks, resource starvation or checkpoint failures?
- Do controls remain understandable on one digital stick, with no mouse or second stick assumed?
- Do frame time, entity/bullet limits, generation latency and image-call cost remain acceptable on
  the actual cabinet target?

Track replay choice, perceived similarity, completion and repair rates alongside cost. Keep the
existing five-minute minimum in view: short puzzle rounds need a suitable multi-round session or
an explicit product decision about duration, rather than silently changing that requirement.

The release criterion is several identifiable games that remain enjoyable across repeated
generations, not a larger count of schema combinations.
