# H-Scroll Shooter roadmap

This document collects improvements for the horizontal side-scrolling shooter archetype. It is a
direction document, not committed release scope. The immediate goal is to bring over the strongest
platformer presentation systems without weakening the long sightlines, projectile readability, or
continuous forward motion that make an H-scroll shooter work.

The archetype already shares compact `tileRuns`, semantic solid/hazard/decoration cells, world-space
collision, source-authored high-density terrain, a per-game player craft, generated key/story art,
required per-game boss and ordinary-enemy silhouettes, weather, lighting, music, and the common game
host. Its next gaps are richer coordinated encounter composition and optional small combat props.

## Generation principle

Existing games are test content, not a compatibility constraint. The player craft is required
generated art. Muse Image creates a candidate pool, Spark ranks it, and the best locally valid craft
ships even when it misses the ideal semantic bar. If no candidate has a mechanically usable
silhouette, generation fails instead of rotating or likeness-compositing a library ship. The finale
boss and five-role ordinary-enemy cast follow the same generated-only rule for new games. Library
combatants remain read-time compatibility for pre-migration specs only; optional environment plates
may still fall back independently.

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
- Generate three native right-facing side-view craft candidates, validate their silhouettes locally,
  and let Spark select the strongest. Reuse the selected rigid asset in gameplay and add banking,
  thrust, damage flashes, and trails procedurally.
- Preserve a private presentation-scale craft reference before deriving the 96×64 gameplay sprite.
  Feed key/story generation a divided identity board with that detailed reference below, and require
  the craft to be re-rendered naturally at the scene's scale, perspective, and lighting. Story cards
  may stage the pilot, the craft, or both, but must not paste the runtime sprite or merge identities.
- Stop generating directional likeness heads for H-scroll games. Spark rejection no longer activates
  a stable ship: the best locally valid craft is published, or the job fails when none exists.
- Publish required generated-craft readiness in game metadata. The runtime refuses to start without
  the manifest-backed craft rather than retaining an old likeness-composited ship branch.

## Slice 3: generated stage backgrounds

Status: implemented locally; focused validation is green.

- Generate separate background plates for levels 1-3 and the boss arena from the game's key art.
- Keep the central flight corridor subdued across its full height; a platformer's lower-third-only
  readability rule is not sufficient for free vertical movement.
- Scale panorama travel to the authored level duration, or combine a stable generated far plate with
  moving procedural parallax, so continuous autoscroll never visibly freezes at the crop boundary.
- Dim or grade generated plates consistently enough that bullets, pickups, terrain, and the HUD retain
  immediate contrast.
- Publish each plate independently and retain the procedural backdrop for every missing role.
- Pan each finite plate from its left crop to its right crop over the authored `scroll × durationS`
  distance, then clamp without exposing a seam. Blend the continuously wrapping procedural scene over
  it at low opacity so forward motion and depth remain visible throughout cleanup time.
- Track generated, partial, and procedural readiness in `hshooterBackdropArt` metadata.

## Slice 4: per-game gameplay art

Status: boss and ordinary-enemy cast implemented locally; focused validation is green.

- Player craft identity and generation are covered by Slice 2.
- Generate three native left-facing finale-boss candidates from the boss story card and publish the
  strongest mechanically valid identity/readability match as one 192×128 gameplay sprite. If the
  first pool has no mechanically valid candidate, generate one bounded replacement pool of three
  with corrective guidance. New games must not publish with the unrelated legacy boss: if neither
  pool produces a valid candidate, fail asset generation. Retain the library boss only as read-time
  compatibility for pre-migration games, while supplying motion, hit flicker, pods, projectiles, and
  destruction procedurally.
- Generate a coherent five-role enemy cast (`popcorn`, `weaver`, `tank`, `turret`, `kamikaze`) in
  native left-facing side view. One Muse board provides two candidates per role, local processing
  rejects mechanically unusable cells, and Spark selects the strongest coherent combination. If a
  role has no valid board candidate, make exactly one role-specific corrective replacement call;
  fail the job if that replacement is still unusable. Publish the complete five-cell atlas
  atomically, require it for marked new specs, and keep collision geometry independent from visual
  bounds.
- Generate projectiles, pods, and pickup icons only after the larger silhouettes prove their value;
  these roles add many image calls for relatively few on-screen pixels.
- Track the required generated boss and enemy-cast identities in metadata and expose the craft,
  atlas, and boss in the asset gallery.

## Encounter and level quality

Status: actual-column wave reconciliation, surface-mounted turrets, temporal route proof, and safe
pickup trajectories implemented locally; coordinated encounter regions remain pending.

- Replace the current cell-only flood fill with a clearance- and time-aware corridor proof that
  accounts for the ship hitbox, scroll speed, vertical travel speed, reaction distance, and hazards.
  The implemented proof advances the real screen-space control envelope at 30 Hz, shares its
  12×10 hit box, speed modes, and horizontal bounds with runtime, treats hazards as unavailable
  clearance, and reports the first impossible time/world column with repair guidance.
- Reconcile wave formations with terrain at every member's actual spawn column. Shift flying
  formations together toward open space, reject only members that still intersect terrain, and lint
  incomplete authored formations before publication.
- Mount turrets to a real exposed ceiling or floor surface, orient their presentation into the lane,
  require a clear leftward firing window, and reserve at least 48 px of inward dodge space.
- Place pickups on a safe reachable trajectory before difficult stretches rather than merely choosing
  an open center cell at spawn time. The implemented planner follows the pickup's full 70px/s screen
  drift through real terrain columns, excludes both solids and hazards, bounds vertical motion to the
  player's normal 120px/s speed, and rejects pickups that cannot enter a collection lane before the
  level ends.
- Add bounded authorable encounter regions so terrain, waves, hazards, and rewards can describe one
  coordinated beat instead of four independent timelines.
- Consider an H-scroll design lab only after the runtime and validator share the same temporal
  traversal model; the platformer jump/hydration lab is not directly reusable.

## Presentation and game feel

Status: kiosk closeout pass implemented locally; focused validation is green.

- Add clear boss-pattern telegraphs, projectile trails, charge effects, hit flashes, and layered defeat
  bursts using the shared particle and hit-stop systems. Boss fan, spiral, wall, and aimed patterns now
  reserve distinct visible windups; ordinary shooters and pods gain muzzle warnings; the runtime adds
  directional shot trails, speed-responsive exhaust, power-up weapon glow, an animated shield and
  charge core fed by short-lived, reshuffling energy lanes whose pixel ribbons and motes fade in as
  they travel inward,
  stronger impacts, and a delayed multi-stage boss destruction sequence. The ship shield
  now reuses the platformer's cached alpha-distance aura bands; exhaust and weapon effects attach to
  rear/muzzle points derived from each generated craft's real opaque silhouette; homing enemies pitch
  into their screen-space velocity; and the aimed warning uses restrained pixel guide lights instead
  of an out-of-style target reticle.
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
4. Generate the finale boss, establish terrain-aware turret and wave placement, then generate the
   enemy cast.
5. Temporal route validation and safe pickup trajectories.
6. Coordinated encounter regions, generated small props, and an H-scroll design lab if still valuable.
