# Vertical Shooter roadmap

This document records the implementation direction for Sparkade's terrain-free vertical shooter.
The immediate target is a kiosk-demo-ready first impression: a generated game should look like one
coherent world from its story cards through its player craft, ordinary enemies, stage plates, and
finale boss, while moment-to-moment threats remain readable during upward fire and downward scroll.

The vertical shooter shares the H-scroll shooter's weapon, boss-pattern, generated-art, particle,
and hit-feedback vocabulary. It does **not** share a terrain corridor, world-space camera, surface
mounts, or a single forward route. All encounter composition and validation here therefore operate
in screen space across a fully traversable 512x300 playfield.

## Generation principle

The pilot and craft are separate identities. `heroConcept` describes the pilot and a
premise-appropriate story outfit; `playerCraft.visualConcept` describes a likeness-independent
top-down vehicle. Story art may show either or both and must preserve the selected craft identity,
but the player's face and body never become the gameplay craft.

New games require a locally usable generated top-down player craft, a five-role top-down enemy cast,
and a top-down finale boss. Muse creates bounded candidate pools, local image processing rejects
mechanically unusable silhouettes, and Spark selects among the valid candidates. The ordinary cast
uses one two-candidate-per-role board and at most one corrective role call for each role missing a
valid candidate. The boss uses one three-candidate pool and at most one corrective three-candidate
pool. Generation fails instead of publishing unrelated legacy combat art when a required identity
has no mechanically valid candidate. Compatibility-only library art remains available to older
specs that predate the generated-gameplay-art marker.

Stage backgrounds are presentation rather than mechanics. Each stage and the boss arena gets its
own generated vertical flyover plate when available, with procedural parallax retained underneath
and for independently missing plates. Generated plates must keep the full combat field subdued and
must never contain baked enemies, pickups, projectiles, UI, or collision-affecting scenery.

## H-scroll systems that adapt cleanly

Status: implemented in `888434d`; focused and full validation are green.

- The three-candidate player-craft pool, private presentation reference, local silhouette
  validation, Spark selection, and generated-only publication contract, using native **top-down,
  nose-up** art.
- Pilot/craft-separated key and story reference boards. Pilot likeness stays in story presentation;
  the same selected rigid craft identity is re-rendered naturally in story scenes and gameplay.
- Four independent key-art-directed stage plates, metadata for generated/partial/procedural
  readiness, dimmed generated art, and continuously moving procedural layers underneath.
- A story-art-derived boss candidate pool and a coherent five-role enemy candidate board with one
  bounded corrective stage, using native **top-down, nose-down** hostile silhouettes.
- Collision rectangles that remain explicit engine-owned mechanics while generated alpha bounds
  control only draw scale and effect attachment points.
- Shared projectile trails, cached silhouette-based shield aura, charge streams, sprite-derived
  exhaust/muzzle anchors, muzzle warnings, boss-pattern telegraphs, hit-stop, impact bursts, and a
  layered delayed boss defeat.

## H-scroll systems that do not fit

Status: intentionally excluded.

- Tile corridors, high-density terrain families, connected solids, exposed-surface decoration,
  terrain collision, and ceiling/floor turret mounting. The vertical playfield is terrain-free.
- World-column formation reconciliation, corridor clearance proofs, forward reaction-distance
  validation, surface firing windows, and terrain-aware pickup trajectories.
- Horizontal panorama panning tied to `scroll * durationS`, a world-space camera, lane-exterior
  close parallax, and side-view art rotation or ceiling mirroring.
- Fixed leftward muzzle assumptions or travel rotations. Vertical enemies face down by default;
  homing craft rotate from that native orientation into their actual screen-space velocity.

## Kiosk slice: generated visual identity

Status: implemented in `888434d`; mock pipeline coverage publishes the complete required set.

- Require premise-specific `popcorn`, `weaver`, `tank`, `turret`, and `kamikaze` concepts in the
  shooter design pass, sharing hostile-faction materials while preserving distinct silhouettes.
- Generate and atomically publish the complete top-down enemy atlas and finale boss for marked new
  specs. Refuse runtime startup when a marked game is missing either asset.
- Generate four portrait-oriented flyover plates, publish successful plates independently, load them
  through the web/engine asset path, and show them with procedural depth throughout a stage.
- Expose the player craft, enemy atlas, and boss in attract/library presentation without treating
  the pilot portrait as gameplay art.

## Kiosk slice: vertical encounter composition

Status: implemented in `888434d` for formation geometry/group clamping, dense-wave recovery,
authored pickup lanes, pickup/dense-wave clearance, and existing active-entity/bullet-density caps.

- Validate every formation's actual screen-space width, stagger, and entry shape rather than only
  its member count. Keep spawns away from HUD edges and clamp a formation as one unit before any
  member would be clipped.
- Enforce recovery gaps between dense overlapping waves, reserve readable space around pickup
  arrivals, and reject high-fire waves that stack into an unfair bullet peak.
- Give pickups an authored horizontal entry lane so rewards can follow a defeated formation or lead
  the player into the next safe region instead of appearing at an arbitrary RNG column.
- Keep path behavior bounded to vertical screen-space movement. No terrain, route, or mount contract
  is introduced.

## Kiosk slice: presentation and game feel

Status: implemented in `888434d`; focused runtime-contract tests are green.

- Derive the craft's exhaust and muzzle anchors from its real opaque silhouette; draw the rigid
  top-down craft at a consistent footprint with slight movement banking and speed-responsive exhaust.
- Draw ordinary and boss projectiles with travel-aligned trails. Rotate a homing kamikaze from its
  native downward orientation into actual velocity.
- Show ordinary-enemy and pod muzzle warnings. Give fan, spiral, walls, and aimed boss patterns
  distinct pre-fire language that previews the vertical-screen danger geometry.
- Replace the generic circular shield with a cached silhouette aura around the selected craft and
  make weapon power, charge readiness, bomb clearing, and damage states visually legible.
- Attach muzzle flashes and charge effects to sprite-derived anchors, strengthen heavy-enemy impacts,
  and hold the boss on screen for a multi-burst, multi-flash defeat before the victory card.
- Keep generated silhouettes rigid; animation, banking, propulsion, charge, shields, telegraphs,
  projectiles, hits, and destruction remain procedural so image-call cost stays bounded.

## Verification contract

Status: complete for this kiosk slice. Typecheck, lint, all three production builds, and the full
96-file/675-test suite pass from the vertical implementation checkpoint.

- Add pure tests for vertical craft anchors, generated atlas addressing/draw-vs-hit dimensions,
  homing orientation, boss telegraph timing, background travel, and formation/pickup validation.
- Add asset processor and bounded-retry tests for top-down boss, enemies, and backgrounds.
- Update the vertical golden game and mock provider to exercise the generated-only marker and every
  required asset while preserving schema compatibility for older unmarked saves.
- Run typecheck, lint, build, focused tests, and the full suite; update the statuses above only for
  slices that are implemented and green.
