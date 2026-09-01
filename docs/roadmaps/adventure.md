# Adventure roadmap

This document collects improvements for the top-down Adventure archetype. It is a direction
document, not committed release scope. The immediate goal is to bring over the strongest platformer
presentation systems while preserving the room-scale navigation, directional combat, puzzles, and
spatial readability that make an Adventure game distinct.

Existing generated games are test content rather than a compatibility contract. New Adventure
systems replace the old path directly instead of accumulating opt-in markers and legacy rendering
branches. The player is now generated-only: Spark ranks locally valid candidates and the pipeline
publishes the best complete set even when it misses the ideal semantic bar. If no mechanically valid
complete set exists, the generation job fails instead of substituting a library hero.

The archetype already has a strong structural base: a connected 8–14 room dungeon, keys and locked
gates, switches, pushable blocks, three secondary items, NPC dialog, five enemy behaviors, a
multi-phase boss, directional likeness heads, generated key/story art, weather, lighting, music, and
semantic validation. Its largest gap is presentation. Gameplay still depends on small legacy tile
and sprite art, one repeated decoration per theme, a mostly obscured parallax backdrop, and fixed
render layers that cannot support larger overlapping actors convincingly.

## Slice 1: semantic top-down terrain and depth

Status: the structural baseline is implemented. Adventure now uses connected density-four walls,
pits, and blocks, scaled overlays, a reviewed 16-fixture top-down atlas, two-cell directional doors,
deterministic low/tall decoration selection, one ground-contact depth axis, and restrained
actor/fixture shadows. The first floor-material experiment exposed exactly why dense repeating
tiles are a poor fit for a room-sized top-down playfield, so generated room surfaces supersede that
part of this slice.

- Reuse the reviewed Muse-authored material studies and source-palette harmonization that power the
  platformer tile library. Render density-four source art inside the existing 16-pixel world cells.
- Give Adventure its own top-down composition rules rather than importing the platformer's
  side-view cap/body assumptions. Walls are raised masses; pits are recessed; both derive visible
  edges from neighboring semantic cells without changing collision.
- Use deterministic spatial atlas frames for walls, pits, and blocks. Floors are now authored as
  continuous room plates rather than repeated terrain frames.
- Scale every overlay—hazards, switches, decorations, doors, and pushable blocks—into its semantic
  world footprint so source resolution is independent from collision resolution.
- Replace the legacy obstacle-contrast pass with material-aware raised and recessed edges.
- Add dedicated top-down authoring for pressure plates, pushable blocks, directional door sets,
  hazards, pits, and several decoration variants per theme. Bootstrap from shared material studies,
  then promote reviewed Adventure-specific fixture art into the checked-in library.
- Sort actors and tall fixtures by their ground contact Y coordinate, with restrained grounding
  shadows, so larger generated art can overlap naturally without appearing pasted onto the room.
- Add engine-level connected-terrain tests and Adventure runtime rendering tests before generated
  actors depend on the new depth rules.

## Slice 2: generated room-surface plates

Status: implemented. Every new Adventure generation now makes one additional Muse Image call,
conditioned on that game's key art, for a 2×2 atlas of entrance, ordinary, deep, and finale room
surfaces. Each panel is normalized to 1024×512—one source pixel per physical display pixel for the
full-width 512×256 logical room. The runtime selects a panel deterministically from room identity and
graph depth, then draws semantic walls, pits, doors, hazards, switches, blocks, fixtures, actors,
and effects above it.

Prompt study: [Drowned Observatory room-surface atlas](assets/adventure-room-plates-prompt-study.png).

- Treat the generated image as a surface plate, never as a source of collision. The model is
  explicitly forbidden from painting walls, pits, doors, hazards, switches, props, actors, or UI.
- Generate all four progression treatments in one call so palette, material language, and texture
  scale remain coherent while image cost stays bounded.
- Preserve large-scale composition while rendering materials at full native density with small,
  low-contrast grain and nuanced true-color ramps at three scales: broad tonal fields, medium-scale
  material flow and wear, and connected high-density microtexture. Keep 65–75% calm continuous
  material while explicitly rejecting the bland failure mode of a flat base covered in isolated
  square flecks, uniform dots, or random block noise. Every richer mark must remain flat,
  low-contrast, and noninteractive, with no focal point, object-like cluster, dark contour, bright
  pinpoint, glow, branching crack network, or prop-sized motif that could be mistaken for runtime
  state. Reserve the strongest edges, darkest outlines, brightest lights, warm danger colors, and
  saturated accents for actors, fixtures, hazards, pickups, projectiles, and telegraphs drawn above
  it. Explicitly reject macro-pixels, giant floor units, coarse mosaics, and simulated low-resolution
  enlargement.
