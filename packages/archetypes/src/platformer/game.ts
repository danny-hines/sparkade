// Platformer gameplay (Mario-like). Controls per SNES convention:
// d-pad move/duck, B jump, X/Y run (+ throw with the projectile powerup),
// A spin jump, START pause (host-owned).
import {
  aabbOverlap,
  cellsUnder,
  drawTileLayer,
  makeBackdrop,
  moveAABB,
  type Backdrop,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
  type Solidity,
} from '@sparkade/engine';
import {
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  difficultyScale,
  resolveHeroFeel,
  type DifficultyScale,
  type Coord,
  type PlatformerEntity,
  type PlatformerLevel,
  type PlatformerSpec,
} from '@sparkade/shared';
import { surfaceDecorations } from './decor';
import {
  MOVING_PLATFORM_BODY,
  platformerDoorRect,
  platformerPlayerBody,
} from './geometry';
import { estimatePlatformerDurationS } from './lint';

const GRAV = 860;
const MAX_FALL = 330;
const WALK = 88;
const RUN = 142;
const ACCEL = 950;
const JUMP_V = -302;
const SPRING_V = -488;
const STOMP_BOUNCE = -230;
const SPIN_BOUNCE = -280;

type TileKind = 'empty' | 'solid' | 'platform' | 'hazard' | 'checkpoint' | 'exit' | 'decoration';

interface Ent {
  active: boolean;
  type: PlatformerEntity['type'];
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  homeX: number;
  homeY: number;
  dir: number;
  t: number;
  hp: number;
  fireT: number;
  props: NonNullable<PlatformerEntity['props']>;
  onGround: boolean;
}

interface Proj {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  friendly: boolean;
  grav: boolean;
  t: number;
}

interface BossAttackState {
  name: 'stomp' | 'charge' | 'spread' | 'summon' | 'idle';
  t: number;
  telegraph: number;
}

const ROLE_FALLBACK: Record<string, string> = {
  hero: 'lib:hero_squire',
  walker: 'lib:enemy_walker',
  flyer: 'lib:enemy_flyer',
  shooter: 'lib:enemy_shooter',
  chaser: 'lib:enemy_chaser',
  boss: 'lib:boss_titan',
  coin: 'lib:pickup_coin',
  heart: 'lib:pickup_heart',
  powerup: 'lib:pickup_power',
  projectile: 'lib:proj_orb',
  enemy_projectile: 'lib:proj_pellet',
  obj_platform: 'lib:obj_platform',
};

export function createPlatformerGame(engine: EngineContext, spec: PlatformerSpec): GameInstance {
  return new PlatformerGame(engine, spec);
}

