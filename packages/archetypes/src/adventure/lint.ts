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
import {
  err,
  lintDuration,
  lintLegendCoverage,
  lintMusic,
  lintRowLengths,
  lintSpriteRefs,
} from '../common';

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
}

/** Build the door graph; also emits consistency errors. */
export function buildGraph(dungeon: AdventureDungeon): { edges: Edge[]; errors: LintError[] } {
  const errors: LintError[] = [];
  const byPos = new Map<string, AdventureRoom>();
  const byId = new Map<string, AdventureRoom>();
  dungeon.rooms.forEach((room, i) => {
    const pk = `${room.gridPos.x},${room.gridPos.y}`;
    if (byPos.has(pk)) {
      errors.push(err('ADV_GRID_OVERLAP', `/levels/0/rooms/${i}/gridPos`, `rooms "${byPos.get(pk)!.id}" and "${room.id}" share grid position (${pk})`));
    }
    if (byId.has(room.id)) {
      errors.push(err('ADV_DUP_ROOM_ID', `/levels/0/rooms/${i}/id`, `duplicate room id "${room.id}"`));
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
        errors.push(err('ADV_DOOR_TO_NOWHERE', `/levels/0/rooms/${i}/doors/${dir}`, `room "${room.id}" has a ${kind} door ${dir} but no room sits at that grid position`));
        continue;
      }
      const back = neighbor.doors[opposite];
      if (back === 'none') {
        errors.push(err('ADV_DOOR_MISMATCH', `/levels/0/rooms/${i}/doors/${dir}`, `door ${dir} of "${room.id}" leads to "${neighbor.id}" whose ${opposite} door is "none" — both sides must declare the door`));
        continue;
      }
      if (back !== kind) {
        errors.push(err('ADV_DOOR_MISMATCH', `/levels/0/rooms/${i}/doors/${dir}`, `door ${dir} of "${room.id}" is "${kind}" but "${neighbor.id}" declares "${back}" — both sides must match`));
        continue;
      }
      const ek = [room.id, neighbor.id].sort().join('|') + '|' + dir + opposite;
      const canonical = [room.id, neighbor.id].sort().join('|');
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      edges.push({ from: room.id, to: neighbor.id, locked: kind === 'locked' || kind === 'boss' });
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
      const win = DOOR_BY_RANK[Math.max(DOOR_RANK[room.doors[dir]], DOOR_RANK[neighbor.doors[opposite]])]!;
      room.doors[dir] = win;
      neighbor.doors[opposite] = win;
    }
  }
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
    out.push(err('ADV_UNREACHABLE_ROOM', `/levels/0/rooms`, `room "${room.id}" cannot be reached from "${dungeon.startRoom}" — check door connections and that keys appear before the locks that need them`));
  }
  if (!reached.has(dungeon.bossRoom)) {
    out.push(err('ADV_BOSS_UNREACHABLE', `/levels/0/bossRoom`, `the boss room "${dungeon.bossRoom}" is not reachable with the available keys`));
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
    out.push(err('ADV_BAD_START', '/levels/0/startRoom', `startRoom "${dungeon.startRoom}" does not exist`));
  }
  if (!ids.has(dungeon.bossRoom)) {
    out.push(err('ADV_BAD_BOSS_ROOM', '/levels/0/bossRoom', `bossRoom "${dungeon.bossRoom}" does not exist`));
  }
  if (dungeon.startRoom === dungeon.bossRoom) {
    out.push(err('ADV_START_IS_BOSS', '/levels/0/startRoom', 'startRoom must differ from bossRoom'));
  }

  const { edges, errors } = buildGraph(dungeon);
  out.push(...errors);
  if (errors.length === 0 && ids.has(dungeon.startRoom)) {
    out.push(...checkKeyTopology(dungeon, edges));
  }

  const enemyTypes = new Set<string>();
  let npcWithDialog = 0;
  let keyCount = 0;
  let pedestalOk = false;

  dungeon.rooms.forEach((room, ri) => {
    const path = `/levels/0/rooms/${ri}`;
    out.push(...lintRowLengths(room.tiles, path, 'ADV_ROWS_UNEQUAL'));
    out.push(...lintLegendCoverage(room.tiles, room.legend, path, 'ADV_LEGEND_UNKNOWN_CHAR'));
    for (const e of room.entities) {
      if ((ENEMY_TYPES as readonly string[]).includes(e.type)) enemyTypes.add(e.type);
      if (e.type === 'npc' && e.props?.dialog) npcWithDialog++;
      if (e.type === 'npc' && !e.props?.dialog) {
        out.push(err('ADV_NPC_NO_DIALOG', `${path}/entities`, `npc at (${e.x},${e.y}) has no props.dialog line`));
      }
      if (e.type === 'key') keyCount++;
      if (e.type === 'item') {
        if (e.props?.item === dungeon.items.secondary) pedestalOk = true;
        else {
          out.push(err('ADV_ITEM_MISMATCH', `${path}/entities`, `item pedestal grants "${e.props?.item ?? 'nothing'}" but items.secondary is "${dungeon.items.secondary}"`));
        }
      }
      // Entities must stand on walkable tiles.
      const ch = room.tiles[e.y]?.[e.x];
      const kind = ch === '.' || ch === undefined ? 'floor' : (room.legend[ch] ?? 'floor');
      if (kind === 'wall' || kind === 'pit') {
        out.push(err('ADV_ENTITY_IN_WALL', `${path}/entities`, `${e.type} at (${e.x},${e.y}) is inside a ${kind} tile`));
      }
    }
    if (room.id === dungeon.bossRoom && room.entities.some((e) => (ENEMY_TYPES as readonly string[]).includes(e.type))) {
      out.push(err('ADV_BOSS_ROOM_CROWDED', `${path}/entities`, 'the boss room must not contain other enemies — the boss fight owns it'));
    }
  });

  const lockedDoorCount = edges.filter((e) => e.locked).length;
  if (lockedDoorCount < 2) {
    out.push(err('ADV_FLOOR_LOCKS', '/levels/0/rooms', `${lockedDoorCount} locked gate(s); the floor is 2 (use "locked" or "boss" doors)`));
  }
  if (keyCount < lockedDoorCount) {
    out.push(err('ADV_KEYS_SHORT', '/levels/0/rooms', `${keyCount} key(s) for ${lockedDoorCount} locked door(s) — every locked door needs a key`));
  }
  if (enemyTypes.size < 4) {
    out.push(err('ADV_FLOOR_ENEMY_TYPES', '/levels/0/rooms', `uses ${enemyTypes.size} enemy types; the floor is 4`));
  }
  if (npcWithDialog < 1) {
    out.push(err('ADV_FLOOR_NPC', '/levels/0/rooms', 'at least one NPC with a dialog line is required'));
  }
  if (!pedestalOk) {
    out.push(err('ADV_NO_ITEM_PEDESTAL', '/levels/0/rooms', `place one "item" entity granting the chosen secondary item (${dungeon.items.secondary})`));
  }

  out.push(...lintDuration(estimateAdventureDurationS(spec)));
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
  total += spec.boss.phases.length * 35 + Math.min(50, spec.boss.hp);
  return total;
}