- Keep a clear retro, pixel-art-esque identity through deliberate pixel placement, stepped edges,
  small intentional clusters, controlled ramps, and selective dithering. The target is modern
  high-density pixel art—not photorealism, smooth digital painting, or strict SNES-era limitations.
- Use entrance and finale panels only for their named rooms. Select ordinary versus deep from a
  stable graph distance measured from the dungeon entrance, never from mutable visit order.
- Publish the atlas through the normal generated-asset manifest and load it as one image. If the
  call is unavailable or invalid, fall back to the selected compact floor family while preserving
  every gameplay behavior.
- Preserve display-density detail through publication. The four-panel atlas is 1792×896 and the
  engine's 2× world transform places it 1:1 on the backing canvas instead of enlarging logical room
  pixels. Publish true-color PNGs without palette quantization, clip every selected panel to the
  authoritative room footprint, and composite the room frame above the generated surface.

## Slice 3: generated player identity and directions

Status: implemented. New Adventure games now generate one atomic twelve-pose hero set: down/up/side
idle and walk, plus down/up/side primary-melee contact and secondary-item release poses; side poses
mirror for left at runtime. After selecting the strongest of three identity foundations, the
pipeline makes one locomotion and one combat 3×2 sheet in parallel and uses a multimodal Spark
review to approve the identity, wardrobe, equipment, directions, actions, and complete combination.
The high-density art is drawn larger than the legacy hero while retaining the compact collider,
engine-owned combat profiles, item logic, doorway clearance, and ground-contact depth behavior.

While moving, runtime presentation alternates each direction's idle and contact poses at six frame
changes per second, giving the generated set a readable two-frame walk cycle without another image
call.

Prompt studies: [identity-consistent directional Adventure hero](assets/adventure-player-identity-study.png)
and [fixed 3×2 pose-sheet contract](assets/adventure-player-sheet-study.png).

- Use an explicit three-part identity contract. The uploaded player photo is immutable truth from
  the neck up: apparent adult age, face and head shape, skin tone, hair, facial hair, glasses,
  headwear, and every visible head accessory. Key art and the design-stage `heroConcept` are the
  canonical game-world wardrobe truth below the neck; clothing in the source photo is not copied.
  The selected down-idle gameplay foundation then becomes exact identity, wardrobe, scale, and
  pixel-technique truth for every other direction.
- Generate three identity-foundation candidates and let the existing multimodal Spark review select
  the strongest photo match. Reject candidates that remove or invent glasses, hats, hair, facial
  hair, or other head accessories, change apparent age, or copy the source-photo wardrobe.
- Seed every sheet cell with the selected gameplay foundation. Use the first fixed 3×2 sheet for
  down/up/side idle and walk states, and the second for down/up/side primary-melee contact and
  secondary-item release states. Reuse the Fighter pipeline's component-aware segmentation so art
  that slightly crosses a nominal cell edge is assigned to the right pose instead of being clipped.
- Review the twelve published poses as one identity- and equipment-consistent set. Spark chooses the
  best cell per pose while checking rear views, locomotion/action separation, exact primary and
  secondary equipment, wardrobe, accessories, scale, ground contact, and pixel technique. If a
  sheet misses a pose or the review identifies a weak one, generate only that isolated pose and
  review the repaired set again.
- Give every hero one camera-aware canonical handedness contract. Armed movement and melee keep the
  primary's main grip in the anatomical right hand—viewer-left from the front, viewer-right from
  behind, and the near arm in the generated right-facing profile—rather than pinning it to one
  screen side. Idle and walk carry it low beside the hip; only melee raises it. Secondary-use poses
  use the anatomical left hand while the primary remains low in the right, so no pose may swap hands
  or opportunistically move the primary onto the back, shoulder, or belt. Treat construction, grip,
  and stow-position drift as a fatal equipment inconsistency during Spark review.
- Feed a composite reference containing key art plus the exact selected gameplay hero into all four
  story-scene generations. For photo games, generate dialogue portraits from a second labeled board
  containing the player photo, key art, and selected gameplay hero. The photo stays neck-up likeness
  truth while key art and gameplay lock the same natural adult proportions, high-density pixel
  technique, wardrobe, and palette; explicitly reject chibi or mascot-style reinterpretations.
- Publish all twelve stable filenames together and activate them only after the entire set loads. The
  normal player path now uses five image calls—three identity candidates plus two pose sheets—instead
  of eight. Including all other current Adventure art and the one-call boss board, the expected
  total is 12 images without a player photo and 14 with one, down from the former unbatched path.
