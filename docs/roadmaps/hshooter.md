# H-Scroll Shooter roadmap

This document collects improvements for the horizontal side-scrolling shooter archetype. It is a
direction document, not committed release scope. The immediate goal is to bring over the strongest
platformer presentation systems without weakening the long sightlines, projectile readability, or
continuous forward motion that make an H-scroll shooter work.

The archetype already shares compact `tileRuns`, semantic solid/hazard/decoration cells, world-space
collision, generated key/story art, weather, lighting, music, and the common game host. Its largest
gap is that gameplay still uses legacy terrain and library sprite presentation while the platformer
has moved to source-authored high-density terrain and per-game Muse Image assets.

## Compatibility principle

New presentation systems should be explicitly enabled by a spec marker or archetype version rather
than silently repainting every saved H-scroll game. Generated assets remain optional and independently
fall back to stable library or procedural art when absent or rejected.

## Slice 1: richer presentation without new image calls

Status: implemented locally; focused validation is green.

- Generalize the platformer's high-density tile lookup and connected-solid renderer so side-view
  archetypes can share them without importing platformer gameplay code.
- Opt newly generated H-scroll games into source-authored, palette-harmonized terrain while keeping
  old specs on their legacy tile path.
- Add `tile_solid_inner` as an authored fallback pair and expose all available high-density terrain
  families to H-scroll generation.
- Derive sparse deterministic corridor fixtures from exposed solid surfaces. Keep them cosmetic,
  outside the traversable lane, and independent from gameplay RNG.
- Present the existing top-down fallback ships, foes, and bosses in the correct horizontal
  orientation until native side-view generated art replaces them.
- Surface the H-scroll bomb count in the shared HUD.
- Add dedicated H-scroll runtime/rendering tests before expanding the asset pipeline.

## Slice 2: separate pilot and player-craft identities

Status: implemented locally; focused validation is green.

- Keep the uploaded player's likeness as the pilot identity used by portraits, key art, and story
  cards. The design pass gives that pilot a premise-appropriate outfit, such as a pressure suit or
  dive suit, rather than treating the source photo's everyday clothing as identity.
- Give every newly generated H-scroll game a separate, concrete `playerCraft` visual concept. Never
  derive the craft from the player's face or body.
- Generate one native right-facing side-view craft on a transparent background. Reuse that rigid
  asset in gameplay and add banking, thrust, damage flashes, and trails procedurally.
- Feed presentation generation a divided identity board: pilot/key art above, exact gameplay craft
  below. Story cards may stage the pilot, the craft, or both, but must not merge their identities.
- Stop generating directional likeness heads for opted-in H-scroll games. If craft generation is
  unavailable or rejected, use a stable likeness-free library ship while keeping the generated
  portraits and story art.
- Publish craft readiness in game metadata and retain the old likeness-composited ship behavior only
  for saved H-scroll specs that predate the explicit craft marker.

## Generated stage backgrounds

- Generate separate background plates for levels 1-3 and the boss arena from the game's key art.
- Keep the central flight corridor subdued across its full height; a platformer's lower-third-only
  readability rule is not sufficient for free vertical movement.
- Scale panorama travel to the authored level duration, or combine a stable generated far plate with
  moving procedural parallax, so continuous autoscroll never visibly freezes at the crop boundary.
- Dim or grade generated plates consistently enough that bullets, pickups, terrain, and the HUD retain
  immediate contrast.
- Publish each plate independently and retain the procedural backdrop for every missing role.

## Per-game gameplay art

- Player craft identity and generation are covered by Slice 2.
- Generate the finale boss from boss story art using candidate selection and a stable library fallback.
- Generate a coherent five-role enemy cast (`popcorn`, `weaver`, `tank`, `turret`, `kamikaze`) in
  native left-facing side view. Keep collision geometry independent from visual bounds.
- Generate projectiles, pods, and pickup icons only after the larger silhouettes prove their value;
  these roles add many image calls for relatively few on-screen pixels.
- Track generated/partial/procedural readiness in metadata and expose every role in the asset gallery.

## Encounter and level quality

- Replace the current cell-only flood fill with a clearance- and time-aware corridor proof that
  accounts for the ship hitbox, scroll speed, vertical travel speed, reaction distance, and hazards.
- Reconcile wave formations with terrain at their actual spawn columns so members never begin inside
  walls or immediately crash while steering around them.
- Mount turrets to a real exposed terrain surface, orient them toward the flight lane, and reserve
  enough dodge space around their firing window.
- Place pickups on a safe reachable trajectory before difficult stretches rather than merely choosing
  an open center cell at spawn time.
- Add bounded authorable encounter regions so terrain, waves, hazards, and rewards can describe one
  coordinated beat instead of four independent timelines.
- Consider an H-scroll design lab only after the runtime and validator share the same temporal
  traversal model; the platformer jump/hydration lab is not directly reusable.

## Presentation and game feel

- Add clear boss-pattern telegraphs, projectile trails, charge effects, hit flashes, and layered defeat
  bursts using the shared particle and hit-stop systems.
- Use modest per-role draw scaling rather than a platformer-style whole-world heroic zoom; the player
  must retain enough forward visibility to read terrain and bullet patterns.
- Explore safe close-parallax elements that stay outside the central lane. Platformer foreground
  silhouettes cannot be reused unchanged because the ship may occupy any screen height.
- Make bank angle, thruster intensity, weapon glow, and damage state communicate the player's current
  speed and power-up loadout.

## Suggested order of exploration

1. High-density connected terrain, corridor decoration, orientation fixes, HUD, and runtime tests.
2. Separate pilot/craft identities and generate the native side-view player craft.
3. Generated level and boss backgrounds with continuous-scroll-aware presentation.
4. Generate the finale boss, then the enemy cast after terrain-aware turret and wave placement are
   reliable.
5. Temporal route validation and coordinated encounter regions.
6. Generated small props, broader VFX polish, and an H-scroll design lab if still valuable.
