// Fighter gameplay (1v1 arcade ladder, Street Fighter / Mortal Kombat feel).
// Two procedural articulated fighters on one stage; the player climbs a ladder
// of AI opponents, each a best-of-3 match, up to a boss fighter. The move set +
// frame data + round/match FSM + AI are hand-authored here (the model only
// authors bounded roster/story data — balance stays fixed). Controls per the
// canonical map: Y high punch, X high kick, B low punch, A low kick, L/R block,
// d-pad walk/jump/crouch, START pause (host-owned).
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
} from '@sparkade/engine';
import {
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  difficultyScale,
  type DifficultyScale,
  type FighterBuild,
  type FighterCharacter,
  type FighterSpec,
} from '@sparkade/shared';
import { drawFighter, type FighterColors, type FighterPose } from './figure';
import { estimateFighterDurationS } from './lint';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const FLOOR_Y = H - 30;
const STAGE_MIN = 26;
const STAGE_MAX = W - 26;
const GRAVITY = 900;
const JUMP_V = 330;
const WALK = 78;
const BODY_HALF = 12; // torso half-width for body collision + range
const ROUND_TIME = 60;
const ROUNDS_TO_WIN = 2;

type MoveId = 'punchHigh' | 'punchLow' | 'kickHigh' | 'kickLow' | 'airKick';
type Height = 'high' | 'low' | 'overhead';

interface Move {
  pose: FighterPose;
  startup: number;
  active: number;
  recovery: number;
  dmg: number;
  reach: number; // fist/foot distance from center at contact
  hitY: number; // vertical center of the hitbox (figure-local, negative up)
  height: Height;
  knockback: number;
  hitstun: number;
  blockstun: number;
  knockdown?: boolean;
}

const MOVES: Record<MoveId, Move> = {
  punchLow: { pose: 'punchLow', startup: 0.05, active: 0.04, recovery: 0.12, dmg: 5, reach: 24, hitY: -22, height: 'high', knockback: 24, hitstun: 0.24, blockstun: 0.14 },
  punchHigh: { pose: 'punchHigh', startup: 0.07, active: 0.05, recovery: 0.16, dmg: 8, reach: 28, hitY: -30, height: 'high', knockback: 34, hitstun: 0.3, blockstun: 0.18 },
  kickLow: { pose: 'kickLow', startup: 0.09, active: 0.06, recovery: 0.24, dmg: 9, reach: 30, hitY: -6, height: 'low', knockback: 48, hitstun: 0.32, blockstun: 0.2, knockdown: true },
  kickHigh: { pose: 'kickHigh', startup: 0.11, active: 0.06, recovery: 0.22, dmg: 12, reach: 32, hitY: -24, height: 'high', knockback: 66, hitstun: 0.36, blockstun: 0.22 },
  airKick: { pose: 'kickHigh', startup: 0.06, active: 0.16, recovery: 0.08, dmg: 9, reach: 26, hitY: -20, height: 'overhead', knockback: 30, hitstun: 0.3, blockstun: 0.18 },
};

type State = 'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'block' | 'hitstun' | 'blockstun' | 'ko';

interface Actor {
  x: number;
  y: number; // feet y (FLOOR_Y on ground; < FLOOR_Y airborne)
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  state: State;
  move: MoveId | null;
  moveT: number;
  airMove: boolean; // used its one air attack this jump
  hitDone: boolean;
  crouch: boolean;
  block: boolean;
  stunT: number;
  flashT: number;
  scale: number;
  colors: FighterColors;
  speedScale: number;
  powerScale: number;
  // AI
  ai: boolean;
  aiT: number;
  aiIntent: 'approach' | 'retreat' | 'attack' | 'block' | 'jump' | 'wait';
  aggression: number;
}

function buildScale(b: FighterBuild): number {
  return b === 'nimble' ? 0.94 : b === 'heavy' ? 1.16 : 1.05;
}

export function createFighterGame(engine: EngineContext, spec: FighterSpec): GameInstance {
  return new FighterGame(engine, spec);
}

