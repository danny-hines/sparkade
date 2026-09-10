// Adventure semantic lints: dungeon graph connectivity, key/lock topology
// (every locked door has a reachable key earlier in the graph), boss room
// reachability, content floors.
import type {
  AdventureDoor,
  AdventureDungeon,
  AdventureRoom,
  AdventureSpec,
  LintError,
} from '@sparkade/shared';
import { adventurePuzzleGeometry } from '@sparkade/shared';
import {
  err,
  lintDuration,
  lintLegendCoverage,
  lintMusic,
  lintRowLengths,
  lintSpriteRefs,
} from '../common';
import {
  ADVENTURE_ENCOUNTER_MIN_SPREAD_CELLS,
  adventureDoorReactionCells,
  adventureEnemyEncounterSpread,
  adventureInteractionCells,
  adventureInteractionSpaceClear,
  adventureRoomTileKind,
  adventureShooterHasClearLane,
  analyzeAdventureBossArena,
} from './encounters';

const ENEMY_TYPES = ['walker', 'flyer', 'shooter', 'chaser', 'bruiser'] as const;
const DIRS = [
  ['n', 0, -1, 's'],
  ['s', 0, 1, 'n'],
  ['e', 1, 0, 'w'],
  ['w', -1, 0, 'e'],
] as const;

interface Edge {
  from: string;
  to: string;
  locked: boolean;
  kind: AdventureDoor;
}

/** Build the door graph; also emits consistency errors. */
export function buildGraph(dungeon: AdventureDungeon): { edges: Edge[]; errors: LintError[] } {
  const errors: LintError[] = [];
  const byPos = new Map<string, AdventureRoom>();
  const byId = new Map<string, AdventureRoom>();
  dungeon.rooms.forEach((room, i) => {
    const pk = `${room.gridPos.x},${room.gridPos.y}`;
    if (byPos.has(pk)) {
      errors.push(
        err(
          'ADV_GRID_OVERLAP',
          `/levels/0/rooms/${i}/gridPos`,
          `rooms "${byPos.get(pk)!.id}" and "${room.id}" share grid position (${pk})`,
        ),
      );
    }
    if (byId.has(room.id)) {
      errors.push(
        err('ADV_DUP_ROOM_ID', `/levels/0/rooms/${i}/id`, `duplicate room id "${room.id}"`),
      );
    }
    byPos.set(pk, room);
    byId.set(room.id, room);
  });

  const edges: Edge[] = [];
  const seen = new Set<string>();
  dungeon.rooms.forEach((room, i) => {
    for (const [dir, dx, dy, opposite] of DIRS) {
      const kind = room.doors[dir];
      if (kind === 'none') continue;
      const neighbor = byPos.get(`${room.gridPos.x + dx},${room.gridPos.y + dy}`);
      if (!neighbor) {
        errors.push(
          err(
            'ADV_DOOR_TO_NOWHERE',
            `/levels/0/rooms/${i}/doors/${dir}`,
            `room "${room.id}" has a ${kind} door ${dir} but no room sits at that grid position`,
          ),
        );
        continue;
      }
      const back = neighbor.doors[opposite];
      if (back === 'none') {
        errors.push(
          err(
            'ADV_DOOR_MISMATCH',
            `/levels/0/rooms/${i}/doors/${dir}`,
            `door ${dir} of "${room.id}" leads to "${neighbor.id}" whose ${opposite} door is "none" — both sides must declare the door`,
          ),
        );
        continue;
      }
      if (back !== kind) {
        errors.push(
          err(
            'ADV_DOOR_MISMATCH',
            `/levels/0/rooms/${i}/doors/${dir}`,
            `door ${dir} of "${room.id}" is "${kind}" but "${neighbor.id}" declares "${back}" — both sides must match`,
          ),
        );
        continue;
      }
      const ek = [room.id, neighbor.id].sort().join('|') + '|' + dir + opposite;
      const canonical = [room.id, neighbor.id].sort().join('|');
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      edges.push({
        from: room.id,
        to: neighbor.id,
        locked: kind === 'locked' || kind === 'boss',
        kind,
      });
      void ek;
    }
  });
  return { edges, errors };
}

const DOOR_RANK: Record<AdventureDoor, number> = { none: 0, open: 1, locked: 2, boss: 3 };
const DOOR_BY_RANK: AdventureDoor[] = ['none', 'open', 'locked', 'boss'];

/**
 * Reconcile the two redundant declarations of every shared door so the dungeon
 * graph is self-consistent. Each door is declared on both rooms that share the
 * grid edge, and the model routinely declares it on one room but forgets the
 * mirror on the neighbor (→ ADV_DOOR_MISMATCH) — a mechanical bookkeeping slip
 * the repair loop struggles to close. Run as a normalization step before
 * linting so generation isn't derailed by it. Mutates in place.
 *
 * Rules: a door with no room on the far side is dropped to 'none'; otherwise
 * both sides take the more intentional kind (boss > locked > open > none). That
 * mirrors one-sided doors (adding no connection the model didn't declare) and
 * resolves genuine kind conflicts to the stronger gate, preserving puzzle
 * intent. Any key/reachability gap that remains is left to the topology lints.
 */
