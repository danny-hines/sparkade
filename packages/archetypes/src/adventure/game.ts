// Adventure gameplay (Zelda-like: a top-down single dungeon of one-screen rooms).
// Controls per SNES convention: d-pad 4-way move, B sword, Y secondary item,
// A interact/talk, SELECT dungeon map, START pause (host-owned).
import {
  aabbOverlap,
  drawObstacleShadows,
  drawObstacleTile,
  drawTileLayer,
  makeBackdrop,
  moveAABB,
  type AABB,
  type Backdrop,
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
  BUDGET,
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  difficultyScale,
  type AdventureDoor,
  type AdventureDungeon,
  type AdventureEntity,
  type AdventureEntityType,
  type AdventureRoom,
  type AdventureSpec,
  type DifficultyScale,
} from '@sparkade/shared';
import { estimateAdventureDurationS } from './lint';

const COLS = 24;
const ROWS = 12;
const ROOM_W = COLS * TILE_SIZE; // 384
const ROOM_H = ROWS * TILE_SIZE; // 192
const VIEW_X = 64; // room top-left on the 512x300 screen (camera snaps to -VIEW)
const VIEW_Y = 68;

const PLAYER_SPEED = 84;
const PLAYER_W = 12;
const PLAYER_H = 12;
const SWORD_TIME = 0.28;
const SWORD_COOLDOWN = 0.35;
const SWORD_KB = 60; // enemy knockback distance, px
const PLAYER_KB = 90; // player knockback distance, px
const ARROW_SPEED = 200;
const BOW_COOLDOWN = 0.55;
const MAX_ARROWS = 2;
const BOMB_FUSE = 1.1;
const BOMB_RADIUS = 28;
const BOMB_COOLDOWN = 1.6;
const BOOM_SPEED = 190;
const BOOM_RETURN_SPEED = 220;
const BOOM_RANGE = 4 * TILE_SIZE;
const ENEMY_SHOT_SPEED = 90;
const BOSS_SHOT_SPEED = 70;
const BLOCK_SLIDE_SPEED = 8; // px/s (spec'd: deliberate, weighty pushes)
const PUSH_DELAY = 0.15; // sustained push before a block budges

type TileKind =
  | 'floor'
  | 'wall'
  | 'hazard'
  | 'pit'
  | 'switch'
  | 'decoration'
  | 'doorOpen'
  | 'doorLocked'
  | 'doorBoss';

type Dir = 'n' | 's' | 'e' | 'w';
type Facing = 'up' | 'down' | 'left' | 'right';

interface DoorGeom {
  dir: Dir;
  dx: number;
  dy: number;
  cells: readonly { tx: number; ty: number }[];
}

const DOOR_GEOM: readonly DoorGeom[] = [
  { dir: 'n', dx: 0, dy: -1, cells: [{ tx: 11, ty: 0 }, { tx: 12, ty: 0 }] },
  { dir: 's', dx: 0, dy: 1, cells: [{ tx: 11, ty: ROWS - 1 }, { tx: 12, ty: ROWS - 1 }] },
  { dir: 'e', dx: 1, dy: 0, cells: [{ tx: COLS - 1, ty: 5 }, { tx: COLS - 1, ty: 6 }] },
  { dir: 'w', dx: -1, dy: 0, cells: [{ tx: 0, ty: 5 }, { tx: 0, ty: 6 }] },
];

interface DoorInfo {
  dir: Dir;
  kind: AdventureDoor;
  neighbor: number; // room index, -1 if missing
  cells: readonly { tx: number; ty: number }[];
}

interface Ent {
  active: boolean;
  type: AdventureEntityType;
  specIx: number; // index into room.entities; -1 drop, -2 boss summon
  x: number;
  y: number;
  w: number;
  h: number;
  dirX: number;
  dirY: number;
  t: number;
  hp: number;
  fireT: number;
  stunT: number;
  hitT: number;
  kbT: number;
  kbX: number;
  kbY: number;
  wanderT: number;
  chaseT: number;
  pauseT: number;
  lastSwing: number;
  props: NonNullable<AdventureEntity['props']>;
}

interface Proj {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  friendly: boolean;
  arrow: boolean;
  t: number;
}

interface Bomb {
  active: boolean;
  x: number;
  y: number;
  fuseT: number;
}

interface BlockObj {
  active: boolean;
  x: number;
  y: number;
  tx: number;
  ty: number;
  toTx: number;
  toTy: number;
  sliding: boolean;
}

type BossMode = 'idle' | 'telegraph' | 'charge' | 'vanish' | 'spiral';

interface BossState {
  active: boolean;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  phaseIx: number;
  invulnT: number;
  dirX: number;
  mode: BossMode;
  t: number;
  vx: number;
  vy: number;
  angle: number;
  emitT: number;
  emits: number;
}

const ROLE_FALLBACK: Record<string, string> = {
  hero: 'lib:hero_wander',
  walker: 'lib:enemy_walker',
  flyer: 'lib:enemy_flyer',
  shooter: 'lib:enemy_shooter',
  chaser: 'lib:enemy_chaser',
  bruiser: 'lib:enemy_bruiser',
  boss: 'lib:boss_warden',
  npc: 'lib:npc_keeper',
  key: 'lib:pickup_key',
  heart: 'lib:pickup_heart',
  item: 'lib:pickup_power',
  enemyShot: 'lib:proj_pellet',
};

function isEnemyType(t: AdventureEntityType): boolean {
  return t === 'walker' || t === 'flyer' || t === 'shooter' || t === 'chaser' || t === 'bruiser';
}

export function createAdventureGame(engine: EngineContext, spec: AdventureSpec): GameInstance {
  return new AdventureGame(engine, spec);
}

class AdventureGame implements GameInstance {
  hud: HudState = { score: 0, lives: 3, health: 5, maxHealth: 5, keys: 0, bombs: 0 };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' = 'cards';
  private dungeon: AdventureDungeon;
  private room!: AdventureRoom;
  private roomIx = 0;
  private roomReady = false;
  private roomEpoch = 0;
  private startIx = 0;
  private bossIx = 0;
  private posIndex = new Map<string, number>();
  private backdrop: Backdrop;
  private tileFrames: Record<string, HTMLCanvasElement[]> = {};

  // room state (rebuilt on every room entry)
  private kinds: TileKind[] = new Array<TileKind>(COLS * ROWS).fill('floor');
  private doors: DoorInfo[] = [];
  private hazardCells: { tx: number; ty: number }[] = [];
  private switchCells: { tx: number; ty: number; pressed: boolean }[] = [];
  private decoCells: { tx: number; ty: number }[] = [];
  private hazardsActive = true;
  private sealed = false;

  // persistent dungeon state
  private visited = new Set<number>();
  private collected = new Set<string>(); // `${roomIx}:${entIx}` keys/hearts/items
  private openedDoors = new Set<string>(); // canonical room-id pairs
  private keys = 0;
  private hasItem = false;
  private bossDefeated = false;
  private bossIntroShown = false;
  private beat1Shown = false;
  private beat2Shown = false;
  private checkpoint = { roomIx: 0, x: 0, y: 0 };

  // player
  private px = 0;
  private py = 0;
  private facing: Facing = 'down';
  private lastAxis: 'h' | 'v' = 'v';
  private moving = false;
  private invulnT = 0;
  private kbT = 0;
  private kbVX = 0;
  private kbVY = 0;
  private swordT = 0;
  private swordCd = 0;
  private swingId = 0;
  private bowCd = 0;
  private bombCd = 0;
  private bumpCd = 0;
  private pushT = 0;
  private pushDX = 0;
  private pushDY = 0;
  private animT = 0;
  private playT = 0;

  // map overlay
  private mapOpen = false;
  private mapT = 0;
  private gMinX = 0;
  private gMinY = 0;
  private gMaxX = 0;
  private gMaxY = 0;

  // floating text
  private floatText = '';
  private floatT = 0;
  private floatX = 0;
  private floatY = 0;

  // pools (allocated once)
  private ents: Ent[];
  private projs: Proj[];
  private bombs: Bomb[];
  private blocks: BlockObj[];
  private boom = { active: false, x: 0, y: 0, vx: 0, vy: 0, sx: 0, sy: 0, back: false, t: 0 };
  private boss: BossState = {
    active: false, visible: true, x: 0, y: 0, w: 24, h: 24, hp: 1, maxHp: 1,
    phaseIx: 0, invulnT: 0, dirX: -1, mode: 'idle', t: 0, vx: 0, vy: 0, angle: 0, emitT: 0, emits: 0,
  };