- Guarantee gameplay visibility independently from Muse output. Cache each generated pose at its
  exact physical display size with a one-physical-pixel near-black alpha-mask contour, then place a
  wider 34%-opacity hard-edged contact shadow under the player. Author and review the source poses
  over mixed light, dark, saturated, and noisy floor samples so the renderer reinforces an already
  readable silhouette rather than rescuing an unusable one.
- Fail local pose processing when a broken green-screen edit leaves an opaque rectangular panel or
  edge bars behind the hero. Those panels otherwise masquerade as the subject bounds and shrink the
  actual character. Route the failed cell through isolated-pose recovery, then mechanically validate
  scale and transparency across all twelve selected poses before publication.
- Treat Spark's acceptance threshold as quality telemetry rather than permission to replace generated
  art with a library body. After bounded targeted recovery, publish the strongest locally valid pose
  combination. Fail the job only when a pose is missing or the complete set fails mechanical image
  validation. New generations never produce directional likeness-head fallback assets.

## Generated finale boss

Status: implemented. New Adventure games make one Muse Image call for a fixed 2×2 board of four
story-art-faithful boss candidates. The server segments and validates each cell locally, then Spark
selects the strongest identity, top-down camera, silhouette, and gameplay read from a mixed-floor
review board. Only when all four cells fail does the pipeline spend one bounded isolated retry.
The selected 192×224 transparent source is published atomically as `adventure-boss.png`; the
runtime caches it at exact physical display density, adds a one-physical-pixel contour and contact
shadow, and renders a 48×56 visual over the unchanged 24×24 collider and existing phases.

- Derive one high-density boss foundation from the existing boss story illustration, using the same
  candidate generation, local processing, review board, manifest, metadata, and fallback principles
  as the platformer pipeline.
- Author for a front/down-facing top-down three-quarter view rather than a strict side view. Preserve
  the story-art identity, full silhouette, ground contact, and chamber-scale readability.
- Keep collision and attack patterns engine-owned. Telegraph frames, motion offsets, hit flashes,
  particles, and defeat effects can animate one excellent identity-stable foundation.
- Publish the generated boss atomically; retain the selected library boss only when no candidate
  survives generation and review.

## Generated enemy cast

Status: implemented. New Adventure games make one Muse Image call for a fixed 4×3 board containing
two candidates for each of `walker`, `flyer`, `shooter`, `chaser`, and `bruiser` (with the final two
cells deliberately empty). The server segments and validates all ten cells locally, then Spark
selects the strongest coherent five-role combination over mixed-floor previews. The final five
96×96 transparent sources are packed into one atomic atlas. Retry checkpoints preserve a paid,
valid board through later review failures; a board missing both candidates for any role is discarded
so the next job retry paints a fresh board. New Adventure games require the complete generated atlas
and never mix generated enemies with library fallbacks.

- Use top-down three-quarter silhouettes that communicate behavior without requiring four expensive
  directional turnarounds. Favor direction-neutral creatures and machinery where appropriate.
- Keep behavior hitboxes independent from visual bounds; the runtime adds exact-density contours,
  contact shadows, flyer hover motion, and role-specific display scale without changing mechanics.

## Themed items, NPCs, and room fixtures

Status: generated-object and puzzle-fixture slice implemented. New Adventure games make one Muse
Image call for a fixed 4×4 board containing two candidates each for the signature key, collectible
secondary item, friendly NPC, active secondary projectile/returning object/placed charge, pushable
block, and the raised/pressed states of one pressure plate. Spark selects one coherent,
gameplay-readable candidate per role over mixed-floor previews and forces the two switch states to
use the same numbered design pair, then the server publishes one required 672×112 atomic atlas. A
private board checkpoint lets retries resume review without repainting; a board missing both
candidates for any required role is discarded before a fresh job retry. The runtime uses the
generated set for pickups, interaction, shots, returning equipment, placed explosives, blocks, and
switches while keeping all collision and puzzle mechanics engine-owned.

- Expand each checked-in terrain family with multiple deterministic floor details, wall fixtures,
  low decorations, and tall decorations. Decoration selection must remain cosmetic and must not
  obscure doors, switches, pickups, hazards, or combat telegraphs.
- Use generated key art as style direction for per-game props while retaining strict isolated-asset
  processing. The universal heart remains library art; the four themed roles no longer use legacy
  visual fallbacks in newly generated games. Blocks fill their collision footprint in the same
  overhead three-quarter camera as actors, while switches change only mechanical depression—not
  palette or lighting—between raised and pressed states.

## Rooms, progression, and environment variety

