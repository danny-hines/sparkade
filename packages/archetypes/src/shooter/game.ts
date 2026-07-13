// Shooter gameplay (vertical scroller, Gradius/1943-like). Controls per SNES
// convention: d-pad move, Y fire (hold = autofire), X hold-then-release charge
// shot, B bomb, A speed toggle, START pause (host-owned).
import {
  makeScrollBackdrop,
  pickScrollVariant,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
  type ScrollBackdrop,
  type ScrollBackdropVariant,
} from '@sparkade/engine';
import {
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  difficultyScale,
  type DifficultyScale,
  type ShooterEnemyType,
  type ShooterLevel,
  type ShooterPath,
  type ShooterPickupType,
  type ShooterSpec,
  type ShooterWave,
} from '@sparkade/shared';
import { estimateShooterDurationS } from './lint';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const SPEED_LOW = 110;
const SPEED_HIGH = 170;
const MIN_Y = 30;
const MAX_Y = 290;
const FIRE_RATE = 8; // shots/s held
const RAPID_RATE = 12; // with the rapid pickup
const PLAYER_SHOT_SPEED = 340;
const MAX_NORMAL_SHOTS = 6; // autofire cap; the pool keeps 2 spare slots for charge shots
const CHARGE_TIME = 0.8;
const CHARGE_SHOT_SPEED = 300;
const CHARGE_DMG = 4;
const ENEMY_SHOT_SPEED = 110;
const BOSS_SHOT_SPEED = 90;
const START_BOMBS = 2;
const MAX_BOMBS = 4;
const BOMB_DMG = 3;
const PICKUP_FALL = 40;
const POD_FIRE_INTERVAL = 1.6;
const BOSS_ENTRANCE_S = 2;
const BOSS_Y = 70;
const KAMIKAZE_TRIGGER_Y = 120;
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
  baseX: number; // sine anchor
  t: number;
  hp: number;
  fireRate: number;
  fireT: number;
  state: number;
  holdY: number;
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
  baseX: number;
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

export function createShooterGame(engine: EngineContext, spec: ShooterSpec): GameInstance {
  return new ShooterGame(engine, spec);
}

class ShooterGame implements GameInstance {
  hud: HudState = { score: 0, lives: 3, health: 3, maxHealth: 3, keys: 0, bombs: START_BOMBS };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' = 'cards';
  private levelIndex = 0; // 0..2 levels, spec.levels.length = boss
  private level!: ShooterLevel;
  private backdrop!: ScrollBackdrop;
  /** One vertical-scroll scene for the whole game (levels vary only the seed, so
   *  layout differs but the theme stays consistent). Model-picked, else seeded. */
  private bgVariant: ScrollBackdropVariant;
  private scrollY = 0;
  private clock = 0;
  private lastWaveT = 0;
  private waveFired: boolean[] = [];
  private pickupFired: boolean[] = [];

