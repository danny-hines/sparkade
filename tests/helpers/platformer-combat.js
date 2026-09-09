/* global window */
/** Runs inside the dev playtest page. Only scene setup changes positions/specs;
 * each fight advances the production controller, enemy AI, damage and projectiles.
 * These bounded fights do not claim a complete game victory or subjective balance. */
export function checkPlatformerCombat() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  g.enterLevel(0);
  host.engineCtx.cards.skip();
  const originalArena = g.spec.boss.arena;
  const results = [];
  const keys = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'START', 'SELECT', 'L', 'R'];
  let previous = [];
  const step = (held = []) => {
    const input = Object.fromEntries(
      keys.map((key) => [
        key,
        {
          held: held.includes(key),
          pressed: held.includes(key) && !previous.includes(key),
          released: !held.includes(key) && previous.includes(key),
        },
      ]),
    );
    previous = held;
    g.update(1 / 60, input);
  };
  const scene = (terrain = 'flat', boss = false) => {
    const rows = Array.from({ length: 18 }, (_, y) =>
      Array.from({ length: 24 }, (_, x) => (y >= 16 || x === 0 || x === 23 ? '#' : '.')),
    );
    if (terrain === 'cover') for (let y = 14; y < 16; y++) rows[y][8] = '#';
    if (terrain === 'platform') for (let x = 9; x < 14; x++) rows[12][x] = '=';
    if (terrain === 'wall') for (let y = 4; y < 16; y++) rows[y][4] = '#';
    g.spec.boss.arena = {
      tiles: rows.map((row) => row.join('')),
      legend: { '#': 'solid', '=': 'platform' },
    };
    g.enterBoss(false);
    host.engineCtx.cards.skip();
    g.engine.music.stopSong();
    if (!boss) g.boss.active = false;
    g.hud.health = g.hud.maxHealth;
    g.hud.lives = 3;
    g.spawnPlayer(5, 15);
    g.facing = 1;
    previous = [];
    for (let i = 0; i < 12; i++) step();
    return g.hud.health;
  };
  const enemy = (type = 'walker', x = 10, y = 15) => {
    const e = g.makeEnt({
      type,
      x,
      y,
      props: { range: 2, speed: 0.6, amplitude: 0.5, periodMs: 3000, fireIntervalMs: 2800 },
    });
    g.ents.push(e);
    return e;
  };
  const record = (name, pass, details = {}) =>
    results.push({ name, pass, health: g.hud.health, ...details });
  const kit = g.kit;
  try {
    if (kit.combat === 'blaster') {
      for (const role of ['walker', 'shooter', 'chaser'])
        for (const moving of [false, true]) {
          const health = scene();
          const e = enemy(role);
          for (let f = 0; f < 90 && e.active; f++) step(moving ? ['RIGHT', 'B', 'Y'] : ['Y']);
          record(
            `${role}/${moving ? 'running' : 'standing'}-fire`,
            !e.active && g.hud.health === health,
          );
        }
      scene('platform');
      const elevated = enemy('shooter', 11, 11);
      g.spawnPlayer(11, 15);
      for (let f = 0; f < 90 && elevated.active; f++) step(['UP', 'Y']);
      record('upward-fire/platform', !elevated.active);

      scene();
      const aerial = enemy('flyer', 10, 12);
      let airborneShots = 0;
      for (let f = 0; f < 90 && aerial.active; f++) {
        step(f < 24 ? ['A', 'Y'] : ['Y']);
        if (!g.onGround && g.projs.some((p) => p.active && p.friendly)) airborneShots++;
      }
      record('airborne-fire', !aerial.active && airborneShots > 0, { airborneShots });

      scene('cover');
      const covered = enemy('shooter', 11, 15);
      for (let f = 0; f < 60; f++) step(['Y']);
      record('solid-cover-blocks-shots', covered.active);
      for (let f = 0; f < 150 && covered.active; f++) {
        const crossing = g.px < 9 * 16;
        step(crossing ? ['RIGHT', 'A', 'Y'] : ['Y']);
      }
      record('cover-advance-can-attack', !covered.active);

      if (g.spec.chargeShot !== 'none') {
        scene();
        const targets = [enemy('shooter', 10), enemy('shooter', 12), enemy('shooter', 14)];
        for (let f = 0; f < 51; f++) step(['X']);
        step();
        const charged = g.projs.find((p) => p.active && p.friendly);
        const damage = charged?.damage;
        for (let f = 0; f < 90; f++) step();
        record('charged-shot-piercing', damage === 3 && targets.every((e) => !e.active), {
          damage,
        });
      } else {
        scene();
        const e = enemy('walker');
        for (let f = 0; f < 90 && e.active; f++) step(['X']);
        record('conventional-X-fire', !e.active && g.charge === 0);
      }

      if (kit.traversal === 'wallJump') {
        scene('wall');
        g.spawnPlayer(5, 9);
        const e = enemy('flyer', 10, 9);
        let wallShots = 0;
        for (let f = 0; f < 70 && e.active; f++) {
          step(['LEFT', 'Y']);
          if (g.towerMotion?.wall && g.projs.some((p) => p.active && p.friendly && p.vx > 0))
            wallShots++;
        }
        record('wall-fire-away-from-wall', !e.active && wallShots > 0, { wallShots });
      }
    } else {
      for (const role of ['walker', 'shooter', 'chaser']) {
        const health = scene();
        const e = enemy(role, 10);
        if (kit.combat === 'melee') {
          g.spawnPlayer(8, 15);
          for (let f = 0; f < 60 && e.active; f++) step(f % 32 === 0 ? ['Y'] : []);
          record(`${role}/ground-strike`, !e.active && g.hud.health === health);
          scene();
          g.ents.push(e);
          Object.assign(
            e,
            g.makeEnt({
              type: role,
              x: 10,
              y: 15,
              props: { speed: 0.6, range: 2, fireIntervalMs: 2800 },
            }),
          );
        }
        g.spawnPlayer(8, 15);
        for (let f = 0; f < 12; f++) step();
        let attacked = false;
        for (let f = 0; f < 100 && e.active; f++) {
          const held = f < 24 ? ['A'] : [];
          const dx = e.x + e.w / 2 - (g.px + g.playerW / 2);
          if (Math.abs(dx) > 3) held.push(dx > 0 ? 'RIGHT' : 'LEFT');
          const landingLead = g.pvy * 0.18 + 0.5 * g.grav * 0.18 ** 2;
          if (
            kit.combat === 'melee' &&
            !attacked &&
            g.pvy > 0 &&
            g.py + g.playerH > e.y - landingLead
          ) {
            held.push('Y');
            attacked = true;
          }
          step(held);
        }
        record(
          `${role}/${kit.combat === 'melee' ? 'landing-strike' : 'stomp'}`,
          !e.active && g.hud.health === health,
          { attacked },
        );
      }
    }

    // An opening must permit the real kit to deal damage before the next attack.
    scene('flat', true);
    const b = g.boss;
    b.hp = Math.max(3, Math.floor(b.maxHp * 0.2));
    const hp = b.hp;
    b.x = 10 * 16;
    g.spawnPlayer(kit.combat === 'melee' ? 8 : kit.combat === 'stomp' ? 8 : 5, 15);
    for (let f = 0; f < 12; f++) step();
    let attacked = false;
    for (let f = 0; f < 90 && b.hp === hp; f++) {
      const held = [];
      if (kit.combat === 'blaster') held.push('Y');
      else if (kit.combat === 'melee') {
        if (f % 32 === 0) held.push('Y');
      } else {
        if (f < 24) held.push('A');
        const dx = b.x + b.w / 2 - (g.px + g.playerW / 2);
        if (Math.abs(dx) > 3) held.push(dx > 0 ? 'RIGHT' : 'LEFT');
      }
      step(held);
      attacked ||= b.attack.name !== 'idle';
    }
    record('late-phase-boss-opening', b.hp < hp, { damage: hp - b.hp, bossAttacked: attacked });
  } finally {
    g.spec.boss.arena = originalArena;
    g.engine.music.stopSong();
  }
  return { title: g.spec.meta.title, style: g.spec.playStyle, results };
}

