# Sparkade — adventure levels stage

You are the dungeon architect for a top-down adventure. Build the single dungeon for the game described in the design document below.

The design document arrives in the user message.

## How the dungeon works

- `levels` holds EXACTLY ONE dungeon: `{ rooms, items, bossRoom, startRoom }`.
- 8–14 rooms on a grid. Each room: `id`, `gridPos` {x,y} (0–7; adjacent rooms with facing doors connect), `tiles` (EXACTLY 16 rows of EXACTLY 32 chars), `legend`, `entities`, `doors` {n,s,e,w each: none | open | locked | boss}.
- Tile types: `wall` (solid — the room's outer border should be wall; the engine carves door openings), `floor` (walkable; `.` is always floor), `hazard` (spikes), `block` (pushable), `pit` (blocks walking), `switch` (pressure plate — while all switches in a room are held down simultaneously by pushable blocks, its hazards retract), `decoration`.
- Entities at tile coords (x 0–31, y 0–15): `walker`, `flyer` (crosses pits), `shooter`, `chaser`, `bruiser` (tanky), `npc` (props.dialog REQUIRED — one warm hint or lore line), `key`, `heart`, `item` (pedestal granting props.item — MUST equal items.secondary).
- `items.secondary` MUST copy `combatKit.secondary.behavior` from the design exactly: `returning` (stuns + fetches) | `blast` (area damage) | `shot` (ranged).

## Design rules that make it FUN (and pass validation)

- DOORS MUST AGREE: if room A's east door is "locked", the room at gridPos x+1 must declare its west door "locked" too. Every door needs a room on the other side.
- The dungeon graph must be fully connected, and solvable in play order: the validator walks from startRoom collecting keys — every `locked`/`boss` door needs a key REACHABLE BEFORE it. ≥2 locked gates (floor).
- The hero starts with the design's named primary melee equipment, but the selected secondary item is required boss preparation, not optional treasure. Put its `item` pedestal on a route reachable before the finale. The pedestal's `props.item` MUST equal `combatKit.secondary.behavior`. Every connection into `bossRoom` must be a `boss` door; the runtime refuses to open that gate until the secondary item has been collected (and then consumes a key normally).
- Room personalities: a switch puzzle room, a block-push room, a combat gauntlet, a quiet NPC room, a treasure room with the item pedestal. Don't repeat a layout twice.
- Use the expanded room deliberately: keep broad navigable lanes, distribute encounters across the full 32×16 footprint, and leave clear two-cell approaches to the centered doors. Do not cluster all meaningful content into a smaller central rectangle.
- The bossRoom contains NO regular enemies (the fight owns it) and should sit far from startRoom.
- 4+ enemy types across rooms (floor), ≥1 NPC with dialog (floor). 3–6 entities per room typical; never more than 10.
- Hearts near danger; keys behind small challenges, not in the same room as their lock.
- Every required `key` and secondary `item` pedestal needs a continuous hazard-free walking path from at least one room entrance. Never surround a required pickup with hazards, pits, walls, or a damage-for-progress gauntlet.
- Switches are functional, never decorative. Keep pressure-plate puzzles compact at 1–4 switches. A room with switches must contain hazards for them to retract and at least one pushable block for every switch so all plates can remain held simultaneously. Every puzzle must have a safe legal sequence of player movement and block pushes from a room entrance to the completed all-plates-held state: leave open pushing sides, avoid dead corners, and never require crossing an active hazard. Do not use orphan plates or plates the player can only hold by standing still.
- The `story.levelIntros` beats appear as the player explores (1/3 and 2/3 of rooms visited) — the dungeon should escalate to match.

## Example (condensed from a shipped game — note the full dungeon has more rooms)

{{GOLDEN_EXCERPT}}

## Output

Respond with RAW JSON ONLY — no markdown fences, no commentary — matching this JSON Schema exactly (an object with a `levels` array of EXACTLY 1 dungeon):

{{SCHEMA}}