export function reconcileDoors(dungeon: AdventureDungeon): void {
  const byPos = new Map<string, AdventureRoom>();
  for (const room of dungeon.rooms) byPos.set(`${room.gridPos.x},${room.gridPos.y}`, room);
  for (const room of dungeon.rooms) {
    for (const [dir, dx, dy, opposite] of DIRS) {
      const neighbor = byPos.get(`${room.gridPos.x + dx},${room.gridPos.y + dy}`);
      if (!neighbor) {
        room.doors[dir] = 'none'; // door to nowhere — can't add the missing room
        continue;
      }
      const win =
        DOOR_BY_RANK[Math.max(DOOR_RANK[room.doors[dir]], DOOR_RANK[neighbor.doors[opposite]])]!;
      room.doors[dir] = win;
      neighbor.doors[opposite] = win;
    }
  }
}

function roomTileKind(room: AdventureRoom, x: number, y: number): string {
  const ch = room.tiles[y]?.[x];
  return ch === undefined || ch === '.' ? 'floor' : (room.legend[ch] ?? 'floor');
}

function roomTileCount(room: AdventureRoom, expected: string): number {
  let total = 0;
  for (let y = 0; y < room.tiles.length; y++) {
    for (let x = 0; x < (room.tiles[y]?.length ?? 0); x++) {
      if (roomTileKind(room, x, y) === expected) total++;
    }
  }
  return total;
}

function roomCellsOfKind(room: AdventureRoom, expected: string): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < room.tiles.length; y++) {
    for (let x = 0; x < (room.tiles[y]?.length ?? 0); x++) {
      if (roomTileKind(room, x, y) === expected) cells.push({ x, y });
    }
  }
  return cells;
}

function roomDoorLandings(
  room: AdventureRoom,
  includeSecondCell = false,
): Array<{
  x: number;
  y: number;
}> {
  const height = room.tiles.length;
  const width = room.tiles[0]?.length ?? 0;
  const middleX = Math.floor(width / 2);
  const middleY = Math.floor(height / 2);
  const depths = includeSecondCell ? [1, 2] : [1];
  const cells: Array<{ x: number; y: number }> = [];
  for (const depth of depths) {
    if (room.doors.n !== 'none') cells.push({ x: middleX - 1, y: depth }, { x: middleX, y: depth });
    if (room.doors.s !== 'none')
      cells.push({ x: middleX - 1, y: height - 1 - depth }, { x: middleX, y: height - 1 - depth });
    if (room.doors.w !== 'none') cells.push({ x: depth, y: middleY - 1 }, { x: depth, y: middleY });
    if (room.doors.e !== 'none')
      cells.push({ x: width - 1 - depth, y: middleY - 1 }, { x: width - 1 - depth, y: middleY });
  }
  return cells;
}

/** Required progression pickups must be reachable from a real room entrance
 * without spending health or first solving a pressure-plate hazard puzzle.
 * Blocks are treated as potentially movable; hazards, pits, and walls are not
 * safe traversal. Runtime carves the first two cells inside each door, so those
 * landing cells are valid flood-fill seeds even when authored as border wall. */
export function safelyReachableRoomCells(room: AdventureRoom): Set<string> {
  const height = room.tiles.length;
  const width = room.tiles[0]?.length ?? 0;
  const reachable = new Set<string>();
  if (width < 3 || height < 3 || room.tiles.some((row) => row.length !== width)) return reachable;

  const middleX = Math.floor(width / 2);
  const middleY = Math.floor(height / 2);
  const seeds = roomDoorLandings(room);
  const forcedFloor = new Set(roomDoorLandings(room, true).map((cell) => `${cell.x},${cell.y}`));

  if (seeds.length === 0) {
    let best: { x: number; y: number; distance: number } | null = null;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const kind = roomTileKind(room, x, y);
        if (kind === 'wall' || kind === 'pit' || kind === 'hazard') continue;
        const distance = Math.abs(x - middleX) + Math.abs(y - middleY);
        if (!best || distance < best.distance) best = { x, y, distance };
      }
    }
    if (best) seeds.push(best);
  }

  const queue: Array<{ x: number; y: number }> = [];
  for (const seed of seeds) {
    const key = `${seed.x},${seed.y}`;
    if (reachable.has(key)) continue;
    reachable.add(key);
    queue.push(seed);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const key = `${x},${y}`;
      if (reachable.has(key)) continue;
      const kind = roomTileKind(room, x, y);
      if (!forcedFloor.has(key) && (kind === 'wall' || kind === 'pit' || kind === 'hazard'))
        continue;
      reachable.add(key);
      queue.push({ x, y });
    }
  }
  return reachable;
}

/** Bounded Sokoban proof for pressure-plate rooms. A state is the complete
 * block arrangement plus the player's walkable component. Hazards remain
 * active until the goal, so neither the player nor a block may cross them.
 * This catches dead corners, blocked pushing sides, and ordering failures that
 * a simple block/plate count cannot detect. */
