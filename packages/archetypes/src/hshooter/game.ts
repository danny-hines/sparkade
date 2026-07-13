// Horizontal shooter gameplay (R-Type / Gradius-like: the ship flies left→right
// through a scrolling terrain corridor with wave enemies, wall turrets, and a
// boss). Reuses the vertical shooter's proven pools / boss engine / charge+bomb,
// flipped to the horizontal axis, and adds a ceiling/floor terrain corridor
// (contact damages) with terrain-mounted turrets. Controls per SNES convention:
// d-pad move, Y fire (hold = autofire), X hold-then-release charge shot, B bomb,
// A speed toggle, START pause (host-owned).
import {
  makeBackdrop,
  pickVariant,
  type Backdrop,
  type BackdropVariant,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
} from '@sparkade/engine';
import {
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  difficultyScale,
  type DifficultyScale,
  type HShooterLevel,
  type HShooterSpec,
  type HShooterTurret,
  type ShooterEnemyType,
  type ShooterPath,
  type ShooterPickupType,
  type ShooterWave,
} from '@sparkade/shared';
import { estimateHShooterDurationS } from './lint';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const TILE = TILE_SIZE;
const SPEED_LOW = 110;
const SPEED_HIGH = 170;
const PLAYER_MIN_X = 14;
const PLAYER_MAX_X = W * 0.58;
const PLAYER_HALF = 6; // half hurt-box for terrain clamp
const FIRE_RATE = 8;
const RAPID_RATE = 12;
const PLAYER_SHOT_SPEED = 340;
const MAX_NORMAL_SHOTS = 6;
const CHARGE_TIME = 0.8;
const CHARGE_SHOT_SPEED = 320;
const CHARGE_DMG = 4;
const ENEMY_SHOT_SPEED = 110;
const BOSS_SHOT_SPEED = 90;
const START_BOMBS = 2;
const MAX_BOMBS = 4;
const BOMB_DMG = 3;
const POD_FIRE_INTERVAL = 1.6;
const BOSS_ENTRANCE_S = 2;
const BOSS_X = W - 70;
const KAMIKAZE_TRIGGER_X = W - 140;
// enemy states
const ST_APPROACH = 0;
const ST_HOLD = 1;
const ST_LEAVE = 2;
const ST_HOMING = 3;

interface Foe {
  active: boolean;
  type: ShooterEnemyType;
  path: ShooterPath;
  x: number; // center
  y: number;
  vx: number;
  vy: number;
  baseY: number; // sine anchor
  t: number;
  hp: number;
  fireRate: number;
  fireT: number;
  state: number;
  holdX: number;
  holdT: number;
  holdDur: number;
  savedVx: number;
  savedVy: number;
  phase: number;
  speedMul: number;
  flashT: number;
  chargeSeq: number;
}

interface PShot {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: boolean;
  seq: number;
  t: number;
}

interface EShot {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  t: number;
}

interface Pick {
  active: boolean;
  type: ShooterPickupType;
  x: number;
  y: number;
  baseY: number;
  t: number;
}

interface Pod {
  alive: boolean;
  hp: number;
  ox: number;
  oy: number;
  fireT: number;
  flashT: number;
  chargeSeq: number;
}

interface BossState {
  active: boolean;
  x: number;
  y: number;
  t: number;
  hp: number;
  maxHp: number;
  phaseIx: number;
  entranceT: number;
  fireT: number;
  burstLeft: number;
  burstT: number;
  spiralAngle: number;
  flashT: number;
  chargeSeq: number;
}

