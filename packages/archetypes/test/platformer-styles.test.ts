import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LOGICAL_BUTTONS,
  type LogicalButton,
  type PlatformerPlayStyle,
  type PlatformerSpec,
  type PlatformerEntity,
} from '@sparkade/shared';
import type { EngineContext, GameInstance, HudState, InputSnapshot } from '@sparkade/engine';
import { platformerStyleExample } from '../src/platformer/examples';
import { createPlatformerGame } from '../src/platformer/game';
import { analyzePlatformerTraversal, lintPlatformer, reachableCells } from '../src/platformer/lint';
import type { TowerMotion } from '../src/platformer/tower-motion';

// Only raster preparation is replaced. Controller, collisions, damage, entity
// movement, checkpoint handling and the route validator are the production code.
vi.mock('@sparkade/engine', async (original) => ({
  ...(await original<typeof import('@sparkade/engine')>()),
  createSilhouetteAura: () => ({ rings: [] }),
  makeBackdrop: () => ({}),
}));

interface Entity {
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  type: string;
  invulnT: number;
}
interface Harness extends GameInstance {
  px: number;
  py: number;
  pvx: number;
  pvy: number;
  playerW: number;
  playerH: number;
  phase: string;
  levelIndex: number;
  invulnT: number;
  meleeT: number;
  onGround: boolean;
  charge: number;
  spec: PlatformerSpec;
  power: { projectile: boolean; shield: boolean };
  hud: HudState;
  checkpoint: { x: number; y: number } | null;
  boss: Entity | null;
  ents: Entity[];
  projs: {
    active: boolean;
    friendly: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    hitsLeft: number;
  }[];
  towerMotion: TowerMotion | null;
  updatePlayer(dt: number, input: InputSnapshot): void;
  makeEnt(entity: PlatformerEntity): Entity & { fireT: number };
  updateEntities(dt: number): void;
  updateBoss(dt: number): void;
  updateProjectiles(dt: number): void;
  enterBoss(withCard: boolean): void;
  enterLevel(index: number): void;
  spawnPlayer(x: number, y: number): void;
  hurtPlayer(): void;
}
const DT = 1 / 60;
function input(
  held: LogicalButton[] = [],
  pressed: LogicalButton[] = [],
  released: LogicalButton[] = [],
): InputSnapshot {
  return Object.fromEntries(
    LOGICAL_BUTTONS.map((button) => [
      button,
      {
        held: held.includes(button),
        pressed: pressed.includes(button),
        released: released.includes(button),
      },
    ]),
  ) as InputSnapshot;
}
function example(style: PlatformerPlayStyle): PlatformerSpec {
  const base = JSON.parse(
    readFileSync(join(__dirname, '../../generation/golden/golden-platformer.json'), 'utf8'),
  ) as PlatformerSpec;
  return platformerStyleExample(base, style);
}
function harness(style: PlatformerPlayStyle): Harness {
  const spec = example(style);
  const noop = () => undefined;
  const sprite = { w: 16, h: 16, frames: [], flipped: [] };
  const image = { width: 64, height: 64 };
  const engine = {
    spec,
    sprites: { byRole: () => sprite, byRef: () => sprite },
    platformerPoses: Object.fromEntries(
      ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'].map((p) => [p, image]),
    ),
    cards: { show: (_cards: unknown, done: () => void) => done() },
    sfx: { play: noop },
    music: { playJingle: noop, playSong: noop, stopSong: noop },
    particles: { burst: noop },
    camera: { x: 0, y: 0, snap: noop, follow: noop },
    rng: { next: () => 0.5, range: (a: number, b: number) => (a + b) / 2 },
    shake: noop,
    hitStop: noop,
  } as unknown as EngineContext;
  const game = createPlatformerGame(engine, spec) as Harness;
  game.start();
  return game;
}