  // reusable scratch boxes (no per-frame allocation)
  private pbox: AABB = { x: 0, y: 0, w: PLAYER_W, h: PLAYER_H };
  private swordBox: AABB = { x: 0, y: 0, w: 16, h: 14 };
  private projBox: AABB = { x: 0, y: 0, w: 6, h: 6 };
  private boomBox: AABB = { x: 0, y: 0, w: 10, h: 10 };
  private tmpBox: AABB = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };

  private playerGrid: TileGrid;
  private entGrid: TileGrid;

  private sprites: Record<string, ResolvedSprite> = {};
  private arrowSprite: ResolvedSprite;
  private waveSprite: ResolvedSprite;
  private boomSprite: ResolvedSprite;
  private bombSprite: ResolvedSprite;
  private diff!: DifficultyScale;

  constructor(
    private engine: EngineContext,
    private spec: AdventureSpec,
  ) {
    this.diff = difficultyScale(spec.difficulty);
    this.dungeon = spec.levels[0]!;
    for (const role of Object.keys(ROLE_FALLBACK)) {
      this.sprites[role] = engine.sprites.byRole(role, ROLE_FALLBACK[role]!);
    }
    this.arrowSprite = engine.sprites.byRole('proj_arrow', 'lib:proj_arrow');
    this.waveSprite = engine.sprites.byRole('proj_wave', 'lib:proj_wave');
    this.boomSprite = engine.sprites.byRole('item_boomerang', 'lib:item_boomerang');
    this.bombSprite = engine.sprites.byRole('proj_bomb', 'lib:proj_bomb');

    const tileArt: Record<string, string> = {
      floor: 'lib:tile_floor',
      wall: 'lib:tile_wall',
      hazard: 'lib:tile_hazard',
      block: 'lib:tile_block',
      pit: 'lib:tile_pit',
      switch: 'lib:tile_switch',
      deco: 'lib:tile_deco',
      doorLocked: 'lib:tile_door_locked',
      doorBoss: 'lib:tile_door_boss',
      doorOpen: 'lib:tile_door_open',
    };
    for (const [name, ref] of Object.entries(tileArt)) {
      // Reskinnable terrain: assign role = the default lib id (e.g. "tile_wall":
      // "lib:castle_wall" or a custom 16x16). bob:false keeps tiles still.
      this.tileFrames[name] = engine.sprites.byRole(ref.slice(4), ref, { bob: false }).frames;
    }
    this.backdrop = makeBackdrop(spec.palette, spec.seed + 33, spec.backdrop);

    this.dungeon.rooms.forEach((room, i) => {
      this.posIndex.set(`${room.gridPos.x},${room.gridPos.y}`, i);
      if (room.id === this.dungeon.startRoom) this.startIx = i;
      if (room.id === this.dungeon.bossRoom) this.bossIx = i;
      if (i === 0) {
        this.gMinX = this.gMaxX = room.gridPos.x;
        this.gMinY = this.gMaxY = room.gridPos.y;
      } else {
        this.gMinX = Math.min(this.gMinX, room.gridPos.x);
        this.gMaxX = Math.max(this.gMaxX, room.gridPos.x);
        this.gMinY = Math.min(this.gMinY, room.gridPos.y);
        this.gMaxY = Math.max(this.gMaxY, room.gridPos.y);
      }
    });

    this.ents = Array.from({ length: BUDGET.maxActiveEntities }, () => ({
      active: false, type: 'walker' as AdventureEntityType, specIx: -1, x: 0, y: 0, w: 12, h: 12,
      dirX: 1, dirY: 0, t: 0, hp: 1, fireT: 0, stunT: 0, hitT: 0, kbT: 0, kbX: 0, kbY: 0,
      wanderT: 0, chaseT: 0, pauseT: 0, lastSwing: -1, props: {},
    }));
    this.projs = Array.from({ length: 32 }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, friendly: false, arrow: false, t: 0,
    }));
    this.bombs = Array.from({ length: 3 }, () => ({ active: false, x: 0, y: 0, fuseT: 0 }));
    this.blocks = Array.from({ length: 16 }, () => ({
      active: false, x: 0, y: 0, tx: 0, ty: 0, toTx: 0, toTy: 0, sliding: false,
    }));

    this.playerGrid = {
      cols: COLS, rows: ROWS, tileSize: TILE_SIZE,
      solidityAt: (tx, ty) => this.solidity(tx, ty, false),
    };
    this.entGrid = {
      cols: COLS, rows: ROWS, tileSize: TILE_SIZE,
      solidityAt: (tx, ty) => this.solidity(tx, ty, true),
    };
  }

  start(): void {
    const cards = this.spec.story.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
    }));
    this.engine.cards.show(cards, () => this.enterDungeon());
  }

  restart(): void {
    // Pause-menu Restart: back to the last checkpoint (room entry), full health,
    // score/lives/keys/opened-doors kept. A boss fight restarts fresh.
    if (!this.roomReady) return;
    this.hud.health = this.hud.maxHealth;
    this.enterRoom(this.checkpoint.roomIx, this.checkpoint.x, this.checkpoint.y);
    this.invulnT = 1;
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  // ---------------------------------------------------------------- room flow

  private enterDungeon(): void {
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show(
      [{
        title: this.spec.meta.title,
        lines: [this.spec.story.levelIntros[0] ?? '...'],
        portrait: this.engine.portrait,
      }],
      () => this.enterRoom(this.startIx, null, null),
    );
  }

  private enterRoom(ix: number, x: number | null, y: number | null): void {
    this.roomIx = ix;
    this.buildRoom(ix);
    this.roomReady = true;
    if (x === null || y === null) {
      const cell = this.findSpawnCell(12, 6);
      x = cell.tx * TILE_SIZE + 2;
      y = cell.ty * TILE_SIZE + 2;
    }
    this.px = x;
    this.py = y;
    this.checkpoint.roomIx = ix;
    this.checkpoint.x = x;
    this.checkpoint.y = y;
    this.resetTransient();
    this.engine.camera.snap(-VIEW_X, -VIEW_Y);
    this.visited.add(ix);

    if (ix === this.bossIx && !this.bossDefeated) {
      this.sealed = true;
      this.spawnBoss();
      if (!this.bossIntroShown) {
        this.bossIntroShown = true;
        this.phase = 'cards';
        this.engine.music.stopSong();
        this.engine.cards.show(
          [{ title: this.spec.boss.name, lines: [this.spec.story.bossIntro], portrait: this.engine.portrait }],
          () => {
            this.engine.music.playSong('boss');
            this.phase = 'play';
          },
        );
      } else {
        this.engine.music.playSong('boss');
        this.phase = 'play';
      }
      return;
    }

    this.sealed = false;
    this.boss.active = false;
    this.hud.boss = undefined;
    this.engine.music.playSong('theme');

    // Progress beats at 1/3 and 2/3 of rooms visited.
    const n = this.dungeon.rooms.length;
    const beat1 = this.spec.story.levelIntros[1];
    const beat2 = this.spec.story.levelIntros[2];
    if (!this.beat1Shown && beat1 !== undefined && this.visited.size >= Math.ceil(n / 3)) {
      this.beat1Shown = true;
      this.showBeatCard(beat1);
      return;
    }
    if (!this.beat2Shown && beat2 !== undefined && this.visited.size >= Math.ceil((2 * n) / 3)) {
      this.beat2Shown = true;
      this.showBeatCard(beat2);
      return;
    }
    this.phase = 'play';
  }

  private showBeatCard(line: string): void {
    this.phase = 'cards';
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show(
      [{ title: this.spec.meta.title, lines: [line], portrait: this.engine.portrait }],
      () => {
        this.phase = 'play';
      },
    );
  }

  private buildRoom(ix: number): void {
    const room = this.dungeon.rooms[ix]!;
    this.room = room;
    this.roomEpoch++;

    for (const b of this.blocks) b.active = false;
    this.hazardCells.length = 0;
    this.switchCells.length = 0;
    this.decoCells.length = 0;

    for (let ty = 0; ty < ROWS; ty++) {
      const rowStr = room.tiles[ty] ?? '';
      for (let tx = 0; tx < COLS; tx++) {
        const ch = rowStr[tx] ?? '.';
        const t = ch === '.' ? 'floor' : (room.legend[ch] ?? 'floor');
        if (t === 'block') {
          this.kinds[ty * COLS + tx] = 'floor';
          for (const b of this.blocks) {
            if (b.active) continue;
            b.active = true;
            b.x = tx * TILE_SIZE;
            b.y = ty * TILE_SIZE;
            b.tx = tx;
            b.ty = ty;
            b.toTx = tx;
            b.toTy = ty;
            b.sliding = false;
            break;
          }
        } else {
          this.kinds[ty * COLS + tx] = t;
          if (t === 'hazard') this.hazardCells.push({ tx, ty });
          else if (t === 'switch') this.switchCells.push({ tx, ty, pressed: false });
          else if (t === 'decoration') this.decoCells.push({ tx, ty });
        }
      }
    }

    // Doors: carve 2-tile openings mid-wall.
    this.doors.length = 0;
    for (const g of DOOR_GEOM) {
      const kind = room.doors[g.dir];
      if (kind === 'none') continue;
      const nIx = this.posIndex.get(`${room.gridPos.x + g.dx},${room.gridPos.y + g.dy}`) ?? -1;
      const opened = kind === 'open' || (nIx >= 0 && this.openedDoors.has(this.pairKey(ix, nIx)));
      const tileKind: TileKind = opened ? 'doorOpen' : kind === 'locked' ? 'doorLocked' : 'doorBoss';
      for (const c of g.cells) this.kinds[c.ty * COLS + c.tx] = tileKind;
      this.doors.push({ dir: g.dir, kind, neighbor: nIx, cells: g.cells });
    }

    // Keep each doorway's landing walkable. The opening is carved above, but the
    // tiles the player lands on just inside are author-controlled and can hold a
    // hazard (damage on entry) or a wall/pit (blocked in the doorway). Clear
    // those in the 2 cells inward of every open doorway so entry is always safe.
    for (const g of DOOR_GEOM) {
      if (room.doors[g.dir] === 'none') continue;
      for (const c of g.cells) {
        for (let d = 1; d <= 2; d++) {
          const tx = c.tx - g.dx * d;
          const ty = c.ty - g.dy * d;
          if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
          const idx = ty * COLS + tx;
          const tk = this.kinds[idx];
          if (tk === 'wall' || tk === 'pit' || tk === 'hazard') {
            this.kinds[idx] = 'floor';
            if (tk === 'hazard') {
              const hi = this.hazardCells.findIndex((h) => h.tx === tx && h.ty === ty);
              if (hi >= 0) this.hazardCells.splice(hi, 1);
            }
          }
        }
      }
    }

    // Entities (respawn on re-entry except collected keys/hearts/items).
    for (const e of this.ents) e.active = false;
    room.entities.forEach((es, i) => {
      const persistent = es.type === 'key' || es.type === 'heart' || es.type === 'item';
      if (persistent && this.collected.has(`${ix}:${i}`)) return;
      this.spawnEnt(es.type, es.x * TILE_SIZE + 8, es.y * TILE_SIZE + 8, i, es.props ?? {});
    });

    this.hazardsActive = true;
  }

  private resetTransient(): void {
    for (const p of this.projs) p.active = false;
    for (const bm of this.bombs) bm.active = false;
    this.boom.active = false;
    this.swordT = 0;
    this.kbT = 0;
    this.pushT = 0;
    this.floatT = 0;
    this.mapOpen = false;
  }

  private pairKey(a: number, b: number): string {
    const ida = this.dungeon.rooms[a]?.id ?? String(a);
    const idb = this.dungeon.rooms[b]?.id ?? String(b);
    return ida < idb ? `${ida}|${idb}` : `${idb}|${ida}`;
  }

  private spawnEnt(
    type: AdventureEntityType,
    cx: number,
    cy: number,
    specIx: number,
    props: NonNullable<AdventureEntity['props']>,
  ): Ent | null {
    for (const e of this.ents) {
      if (e.active) continue;
      const size = type === 'bruiser' ? 14 : 12;
      e.active = true;
      e.type = type;
      e.specIx = specIx;
      e.w = size;
      e.h = size;
      e.x = cx - size / 2;
      e.y = cy - size / 2;
      e.dirX = this.engine.rng.chance(0.5) ? 1 : -1;
      e.dirY = 0;
      e.t = 0;
      e.hp = Math.max(1, Math.round((type === 'bruiser' ? 3 : 1) * this.diff.hp));
      e.fireT = 0;
      e.stunT = 0;
      e.hitT = 0;
      e.kbT = 0;
      e.kbX = 0;
      e.kbY = 0;
      e.wanderT = 0;
      e.chaseT = 0;
      e.pauseT = 0;
      e.lastSwing = -1;
      e.props = props;
      return e;
    }
    return null;
  }

  // -------------------------------------------------------------- tile logic

  private kindAt(tx: number, ty: number): TileKind {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return 'wall';
    return this.kinds[ty * COLS + tx]!;
  }

  private blockAt(tx: number, ty: number): BlockObj | null {
    for (const b of this.blocks) {
      if (!b.active) continue;
      if (b.tx === tx && b.ty === ty) return b;
      if (b.sliding && b.toTx === tx && b.toTy === ty) return b;
    }
    return null;
  }

  /** Casts a raised-block silhouette (see drawObstacleShadows). Walls and pits
   *  share the floor's base color and must be forced to read against it. */
  private isObstacleTile(tx: number, ty: number): boolean {
    const k = this.kindAt(tx, ty);
    return k === 'wall' || k === 'pit';
  }

  /** Walkable terrain an obstacle shadow can fall onto (excludes doorways, which
   *  have their own dark art, and cells holding a pushable block). */
  private isTerrainTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const k = this.kinds[ty * COLS + tx]!;
    if (k !== 'floor' && k !== 'decoration' && k !== 'switch') return false;
    return !this.blockAt(tx, ty);
  }

  private solidity(tx: number, ty: number, forEnemy: boolean): Solidity {
    const k = this.kindAt(tx, ty);
    if (k === 'wall' || k === 'pit' || k === 'doorLocked' || k === 'doorBoss') return 'solid';
    if (k === 'doorOpen' && (forEnemy || this.sealed)) return 'solid';
    if (this.blockAt(tx, ty)) return 'solid';
    return 'empty';
  }

  private projBlockedAt(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const k = this.kindAt(tx, ty);
    if (k === 'wall' || k === 'doorLocked' || k === 'doorBoss') return true;
    if (k === 'doorOpen' && this.sealed) return true;
    return this.blockAt(tx, ty) !== null;
  }

  private findSpawnCell(targetTx: number, targetTy: number): { tx: number; ty: number } {
    let bestTx = 12;
    let bestTy = 6;
    let bestD = Infinity;
    for (let ty = 1; ty < ROWS - 1; ty++) {
      for (let tx = 1; tx < COLS - 1; tx++) {
        const k = this.kindAt(tx, ty);
        if (k !== 'floor' && k !== 'decoration' && k !== 'switch') continue;
        if (this.blockAt(tx, ty)) continue;
        let occupied = false;
        for (const e of this.ents) {
          if (!e.active) continue;
          if (Math.floor((e.x + e.w / 2) / TILE_SIZE) === tx && Math.floor((e.y + e.h / 2) / TILE_SIZE) === ty) {
            occupied = true;
            break;
          }
        }
        if (occupied) continue;
        const d = (tx - targetTx) * (tx - targetTx) + (ty - targetTy) * (ty - targetTy);
        if (d < bestD) {
          bestD = d;
          bestTx = tx;
          bestTy = ty;
        }
      }
    }
    return { tx: bestTx, ty: bestTy };
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play' || !this.roomReady) return;

    // Dungeon map overlay pauses gameplay and consumes input.
    if (this.mapOpen) {
      this.mapT += dt;
      if (input.SELECT.pressed || input.B.pressed) {
        this.mapOpen = false;
        this.engine.sfx.play('uiBack');
      }
      return;
    }
    if (input.SELECT.pressed) {
      this.mapOpen = true;
      this.mapT = 0;
      this.engine.sfx.play('uiSelect');
      return;
    }

    this.playT += dt;
    this.animT += dt;
    this.floatT = Math.max(0, this.floatT - dt);

    const epoch = this.roomEpoch;
    this.updatePlayer(dt, input);
    if (this.phase !== 'play' || epoch !== this.roomEpoch) return;
    this.updateBlocks(dt);
    this.updateSwitches();
    this.updateEnemies(dt);
    if (this.phase !== 'play' || epoch !== this.roomEpoch) return;
    if (this.boss.active) this.updateBoss(dt);
    if (this.phase !== 'play' || epoch !== this.roomEpoch) return;
    this.updateProjectiles(dt);
    if (this.phase !== 'play' || epoch !== this.roomEpoch) return;
    this.updateBombs(dt);
    if (this.phase !== 'play' || epoch !== this.roomEpoch) return;
    this.updateBoomerang(dt);
  }

  // ----------------------------------------------------------------- player

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const epoch = this.roomEpoch;
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.swordT = Math.max(0, this.swordT - dt);
    this.swordCd = Math.max(0, this.swordCd - dt);
    this.bowCd = Math.max(0, this.bowCd - dt);
    this.bombCd = Math.max(0, this.bombCd - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);

    let mvx = 0;
    let mvy = 0;
    if (this.kbT > 0) {
      this.kbT -= dt;
      mvx = this.kbVX * dt;
      mvy = this.kbVY * dt;
      this.moving = false;
    } else {
      const h = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
      const v = (input.UP.held ? -1 : 0) + (input.DOWN.held ? 1 : 0);
      if (input.LEFT.pressed || input.RIGHT.pressed) this.lastAxis = 'h';
      if (input.UP.pressed || input.DOWN.pressed) this.lastAxis = 'v';
      let dx = 0;
      let dy = 0;
      if (h !== 0 && v !== 0) {
        if (this.lastAxis === 'h') dx = h;
        else dy = v;
      } else {
        dx = h;
        dy = v;
      }
      if (dx !== 0) this.facing = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
      this.moving = dx !== 0 || dy !== 0;
      mvx = dx * PLAYER_SPEED * dt;
      mvy = dy * PLAYER_SPEED * dt;

      if (input.B.pressed && this.swordCd <= 0) {
        this.swordT = SWORD_TIME;
        this.swordCd = SWORD_COOLDOWN;
        this.swingId++;
        this.engine.sfx.play('shoot');
      }
      if (input.Y.pressed) this.useSecondary();
      if (input.A.pressed) this.tryInteract();
    }

    this.pbox.x = this.px;
    this.pbox.y = this.py;
    const moved = moveAABB(this.playerGrid, this.pbox, mvx, mvy);
    this.px = moved.x;
    this.py = moved.y;

    if (this.tryRoomTransition()) return;
    this.px = Math.max(0, Math.min(ROOM_W - PLAYER_W, this.px));
    this.py = Math.max(0, Math.min(ROOM_H - PLAYER_H, this.py));
    this.pbox.x = this.px;
    this.pbox.y = this.py;

    // Bumping into locked doors / pushable blocks.
    if (this.kbT <= 0 && (moved.hitX || moved.hitY) && (mvx !== 0 || mvy !== 0)) {
      const dx = moved.hitX ? Math.sign(mvx) : 0;
      const dy = !moved.hitX && moved.hitY ? Math.sign(mvy) : 0;
      if (dx !== 0 || dy !== 0) {
        const probeX = this.px + PLAYER_W / 2 + dx * (PLAYER_W / 2 + 3);
        const probeY = this.py + PLAYER_H / 2 + dy * (PLAYER_H / 2 + 3);
        const tx = Math.floor(probeX / TILE_SIZE);
        const ty = Math.floor(probeY / TILE_SIZE);
        const k = this.kindAt(tx, ty);
        if (k === 'doorLocked' || k === 'doorBoss') {
          if (this.bumpCd <= 0) this.tryUnlock(tx, ty);
          this.pushT = 0;
        } else {
          const blk = this.blockAt(tx, ty);
          if (blk && !blk.sliding) {
            if (this.pushDX === dx && this.pushDY === dy) this.pushT += dt;
            else {
              this.pushT = dt;
              this.pushDX = dx;
              this.pushDY = dy;
            }
            if (this.pushT >= PUSH_DELAY) {
              this.tryPushBlock(blk, dx, dy);
              this.pushT = 0;
            }
          } else {
            this.pushT = 0;
          }
        }
      }
    } else {
      this.pushT = 0;
    }

    // Hazard tiles (deactivated while all switches are pressed).
    if (this.hazardsActive && this.invulnT <= 0) {
      const ctx = Math.floor((this.px + PLAYER_W / 2) / TILE_SIZE);
      const cty = Math.floor((this.py + PLAYER_H / 2) / TILE_SIZE);
      if (this.kindAt(ctx, cty) === 'hazard') {
        this.hurtPlayer(ctx * TILE_SIZE + 8, cty * TILE_SIZE + 8, PLAYER_KB);
        if (this.roomEpoch !== epoch || this.phase !== 'play') return;
      }
    }

    if (this.swordT > 0) this.updateSwordHits();
  }

  private tryRoomTransition(): boolean {
    if (this.sealed) return false;
    const cx = this.px + PLAYER_W / 2;
    const cy = this.py + PLAYER_H / 2;
    const inNS = cx >= 11 * TILE_SIZE && cx < 13 * TILE_SIZE;
    const inEW = cy >= 5 * TILE_SIZE && cy < 7 * TILE_SIZE;
    if (this.py < 2 && inNS && this.doorIsOpen('n')) return this.goThrough('n');
    if (this.py + PLAYER_H > ROOM_H - 2 && inNS && this.doorIsOpen('s')) return this.goThrough('s');
    if (this.px + PLAYER_W > ROOM_W - 2 && inEW && this.doorIsOpen('e')) return this.goThrough('e');
    if (this.px < 2 && inEW && this.doorIsOpen('w')) return this.goThrough('w');
    return false;
  }

  private doorIsOpen(dir: Dir): boolean {
    for (const d of this.doors) {
      if (d.dir !== dir) continue;
      const c = d.cells[0]!;
      return this.kindAt(c.tx, c.ty) === 'doorOpen' && d.neighbor >= 0;
    }
    return false;
  }

  private goThrough(dir: Dir): boolean {
    let neighbor = -1;
    for (const d of this.doors) if (d.dir === dir) neighbor = d.neighbor;
    if (neighbor < 0) return false;
    const midX = 12 * TILE_SIZE - PLAYER_W / 2;
    const midY = 6 * TILE_SIZE - PLAYER_H / 2;
    let x = midX;
    let y = midY;
    if (dir === 'n') {
      x = midX;
      y = ROOM_H - TILE_SIZE - PLAYER_H - 2; // just inside the south door
    } else if (dir === 's') {
      x = midX;
      y = TILE_SIZE + 2;
    } else if (dir === 'e') {
      x = TILE_SIZE + 2;
      y = midY;
    } else {
      x = ROOM_W - TILE_SIZE - PLAYER_W - 2;
      y = midY;
    }
    this.enterRoom(neighbor, x, y);
    return true;
  }

  private tryUnlock(tx: number, ty: number): void {
    for (const d of this.doors) {
      let hit = false;
      for (const c of d.cells) if (c.tx === tx && c.ty === ty) hit = true;
      if (!hit) continue;
      const k = this.kindAt(tx, ty);
      if (k !== 'doorLocked' && k !== 'doorBoss') return;
      this.bumpCd = 0.6;
      if (this.keys > 0) {
        this.keys--;
        this.hud.keys = this.keys;
        if (d.neighbor >= 0) this.openedDoors.add(this.pairKey(this.roomIx, d.neighbor));
        for (const c of d.cells) this.kinds[c.ty * COLS + c.tx] = 'doorOpen';
        this.engine.sfx.play('powerup');
        const c0 = d.cells[0]!;
        this.engine.particles.burst(c0.tx * TILE_SIZE + 16, c0.ty * TILE_SIZE + 8, 14, {
          color: this.spec.palette[13] ?? '#ffd75e',
          speed: 60,
          gravity: 20,
        });
      } else {
        this.showFloat('(need a key)');
        this.engine.sfx.play('uiBack');
      }
      return;
    }
  }

  private tryPushBlock(b: BlockObj, dx: number, dy: number): void {
    const nx = b.tx + dx;
    const ny = b.ty + dy;
    if (nx < 1 || nx > COLS - 2 || ny < 1 || ny > ROWS - 2) return;
    const k = this.kindAt(nx, ny);
    if (k !== 'floor' && k !== 'switch') return;
    if (this.blockAt(nx, ny)) return;
    this.tmpBox.x = nx * TILE_SIZE;
    this.tmpBox.y = ny * TILE_SIZE;
    this.tmpBox.w = TILE_SIZE;
    this.tmpBox.h = TILE_SIZE;
    for (const e of this.ents) {
      if (e.active && aabbOverlap(this.tmpBox, e)) return;
    }
    if (aabbOverlap(this.tmpBox, this.pbox)) return;
    b.toTx = nx;
    b.toTy = ny;
    b.sliding = true;
  }

  private updateBlocks(dt: number): void {
    for (const b of this.blocks) {
      if (!b.active || !b.sliding) continue;
      const gx = b.toTx * TILE_SIZE;
      const gy = b.toTy * TILE_SIZE;
      const step = BLOCK_SLIDE_SPEED * dt;
      const dx = gx - b.x;
      const dy = gy - b.y;
      if (Math.abs(dx) <= step && Math.abs(dy) <= step) {
        b.x = gx;
        b.y = gy;
        b.tx = b.toTx;
        b.ty = b.toTy;
        b.sliding = false;
      } else {
        b.x += Math.sign(dx) * Math.min(step, Math.abs(dx));
        b.y += Math.sign(dy) * Math.min(step, Math.abs(dy));
      }
    }
  }

  private updateSwitches(): void {
    if (this.switchCells.length === 0) {
      this.hazardsActive = true;
      return;
    }
    let pressed = 0;
    const pcx = Math.floor((this.px + PLAYER_W / 2) / TILE_SIZE);
    const pcy = Math.floor((this.py + PLAYER_H / 2) / TILE_SIZE);
    for (const s of this.switchCells) {
      let on = pcx === s.tx && pcy === s.ty;
      if (!on) {
        for (const b of this.blocks) {
          if (!b.active) continue;
          if (Math.floor((b.x + 8) / TILE_SIZE) === s.tx && Math.floor((b.y + 8) / TILE_SIZE) === s.ty) {
            on = true;
            break;
          }
        }
      }
      if (on && !s.pressed) this.engine.sfx.play('uiSelect');
      s.pressed = on;
      if (on) pressed++;
    }
    this.hazardsActive = pressed < this.switchCells.length;
  }

  // ------------------------------------------------------------ sword & items

  private setSwordBox(): void {
    const b = this.swordBox;
    if (this.facing === 'right') {
      b.x = this.px + PLAYER_W;
      b.y = this.py + PLAYER_H / 2 - 7;
      b.w = 16;
      b.h = 14;
    } else if (this.facing === 'left') {
      b.x = this.px - 16;
      b.y = this.py + PLAYER_H / 2 - 7;
      b.w = 16;
      b.h = 14;
    } else if (this.facing === 'up') {
      b.x = this.px + PLAYER_W / 2 - 7;
      b.y = this.py - 16;
      b.w = 14;
      b.h = 16;
    } else {
      b.x = this.px + PLAYER_W / 2 - 7;
      b.y = this.py + PLAYER_H;
      b.w = 14;
      b.h = 16;
    }
  }

  private updateSwordHits(): void {
    this.setSwordBox();
    for (const e of this.ents) {
      if (!e.active || !isEnemyType(e.type)) continue;
      if (e.lastSwing === this.swingId) continue;
      if (!aabbOverlap(this.swordBox, e)) continue;
      e.lastSwing = this.swingId;
      this.damageEnemy(e, 1, SWORD_KB);
    }
    const b = this.boss;
    if (b.active && b.visible && b.invulnT <= 0 && aabbOverlap(this.swordBox, b)) {
      this.damageBoss(1);
    }
  }

  private useSecondary(): void {
    if (!this.hasItem) {
      this.engine.sfx.play('uiBack');
      this.showFloat('(no item yet)');
      return;
    }
    const fx = this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : 0;
    const fy = this.facing === 'up' ? -1 : this.facing === 'down' ? 1 : 0;
    const cx = this.px + PLAYER_W / 2;
    const cy = this.py + PLAYER_H / 2;
    switch (this.dungeon.items.secondary) {
      case 'boomerang': {
        if (this.boom.active) break;
        this.boom.active = true;
        this.boom.back = false;
        this.boom.t = 0;
        this.boom.x = cx;
        this.boom.y = cy;
        this.boom.sx = cx;
        this.boom.sy = cy;
        this.boom.vx = fx * BOOM_SPEED;
        this.boom.vy = fy * BOOM_SPEED;
        this.engine.sfx.play('shoot');
        break;
      }
      case 'bombs': {
        if (this.bombCd > 0) break;
        for (const bm of this.bombs) {
          if (bm.active) continue;
          bm.active = true;
          bm.x = cx;
          bm.y = cy;
          bm.fuseT = BOMB_FUSE;
          this.bombCd = BOMB_COOLDOWN;
          this.engine.sfx.play('uiSelect');
          break;
        }
        break;
      }
      case 'bow': {
        if (this.bowCd > 0) break;
        let airborne = 0;
        for (const p of this.projs) if (p.active && p.friendly && p.arrow) airborne++;
        if (airborne >= MAX_ARROWS) break;
        if (this.fireProj(cx + fx * 10, cy + fy * 10, fx * ARROW_SPEED, fy * ARROW_SPEED, true, true)) {
          this.bowCd = BOW_COOLDOWN;
          this.engine.sfx.play('shoot');
        }
        break;
      }
    }
  }

  private tryInteract(): void {
    const cx = this.px + PLAYER_W / 2;
    const cy = this.py + PLAYER_H / 2;
    for (const e of this.ents) {
      if (!e.active || e.type !== 'npc') continue;
      const dx = e.x + e.w / 2 - cx;
      const dy = e.y + e.h / 2 - cy;
      if (Math.hypot(dx, dy) > 20) continue;
      this.engine.cards.show([
        { title: 'KEEPER', lines: [e.props.dialog ?? '...'], portrait: null },
      ]);
      return;
    }
  }

  private showFloat(text: string): void {
    this.floatText = text;
    this.floatT = 1;
    this.floatX = this.px + PLAYER_W / 2;
    this.floatY = this.py;
  }

  // ------------------------------------------------------------- hurt & death

  private hurtPlayer(srcX: number, srcY: number, kbPx: number): void {
    if (this.invulnT > 0) return;
    this.hud.health--;
    this.invulnT = FEEL.invulnMs / 1000;
    const dx = this.px + PLAYER_W / 2 - srcX;
    const dy = this.py + PLAYER_H / 2 - srcY;
    const len = Math.max(1, Math.hypot(dx, dy));
    this.kbT = 0.25;
    this.kbVX = (dx / len) * (kbPx / 0.25);
    this.kbVY = (dy / len) * (kbPx / 0.25);
    this.engine.sfx.play('hurt');
    this.engine.shake(FEEL.screenShakeMs, 3);
    this.engine.hitStop(FEEL.hitStopMs);
    if (this.hud.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    this.hud.lives--;
    this.engine.sfx.play('die');
    this.engine.particles.burst(this.px + PLAYER_W / 2, this.py + PLAYER_H / 2, 18, {
      color: this.spec.palette[5] ?? '#38b764',
      speed: 120,
    });
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
    this.hud.health = Math.min(3, this.hud.maxHealth);
    if (this.boss.active && this.roomIx === this.bossIx) {
      // Boss retry in place: boss keeps its HP, everyone repositions.
      this.roomEpoch++;
      this.px = this.checkpoint.x;
      this.py = this.checkpoint.y;
      this.resetTransient();
      const b = this.boss;
      b.mode = 'idle';
      b.t = 0;
      b.visible = true;
      this.placeBoss();
    } else {
      this.enterRoom(this.checkpoint.roomIx, this.checkpoint.x, this.checkpoint.y);
    }
    this.invulnT = 1.5;
  }

  // ---------------------------------------------------------------- entities

  private updateEnemies(dt: number): void {
    const epoch = this.roomEpoch;
    for (const e of this.ents) {
      if (!e.active) continue;
      e.t += dt;
      e.hitT = Math.max(0, e.hitT - dt);
      if (!isEnemyType(e.type)) {
        if (e.type !== 'npc' && aabbOverlap(this.pbox, e)) this.collect(e);
        continue;
      }

      if (e.kbT > 0) {
        e.kbT -= dt;
        const m = moveAABB(this.entGrid, e, e.kbX * dt, e.kbY * dt);
        e.x = m.x;
        e.y = m.y;
      } else if (e.stunT > 0) {
        e.stunT -= dt;
      } else {
        this.runEnemyAI(e, dt);
      }

      if (this.invulnT <= 0 && aabbOverlap(this.pbox, e)) {
        this.hurtPlayer(e.x + e.w / 2, e.y + e.h / 2, e.type === 'bruiser' ? 130 : PLAYER_KB);
        if (this.roomEpoch !== epoch || this.phase !== 'play') return;
      }
    }
  }

  private runEnemyAI(e: Ent, dt: number): void {
    const pcx = this.px + PLAYER_W / 2;
    const pcy = this.py + PLAYER_H / 2;
    const ecx = e.x + e.w / 2;
    const ecy = e.y + e.h / 2;
    switch (e.type) {
      case 'walker': {
        const speed = 40 * (e.props.speed ?? 1);
        e.wanderT -= dt;
        if (e.wanderT <= 0) this.pickWanderDir(e);
        const m = moveAABB(this.entGrid, e, e.dirX * speed * dt, e.dirY * speed * dt);
        e.x = m.x;
        e.y = m.y;
        if (m.hitX || m.hitY) this.pickWanderDir(e);
        break;
      }
      case 'flyer': {
        const speed = 40 * (e.props.speed ?? 1);
        if (e.pauseT > 0) {
          e.pauseT -= dt;
        } else {
          e.chaseT += dt;
          const dx = pcx - ecx;
          const dy = pcy - ecy;
          const len = Math.max(1, Math.hypot(dx, dy));
          e.x += (dx / len) * speed * dt;
          e.y += (dy / len) * speed * dt;
          e.dirX = dx >= 0 ? 1 : -1;
          if (e.chaseT >= 2) {
            e.chaseT = 0;
            e.pauseT = 0.5;
          }
        }
        e.x = Math.max(TILE_SIZE, Math.min(ROOM_W - TILE_SIZE - e.w, e.x));
        e.y = Math.max(TILE_SIZE, Math.min(ROOM_H - TILE_SIZE - e.h, e.y));
        break;
      }
      case 'shooter': {
        e.fireT += dt;
        e.dirX = pcx >= ecx ? 1 : -1;
        if (e.fireT >= 2.2 / this.diff.fire) {
          e.fireT = 0;
          const dx = pcx - ecx;
          const dy = pcy - ecy;
          const len = Math.max(1, Math.hypot(dx, dy));
          this.fireProj(ecx, ecy, (dx / len) * ENEMY_SHOT_SPEED, (dy / len) * ENEMY_SHOT_SPEED, false, false);
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'chaser':
      case 'bruiser': {
        const speed = (e.type === 'chaser' ? 70 : 30) * (e.props.speed ?? 1);
        const dx = pcx - ecx;
        const dy = pcy - ecy;
        const len = Math.max(1, Math.hypot(dx, dy));
        const m = moveAABB(this.entGrid, e, (dx / len) * speed * dt, (dy / len) * speed * dt);
        e.x = m.x;
        e.y = m.y;
        e.dirX = dx >= 0 ? 1 : -1;
        break;
      }
      case 'npc':
      case 'key':
      case 'heart':
      case 'item':
        break;
    }
  }

  private pickWanderDir(e: Ent): void {
    const r = this.engine.rng.int(0, 3);
    e.dirX = r === 0 ? 1 : r === 1 ? -1 : 0;
    e.dirY = r === 2 ? 1 : r === 3 ? -1 : 0;
    e.wanderT = this.engine.rng.range(0.7, 1.8);
  }

  private damageEnemy(e: Ent, dmg: number, kbPx: number): void {
    e.hp -= dmg;
    e.hitT = 0.3;
    const dx = e.x + e.w / 2 - (this.px + PLAYER_W / 2);
    const dy = e.y + e.h / 2 - (this.py + PLAYER_H / 2);
    const len = Math.max(1, Math.hypot(dx, dy));
    e.kbT = 0.2;
    e.kbX = (dx / len) * (kbPx / 0.2);
    e.kbY = (dy / len) * (kbPx / 0.2);
    this.engine.sfx.play('hit');
    this.engine.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 5, {
      color: this.spec.palette[8] ?? '#b13e53',
      speed: 70,
    });
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Ent): void {
    e.active = false;
    this.hud.score += this.spec.scoring.events.enemyKill;
    this.engine.hitStop(40);
    this.engine.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 12, {
      color: this.spec.palette[8] ?? '#b13e53',
      speed: 90,
    });
    if (this.engine.rng.chance(0.15)) {
      this.spawnEnt('heart', e.x + e.w / 2, e.y + e.h / 2, -1, {});
    }
  }

  private collect(e: Ent): void {
    e.active = false;
    if (e.specIx >= 0) this.collected.add(`${this.roomIx}:${e.specIx}`);
    switch (e.type) {
      case 'key':
        this.keys++;
        this.hud.keys = this.keys;
        this.hud.score += this.spec.scoring.events.pickup;
        this.engine.sfx.play('pickup');
        this.engine.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 6, {
          color: this.spec.palette[13] ?? '#ffd75e',
          speed: 45,
          gravity: 60,
        });
        break;
      case 'heart':
        this.hud.health = Math.min(this.hud.maxHealth, this.hud.health + 1);
        this.hud.score += this.spec.scoring.events.pickup;
        this.engine.sfx.play('pickup');
        break;
      case 'item':
        this.hasItem = true;
        this.hud.score += this.spec.scoring.events.pickup;
        this.engine.sfx.play('powerup');
        this.engine.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 16, {
          color: this.spec.palette[7] ?? '#ffcd75',
          speed: 60,
          gravity: -20,
        });
        this.showFloat(`GOT THE ${this.dungeon.items.secondary.toUpperCase()}!`);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------- boss

  private spawnBoss(): void {
    const b = this.boss;
    b.active = true;
    b.visible = true;
    b.hp = this.spec.boss.hp;
    b.maxHp = this.spec.boss.hp;
    b.phaseIx = 0;
    b.invulnT = 0;
    b.mode = 'idle';
    b.t = 0;
    b.vx = 0;
    b.vy = 0;
    b.angle = 0;
    b.emitT = 0;
    b.emits = 0;
    this.placeBoss();
    this.hud.boss = { hp: b.hp, maxHp: b.maxHp, name: this.spec.boss.name };
  }

  private placeBoss(): void {
    const cell = this.findSpawnCell(12, 4);
    this.boss.x = cell.tx * TILE_SIZE + 8 - this.boss.w / 2;
    this.boss.y = cell.ty * TILE_SIZE + 8 - this.boss.h / 2;
  }

  private bossFitsAt(x: number, y: number): boolean {
    if (x < TILE_SIZE || y < TILE_SIZE || x + 24 > ROOM_W - TILE_SIZE || y + 24 > ROOM_H - TILE_SIZE) return false;
    const pts = 23;
    for (let iy = 0; iy <= 1; iy++) {
      for (let ix = 0; ix <= 1; ix++) {
        const tx = Math.floor((x + 1 + ix * pts) / TILE_SIZE);
        const ty = Math.floor((y + 1 + iy * pts) / TILE_SIZE);
        if (this.solidity(tx, ty, true) === 'solid') return false;
      }
    }
    return true;
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    b.t += dt;
    b.invulnT = Math.max(0, b.invulnT - dt);
    const phases = this.spec.boss.phases;
    const phaseIx = Math.min(phases.length - 1, Math.floor((1 - b.hp / b.maxHp) * phases.length));
    if (phaseIx !== b.phaseIx) {
      b.phaseIx = phaseIx;
      this.engine.shake(300, 4);
      this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 20, {
        color: this.spec.palette[11] ?? '#e04040',
        speed: 130,
      });
    }
    const phase = phases[b.phaseIx]!;
    const tempo = phase.tempo;
    if (b.mode !== 'charge') b.dirX = this.px >= b.x ? 1 : -1;

    switch (b.mode) {
      case 'idle': {
        if (b.t >= 1.2 / tempo) this.startBossPattern(phase.pattern);
        break;
      }
      case 'telegraph': {
        if (b.t >= 0.5) {
          const dx = this.px + PLAYER_W / 2 - (b.x + b.w / 2);
          const dy = this.py + PLAYER_H / 2 - (b.y + b.h / 2);
          const len = Math.max(1, Math.hypot(dx, dy));
          b.vx = (dx / len) * 200 * tempo;
          b.vy = (dy / len) * 200 * tempo;
          b.mode = 'charge';
          b.t = 0;
        }
        break;
      }
      case 'charge': {
        const m = moveAABB(this.entGrid, b, b.vx * dt, b.vy * dt);
        b.x = m.x;
        b.y = m.y;
        if (m.hitX) {
          b.vx = -b.vx;
          this.engine.shake(120, 2);
        }
        if (m.hitY) {
          b.vy = -b.vy;
          this.engine.shake(120, 2);
        }
        if (b.t >= 2.2) {
          b.mode = 'idle';
          b.t = 0;
        }
        break;
      }
      case 'vanish': {
        if (b.t >= 0.6) {
          this.teleportBoss();
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            this.fireProj(
              b.x + b.w / 2, b.y + b.h / 2,
              Math.cos(a) * BOSS_SHOT_SPEED, Math.sin(a) * BOSS_SHOT_SPEED,
              false, false,
            );
          }
          this.engine.sfx.play('shoot');
          b.visible = true;
          b.mode = 'idle';
          b.t = 0;
        }
        break;
      }
      case 'spiral': {
        b.emitT += dt;
        const interval = 0.5 / tempo;
        if (b.emitT >= interval) {
          b.emitT -= interval;
          for (let i = 0; i < 4; i++) {
            const a = b.angle + (i * Math.PI) / 2;
            this.fireProj(
              b.x + b.w / 2, b.y + b.h / 2,
              Math.cos(a) * BOSS_SHOT_SPEED, Math.sin(a) * BOSS_SHOT_SPEED,
              false, false,
            );
          }
          b.angle += Math.PI / 6; // 30 degrees per emission
          b.emits++;
          this.engine.sfx.play('shoot');
          if (b.emits >= 6) {
            b.mode = 'idle';
            b.t = 0;
          }
        }
        break;
      }
    }

    if (b.visible && this.invulnT <= 0 && aabbOverlap(this.pbox, b)) {
      this.hurtPlayer(b.x + b.w / 2, b.y + b.h / 2, 110);
    }
    if (b.active) this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
  }

  private startBossPattern(pattern: 'charge' | 'teleport' | 'spiral' | 'summon'): void {
    const b = this.boss;
    b.t = 0;
    switch (pattern) {
      case 'charge':
        b.mode = 'telegraph';
        break;
      case 'teleport':
        b.mode = 'vanish';
        b.visible = false;
        this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 10, {
          color: this.spec.palette[10] ?? '#5d275d',
          speed: 60,
          gravity: 0,
        });
        break;
      case 'spiral':
        b.mode = 'spiral';
        b.emitT = 0;
        b.emits = 0;
        break;
      case 'summon': {
        let summons = 0;
        for (const e of this.ents) if (e.active && e.type === 'walker' && e.specIx === -2) summons++;
        for (let i = summons; i < 2; i++) {
          const cell = this.findSpawnCell(
            Math.floor((b.x + b.w / 2) / TILE_SIZE) - 2 + i * 4,
            Math.floor((b.y + b.h / 2) / TILE_SIZE) + 1,
          );
          const m = this.spawnEnt('walker', cell.tx * TILE_SIZE + 8, cell.ty * TILE_SIZE + 8, -2, { speed: 1.2 });
          if (m) {
            this.engine.particles.burst(m.x + m.w / 2, m.y + m.h / 2, 8, {
              color: this.spec.palette[10] ?? '#5d275d',
              speed: 70,
            });
          }
        }
        b.mode = 'idle';
        break;
      }
    }
  }

  private teleportBoss(): void {
    const b = this.boss;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = this.engine.rng.range(0, Math.PI * 2);
      const x = this.px + PLAYER_W / 2 + Math.cos(a) * 3 * TILE_SIZE - b.w / 2;
      const y = this.py + PLAYER_H / 2 + Math.sin(a) * 3 * TILE_SIZE - b.h / 2;
      if (this.bossFitsAt(x, y)) {
        b.x = x;
        b.y = y;
        this.engine.particles.burst(x + b.w / 2, y + b.h / 2, 10, {
          color: this.spec.palette[10] ?? '#5d275d',
          speed: 60,
          gravity: 0,
        });
        return;
      }
    }
    this.placeBoss();
  }

  private damageBoss(dmg: number): void {
    const b = this.boss;
    if (!b.active || !b.visible || b.invulnT > 0) return;
    b.hp -= dmg;
    b.invulnT = 0.4;
    this.hud.score += this.spec.scoring.events.bossHit;
    this.engine.sfx.play('hit');
    this.engine.hitStop(FEEL.hitStopMs);
    this.engine.shake(150, 2);
    this.engine.particles.burst(b.x + b.w / 2, b.y + 4, 12, {
      color: this.spec.palette[9] ?? '#ef7d57',
      speed: 100,
    });
    if (b.hp <= 0) this.defeatBoss();
  }

  private defeatBoss(): void {
    const b = this.boss;
    b.active = false;
    this.sealed = false;
    this.bossDefeated = true;
    this.hud.boss = undefined;
    this.hud.score += this.spec.scoring.events.levelClear;
    this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 40, {
      color: this.spec.palette[12] ?? '#ffa300',
      speed: 160,
      life: 1,
    });
    this.engine.shake(500, 5);
    this.engine.music.stopSong();
    this.phase = 'cards';
    this.engine.cards.show(
      this.spec.story.victory.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
      () => {
        const par = estimateAdventureDurationS(this.spec) * 1.35;
        this.result = {
          outcome: 'won',
          score: this.hud.score,
          timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
        };
      },
    );
  }

  // ------------------------------------------------------------- projectiles

  private fireProj(x: number, y: number, vx: number, vy: number, friendly: boolean, arrow: boolean): boolean {
    for (const p of this.projs) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.friendly = friendly;
      p.arrow = arrow;
      p.t = 0;
      return true;
    }
    return false;
  }

  private updateProjectiles(dt: number): void {
    const epoch = this.roomEpoch;
    for (const p of this.projs) {
      if (!p.active) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t > 6 || p.x < 0 || p.y < 0 || p.x > ROOM_W || p.y > ROOM_H) {
        p.active = false;
        continue;
      }
      if (this.projBlockedAt(p.x, p.y)) {
        p.active = false;
        if (p.arrow) {
          this.engine.particles.burst(p.x, p.y, 4, { color: this.spec.palette[14] ?? '#94b0c2', speed: 40 });
        }
        continue;
      }
      this.projBox.x = p.x - 3;
      this.projBox.y = p.y - 3;
      if (p.friendly) {
        for (const e of this.ents) {
          if (!e.active || !isEnemyType(e.type)) continue;
          if (!aabbOverlap(this.projBox, e)) continue;
          p.active = false;
          this.damageEnemy(e, 1, 40);
          break;
        }
        const b = this.boss;
        if (p.active && b.active && b.visible && b.invulnT <= 0 && aabbOverlap(this.projBox, b)) {
          p.active = false;
          this.damageBoss(1);
        }
      } else if (this.invulnT <= 0 && aabbOverlap(this.projBox, this.pbox)) {
        p.active = false;
        this.hurtPlayer(p.x, p.y, PLAYER_KB);
        if (this.roomEpoch !== epoch || this.phase !== 'play') return;
      }
    }
  }

  private updateBombs(dt: number): void {
    for (const bm of this.bombs) {
      if (!bm.active) continue;
      bm.fuseT -= dt;
      if (bm.fuseT <= 0) {
        bm.active = false;
        this.explode(bm.x, bm.y);
        if (this.phase !== 'play') return;
      }
    }
  }

  private explode(x: number, y: number): void {
    this.engine.sfx.play('hit');
    this.engine.shake(250, 4);
    this.engine.particles.burst(x, y, 24, {
      color: this.spec.palette[12] ?? '#ffa300',
      speed: 140,
      life: 0.6,
      gravity: 40,
    });
    for (const e of this.ents) {
      if (!e.active || !isEnemyType(e.type)) continue;
      const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
      if (d <= BOMB_RADIUS + 6) this.damageEnemy(e, 2, 80);
    }
    const b = this.boss;
    if (b.active && b.visible && b.invulnT <= 0) {
      const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
      if (d <= BOMB_RADIUS + 12) this.damageBoss(2);
    }
    const pd = Math.hypot(this.px + PLAYER_W / 2 - x, this.py + PLAYER_H / 2 - y);
    if (pd <= BOMB_RADIUS) this.hurtPlayer(x, y, PLAYER_KB);
  }

  private updateBoomerang(dt: number): void {
    const bm = this.boom;
    if (!bm.active) return;
    bm.t += dt;
    if (!bm.back) {
      bm.x += bm.vx * dt;
      bm.y += bm.vy * dt;
      const d = Math.hypot(bm.x - bm.sx, bm.y - bm.sy);
      if (d >= BOOM_RANGE || bm.x < 8 || bm.y < 8 || bm.x > ROOM_W - 8 || bm.y > ROOM_H - 8) {
        bm.back = true;
      }
    } else {
      const dx = this.px + PLAYER_W / 2 - bm.x;
      const dy = this.py + PLAYER_H / 2 - bm.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) {
        bm.active = false;
        return;
      }
      bm.x += (dx / len) * BOOM_RETURN_SPEED * dt;
      bm.y += (dy / len) * BOOM_RETURN_SPEED * dt;
    }
    this.boomBox.x = bm.x - 5;
    this.boomBox.y = bm.y - 5;
    for (const e of this.ents) {
      if (!e.active) continue;
      if (!aabbOverlap(this.boomBox, e)) continue;
      if (isEnemyType(e.type)) {
        if (e.stunT <= 0) {
          e.stunT = 2;
          e.hitT = 0.2;
          this.engine.sfx.play('hit');
          this.engine.particles.burst(e.x + e.w / 2, e.y, 4, {
            color: this.spec.palette[14] ?? '#94b0c2',
            speed: 40,
            gravity: -20,
          });
        }
      } else if (e.type === 'key' || e.type === 'heart') {
        this.collect(e);
      }
    }
    const b = this.boss;
    if (b.active && b.visible && b.invulnT <= 0 && aabbOverlap(this.boomBox, b)) {
      this.damageBoss(1);
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const r = this.engine.renderer;
    const cam = this.engine.camera;
    r.clear(this.spec.palette[2] ?? '#1a1c2c');
    if (!this.roomReady) return;

    this.backdrop.draw(r.ctx, this.room.gridPos.x * 120, this.room.gridPos.y * 80);
    r.frame(VIEW_X - 2, VIEW_Y - 2, ROOM_W + 4, ROOM_H + 4, this.spec.palette[1] ?? '#10122b', 2);

    const frameIx = Math.floor(this.animT * 4) % 2;
    const floorFrames = this.tileFrames['floor']!;
    const wallFrames = this.tileFrames['wall']!;
    const pitFrames = this.tileFrames['pit']!;
    drawTileLayer(r, cam, COLS, ROWS, TILE_SIZE, (tx, ty) => {
      const k = this.kinds[ty * COLS + tx]!;
      const frames = k === 'wall' ? wallFrames : k === 'pit' ? pitFrames : floorFrames;
      return frames[frameIx % frames.length] ?? frames[0] ?? null;
    });

    // Guarantee obstacle contrast: wall/pit art shares the floor's base color,
    // so on a low-contrast palette (or the cabinet's dark LCD) they vanish into
    // the terrain. Stamp a palette-independent raised-block silhouette.
    drawObstacleShadows(
      r, cam, COLS, ROWS, TILE_SIZE,
      (tx, ty) => this.isObstacleTile(tx, ty),
      (tx, ty) => this.isTerrainTile(tx, ty),
    );

    // Decorations, switches, hazards on top of floor.
    const decoFrames = this.tileFrames['deco']!;
    for (const c of this.decoCells) {
      r.draw(decoFrames[0]!, c.tx * TILE_SIZE - cam.x, c.ty * TILE_SIZE - cam.y);
    }
    const switchFrames = this.tileFrames['switch']!;
    for (const s of this.switchCells) {
      const img = s.pressed && switchFrames.length > 1 ? switchFrames[1]! : switchFrames[0]!;
      r.draw(img, s.tx * TILE_SIZE - cam.x, s.ty * TILE_SIZE - cam.y);
    }
    const hazardFrames = this.tileFrames['hazard']!;
    for (const c of this.hazardCells) {
      const x = c.tx * TILE_SIZE - cam.x;
      const y = c.ty * TILE_SIZE - cam.y;
      r.draw(hazardFrames[frameIx % hazardFrames.length] ?? hazardFrames[0]!, x, y);
      if (!this.hazardsActive) r.rect(x, y, TILE_SIZE, TILE_SIZE, 'rgba(0,0,0,0.55)');
    }

    // Doors (sealed boss-room doors draw as walls).
    const lockedFrames = this.tileFrames['doorLocked']!;
    const bossFrames = this.tileFrames['doorBoss']!;
    const openFrames = this.tileFrames['doorOpen']!;
    for (const d of this.doors) {
      for (const c of d.cells) {
        const x = c.tx * TILE_SIZE - cam.x;
        const y = c.ty * TILE_SIZE - cam.y;
        if (this.sealed) {
          r.draw(wallFrames[0]!, x, y);
          continue;
        }
        const k = this.kinds[c.ty * COLS + c.tx]!;
        if (k === 'doorLocked') r.draw(lockedFrames[0]!, x, y);
        else if (k === 'doorBoss') r.draw(bossFrames[0]!, x, y);
        else r.draw(openFrames[0]!, x, y);
      }
    }

    // Blocks (free-standing pushables sit on floor — outline all four sides).
    const blockFrames = this.tileFrames['block']!;
    for (const b of this.blocks) {
      if (!b.active) continue;
      r.draw(blockFrames[0]!, b.x - cam.x, b.y - cam.y);
      drawObstacleTile(r, b.x - cam.x, b.y - cam.y, TILE_SIZE, true, true, true, true);
    }

    // Bombs (blink near the end of the fuse).
    for (const bm of this.bombs) {
      if (!bm.active) continue;
      const blink = bm.fuseT < 0.35 && Math.floor(this.animT * 16) % 2 === 0;
      const img = blink ? this.bombSprite.flash[0] ?? this.bombSprite.frames[0]! : this.bombSprite.frames[0]!;
      r.draw(img, bm.x - cam.x - this.bombSprite.w / 2, bm.y - cam.y - this.bombSprite.h / 2);
    }

    // Entities.
    for (const e of this.ents) {
      if (!e.active) continue;
      const flicker =
        (e.hitT > 0 && Math.floor(this.animT * 20) % 2 === 0) ||
        (e.stunT > 0 && Math.floor(this.animT * 10) % 2 === 0);
      if (flicker) continue;
      const sprite = this.sprites[e.type];
      if (!sprite) continue;
      const pickup = e.type === 'key' || e.type === 'heart' || e.type === 'item';
      const bob = pickup ? Math.sin(e.t * 4) * 1.5 : 0;
      const anim = isEnemyType(e.type) && e.stunT <= 0 ? 'walk' : 'idle';
      const img = this.engine.sprites.frame(sprite, anim, e.t, e.dirX > 0);
      r.draw(img, e.x - cam.x - (sprite.w - e.w) / 2, e.y - cam.y - (sprite.h - e.h) + bob);
    }

    // Boss.
    const b = this.boss;
    if (b.active && b.visible) {
      const sprite = this.sprites['boss']!;
      let bx = b.x - cam.x - (sprite.w - b.w) / 2;
      const by = b.y - cam.y - (sprite.h - b.h);
      if (b.mode === 'telegraph') bx += Math.sin(this.animT * 60) * 2;
      const anim = b.mode === 'telegraph' || b.mode === 'charge' ? 'attack' : b.invulnT > 0 ? 'hurt' : 'idle';
      const img = this.engine.sprites.frame(sprite, anim, this.animT, b.dirX > 0);
      r.draw(img, bx, by);
    }

    // Projectiles.
    const pelletSprite = this.sprites['enemyShot']!;
    for (const p of this.projs) {
      if (!p.active) continue;
      const sprite = p.arrow ? this.arrowSprite : pelletSprite;
      const img = this.engine.sprites.frame(sprite, 'idle', p.t, p.vx < 0);
      r.draw(img, p.x - cam.x - sprite.w / 2, p.y - cam.y - sprite.h / 2);
    }

    // Boomerang (spins by alternating flip).
    if (this.boom.active) {
      const img = this.engine.sprites.frame(this.boomSprite, 'idle', this.boom.t, Math.floor(this.boom.t * 10) % 2 === 0);
      r.draw(img, this.boom.x - cam.x - this.boomSprite.w / 2, this.boom.y - cam.y - this.boomSprite.h / 2);
    }

    // Player (invulnerability flicker) + sword slash.
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const anim = this.facing === 'up' ? 'up' : this.facing === 'down' ? 'down' : 'side';
      const t = this.moving ? this.animT : 0;
      const img = this.engine.sprites.frame(hero, anim, t, this.facing === 'left');
      r.draw(img, this.px - cam.x - (hero.w - PLAYER_W) / 2, this.py - cam.y - (hero.h - PLAYER_H));
    }
    if (this.swordT > 0) {
      this.setSwordBox();
      const img = this.engine.sprites.frame(this.waveSprite, 'idle', this.animT, this.facing === 'left');
      r.draw(
        img,
        this.swordBox.x - cam.x + (this.swordBox.w - this.waveSprite.w) / 2,
        this.swordBox.y - cam.y + (this.swordBox.h - this.waveSprite.h) / 2,
      );
    }

    // Floating hint text.
    if (this.floatT > 0) {
      const rise = (1 - this.floatT) * 10;
      r.text(this.floatText, this.floatX - cam.x, this.floatY - cam.y - 12 - rise, '#f4f4f4', { align: 'center' });
    }

    if (this.mapOpen) this.renderMap();
  }

  private roomKnown(ix: number): boolean {
    if (this.visited.has(ix)) return true;
    const room = this.dungeon.rooms[ix]!;
    for (const g of DOOR_GEOM) {
      if (room.doors[g.dir] === 'none') continue;
      const n = this.posIndex.get(`${room.gridPos.x + g.dx},${room.gridPos.y + g.dy}`);
      if (n !== undefined && this.visited.has(n)) return true;
    }
    return false;
  }

  private renderMap(): void {
    const r = this.engine.renderer;
    r.dim(0.75);
    const cw = 30;
    const ch = 20;
    const gap = 4;
    const gw = this.gMaxX - this.gMinX + 1;
    const gh = this.gMaxY - this.gMinY + 1;
    const totalW = gw * (cw + gap) - gap;
    const totalH = gh * (ch + gap) - gap;
    const ox = Math.round((INTERNAL_WIDTH - totalW) / 2);
    const oy = Math.round((INTERNAL_HEIGHT - totalH) / 2) + 6;
    r.text('MAP', INTERNAL_WIDTH / 2, oy - 26, '#ffd75e', { align: 'center' });
    for (let i = 0; i < this.dungeon.rooms.length; i++) {
      const room = this.dungeon.rooms[i]!;
      const visited = this.visited.has(i);
      if (!visited && !this.roomKnown(i)) continue;
      const x = ox + (room.gridPos.x - this.gMinX) * (cw + gap);
      const y = oy + (room.gridPos.y - this.gMinY) * (ch + gap);
      if (visited) {
        r.rect(x, y, cw, ch, this.spec.palette[3] ?? '#29366f');
        r.frame(x, y, cw, ch, this.spec.palette[4] ?? '#41a6f6');
      } else {
        r.rect(x, y, cw, ch, '#181a2a');
        r.frame(x, y, cw, ch, '#2a2c44');
      }
      if (i === this.bossIx) r.text('B', x + cw / 2, y + ch / 2 - 4, '#e04040', { align: 'center' });
      if (i === this.roomIx && Math.floor(this.mapT * 2) % 2 === 0) {
        r.frame(x - 2, y - 2, cw + 4, ch + 4, '#f4f4f4');
      }
    }
    r.text('(B / SELECT: close)', INTERNAL_WIDTH / 2, oy + totalH + 14, '#94b0c2', { align: 'center' });
  }
}