const ROLE_FALLBACK: Record<string, string> = {
  hero: 'lib:ship_dart',
  popcorn: 'lib:foe_popcorn',
  weaver: 'lib:foe_weaver',
  tank: 'lib:foe_tank',
  turret: 'lib:foe_turret',
  pod: 'lib:foe_turret',
  kamikaze: 'lib:foe_kamikaze',
  boss: 'lib:boss_leviathan',
  projectile: 'lib:proj_bolt',
  enemyShot: 'lib:proj_pellet',
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hitDims(s: ResolvedSprite): { w: number; h: number } {
  return { w: Math.max(8, s.w - 4), h: Math.max(8, s.h - 4) };
}

export function createHShooterGame(engine: EngineContext, spec: HShooterSpec): GameInstance {
  return new HShooterGame(engine, spec);
}

class HShooterGame implements GameInstance {
  hud: HudState = { score: 0, lives: 3, health: 3, maxHealth: 3, keys: 0, bombs: START_BOMBS };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' = 'cards';
  private levelIndex = 0;
  private level!: HShooterLevel;
  private backdrop!: Backdrop;
  private bgVariant: BackdropVariant;
  private scrollX = 0;
  private clock = 0;
  private lastWaveT = 0;
  private waveFired: boolean[] = [];
  private pickupFired: boolean[] = [];
  private turretIx = 0; // next terrain turret to scroll in

  private foes: Foe[] = Array.from({ length: 24 }, () => ({
    active: false, type: 'popcorn', path: 'dive', x: 0, y: 0, vx: 0, vy: 0, baseY: 0, t: 0,
    hp: 1, fireRate: 0, fireT: 0, state: ST_APPROACH, holdX: 0, holdT: 0, holdDur: 0,
    savedVx: 0, savedVy: 0, phase: 0, speedMul: 1, flashT: 0, chargeSeq: 0,
  }));
  private pshots: PShot[] = Array.from({ length: 8 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, pierce: false, seq: 0, t: 0,
  }));
  private eshots: EShot[] = Array.from({ length: 48 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, t: 0,
  }));
  private picks: Pick[] = Array.from({ length: 8 }, () => ({
    active: false, type: 'spread', x: 0, y: 0, baseY: 0, t: 0,
  }));

  // player (center-based)
  private px = 60;
  private py = H / 2;
  private pvy = 0;
  private fast = false;
  private fireCd = 0;
  private chargeT = 0;
  private chargeReady = false;
  private glowT = 0;
  private thrustT = 0;
  private invulnT = 0;
  private spread = false;
  private rapid = false;
  private shieldUp = false;
  private chargeSeqCounter = 0;
  private animT = 0;
  private playT = 0;

  private boss: BossState | null = null;
  private pods: Pod[] = [];

  private sprites: Record<string, ResolvedSprite> = {};
  private pickupSprites: Record<ShooterPickupType, ResolvedSprite>;
  private foeDims: Record<ShooterEnemyType, { w: number; h: number }>;
  private diff!: DifficultyScale;

  constructor(
    private engine: EngineContext,
    private spec: HShooterSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.bgVariant = pickVariant(this.spec.palette, this.spec.seed, this.spec.backdrop);
    for (const role of Object.keys(ROLE_FALLBACK)) {
      this.sprites[role] = engine.sprites.byRole(role, ROLE_FALLBACK[role]!);
    }
    this.pickupSprites = {
      spread: engine.sprites.byRole('pickup_spread', 'lib:pickup_spread'),
      rapid: engine.sprites.byRole('pickup_rapid', 'lib:pickup_rapid'),
      shield: engine.sprites.byRole('pickup_shield', 'lib:pickup_shield'),
      bomb: engine.sprites.byRole('pickup_bomb', 'lib:pickup_bomb'),
    };
    this.foeDims = {
      popcorn: hitDims(this.sprites['popcorn']!),
      weaver: hitDims(this.sprites['weaver']!),
      tank: hitDims(this.sprites['tank']!),
      turret: hitDims(this.sprites['turret']!),
      kamikaze: hitDims(this.sprites['kamikaze']!),
    };
  }

  start(): void {
    const cards = this.spec.story.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
    }));
    this.engine.cards.show(cards, () => this.enterLevel(0));
  }

  restart(): void {
    if (this.isBoss()) this.enterBoss(false);
    else this.loadLevel(this.levelIndex);
    this.hud.health = this.hud.maxHealth;
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  private isBoss(): boolean {
    return this.levelIndex >= this.spec.levels.length;
  }

  // -------------------------------------------------------------- level flow

  private enterLevel(ix: number): void {
    this.levelIndex = ix;
    if (ix >= this.spec.levels.length) {
      this.enterBoss(true);
      return;
    }
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show(
      [{ title: this.spec.levels[ix]!.name, lines: [this.spec.story.levelIntros[ix] ?? '...'], portrait: this.engine.portrait }],
      () => {
        this.loadLevel(ix);
        this.engine.music.playSong(this.spec.levels[ix]!.musicSong);
        this.phase = 'play';
      },
    );
  }

  private loadLevel(ix: number): void {
    const level = this.spec.levels[ix]!;
    this.level = level;
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + ix * 101, this.bgVariant);
    this.scrollX = 0;
    this.clock = 0;
    this.lastWaveT = 0;
    this.turretIx = 0;
    this.waveFired = level.waves.map(() => false);
    this.pickupFired = level.pickups.map(() => false);
    this.clearPools();
    this.boss = null;
    this.pods = [];
    this.hud.boss = undefined;
    this.spawnPlayer();
    this.engine.camera.snap(0, 0);
  }

  private enterBoss(withCard: boolean): void {
    this.levelIndex = this.spec.levels.length;
    const build = () => {
      this.buildBoss();
      this.engine.music.playSong('boss');
      this.phase = 'play';
    };
    if (withCard) {
      this.engine.cards.show(
        [{ title: this.spec.boss.name, lines: [this.spec.story.bossIntro], portrait: this.engine.portrait }],
        build,
      );
    } else build();
  }

  private buildBoss(): void {
    // Flat arena for the boss (level.terrain of the last level is ignored — the
    // boss room is open so its patterns aren't blocked by a corridor).
    this.level = { ...this.level, terrain: [], turrets: [] };
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + 777, this.bgVariant);
    this.clearPools();
    this.spawnPlayer();
    const b = this.spec.boss;
    this.boss = {
      active: true, x: W + 60, y: H / 2, t: 0, hp: b.hp, maxHp: b.hp, phaseIx: 0,
      entranceT: 0, fireT: 0, burstLeft: 0, burstT: 0, spiralAngle: 0, flashT: 0, chargeSeq: 0,
    };
    const bossSprite = this.sprites['boss']!;
    this.pods = [];
    for (let i = 0; i < b.pods; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2) + 1;
      this.pods.push({
        alive: true, hp: b.podHp,
        ox: -8 - (rank - 1) * 24,
        oy: side * (bossSprite.h / 2 + 6 + (rank - 1) * 12),
        fireT: i * 0.4, flashT: 0, chargeSeq: 0,
      });
    }
    this.hud.boss = { hp: b.hp, maxHp: b.hp, name: b.name };
    this.engine.camera.snap(0, 0);
  }

  private clearPools(): void {
    for (const f of this.foes) f.active = false;
    for (const p of this.pshots) p.active = false;
    for (const s of this.eshots) s.active = false;
    for (const p of this.picks) p.active = false;
  }

  private spawnPlayer(): void {
    this.px = 60;
    this.py = H / 2;
    this.pvy = 0;
    this.fireCd = 0;
    this.chargeT = 0;
    this.chargeReady = false;
    this.invulnT = 0;
  }

  // --------------------------------------------------------------- terrain

  /** Corridor bounds (pixels) at a world column, lerped from control points.
   *  Returns the ceiling depth from the top and the floor surface y. */
  private terrainAt(worldX: number): { ceilPx: number; floorPx: number } {
    const pts = this.level.terrain;
    if (!pts || pts.length === 0) return { ceilPx: 0, floorPx: H };
    const col = worldX / TILE;
    let ceil = pts[0]!.ceil;
    let floor = pts[0]!.floor;
    if (col <= pts[0]!.x) {
      ceil = pts[0]!.ceil;
      floor = pts[0]!.floor;
    } else if (col >= pts[pts.length - 1]!.x) {
      ceil = pts[pts.length - 1]!.ceil;
      floor = pts[pts.length - 1]!.floor;
    } else {
      for (let i = 1; i < pts.length; i++) {
        if (col <= pts[i]!.x) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          const f = (col - a.x) / Math.max(0.001, b.x - a.x);
          ceil = a.ceil + (b.ceil - a.ceil) * f;
          floor = a.floor + (b.floor - a.floor) * f;
          break;
        }
      }
    }
    return { ceilPx: ceil * TILE, floorPx: H - floor * TILE };
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play') return;
    this.playT += dt;
    this.animT += dt;
    this.scrollX += (this.isBoss() ? 0 : this.level.scroll) * dt;

    this.updatePlayer(dt, input);
    if (this.phase !== 'play') return;
    if (!this.isBoss()) {
      this.updateTimeline(dt);
      this.updateTurrets();
    }
    this.updateFoes(dt);
    if (this.phase !== 'play') return;
    if (this.boss) this.updateBoss(dt);
    if (this.phase !== 'play') return;
    this.updatePlayerShots(dt);
    if (this.phase !== 'play') return;
    this.updateEnemyShots(dt);
    if (this.phase !== 'play') return;
    this.updatePickups(dt);
    if (!this.isBoss()) this.checkLevelEnd();
  }

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const ax = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    const ay = (input.UP.held ? -1 : 0) + (input.DOWN.held ? 1 : 0);
    const speed = this.fast ? SPEED_HIGH : SPEED_LOW;
    const norm = ax !== 0 && ay !== 0 ? 0.7071 : 1;
    this.pvy = ay * speed * norm;
    this.px = clamp(this.px + ax * speed * norm * dt, PLAYER_MIN_X, PLAYER_MAX_X);
    this.py = clamp(this.py + this.pvy * dt, 10, H - 10);

    // terrain: clamp out of solid ceiling/floor, damage on contact
    const t = this.terrainAt(this.scrollX + this.px);
    const top = t.ceilPx + PLAYER_HALF;
    const bot = t.floorPx - PLAYER_HALF;
    if (bot > top) {
      const clamped = clamp(this.py, top, bot);
      if (clamped !== this.py) {
        this.py = clamped;
        if (this.invulnT <= 0) {
          this.hurtPlayer(1);
          if (this.phase !== 'play') return;
        }
      }
    }

    // engine thruster puffs (trailing left)
    this.thrustT += dt;
    if (this.thrustT >= 0.07) {
      this.thrustT = 0;
      this.engine.particles.burst(this.px - 8, this.py, 1, {
        color: this.spec.palette[12], speed: 30, life: 0.22, gravity: 0, size: 2, angle: Math.PI, spread: 0.6,
      });
    }

    if (input.A.pressed) {
      this.fast = !this.fast;
      this.engine.sfx.play('jump');
      this.engine.particles.burst(this.px - 6, this.py, 6, {
        color: this.spec.palette[this.fast ? 14 : 4], speed: 60, life: 0.3, gravity: 0,
      });
    }

    // Y: autofire (rightward)
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (input.Y.held && this.fireCd <= 0) {
      if (this.fireNormalShot(this.px + 8, this.py, PLAYER_SHOT_SPEED, 0)) {
        if (this.spread) {
          this.fireNormalShot(this.px + 6, this.py - 5, PLAYER_SHOT_SPEED * 0.92, -70);
          this.fireNormalShot(this.px + 6, this.py + 5, PLAYER_SHOT_SPEED * 0.92, 70);
        }
        this.fireCd = 1 / (this.rapid ? RAPID_RATE : FIRE_RATE);
        this.engine.sfx.play('shoot');
      }
    }

    // X: charge shot
    if (input.X.held) {
      this.chargeT += dt;
      if (this.chargeT >= CHARGE_TIME && !this.chargeReady) {
        this.chargeReady = true;
        this.engine.sfx.play('powerup');
      }
      this.glowT += dt;
      if (this.glowT >= 0.05) {
        this.glowT = 0;
        this.engine.particles.burst(this.px + 10, this.py, this.chargeReady ? 2 : 1, {
          color: this.spec.palette[this.chargeReady ? 15 : 7], speed: 26, life: 0.25, gravity: 0,
          size: this.chargeReady ? 3 : 2,
        });
      }
    } else if (this.chargeT > 0) {
      if (this.chargeT >= CHARGE_TIME) {
        this.chargeSeqCounter++;
        if (this.fireChargeShot(this.px + 10, this.py, CHARGE_SHOT_SPEED, 0)) {
          this.engine.sfx.play('shoot');
          this.engine.shake(80, 1);
          this.engine.particles.burst(this.px + 12, this.py, 10, {
            color: this.spec.palette[15], speed: 90, life: 0.3, gravity: 0,
          });
        }
      } else {
        this.engine.particles.burst(this.px + 8, this.py, 3, {
          color: this.spec.palette[3], speed: 30, life: 0.2, gravity: 0,
        });
      }
      this.chargeT = 0;
      this.chargeReady = false;
    }

    if (input.B.pressed && this.hud.bombs > 0) this.detonateBomb();

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private detonateBomb(): void {
    this.hud.bombs--;
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.active = false;
      this.engine.particles.burst(s.x, s.y, 2, { color: this.spec.palette[14], speed: 50, life: 0.3, gravity: 0 });
    }
    for (const e of this.foes) {
      if (!e.active) continue;
      e.hp -= BOMB_DMG;
      e.flashT = 0.15;
      this.engine.particles.burst(e.x, e.y, 4, { color: this.spec.palette[11], speed: 70, life: 0.35 });
      if (e.hp <= 0) this.killFoe(e);
    }
    const b = this.boss;
    if (b && b.active && b.entranceT >= BOSS_ENTRANCE_S) {
      b.hp -= BOMB_DMG;
      b.flashT = 0.15;
      this.hud.score += this.spec.scoring.events.bossHit;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        pod.hp -= BOMB_DMG;
        pod.flashT = 0.15;
        if (pod.hp <= 0) this.killPod(pod, b);
      }
    }
    this.engine.sfx.play('hit');
    this.engine.shake(400, 5);
    this.engine.hitStop(60);
    this.engine.particles.burst(this.px + 20, this.py, 24, {
      color: this.spec.palette[12], speed: 190, life: 0.6, gravity: 0, size: 3,
    });
  }

  // ------------------------------------------------------------- wave timeline

  private updateTimeline(dt: number): void {
    this.clock += dt;
    const level = this.level;
    for (let i = 0; i < level.waves.length; i++) {
      if (this.waveFired[i]) continue;
      const w = level.waves[i]!;
      if (this.clock >= w.t) {
        this.waveFired[i] = true;
        this.lastWaveT = Math.max(this.lastWaveT, w.t);
        this.spawnWave(w);
      }
    }
    for (let i = 0; i < level.pickups.length; i++) {
      if (this.pickupFired[i]) continue;
      const p = level.pickups[i]!;
      if (this.clock >= p.t) {
        this.pickupFired[i] = true;
        this.spawnPickup(p.type);
      }
    }
  }

  /** Scroll terrain turrets in from the right as the stage advances. */
  private updateTurrets(): void {
    const turrets = this.level.turrets;
    while (this.turretIx < turrets.length) {
      const tr = turrets[this.turretIx]!;
      const worldX = tr.x * TILE;
      if (worldX > this.scrollX + W + 20) break; // not yet on the horizon
      this.turretIx++;
      this.spawnTurret(tr, worldX);
    }
  }

  private spawnTurret(tr: HShooterTurret, worldX: number): void {
    const e = this.claimFoe();
    if (!e) return;
    const t = this.terrainAt(worldX);
    e.type = 'turret';
    e.path = 'dive';
    e.x = worldX - this.scrollX;
    e.y = tr.side === 'ceil' ? t.ceilPx + 8 : t.floorPx - 8;
    e.baseY = e.y;
    e.vx = -this.level.scroll; // ride the terrain
    e.vy = 0;
    e.t = 0;
    e.hp = Math.max(2, Math.round(3 * this.diff.hp));
    e.fireRate = 0.7 * this.diff.fire;
    e.fireT = -this.engine.rng.range(0, 1);
    e.state = ST_HOLD; // fires freely while on screen
    e.holdX = -9999;
    e.holdDur = 0;
    e.phase = 0;
    e.flashT = 0;
    e.chargeSeq = 0;
    e.speedMul = 1;
  }

  private spawnWave(w: ShooterWave): void {
    const rng = this.engine.rng;
    const sweepDir = rng.chance(0.5) ? 1 : -1;
    const centerY = w.path === 'sweep'
      ? (sweepDir > 0 ? 60 : H - 60)
      : rng.range(60, H - 60);
    const height = Math.max(64, (w.count - 1) * 28);
    for (let i = 0; i < w.count; i++) {
      const e = this.claimFoe();
      if (!e) break;
      let ox = 0;
      let oy = 0;
      switch (w.formation) {
        case 'line':
          oy = (i - (w.count - 1) / 2) * 30;
          break;
        case 'vee': {
          const k = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
          oy = side * k * 24;
          ox = k * 22; // arms trail to the right
          break;
        }
        case 'column':
          ox = i * 34; // enter one by one from the right
          break;
        case 'arc': {
          const f = w.count > 1 ? i / (w.count - 1) : 0.5;
          oy = (f - 0.5) * height;
          ox = Math.sin(f * Math.PI) * 26; // bow toward the player (left)
          break;
        }
      }
      e.type = w.enemyType;
      e.path = w.path;
      e.y = clamp(centerY + oy, 16, H - 16);
      e.x = W + 16 + ox;
      e.baseY = e.y;
      e.t = 0;
      e.hp = Math.max(1, Math.round(w.hp * this.diff.hp));
      e.fireRate = w.fireRate * this.diff.fire;
      e.fireT = -rng.range(0, 0.8);
      e.state = ST_APPROACH;
      e.holdT = 0;
      e.phase = rng.range(0, Math.PI * 2);
      e.flashT = 0;
      e.chargeSeq = 0;
      e.speedMul = e.type === 'popcorn' ? 1.2 : e.type === 'tank' ? 0.6 : 1;
      switch (w.path) {
        case 'dive':
          e.vx = -70 * e.speedMul;
          e.vy = 0;
          break;
        case 'sweep':
          e.vx = -65 * e.speedMul;
          e.vy = sweepDir * -55 * e.speedMul;
          break;
        case 'sine':
          e.vx = -55 * e.speedMul;
          e.vy = 0;
          break;
        case 'hold':
          e.vx = -70 * e.speedMul;
          e.vy = 0;
          break;
      }
      if (w.path === 'hold') {
        e.holdX = W * 0.62 + rng.range(-24, 24);
        e.holdDur = 4;
      } else {
        e.holdX = -9999;
        e.holdDur = 0;
      }
    }
  }

  private claimFoe(): Foe | null {
    for (const e of this.foes) if (!e.active) { e.active = true; return e; }
    return null;
  }

  private spawnPickup(type: ShooterPickupType): void {
    for (const p of this.picks) {
      if (p.active) continue;
      p.active = true;
      p.type = type;
      p.baseY = this.engine.rng.range(50, H - 50);
      p.y = p.baseY;
      p.x = W + 10;
      p.t = 0;
      return;
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateFoes(dt: number): void {
    for (const e of this.foes) {
      if (!e.active) continue;
      const prevT = e.t;
      e.t += dt;
      e.flashT = Math.max(0, e.flashT - dt);

      if (e.type === 'kamikaze' && e.state === ST_APPROACH && e.x < KAMIKAZE_TRIGGER_X) {
        e.state = ST_HOMING;
      }

      if (e.type === 'turret') {
        e.x += e.vx * dt; // ride the terrain leftward
      } else if (e.state === ST_HOLD) {
        e.holdT += dt;
        if (e.holdT >= e.holdDur) {
          e.state = ST_LEAVE;
          e.vx = -90 * e.speedMul;
          e.vy = 0;
        }
      } else if (e.state === ST_HOMING) {
        const dx = this.px - e.x;
        const dy = this.py - e.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        e.vx += (dx / len) * 240 * dt;
        e.vy += (dy / len) * 240 * dt;
        const sp = Math.hypot(e.vx, e.vy);
        const max = 220 * e.speedMul;
        if (sp > max) {
          e.vx = (e.vx / sp) * max;
          e.vy = (e.vy / sp) * max;
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        if (e.path === 'sine' && e.state === ST_APPROACH) {
          e.x += e.vx * dt;
          e.y = e.baseY + Math.sin(e.t * 2.4 + e.phase) * 42;
        } else {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
        if (e.type === 'weaver') {
          e.y += (Math.sin(e.t * 6 + e.phase) - Math.sin(prevT * 6 + e.phase)) * 14;
        }
        if (e.state === ST_APPROACH && e.x <= e.holdX && e.holdDur > 0) {
          e.state = ST_HOLD;
          e.holdT = 0;
        }
      }

      // fire aimed shots at the player
      if (e.fireRate > 0) {
        const onScreen = e.x > 8 && e.x < W - 4 && e.y > 8 && e.y < H - 8;
        const gated = e.type !== 'turret' && e.path === 'hold' && e.state !== ST_HOLD;
        if (onScreen && !gated) {
          e.fireT += dt;
          const interval = 1 / e.fireRate;
          if (e.fireT >= interval) {
            e.fireT -= interval;
            this.fireEnemyAimed(e.x - 6, e.y, ENEMY_SHOT_SPEED, e.type === 'tank' ? 2 : 1);
            this.engine.sfx.play('shoot');
          }
        }
      }

      // off-screen culling (left / top / bottom; right is inbound)
      if (e.x < -48 || e.y < -48 || e.y > H + 48) {
        e.active = false;
        continue;
      }

      const d = this.foeDims[e.type];
      if (this.invulnT <= 0 && this.overlap(e.x, e.y, d.w, d.h, this.px, this.py, 4, 4)) {
        this.hurtPlayer(1);
        if (e.type === 'popcorn' || e.type === 'weaver') {
          e.active = false;
          this.engine.particles.burst(e.x, e.y, 8, { color: this.spec.palette[8], speed: 80, life: 0.4 });
        }
        if (this.phase !== 'play') return;
      }
    }
  }

  private killFoe(e: Foe): void {
    e.active = false;
    this.hud.score += this.spec.scoring.events.enemyKill;
    this.engine.sfx.play('hit');
    this.engine.particles.burst(e.x, e.y, 10, { color: this.spec.palette[8], speed: 95, life: 0.45, gravity: 0 });
  }

  // ------------------------------------------------------------------- boss

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (!b.active) return;
    b.t += dt;
    b.flashT = Math.max(0, b.flashT - dt);
    const bossSprite = this.sprites['boss']!;

    if (b.entranceT < BOSS_ENTRANCE_S) {
      b.entranceT = Math.min(BOSS_ENTRANCE_S, b.entranceT + dt);
      b.x = W + 60 - (W + 60 - BOSS_X) * (b.entranceT / BOSS_ENTRANCE_S);
      b.y = H / 2;
      this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
      return;
    }
    b.y = H / 2 + Math.sin(b.t * 0.9) * 60;

    const phases = this.spec.boss.phases;
    const phaseIx = Math.min(phases.length - 1, Math.floor((1 - b.hp / b.maxHp) * phases.length));
    if (phaseIx !== b.phaseIx) {
      b.phaseIx = phaseIx;
      b.fireT = 0;
      b.burstLeft = 0;
      this.engine.shake(300, 4);
      this.engine.particles.burst(b.x, b.y, 20, { color: this.spec.palette[11], speed: 130, life: 0.6 });
    }
    const phase = phases[b.phaseIx]!;
    const interval = phase.fireIntervalMs / 1000;
    const spd = BOSS_SHOT_SPEED * phase.bulletSpeed;
    b.fireT += dt;

    switch (phase.pattern) {
      case 'fan': {
        if (b.fireT >= interval) {
          b.fireT -= interval;
          const n = 5 + this.engine.rng.int(0, 2);
          const aim = Math.atan2(this.py - b.y, this.px - b.x);
          for (let i = 0; i < n; i++) {
            const a = aim + ((i - (n - 1) / 2) * Math.PI) / 12;
            this.fireEnemyShot(b.x - 8, b.y, Math.cos(a) * spd, Math.sin(a) * spd, 1);
          }
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'spiral': {
        const step = interval / 3;
        while (b.fireT >= step) {
          b.fireT -= step;
          b.spiralAngle += (25 * Math.PI) / 180;
          this.fireEnemyShot(b.x, b.y, Math.cos(b.spiralAngle) * spd, Math.sin(b.spiralAngle) * spd, 1);
        }
        break;
      }
      case 'walls': {
        // vertical bullet column moving left with a random gap
        if (b.fireT >= interval) {
          b.fireT -= interval;
          const gapY = this.engine.rng.range(24, H - 72);
          for (let by = 12; by < H; by += 26) {
            if (by > gapY && by < gapY + 48) continue;
            this.fireEnemyShot(b.x - 14, by, -spd, 0, 1);
          }
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'aimed': {
        if (b.burstLeft > 0) {
          b.burstT += dt;
          if (b.burstT >= 0.09) {
            b.burstT -= 0.09;
            b.burstLeft--;
            this.fireEnemyAimed(b.x - 8, b.y, spd * 1.15, 1);
          }
        } else if (b.fireT >= interval) {
          b.fireT -= interval;
          b.burstLeft = 3;
          b.burstT = 0.09;
          this.engine.sfx.play('shoot');
        }
        break;
      }
    }

    for (const pod of this.pods) {
      if (!pod.alive) continue;
      pod.flashT = Math.max(0, pod.flashT - dt);
      pod.fireT += dt;
      if (pod.fireT >= POD_FIRE_INTERVAL) {
        pod.fireT -= POD_FIRE_INTERVAL;
        this.fireEnemyAimed(b.x + pod.ox - 6, b.y + pod.oy, ENEMY_SHOT_SPEED, 1);
      }
    }

    if (this.invulnT <= 0 &&
        this.overlap(b.x, b.y, bossSprite.w - 8, bossSprite.h - 8, this.px, this.py, 4, 4)) {
      this.hurtPlayer(1);
      if (this.phase !== 'play') return;
    }

    this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
    if (b.hp <= 0) this.defeatBoss(b);
  }

  private killPod(pod: Pod, b: BossState): void {
    pod.alive = false;
    this.hud.score += this.spec.scoring.events.bossHit;
    this.engine.sfx.play('hit');
    this.engine.shake(150, 2);
    this.engine.particles.burst(b.x + pod.ox, b.y + pod.oy, 14, {
      color: this.spec.palette[9], speed: 110, life: 0.5,
    });
  }

  private defeatBoss(b: BossState): void {
    b.active = false;
    this.hud.boss = undefined;
    this.hud.score += this.spec.scoring.events.levelClear;
    const rng = this.engine.rng;
    for (let i = 0; i < 5; i++) {
      this.engine.particles.burst(b.x + rng.range(-24, 24), b.y + rng.range(-16, 16), 16, {
        color: this.spec.palette[i % 2 === 0 ? 12 : 14], speed: 170, life: 0.9, gravity: 0, size: 3,
      });
    }
    this.engine.shake(600, 6);
    this.engine.hitStop(80);
    this.engine.sfx.play('hit');
    this.engine.music.stopSong();
    this.phase = 'cards';
    this.engine.cards.show(
      this.spec.story.victory.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
      () => {
        const par = estimateHShooterDurationS(this.spec) * 1.35;
        this.result = {
          outcome: 'won',
          score: this.hud.score,
          timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
        };
      },
    );
  }

  // ------------------------------------------------------------- projectiles

  private fireNormalShot(x: number, y: number, vx: number, vy: number): boolean {
    let normal = 0;
    for (const p of this.pshots) if (p.active && !p.pierce) normal++;
    if (normal >= MAX_NORMAL_SHOTS) return false;
    return this.claimPShot(x, y, vx, vy, 1, false, 0);
  }

  private fireChargeShot(x: number, y: number, vx: number, vy: number): boolean {
    return this.claimPShot(x, y, vx, vy, CHARGE_DMG, true, this.chargeSeqCounter);
  }

  private claimPShot(x: number, y: number, vx: number, vy: number, dmg: number, pierce: boolean, seq: number): boolean {
    for (const p of this.pshots) {
      if (p.active) continue;
      p.active = true;
      p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.dmg = dmg; p.pierce = pierce; p.seq = seq; p.t = 0;
      return true;
    }
    return false;
  }

  private fireEnemyShot(x: number, y: number, vx: number, vy: number, dmg: number): boolean {
    for (const s of this.eshots) {
      if (s.active) continue;
      s.active = true;
      s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.dmg = dmg; s.t = 0;
      return true;
    }
    return false;
  }

  private fireEnemyAimed(x: number, y: number, speed: number, dmg: number): void {
    const dx = this.px - x;
    const dy = this.py - y;
    const len = Math.max(1, Math.hypot(dx, dy));
    this.fireEnemyShot(x, y, (dx / len) * speed, (dy / len) * speed, dmg);
  }

  private updatePlayerShots(dt: number): void {
    const b = this.boss;
    const bossSprite = this.sprites['boss']!;
    for (const p of this.pshots) {
      if (!p.active) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x > W + 16 || p.y < -16 || p.y > H + 16) {
        p.active = false;
        continue;
      }
      const pw = p.pierce ? 16 : 10;
      const ph = p.pierce ? 12 : 6;

      for (const e of this.foes) {
        if (!e.active) continue;
        if (p.pierce && e.chargeSeq === p.seq) continue;
        const d = this.foeDims[e.type];
        if (!this.overlap(p.x, p.y, pw, ph, e.x, e.y, d.w, d.h)) continue;
        e.hp -= p.dmg;
        e.flashT = 0.1;
        if (p.pierce) e.chargeSeq = p.seq;
        else p.active = false;
        if (e.hp <= 0) this.killFoe(e);
        else this.engine.sfx.play('hit');
        if (!p.active) break;
      }

      if (p.active && b && b.active && b.entranceT >= BOSS_ENTRANCE_S) {
        for (const pod of this.pods) {
          if (!pod.alive) continue;
          if (p.pierce && pod.chargeSeq === p.seq) continue;
          if (!this.overlap(p.x, p.y, pw, ph, b.x + pod.ox, b.y + pod.oy, 12, 12)) continue;
          pod.hp -= p.dmg;
          pod.flashT = 0.1;
          if (p.pierce) pod.chargeSeq = p.seq;
          else p.active = false;
          if (pod.hp <= 0) this.killPod(pod, b);
          else this.engine.sfx.play('hit');
          if (!p.active) break;
        }
        if (p.active && !(p.pierce && b.chargeSeq === p.seq) &&
            this.overlap(p.x, p.y, pw, ph, b.x, b.y, bossSprite.w - 8, bossSprite.h - 8)) {
          b.hp -= p.dmg;
          b.flashT = 0.12;
          this.hud.score += this.spec.scoring.events.bossHit;
          this.engine.sfx.play('hit');
          this.engine.particles.burst(p.x, p.y, 5, { color: this.spec.palette[9], speed: 70, life: 0.3 });
          if (p.pierce) b.chargeSeq = p.seq;
          else p.active = false;
        }
      }
    }
  }

  private updateEnemyShots(dt: number): void {
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -16 || s.x > W + 16 || s.y < -16 || s.y > H + 16) {
        s.active = false;
        continue;
      }
      if (this.invulnT <= 0 && this.overlap(s.x, s.y, 5, 5, this.px, this.py, 4, 4)) {
        s.active = false;
        this.hurtPlayer(s.dmg);
        if (this.phase !== 'play') return;
      }
    }
  }

  // ---------------------------------------------------------------- pickups

  private updatePickups(dt: number): void {
    for (const p of this.picks) {
      if (!p.active) continue;
      p.t += dt;
      p.x -= 70 * dt; // drift left
      p.y = p.baseY + Math.sin(p.t * 2) * 24;
      if (p.x < -16) {
        p.active = false;
        continue;
      }
      if (!this.overlap(p.x, p.y, 12, 12, this.px, this.py, 14, 14)) continue;
      p.active = false;
      this.hud.score += this.spec.scoring.events.pickup;
      switch (p.type) {
        case 'spread': this.spread = true; this.engine.sfx.play('powerup'); break;
        case 'rapid': this.rapid = true; this.engine.sfx.play('powerup'); break;
        case 'shield': this.shieldUp = true; this.engine.sfx.play('powerup'); break;
        case 'bomb': this.hud.bombs = Math.min(MAX_BOMBS, this.hud.bombs + 1); this.engine.sfx.play('pickup'); break;
      }
      this.engine.particles.burst(p.x, p.y, 10, {
        color: this.spec.palette[13], speed: 60, life: 0.4, gravity: 0,
      });
    }
  }

  // ------------------------------------------------------------ damage/death

  private hurtPlayer(dmg: number): void {
    if (this.invulnT > 0) return;
    if (this.shieldUp) {
      this.shieldUp = false;
      this.invulnT = 0.8;
      this.engine.sfx.play('hit');
      this.engine.particles.burst(this.px, this.py, 12, {
        color: this.spec.palette[4], speed: 80, life: 0.4, gravity: 0,
      });
      return;
    }
    this.hud.health -= dmg;
    this.invulnT = FEEL.invulnMs / 1000;
    this.engine.sfx.play('hurt');
    this.engine.shake(FEEL.screenShakeMs, 3);
    this.engine.hitStop(FEEL.hitStopMs);
    if (this.hud.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    this.hud.lives--;
    this.engine.sfx.play('die');
    this.engine.particles.burst(this.px, this.py, 20, {
      color: this.spec.palette[5], speed: 130, life: 0.7,
    });
    for (const p of this.pshots) p.active = false;
    for (const s of this.eshots) s.active = false;
    this.chargeT = 0;
    this.chargeReady = false;

    if (this.hud.lives < 0) {
      this.phase = 'cards';
      this.hud.boss = undefined;
      this.engine.music.stopSong();
      this.engine.cards.show(
        this.spec.story.defeat.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
        () => {
          this.result = { outcome: 'lost', score: this.hud.score, timeBonusSeconds: 0 };
        },
      );
      return;
    }

    this.hud.health = this.hud.maxHealth;
    if (this.isBoss()) {
      const b = this.boss;
      if (b) { b.fireT = 0; b.burstLeft = 0; }
    } else {
      for (const e of this.foes) e.active = false;
      this.clock = this.lastWaveT;
      const waves = this.level.waves;
      for (let i = 0; i < waves.length; i++) {
        if (waves[i]!.t >= this.lastWaveT) this.waveFired[i] = false;
      }
    }
    this.spawnPlayer();
    this.invulnT = 2;
  }

  // -------------------------------------------------------------- level end

  private checkLevelEnd(): void {
    if (this.clock <= this.level.durationS) return;
    for (const e of this.foes) if (e.active) return;
    for (const s of this.eshots) if (s.active) return;
    this.hud.score += this.spec.scoring.events.levelClear;
    this.engine.sfx.play('win');
    this.engine.music.stopSong();
    this.phase = 'cards';
    this.enterLevel(this.levelIndex + 1);
  }

  // ---------------------------------------------------------------- helpers

  private overlap(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
  ): boolean {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const r = this.engine.renderer;
    r.clear(this.spec.palette[2]);
    if (!this.backdrop) return;

    // far backdrop scrolls horizontally with the stage
    this.backdrop.draw(r.ctx, this.scrollX, 0);

    // solid terrain corridor (ceiling + floor), scrolled
    this.drawTerrain(r);

    // pickups
    for (const p of this.picks) {
      if (!p.active) continue;
      const sprite = this.pickupSprites[p.type];
      const img = this.engine.sprites.frame(sprite, 'idle', p.t);
      r.draw(img, p.x - sprite.w / 2, p.y - sprite.h / 2);
    }

    // player shots
    const projSprite = this.sprites['projectile']!;
    for (const p of this.pshots) {
      if (!p.active) continue;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t);
      if (p.pierce) r.drawScaled(img, p.x - projSprite.w, p.y - projSprite.h, projSprite.w * 2, projSprite.h * 2);
      else r.draw(img, p.x - projSprite.w / 2, p.y - projSprite.h / 2);
    }

    // enemies (face left; sprites drawn flipped since library art points right/up)
    for (const e of this.foes) {
      if (!e.active) continue;
      const sprite = this.sprites[e.type]!;
      const img = e.flashT > 0 ? sprite.flash[0]! : this.engine.sprites.frame(sprite, 'fly', e.t, true);
      r.draw(img, e.x - sprite.w / 2, e.y - sprite.h / 2);
    }

    // boss + pods
    const b = this.boss;
    if (b && b.active) {
      const sprite = this.sprites['boss']!;
      const img = b.flashT > 0 ? sprite.flash[0]! : this.engine.sprites.frame(sprite, 'idle', this.animT, true);
      r.draw(img, b.x - sprite.w / 2, b.y - sprite.h / 2);
      const podSprite = this.sprites['pod']!;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        const pimg = pod.flashT > 0 ? podSprite.flash[0]! : this.engine.sprites.frame(podSprite, 'fly', this.animT, true);
        r.draw(pimg, b.x + pod.ox - podSprite.w / 2, b.y + pod.oy - podSprite.h / 2);
      }
    }

    // enemy bullets on top
    const shotSprite = this.sprites['enemyShot']!;
    for (const sh of this.eshots) {
      if (!sh.active) continue;
      const img = this.engine.sprites.frame(shotSprite, 'idle', sh.t);
      r.draw(img, sh.x - shotSprite.w / 2, sh.y - shotSprite.h / 2);
    }

    // ship (invuln flicker); banks vertically with lean
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const banking = Math.abs(this.pvy) > 30;
      const img = banking
        ? this.engine.sprites.frame(hero, 'bank', this.animT, this.pvy < 0)
        : this.engine.sprites.frame(hero, 'idle', this.animT);
      r.draw(img, this.px - hero.w / 2, this.py - hero.h / 2);
      if (this.shieldUp) r.frame(this.px - 11, this.py - 11, 22, 22, this.spec.palette[4] ?? '#41a6f6');
      if (this.chargeT > 0.15) {
        const size = 10 + Math.min(1, this.chargeT / CHARGE_TIME) * 8;
        const color = this.chargeReady && Math.floor(this.animT * 10) % 2 === 0
          ? this.spec.palette[15] : this.spec.palette[7];
        r.frame(this.px - size / 2, this.py - size / 2, size, size, color ?? '#f4f4f4');
      }
    }
  }

  /** Draw the scrolling ceiling/floor terrain as solid columns with a lit rim.
   *  Dark body + bright surface edge guarantees it reads against the backdrop. */
  private drawTerrain(r: EngineContext['renderer']): void {
    if (!this.level.terrain || this.level.terrain.length === 0) return;
    const body = this.spec.palette[1] ?? '#10122b';
    const band = this.spec.palette[3] ?? '#29366f';
    const rim = this.spec.palette[4] ?? '#41a6f6';
    for (let x = 0; x <= W; x += TILE) {
      const t = this.terrainAt(this.scrollX + x);
      if (t.ceilPx > 0) {
        r.rect(x, 0, TILE, t.ceilPx, body);
        r.rect(x, Math.max(0, t.ceilPx - 6), TILE, 6, band);
        r.rect(x, t.ceilPx - 2, TILE, 2, rim);
      }
      if (t.floorPx < H) {
        r.rect(x, t.floorPx, TILE, H - t.floorPx, body);
        r.rect(x, t.floorPx, TILE, 6, band);
        r.rect(x, t.floorPx, TILE, 2, rim);
      }
    }
  }
}