export function pressurePlatePuzzleSolvable(room: AdventureRoom): boolean {
  const height = room.tiles.length;
  const width = room.tiles[0]?.length ?? 0;
  const switches = roomCellsOfKind(room, 'switch');
  const blocks = roomCellsOfKind(room, 'block');
  if (switches.length === 0) return true;
  if (
    width < 3 ||
    height < 3 ||
    room.tiles.some((row) => row.length !== width) ||
    blocks.length < switches.length ||
    blocks.length > 6
  ) {
    return false;
  }

  const index = (x: number, y: number): number => y * width + x;
  const forcedFloor = new Set(roomDoorLandings(room, true).map(({ x, y }) => index(x, y)));
  const walkable = (cell: number): boolean => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (forcedFloor.has(cell)) return true;
    const kind = roomTileKind(room, x, y);
    return kind !== 'wall' && kind !== 'pit' && kind !== 'hazard';
  };
  const switchIndices = switches.map(({ x, y }) => index(x, y));
  const initialBlocks = blocks.map(({ x, y }) => index(x, y)).sort((a, b) => a - b);
  const starts = roomDoorLandings(room)
    .map(({ x, y }) => index(x, y))
    .filter((cell) => walkable(cell) && !initialBlocks.includes(cell));
  if (starts.length === 0) return false;

  const neighbors = (cell: number): Array<{ cell: number; dx: number; dy: number }> => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    return (
      [
        { x: x + 1, y, dx: 1, dy: 0 },
        { x: x - 1, y, dx: -1, dy: 0 },
        { x, y: y + 1, dx: 0, dy: 1 },
        { x, y: y - 1, dx: 0, dy: -1 },
      ] as const
    )
      .filter((next) => next.x >= 0 && next.y >= 0 && next.x < width && next.y < height)
      .map((next) => ({ cell: index(next.x, next.y), dx: next.dx, dy: next.dy }));
  };
  const playerRegion = (start: number, blockSet: ReadonlySet<number>): Set<number> => {
    const reached = new Set<number>();
    if (!walkable(start) || blockSet.has(start)) return reached;
    const queue = [start];
    reached.add(start);
    for (let head = 0; head < queue.length; head++) {
      for (const next of neighbors(queue[head]!)) {
        if (reached.has(next.cell) || blockSet.has(next.cell) || !walkable(next.cell)) continue;
        reached.add(next.cell);
        queue.push(next.cell);
      }
    }
    return reached;
  };
  interface PuzzleState {
    player: number;
    blocks: number[];
    region: Set<number>;
    pushes: number;
    score: number;
  }
  const assignmentCache = new Map<string, number>();
  const assignmentDistance = (blockCells: readonly number[]): number => {
    const cacheKey = blockCells.join(',');
    const cached = assignmentCache.get(cacheKey);
    if (cached !== undefined) return cached;
    let best = Infinity;
    const used = new Set<number>();
    const assign = (switchIndex: number, cost: number): void => {
      if (cost >= best) return;
      if (switchIndex >= switchIndices.length) {
        best = cost;
        return;
      }
      const target = switchIndices[switchIndex]!;
      const tx = target % width;
      const ty = Math.floor(target / width);
      for (const block of blockCells) {
        if (used.has(block)) continue;
        used.add(block);
        assign(
          switchIndex + 1,
          cost + Math.abs((block % width) - tx) + Math.abs(Math.floor(block / width) - ty),
        );
        used.delete(block);
      }
    };
    assign(0, 0);
    assignmentCache.set(cacheKey, best);
    return best;
  };
  const frontier: PuzzleState[] = [];
  const pushFrontier = (state: PuzzleState): void => {
    frontier.push(state);
    let child = frontier.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (frontier[parent]!.score <= frontier[child]!.score) break;
      [frontier[parent], frontier[child]] = [frontier[child]!, frontier[parent]!];
      child = parent;
    }
  };
  const popFrontier = (): PuzzleState | undefined => {
    const first = frontier[0];
    const last = frontier.pop();
    if (!first || !last || frontier.length === 0) return first;
    frontier[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < frontier.length && frontier[left]!.score < frontier[best]!.score) best = left;
      if (right < frontier.length && frontier[right]!.score < frontier[best]!.score) best = right;
      if (best === parent) break;
      [frontier[parent], frontier[best]] = [frontier[best]!, frontier[parent]!];
      parent = best;
    }
    return first;
  };
  const seen = new Set<string>();
  for (const player of starts) {
    const region = playerRegion(player, new Set(initialBlocks));
    if (region.size === 0) continue;
    const key = `${initialBlocks.join(',')}|${Math.min(...region)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pushFrontier({
      player,
      blocks: initialBlocks,
      region,
      pushes: 0,
      score: assignmentDistance(initialBlocks),
    });
  }
  const maxStates = 12_000;
  while (frontier.length > 0 && seen.size < maxStates) {
    const state = popFrontier()!;
    const blockSet = new Set(state.blocks);
    if (switchIndices.every((cell) => blockSet.has(cell))) return true;

    for (const block of state.blocks) {
      const bx = block % width;
      const by = Math.floor(block / width);
      for (const { dx, dy } of neighbors(block)) {
        const destination = index(bx + dx, by + dy);
        const pushingSide = index(bx - dx, by - dy);
        if (!state.region.has(pushingSide) || !walkable(destination) || blockSet.has(destination)) {
          continue;
        }
        const nextBlocks = state.blocks
          .map((cell) => (cell === block ? destination : cell))
          .sort((a, b) => a - b);
        const nextBlockSet = new Set(nextBlocks);
        if (switchIndices.every((cell) => nextBlockSet.has(cell))) return true;
        const nextRegion = playerRegion(block, nextBlockSet);
        if (nextRegion.size === 0) continue;
        const key = `${nextBlocks.join(',')}|${Math.min(...nextRegion)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pushes = state.pushes + 1;
        pushFrontier({
          player: block,
          blocks: nextBlocks,
          region: nextRegion,
          pushes,
          score: pushes + assignmentDistance(nextBlocks),
        });
      }
    }
  }
  return false;
}

