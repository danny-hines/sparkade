/* global window */
/** Replays the real room controller, pickup, gate, block and completion code.
 * Invulnerability isolates progression from subjective combat difficulty. */
export function checkAdventureObjectives() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  const results = [];
  const record = (name, pass, detail = {}) => results.push({ name, pass, ...detail });
  const cards = () => {
    for (let i = 0; i < 30 && host.engineCtx.cards.active; i++) host.engineCtx.cards.skip();
  };
  if (!g.roomReady) g.start();
  cards();
  let previous = [];
  const step = (held = [], dt = 1 / 60) => {
    cards();
    g.invulnT = 10;
    const input = Object.fromEntries(
      ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'START', 'SELECT'].map((key) => [
        key,
        {
          held: held.includes(key),
          pressed: held.includes(key) && !previous.includes(key),
          released: !held.includes(key) && previous.includes(key),
        },
      ]),
    );
    g.update(dt, input);
    previous = held;
  };
  const tiles = (x, y) => g.kindAt(x, y);
  const walkable = (x, y) =>
    x >= 1 &&
    x < 31 &&
    y >= 1 &&
    y < 15 &&
    !g.blockAt(x, y) &&
    !['wall', 'pit', 'doorLocked', 'doorBoss'].includes(tiles(x, y)) &&
    !(tiles(x, y) === 'hazard' && g.hazardsActive);
  const walkTo = (tx, ty) => {
    const sx = Math.floor((g.px + 6) / 16),
      sy = Math.floor((g.py + 6) / 16);
    const key = (x, y) => `${x},${y}`;
    const queue = [[sx, sy]],
      seen = new Map([[key(sx, sy), null]]);
    let found = false;
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      if (x === tx && y === ty) {
        found = true;
        break;
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (walkable(x + dx, y + dy) && !seen.has(key(x + dx, y + dy))) {
          seen.set(key(x + dx, y + dy), [x, y]);
          queue.push([x + dx, y + dy]);
        }
    }
    if (!found) throw new Error(`No walking path in ${g.room.id} to ${tx},${ty}`);
    const path = [];
    let cell = [tx, ty];
    while (cell) {
      path.push(cell);
      cell = seen.get(key(...cell));
    }
    path.reverse();
    for (const [x, y] of path) {
      for (const [axis, target] of [
        ['x', x * 16 + 2],
        ['y', y * 16 + 2],
      ]) {
        let count = 0;
        while (Math.abs((axis === 'x' ? g.px : g.py) - target) > 0.05 && count++ < 90) {
          const delta = target - (axis === 'x' ? g.px : g.py);
          step(
            [axis === 'x' ? (delta > 0 ? 'RIGHT' : 'LEFT') : delta > 0 ? 'DOWN' : 'UP'],
            Math.min(1 / 60, Math.abs(delta) / 84),
          );
        }
        if (count >= 90) throw new Error(`Walking stalled in ${g.room.id}: ${axis} to ${target}`);
      }
    }
    step();
  };
  const solve = () => {
    const puzzle = g.room.puzzle;
    if (!puzzle || g.solvedPuzzles.has(g.roomIx)) return;
    const coords = (x, y) => [puzzle.variant === 1 ? 31 - x : x, puzzle.variant === 2 ? 15 - y : y];
    const direction = (dx, dy) => [
      puzzle.variant === 1 ? -dx : dx,
      puzzle.variant === 2 ? -dy : dy,
    ];
    const push = (x, y, dx, dy, count) => {
      let [tx, ty] = coords(x, y);
      [dx, dy] = direction(dx, dy);
      walkTo(tx - dx, ty - dy);
      for (let i = 0; i < count; i++) {
        const block = g.blockAt(tx, ty);
        if (!block) throw new Error(`Missing puzzle block at ${tx},${ty}`);
        let frames = 0;
        while (!block.sliding && frames++ < 90)
          step([dx > 0 ? 'RIGHT' : dx < 0 ? 'LEFT' : dy > 0 ? 'DOWN' : 'UP']);
        if (!block.sliding) throw new Error('Block did not start moving');
        while (block.sliding && frames++ < 120) step();
        tx += dx;
        ty += dy;
        if (i + 1 < count) walkTo(tx - dx, ty - dy);
      }
    };
    if (puzzle.pattern === 'pushLane') push(8, 6, 1, 0, 3);
    else if (puzzle.pattern === 'cornerTurn') {
      push(9, 5, 0, 1, 2);
      push(9, 7, 1, 0, 2);
    } else {
      push(8, 6, 1, 0, 3);
      push(23, 9, -1, 0, 3);
    }
    step();
    record(`solve-${g.room.id}`, g.solvedPuzzles.has(g.roomIx) && !g.hazardsActive);
  };
  const gateReady = () =>
    g.hasItem &&
    (g.spec.adventureStyle === 'puzzleQuest'
      ? g.solvedPuzzles.size >=
        g.dungeon.rooms.filter((r) => r.puzzle && r.id !== g.dungeon.bossRoom).length
      : g.spec.adventureStyle === 'rescueRaid'
        ? g.rescued.size >= (g.dungeon.rescueTarget ?? 3)
        : true);
  const reachablePath = (target) => {
    const queue = [[g.roomIx, [], g.keys]],
      seen = new Map([[g.roomIx, g.keys]]);
    for (let i = 0; i < queue.length; i++) {
      const [ix, path, keys] = queue[i];
      if (ix === target) return path;
      const room = g.dungeon.rooms[ix];
      for (const [dir, dx, dy] of [
        ['n', 0, -1],
        ['s', 0, 1],
        ['e', 1, 0],
        ['w', -1, 0],
      ]) {
        const kind = room.doors[dir];
        if (kind === 'none') continue;
        const next = g.posIndex.get(`${room.gridPos.x + dx},${room.gridPos.y + dy}`);
        if (next === undefined) continue;
        const opened = kind === 'open' || g.openedDoors.has(g.pairKey(ix, next));
        if (!opened && (keys <= 0 || (kind === 'boss' && !gateReady()))) continue;
        const remaining = keys - (opened ? 0 : 1);
        if ((seen.get(next) ?? -1) >= remaining) continue;
        seen.set(next, remaining);
        queue.push([next, [...path, dir], remaining]);
      }
    }
    return null;
  };
  const travel = (path) => {
    for (const dir of path) {
      const [tx, ty, key] = {
        n: [16, 1, 'UP'],
        s: [16, 14, 'DOWN'],
        e: [30, 8, 'RIGHT'],
        w: [1, 8, 'LEFT'],
      }[dir];
      walkTo(tx, ty);
      const before = g.roomIx;
      for (let frame = 0; frame < 120 && g.roomIx === before; frame++) step([key]);
      if (g.roomIx === before)
        throw new Error(`Door ${dir} did not open from ${g.room.id}: ${g.floatText}`);
      cards();
      step();
    }
  };
  const visit = () => {
    for (const e of g.ents.filter((e) => e.active && ['key', 'item'].includes(e.type))) {
      walkTo(Math.floor((e.x + e.w / 2) / 16), Math.floor((e.y + e.h / 2) / 16));
      step();
    }
    for (const e of g.ents.filter((e) => e.active && e.type === 'npc' && e.props.rescue)) {
      // Leave the extra captive behind to prove the quota, rather than every NPC, is sufficient.
      if (g.rescued.size >= (g.dungeon.rescueTarget ?? 3)) continue;
      walkTo(Math.floor((e.x + e.w / 2) / 16), Math.floor((e.y + e.h / 2) / 16));
      step(['A']);
      cards();
      step();
      record(`rescue-${g.room.id}`, !e.active && g.rescued.has(`${g.roomIx}:${e.specIx}`));
    }
    solve();
  };
  if (['puzzleQuest', 'rescueRaid'].includes(g.spec.adventureStyle)) {
    const ix = g.dungeon.rooms.findIndex(
      (r, i) => i !== g.bossIx && Object.values(r.doors).includes('boss'),
    );
    g.enterRoom(ix, null, null);
    cards();
    const keys = g.keys,
      hasItem = g.hasItem;
    g.keys = 1;
    g.hasItem = true;
    const gate = g.doors.find((door) => door.neighbor === g.bossIx);
    g.tryUnlock(gate.cells[0].tx, gate.cells[0].ty);
    record(
      'key-and-tool-cannot-bypass-objective',
      g.keys === 1 && !g.openedDoors.has(g.pairKey(ix, g.bossIx)),
    );
    g.keys = keys;
    g.hasItem = hasItem;
    g.enterRoom(g.startIx, null, null);
    cards();
    step();
  }
  // Resetting an unsolved puzzle restores block positions without giving free health or score.
  if (g.spec.adventureStyle === 'puzzleQuest') {
    const ix = g.dungeon.rooms.findIndex((r) => r.puzzle && r.id !== g.dungeon.bossRoom);
    g.enterRoom(ix, null, null);
    cards();
    const health = (g.hud.health = 2),
      score = g.hud.score;
    const initial = g.blocks.filter((b) => b.active).map((b) => [b.tx, b.ty]);
    // Controlled placement checks that standing on a plate cannot earn a permanent seal.
    const plate = g.switchCells[0];
    g.px = plate.tx * 16 + 2;
    g.py = plate.ty * 16 + 2;
    step();
    record('standing-on-plate-does-not-solve-seal', !g.solvedPuzzles.has(ix));
    const block = g.blocks.find((b) => b.active);
    block.tx = block.toTx = 4;
    block.x = 64;
    step(['X']);
    record(
      'reset-restores-layout-without-rewards',
      JSON.stringify(g.blocks.filter((b) => b.active).map((b) => [b.tx, b.ty])) ===
        JSON.stringify(initial) &&
        g.hud.health === health &&
        g.hud.score === score,
    );
    g.enterRoom(g.startIx, null, null);
    cards();
    step();
  }
  if (g.spec.adventureStyle === 'rescueRaid') {
    walkTo(16, 8);
    step(['A']);
    cards();
    step();
    record('cannot-extract-before-objective', !g.result);
  }
  const visited = new Set();
  for (let count = 0; count < g.dungeon.rooms.length + 2; count++) {
    visit();
    visited.add(g.roomIx);
    const next = g.dungeon.rooms
      .map((_, i) => i)
      .find((ix) => ix !== g.bossIx && !visited.has(ix) && reachablePath(ix));
    if (next === undefined) break;
    travel(reachablePath(next));
  }
  record('all-preliminary-rooms-reachable', visited.size >= g.dungeon.rooms.length - 1, {
    visited: visited.size,
  });
  const quota = g.rescued.size,
    solved = g.solvedPuzzles.size,
    score = g.hud.score;
  g.killPlayer();
  cards();
  step();
  record(
    'death-preserves-objective-progress',
    g.rescued.size === quota && g.solvedPuzzles.size === solved && g.hud.score === score,
  );
  const finalPath = reachablePath(g.bossIx);
  if (!finalPath) throw new Error('Final chamber remains inaccessible');
  travel(finalPath);
  record('final-gate-accepted-objective-and-tool', g.roomIx === g.bossIx && g.hasItem);
  if (g.spec.adventureStyle === 'puzzleQuest') {
    record('finale-is-puzzle-not-combat', !g.boss.active && !g.result);
    solve();
    cards();
  } else {
    // A controlled close-range pilot exercises real melee hitboxes and boss HP.
    for (let frame = 0; frame < 12_000 && g.boss.active; frame++) {
      g.px = g.boss.x - 16;
      g.py = g.boss.y + g.boss.h / 2 - 6;
      g.facing = 'right';
      step(frame % 30 === 0 ? ['B'] : []);
    }
    record('guardian-defeated-by-primary-attack', g.bossDefeated);
    cards();
    if (g.spec.adventureStyle === 'rescueRaid') {
      record(
        'extra-captive-is-optional',
        g.rescued.size === g.dungeon.rescueTarget &&
          g.rescued.size <
            g.dungeon.rooms.flatMap((r) => r.entities).filter((e) => e.props?.rescue).length,
      );
      record('guardian-defeat-does-not-skip-extraction', !g.result && g.phase === 'play');
      travel(reachablePath(g.startIx));
      walkTo(16, 8);
      step(['A']);
      cards();
    }
  }
  record('objective-completes-with-score', g.result?.outcome === 'won' && g.result.score > 0, {
    outcome: g.result?.outcome,
    score: g.result?.score,
  });
  host.render();
  return { title: g.spec.meta.title, style: g.spec.adventureStyle, results, seconds: g.playT };
}