/** Search supported attack positions in the original authored levels. Each
 * attempt isolates one real enemy, with its AI and the player's damage active. */
export function checkAuthoredPlatformerTargets() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  const results = [];
  const keys = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'START', 'SELECT', 'L', 'R'];
  let previous = [];
  const step = (held = []) => {
    g.update(
      1 / 60,
      Object.fromEntries(
        keys.map((key) => [
          key,
          {
            held: held.includes(key),
            pressed: held.includes(key) && !previous.includes(key),
            released: !held.includes(key) && previous.includes(key),
          },
        ]),
      ),
    );
    previous = held;
  };
  for (let li = 0; li < g.spec.levels.length; li++) {
    const level = g.spec.levels[li];
    const solid = (k) => ['solid', 'ice', 'conveyorLeft', 'conveyorRight'].includes(k);
    const kind = (x, y) => level.legend[level.tiles[y]?.[x]] ?? 'empty';
    for (const [index, authored] of level.entities.entries()) {
      if (!['walker', 'flyer', 'shooter', 'chaser'].includes(authored.type)) continue;
      const candidates = [];
      for (
        let y = Math.max(1, authored.y - 4);
        y <= Math.min(level.tiles.length - 2, authored.y + 6);
        y++
      )
        for (
          let x = Math.max(1, authored.x - 5);
          x <= Math.min(level.tiles[0].length - 2, authored.x + 5);
          x++
        )
          if (
            ![y, y - 1].some(
              (yy) => solid(kind(x, yy)) || ['platform', 'hazard'].includes(kind(x, yy)),
            ) &&
            (solid(kind(x, y + 1)) || kind(x, y + 1) === 'platform') &&
            (Math.abs(x - authored.x) >= 2 || y > authored.y)
          )
            candidates.push({ x, y });
      candidates.sort(
        (a, b) =>
          Math.abs(a.y - authored.y) * 3 +
          Math.abs(Math.abs(a.x - authored.x) - 3) -
          Math.abs(b.y - authored.y) * 3 -
          Math.abs(Math.abs(b.x - authored.x) - 3),
      );
      let success = null;
      let attempts = 0;
      for (const start of candidates.slice(0, 18)) {
        g.enterLevel(li);
        host.engineCtx.cards.skip();
        g.engine.music.stopSong();
        const e = g.ents[index];
        g.ents = [e];
        g.hud.health = g.hud.maxHealth;
        g.hud.lives = 3;
        g.spawnPlayer(start.x, start.y);
        previous = [];
        g.facing = Math.sign(authored.x - start.x) || 1;
        for (let f = 0; f < 12; f++) step();
        const health = g.hud.health;
        let attacked = false;
        for (let f = 0; f < 100 && e.active && g.hud.health === health; f++) {
          const held = [];
          if (g.kit.combat === 'blaster') {
            held.push('Y');
            if (
              Math.abs(e.x + e.w / 2 - (g.px + g.playerW / 2)) < 16 &&
              e.y + e.h / 2 < g.py + g.playerH / 2 - 6
            )
              held.push('UP');
          } else if (g.kit.combat === 'melee' && Math.abs(start.y - authored.y) < 1) {
            const dx = e.x + e.w / 2 - (g.px + g.playerW / 2);
            if (Math.abs(dx) > 28) held.push(dx > 0 ? 'RIGHT' : 'LEFT');
            if (f % 32 === 0) held.push('Y');
          } else {
            if (f < 24) held.push('A');
            const dx = e.x + e.w / 2 - (g.px + g.playerW / 2 + g.pvx * 0.08);
            if (Math.abs(dx) > 3) held.push(dx > 0 ? 'RIGHT' : 'LEFT');
            const lead = g.pvy * 0.18 + 0.5 * g.grav * 0.18 ** 2;
            if (
              g.kit.combat === 'melee' &&
              !attacked &&
              g.pvy > 0 &&
              g.py + g.playerH > e.y - lead
            ) {
              held.push('Y');
              attacked = true;
            }
          }
          step(held);
        }
        attempts++;
        if (!e.active && g.hud.health === health) {
          success = start;
          break;
        }
      }
      results.push({
        level: li + 1,
        index,
        type: authored.type,
        x: authored.x,
        y: authored.y,
        pass: !!success,
        start: success,
        attempts,
      });
    }
  }
  g.engine.music.stopSong();
  return { title: g.spec.meta.title, results };
}