/**
 * Key/lock topology: greedy relaxation. Starting at startRoom with 0 keys,
 * repeatedly expand through open doors, collect keys in reached rooms, and
 * spend keys on locked doors. Everything must become reachable.
 */
export function checkKeyTopology(dungeon: AdventureDungeon, edges: Edge[]): LintError[] {
  const out: LintError[] = [];
  const keysInRoom = new Map<string, number>();
  for (const room of dungeon.rooms) {
    keysInRoom.set(room.id, room.entities.filter((e) => e.type === 'key').length);
  }
  const reached = new Set<string>([dungeon.startRoom]);
  let keys = keysInRoom.get(dungeon.startRoom) ?? 0;
  const unlocked = new Set<Edge>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const edge of edges) {
      const canFrom = reached.has(edge.from) ? edge.to : reached.has(edge.to) ? edge.from : null;
      if (!canFrom || reached.has(canFrom)) continue;
      if (edge.locked && !unlocked.has(edge)) {
        if (keys > 0) {
          keys--;
          unlocked.add(edge);
        } else {
          continue;
        }
      }
      reached.add(canFrom);
      keys += keysInRoom.get(canFrom) ?? 0;
      progress = true;
    }
  }
  const unreachable = dungeon.rooms.filter((r) => !reached.has(r.id));
  for (const room of unreachable) {
    out.push(
      err(
        'ADV_UNREACHABLE_ROOM',
        `/levels/0/rooms`,
        `room "${room.id}" cannot be reached from "${dungeon.startRoom}" — check door connections and that keys appear before the locks that need them`,
      ),
    );
  }
  if (!reached.has(dungeon.bossRoom)) {
    out.push(
      err(
        'ADV_BOSS_UNREACHABLE',
        `/levels/0/bossRoom`,
        `the boss room "${dungeon.bossRoom}" is not reachable with the available keys`,
      ),
    );
  }
  return out;
}

/** The secondary item is part of the boss-readiness contract, not optional
 * treasure. Prove it can be collected using only the pre-boss graph. */
export function checkBossProgression(dungeon: AdventureDungeon, edges: Edge[]): LintError[] {
  const out: LintError[] = [];
  const bossEdges = edges.filter(
    (edge) => edge.from === dungeon.bossRoom || edge.to === dungeon.bossRoom,
  );
  if (bossEdges.some((edge) => edge.kind !== 'boss')) {
    out.push(
      err(
        'ADV_BOSS_GATE_REQUIRED',
        '/levels/0/rooms',
        `every entrance to boss room "${dungeon.bossRoom}" must use a "boss" door`,
      ),
    );
  }

  const keysInRoom = new Map<string, number>();
  const itemRooms = new Set<string>();
  for (const room of dungeon.rooms) {
    keysInRoom.set(room.id, room.entities.filter((entity) => entity.type === 'key').length);
    if (
      room.entities.some(
        (entity) => entity.type === 'item' && entity.props?.item === dungeon.items.secondary,
      )
    ) {
      itemRooms.add(room.id);
    }
  }

  const reached = new Set<string>([dungeon.startRoom]);
  let keys = keysInRoom.get(dungeon.startRoom) ?? 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (const edge of edges) {
      if (edge.from === dungeon.bossRoom || edge.to === dungeon.bossRoom) continue;
      const next = reached.has(edge.from) ? edge.to : reached.has(edge.to) ? edge.from : null;
      if (!next || reached.has(next)) continue;
      if (edge.locked) {
        if (keys <= 0) continue;
        keys--;
      }
      reached.add(next);
      keys += keysInRoom.get(next) ?? 0;
      progress = true;
    }
  }

  if (![...itemRooms].some((roomId) => reached.has(roomId))) {
    out.push(
      err(
        'ADV_ITEM_AFTER_BOSS',
        '/levels/0/rooms',
        `the ${dungeon.items.secondary} must be reachable and collectable before the boss gate`,
      ),
    );
  }
  return out;
}