  // pools (allocated once; BUDGET.maxActiveEntities = 24 enemies)
  private foes: Foe[] = Array.from({ length: 24 }, () => ({
    active: false, type: 'popcorn', path: 'dive', x: 0, y: 0, vx: 0, vy: 0, baseX: 0, t: 0,
    hp: 1, fireRate: 0, fireT: 0, state: ST_APPROACH, holdY: 0, holdT: 0, holdDur: 0,
    savedVx: 0, savedVy: 0, phase: 0, speedMul: 1, flashT: 0, chargeSeq: 0,
  }));
  private pshots: PShot[] = Array.from({ length: 8 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, pierce: false, seq: 0, t: 0,
  }));
  private eshots: EShot[] = Array.from({ length: 48 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, t: 0,
  }));
  private picks: Pick[] = Array.from({ length: 8 }, () => ({
    active: false, type: 'spread', x: 0, y: 0, baseX: 0, t: 0,
  }));

  // player (center-based; 4x4 hurt box)
  private px = W / 2;
  private py = MAX_Y - 20;
  private pvx = 0;
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

  // boss
  private boss: BossState | null = null;
  private pods: Pod[] = [];

  private sprites: Record<string, ResolvedSprite> = {};
  private pickupSprites: Record<ShooterPickupType, ResolvedSprite>;
  private foeDims: Record<ShooterEnemyType, { w: number; h: number }>;

  private diff!: DifficultyScale;

  constructor(
    private engine: EngineContext,
    private spec: ShooterSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.bgVariant = pickScrollVariant(this.spec.palette, this.spec.seed, this.spec.backdrop);
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
    const s = this.spec.story;
    const cards = s.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
    }));
    this.engine.cards.show(cards, () => this.enterLevel(0));
  }

  restart(): void {
    // Pause-menu Restart: current level from its start, full health, score/lives kept.
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
    this.backdrop = makeScrollBackdrop(this.spec.palette, this.spec.seed + ix * 101, this.bgVariant);
    this.scrollY = 0;
    this.clock = 0;
    this.lastWaveT = 0;
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
    this.backdrop = makeScrollBackdrop(this.spec.palette, this.spec.seed + 777, this.bgVariant);
    this.clearPools();
    this.spawnPlayer();
    const b = this.spec.boss;
    this.boss = {
      active: true,
      x: W / 2,
      y: -60,
      t: 0,
      hp: b.hp,
      maxHp: b.hp,
      phaseIx: 0,
      entranceT: 0,
      fireT: 0,
      burstLeft: 0,
      burstT: 0,
      spiralAngle: 0,
      flashT: 0,
      chargeSeq: 0,
    };
    const bossSprite = this.sprites['boss']!;
    this.pods = [];
    for (let i = 0; i < b.pods; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2) + 1;
      this.pods.push({
        alive: true,
        hp: b.podHp,
        ox: side * (bossSprite.w / 2 + 8 + (rank - 1) * 24),
        oy: 8 + (rank - 1) * 10,
        fireT: i * 0.4,
        flashT: 0,
        chargeSeq: 0,
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
    this.px = W / 2;
    this.py = MAX_Y - 20;
    this.pvx = 0;
    this.fireCd = 0;
    this.chargeT = 0;
    this.chargeReady = false;
    this.invulnT = 0;
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play') return;
    this.playT += dt;
    this.animT += dt;
    this.scrollY += (this.isBoss() ? 40 : this.level.scroll) * dt;

    this.updatePlayer(dt, input);
    if (this.phase !== 'play') return;
    if (!this.isBoss()) this.updateTimeline(dt);
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
    // d-pad move, clamped to the screen
    const ax = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    const ay = (input.UP.held ? -1 : 0) + (input.DOWN.held ? 1 : 0);
    const speed = this.fast ? SPEED_HIGH : SPEED_LOW;
    const norm = ax !== 0 && ay !== 0 ? 0.7071 : 1;
    this.pvx = ax * speed * norm;
    this.px = clamp(this.px + this.pvx * dt, 10, W - 10);
    this.py = clamp(this.py + ay * speed * norm * dt, MIN_Y, MAX_Y);

    // engine thruster puffs
    this.thrustT += dt;
    if (this.thrustT >= 0.07) {
      this.thrustT = 0;
      this.engine.particles.burst(this.px, this.py + 8, 1, {
        color: this.spec.palette[12], speed: 30, life: 0.22, gravity: 90, size: 2, angle: Math.PI / 2, spread: 0.6,
      });
    }

    // A: speed toggle
    if (input.A.pressed) {
      this.fast = !this.fast;
      this.engine.sfx.play('jump');
      this.engine.particles.burst(this.px, this.py + 6, 6, {
        color: this.spec.palette[this.fast ? 14 : 4], speed: 60, life: 0.3, gravity: 0,
      });
    }

    // Y: autofire
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (input.Y.held && this.fireCd <= 0) {
      if (this.fireNormalShot(this.px, this.py - 8, 0, -PLAYER_SHOT_SPEED)) {
        if (this.spread) {
          this.fireNormalShot(this.px - 5, this.py - 6, -70, -PLAYER_SHOT_SPEED * 0.92);
          this.fireNormalShot(this.px + 5, this.py - 6, 70, -PLAYER_SHOT_SPEED * 0.92);
        }
        this.fireCd = 1 / (this.rapid ? RAPID_RATE : FIRE_RATE);
        this.engine.sfx.play('shoot');
      }
    }

    // X: charge shot (hold >= 0.8s, release to fire a big piercing bolt)
    if (input.X.held) {
      this.chargeT += dt;
      if (this.chargeT >= CHARGE_TIME && !this.chargeReady) {
        this.chargeReady = true;
        this.engine.sfx.play('powerup');
      }
      this.glowT += dt;
      if (this.glowT >= 0.05) {
        this.glowT = 0;
        this.engine.particles.burst(this.px, this.py - 10, this.chargeReady ? 2 : 1, {
          color: this.spec.palette[this.chargeReady ? 15 : 7], speed: 26, life: 0.25, gravity: -70,
          size: this.chargeReady ? 3 : 2,
        });
      }
    } else if (this.chargeT > 0) {
      if (this.chargeT >= CHARGE_TIME) {
        this.chargeSeqCounter++;
        if (this.fireChargeShot(this.px, this.py - 10, 0, -CHARGE_SHOT_SPEED)) {
          this.engine.sfx.play('shoot');
          this.engine.shake(80, 1);
          this.engine.particles.burst(this.px, this.py - 12, 10, {
            color: this.spec.palette[15], speed: 90, life: 0.3, gravity: 0,
          });
        }
      } else {
        this.engine.particles.burst(this.px, this.py - 8, 3, {
          color: this.spec.palette[3], speed: 30, life: 0.2, gravity: 0,
        });
      }
      this.chargeT = 0;
      this.chargeReady = false;
    }

    // B: bomb
    if (input.B.pressed && this.hud.bombs > 0) this.detonateBomb();

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private detonateBomb(): void {
    this.hud.bombs--;
    // clear every enemy bullet
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.active = false;
      this.engine.particles.burst(s.x, s.y, 2, { color: this.spec.palette[14], speed: 50, life: 0.3, gravity: 0 });
    }
    // 3 damage to every enemy on screen
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
    this.engine.particles.burst(this.px, this.py - 20, 24, {
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

  private spawnWave(w: ShooterWave): void {
    const rng = this.engine.rng;
    const sweepDir = rng.chance(0.5) ? 1 : -1;
    const centerX = w.path === 'sweep'
      ? (sweepDir > 0 ? 80 : W - 80)
      : rng.range(120, W - 120);
    const width = Math.max(96, (w.count - 1) * 32);
    for (let i = 0; i < w.count; i++) {
      const e = this.claimFoe();
      if (!e) break; // budget: skip spawns beyond the 24-entity cap
      let ox = 0;
      let oy = 0;
      switch (w.formation) {
        case 'line':
          ox = (i - (w.count - 1) / 2) * 32;
          break;
        case 'vee': {
          const k = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
          ox = side * k * 26;
          oy = -k * 20;
          break;
        }
        case 'column':
          oy = -i * 36; // stacked above: they enter one by one
          break;
        case 'arc': {
          const f = w.count > 1 ? i / (w.count - 1) : 0.5;
          ox = (f - 0.5) * width;
          oy = -Math.sin(f * Math.PI) * 26;
          break;
        }
      }
      e.type = w.enemyType;
      e.path = w.path;
      e.x = clamp(centerX + ox, 14, W - 14);
      e.y = -16 + oy;
      e.baseX = e.x;
      e.t = 0;
      e.hp = Math.max(1, Math.round(w.hp * this.diff.hp));
      e.fireRate = w.fireRate * this.diff.fire;
      e.fireT = -rng.range(0, 0.8); // stagger the first volley
      e.state = ST_APPROACH;
      e.holdT = 0;
      e.phase = rng.range(0, Math.PI * 2);
      e.flashT = 0;
      e.chargeSeq = 0;
      e.speedMul = e.type === 'popcorn' ? 1.2 : e.type === 'tank' ? 0.6 : 1;
      switch (w.path) {
        case 'dive':
          e.vx = 0;
          e.vy = 70 * e.speedMul;
          break;
        case 'sweep':
          e.vx = sweepDir * 65 * e.speedMul;
          e.vy = 55 * e.speedMul;
          break;
        case 'sine':
          e.vx = 0;
          e.vy = 55 * e.speedMul;
          break;
        case 'hold':
          e.vx = 0;
          e.vy = 70 * e.speedMul;
          break;
      }
      // hold points: 'hold' path parks around y~90; turrets pause even on other paths
      if (w.path === 'hold') {
        e.holdY = 90 + rng.range(-14, 14);
        e.holdDur = 4;
      } else if (e.type === 'turret') {
        e.holdY = rng.range(60, 120);
        e.holdDur = 1.5;
      } else {
        e.holdY = -9999; // never triggers
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
      p.baseX = this.engine.rng.range(50, W - 50);
      p.x = p.baseX;
      p.y = -10;
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

      // kamikaze: below the trigger line, accelerate at the player
      if (e.type === 'kamikaze' && e.state === ST_APPROACH && e.y > KAMIKAZE_TRIGGER_Y) {
        e.state = ST_HOMING;
      }

      if (e.state === ST_HOLD) {
        e.holdT += dt;
        if (e.holdT >= e.holdDur) {
          e.state = ST_LEAVE;
          if (e.path === 'hold') {
            e.vx = 0;
            e.vy = 90 * e.speedMul;
          } else {
            e.vx = e.savedVx;
            e.vy = e.savedVy;
          }
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
        // approach / leave movement
        if (e.path === 'sine' && e.state === ST_APPROACH) {
          e.x = e.baseX + Math.sin(e.t * 2.4 + e.phase) * 42;
          e.y += e.vy * dt;
        } else {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
        // weaver: extra wobble on any path (bounded incremental offset — no drift)
        if (e.type === 'weaver') {
          e.x += (Math.sin(e.t * 6 + e.phase) - Math.sin(prevT * 6 + e.phase)) * 14;
        }
        // reach the hold point?
        if (e.state === ST_APPROACH && e.y >= e.holdY && e.holdDur > 0) {
          e.state = ST_HOLD;
          e.holdT = 0;
          e.savedVx = e.vx;
          e.savedVy = e.vy;
        }
      }

      // fire aimed shots at the player
      if (e.fireRate > 0) {
        const onScreen = e.y > 12 && e.y < 264 && e.x > 8 && e.x < W - 8;
        const gated = (e.type === 'turret' || e.path === 'hold') && e.state !== ST_HOLD;
        if (onScreen && !gated) {
          e.fireT += dt;
          const interval = 1 / e.fireRate;
          if (e.fireT >= interval) {
            e.fireT -= interval;
            this.fireEnemyAimed(e.x, e.y + 6, ENEMY_SHOT_SPEED, e.type === 'tank' ? 2 : 1);
            this.engine.sfx.play('shoot');
          }
        }
      }

      // off-screen culling (below / sides; spawns above are still inbound)
      if (e.y > H + 28 || e.x < -48 || e.x > W + 48) {
        e.active = false;
        continue;
      }

      // contact with the player
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
    this.engine.particles.burst(e.x, e.y, 10, { color: this.spec.palette[8], speed: 95, life: 0.45, gravity: 30 });
  }

  // ------------------------------------------------------------------- boss

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (!b.active) return;
    b.t += dt;
    b.flashT = Math.max(0, b.flashT - dt);
    const bossSprite = this.sprites['boss']!;

    // slow entrance from the top; invulnerable until parked
    if (b.entranceT < BOSS_ENTRANCE_S) {
      b.entranceT = Math.min(BOSS_ENTRANCE_S, b.entranceT + dt);
      b.y = -60 + (BOSS_Y + 60) * (b.entranceT / BOSS_ENTRANCE_S);
      b.x = W / 2;
      this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
      return;
    }
    b.x = W / 2 + Math.sin(b.t * 0.9) * 30;

    // phases by hp fraction (equal fractions)
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
        // 5-7 bullet arc aimed at the player
        if (b.fireT >= interval) {
          b.fireT -= interval;
          const n = 5 + this.engine.rng.int(0, 2);
          const aim = Math.atan2(this.py - b.y, this.px - b.x);
          for (let i = 0; i < n; i++) {
            const a = aim + ((i - (n - 1) / 2) * Math.PI) / 12;
            this.fireEnemyShot(b.x, b.y + 8, Math.cos(a) * spd, Math.sin(a) * spd, 1);
          }
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'spiral': {
        // continuous rotating emitter: one bullet each interval/3, +25° each
        const step = interval / 3;
        while (b.fireT >= step) {
          b.fireT -= step;
          b.spiralAngle += (25 * Math.PI) / 180;
          this.fireEnemyShot(b.x, b.y + 8, Math.cos(b.spiralAngle) * spd, Math.sin(b.spiralAngle) * spd, 1);
        }
        break;
      }
      case 'walls': {
        // horizontal bullet row with a 48px random gap
        if (b.fireT >= interval) {
          b.fireT -= interval;
          const gapX = this.engine.rng.range(30, W - 78);
          for (let bx = 14; bx < W; bx += 26) {
            if (bx > gapX && bx < gapX + 48) continue;
            this.fireEnemyShot(bx, b.y + 14, 0, spd, 1);
          }
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'aimed': {
        // 3-shot burst straight at the player
        if (b.burstLeft > 0) {
          b.burstT += dt;
          if (b.burstT >= 0.09) {
            b.burstT -= 0.09;
            b.burstLeft--;
            this.fireEnemyAimed(b.x, b.y + 8, spd * 1.15, 1);
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

    // pods: aimed shots every 1.6s until destroyed
    for (const pod of this.pods) {
      if (!pod.alive) continue;
      pod.flashT = Math.max(0, pod.flashT - dt);
      pod.fireT += dt;
      if (pod.fireT >= POD_FIRE_INTERVAL) {
        pod.fireT -= POD_FIRE_INTERVAL;
        this.fireEnemyAimed(b.x + pod.ox, b.y + pod.oy + 6, ENEMY_SHOT_SPEED, 1);
      }
    }

    // ramming the boss hurts
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
        const par = estimateShooterDurationS(this.spec) * 1.35;
        this.result = {
          outcome: 'won',
          score: this.hud.score,
          timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
        };
      },
    );
  }

  // ------------------------------------------------------------- projectiles

  /** Autofire shot, capped at MAX_NORMAL_SHOTS in flight. */
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
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.dmg = dmg;
      p.pierce = pierce;
      p.seq = seq;
      p.t = 0;
      return true;
    }
    return false;
  }

  private fireEnemyShot(x: number, y: number, vx: number, vy: number, dmg: number): boolean {
    for (const s of this.eshots) {
      if (s.active) continue;
      s.active = true;
      s.x = x;
      s.y = y;
      s.vx = vx;
      s.vy = vy;
      s.dmg = dmg;
      s.t = 0;
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
      if (p.y < -16 || p.x < -16 || p.x > W + 16) {
        p.active = false;
        continue;
      }
      const pw = p.pierce ? 12 : 6;
      const ph = p.pierce ? 16 : 10;

      // vs enemies
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

      // vs boss pods, then boss body (boss takes damage anytime after its entrance)
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
      if (s.y > H + 16 || s.y < -16 || s.x < -16 || s.x > W + 16) {
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
      p.y += PICKUP_FALL * dt;
      p.x = p.baseX + Math.sin(p.t * 2) * 24;
      if (p.y > H + 16) {
        p.active = false;
        continue;
      }
      if (!this.overlap(p.x, p.y, 12, 12, this.px, this.py, 14, 14)) continue;
      p.active = false;
      this.hud.score += this.spec.scoring.events.pickup;
      switch (p.type) {
        case 'spread':
          this.spread = true;
          this.engine.sfx.play('powerup');
          break;
        case 'rapid':
          this.rapid = true;
          this.engine.sfx.play('powerup');
          break;
        case 'shield':
          this.shieldUp = true;
          this.engine.sfx.play('powerup');
          break;
        case 'bomb':
          this.hud.bombs = Math.min(MAX_BOMBS, this.hud.bombs + 1);
          this.engine.sfx.play('pickup');
          break;
      }
      this.engine.particles.burst(p.x, p.y, 10, {
        color: this.spec.palette[13], speed: 60, life: 0.4, gravity: -20,
      });
    }
  }

  // ------------------------------------------------------------ damage/death

  private hurtPlayer(dmg: number): void {
    if (this.invulnT > 0) return;
    if (this.shieldUp) {
      // the shield absorbs one hit entirely
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
    // death always clears every bullet in flight
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
      // boss retry: boss keeps its hp; its patterns re-arm
      const b = this.boss;
      if (b) {
        b.fireT = 0;
        b.burstLeft = 0;
      }
    } else {
      // rewind to the last wave group: despawn enemies, re-arm waves at t >= that time
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

  /** Center-based AABB overlap — no per-frame allocations. */
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
    if (!this.backdrop) return; // pre-first-level intro cards

    // Vertical-scroll scene: the generator tiles its layers at H and parallaxes
    // them downward (reads as flying up) as scrollY grows.
    this.backdrop.draw(r.ctx, this.scrollY);

    // pickups
    for (const p of this.picks) {
      if (!p.active) continue;
      const sprite = this.pickupSprites[p.type];
      const img = this.engine.sprites.frame(sprite, 'idle', p.t);
      r.draw(img, p.x - sprite.w / 2, p.y - sprite.h / 2);
    }

    // player shots (under enemies)
    const projSprite = this.sprites['projectile']!;
    for (const p of this.pshots) {
      if (!p.active) continue;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t);
      if (p.pierce) {
        r.drawScaled(img, p.x - projSprite.w, p.y - projSprite.h, projSprite.w * 2, projSprite.h * 2);
      } else {
        r.draw(img, p.x - projSprite.w / 2, p.y - projSprite.h / 2);
      }
    }

    // enemies
    for (const e of this.foes) {
      if (!e.active) continue;
      const sprite = this.sprites[e.type]!;
      const img = e.flashT > 0
        ? sprite.flash[0]!
        : this.engine.sprites.frame(sprite, 'fly', e.t, e.vx < 0);
      r.draw(img, e.x - sprite.w / 2, e.y - sprite.h / 2);
    }

    // boss + pods
    const b = this.boss;
    if (b && b.active) {
      const sprite = this.sprites['boss']!;
      const img = b.flashT > 0 ? sprite.flash[0]! : this.engine.sprites.frame(sprite, 'idle', this.animT);
      r.draw(img, b.x - sprite.w / 2, b.y - sprite.h / 2);
      const podSprite = this.sprites['pod']!;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        const pimg = pod.flashT > 0 ? podSprite.flash[0]! : this.engine.sprites.frame(podSprite, 'fly', this.animT);
        r.draw(pimg, b.x + pod.ox - podSprite.w / 2, b.y + pod.oy - podSprite.h / 2);
      }
    }

    // enemy bullets on top for readability
    const shotSprite = this.sprites['enemyShot']!;
    for (const sh of this.eshots) {
      if (!sh.active) continue;
      const img = this.engine.sprites.frame(shotSprite, 'idle', sh.t);
      r.draw(img, sh.x - shotSprite.w / 2, sh.y - shotSprite.h / 2);
    }

    // ship (invulnerability flicker); 'bank' frame flipped by lean direction
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const banking = Math.abs(this.pvx) > 30;
      const img = banking
        ? this.engine.sprites.frame(hero, 'bank', this.animT, this.pvx < 0)
        : this.engine.sprites.frame(hero, 'idle', this.animT);
      r.draw(img, this.px - hero.w / 2, this.py - hero.h / 2);
      if (this.shieldUp) {
        r.frame(this.px - 11, this.py - 11, 22, 22, this.spec.palette[4] ?? '#41a6f6');
      }
      if (this.chargeT > 0.15) {
        const size = 10 + Math.min(1, this.chargeT / CHARGE_TIME) * 8;
        const color = this.chargeReady && Math.floor(this.animT * 10) % 2 === 0
          ? this.spec.palette[15]
          : this.spec.palette[7];
        r.frame(this.px - size / 2, this.py - size / 2, size, size, color ?? '#f4f4f4');
      }
    }
  }
}
