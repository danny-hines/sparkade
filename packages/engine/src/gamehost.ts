// GameHost: wires renderer/input/audio/sprites into an archetype instance and
// owns everything a game must never be able to break: pause, the guaranteed
// hold-START escape, the debug overlay, and the game-over → initials →
// leaderboard flow.
import {
  ESCAPE_HOLD_MS,
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  type ControlLabel,
  type GameSpec,
} from '@sparkade/shared';
import { AudioSys } from './audio/audio';
import { ChiptunePlayer } from './audio/music';
import { SfxSynth } from './audio/sfx';
import type { InputBroker } from './input';
import { GameLoop } from './loop';
import { HowToPlayCard, InitialsEntry, LeaderboardView, PauseOverlay, ScoreTally, type LeaderboardRow } from './overlays';
import { ParticleSystem } from './particles';
import { makeWeather, type Weather } from './weather';
import { Camera, Renderer } from './renderer';
import { makeUiTheme } from './theme';
import { Rng } from './rng';
import { SpriteStore } from './sprites';
import { StoryCards } from './storycard';
import { Hud } from './hud';
import type { GameInstance, LikenessAssets } from './types';

/** Lighting mood → a translucent color wash over the scene. undefined = untinted. */
const LIGHTING_TINTS: Record<string, { color: string; alpha: number } | undefined> = {
  none: undefined,
  dawn: { color: '#ff9e7a', alpha: 0.16 },
  dusk: { color: '#ff7330', alpha: 0.24 },
  night: { color: '#0c1836', alpha: 0.42 },
  gloom: { color: '#26331f', alpha: 0.32 },
};

/** Everything an archetype needs to run a game. */
export interface EngineContext {
  renderer: Renderer;
  input: InputBroker;
  audio: AudioSys;
  music: ChiptunePlayer;
  sfx: SfxSynth;
  sprites: SpriteStore;
  particles: ParticleSystem;
  rng: Rng;
  camera: Camera;
  cards: StoryCards;
  hud: Hud;
  portrait: CanvasImageSource | null;
  spec: GameSpec;
  shake(ms?: number, magnitude?: number): void;
  hitStop(ms?: number): void;
}

export interface ArchetypeRuntime {
  id: string;
  version: string;
  controlHelp: ControlLabel[];
  create(engine: EngineContext, spec: GameSpec): GameInstance;
}

export interface GameHostCallbacks {
  onQuit(): void;
  onVolumesChanged(v: { musicVol: number; sfxVol: number; uiVol: number }): void;
  /** Top-10 at launch (shell fetched it). */
  initialScores: LeaderboardRow[];
  /** Persist a score; resolves to the updated top-10. */
  submitScore(initials: string, score: number): Promise<LeaderboardRow[]>;
}

type HostState = 'howto' | 'game' | 'paused' | 'tally' | 'initials' | 'board';

export class GameHost {
  private renderer: Renderer;
  private audio: AudioSys;
  private music: ChiptunePlayer;
  private sfx: SfxSynth;
  private loop: GameLoop;
  private engineCtx: EngineContext;
  private instance: GameInstance;
  private pause: PauseOverlay;
  private state: HostState = 'howto';
  private howto: HowToPlayCard;
  private tally: ScoreTally | null = null;
  private initials: InitialsEntry | null = null;
  private board: LeaderboardView | null = null;
  private scores: LeaderboardRow[];
  private startHeldMs = 0;
  private selectStartLatch = false;
  private debug = false;
  private hitStopMs = 0;
  private playT = 0;
  private disposed = false;
  private weather: Weather;
  private lightTint: { color: string; alpha: number } | null = null;

