# Platformer roadmap

This document collects possible customization levers for generated platformers. It is a direction
document, not committed release scope or an implementation sequence.

The architectural goal is to describe a platformer as a composition of a **movement profile**,
**ability loadout**, **world-material set**, **damage model**, and **camera profile**. A modest set
of composable, validated systems should be able to produce games that feel structurally related but
play very differently, instead of producing differently themed versions of the same platformer.

## Generated player policy

New platformers require the complete generated five-pose player set whether or not a likeness photo
was supplied. With a photo, it remains head-identity truth; without one, key art establishes the
original hero. Muse Image produces multiple identity, run, and jump candidates and Spark selects the
best locally valid combination. Spark's ideal-quality threshold is telemetry, not a switch back to a
library body. If no mechanically complete generated set can be assembled after bounded recovery, the
generation job fails. The runtime has no library-player rendering branch and new generations do not
produce directional likeness-head fallback assets.

## Movement and physics profiles

- Ground acceleration, braking, maximum speed, and momentum retention.
- Jump height, gravity, terminal velocity, and variable-height jumping.
- Air control, coyote time, jump buffering, and whether the player can redirect committed jumps.
- Double or multiple jumps; wall slides, wall jumps, and wall climbing.
- Dashes, rolls, slides, crouching, ground pounds, swimming, flying, gliding, and jet packs.
- Ladders, ropes, rails, and other climbable or traversable paths.
- Character collision shape, knockback resistance, and interactions with slopes.

Different combinations should cover movement ranging from Mario-like momentum to Mega Man-like
precision or Castlevania-like committed jumps without requiring separate physics engines.

## Surface materials

Treat ground friction as one property of a reusable surface-material system. A material could
control:

- Traction, acceleration, braking, and slope behavior.
- Bounce or launch impulse.
- Conveyor direction and force.
- Sinking, slowdown, or periodic damage.
- Whether it can be climbed, clung to, broken, or passed through.
- Footstep particles, animation, and sound.

This system could express ice, mud, quicksand, trampolines, conveyor belts, sticky walls, damaging
floors, and other level-specific terrain without making each one a bespoke mechanic.

## Abilities and combat

Model special mechanics as modular abilities that can be built into a character, equipped as a
loadout, granted temporarily by a power-up, or unlocked through progression.

- Projectile weapons, including charge shots, spread shots, and aimable shots.
- Melee weapons with configurable range, arc, timing, and combo behavior.
- Stomping or bouncing on enemies.
- Shields, parries, temporary invulnerability, and damage reflection.
- Grappling hooks, swinging, and object pulling.
- Bombs and destructible terrain.
- Teleportation or short-range blinking.
- Time slowing, freezing, or rewinding.
- Companion or familiar abilities.
- Carrying, throwing, or kicking objects and enemies.
- Transformations that replace part or all of the movement and combat kit.

A useful ability definition would combine an input, activation conditions, cooldown or resource
cost, animation, movement impulse, hitbox or projectile, and resulting effects. The same vocabulary
could represent an arm cannon, whip, fireball, dash, or jet-pack burst without hard-coding each as a
separate subsystem.

## Health and failure model

- One-hit deaths, health bars, armor, shields, or regenerating health.
- Lives, checkpoints, and unlimited retries.
- Contact damage versus enemies that are safe to touch from some directions.
- Temporary invulnerability and configurable knockback after taking damage.
- Pit deaths versus returning the player to nearby solid ground.
- Losing currency, abilities, power-ups, or level progress on death.

## Level interactions

- Moving, falling, rotating, crumbling, and appearing platforms.
- One-way and semisolid platforms.
- Switches, pressure plates, keys, doors, and timed gates.
- Pushable blocks and other physics objects.
- Breakable or ability-gated terrain.
- Springs, launchers, cannons, teleporters, wind, and low-gravity zones.
- Water, darkness, rising hazards, autoscrolling, and chase sequences.
- Branching paths, secret rooms, alternate exits, and boundary wrapping.
- Gravity reversal or gravity that changes by region.

## Enemies and encounters

- Composable patrol, chase, jump, fly, burrow, orbit, and turret behaviors.
- Vulnerability rules such as stompable, projectile-only, directional, armored, or weak-point based.
- Configurable attacks, encounter triggers, and spawning rules.
- Boss phases and attack-pattern sequencing.
- Enemies that interact with terrain, switches, other enemies, or carried objects.
- Friendly, neutral, or recruitable entities.

Prefer combining movement, targeting, defense, and attack behaviors over building a fixed catalog of
monolithic enemy types.

## Camera and game feel

- Tight or loose following, velocity look-ahead, and vertical dead zones.
- Room-based camera locks, continuous scrolling, screen-by-screen movement, and autoscrolling.
- Camera zoom and special framing for encounters or boss rooms.
- Configurable screen shake, hit-stop, squash and stretch, motion trails, and impact effects.
- Parallax, lighting, weather, and palette transitions tied to level regions.
- Animation timing tied to movement and action state.

Camera behavior and feedback affect how responsive the same underlying movement values feel, so
they should be treated as gameplay configuration rather than only presentation polish.

## Collectibles and progression

- Score, coins, rings, ammunition, ability energy, and other resources.
- Temporary versus persistent power-ups.
- Character upgrades, skill trees, and ability-gated backtracking.
- Multiple playable characters with distinct movement and ability profiles.
- Linear, branching, hub-based, or interconnected world structures.
- Level-specific objectives, optional challenges, hidden collectibles, and completion ratings.

## Input and accessibility

- Remappable actions and configurable ability slots.
- Hold-versus-toggle behavior and analog-versus-digital movement.
- Directional or twin-stick aiming where the cabinet controls allow it.
- Reduced game speed and adjustable damage, lives, checkpoints, or assists.
- Optional automatic grabbing, climbing, aiming, or repeated button actions.

Every generated control scheme must remain compatible with the cabinet's bounded control map and
must be teachable through the existing control-help UI.

## Suggested order of exploration

1. Richer data-driven movement profiles.
2. Surface materials, beginning with friction and conveyors.
3. Modular player abilities and ability-granting power-ups.
4. Configurable health, damage, knockback, and death rules.
5. Reusable platform, environmental, and hazard behaviors.
6. Composable enemy behaviors and vulnerability rules.
7. Camera and game-feel profiles.
8. Persistent abilities and broader progression structures.

For each slice, design the bounded schema and semantic validation alongside the runtime. Generation
prompts should only expose combinations that the linter can prove are playable—for example, an
ability-gated route must place the required ability on a reachable route before the gate.