describe('platformer packages in the real controller', () => {
  it('gives new encounter turrets a full visible interval before firing, including re-entry', () => {
    const g = harness('runAndGun');
    g.spec.encounterVersion = 1;
    g.enterBoss(false);
    g.px = 60;
    g.py = 60;
    const turret = g.makeEnt({ type: 'shooter', x: 7, y: 5, props: { fireIntervalMs: 2800 } });
    g.ents = [turret];
    turret.x = 2000;
    g.updateEntities(20);
    expect(turret.fireT).toBe(0);
    expect(g.projs.filter((p) => p.active)).toHaveLength(0);
    turret.x = 112;
    for (let i = 0; i < 150; i++) g.updateEntities(DT);
    expect(g.projs.filter((p) => p.active)).toHaveLength(0);
    for (let i = 0; i < 30; i++) g.updateEntities(DT);
    expect(g.projs.filter((p) => p.active && !p.friendly)).toHaveLength(1);
    turret.x = 2000;
    g.updateEntities(DT);
    turret.x = 112;
    g.updateEntities(DT);
    expect(turret.fireT).toBeLessThan(0.02);
  });

  it('keeps new chasers on their landing until the hero reaches their elevation', () => {
    const g = harness('runAndGun');
    g.spec.encounterVersion = 1;
    g.enterBoss(false);
    g.px = 80;
    g.py = 60;
    const chaser = g.makeEnt({ type: 'chaser', x: 12, y: 14, props: { speed: 1, range: 1 } });
    g.ents = [chaser];
    const start = chaser.x;
    for (let i = 0; i < 60; i++) g.updateEntities(DT);
    expect(chaser.x).toBe(start);
    g.py = 212;
    for (let i = 0; i < 20; i++) g.updateEntities(DT);
    expect(chaser.x).toBeLessThan(start - 10);
  });

  it.each(['meleeAction', 'runAndGun', 'towerClimber'] as const)(
    'preserves a readable final-phase boss opening for %s',
    (style) => {
      const g = harness(style);
      g.spec.encounterVersion = 1;
      g.spec.boss.phases.forEach((phase) => {
        phase.tempo = 2;
        phase.attacks = ['spread'];
      });
      g.enterBoss(false);
      const boss = g.boss! as Entity & { attack: { name: string; t: number; telegraph: number } };
      boss.hp = 1;
      g.px = 25;
      g.py = 200;
      g.updateBoss(0.9);
      expect(boss.attack.name).toBe('idle');
      g.updateBoss(0.6);
      expect(boss.attack.name).toBe('spread');
      expect(boss.attack.telegraph).toBeGreaterThanOrEqual(style === 'meleeAction' ? 0.7 : 0.6);
      g.updateBoss(boss.attack.telegraph - 0.01);
      expect(g.projs.some((p) => p.active)).toBe(false);
      g.updateBoss(0.02);
      expect(boss.attack.name).toBe('idle');
      if (style === 'meleeAction') expect(g.projs.filter((p) => p.active)).toHaveLength(3);
      g.updateBoss(0.9);
      expect(boss.attack.name).toBe('idle');
    },
  );

  it('equips the blaster at spawn, charges an upward shot, and keeps it after damage and respawn', () => {
    const g = harness('runAndGun');
    expect(g.power.projectile).toBe(true);
    for (let i = 0; i < 50; i++) g.updatePlayer(DT, input(['X', 'UP']));
    expect(g.projs.some((p) => p.active)).toBe(false);
    g.updatePlayer(DT, input(['UP'], [], ['X']));
    expect(g.projs.find((p) => p.active)).toMatchObject({
      friendly: true,
      vx: 0,
      vy: -280,
      damage: 3,
    });
    g.hurtPlayer();
    g.spawnPlayer(2, 12);
    expect(g.power.projectile).toBe(true);
    expect(g.charge).toBe(0);
  });

  it('lets conventional weapons fire on X without charging or a charge HUD', () => {
    const g = harness('runAndGun');
    g.spec.chargeShot = 'none';
    for (let i = 0; i < 50; i++) g.updatePlayer(DT, input(['X']));
    expect(g.charge).toBe(0);
    expect(g.projs.filter((p) => p.active).length).toBeGreaterThan(1);
    expect(g.projs.filter((p) => p.active).every((p) => p.damage === 1)).toBe(true);
    expect(g.hud.mechanic).toMatchObject({ label: 'BLASTER', value: 'FIRE' });
  });

  it('gives a full charge a wider collision area and exactly three enemy hits', () => {
    const g = harness('runAndGun');
    for (let i = 0; i < 50; i++) g.updatePlayer(DT, input(['X']));
    g.updatePlayer(DT, input([], [], ['X']));
    const p = g.projs.find((p) => p.active)!;
    const enemy = g.ents.find((e) => e.type === 'walker')!;
    g.ents = Array.from({ length: 4 }, () => ({
      ...enemy,
      active: true,
      x: p.x,
      y: p.y + 6,
      w: 3,
      h: 3,
    }));
    g.updateProjectiles(0);
    expect(g.ents.filter((e) => !e.active)).toHaveLength(3);
    expect(p.active).toBe(false);
    expect(p.damage).toBe(3);
  });

  it('applies the full charge damage to an actual boss collision', () => {
    const g = harness('runAndGun');
    g.enterBoss(false);
    for (let i = 0; i < 50; i++) g.updatePlayer(DT, input(['X']));
    g.updatePlayer(DT, input([], [], ['X']));
    const p = g.projs.find((p) => p.active)!;
    const boss = g.boss!;
    const hp = boss.hp;
    p.x = boss.x + boss.w / 2;
    p.y = boss.y + boss.h / 2;
    g.ents = [];
    g.updateProjectiles(0);
    expect(boss.hp).toBe(hp - 3);
  });

  it('prevents the blaster from firing through an adjacent solid wall', () => {
    const g = harness('runAndGun');
    g.enterBoss(false);
    // The default arena has a solid left column. The hero stands flush with it.
    g.px = 16;
    g.py = 200;
    g.updatePlayer(DT, input(['LEFT', 'Y']));
    expect(g.projs.some((p) => p.active)).toBe(false);
  });

  it('requires melee windup, deals damage once, and prevents recovery from being cancelled by another press', () => {
    const g = harness('meleeAction');
    g.enterBoss(false);
    const boss = g.boss!;
    g.px = boss.x - g.playerW - 12;
    g.py = boss.y + boss.h - g.playerH;
    g.onGround = true;
    const hp = boss.hp;
    g.updatePlayer(DT, input([], ['Y']));
    expect(boss.hp).toBe(hp);
    for (let i = 0; i < 8; i++) g.updatePlayer(DT, input());
    expect(boss.hp).toBe(hp - 2);
    boss.invulnT = 0;
    for (let i = 0; i < 12; i++) g.updatePlayer(DT, input([], ['Y']));
    expect(boss.hp).toBe(hp - 2);
    expect(g.meleeT).toBeGreaterThan(0);
    expect(g.meleeT).toBeLessThan(0.2);
  });

  it.each(['runAndGun', 'meleeAction'] as const)(
    'makes enemy contact hurt in %s even while descending',
    (style) => {
      const g = harness(style);
      const enemy = g.ents.find((e) => e.type === 'walker')!;
      g.px = enemy.x;
      g.py = enemy.y - g.playerH + 5;
      g.pvy = 100;
      const health = g.hud.health;
      g.updateEntities(0);
      expect(g.hud.health).toBe(health - 1);
      expect(enemy.active).toBe(true);
    },
  );

  it('keeps checking for new targets after the first active melee frame', () => {
    const g = harness('meleeAction');
    const enemy = g.ents.find((e) => e.type === 'walker')!;
    g.ents = [enemy];
    enemy.x = g.px + 120;
    g.updatePlayer(DT, input([], ['Y']));
    for (let i = 0; i < 9; i++) g.updatePlayer(DT, input());
    expect(enemy.active).toBe(true);
    enemy.x = g.px + g.playerW + 4;
    enemy.y = g.py + 5;
    g.updatePlayer(DT, input());
    expect(enemy.active).toBe(false);
  });

  it.each(['walker', 'shooter', 'flyer'])(
    'an active descending strike defeats a %s and bounces without contact damage',
    (type) => {
      const g = harness('meleeAction');
      const source = g.ents.find((e) => e.type === 'walker')!;
      const enemy = {
        ...source,
        type,
        x: g.px,
        y: 180,
        homeX: g.px,
        homeY: 180,
        props: { amplitude: 0 },
      };
      g.ents = [enemy];
      g.py = enemy.y - g.playerH + 3;
      g.pvy = 140;
      g.onGround = false;
      g.meleeT = 0.28;
      const health = g.hud.health;
      const score = g.hud.score;
      g.updateEntities(0);
      expect(enemy.active).toBe(false);
      expect(g.hud.health).toBe(health);
      expect(g.pvy).toBeLessThan(0);
      expect(g.py + g.playerH).toBeLessThan(enemy.y);
      expect(g.hud.score).toBe(score + g.spec.scoring.events.enemyKill);
    },
  );

  it.each([0, 0.4, 0.15])('landing outside the active strike still hurts (timer %s)', (timer) => {
    const g = harness('meleeAction');
    const enemy = g.ents.find((e) => e.type === 'walker')!;
    g.px = enemy.x;
    g.py = enemy.y - g.playerH + 3;
    g.pvy = 140;
    g.onGround = false;
    g.meleeT = timer;
    const health = g.hud.health;
    g.updateEntities(0);
    expect(g.hud.health).toBe(health - 1);
    expect(enemy.active).toBe(true);
  });

  it('an active landing strike damages the boss once and gives a safe bounce', () => {
    const g = harness('meleeAction');
    g.enterBoss(false);
    const boss = g.boss!;
    g.px = boss.x + boss.w / 2 - g.playerW / 2;
    g.py = boss.y - g.playerH + 3;
    g.pvy = 140;
    g.onGround = false;
    g.meleeT = 0.28;
    const health = g.hud.health,
      hp = boss.hp;
    g.updateBoss(0);
    expect(boss.hp).toBe(hp - 2);
    expect(g.hud.health).toBe(health);
    expect(g.pvy).toBeLessThan(0);
    boss.invulnT = 0;
    g.py = boss.y - g.playerH + 3;
    g.pvy = 140;
    g.updateBoss(0);
    expect(boss.hp).toBe(hp - 2);
    expect(g.hud.health).toBe(health);
  });

  it.each([0, 0.4, 0.15])('boss contact hurts without an active strike (timer %s)', (timer) => {
    const g = harness('meleeAction');
    g.enterBoss(false);
    const boss = g.boss!;
    g.px = boss.x;
    g.py = boss.y - g.playerH + 3;
    g.pvy = 140;
    g.onGround = false;
    g.meleeT = timer;
    const health = g.hud.health,
      hp = boss.hp;
    g.updateBoss(0);
    expect(boss.hp).toBe(hp);
    expect(g.hud.health).toBe(health - 1);
  });

  it('a strike does not protect the player from an enemy approaching behind', () => {
    const g = harness('meleeAction');
    const enemy = g.ents.find((e) => e.type === 'walker')!;
    g.ents = [enemy];
    enemy.x = g.px - enemy.w + 2;
    enemy.y = g.py;
    g.meleeT = 0.28;
    g.onGround = false;
    g.pvy = -50;
    const health = g.hud.health;
    g.updateEntities(0);
    expect(enemy.active).toBe(true);
    expect(g.hud.health).toBe(health - 1);
  });

  it('climbs the authored tower through physical wall contacts, reaches checkpoints and advances to the next level', () => {
    const g = harness('towerClimber');
    g.ents = []; // Isolate the traversal contract from combat and random timing.
    const start = g.py;
    let lastJump = -100;
    let climbed = 0;
    let checkpointSeen = false;
    for (let frame = 0; frame < 2400 && g.levelIndex === 0; frame++) {
      const jump =
        frame === 1 || (!!g.towerMotion?.wall && g.towerMotion.lock === 0 && frame - lastJump > 17);
      if (jump) lastJump = frame;
      g.update(DT, input(['RIGHT', 'Y', 'A'], jump ? ['A'] : []));
      climbed = Math.max(climbed, (start - g.py) / 16);
      checkpointSeen ||= g.checkpoint !== null;
    }
    expect(climbed).toBeGreaterThan(48);
    expect(checkpointSeen).toBe(true);
    expect(g.levelIndex).toBe(1);
  });
});