  constructor(
    private opts: {
      canvas: HTMLCanvasElement;
      spec: GameSpec;
      archetype: ArchetypeRuntime;
      input: InputBroker;
      likeness: LikenessAssets | null;
      volumes: { musicVol: number; sfxVol: number; uiVol: number };
      callbacks: GameHostCallbacks;
    },
  ) {
    this.renderer = new Renderer(opts.canvas);
    this.renderer.theme = makeUiTheme(opts.spec.palette); // per-game chrome
    this.audio = new AudioSys();
    this.audio.setVolumes(opts.volumes);
    this.music = new ChiptunePlayer(this.audio, opts.spec.music);
    const rng = new Rng(opts.spec.seed);
    this.sfx = new SfxSynth(this.audio, opts.spec.sfx ?? {}, rng.fork(7));
    this.sfx.bake();
    const sprites = new SpriteStore(
      opts.spec,
      opts.likeness ? { head12: opts.likeness.head12, head16: opts.likeness.head16 } : null,
    );
    this.scores = [...opts.callbacks.initialScores];

    this.engineCtx = {
      renderer: this.renderer,
      input: opts.input,
      audio: this.audio,
      music: this.music,
      sfx: this.sfx,
      sprites,
      particles: new ParticleSystem(),
      rng,
      camera: new Camera(),
      cards: new StoryCards(),
      hud: new Hud(opts.spec.palette),
      portrait: opts.likeness?.portrait ?? null,
      spec: opts.spec,
      shake: (ms = FEEL.screenShakeMs, magnitude = 3) => this.renderer.shake(ms, magnitude),
      hitStop: (ms = FEEL.hitStopMs) => {
        this.hitStopMs = Math.max(this.hitStopMs, ms);
      },
    };

    this.pause = new PauseOverlay({
      controlHelp: opts.archetype.controlHelp,
      getVolumes: () => this.audio.getVolumes(),
      setVolumes: (v) => {
        this.audio.setVolumes(v);
        opts.callbacks.onVolumesChanged(v);
      },
      uiBlip: (k) => this.sfx.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
    });

    this.howto = new HowToPlayCard(opts.spec.meta.title, opts.archetype.controlHelp);
    this.weather = makeWeather(opts.spec.weather ?? 'none', opts.spec.palette, opts.spec.seed);
    this.renderer.juice = Math.max(0, Math.min(1.5, opts.spec.juice ?? 1));
    this.lightTint = LIGHTING_TINTS[opts.spec.lighting ?? 'none'] ?? null;
    this.instance = opts.archetype.create(this.engineCtx, opts.spec);
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
  }

  start(): void {
    this.opts.input.swallow();
    this.loop.start();
  }

  private update(dt: number): void {
    const input = this.opts.input.poll();
    this.audio.resume(); // autoplay fallback: resume on any tick after first gesture

    // Guaranteed shell escape: hold START ~2s anywhere in-game.
    if (input.START.held) this.startHeldMs += dt * 1000;
    else this.startHeldMs = 0;
    if (this.startHeldMs >= ESCAPE_HOLD_MS) {
      this.quit();
      return;
    }

    // Debug overlay toggle: SELECT+START held together.
    if (input.SELECT.held && input.START.held) {
      if (!this.selectStartLatch) {
        this.debug = !this.debug;
        this.selectStartLatch = true;
      }
    } else {
      this.selectStartLatch = false;
    }

    // FPS-based particle degradation.
    if (this.loop.fps < 42) this.engineCtx.particles.setBudgetScale(0.25);
    else if (this.loop.fps < 52) this.engineCtx.particles.setBudgetScale(0.5);
    else if (this.loop.fps > 57) this.engineCtx.particles.setBudgetScale(1);

    switch (this.state) {
      case 'howto': {
        this.howto.update(dt, input);
        if (this.howto.done) {
          this.state = 'game';
          this.opts.input.swallow();
          this.instance.start();
        }
        break;
      }
      case 'game': {
        if (this.engineCtx.cards.active) {
          this.engineCtx.cards.update(dt, input);
          break;
        }
        if (input.START.pressed) {
          this.state = 'paused';
          this.pause.reset();
          this.opts.input.swallow();
          this.sfx.play('uiSelect');
          break;
        }
        if (this.hitStopMs > 0) {
          this.hitStopMs -= dt * 1000;
          break; // freeze frames: no update, still renders
        }
        this.playT += dt;
        this.instance.update(dt, input);
        this.engineCtx.particles.update(dt);
        this.weather.update(dt);
        const result = this.instance.result;
        if (result) {
          this.music.stopSong();
          this.music.playJingle(result.outcome === 'won' ? 'victory' : 'gameover');
          this.sfx.play(result.outcome === 'won' ? 'win' : 'lose');
          this.tally = new ScoreTally(
            result.score,
            result.timeBonusSeconds,
            this.opts.spec.scoring.timeBonusPerSecond,
            result.outcome === 'won',
          );
          this.state = 'tally';
          this.opts.input.swallow();
        }
        break;
      }
      case 'paused': {
        const action = this.pause.update(input);
        if (action === 'resume') {
          this.state = 'game';
          this.opts.input.swallow();
        } else if (action === 'restart') {
          this.instance.restart();
          this.state = 'game';
          this.opts.input.swallow();
        } else if (action === 'quit') {
          this.quit();
        }
        break;
      }
      case 'tally': {
        this.tally!.update(dt, input);
        if (this.tally!.done) {
          const total = this.tally!.total;
          const qualifies =
            total > 0 && (this.scores.length < 10 || total > (this.scores[9]?.score ?? 0));
          if (qualifies) {
            this.initials = new InitialsEntry((k) =>
              this.sfx.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
            );
            this.state = 'initials';
          } else {
            this.openBoard(-1);
          }
          this.opts.input.swallow();
        }
        break;
      }
      case 'initials': {
        this.initials!.update(dt, input);
        if (this.initials!.done) {
          const initials = this.initials!.initials;
          const total = this.tally!.total;
          this.state = 'board'; // optimistic; board content updates when submit resolves
          this.openBoard(this.predictRank(total));
          void this.opts.callbacks.submitScore(initials, total).then((rows) => {
            if (this.disposed) return;
            this.scores = rows;
            const idx = rows.findIndex((r) => r.initials === initials && r.score === total);
            this.openBoard(idx);
          });
          this.opts.input.swallow();
        }
        break;
      }
      case 'board': {
        this.board!.update(input);
        if (this.board!.action === 'again') {
          this.playAgain();
        } else if (this.board!.action === 'exit') {
          this.quit();
        }
        break;
      }
    }
  }