export function lintAdventure(spec: AdventureSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));
  const dungeon = spec.levels[0];
  if (!dungeon) return [err('ADV_NO_DUNGEON', '/levels', 'levels[0] (the dungeon) is missing')];

  const ids = new Set(dungeon.rooms.map((r) => r.id));
  if (!ids.has(dungeon.startRoom)) {
    out.push(
      err(
        'ADV_BAD_START',
        '/levels/0/startRoom',
        `startRoom "${dungeon.startRoom}" does not exist`,
      ),
    );
  }
  if (!ids.has(dungeon.bossRoom)) {
    out.push(
      err(
        'ADV_BAD_BOSS_ROOM',
        '/levels/0/bossRoom',
        `bossRoom "${dungeon.bossRoom}" does not exist`,
      ),
    );
  }
  if (dungeon.startRoom === dungeon.bossRoom) {
    out.push(
      err('ADV_START_IS_BOSS', '/levels/0/startRoom', 'startRoom must differ from bossRoom'),
    );
  }

  const { edges, errors } = buildGraph(dungeon);
  out.push(...errors);
  if (errors.length === 0 && ids.has(dungeon.startRoom)) {
    out.push(...checkKeyTopology(dungeon, edges), ...checkBossProgression(dungeon, edges));
  }

  const enemyTypes = new Set<string>();
  let npcWithDialog = 0;
  let keyCount = 0;
  let pedestalOk = false;

  if (dungeon.items.secondary !== spec.combatKit.secondary.behavior) {
    out.push(
      err(
        'ADV_COMBAT_KIT_MISMATCH',
        '/levels/0/items/secondary',
        `dungeon secondary behavior "${dungeon.items.secondary}" must match combatKit.secondary.behavior "${spec.combatKit.secondary.behavior}"`,
      ),
    );
  }

  dungeon.rooms.forEach((room, ri) => {
    const path = `/levels/0/rooms/${ri}`;
    out.push(...lintRowLengths(room.tiles, path, 'ADV_ROWS_UNEQUAL'));
    out.push(...lintLegendCoverage(room.tiles, room.legend, path, 'ADV_LEGEND_UNKNOWN_CHAR'));
    const safelyReachable = safelyReachableRoomCells(room);
    const doorReactionCells = new Set(
      adventureDoorReactionCells(room).map((cell) => `${cell.x},${cell.y}`),
    );
    const blockedReactionCells = [...doorReactionCells].filter((cell) => {
      const [x, y] = cell.split(',').map(Number);
      return adventureRoomTileKind(room, x!, y!) !== 'floor';
    });
    if (blockedReactionCells.length > 0) {
      out.push(
        err(
          'ADV_DOOR_REACTION_BLOCKED',
          `${path}/tiles`,
          `${blockedReactionCells.length} doorway reaction cell(s) contain walls, pits, hazards, blocks, switches, or decorations; keep a calm three-cell-deep approach inside every door`,
        ),
      );
    }
    const protectedInteractionCells = new Set<string>();
    for (const [ei, e] of room.entities.entries()) {
      if ((ENEMY_TYPES as readonly string[]).includes(e.type)) enemyTypes.add(e.type);
      if (e.type === 'npc' && e.props?.dialog) npcWithDialog++;
      if (e.type === 'npc' && !e.props?.dialog) {
        out.push(
          err(
            'ADV_NPC_NO_DIALOG',
            `${path}/entities`,
            `npc at (${e.x},${e.y}) has no props.dialog line`,
          ),
        );
      }
      if (e.type === 'key') keyCount++;
      if (e.type === 'item') {
        if (e.props?.item === dungeon.items.secondary) pedestalOk = true;
        else {
          out.push(
            err(
              'ADV_ITEM_MISMATCH',
              `${path}/entities`,
              `item pedestal grants "${e.props?.item ?? 'nothing'}" but items.secondary is "${dungeon.items.secondary}"`,
            ),
          );
        }
      }
      // Entities must stand on walkable tiles.
      const ch = room.tiles[e.y]?.[e.x];
      const kind = ch === '.' || ch === undefined ? 'floor' : (room.legend[ch] ?? 'floor');
      if (kind === 'wall' || kind === 'pit') {
        out.push(
          err(
            'ADV_ENTITY_IN_WALL',
            `${path}/entities`,
            `${e.type} at (${e.x},${e.y}) is inside a ${kind} tile`,
          ),
        );
      }
      if ((e.type === 'key' || e.type === 'item') && !safelyReachable.has(`${e.x},${e.y}`)) {
        out.push(
          err(
            'ADV_REQUIRED_PICKUP_UNSAFE',
            `${path}/entities`,
            `${e.type} at (${e.x},${e.y}) must have a hazard-free walkable path from a room entrance; required progression cannot be enclosed by hazards, pits, or walls`,
          ),
        );
      }
      if (e.type === 'key' || e.type === 'item' || e.type === 'npc') {
        for (const cell of adventureInteractionCells(e.x, e.y)) {
          protectedInteractionCells.add(`${cell.x},${cell.y}`);
        }
        if (!adventureInteractionSpaceClear(room, e.x, e.y)) {
          out.push(
            err(
              'ADV_INTERACTION_SPACE',
              `${path}/entities/${ei}`,
              `${e.type} at (${e.x},${e.y}) needs a calm floor cell with at least three clear approach sides`,
            ),
          );
        }
        if (e.type === 'npc' && !safelyReachable.has(`${e.x},${e.y}`)) {
          out.push(
            err(
              'ADV_NPC_UNREACHABLE',
              `${path}/entities/${ei}`,
              `npc at (${e.x},${e.y}) needs a hazard-free walking path from a room entrance`,
            ),
          );
        }
      }
      if (
        (ENEMY_TYPES as readonly string[]).includes(e.type) &&
        doorReactionCells.has(`${e.x},${e.y}`)
      ) {
        out.push(
          err(
            'ADV_DOOR_SPAWN_CAMP',
            `${path}/entities/${ei}`,
            `${e.type} at (${e.x},${e.y}) occupies a doorway reaction zone; move it at least three cells into the room`,
          ),
        );
      }
      if (e.type === 'shooter' && !adventureShooterHasClearLane(room, e, safelyReachable)) {
        out.push(
          err(
            'ADV_SHOOTER_NO_LANE',
            `${path}/entities/${ei}`,
            `shooter at (${e.x},${e.y}) needs an unobstructed six-cell firing line to safely reachable player space with a lateral dodge cell`,
          ),
        );
      }
    }
    for (const [ei, e] of room.entities.entries()) {
      if (
        (ENEMY_TYPES as readonly string[]).includes(e.type) &&
        protectedInteractionCells.has(`${e.x},${e.y}`)
      ) {
        out.push(
          err(
            'ADV_INTERACTION_THREAT',
            `${path}/entities/${ei}`,
            `${e.type} at (${e.x},${e.y}) begins inside a key, item, or NPC interaction space`,
          ),
        );
      }
    }
    const roomEnemies = room.entities.filter((entity) =>
      (ENEMY_TYPES as readonly string[]).includes(entity.type),
    );
    if (
      roomEnemies.length >= 3 &&
      adventureEnemyEncounterSpread(room.entities) < ADVENTURE_ENCOUNTER_MIN_SPREAD_CELLS
    ) {
      out.push(
        err(
          'ADV_ENCOUNTER_CLUSTERED',
          `${path}/entities`,
          `all ${roomEnemies.length} enemies fit inside a compact cluster; distribute the encounter across at least ${ADVENTURE_ENCOUNTER_MIN_SPREAD_CELLS} cells of Manhattan span`,
        ),
      );
    }
    const switchCount = roomTileCount(room, 'switch');
    const hazardCount = roomTileCount(room, 'hazard');
    const blockCount = roomTileCount(room, 'block');
    if (switchCount > 0 && hazardCount === 0) {
      out.push(
        err(
          'ADV_SWITCH_NO_HAZARDS',
          `${path}/tiles`,
          `${switchCount} pressure plate(s) have no room hazards to retract; remove the decorative-looking switches or give them a real hazard puzzle`,
        ),
      );
    }
    if (switchCount > blockCount) {
      out.push(
        err(
          'ADV_SWITCH_BLOCK_SHORT',
          `${path}/tiles`,
          `${switchCount} pressure plate(s) but only ${blockCount} pushable block(s); every plate must be held simultaneously, so provide at least one block per plate`,
        ),
      );
    }
    if (
      switchCount > 0 &&
      hazardCount > 0 &&
      switchCount <= blockCount &&
      !pressurePlatePuzzleSolvable(room)
    ) {
      out.push(
        err(
          'ADV_SWITCH_UNSOLVABLE',
          `${path}/tiles`,
          'pressure-plate puzzle has no safe legal sequence of player movement and block pushes that holds every switch simultaneously; remove dead corners and open the pushing sides of every block route',
        ),
      );
    }
    if (
      room.id === dungeon.bossRoom &&
      room.entities.some((e) => (ENEMY_TYPES as readonly string[]).includes(e.type))
    ) {
      out.push(
        err(
          'ADV_BOSS_ROOM_CROWDED',
          `${path}/entities`,
          'the boss room must not contain other enemies — the boss fight owns it',
        ),
      );
    }
    if (room.id === dungeon.bossRoom && spec.adventureStyle !== 'puzzleQuest') {
      const patterns = spec.boss.phases.map((phase) => phase.pattern);
      const arena = analyzeAdventureBossArena(room, patterns);
      if (!arena.dodgeRouteClear) {
        out.push(
          err(
            'ADV_BOSS_DODGE_ROUTE',
            `${path}/tiles`,
            'boss room needs a connected two-cell-wide central cross and outer dodge loop with no walls, pits, hazards, blocks, switches, or decorations',
          ),
        );
      }
      if (!arena.chargeLanesClear) {
        out.push(
          err(
            'ADV_BOSS_CHARGE_LANE',
            `${path}/tiles`,
            'charge phase needs clear two-cell-wide horizontal and vertical lanes through the arena',
          ),
        );
      }
      if (arena.openTeleportPads < arena.requiredTeleportPads) {
        out.push(
          err(
            'ADV_BOSS_TELEPORT_SPACE',
            `${path}/tiles`,
            `teleport phase has ${arena.openTeleportPads}/${arena.requiredTeleportPads} clear, separated 2x2 landing pads`,
          ),
        );
      }
      if (arena.openSummonPads < arena.requiredSummonPads) {
        out.push(
          err(
            'ADV_BOSS_SUMMON_SPACE',
            `${path}/tiles`,
            `summon phase has ${arena.openSummonPads}/${arena.requiredSummonPads} clear minion arrival pads`,
          ),
        );
      }
    }
  });

  const lockedDoorCount = edges.filter((e) => e.locked).length;
  if (lockedDoorCount < 2) {
    out.push(
      err(
        'ADV_FLOOR_LOCKS',
        '/levels/0/rooms',
        `${lockedDoorCount} locked gate(s); the floor is 2 (use "locked" or "boss" doors)`,
      ),
    );
  }
  if (keyCount < lockedDoorCount) {
    out.push(
      err(
        'ADV_KEYS_SHORT',
        '/levels/0/rooms',
        `${keyCount} key(s) for ${lockedDoorCount} locked door(s) — every locked door needs a key`,
      ),
    );
  }
  const enemyFloor = spec.adventureStyle === 'puzzleQuest' ? 2 : 4;
  if (enemyTypes.size < enemyFloor) {
    out.push(
      err(
        'ADV_FLOOR_ENEMY_TYPES',
        '/levels/0/rooms',
        `uses ${enemyTypes.size} enemy types; the floor is ${enemyFloor}`,
      ),
    );
  }
  if (npcWithDialog < 1) {
    out.push(
      err('ADV_FLOOR_NPC', '/levels/0/rooms', 'at least one NPC with a dialog line is required'),
    );
  }
  if (!pedestalOk) {
    out.push(
      err(
        'ADV_NO_ITEM_PEDESTAL',
        '/levels/0/rooms',
        `place one "item" entity granting ${spec.combatKit.secondary.name} (${dungeon.items.secondary})`,
      ),
    );
  }

  out.push(...lintAdventureStyle(spec), ...lintDuration(estimateAdventureDurationS(spec)));
  return out;
}

