/* global window */
/** Controlled fights exercise the actual pools, controller, homing and collision code.
 * They verify mechanics and lifecycle; they do not claim an unaided full-game victory. */
export function checkShooterCombat() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  for (let i = 0; i < 4 && host.engineCtx.cards.active; i++) host.engineCtx.cards.skip();
  const results = [];
  let previous = [];
  const step = (held = []) => {
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
    g.update(1 / 60, input);
    previous = held;
  };
  const frames = (count, held = []) => {
    for (let i = 0; i < count; i++) step(held);
  };
  const record = (name, pass, detail = {}) => results.push({ name, pass, ...detail });
  const scene = () => {
    g.levelIndex = 0;
    g.loadLevel(0);
    g.phase = 'play';
    g.waveFired.fill(true);
    g.pickupFired.fill(true);
    g.hud.health = 3;
    g.hud.lives = 3;
    g.rapid = false;
    g.spread = false;
    previous = [];
  };
  const enemy = (x, y, hp = 6) => {
    g.spawnWave({
      t: 0,
      enemyType: 'tank',
      count: 1,
      formation: 'line',
      path: 'hold',
      hp,
      fireRate: 0,
      centerX: x,
    });
    const foe = g.foes.find((f) => f.active && f.y < 0);
    Object.assign(foe, { x, y, baseX: x, hp, state: 1, holdDur: 100, holdY: y, vx: 0, vy: 0 });
    return foe;
  };
  const style = g.spec.shooterStyle;
  scene();
  if (style === 'weaponSwitch') {
    step(['Y']);
    record(
      'focus-has-double-power',
      g.pshots.filter((p) => p.active).every((p) => p.dmg === 2) && g.pshots.some((p) => p.active),
    );
    g.clearPools();
    g.fireCd = 0;
    step(['X', 'Y']);
    record(
      'switch-emits-wide-three-shot-volley',
      g.pshots.filter((p) => p.active).length === 3 &&
        g.pshots.some((p) => p.active && p.vx < 0) &&
        g.pshots.some((p) => p.active && p.vx > 0),
    );
    frames(60, ['X']);
    record('held-switch-does-not-repeat-or-charge', g.weaponMode === 'spread' && g.chargeT === 0);
    step();
    step(['X']);
    record('second-press-restores-focus', g.weaponMode === 'focus');
    scene();
    const flanks = [enemy(191, 78, 1), enemy(321, 78, 1)];
    frames(60, ['X', 'Y']);
    record(
      'spread-covers-separated-flanks',
      flanks.every((target) => !target.active),
    );
  } else if (style === 'chargeSpecialist') {
    const targets = [enemy(256, 185), enemy(256, 145), enemy(256, 105)];
    frames(50, ['X', 'Y']);
    record('charge-pauses-primary-fire', !g.pshots.some((p) => p.active) && g.chargeReady);
    step();
    record(
      'release-emits-six-damage-piercing-bolt',
      g.pshots.some((p) => p.active && p.pierce && p.dmg === 6),
    );
    frames(60);
    record(
      'one-charge-clears-three-aligned-enemies',
      targets.every((target) => !target.active),
    );
    scene();
    frames(20, ['X']);
    step();
    record('short-charge-does-not-fire-full-blast', !g.pshots.some((p) => p.active));
  } else {
    const targets = [enemy(208, 110, 3), enemy(256, 110, 3), enemy(304, 110, 3)];
    frames(85, ['X', 'Y']);
    record(
      'four-locks-distribute-over-three-targets',
      g.locks.keys.length === 4 && new Set(g.locks.keys).size === 3,
    );
    record('targeting-pauses-primary-fire', !g.pshots.some((p) => p.active));
    step();
    record(
      'release-fires-four-missiles',
      g.pshots.filter((p) => p.active && p.missile).length === 4,
    );
    step(['Y']);
    record(
      'primary-fire-remains-available-during-salvo',
      g.pshots.some((p) => p.active && !p.missile),
    );
    for (let i = 0; i < 110; i++) {
      for (const target of targets) if (target.active) target.x += 0.35;
      step();
    }
    record(
      'missiles-hit-moving-off-axis-targets',
      targets.every((target) => !target.active),
      { hp: targets.map((t) => t.hp) },
    );
    scene();
    enemy(256, 100);
    frames(42, ['X']);
    g.killPlayer();
    record('death-drops-target-locks', g.locks.keys.length === 0 && !g.targeting);
  }
  scene();
  const health = g.hud.health;
  const target = enemy(256, 145, 4);
  frames(80, ['Y']);
  record('primary-fire-can-still-defeat-armor', !target.active && g.hud.health === health);
  g.enterBoss(false);
  g.phase = 'play';
  g.boss.entranceT = 2;
  g.boss.y = 70;
  g.boss.t = 6.81;
  g.updateBoss(0);
  record('boss-offers-signature-opening', g.opening);
  const before = g.boss.hp;
  g.chargeSeqCounter++;
  if (style === 'chargeSpecialist') {
    g.fireChargeShot(g.boss.x, g.boss.y, 0, 0);
    g.updatePlayerShots(1 / 60);
    record('exposed-core-takes-double-charge-damage', before - g.boss.hp === 12, {
      damage: before - g.boss.hp,
    });
  }
  g.clearPools();
  frames(45);
  record('boss-opening-suppresses-new-enemy-shots', !g.eshots.some((s) => s.active));
  g.restart();
  record(
    'restart-clears-transient-weapons',
    g.locks.keys.length === 0 && g.chargeT === 0 && !g.targeting && !g.pshots.some((p) => p.active),
  );
  scene();
  g.spawnWave(g.level.waves[0]);
  frames(100);
  frames(style === 'lockOnStriker' ? 85 : 50, style === 'weaponSwitch' ? ['X', 'Y'] : ['X']);
  host.render();
  return { title: g.spec.meta.title, style, results };
}