  private predictRank(total: number): number {
    let rank = this.scores.findIndex((r) => total > r.score);
    if (rank === -1) rank = this.scores.length;
    return rank < 10 ? rank : -1;
  }

  private openBoard(highlight: number): void {
    this.board = new LeaderboardView([...this.scores], highlight, (k) =>
      this.sfx.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
    );
    this.state = 'board';
  }

  private playAgain(): void {
    this.instance.dispose();
    this.engineCtx.particles.clear();
    this.engineCtx.cards.show([]);
    this.music.stopSong();
    this.instance = this.opts.archetype.create(this.engineCtx, this.opts.spec);
    this.tally = null;
    this.initials = null;
    this.board = null;
    this.playT = 0;
    this.state = 'game';
    this.opts.input.swallow();
    this.instance.start();
  }

  private render(): void {
    const r = this.renderer;
    switch (this.state) {
      case 'howto':
        this.howto.render(r);
        break;
      case 'game':
      case 'paused':
        this.instance.render();
        // Lighting wash tints the scene for mood; drawn under weather + HUD so
        // particles and chrome stay crisp and legible.
        if (this.lightTint) {
          r.ctx.save();
          r.ctx.globalAlpha = this.lightTint.alpha;
          r.ctx.fillStyle = this.lightTint.color;
          r.ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
          r.ctx.restore();
        }
        // Ambient weather sits over the scene but under gameplay particles (so
        // hit sparks stay crisp) and the HUD/story cards (always legible).
        this.weather.draw(r.ctx, this.engineCtx.camera.x, this.engineCtx.camera.y);
        this.engineCtx.particles.render(r, this.engineCtx.camera.x, this.engineCtx.camera.y);
        this.engineCtx.hud.render(r, this.instance.hud, {
          showKeys: this.opts.spec.archetype === 'adventure',
          showBombs: this.opts.spec.archetype === 'shooter',
        });
        if (this.engineCtx.cards.active) this.engineCtx.cards.render(r);
        if (this.state === 'paused') this.pause.render(r);
        break;
      case 'tally':
        this.tally!.render(r);
        break;
      case 'initials':
        this.initials!.render(r, this.tally!.total);
        break;
      case 'board':
        this.board!.render(r);
        break;
    }

    // Hold-START escape progress.
    if (this.startHeldMs > 600) {
      const t = Math.min(1, this.startHeldMs / ESCAPE_HOLD_MS);
      r.rect(INTERNAL_WIDTH / 2 - 60, INTERNAL_HEIGHT - 22, 120, 12, '#10122b');
      r.rect(INTERNAL_WIDTH / 2 - 58, INTERNAL_HEIGHT - 20, Math.round(116 * t), 8, '#ffa300');
      r.text('HOLD TO EXIT', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 36, '#f4f4f4', { align: 'center' });
    }

    if (this.debug) {
      r.rect(2, INTERNAL_HEIGHT - 14, 190, 12, 'rgba(0,0,0,0.7)');
      r.text(
        `FPS ${this.loop.fps.toFixed(0)} PART ${this.engineCtx.particles.alive} VOX ${this.audio.voicesInUse()}`,
        4,
        INTERNAL_HEIGHT - 12,
        '#a7f070',
      );
    }

    r.present();
  }

  private quit(): void {
    const cb = this.opts.callbacks.onQuit;
    this.dispose();
    cb();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.instance.dispose();
    this.music.dispose();
    this.audio.dispose();
  }
}