describe('armed climber combinations', () => {
  it('retains charge during a wall jump and does not cut the jump when the run button is released', () => {
    const g = harness('armedClimber');
    g.enterLevel(1);
    g.px = 64 - g.playerW;
    g.py = 930;
    g.onGround = false;
    g.charge = 0.8;
    g.updatePlayer(DT, input(['RIGHT', 'X', 'A'], ['A']));
    expect(g.charge).toBeGreaterThan(0.8);
    expect(g.pvx).toBeLessThan(0);
    expect(g.pvy).toBeLessThan(-200);
    g.updatePlayer(DT, input(['RIGHT', 'X', 'A'], [], ['B']));
    expect(g.pvy).toBeLessThan(-200);
  });
  it.each([
    [-1, 16, 280],
    [1, 48, -280],
  ])('fires away from wall side %s while keeping contact dangerous', (wall, x, velocity) => {
    const g = harness('armedClimber');
    if (wall < 0) g.enterBoss(false);
    else g.enterLevel(1);
    g.px = wall > 0 ? 64 - g.playerW : x;
    g.py = wall < 0 ? 150 : 930;
    g.onGround = false;
    g.charge = 1;
    g.updatePlayer(DT, input([wall < 0 ? 'LEFT' : 'RIGHT'], [], ['X']));
    expect(g.towerMotion?.wall).toBe(wall);
    expect(g.projs.find((p) => p.active)).toMatchObject({
      friendly: true,
      vx: velocity,
      damage: 3,
    });
    expect(g.power.projectile).toBe(true);
  });
  it('validates mixed stages and rejects silently replacing every stage with a horizontal course', () => {
    const spec = example('armedClimber');
    expect(lintPlatformer(spec)).toEqual([]);
    spec.levels[1] = structuredClone(spec.levels[0]!);
    expect(lintPlatformer(spec)).toContainEqual(
      expect.objectContaining({ code: 'PLAT_MIXED_STRUCTURE' }),
    );
  });
});

describe('tower generation contracts', () => {
  it('validates the reference tower with wall jumps, while ordinary jumps cannot reach its exit', () => {
    const spec = example('towerClimber');
    expect(lintPlatformer(spec)).toEqual([]);
    for (const level of spec.levels) {
      expect(reachableCells(level, 2).has(`${level.exit.x},${level.exit.y}`)).toBe(false);
      expect(
        analyzePlatformerTraversal(level, 2, { playStyle: 'towerClimber' }).reachable.has(
          `${level.exit.x},${level.exit.y}`,
        ),
      ).toBe(true);
    }
  });

  it('rejects a disconnected summit instead of assuming every tall wall can be climbed', () => {
    const spec = example('towerClimber');
    const level = spec.levels[0]!;
    // An overhang seals the wall approach, while spawn and exit remain supported.
    level.tiles[58] = '#'.repeat(4) + level.tiles[58]!.slice(4);
    expect(
      lintPlatformer(spec).some(
        (e) => e.code === 'PLAT_EXIT_UNREACHABLE' && e.path.startsWith('/levels/0'),
      ),
    ).toBe(true);
  });
});