/** Rooms × engagement + combat + boss. */
export function estimateAdventureDurationS(spec: AdventureSpec): number {
  const dungeon = spec.levels[0];
  if (!dungeon) return 0;
  let total = dungeon.rooms.length * 22;
  for (const room of dungeon.rooms) {
    for (const e of room.entities) {
      if ((ENEMY_TYPES as readonly string[]).includes(e.type)) total += 6;
      if (e.type === 'npc') total += 5;
      if (e.type === 'key') total += 8; // find + backtrack
    }
  }
  if (spec.adventureStyle === 'puzzleQuest')
    total += dungeon.rooms.filter((room) => room.puzzle).length * 35;
  else total += spec.boss.phases.length * 35 + Math.min(50, spec.boss.hp);
  if (spec.adventureStyle === 'rescueRaid') total += dungeon.rooms.length * 8;
  return total;
}

function lintAdventureStyle(spec: AdventureSpec): LintError[] {
  const out: LintError[] = [];
  const dungeon = spec.levels[0]!;
  const { edges } = buildGraph(dungeon);
  if (spec.adventureStyle) {
    if (!adventureGateChoicesSafe(spec))
      out.push(
        err(
          'ADV_GATE_CHOICE_TRAP',
          '/levels/0/rooms',
          'a legal key-spending choice can strand the objective; put enough keys on reachable branches before dependent gates (use at most 12 locked edges)',
        ),
      );
    dungeon.rooms.forEach((room, ri) => {
      const landings = roomDoorLandings(room);
      const start = landings[0];
      if (!start) return;
      const queue = [start];
      const reached = new Set([`${start.x},${start.y}`]);
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i]!;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = cell.x + dx!,
            y = cell.y + dy!,
            key = `${x},${y}`;
          if (
            x < 1 ||
            x > 30 ||
            y < 1 ||
            y > 14 ||
            reached.has(key) ||
            ['wall', 'pit', 'hazard', 'block'].includes(roomTileKind(room, x, y))
          )
            continue;
          reached.add(key);
          queue.push({ x, y });
        }
      }
      const required = [
        ...landings,
        ...room.entities.filter((e) => ['key', 'item', 'npc'].includes(e.type)),
      ];
      if (required.some((cell) => !reached.has(`${cell.x},${cell.y}`)))
        out.push(
          err(
            'ADV_ROOM_ROUTE_SPLIT',
            `/levels/0/rooms/${ri}/tiles`,
            'all door approaches and required interactions must share a calm walking route without pushing blocks or crossing hazards',
          ),
        );
    });
  }
  const beforeBoss = new Set([dungeon.startRoom]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (edge.from === dungeon.bossRoom || edge.to === dungeon.bossRoom) continue;
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ]) {
        if (beforeBoss.has(a!) && !beforeBoss.has(b!)) {
          beforeBoss.add(b!);
          changed = true;
        }
      }
    }
  }
  const early = new Set([dungeon.startRoom]);
  changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges.filter((edge) => !edge.locked)) {
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ]) {
        if (early.has(a!) && !early.has(b!)) {
          early.add(b!);
          changed = true;
        }
      }
    }
  }
  const puzzles = dungeon.rooms.filter((room) => room.puzzle);
  const captives = dungeon.rooms.flatMap((room) =>
    room.entities.filter((e) => e.props?.rescue).map((entity) => ({ room, entity })),
  );
  if (spec.adventureStyle !== 'puzzleQuest' && puzzles.length)
    out.push(
      err(
        'ADV_STYLE_PUZZLE',
        '/levels/0/rooms',
        'puzzle metadata is reserved for puzzleQuest; do not silently change its win rules',
      ),
    );
  if (
    spec.adventureStyle !== 'rescueRaid' &&
    (captives.length || dungeon.rescueTarget !== undefined)
  )
    out.push(
      err('ADV_STYLE_RESCUE', '/levels/0', 'rescue targets and captive NPCs require rescueRaid'),
    );
  if (spec.adventureStyle === 'puzzleQuest') {
    if (puzzles.length < 4 || !puzzles.some((room) => room.id === dungeon.bossRoom))
      out.push(
        err(
          'ADV_PUZZLE_FLOOR',
          '/levels/0/rooms',
          'puzzleQuest needs at least four puzzle rooms, including bossRoom as the final puzzle',
        ),
      );
    if (new Set(puzzles.map((room) => room.puzzle!.pattern)).size < 3)
      out.push(
        err(
          'ADV_PUZZLE_VARIETY',
          '/levels/0/rooms',
          'use pushLane, cornerTurn, and splitPlates; introduce a puzzle before any locked gate',
        ),
      );
    if (!puzzles.some((room) => early.has(room.id)))
      out.push(
        err(
          'ADV_PUZZLE_EARLY',
          '/levels/0/rooms',
          'place a teaching puzzle in the entrance or its open-door component',
        ),
      );
    if (puzzles.some((room) => room.id !== dungeon.bossRoom && !beforeBoss.has(room.id)))
      out.push(
        err(
          'ADV_PUZZLE_AFTER_GATE',
          '/levels/0/rooms',
          'all preliminary seals must be reachable without passing through the final chamber',
        ),
      );
    dungeon.rooms.forEach((room, ri) => {
      const enemyCount = room.entities.filter((e) =>
        (ENEMY_TYPES as readonly string[]).includes(e.type),
      ).length;
      if (enemyCount > (room.puzzle ? 0 : 2))
        out.push(
          err(
            'ADV_PUZZLE_PRESSURE',
            `/levels/0/rooms/${ri}/entities`,
            'puzzle rooms must be enemy-free; other puzzleQuest rooms allow at most two enemies',
          ),
        );
      if (!room.puzzle) return;
      const canonical = adventurePuzzleGeometry(room.puzzle);
      if (
        JSON.stringify(room.tiles) !== JSON.stringify(canonical.tiles) ||
        room.tiles.some((row) =>
          [...row].some((ch) => ch !== '.' && room.legend[ch] !== canonical.legend[ch]),
        )
      )
        out.push(
          err(
            'ADV_PUZZLE_GEOMETRY',
            `/levels/0/rooms/${ri}`,
            'puzzle pattern/variant must match its compiled geometry',
          ),
        );
      if (room.entities.some((e) => e.x >= 6 && e.x <= 25 && e.y >= 4 && e.y <= 11))
        out.push(
          err(
            'ADV_PUZZLE_INTERFERENCE',
            `/levels/0/rooms/${ri}/entities`,
            'keep entities outside the puzzle work area (x 6..25, y 4..11) so block routes remain usable',
          ),
        );
    });
  }
  if (spec.adventureStyle === 'rescueRaid') {
    const target = dungeon.rescueTarget ?? 0;
    const reachable = captives.filter(
      ({ room, entity }) => beforeBoss.has(room.id) && entity.type === 'npc',
    );
    if (
      target < 3 ||
      reachable.length < target + 1 ||
      new Set(reachable.map(({ room }) => room.id)).size < 3
    )
      out.push(
        err(
          'ADV_RESCUE_FLOOR',
          '/levels/0',
          'rescueRaid needs rescueTarget >= 3, at least one extra optional captive, and captives in three or more pre-guardian rooms',
        ),
      );
    if (captives.some(({ entity }) => entity.type !== 'npc'))
      out.push(err('ADV_RESCUE_NPC', '/levels/0/rooms', 'only NPC entities can be rescue targets'));
    if (!captives.some(({ room }) => early.has(room.id)))
      out.push(
        err(
          'ADV_RESCUE_EARLY',
          '/levels/0/rooms',
          'teach rescue in the entrance or an open connected room before the first key gate',
        ),
      );
    const start = dungeon.rooms.find((room) => room.id === dungeon.startRoom);
    if (start) {
      const safe = safelyReachableRoomCells(start);
      const blocked = [15, 16, 17].some((x) =>
        [7, 8, 9].some((y) => roomTileKind(start, x, y) !== 'floor' || !safe.has(`${x},${y}`)),
      );
      if (blocked || start.entities.some((e) => Math.abs(e.x - 16) <= 2 && Math.abs(e.y - 8) <= 2))
        out.push(
          err(
            'ADV_EXTRACTION_SPACE',
            '/levels/0/startRoom',
            'keep the entrance center (x15..17,y7..9) calm, connected floor and leave entities outside x14..18,y6..10 for extraction',
          ),
        );
    }
  }
  return out;
}

