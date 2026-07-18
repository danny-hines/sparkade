// Horizontal shooter gameplay (R-Type / Gradius-like). The ship flies left→right
// through an AUTO-SCROLLING TILE STAGE built with the same tile system as the
// platformer: a ceiling and floor plus mid-field obstacle blocks, all SOLID.
// Everything lives in WORLD coordinates with an auto-scrolling camera; the ship
// AND the enemies collide with the terrain via the shared moveAABB (walls block,
// they don't merely damage), and shots die on walls. Reuses the vertical
// shooter's pools / boss engine / charge+bomb, flipped to the horizontal axis.
// Controls: d-pad move, Y fire (hold), X charge shot, B bomb, A speed toggle.
import {
  drawTileLayer,
  makeBackdrop,
  moveAABB,
  pickVariant,
  type AABB,
  type Backdrop,
  type BackdropVariant,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
  type Solidity,
  type TileGrid,
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
  type HShooterTileType,
  type ShooterEnemyType,
  type ShooterPath,
  type ShooterPickupType,
  type ShooterWave,
} from '@sparkade/shared';
import { estimateHShooterDurationS } from './lint';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const TILE = TILE_SIZE;
const SPEED_LOW = 120;
const SPEED_HIGH = 190;
const PLAYER_MIN_SX = 8; // ship's screen-x band (world x = scrollX + screen x)
const PLAYER_MAX_SX = W - 12; // can fly all the way to the front (right) edge
const PW = 12;
const PH = 10;
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
const BOSS_SX = W - 70;
const KAMIKAZE_TRIGGER_SX = W - 150;
const ECOLL = 5; // enemy terrain half-box
const ST_APPROACH = 0;
const ST_HOLD = 1;
const ST_LEAVE = 2;
const ST_HOMING = 3;

type TileKind = HShooterTileType;

interface Foe {
  active: boolean;
  type: ShooterEnemyType;
  path: ShooterPath;
  x: number; // WORLD center
  y: number;
  vx: number; // WORLD velocity
  vy: number;
  avoidVy: number; // terrain-avoidance steer (added on top of the pattern)
  stuckT: number; // time wedged against a wall (crash fallback)
  baseY: number;
  t: number;
  hp: number;
  fireRate: number;
  fireT: number;
  state: number;
  holdSX: number; // screen-x to park at (hold path)
  holdT: number;
  holdDur: number;
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
  avoidVy: number;
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
  x: number; // WORLD center
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
  enemy_shot: 'lib:proj_pellet',
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

  // tile stage
  private grid: { cols: number; rows: number; kind(x: number, y: number): TileKind } = {
    cols: 0, rows: 0, kind: () => 'empty',
  };
  private tileFrames: Record<string, HTMLCanvasElement[]> = {};