/** Full authored timeline under a simple weapon-aware pilot. Invulnerability isolates
 * progression and resource-pool failures from subjective difficulty. */
export function checkShooterTimeline() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  g.result = null;
  g.hud.lives = 3;
  g.hud.health = 3;
  g.enterLevel(0);
  let previous = [];
  const seen = new Set();
  const peaks = { enemies: 0, playerShots: 0, enemyShots: 0 };
  let frames = 0;
  for (; frames < 60 * 750 && !g.result; frames++) {
    if (host.engineCtx.cards.active) host.engineCtx.cards.skip();
    seen.add(g.levelIndex);
    const t = frames / 60;
    const target = g.boss?.active
      ? g.boss
      : g.foes
          .filter((f) => f.active && f.y > 20 && f.y < 210)
          .sort((a, b) => Math.abs(a.x - g.px) - Math.abs(b.x - g.px))[0];
    const held = ['Y'];
    if (target && target.x > g.px + 6) held.push('RIGHT');
    if (target && target.x < g.px - 6) held.push('LEFT');
    if (g.spec.shooterStyle === 'chargeSpecialist' && t % 1.65 < 0.9) held.push('X');
    if (g.spec.shooterStyle === 'lockOnStriker' && t % 3.8 < 1.5) held.push('X');
    if (g.spec.shooterStyle === 'weaponSwitch' && t % 4 < 0.06) held.push('X');
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
    g.invulnT = 99;
    g.update(1 / 60, input);
    g.engine.particles.update(1 / 60);
    previous = held;
    peaks.enemies = Math.max(peaks.enemies, g.foes.filter((f) => f.active).length);
    peaks.playerShots = Math.max(peaks.playerShots, g.pshots.filter((p) => p.active).length);
    peaks.enemyShots = Math.max(peaks.enemyShots, g.eshots.filter((p) => p.active).length);
  }
  return {
    title: g.spec.meta.title,
    style: g.spec.shooterStyle,
    stagesVisited: [...seen],
    outcome: g.result?.outcome,
    simulatedSeconds: frames / 60,
    peaks,
    invulnerablePilot: true,
    pass:
      g.result?.outcome === 'won' &&
      seen.size === 4 &&
      peaks.enemies <= 24 &&
      peaks.playerShots <= 8 &&
      peaks.enemyShots <= 48,
  };
}