/** Explore every legal key-spending order, including redundant loop doors.
 * Reachable open regions include all recoverable keys/tools/objectives in that region. */
export function adventureGateChoicesSafe(spec: AdventureSpec): boolean {
  const dungeon = spec.levels[0];
  if (!dungeon) return false;
  const { edges, errors } = buildGraph(dungeon);
  if (errors.length) return false;
  const locks = edges.filter((e) => e.locked);
  if (locks.length > 12) return false;
  const queue = [0],
    seen = new Set([0]);
  for (let index = 0; index < queue.length; index++) {
    const mask = queue[index]!,
      reached = new Set([dungeon.startRoom]);
    const open = edges.filter((e) => !e.locked || !!(mask & (1 << locks.indexOf(e))));
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of open) {
        if (reached.has(e.from) && !reached.has(e.to)) {
          reached.add(e.to);
          changed = true;
        }
        if (reached.has(e.to) && !reached.has(e.from)) {
          reached.add(e.from);
          changed = true;
        }
      }
    }
    if (reached.size === dungeon.rooms.length) continue;
    const rooms = dungeon.rooms.filter((r) => reached.has(r.id));
    const entities = rooms.flatMap((r) => r.entities);
    const spent = locks.reduce((n, _, i) => n + ((mask >> i) & 1), 0);
    const keys = entities.filter((e) => e.type === 'key').length - spent;
    const tool = entities.some(
      (e) => e.type === 'item' && e.props?.item === dungeon.items.secondary,
    );
    const objective =
      spec.adventureStyle === 'puzzleQuest'
        ? dungeon.rooms.every((r) => !r.puzzle || r.id === dungeon.bossRoom || reached.has(r.id))
        : spec.adventureStyle === 'rescueRaid'
          ? entities.filter((e) => e.type === 'npc' && e.props?.rescue).length >=
            (dungeon.rescueTarget ?? 3)
          : true;
    let choices = 0;
    if (keys > 0)
      locks.forEach((e, i) => {
        if (
          mask & (1 << i) ||
          (!reached.has(e.from) && !reached.has(e.to)) ||
          (e.kind === 'boss' && (!tool || !objective))
        )
          return;
        choices++;
        const next = mask | (1 << i);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      });
    if (!choices) return false;
  }
  return true;
}