  private foes: Foe[] = Array.from({ length: 24 }, () => ({
    active: false, type: 'popcorn', path: 'dive', x: 0, y: 0, vx: 0, vy: 0, avoidVy: 0, stuckT: 0, baseY: 0, t: 0,
    hp: 1, fireRate: 0, fireT: 0, state: ST_APPROACH, holdSX: 0, holdT: 0, holdDur: 0,
    phase: 0, speedMul: 1, flashT: 0, chargeSeq: 0,
  }));
  private pshots: PShot[] = Array.from({ length: 8 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, pierce: false, seq: 0, t: 0,
  }));
  private eshots: EShot[] = Array.from({ length: 48 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, t: 0,
  }));
  private picks: Pick[] = Array.from({ length: 8 }, () => ({
    active: false, type: 'spread', x: 0, y: 0, avoidVy: 0, baseY: 0, t: 0,
  }));

  // player (WORLD center)
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
  private pbox: AABB = { x: 0, y: 0, w: PW, h: PH };
  private ebox: AABB = { x: 0, y: 0, w: ECOLL * 2, h: ECOLL * 2 };
  private pkbox: AABB = { x: 0, y: 0, w: 12, h: 12 };

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
      title: this.spec.meta.title, lines: [line], portrait: this.engine.portrait,
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

  // ---------------------------------------------------------- tile stage

  private buildGrid(tiles: string[], legend: Record<string, TileKind>): void {
    tiles = tiles ?? []; // tolerate a malformed/old spec rather than freeze
    legend = legend ?? {};
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 0;
    const kinds: TileKind[] = new Array(cols * rows).fill('empty');
    for (let y = 0; y < rows; y++) {
      const row = tiles[y] ?? '';
      for (let x = 0; x < cols; x++) {
        const ch = row[x] ?? '.';
        kinds[y * cols + x] = ch === '.' ? 'empty' : (legend[ch] ?? 'empty');
      }
    }
    this.grid = {
      cols, rows,
      kind: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 'empty' : kinds[y * cols + x]!),
    };
    const art: Record<string, string> = {
      solid: 'lib:tile_solid',
      hazard: 'lib:tile_hazard',
      decoration: 'lib:tile_deco',
    };
    this.tileFrames = {};
    for (const [kind, ref] of Object.entries(art)) {
      this.tileFrames[kind] = this.engine.sprites.byRole(ref.slice(4), ref, { bob: false }).frames;
    }
  }

  private solidity(tx: number, ty: number): Solidity {
    return this.grid.kind(tx, ty) === 'solid' ? 'solid' : 'empty';
  }

  private tileGrid(): TileGrid {
    return { cols: this.grid.cols, rows: this.grid.rows, tileSize: TILE, solidityAt: (x, y) => this.solidity(x, y) };
  }

  private solidAtWorld(wx: number, wy: number): boolean {
    return this.grid.kind(Math.floor(wx / TILE), Math.floor(wy / TILE)) === 'solid';
  }

  /** Do the ship's (slightly inset) box corners sit inside solid terrain? True
   *  only when it's been forced into a wall — normal flush contact leaves a gap. */
  private boxOverlapsSolid(cx: number, cy: number): boolean {
    for (const ox of [-(PW / 2) + 1, PW / 2 - 1]) {
      for (const oy of [-(PH / 2) + 1, PH / 2 - 1]) {
        if (this.grid.kind(Math.floor((cx + ox) / TILE), Math.floor((cy + oy) / TILE)) === 'solid') return true;
      }
    }
    return false;
  }

  /** Nearest open world-y at a world-x, searching out from a preferred y. */
  private openYAt(wx: number, preferY: number): number {
    const tx = Math.floor(wx / TILE);
    const ty = clamp(Math.floor(preferY / TILE), 0, this.grid.rows - 1);
    if (this.grid.kind(tx, ty) !== 'solid') return ty * TILE + TILE / 2;
    for (let d = 1; d < this.grid.rows; d++) {
      if (this.grid.kind(tx, ty - d) !== 'solid') return (ty - d) * TILE + TILE / 2;
      if (this.grid.kind(tx, ty + d) !== 'solid') return (ty + d) * TILE + TILE / 2;
    }
    return preferY;
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
    this.buildGrid(level.tiles, level.legend);
    this.scrollX = 0;
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
    // Open arena for the boss: a screen-sized grid of empty cells (NOT a 0-col
    // grid — moveAABB treats every tx >= cols as a solid wall, which would box
    // the ship in place).
    this.scrollX = 0;
    const cols = Math.ceil(W / TILE) + 4;
    const rows = Math.ceil(H / TILE);
    this.buildGrid(Array.from({ length: rows }, () => '.'.repeat(cols)), {});
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
    this.px = this.scrollX + 50;
    this.py = this.grid.cols > 0 ? this.openYAt(this.px, H / 2) : H / 2;
    this.pvy = 0;
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
    if (!this.isBoss()) this.scrollX += this.level.scroll * dt;
    this.engine.camera.snap(this.scrollX, 0);

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
    const inx = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    const iny = (input.UP.held ? -1 : 0) + (input.DOWN.held ? 1 : 0);
    const speed = this.fast ? SPEED_HIGH : SPEED_LOW;
    const norm = inx !== 0 && iny !== 0 ? 0.7071 : 1;
    this.pvy = iny * speed * norm;
    // Carry with the scroll (holds screen position), plus input; blocked by walls.
    const carry = this.isBoss() ? 0 : this.level.scroll * dt;
    const mvx = carry + inx * speed * norm * dt;
    const mvy = this.pvy * dt;
    this.pbox.x = this.px - PW / 2;
    this.pbox.y = this.py - PH / 2;
    const moved = moveAABB(this.tileGrid(), this.pbox, mvx, mvy);
    this.px = moved.x + PW / 2;
    this.py = clamp(moved.y + PH / 2, 6, H - 6);

    // Screen-x band: the ship may fly to either viewport edge (no damage for
    // reaching the back edge — it's just carried by the scroll).
    const sx = this.px - this.scrollX;
    if (sx > PLAYER_MAX_SX) this.px = this.scrollX + PLAYER_MAX_SX;
    else if (sx < PLAYER_MIN_SX) this.px = this.scrollX + PLAYER_MIN_SX;
    // CRUSH: if that clamp (or a scrolling wall) has squeezed the ship into
    // solid terrain — wedged between an obstacle and the screen edge — it dies.
    if (this.invulnT <= 0 && this.boxOverlapsSolid(this.px, this.py)) {
      this.killPlayer();
      if (this.phase !== 'play') return;
    }

    // thruster
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
    }

    // Y: autofire (rightward, world)
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
        }
      }
      this.chargeT = 0;
      this.chargeReady = false;
    }

    if (input.B.pressed && this.hud.bombs > 0) this.detonateBomb();

    // hazard tile under the ship
    if (this.invulnT <= 0 && this.grid.kind(Math.floor(this.px / TILE), Math.floor(this.py / TILE)) === 'hazard') {
      this.hurtPlayer(1);
      if (this.phase !== 'play') return;
    }

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private detonateBomb(): void {
    this.hud.bombs--;
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.active = false;
      this.engine.particles.burst(s.x, s.y, 2, { color: this.spec.palette[14], speed: 50, life: 0.3 });
    }
    for (const e of this.foes) {
      if (!e.active) continue;
      e.hp -= BOMB_DMG;
      e.flashT = 0.15;
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
        if (pod.hp <= 0) this.killPod(pod, b);
      }
    }
    this.engine.sfx.play('hit');
    this.engine.shake(400, 5);
    this.engine.hitStop(60);
    this.engine.particles.burst(this.px + 20, this.py, 24, {
      color: this.spec.palette[12], speed: 190, life: 0.6, size: 3,
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
    const centerY = w.path === 'sweep' ? (sweepDir > 0 ? 70 : H - 70) : this.openYAt(this.scrollX + W + 24, rng.range(60, H - 60));
    const height = Math.max(64, (w.count - 1) * 28);
    for (let i = 0; i < w.count; i++) {
      const e = this.claimFoe();
      if (!e) break;
      let ox = 0;
      let oy = 0;
      switch (w.formation) {
        case 'line': oy = (i - (w.count - 1) / 2) * 30; break;
        case 'vee': {
          const k = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
          oy = side * k * 24;
          ox = k * 22;
          break;
        }
        case 'column': ox = i * 34; break;
        case 'arc': {
          const f = w.count > 1 ? i / (w.count - 1) : 0.5;
          oy = (f - 0.5) * height;
          ox = Math.sin(f * Math.PI) * 26;
          break;
        }
      }
      e.type = w.enemyType;
      e.path = w.path;
      e.y = clamp(centerY + oy, 16, H - 16);
      e.x = this.scrollX + W + 16 + ox;
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
      e.avoidVy = 0;
      e.stuckT = 0;
      e.speedMul = e.type === 'popcorn' ? 1.2 : e.type === 'tank' ? 0.6 : 1;
      // WORLD velocities. Turrets are mounted (vx 0) so they scroll off with the
      // terrain; others drift left in world (= faster-left on screen).
      if (e.type === 'turret') {
        e.vx = 0;
        e.vy = 0;
      } else {
        switch (w.path) {
          case 'dive': e.vx = -70 * e.speedMul; e.vy = 0; break;
          case 'sweep': e.vx = -60 * e.speedMul; e.vy = sweepDir * -50 * e.speedMul; break;
          case 'sine': e.vx = -50 * e.speedMul; e.vy = 0; break;
          case 'hold': e.vx = -70 * e.speedMul; e.vy = 0; break;
        }
      }
      e.holdSX = w.path === 'hold' ? W * 0.62 + rng.range(-24, 24) : -9999;
      e.holdDur = w.path === 'hold' ? 4 : 0;
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
      p.baseY = this.openYAt(this.scrollX + W + 10, this.engine.rng.range(60, H - 60));
      p.y = p.baseY;
      p.x = this.scrollX + W + 10;
      p.avoidVy = 0;
      p.t = 0;
      return;
    }
  }

  // ---------------------------------------------------------------- enemies

  private moveFoe(e: Foe, dt: number): void {
    this.ebox.x = e.x - ECOLL;
    this.ebox.y = e.y - ECOLL;
    const px = e.x;
    const m = moveAABB(this.tileGrid(), this.ebox, e.vx * dt, (e.vy + e.avoidVy) * dt);
    e.x = m.x + ECOLL;
    e.y = m.y + ECOLL;
    if (m.hitY) { e.vy = 0; e.avoidVy = 0; }
    // wedged against a wall making no horizontal headway?
    if (m.hitX && Math.abs(e.x - px) < 0.4) e.stuckT += dt;
    else e.stuckT = Math.max(0, e.stuckT - dt * 3);
  }

  /** Steer vertically around a solid obstacle ahead, toward the nearer open
   *  side; decays back toward the authored motion once clear. Returns the new
   *  avoidVy. Shared by enemies AND pickups so both flow around terrain. */
  private terrainSteer(x: number, y: number, vx: number, avoidVy: number, dt: number): number {
    const dir = vx <= 0 ? -1 : 1;
    const ty = Math.floor(y / TILE);
    const aheadTx = Math.floor((x + dir * TILE * 1.5) / TILE);
    const hereTx = Math.floor(x / TILE);
    if (this.grid.kind(aheadTx, ty) === 'solid' || this.grid.kind(hereTx, ty) === 'solid') {
      let up = 99;
      let down = 99;
      for (let d = 1; d <= 9; d++) if (this.grid.kind(aheadTx, ty - d) !== 'solid') { up = d; break; }
      for (let d = 1; d <= 9; d++) if (this.grid.kind(aheadTx, ty + d) !== 'solid') { down = d; break; }
      return clamp(avoidVy + (up <= down ? -1 : 1) * 260 * dt, -155, 155);
    }
    return avoidVy * 0.9;
  }

  private avoidTerrain(e: Foe, dt: number): void {
    e.avoidVy = this.terrainSteer(e.x, e.y, e.vx, e.avoidVy, dt);
  }

  private crashFoe(e: Foe): void {
    e.active = false;
    this.engine.particles.burst(e.x, e.y, 8, { color: this.spec.palette[8], speed: 70, life: 0.4 });
  }

  private updateFoes(dt: number): void {
    for (const e of this.foes) {
      if (!e.active) continue;
      const prevT = e.t;
      e.t += dt;
      e.flashT = Math.max(0, e.flashT - dt);
      const sx = e.x - this.scrollX; // screen x

      if (e.type === 'kamikaze' && e.state === ST_APPROACH && sx < KAMIKAZE_TRIGGER_SX) e.state = ST_HOMING;

      // steer around terrain so a moving enemy never jams into an obstacle
      if (e.type !== 'turret' && e.state !== ST_HOLD && sx < W + 40) this.avoidTerrain(e, dt);

      if (e.type === 'turret') {
        // mounted: no self-movement (scrolls off with the terrain)
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
        if (sp > max) { e.vx = (e.vx / sp) * max; e.vy = (e.vy / sp) * max; }
        this.moveFoe(e, dt);
      } else {
        if (e.path === 'sine' && e.state === ST_APPROACH) {
          e.vy = (e.baseY + Math.sin(e.t * 2.4 + e.phase) * 42 - e.y) / Math.max(dt, 0.0001);
          this.moveFoe(e, dt);
          e.vy = 0;
        } else {
          this.moveFoe(e, dt);
        }
        if (e.type === 'weaver') e.y += (Math.sin(e.t * 6 + e.phase) - Math.sin(prevT * 6 + e.phase)) * 14;
        if (e.state === ST_APPROACH && sx <= e.holdSX && e.holdDur > 0) { e.state = ST_HOLD; e.holdT = 0; }
      }

      // last resort: if truly wedged (fully sealed pocket), crash it
      if (e.stuckT > 0.8) { this.crashFoe(e); continue; }

      // fire aimed shots
      if (e.fireRate > 0) {
        const onScreen = sx > 8 && sx < W - 4 && e.y > 8 && e.y < H - 8;
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

      if (sx < -48 || e.y < -48 || e.y > H + 48) { e.active = false; continue; }

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
    this.engine.particles.burst(e.x, e.y, 10, { color: this.spec.palette[8], speed: 95, life: 0.45 });
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
      b.x = this.scrollX + W + 60 - (W + 60 - BOSS_SX) * (b.entranceT / BOSS_ENTRANCE_S);
      b.y = H / 2;
      this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
      return;
    }
    b.x = this.scrollX + BOSS_SX;
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

    if (this.invulnT <= 0 && this.overlap(b.x, b.y, bossSprite.w - 8, bossSprite.h - 8, this.px, this.py, 4, 4)) {
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
    this.engine.particles.burst(b.x + pod.ox, b.y + pod.oy, 14, { color: this.spec.palette[9], speed: 110, life: 0.5 });
  }

  private defeatBoss(b: BossState): void {
    b.active = false;
    this.hud.boss = undefined;
    this.hud.score += this.spec.scoring.events.levelClear;
    const rng = this.engine.rng;
    for (let i = 0; i < 5; i++) {
      this.engine.particles.burst(b.x + rng.range(-24, 24), b.y + rng.range(-16, 16), 16, {
        color: this.spec.palette[i % 2 === 0 ? 12 : 14], speed: 170, life: 0.9, size: 3,
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
        this.result = { outcome: 'won', score: this.hud.score, timeBonusSeconds: Math.max(0, Math.round(par - this.playT)) };
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
      const sx = p.x - this.scrollX;
      if (sx > W + 16 || p.y < -16 || p.y > H + 16 || this.solidAtWorld(p.x, p.y)) { p.active = false; continue; }
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
      const sx = s.x - this.scrollX;
      if (sx < -16 || sx > W + 16 || s.y < -16 || s.y > H + 16 || this.solidAtWorld(s.x, s.y)) { s.active = false; continue; }
      if (this.invulnT <= 0 && this.overlap(s.x, s.y, 5, 5, this.px, this.py, 4, 4)) {
        s.active = false;
        this.hurtPlayer(s.dmg);
        if (this.phase !== 'play') return;
      }
    }
  }

  // ---------------------------------------------------------------- pickups

  private updatePickups(dt: number): void {
    const carry = this.isBoss() ? 0 : this.level.scroll;
    for (const p of this.picks) {
      if (!p.active) continue;
      p.t += dt;
      // smooth leftward drift + gentle bob, steering around terrain like enemies
      const vx = -(70 - carry);
      const bobVy = Math.cos(p.t * 2) * 34;
      p.avoidVy = this.terrainSteer(p.x, p.y, vx, p.avoidVy, dt);
      this.pkbox.x = p.x - 6;
      this.pkbox.y = p.y - 6;
      const m = moveAABB(this.tileGrid(), this.pkbox, vx * dt, (bobVy + p.avoidVy) * dt);
      p.x = m.x + 6;
      p.y = m.y + 6;
      if (p.x - this.scrollX < -16) { p.active = false; continue; }
      if (!this.overlap(p.x, p.y, 12, 12, this.px, this.py, 14, 14)) continue;
      p.active = false;
      this.hud.score += this.spec.scoring.events.pickup;
      switch (p.type) {
        case 'spread': this.spread = true; this.engine.sfx.play('powerup'); break;
        case 'rapid': this.rapid = true; this.engine.sfx.play('powerup'); break;
        case 'shield': this.shieldUp = true; this.engine.sfx.play('powerup'); break;
        case 'bomb': this.hud.bombs = Math.min(MAX_BOMBS, this.hud.bombs + 1); this.engine.sfx.play('pickup'); break;
      }
      this.engine.particles.burst(p.x, p.y, 10, { color: this.spec.palette[13], speed: 60, life: 0.4 });
    }
  }

  // ------------------------------------------------------------ damage/death

  private hurtPlayer(dmg: number): void {
    if (this.invulnT > 0) return;
    if (this.shieldUp) {
      this.shieldUp = false;
      this.invulnT = 0.8;
      this.engine.sfx.play('hit');
      this.engine.particles.burst(this.px, this.py, 12, { color: this.spec.palette[4], speed: 80, life: 0.4 });
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
    this.engine.particles.burst(this.px, this.py, 20, { color: this.spec.palette[5], speed: 130, life: 0.7 });
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
        () => { this.result = { outcome: 'lost', score: this.hud.score, timeBonusSeconds: 0 }; },
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
      for (let i = 0; i < waves.length; i++) if (waves[i]!.t >= this.lastWaveT) this.waveFired[i] = false;
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

  private overlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const r = this.engine.renderer;
    const cam = this.engine.camera;
    r.clear(this.spec.palette[2]);
    if (!this.backdrop) return;

    this.backdrop.draw(r.ctx, cam.x, cam.y);

    // tile stage
    const frameIx = Math.floor(this.animT * 4) % 2;
    drawTileLayer(r, cam, this.grid.cols, this.grid.rows, TILE, (tx, ty) => {
      const k = this.grid.kind(tx, ty);
      if (k === 'empty') return null;
      const frames = this.tileFrames[k];
      if (!frames || frames.length === 0) return null;
      return frames[frameIx % frames.length] ?? frames[0]!;
    });

    // pickups
    for (const p of this.picks) {
      if (!p.active) continue;
      const sprite = this.pickupSprites[p.type];
      const img = this.engine.sprites.frame(sprite, 'idle', p.t);
      r.draw(img, p.x - cam.x - sprite.w / 2, p.y - sprite.h / 2);
    }

    // player shots (rotated to travel right)
    const projSprite = this.sprites['projectile']!;
    for (const p of this.pshots) {
      if (!p.active) continue;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t);
      const s = p.pierce ? 2 : 1;
      this.drawRight(img, p.x - cam.x, p.y, projSprite.w * s, projSprite.h * s);
    }

    // enemies (flipped to face left)
    for (const e of this.foes) {
      if (!e.active) continue;
      const sprite = this.sprites[e.type]!;
      const img = e.flashT > 0 ? sprite.flash[0]! : this.engine.sprites.frame(sprite, 'fly', e.t, true);
      r.draw(img, e.x - cam.x - sprite.w / 2, e.y - sprite.h / 2);
    }

    // boss + pods
    const b = this.boss;
    if (b && b.active) {
      const sprite = this.sprites['boss']!;
      const img = b.flashT > 0 ? sprite.flash[0]! : this.engine.sprites.frame(sprite, 'idle', this.animT, true);
      r.draw(img, b.x - cam.x - sprite.w / 2, b.y - sprite.h / 2);
      const podSprite = this.sprites['pod']!;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        const pimg = pod.flashT > 0 ? podSprite.flash[0]! : this.engine.sprites.frame(podSprite, 'fly', this.animT, true);
        r.draw(pimg, b.x + pod.ox - cam.x - podSprite.w / 2, b.y + pod.oy - podSprite.h / 2);
      }
    }

    // enemy bullets on top
    const shotSprite = this.sprites['enemy_shot']!;
    for (const sh of this.eshots) {
      if (!sh.active) continue;
      const img = this.engine.sprites.frame(shotSprite, 'idle', sh.t);
      r.draw(img, sh.x - cam.x - shotSprite.w / 2, sh.y - shotSprite.h / 2);
    }

    // ship (rotated to face right; invuln flicker)
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const img = this.engine.sprites.frame(hero, 'idle', this.animT);
      const sxp = this.px - cam.x;
      this.drawRight(img, sxp, this.py, hero.w, hero.h);
      if (this.shieldUp) r.frame(sxp - 11, this.py - 11, 22, 22, this.spec.palette[4] ?? '#41a6f6');
      if (this.chargeT > 0.15) {
        const size = 10 + Math.min(1, this.chargeT / CHARGE_TIME) * 8;
        const color = this.chargeReady && Math.floor(this.animT * 10) % 2 === 0 ? this.spec.palette[15] : this.spec.palette[7];
        r.frame(sxp - size / 2, this.py - size / 2, size, size, color ?? '#f4f4f4');
      }
    }
  }

  /** Draw an up-facing library sprite rotated 90° clockwise so it points RIGHT. */
  private drawRight(img: CanvasImageSource, cx: number, cy: number, w: number, h: number): void {
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