Status: framing expansion implemented. Adventure rooms now use a shared 32×16-cell contract across
the schema, generation prompt, normalizer, golden fixture, door geometry, collision grids, and
runtime. The 512×256 playfield occupies the cabinet's full logical width while retaining full
one-screen visibility, centered two-cell doors, and a small HUD-safe vertical margin. Adventure no
longer draws the old procedural backdrop around generated room plates.

- Build on the four generated surface treatments with bounded fixture, lighting, and ambience
  variants for the start, puzzle wing, deep dungeon, and boss approach.
- Give authored room roles—entrance, combat, puzzle, NPC, treasure, transition, boss approach—small
  presentation vocabularies that affect fixtures, lighting accents, and ambient effects without
  altering solvability.
- Author new layouts across the full 32×16 footprint rather than clustering content into a smaller
  center. Keep broad navigable lanes, every door visible, and reaction space for projectiles and
  charge attacks.
- Use the generated top-down room surface as the only environment layer. Keep any residual
  HUD-safe margin flat and subordinate instead of exposing a mismatched panoramic backdrop.

## Combat, puzzles, and encounter quality

Status: the first three playability slices are implemented. The design pass now authors a required
story-specific combat kit instead of assuming fantasy gear: the always-available B attack maps to
one of three bounded engine profiles (`close`, `sweep`, or `reach`), while the collectible Y item
maps to `shot`, `returning`, or `blast`. Names and visual concepts carry the premise—wrench, whip,
fists, blaster, dynamite, and so on—while behavior and balance remain engine-owned. Opening, pickup,
gate, and finale guidance use those authored names. The boss gate requires the secondary item,
generation and lint prove it is reachable before every boss-room entrance, and the finale uses a
forgiving damage target and shorter HP range. The complete generated player set now visibly carries
the primary during locomotion and switches to dedicated primary-contact or secondary-release frames
when the corresponding button is pressed, without increasing the normal two-sheet image-call count.
Required keys and secondary-item pedestals are normalized onto hazard-free entrance-connected paths
and linted against hazard, pit, or wall enclosures. Pressure plates are functional rather than
decorative: they retract all room hazards only while every plate is held, generation must provide
hazards plus at least one pushable block per plate, and a bounded Sokoban search proves there is a
safe legal sequence of player movement and block pushes that completes the room. Runtime feedback
reports plate progress and hazard retraction/rearming.

Encounter-space validation now uses the runtime's actual collision and projectile rules. Every
door owns a calm four-by-three-cell interior reaction zone; keys, item pedestals, and NPCs require a
hazard-free route plus three clear approach sides; enemies cannot start in either reserve. Shooters
must have an unobstructed six-cell firing ray to reachable player space with a lateral dodge cell,
and rooms with three or more enemies must use at least ten cells of spatial span. The boss room
reserves a connected two-cell-wide outer dodge loop and central cross, then adds clear charge lanes,
four separated teleport pads, or two summon pads when its authored phases require them. The
normalizer deterministically clears these terrain reserves and relocates conflicting entities before
the lint/repair loop spends another model call.

Melee contact frames now pair with profile-specific directional motion trails instead of a detached
generic impact sprite: close attacks use compact swipes, sweep weapons use broad fading arcs, and
reach weapons use long thrust streaks whose visible distance matches their hitbox class. Pushable
blocks have a brief intent gate and cross one tile in 250ms rather than two seconds. Generated
shooters are authored right-facing, mirrored toward the player's horizontal position at runtime,
and emit projectiles from the corresponding silhouette edge.

- Add explicit line-of-sight and projectile-clearance checks for shooter placement.
- Validate free space for boss charge lanes, teleport destinations, summon points, and the player's
  required dodge routes.
- Make block-and-switch puzzles mechanically provable: every required block must be pushable onto a
  switch without becoming trapped against a wall, pit, door, or another block.
- Give enemy roles bounded composable traits—patrol shape, preferred distance, attack cadence,
  armor, and vulnerability—before adding more monolithic enemy names.
- Expand boss phases with clearer anticipation, arena interaction, and phase-specific spatial goals
  while retaining the existing bounded pattern vocabulary.

## Suggested order of exploration

1. Semantic connected walls/pits, scaled overlays, Y depth, shadows, and fixtures. Done.
2. One-call generated entrance/ordinary/deep/finale room-surface atlas. Done.
3. Complete generated player identity and directional walk presentation. Done.
4. Expand rooms to 32×16, remove the old backdrop surround, and retain room plates at physical
   display density. Done.
5. Generated finale boss from boss story art. Done.
6. Generated five-role enemy cast. Done.
7. Themed key, item, NPC, and selected projectile art. Done.
8. Room zones, stronger puzzle proofs, encounter-space validation, and broader gameplay vocabulary.
   Encounter-space validation and deterministic repair done; room-role presentation and broader
   enemy traits remain.