class PlatformerGame implements GameInstance {
  hud: HudState = { score: 0, lives: 3, health: 3, maxHealth: 3, keys: 0, bombs: 0 };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' | 'over' = 'cards';
  private levelIndex = 0; // 0..2 levels, 3 = boss arena
  private level!: PlatformerLevel;
  private grid!: { cols: number; rows: number; kind(x: number, y: number): TileKind };
  private tileCanvases = new Map<string, HTMLCanvasElement[]>();
  private decorations: Coord[] = [];
  private backdrop!: Backdrop;
  private ents: Ent[] = [];
  private projs: Proj[] = Array.from({ length: 16 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, friendly: false, grav: false, t: 0,
  }));

  // player
  private px = 0;
  private py = 0;
  private playerW = 10;
  private playerH = 14;
  private pvx = 0;
  private pvy = 0;
  private facing = 1;
  private onGround = false;
  private coyoteT = 0;
  private jumpBufT = 0;
  private spinning = false;
  private airJumpUsed = false;
  private invulnT = 0;
  private throwCooldown = 0;
  private power = { doubleJump: false, projectile: false, shield: false };
  private checkpoint: { x: number; y: number } | null = null;
  private animT = 0;
  private playT = 0;

  // boss
  private boss: (Ent & { attack: BossAttackState; phaseIx: number; invulnT: number; maxHp: number }) | null = null;

  private sprites: Record<string, ResolvedSprite> = {};
  private diff!: DifficultyScale;
  // Per-game hero feel, resolved (clamped) from spec.feel. Base constants when
  // feel is absent, so existing games are byte-identical. The clamp only ever
  // raises reach (floatier/higher/faster), so the reachability lint stays valid.
  private grav = GRAV;
  private jumpV = JUMP_V;
  private run = RUN;
  private walk = WALK;
  private accel = ACCEL;

  constructor(
    private engine: EngineContext,
    private spec: PlatformerSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    const feel = resolveHeroFeel(this.spec.feel);
    this.grav = GRAV * feel.gravity;
    this.jumpV = JUMP_V * feel.jump;
    this.run = RUN * feel.speed;
    this.walk = WALK * feel.speed;
    this.accel = ACCEL * feel.speed;
    for (const role of Object.keys(ROLE_FALLBACK)) {
      this.sprites[role] = engine.sprites.byRole(
        role,
        ROLE_FALLBACK[role]!,
        role === 'hero'
          ? { presentation: 'tall-humanoid' }
          : role === 'obj_platform'
            ? { bob: false, anchorOpaqueTop: true }
            : {},
      );
    }
    const body = platformerPlayerBody(
      this.spec.playerHeightTiles,
      this.sprites['hero']?.appliedPresentation === 'tall-humanoid',
    );
    this.playerW = body.w;
    this.playerH = body.h;
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
    this.checkpoint = null;
    if (this.levelIndex >= 3) this.enterBoss(false);
    else this.loadLevel(this.levelIndex);
    this.hud.health = this.hud.maxHealth;
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  // -------------------------------------------------------------- level flow

  private enterLevel(ix: number): void {
    this.levelIndex = ix;
    if (ix >= 3) {
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
    this.buildGrid(level.tiles, level.legend);
    this.decorations = surfaceDecorations(level, this.spec.seed + ix * 101 + 0xdec0);
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + ix * 101, this.spec.backdrop);
    this.ents = level.entities.map((e) => this.makeEnt(e));
    this.boss = null;
    for (const p of this.projs) p.active = false;
    this.checkpoint = null;
    this.spawnPlayer(level.playerSpawn.x, level.playerSpawn.y);
    this.engine.camera.snap(
      Math.max(0, this.playerCenterX() - INTERNAL_WIDTH / 2),
      Math.max(0, this.playerCenterY() - INTERNAL_HEIGHT / 2),
    );
  }

  private enterBoss(withCard: boolean): void {
    this.levelIndex = 3;
    const build = () => {
      this.buildBossArena();
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

  private defaultArenaTiles(): string[] {
    // Hand-built arena: 34 tiles wide, walls, flat floor, two side platforms.
    const cols = 34;
    const rows = 17;
    const tiles: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const wall = x === 0 || x === cols - 1;
        const floor = y >= rows - 2;
        const plat = (y === rows - 6 && (x >= 4 && x <= 8)) || (y === rows - 6 && x >= cols - 9 && x <= cols - 5);
        row += wall || floor ? '#' : plat ? '=' : '.';
      }
      tiles.push(row);
    }
    return tiles;
  }

  private buildBossArena(): void {
    // Use the model's custom arena when it authored one, else the default. The
    // arena lint guarantees side walls + a solid bottom-two-rows floor, so the
    // fixed player/boss spawns below stay valid; the spawn also self-lifts out
    // of solid as a safety net.
    const custom = this.spec.boss.arena;
    const tiles = custom?.tiles?.length ? custom.tiles : this.defaultArenaTiles();
    const legend = custom?.tiles?.length ? custom.legend : { '#': 'solid', '=': 'platform' };
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 34;
    this.buildGrid(tiles, legend);
    this.decorations = [];
    // Boss arena keeps its 'caves' fallback (matching pre-backdrop-field behavior) so
    // published games without a `backdrop` field render identically; an explicit spec
    // backdrop now carries into the boss fight too. Do NOT drop the fallback to match
    // loadLevel — that would repaint every legacy game's boss arena.
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + 777, this.spec.backdrop ?? 'caves');
    this.ents = [];
    for (const p of this.projs) p.active = false;
    this.checkpoint = null;
    this.spawnPlayer(3, rows - 3);
    const bossSprite = this.sprites['boss']!;
    this.boss = {
      active: true,
      type: 'walker',
      x: (cols - 6) * TILE_SIZE,
      y: (rows - 2) * TILE_SIZE - bossSprite.h,
      vx: 0,
      vy: 0,
      w: bossSprite.w - 6,
      h: bossSprite.h - 2,
      homeX: 0,
      homeY: 0,
      dir: -1,
      t: 0,
      hp: this.spec.boss.hp,
      maxHp: this.spec.boss.hp,
      fireT: 0,
      props: {},
      onGround: true,
      attack: { name: 'idle', t: 0, telegraph: 0 },
      phaseIx: 0,
      invulnT: 0,
    };
    this.hud.boss = { hp: this.boss.hp, maxHp: this.boss.maxHp, name: this.spec.boss.name };
    this.engine.camera.snap(0, rows * TILE_SIZE - INTERNAL_HEIGHT);
  }

  private buildGrid(tiles: string[], legend: Record<string, string>): void {
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 0;
    const kinds: TileKind[] = new Array(cols * rows).fill('empty');
    for (let y = 0; y < rows; y++) {
      const row = tiles[y]!;
      for (let x = 0; x < cols; x++) {
        const ch = row[x] ?? '.';
        const authored = ch === '.' ? 'empty' : ((legend[ch] as TileKind | undefined) ?? 'empty');
        // Exit placement and decoration are engine-owned. Treat legacy/model
        // grid markers as empty so they cannot create duplicate doors or
        // floating scenery; deterministic surface decor is drawn separately.
        kinds[y * cols + x] = authored === 'exit' || authored === 'decoration' ? 'empty' : authored;
      }
    }
    this.grid = {
      cols,
      rows,
      kind: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 'empty' : kinds[y * cols + x]!),
    };
    // Pre-resolve tile art per kind.
    const art: Record<string, string> = {
      solid: 'lib:tile_solid',
      platform: 'lib:tile_platform',
      hazard: 'lib:tile_hazard',
      checkpoint: 'lib:tile_checkpoint',
      exit: 'lib:tile_exit',
      decoration: 'lib:tile_deco',
    };
    this.tileCanvases.clear();
    for (const [kind, ref] of Object.entries(art)) {
      // Reskinnable terrain: assign role = the default lib id (e.g. "tile_solid":
      // "lib:ice_solid" or a custom 16x16). bob:false keeps tiles still.
      this.tileCanvases.set(kind, this.engine.sprites.byRole(ref.slice(4), ref, { bob: false }).frames);
    }
  }

  /**
   * Climb a tile coordinate up out of any `solid` tiles. The model authors the
   * terrain (ASCII grid) and the entity/spawn coordinates ({x,y}) as two
   * independent representations that nothing reconciles, so they occasionally
   * collide — a pickup or the player dropped inside solid terrain is unreachable
   * (moveAABB never lets the player enter a solid cell) or immovable. Lifting to
   * the nearest open cell above keeps the game playable regardless of the spec.
   * Platforms are one-way (passable), so they never trap and aren't lifted past.
   */
  private liftOutOfSolid(tx: number, ty: number): number {
    let y = ty;
    while (y > 0 && this.grid.kind(tx, y) === 'solid') y--;
    return y;
  }

  private playerCellOpen(tx: number, ty: number): boolean {
    const kind = this.grid.kind(tx, ty);
    return kind !== 'solid' && kind !== 'platform' && kind !== 'hazard';
  }

  /** Lift a marked 16x32 player until both occupied tile rows are clear. */
  private liftPlayerOutOfTerrain(tx: number, footTy: number): number {
    if (this.playerH <= TILE_SIZE) return this.liftOutOfSolid(tx, footTy);
    let y = footTy;
    while (y > 0 && (!this.playerCellOpen(tx, y) || !this.playerCellOpen(tx, y - 1))) y--;
    return y;
  }

  private playerBox(): { x: number; y: number; w: number; h: number } {
    return { x: this.px, y: this.py, w: this.playerW, h: this.playerH };
  }

  private playerCenterX(): number {
    return this.px + this.playerW / 2;
  }

  private playerCenterY(): number {
    return this.py + this.playerH / 2;
  }

  private playerBottom(): number {
    return this.py + this.playerH;
  }

  private makeEnt(e: PlatformerEntity): Ent {
    const small = e.type === 'coin' || e.type === 'heart' || e.type === 'powerup';
    const movingPlatform = e.type === 'movingPlatform';
    const ey = this.liftOutOfSolid(e.x, e.y);
    const inset = small ? 2 : movingPlatform ? 0 : 1;
    return {
      active: true,
      type: e.type,
      x: e.x * TILE_SIZE + inset,
      y: ey * TILE_SIZE + inset,
      vx: 0,
      vy: 0,
      w: movingPlatform ? MOVING_PLATFORM_BODY.w : small ? 12 : 14,
      h: movingPlatform ? MOVING_PLATFORM_BODY.h : small ? 12 : 14,
      homeX: e.x * TILE_SIZE,
      homeY: ey * TILE_SIZE,
      dir: e.props?.dir ?? -1,
      t: 0,
      hp: 1,
      fireT: 0,
      props: e.props ?? {},
      onGround: false,
    };
  }

  private spawnPlayer(tx: number, ty: number): void {
    // Coordinates identify the lower/feet cell. Lift invalid placements out
    // of terrain, then bottom-align the two-tile body to its supporting cell.
    const sy = this.liftPlayerOutOfTerrain(tx, ty);
    if (this.playerH > TILE_SIZE) {
      this.px = tx * TILE_SIZE + (TILE_SIZE - this.playerW) / 2;
      this.py = (sy + 1) * TILE_SIZE - this.playerH;
    } else {
      // Preserve saved one-tile-body games' initial placement exactly.
      this.px = tx * TILE_SIZE + 3;
      this.py = sy * TILE_SIZE + 1;
    }
    this.pvx = 0;
    this.pvy = 0;
    this.onGround = false;
    this.spinning = false;
    this.invulnT = 0;
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play') return;
    this.playT += dt;
    this.animT += dt;
    this.updatePlayer(dt, input);
    this.updateEntities(dt);
    if (this.boss) this.updateBoss(dt);
    this.updateProjectiles(dt);

    const bounds = { w: this.grid.cols * TILE_SIZE, h: this.grid.rows * TILE_SIZE };
    this.engine.camera.follow(this.playerCenterX(), this.playerCenterY(), this.facing, bounds, dt);
  }

  private solidity(tx: number, ty: number): Solidity {
    const k = this.grid.kind(tx, ty);
    return k === 'solid' ? 'solid' : k === 'platform' ? 'platform' : 'empty';
  }

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const run = input.X.held || input.Y.held;
    const target = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    if (target !== 0) this.facing = target;
    const maxSpeed = run ? this.run : this.walk;
    const want = target * maxSpeed;
    const delta = want - this.pvx;
    const step = this.accel * dt * (this.onGround ? 1 : 0.65);
    this.pvx += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;

    // jump buffering + coyote time
    this.coyoteT = this.onGround ? FEEL.coyoteMs / 1000 : Math.max(0, this.coyoteT - dt);
    this.jumpBufT = Math.max(0, this.jumpBufT - dt);
    const jumpPressed = input.B.pressed || input.A.pressed;
    if (jumpPressed) this.jumpBufT = FEEL.jumpBufferMs / 1000;
    if (this.jumpBufT > 0 && (this.onGround || this.coyoteT > 0)) {
      this.pvy = this.jumpV;
      this.spinning = input.A.pressed || (input.A.held && !input.B.held);
      this.jumpBufT = 0;
      this.coyoteT = 0;
      this.airJumpUsed = false;
      this.engine.sfx.play('jump');
    } else if (this.jumpBufT > 0 && this.power.doubleJump && !this.airJumpUsed && !this.onGround) {
      this.pvy = this.jumpV * 0.92;
      this.airJumpUsed = true;
      this.jumpBufT = 0;
      this.spinning = true;
      this.engine.sfx.play('jump');
      this.engine.particles.burst(this.playerCenterX(), this.playerBottom(), 6, { color: this.spec.palette[7], gravity: 40, speed: 50 });
    }
    // variable jump height
    if ((input.B.released || input.A.released) && this.pvy < -80) this.pvy = -80;

    this.pvy = Math.min(MAX_FALL, this.pvy + this.grav * dt);

    const drop = input.DOWN.held && jumpPressed;
    const grid = { cols: this.grid.cols, rows: this.grid.rows, tileSize: TILE_SIZE, solidityAt: (x: number, y: number) => this.solidity(x, y) };
    const box = this.playerBox();
    const moved = moveAABB(grid, box, this.pvx * dt, this.pvy * dt, { dropThrough: drop });
    this.px = moved.x;
    this.py = moved.y;
    if (moved.hitX) this.pvx = 0;
    if (moved.hitY && this.pvy > 0) this.pvy = 0;
    if (moved.hitY && this.pvy < 0) this.pvy = 0;
    if (!this.onGround && moved.onGround) this.spinning = false;
    this.onGround = moved.onGround;
    if (this.onGround) this.airJumpUsed = false;

    // tile interactions
    for (const c of cellsUnder(this.playerBox(), TILE_SIZE)) {
      const k = this.grid.kind(c.tx, c.ty);
      if (k === 'hazard') this.hurtPlayer();
      else if (k === 'checkpoint') {
        if (!this.checkpoint || this.checkpoint.x !== c.tx) {
          this.checkpoint = { x: c.tx, y: c.ty };
          this.engine.sfx.play('powerup');
          this.engine.particles.burst(c.tx * TILE_SIZE + 8, c.ty * TILE_SIZE + 4, 10, { color: this.spec.palette[13], gravity: -30, speed: 40 });
        }
      }
    }

    // exit (levels only)
    if (this.levelIndex < 3) {
      if (aabbOverlap(this.playerBox(), platformerDoorRect(this.level.exit))) {
        this.levelClear();
        return;
      }
    }

    // fell out of the world
    if (this.playerBottom() > this.grid.rows * TILE_SIZE + 48) this.killPlayer();

    // throw (projectile powerup)
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    if (this.power.projectile && (input.X.pressed || input.Y.pressed) && this.throwCooldown <= 0) {
      if (this.fireProj(this.playerCenterX(), this.playerCenterY(), this.facing * 230, -30, true, true)) {
        this.throwCooldown = 0.35;
        this.engine.sfx.play('shoot');
      }
    }

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private levelClear(): void {
    this.hud.score += this.spec.scoring.events.levelClear;
    this.engine.sfx.play('win');
    this.phase = 'cards';
    this.engine.music.stopSong();
    this.enterLevel(this.levelIndex + 1);
  }

  private hurtPlayer(): void {
    if (this.invulnT > 0) return;
    if (this.power.shield) {
      this.power.shield = false;
      this.invulnT = 1;
      this.engine.sfx.play('hit');
      this.engine.particles.burst(this.playerCenterX(), this.playerCenterY(), 10, { color: this.spec.palette[4], gravity: 0, speed: 70 });
      return;
    }
    this.hud.health--;
    this.invulnT = FEEL.invulnMs / 1000;
    this.pvy = -170;
    this.pvx = -this.facing * 120;
    this.engine.sfx.play('hurt');
    this.engine.shake(FEEL.screenShakeMs, 3);
    this.engine.hitStop(FEEL.hitStopMs);
    if (this.hud.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    this.hud.lives--;
    this.engine.sfx.play('die');
    this.engine.particles.burst(this.playerCenterX(), this.playerCenterY(), 18, { color: this.spec.palette[5], speed: 120 });
    if (this.hud.lives < 0) {
      this.phase = 'cards';
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
    if (this.levelIndex >= 3) {
      // boss retry: reset positions, boss keeps current phase HP
      const b = this.boss;
      this.spawnPlayer(3, this.grid.rows - 3);
      if (b) {
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        b.x = (this.grid.cols - 6) * TILE_SIZE;
      }
      for (const p of this.projs) p.active = false;
    } else if (this.checkpoint) {
      this.spawnPlayer(this.checkpoint.x, this.checkpoint.y);
    } else {
      this.spawnPlayer(this.level.playerSpawn.x, this.level.playerSpawn.y);
    }
    this.invulnT = 1.5;
  }

  // ---------------------------------------------------------------- enemies

  private updateEntities(dt: number): void {
    const camX = this.engine.camera.x;
    for (const e of this.ents) {
      if (!e.active) continue;
      // Activate only near the camera (budget); keep updating once seen.
      if (e.x > camX + INTERNAL_WIDTH + 64 || e.x < camX - 96) continue;
      e.t += dt;
      switch (e.type) {
        case 'walker':
        case 'chaser': {
          const speed = (e.props.speed ?? 1) * (e.type === 'chaser' ? 60 : 34);
          let dir = e.dir;
          if (e.type === 'chaser' && Math.abs(this.playerCenterX() - (e.x + e.w / 2)) < TILE_SIZE * 8) {
            dir = Math.sign(this.playerCenterX() - (e.x + e.w / 2)) || dir;
          }
          const range = (e.props.range ?? 6) * TILE_SIZE;
          if (e.type === 'walker' && Math.abs(e.x - e.homeX) > range) dir = Math.sign(e.homeX - e.x);
          // turn at walls/edges
          const aheadX = dir > 0 ? e.x + e.w + 1 : e.x - 1;
          const footY = Math.floor((e.y + e.h + 2) / TILE_SIZE);
          const wall = this.solidity(Math.floor(aheadX / TILE_SIZE), Math.floor((e.y + e.h / 2) / TILE_SIZE)) === 'solid';
          const cliff = this.solidity(Math.floor(aheadX / TILE_SIZE), footY) === 'empty' &&
            this.solidity(Math.floor(aheadX / TILE_SIZE), footY) !== 'platform';
          if (wall || (e.type === 'walker' && cliff)) dir = -dir;
          e.dir = dir;
          e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
          const grid = { cols: this.grid.cols, rows: this.grid.rows, tileSize: TILE_SIZE, solidityAt: (x: number, y: number) => this.solidity(x, y) };
          const moved = moveAABB(grid, e, dir * speed * dt, e.vy * dt);
          e.x = moved.x;
          e.y = moved.y;
          if (moved.hitY) e.vy = 0;
          e.onGround = moved.onGround;
          break;
        }
        case 'flyer': {
          const amp = (e.props.amplitude ?? 1.5) * TILE_SIZE;
          const period = (e.props.periodMs ?? 2400) / 1000;
          e.x = e.homeX + Math.cos((e.t / period) * Math.PI * 2) * amp * 1.4;
          e.y = e.homeY + Math.sin((e.t / period) * Math.PI * 2) * amp;
          e.dir = Math.cos((e.t / period) * Math.PI * 2 + Math.PI / 2) > 0 ? 1 : -1;
          break;
        }
        case 'shooter': {
          e.fireT += dt;
          const interval = (e.props.fireIntervalMs ?? 2200) / 1000 / this.diff.fire;
          if (e.fireT >= interval && Math.abs(this.playerCenterX() - (e.x + e.w / 2)) < INTERNAL_WIDTH * 0.6) {
            e.fireT = 0;
            if (e.props.aim === 'arc') {
              this.fireProj(e.x + e.w / 2, e.y, Math.sign(this.playerCenterX() - (e.x + e.w / 2)) * 80, -190, false, true);
            } else {
              const dx = this.playerCenterX() - (e.x + e.w / 2);
              const dy = this.playerCenterY() - (e.y + e.h / 2);
              const len = Math.max(1, Math.hypot(dx, dy));
              this.fireProj(e.x + e.w / 2, e.y + e.h / 2, (dx / len) * 120, (dy / len) * 120, false, false);
            }
            this.engine.sfx.play('shoot');
          }
          break;
        }
        case 'movingPlatform': {
          const period = (e.props.periodMs ?? 3000) / 1000;
          const ph = (Math.sin((e.t / period) * Math.PI * 2) + 1) / 2;
          const nx = e.homeX + (e.props.dx ?? 3) * TILE_SIZE * ph;
          const ny = e.homeY + (e.props.dy ?? 0) * TILE_SIZE * ph;
          const dxm = nx - e.x;
          const dym = ny - e.y;
          // carry the player when standing on it
          const onTop =
            this.playerBottom() >= e.y - 2 && this.playerBottom() <= e.y + 6 &&
            this.px + this.playerW > e.x && this.px < e.x + e.w && this.pvy >= 0;
          if (onTop) {
            this.px += dxm;
            this.py = e.y + dym - this.playerH - 0.01;
            this.pvy = 0;
            this.onGround = true;
          }
          e.x = nx;
          e.y = ny;
          break;
        }
        case 'spring':
        case 'coin':
        case 'heart':
        case 'powerup':
          break;
      }

      // player interaction
      if (!aabbOverlap(this.playerBox(), e)) continue;
      switch (e.type) {
        case 'coin':
          e.active = false;
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('pickup');
          this.engine.particles.burst(e.x + 6, e.y + 6, 5, { color: this.spec.palette[13], gravity: 60, speed: 45 });
          break;
        case 'heart':
          e.active = false;
          this.hud.health = Math.min(this.hud.maxHealth, this.hud.health + 1);
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('pickup');
          break;
        case 'powerup': {
          e.active = false;
          const kind = e.props.kind ?? 'doubleJump';
          this.power[kind] = true;
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('powerup');
          this.engine.particles.burst(e.x + 6, e.y + 6, 14, { color: this.spec.palette[7], gravity: -20, speed: 60 });
          break;
        }
        case 'spring':
          if (this.pvy > -40) {
            this.pvy = SPRING_V;
            this.spinning = true;
            e.t = 0.01; // triggers extended anim frame
            this.engine.sfx.play('jump');
          }
          break;
        case 'movingPlatform':
          break;
        default: {
          // enemy contact: stomp vs hurt
          const falling = this.pvy > 40;
          const above = this.playerBottom() - e.y < 8;
          if (falling && above) {
            e.active = false;
            this.pvy = this.spinning ? SPIN_BOUNCE : STOMP_BOUNCE;
            this.hud.score += this.spec.scoring.events.enemyKill;
            this.engine.sfx.play('hit');
            this.engine.hitStop(40);
            this.engine.particles.burst(e.x + 7, e.y + 7, 10, { color: this.spec.palette[8], speed: 90 });
          } else {
            this.hurtPlayer();
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------- boss

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (!b.active) return;
    b.t += dt;
    b.invulnT = Math.max(0, b.invulnT - dt);
    const phaseCount = this.spec.boss.phases.length;
    const phaseIx = Math.min(phaseCount - 1, Math.floor((1 - b.hp / b.maxHp) * phaseCount));
    if (phaseIx !== b.phaseIx) {
      b.phaseIx = phaseIx;
      this.engine.shake(300, 4);
      this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 20, { color: this.spec.palette[11], speed: 130 });
    }
    const phase = this.spec.boss.phases[b.phaseIx]!;
    const tempo = phase.tempo;
    const grid = { cols: this.grid.cols, rows: this.grid.rows, tileSize: TILE_SIZE, solidityAt: (x: number, y: number) => this.solidity(x, y) };

    const atk = b.attack;
    atk.t += dt;
    switch (atk.name) {
      case 'idle': {
        // face the player; pick next attack after a beat
        b.dir = Math.sign(this.playerCenterX() - (b.x + b.w / 2)) || -1;
        const interval = 1.6 / tempo;
        if (atk.t >= interval) {
          const list = phase.attacks;
          const next = list[Math.floor(this.engine.rng.next() * list.length)]!;
          b.attack = { name: next, t: 0, telegraph: 0.45 / tempo };
        }
        break;
      }
      case 'stomp': {
        if (atk.t < atk.telegraph) break; // crouch telegraph
        if (b.onGround && atk.t < atk.telegraph + 0.05) {
          b.vy = -360;
          b.vx = Math.sign(this.playerCenterX() - (b.x + b.w / 2)) * 90 * tempo;
          b.onGround = false;
        }
        b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
        const moved = moveAABB(grid, b, b.vx * dt, b.vy * dt);
        b.x = moved.x;
        b.y = moved.y;
        if (moved.onGround && b.vy > 0) {
          b.vy = 0;
          b.onGround = true;
          this.engine.shake(250, 4);
          this.engine.sfx.play('hit');
          // ground shockwaves both directions
          this.fireProj(b.x + b.w / 2 - 8, b.y + b.h - 8, -110 * tempo, 0, false, false);
          this.fireProj(b.x + b.w / 2 + 8, b.y + b.h - 8, 110 * tempo, 0, false, false);
          b.attack = { name: 'idle', t: 0, telegraph: 0 };
        }
        break;
      }
      case 'charge': {
        if (atk.t < atk.telegraph) break; // flash telegraph
        const speed = 240 * tempo;
        const moved = moveAABB(grid, b, b.dir * speed * dt, 0);
        b.x = moved.x;
        if (moved.hitX || atk.t > atk.telegraph + 2.2) {
          if (moved.hitX) this.engine.shake(200, 3);
          b.attack = { name: 'idle', t: 0, telegraph: 0 };
        }
        break;
      }
      case 'spread': {
        if (atk.t < atk.telegraph) break;
        const n = 3 + b.phaseIx;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(
            this.playerCenterY() - (b.y + b.h / 2),
            this.playerCenterX() - (b.x + b.w / 2),
          ) + ((i - (n - 1) / 2) * Math.PI) / 10;
          this.fireProj(b.x + b.w / 2, b.y + b.h / 2, Math.cos(a) * 130 * tempo, Math.sin(a) * 130 * tempo, false, false);
        }
        this.engine.sfx.play('shoot');
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        break;
      }
      case 'summon': {
        if (atk.t < atk.telegraph) break;
        const minions = this.ents.filter((e) => e.active && e.type === 'walker').length;
        if (minions < 3) {
          const m = this.makeEnt({ type: 'walker', x: Math.round(b.x / TILE_SIZE) - 2, y: Math.round(b.y / TILE_SIZE), props: { speed: 1.4 } });
          this.ents.push(m);
          this.engine.particles.burst(m.x + 7, m.y + 7, 8, { color: this.spec.palette[10], speed: 70 });
        }
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        break;
      }
    }

    // gravity when idle-ish
    if (atk.name !== 'stomp') {
      b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
      const moved = moveAABB(grid, b, 0, b.vy * dt);
      b.y = moved.y;
      if (moved.onGround) {
        b.vy = 0;
        b.onGround = true;
      }
    }

    // boss vs player
    const pbox = this.playerBox();
    if (aabbOverlap(pbox, b)) {
      const falling = this.pvy > 40;
      const above = this.playerBottom() - b.y < 10;
      if (falling && above && b.invulnT <= 0) {
        b.hp--;
        b.invulnT = 0.5;
        this.pvy = this.spinning ? SPIN_BOUNCE : STOMP_BOUNCE;
        this.hud.score += this.spec.scoring.events.bossHit;
        this.engine.sfx.play('hit');
        this.engine.hitStop(70);
        this.engine.shake(150, 2);
        this.engine.particles.burst(b.x + b.w / 2, b.y + 4, 12, { color: this.spec.palette[9], speed: 100 });
      } else if (!falling || !above) {
        this.hurtPlayer();
      }
    }
    this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };

    if (b.hp <= 0) {
      b.active = false;
      this.hud.boss = undefined;
      this.hud.score += this.spec.scoring.events.levelClear;
      this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 40, { color: this.spec.palette[12], speed: 160, life: 1 });
      this.engine.shake(500, 5);
      this.engine.music.stopSong();
      this.phase = 'cards';
      this.engine.cards.show(
        this.spec.story.victory.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
        () => {
          const par = estimatePlatformerDurationS(this.spec) * 1.35;
          this.result = {
            outcome: 'won',
            score: this.hud.score,
            timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
          };
        },
      );
    }
  }

  // ------------------------------------------------------------- projectiles

  private fireProj(x: number, y: number, vx: number, vy: number, friendly: boolean, grav: boolean): boolean {
    for (const p of this.projs) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.friendly = friendly;
      p.grav = grav;
      p.t = 0;
      return true;
    }
    return false;
  }

  private updateProjectiles(dt: number): void {
    const pbox = this.playerBox();
    for (const p of this.projs) {
      if (!p.active) continue;
      p.t += dt;
      if (p.grav) p.vy += 400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t > 4 || p.y > this.grid.rows * TILE_SIZE + 32) {
        p.active = false;
        continue;
      }
      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.y / TILE_SIZE);
      if (this.solidity(tx, ty) === 'solid' && !(p.grav && p.vy < 0)) {
        // ground shockwaves slide along the floor; others break on walls
        if (!(Math.abs(p.vy) < 1 && this.solidity(tx, ty - 1) === 'empty')) {
          p.active = false;
          continue;
        }
      }
      const box = { x: p.x - 3, y: p.y - 3, w: 6, h: 6 };
      if (p.friendly) {
        for (const e of this.ents) {
          if (!e.active || e.type === 'coin' || e.type === 'heart' || e.type === 'powerup' || e.type === 'spring' || e.type === 'movingPlatform') continue;
          if (aabbOverlap(box, e)) {
            e.active = false;
            p.active = false;
            this.hud.score += this.spec.scoring.events.enemyKill;
            this.engine.sfx.play('hit');
            this.engine.particles.burst(e.x + 7, e.y + 7, 10, { color: this.spec.palette[8], speed: 90 });
            break;
          }
        }
        const b = this.boss;
        if (p.active && b && b.active && b.invulnT <= 0 && aabbOverlap(box, b)) {
          b.hp--;
          b.invulnT = 0.3;
          p.active = false;
          this.hud.score += this.spec.scoring.events.bossHit;
          this.engine.sfx.play('hit');
        }
      } else if (aabbOverlap(box, pbox)) {
        p.active = false;
        this.hurtPlayer();
      }
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const r = this.engine.renderer;
    const cam = this.engine.camera;
    r.clear(this.spec.palette[2]);
    if (this.phase === 'cards' && !this.level && !this.boss) return; // pre-first-level intro
    if (!this.grid) return;
    this.backdrop.draw(r.ctx, cam.x, cam.y);

    const frameIx = Math.floor(this.animT * 4) % 2;
    drawTileLayer(r, cam, this.grid.cols, this.grid.rows, TILE_SIZE, (tx, ty) => {
      const k = this.grid.kind(tx, ty);
      if (k === 'empty') return null;
      const frames = this.tileCanvases.get(k);
      if (!frames || frames.length === 0) return null;
      return frames[frameIx % frames.length] ?? frames[0]!;
    });

    const decorationFrames = this.tileCanvases.get('decoration');
    if (decorationFrames?.length) {
      for (const decoration of this.decorations) {
        r.draw(
          decorationFrames[frameIx % decorationFrames.length] ?? decorationFrames[0]!,
          decoration.x * TILE_SIZE - cam.x,
          decoration.y * TILE_SIZE - cam.y,
        );
      }
    }

    // exit marker
    if (this.levelIndex < 3 && this.level) {
      const exitFrames = this.tileCanvases.get('exit')!;
      const door = platformerDoorRect(this.level.exit);
      r.drawScaled(
        exitFrames[frameIx % exitFrames.length]!,
        door.x - cam.x,
        door.y - cam.y,
        door.w,
        door.h,
      );
    }

    // entities
    for (const e of this.ents) {
      if (!e.active) continue;
      if (e.x - cam.x < -32 || e.x - cam.x > INTERNAL_WIDTH + 32) continue;
      const sprite = this.entitySprite(e);
      if (!sprite) continue;
      const anim = e.type === 'spring' ? (e.t > 0 && e.t < 0.25 ? 'bounce' : 'idle') : 'walk';
      const img = this.engine.sprites.frame(sprite, anim, e.t + this.animT, e.dir > 0);
      const drawX = e.x - cam.x - (sprite.w - e.w) / 2;
      // A moving platform is a one-way top surface. Pin its normalized first
      // opaque row to that surface instead of bottom-aligning it like an actor.
      const drawY = e.type === 'movingPlatform'
        ? e.y - cam.y
        : e.y - cam.y - (sprite.h - e.h);
      r.draw(img, drawX, drawY);
    }

    // boss
    const b = this.boss;
    if (b && b.active) {
      const sprite = this.sprites['boss']!;
      const anim = b.attack.name !== 'idle' && b.attack.t < b.attack.telegraph + 0.3 ? 'attack' : b.invulnT > 0 ? 'hurt' : 'idle';
      const img = this.engine.sprites.frame(sprite, anim, this.animT, b.dir > 0);
      r.draw(img, b.x - cam.x - (sprite.w - b.w) / 2, b.y - cam.y - (sprite.h - b.h));
    }

    // projectiles (friendly and hostile can be cast separately)
    for (const p of this.projs) {
      if (!p.active) continue;
      const projSprite = this.sprites[p.friendly ? 'projectile' : 'enemy_projectile']!;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t, p.vx < 0);
      r.draw(img, p.x - cam.x - 4, p.y - cam.y - 4);
    }

    // player (invulnerability flicker)
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const anim = !this.onGround ? 'jump' : Math.abs(this.pvx) > 8 ? 'walk' : 'idle';
      let img = this.engine.sprites.frame(hero, anim, this.animT, this.facing < 0);
      if (this.spinning && !this.onGround) {
        img = this.engine.sprites.frame(hero, 'jump', this.animT, Math.floor(this.animT * 12) % 2 === 0);
      }
      const heroWorldX = this.px - (hero.w - this.playerW) / 2;
      const heroWorldY = this.py - (hero.h - this.playerH);
      const heroX = heroWorldX - cam.x;
      const heroY = heroWorldY - cam.y;
      r.draw(img, heroX, heroY);
      if (this.power.shield) {
        if (hero.appliedPresentation === 'tall-humanoid') {
          r.frame(
            heroX - 1,
            heroY - 1,
            hero.w + 2,
            hero.h + 2,
            this.spec.palette[4] ?? '#41a6f6',
          );
        } else {
          r.frame(
            this.px - cam.x - 4,
            this.py - cam.y - 4,
            18,
            22,
            this.spec.palette[4] ?? '#41a6f6',
          );
        }
      }

      // Saved games without the two-tile layout marker retain their compact
      // collider. Keep their old foreground masking for one-tile passages;
      // marked games use the actual 16x32 visual as the collision body.
      if (hero.appliedPresentation === 'tall-humanoid' && this.playerH !== hero.h) {
        const minTx = Math.floor(heroWorldX / TILE_SIZE);
        const maxTx = Math.ceil((heroWorldX + hero.w) / TILE_SIZE) - 1;
        const minTy = Math.floor(heroWorldY / TILE_SIZE);
        const maxTy = Math.ceil((heroWorldY + hero.h) / TILE_SIZE) - 1;
        for (let ty = minTy; ty <= maxTy; ty++) {
          for (let tx = minTx; tx <= maxTx; tx++) {
            const solidity = this.solidity(tx, ty);
            if (solidity !== 'solid' && solidity !== 'platform') continue;
            const frames = this.tileCanvases.get(this.grid.kind(tx, ty));
            if (!frames?.length) continue;
            r.draw(
              frames[frameIx % frames.length] ?? frames[0]!,
              tx * TILE_SIZE - cam.x,
              ty * TILE_SIZE - cam.y,
            );
          }
        }
      }
    }

    // Close foreground scenery, drawn in front of gameplay (parallax > 1) for depth.
    this.backdrop.drawForeground(r.ctx, cam.x, cam.y);
  }

  private entitySprite(e: Ent): ResolvedSprite | null {
    switch (e.type) {
      case 'walker':
      case 'flyer':
      case 'shooter':
      case 'chaser':
        return this.sprites[e.type] ?? null;
      case 'coin':
        return this.sprites['coin'] ?? null;
      case 'heart':
        return this.sprites['heart'] ?? null;
      case 'powerup':
        return this.sprites['powerup'] ?? null;
      case 'spring':
        return this.engine.sprites.byRole('obj_spring', 'lib:obj_spring');
      case 'movingPlatform':
        return this.sprites['obj_platform'] ?? null;
    }
  }
}
