# Adventure roadmap

This document collects improvements for the top-down Adventure archetype. It is a direction
document, not committed release scope. The immediate goal is to bring over the strongest platformer
presentation systems while preserving the room-scale navigation, directional combat, puzzles, and
spatial readability that make an Adventure game distinct.

Existing generated games are test content rather than a compatibility contract. New Adventure
systems should replace the old path directly instead of accumulating opt-in markers and legacy
rendering branches. Stable library fallbacks still matter when an image call is rejected or fails;
that is generation resilience, not saved-game compatibility.

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
surfaces. Each panel is normalized to 896×448—one source pixel per physical display pixel for the
expanded 448×224 logical room. The runtime selects a panel deterministically from room identity and
graph depth, then draws semantic walls, pits, doors, hazards, switches, blocks, fixtures, actors,
and effects above it.

Prompt study: [Drowned Observatory room-surface atlas](assets/adventure-room-plates-prompt-study.png).

- Treat the generated image as a surface plate, never as a source of collision. The model is
  explicitly forbidden from painting walls, pits, doors, hazards, switches, props, actors, or UI.
- Generate all four progression treatments in one call so palette, material language, and texture
  scale remain coherent while image cost stays bounded.
- Preserve large-scale composition while rendering materials at full native density with small,
  human-scale motifs, nuanced true-color ramps, and one-to-three-pixel texture marks. Quiet gameplay
  bands are low contrast rather than low detail. Explicitly reject macro-pixels, giant floor units,
  coarse mosaics, and simulated low-resolution enlargement.
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

Status: implemented. New Adventure games now generate one atomic six-pose hero set—down idle/walk,
up idle/walk, and right-facing side idle/walk, mirrored for left at runtime. After selecting the
strongest of three identity foundations, the pipeline makes two competing 3×2 pose sheets in
parallel and uses a multimodal Spark review to choose the strongest coherent combination. The
high-density art is drawn larger than the legacy hero while retaining the proven compact collider,
sword hitbox, item logic, doorway clearance, and ground-contact depth behavior.

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
- Seed every sheet cell with the selected gameplay foundation, then request the fixed order
  down-idle, down-walk, up-idle, up-walk, side-idle, and side-walk. Reuse the Fighter pipeline's
  component-aware 3×2 segmentation so art that slightly crosses a nominal cell edge is assigned to
  the right pose instead of being clipped.
- Review the ten downstream pose cells as one identity-consistent set. Spark chooses the best cell
  per pose while checking rear views, idle/walk separation, empty hands, wardrobe, accessories,
  scale, ground contact, and pixel technique. If both sheets miss a pose, or the review identifies
  a weak pose, generate only that isolated pose and review the repaired set again.
- Feed a composite reference containing key art plus the exact selected gameplay hero into all four
  story-scene generations. Story cards therefore inherit the same person and game-aligned outfit
  that gameplay uses, while the photo-conditioned card portraits continue to preserve head identity
  and show the same canonical collar and shoulders.
- Publish all six stable filenames together and activate them only after the entire set loads. The
  normal player path now uses five image calls—three identity candidates plus two pose sheets—instead
  of eight. Including all other current Adventure art, the expected total is 11 images without a
  player photo and 13 with one, down from 14 and 16 respectively.
- Guarantee gameplay visibility independently from Muse output. Cache each generated pose at its
  exact physical display size with a one-physical-pixel near-black alpha-mask contour, then place a
  wider 34%-opacity hard-edged contact shadow under the player. Author and review the source poses
  over mixed light, dark, saturated, and noisy floor samples so the renderer reinforces an already
  readable silhouette rather than rescuing an unusable one.
- Keep the legacy directional-head hero as an atomic emergency fallback while sheet reliability is
  measured. The intended end state is to remove that branch once malformed-sheet recovery and
  semantic review have proven reliable enough that generation failures are handled without it.

## Generated finale boss

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

- Generate a coherent five-role cast: `walker`, `flyer`, `shooter`, `chaser`, and `bruiser`.
- Use top-down three-quarter silhouettes that communicate behavior without requiring four expensive
  directional turnarounds. Favor direction-neutral creatures and machinery where appropriate.
- Select candidates as one cast so materials, scale, rendering density, and friend-versus-foe
  contrast remain coherent. Publish roles independently so one failure does not discard the rest.
- Keep behavior hitboxes independent from visual bounds and retain library bodies as per-role
  fallbacks.

## Themed items, NPCs, and room fixtures

- Generate the signature key, selected secondary item, NPC, and highest-value projectile or effect
  roles after the larger cast is proven. A premise-specific key or relic contributes more identity
  than replacing a universal heart icon.
- Expand each checked-in terrain family with multiple deterministic floor details, wall fixtures,
  low decorations, and tall decorations. Decoration selection must remain cosmetic and must not
  obscure doors, switches, pickups, hazards, or combat telegraphs.
- Use generated key art as style direction for per-game props while retaining strict isolated-asset
  processing and independent fallbacks.

## Rooms, progression, and environment variety

Status: framing expansion implemented. Adventure rooms now use a shared 28×14-cell contract across
the schema, generation prompt, normalizer, golden fixture, door geometry, collision grids, and
runtime. The 448×224 playfield occupies 87.5% of the cabinet's logical width while retaining full
one-screen visibility, centered two-cell doors, and enough surround for atmosphere and HUD
separation.

- Build on the four generated surface treatments with bounded fixture, lighting, and ambience
  variants for the start, puzzle wing, deep dungeon, and boss approach.
- Give authored room roles—entrance, combat, puzzle, NPC, treasure, transition, boss approach—small
  presentation vocabularies that affect fixtures, lighting accents, and ambient effects without
  altering solvability.
- Author new layouts across the full 28×14 footprint rather than clustering content into the legacy
  center. Keep broad navigable lanes, every door visible, and reaction space for projectiles and
  charge attacks.
- Keep the old panoramic backdrop only as the room surround. The generated top-down room surface is
  the primary environment layer inside the playable frame.

## Combat, puzzles, and encounter quality

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
4. Expand rooms to 28×14 and retain room plates at physical display density. Done.
5. Generated finale boss from boss story art.
6. Generated five-role enemy cast.
7. Themed key, item, NPC, and selected projectile art.
8. Room zones, stronger puzzle proofs, encounter-space validation, and broader gameplay vocabulary.