class FighterGame implements GameInstance {
  hud: HudState = { score: 0, lives: 2, health: 0, maxHealth: 0, keys: 0, bombs: 0 };
  result: GameResult | null = null;

  private phase: 'cards' | 'fight' = 'cards';
  private roundPhase: 'ready' | 'fight' | 'over' = 'ready';
  private bout = 0; // 0..levels.length-1 = ladder rungs, levels.length = boss
  private roundNum = 1;
  private pWins = 0;
  private oWins = 0;
  private timer = ROUND_TIME;
  private phaseT = 0;
  private banner = '';
  private diff!: DifficultyScale;

  private p!: Actor;
  private o!: Actor;
  private backdrop: Backdrop;
  private bgVariant: BackdropVariant;

  constructor(
    private engine: EngineContext,
    private spec: FighterSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.bgVariant = pickVariant(this.spec.palette, this.spec.seed, this.spec.backdrop);
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed, this.bgVariant);
    // Init both actors so render() is safe during the pre-fight story cards.
    this.p = this.makeActor(this.playerChar(), false, 0);
    this.o = this.makeActor(this.opponentChar(), true, 0);
  }

  // ------------------------------------------------------------------- setup

  private colorsFor(slot: number): FighterColors {
    const pal = this.spec.palette;
    const at = (i: number): string => pal[Math.max(1, Math.min(15, i))] ?? '#ffffff';
    return {
      body: at(slot),
      limb: at(slot - 1),
      skin: at(slot >= 8 ? 10 : 7),
      trim: at(14),
      outline: at(1),
    };
  }

  private makeActor(c: FighterCharacter | undefined, ai: boolean, aggression: number): Actor {
    const build = c?.build ?? 'balanced';
    return {
      x: ai ? STAGE_MAX - 80 : STAGE_MIN + 80,
      y: FLOOR_Y,
      vx: 0,
      vy: 0,
      facing: ai ? -1 : 1,
      hp: c?.hp ?? 100,
      maxHp: c?.hp ?? 100,
      state: 'idle',
      move: null,
      moveT: 0,
      airMove: false,
      hitDone: false,
      crouch: false,
      block: false,
      stunT: 0,
      flashT: 0,
      scale: buildScale(build),
      colors: this.colorsFor(c?.colorSlot ?? (ai ? 8 : 5)),
      speedScale: Math.max(0.85, Math.min(1.15, c?.speedScale ?? 1)),
      powerScale: Math.max(0.85, Math.min(1.15, c?.powerScale ?? 1)),
      ai,
      aiT: 0,
      aiIntent: 'wait',
      aggression,
    };
  }

  private playerChar(): FighterCharacter {
    return this.spec.player ?? { name: 'HERO', build: 'balanced', colorSlot: 5, hp: 100 };
  }

  private opponentChar(): FighterCharacter {
    const boss = this.spec.boss;
    if (this.isBoss()) return { name: boss.name, build: boss.build, colorSlot: boss.colorSlot, hp: boss.hp, speedScale: boss.speedScale, powerScale: boss.powerScale };
    return this.spec.levels[this.bout]!.opponent;
  }

  private isBoss(): boolean {
    return this.bout >= this.spec.levels.length;
  }

  private opponentAggression(): number {
    // Later rungs + boss rage phases are more aggressive; difficulty scales it.
    const rung = this.bout / Math.max(1, this.spec.levels.length);
    let base = 0.7 + rung * 0.5; // 0.7 .. ~1.2
    if (this.isBoss()) {
      const b = this.spec.boss;
      const frac = this.o ? 1 - this.o.hp / this.o.maxHp : 0;
      const ph = b.phases[Math.min(b.phases.length - 1, Math.floor(frac * b.phases.length))];
      base = 1.1 * (ph?.aggression ?? 1.3);
    }
    return base * (0.8 + this.diff.fire * 0.3);
  }

  start(): void {
    const cards = this.spec.story.intro.map((line) => ({ title: this.spec.meta.title, lines: [line], portrait: this.engine.portrait }));
    this.engine.cards.show(cards, () => this.enterBout(0));
  }

  restart(): void {
    this.startRound(true);
    this.hud.lives = Math.max(this.hud.lives, 0);
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  private enterBout(ix: number): void {
    this.bout = ix;
    this.pWins = 0;
    this.oWins = 0;
    this.roundNum = 1;
    const boss = this.isBoss();
    const line = boss ? this.spec.story.bossIntro : this.spec.story.levelIntros[ix] ?? '...';
    const name = boss ? this.spec.boss.name : this.spec.levels[ix]!.name;
    this.phase = 'cards';
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show([{ title: name, lines: [line], portrait: this.engine.portrait }], () => {
      this.engine.music.playSong(boss ? 'boss' : this.spec.levels[ix]!.musicSong);
      this.startRound(true);
      this.phase = 'fight';
    });
  }

  private startRound(fresh: boolean): void {
    if (fresh) {
      this.p = this.makeActor(this.playerChar(), false, 0);
      this.o = this.makeActor(this.opponentChar(), true, this.opponentAggression());
    } else {
      this.resetActor(this.p, false);
      this.resetActor(this.o, true);
    }
    this.timer = ROUND_TIME;
    this.roundPhase = 'ready';
    this.phaseT = 0;
    this.banner = `ROUND ${this.roundNum}`;
    this.engine.camera.snap(0, 0);
  }

  private resetActor(a: Actor, ai: boolean): void {
    a.x = ai ? STAGE_MAX - 80 : STAGE_MIN + 80;
    a.y = FLOOR_Y;
    a.vx = 0;
    a.vy = 0;
    a.facing = ai ? -1 : 1;
    a.hp = a.maxHp;
    a.state = 'idle';
    a.move = null;
    a.stunT = 0;
    a.crouch = false;
    a.block = false;
    a.airMove = false;
    if (ai) a.aggression = this.opponentAggression();
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'fight') return;
    this.phaseT += dt;
    this.o.aggression = this.opponentAggression();

    if (this.roundPhase === 'ready') {
      // brief "ROUND n" then "FIGHT!"
      if (this.phaseT > 0.9 && this.banner.startsWith('ROUND')) this.banner = 'FIGHT!';
      if (this.phaseT > 1.7) {
        this.roundPhase = 'fight';
        this.banner = '';
        this.phaseT = 0;
      }
      this.faceOff();
      return;
    }
    if (this.roundPhase === 'over') {
      this.stepPhysics(this.p, dt); // let the loser fall/settle
      this.stepPhysics(this.o, dt);
      if (this.phaseT > 2.2) this.afterRound();
      return;
    }

    // live round
    this.timer = Math.max(0, this.timer - dt);
    this.faceOff();
    this.control(this.p, dt, input);
    this.aiControl(this.o, dt);
    this.stepActor(this.p, dt);
    this.stepActor(this.o, dt);
    this.resolveHits(this.p, this.o);
    this.resolveHits(this.o, this.p);
    this.bodyPush();

    if (this.p.hp <= 0 || this.o.hp <= 0 || this.timer <= 0) this.endRound();
  }

  private faceOff(): void {
    if (this.p.state !== 'ko' && this.o.state !== 'ko') {
      const dir = this.o.x >= this.p.x ? 1 : -1;
      if (this.p.state === 'idle' || this.p.state === 'walk') this.p.facing = dir;
      if (this.o.state === 'idle' || this.o.state === 'walk') this.o.facing = (dir === 1 ? -1 : 1);
    }
  }

  // ---------------------------------------------------------------- control

  private canAct(a: Actor): boolean {
    return a.state === 'idle' || a.state === 'walk' || a.state === 'crouch' || a.state === 'block';
  }

  private control(a: Actor, dt: number, input: InputSnapshot): void {
    if (a.state === 'ko') return;
    this.tickStun(a, dt);
    if (a.state === 'hitstun' || a.state === 'blockstun') return;

    const airborne = a.y < FLOOR_Y - 0.5;
    a.block = false;
    if (a.state === 'attack') return; // committed to the move; physics in stepActor

    if (!airborne) {
      const holdBlock = input.L.held || input.R.held;
      a.crouch = input.DOWN.held;
      // block only when holding back is not required here — hold L/R to guard
      if (holdBlock && this.canAct(a)) {
        a.block = true;
        a.state = 'block';
        a.vx = 0;
      } else {
        // movement
        const mv = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
        if (a.crouch) {
          a.state = 'crouch';
          a.vx = 0;
        } else if (mv !== 0) {
          a.state = 'walk';
          a.vx = mv * WALK * a.speedScale;
        } else {
          a.state = 'idle';
          a.vx = 0;
        }
        if (input.UP.pressed) {
          a.vy = -JUMP_V;
          a.state = 'jump';
          a.airMove = false;
          a.vx = mv * WALK * a.speedScale;
        }
      }
      // attacks (ground)
      if (this.canAct(a) || a.state === 'walk' || a.state === 'crouch') {
        const mid = a.crouch ? { hi: 'kickLow' as MoveId, lo: 'punchLow' as MoveId } : { hi: 'kickHigh' as MoveId, lo: 'punchLow' as MoveId };
        if (input.Y.pressed) this.startMove(a, a.crouch ? 'punchLow' : 'punchHigh');
        else if (input.B.pressed) this.startMove(a, 'punchLow');
        else if (input.X.pressed) this.startMove(a, mid.hi);
        else if (input.A.pressed) this.startMove(a, 'kickLow');
        void mid.lo;
      }
    } else {
      // air: one attack per jump
      a.state = 'jump';
      if (!a.airMove && (input.Y.pressed || input.X.pressed || input.A.pressed || input.B.pressed)) {
        a.airMove = true;
        this.startMove(a, 'airKick');
      }
    }
  }

  private startMove(a: Actor, id: MoveId): void {
    a.move = id;
    a.moveT = 0;
    a.hitDone = false;
    a.state = 'attack';
    this.engine.sfx.play('shoot');
  }

  // --------------------------------------------------------------------- AI

  private aiControl(a: Actor, dt: number): void {
    if (a.state === 'ko') return;
    this.tickStun(a, dt);
    if (a.state === 'hitstun' || a.state === 'blockstun' || a.state === 'attack') return;

    const foe = this.p;
    const dist = Math.abs(foe.x - a.x);
    const dir = foe.x >= a.x ? 1 : -1;
    const inRange = dist < 46;
    const foeAttacking = foe.state === 'attack' && foe.move !== null;
    const foeAirborne = foe.y < FLOOR_Y - 6;
    a.block = false;
    a.crouch = false;

    // Reactive block: if the foe has an active/starting strike in range, guard
    // (probability scales with aggression — a tougher AI blocks more reliably).
    if (foeAttacking && dist < 52) {
      const mv = MOVES[foe.move!];
      const guard = 0.55 + a.aggression * 0.2;
      if (this.engine.rng.chance(Math.min(0.95, guard))) {
        a.state = 'block';
        a.block = true;
        a.crouch = mv.height === 'low';
        a.vx = 0;
        return;
      }
    }
    // Anti-air: foe jumping in close → poke up.
    if (foeAirborne && dist < 60 && this.engine.rng.chance(0.5 + a.aggression * 0.2)) {
      a.facing = dir;
      this.startMove(a, 'kickHigh');
      return;
    }

    a.aiT -= dt;
    if (a.aiT <= 0) {
      a.aiT = this.engine.rng.range(0.18, 0.5) / Math.max(0.6, a.aggression);
      if (inRange) {
        a.aiIntent = this.engine.rng.chance(0.15 + a.aggression * 0.4) ? 'attack' : this.engine.rng.chance(0.3) ? 'retreat' : 'block';
      } else if (dist < 120) {
        a.aiIntent = this.engine.rng.chance(0.8) ? 'approach' : 'jump';
      } else {
        a.aiIntent = 'approach';
      }
    }

    a.facing = dir;
    switch (a.aiIntent) {
      case 'approach':
        a.state = 'walk';
        a.vx = dir * WALK * a.speedScale * 0.9;
        break;
      case 'retreat':
        a.state = 'walk';
        a.vx = -dir * WALK * a.speedScale * 0.8;
        break;
      case 'attack':
        if (inRange) {
          const roll = this.engine.rng.range(0, 1);
          this.startMove(a, roll < 0.35 ? 'punchLow' : roll < 0.6 ? 'punchHigh' : roll < 0.82 ? 'kickLow' : 'kickHigh');
        } else {
          a.state = 'walk';
          a.vx = dir * WALK * a.speedScale;
        }
        break;
      case 'block':
        a.state = 'block';
        a.block = true;
        a.vx = 0;
        break;
      case 'jump':
        if (a.y >= FLOOR_Y - 0.5) {
          a.vy = -JUMP_V;
          a.state = 'jump';
          a.airMove = false;
          a.vx = dir * WALK * a.speedScale;
        }
        break;
      default:
        a.state = 'idle';
        a.vx = 0;
    }
  }

  // ------------------------------------------------------------- simulation

  private tickStun(a: Actor, dt: number): void {
    if (a.stunT > 0) {
      a.stunT -= dt;
      if (a.stunT <= 0 && (a.state === 'hitstun' || a.state === 'blockstun')) a.state = 'idle';
    }
    if (a.flashT > 0) a.flashT -= dt;
  }

  private stepActor(a: Actor, dt: number): void {
    if (a.state === 'ko') {
      this.stepPhysics(a, dt);
      return;
    }
    if (a.state === 'attack' && a.move) {
      a.moveT += dt;
      const m = MOVES[a.move];
      if (a.moveT >= m.startup + m.active + m.recovery) {
        a.move = null;
        a.state = a.y < FLOOR_Y - 0.5 ? 'jump' : 'idle';
      }
    }
    this.stepPhysics(a, dt);
  }

  private stepPhysics(a: Actor, dt: number): void {
    a.x += a.vx * dt;
    a.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, a.x));
    // airborne
    if (a.y < FLOOR_Y - 0.5 || a.vy < 0) {
      a.vy += GRAVITY * dt;
      a.y += a.vy * dt;
      if (a.y >= FLOOR_Y) {
        a.y = FLOOR_Y;
        a.vy = 0;
        a.airMove = false;
        if (a.state === 'jump') a.state = 'idle';
      }
    }
  }

  private bodyPush(): void {
    // keep the two bodies from overlapping
    const d = this.o.x - this.p.x;
    const min = BODY_HALF * (this.p.scale + this.o.scale);
    if (Math.abs(d) < min && Math.abs(this.p.y - this.o.y) < 24) {
      const push = (min - Math.abs(d)) / 2;
      const s = d >= 0 ? 1 : -1;
      this.p.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, this.p.x - s * push));
      this.o.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, this.o.x + s * push));
    }
  }

  // ------------------------------------------------------------------ hits

  private resolveHits(att: Actor, def: Actor): void {
    if (att.state !== 'attack' || !att.move || att.hitDone) return;
    const m = MOVES[att.move];
    if (att.moveT < m.startup || att.moveT > m.startup + m.active) return;
    // hitbox: a point out in front at the strike's reach + height
    const hx = att.x + att.facing * m.reach * att.scale;
    const hy = att.y + m.hitY * att.scale;
    // defender hurtbox
    const dw = BODY_HALF * def.scale + 6;
    const top = def.y + (def.crouch ? -26 : -46) * def.scale;
    const bot = def.y - 2;
    if (Math.abs(hx - def.x) > dw || hy < top - 6 || hy > bot + 6) return;
    if (def.state === 'ko') return;

    att.hitDone = true;
    const blockingRight =
      def.block &&
      ((m.height === 'low' && def.crouch) || (m.height !== 'low' && !def.crouch));
    const dmg = m.dmg * att.powerScale;
    const kbDir = att.facing;
    if (blockingRight) {
      def.hp -= Math.max(1, dmg * 0.12);
      def.state = 'blockstun';
      def.stunT = m.blockstun;
      def.vx = kbDir * 40;
      def.move = null;
      this.engine.sfx.play('uiBack');
      this.engine.particles.burst(hx, hy, 3, { color: this.spec.palette[14], speed: 40, life: 0.2 });
    } else {
      def.hp -= dmg;
      def.state = 'hitstun';
      def.stunT = m.hitstun;
      def.move = null;
      def.flashT = 0.12;
      def.vx = kbDir * m.knockback;
      if (m.knockdown || def.hp <= 0) {
        def.vy = -160;
        def.y = Math.min(def.y, FLOOR_Y - 0.6);
      }
      this.engine.sfx.play('hit');
      this.engine.shake(FEEL.screenShakeMs, 3);
      this.engine.hitStop(FEEL.hitStopMs);
      this.engine.particles.burst(hx, hy, 8, { color: this.spec.palette[11], speed: 90, life: 0.35 });
      this.hud.score += 20;
    }
    if (def.hp <= 0) {
      def.hp = 0;
      def.state = 'ko';
      def.move = null;
    }
  }

  // ------------------------------------------------------------- round flow

  private endRound(): void {
    if (this.roundPhase !== 'fight') return;
    this.roundPhase = 'over';
    this.phaseT = 0;
    let pW = this.p.hp > 0;
    let oW = this.o.hp > 0;
    if (this.timer <= 0 && pW && oW) {
      // time out: more health wins
      pW = this.p.hp >= this.o.hp;
      oW = !pW;
    }
    if (this.p.hp <= 0) this.p.state = 'ko';
    if (this.o.hp <= 0) this.o.state = 'ko';
    if (pW && !oW) {
      this.pWins++;
      this.banner = 'K.O.!';
      this.hud.score += 300;
      this.engine.sfx.play('win');
    } else {
      this.oWins++;
      this.banner = this.timer <= 0 ? 'TIME' : 'K.O.!';
      this.engine.sfx.play('lose');
    }
    this.engine.music.stopSong();
  }

  private afterRound(): void {
    if (this.pWins >= ROUNDS_TO_WIN) {
      this.winBout();
    } else if (this.oWins >= ROUNDS_TO_WIN) {
      this.loseBout();
    } else {
      this.roundNum++;
      this.engine.music.playSong(this.isBoss() ? 'boss' : this.spec.levels[this.bout]!.musicSong);
      this.startRound(false);
    }
  }

  private winBout(): void {
    if (this.isBoss()) {
      this.phase = 'cards';
      this.engine.music.stopSong();
      this.engine.cards.show(
        this.spec.story.victory.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
        () => {
          const par = estimateFighterDurationS(this.spec);
          this.result = { outcome: 'won', score: this.hud.score, timeBonusSeconds: Math.max(0, Math.round(par - this.phaseT)) };
        },
      );
    } else {
      this.enterBout(this.bout + 1);
    }
  }

  private loseBout(): void {
    this.hud.lives--;
    if (this.hud.lives < 0) {
      this.phase = 'cards';
      this.engine.music.stopSong();
      this.engine.cards.show(
        this.spec.story.defeat.map((line) => ({ lines: [line], portrait: this.engine.portrait })),
        () => {
          this.result = { outcome: 'lost', score: this.hud.score, timeBonusSeconds: 0 };
        },
      );
    } else {
      // continue: refight the same bout from round 1
      this.pWins = 0;
      this.oWins = 0;
      this.roundNum = 1;
      this.engine.music.playSong(this.isBoss() ? 'boss' : this.spec.levels[this.bout]!.musicSong);
      this.startRound(true);
    }
  }

  // ------------------------------------------------------------------ render

  private poseOf(a: Actor): FighterPose {
    if (a.state === 'ko') return 'ko';
    if (a.state === 'hitstun') return 'hit';
    if (a.state === 'blockstun' || a.state === 'block') return 'block';
    if (a.state === 'attack' && a.move) return MOVES[a.move].pose;
    if (a.y < FLOOR_Y - 0.5) return 'jump';
    if (a.crouch || a.state === 'crouch') return 'crouch';
    if (a.state === 'walk') return 'walk';
    return 'idle';
  }

  render(): void {
    const r = this.engine.renderer;
    const pal = this.spec.palette;
    r.clear(pal[2] ?? '#101020');

    // far backdrop (fixed camera; a touch of sway from the round clock)
    this.backdrop.draw(r.ctx, Math.sin(this.phaseT * 0.2) * 8, 0);

    // stage: banded floor + a back wall line
    r.rect(0, FLOOR_Y, W, H - FLOOR_Y, pal[1] ?? '#10122b');
    r.rect(0, FLOOR_Y, W, 2, pal[4] ?? '#41a6f6');
    r.rect(0, FLOOR_Y - 1, W, 1, pal[3] ?? '#29366f');

    // shadows
    for (const a of [this.p, this.o]) {
      const gy = FLOOR_Y + 1;
      const shw = 20 * a.scale;
      r.ctx.fillStyle = 'rgba(0,0,0,0.35)';
      r.ctx.beginPath();
      r.ctx.ellipse(a.x, gy, shw, 3.5 * a.scale, 0, 0, Math.PI * 2);
      r.ctx.fill();
    }

    // fighters (player over opponent when overlapping toward the camera)
    const order = this.p.y >= this.o.y ? [this.o, this.p] : [this.p, this.o];
    for (const a of order) {
      const flick = a.state === 'hitstun' && Math.floor(this.phaseT * 30) % 2 === 0;
      drawFighter(r.ctx, {
        cx: a.x,
        feetY: a.y,
        facing: a.facing,
        pose: this.poseOf(a),
        t: a.moveT,
        anim: this.phaseT,
        scale: a.scale,
        colors: a.colors,
        flash: a.flashT > 0 || flick,
      });
    }

    this.renderUi(r);
  }

  private renderUi(r: EngineContext['renderer']): void {
    const pal = this.spec.palette;
    // health bars (P1 left, opponent right), below the host HUD strip
    const barW = 190;
    const y = 24;
    const bar = (x: number, frac: number, flip: boolean): void => {
      r.rect(x, y, barW, 8, pal[1] ?? '#000');
      r.frame(x, y, barW, 8, pal[4] ?? '#41a6f6');
      const w = Math.max(0, Math.round((barW - 2) * Math.max(0, frac)));
      const col = frac > 0.3 ? (pal[5] ?? '#38b764') : (pal[11] ?? '#e04040');
      r.rect(flip ? x + barW - 1 - w : x + 1, y + 1, w, 6, col);
    };
    bar(8, this.p.hp / this.p.maxHp, false);
    bar(W - 8 - barW, this.o.hp / this.o.maxHp, true);
    r.text(this.playerChar().name, 10, y + 11, r.theme.text);
    r.text(this.opponentChar().name, W - 10, y + 11, r.theme.text, { align: 'right' });

    // round-win pips
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      r.rect(8 + i * 8, y - 7, 5, 5, i < this.pWins ? (pal[13] ?? '#ffd75e') : (pal[3] ?? '#333'));
      r.rect(W - 13 - i * 8, y - 7, 5, 5, i < this.oWins ? (pal[13] ?? '#ffd75e') : (pal[3] ?? '#333'));
    }

    // timer
    r.text(String(Math.ceil(this.timer)).padStart(2, '0'), W / 2, y, r.theme.heading, { align: 'center' });

    // banner (ROUND n / FIGHT! / K.O.)
    if (this.banner) {
      const big = this.banner === 'FIGHT!' || this.banner.startsWith('K.O');
      r.text(this.banner, W / 2, H / 2 - 20, big ? (pal[13] ?? '#ffd75e') : r.theme.heading, { align: 'center', scale: big ? 2 : 1 });
    }
  }
}
