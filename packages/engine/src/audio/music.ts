// Chiptune music player: pulse channels via PeriodicWave (12.5/25/50% duty),
// triangle lead/bass (bass an octave down), drums as filtered-noise bursts.
// Bar-by-bar lookahead scheduling; switching songs never leaks voices.
import { JINGLE_DUCK, type InstrumentsBlock, type MusicBlock } from '@sparkade/shared';
import type { AudioSys } from './audio';
import { parsePattern, parseSong, type ParsedPattern, type ParsedSong } from './music-parser';
import { renderSfx } from './sfx-render';

const LOOKAHEAD_S = 0.35;
const TICK_MS = 100;

interface LiveNode {
  osc: OscillatorNode;
  gain: GainNode;
  stopAt: number;
}

export class ChiptunePlayer {
  private waves: Record<number, PeriodicWave> = {};
  private drumBuffers: Record<'K' | 'S' | 'H', AudioBuffer> | null = null;

  private song: ParsedSong | null = null;
  private songName: string | null = null;
  private nextBarIndex = 0;
  private nextBarTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private live: LiveNode[] = [];
  private claimedVoices = 0;
  private jingleUntil = 0;

  constructor(
    private audio: AudioSys,
    private music: MusicBlock,
    /** Optional destination in place of the shared music bus — lets a caller own
     *  a private gain node (e.g. a preview fade-in) without touching global volume. */
    private outputBus?: GainNode,
  ) {}

  private ensureWaves(): void {
    const ctx = this.audio.context();
    if (Object.keys(this.waves).length) return;
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      }
      this.waves[duty] = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }
    const mk = (samples: Float32Array): AudioBuffer => {
      const buf = ctx.createBuffer(1, samples.length, 22050);
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      return buf;
    };
    this.drumBuffers = {
      K: mk(renderSfx({ wave: 'sine', freq: 110, freqSlide: -36, decay: 0.18, vol: 0.9 })),
      S: mk(renderSfx({ wave: 'noise', freq: 1800, decay: 0.16, vol: 0.55, lowpass: 6500 })),
      H: mk(renderSfx({ wave: 'noise', freq: 6200, decay: 0.05, vol: 0.32 })),
    };
  }

  currentSong(): string | null {
    return this.songName;
  }

  playSong(name: string): void {
    if (this.songName === name && this.timer) return;
    this.stopSong();
    this.ensureWaves();
    const ctx = this.audio.context();
    let parsed: ParsedSong;
    try {
      parsed = parseSong(this.music, name);
    } catch {
      return; // validated specs never hit this; fail silent rather than crash a game
    }
    this.song = parsed;
    this.songName = name;
    this.nextBarIndex = 0;
    this.nextBarTime = ctx.currentTime + 0.05;
    // One budget voice per channel actually used by this song (max 4).
    const used = new Set<string>();
    for (const bar of parsed.bars) {
      if (bar.pulse1.length) used.add('pulse1');
      if (bar.pulse2.length) used.add('pulse2');
      if (bar.bass.length) used.add('bass');
      if (bar.drums.length) used.add('drums');
    }
    this.claimedVoices = 0;
    for (let i = 0; i < used.size; i++) if (this.audio.claimVoice()) this.claimedVoices++;
    this.timer = setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }

  private pump(): void {
    if (!this.song) return;
    const ctx = this.audio.context();
    while (this.nextBarTime < ctx.currentTime + LOOKAHEAD_S) {
      const bar = this.song.bars[this.nextBarIndex % this.song.bars.length]!;
      this.scheduleBar(bar, this.nextBarTime, this.song.secondsPerStep, this.outputBus ?? this.audio.musicBus);
      this.nextBarTime += this.song.barSeconds;
      this.nextBarIndex++;
    }
    this.prune(ctx.currentTime);
  }

  private scheduleBar(
    bar: ParsedPattern,
    barStart: number,
    spb: number,
    bus: GainNode,
    gainScale = 1,
  ): void {
    const inst = this.music.instruments;
    for (const ev of bar.pulse1)
      this.scheduleTone(ev.freq, barStart + ev.step * spb, ev.durSteps * spb, 'pulse1', inst, bus, gainScale);
    for (const ev of bar.pulse2)
      this.scheduleTone(ev.freq, barStart + ev.step * spb, ev.durSteps * spb, 'pulse2', inst, bus, gainScale);
    for (const ev of bar.bass)
      this.scheduleTone(ev.freq / 2, barStart + ev.step * spb, ev.durSteps * spb, 'bass', inst, bus, gainScale);
    if (this.drumBuffers) {
      const ctx = this.audio.context();
      for (const ev of bar.drums) {
        const src = ctx.createBufferSource();
        src.buffer = this.drumBuffers[ev.kind];
        const g = ctx.createGain();
        g.gain.value = inst.drums.vol * gainScale;
        src.connect(g);
        g.connect(bus);
        src.start(barStart + ev.step * spb);
        src.onended = () => {
          src.disconnect();
          g.disconnect();
        };
      }
    }
  }

  private scheduleTone(
    freq: number,
    at: number,
    dur: number,
    channel: 'pulse1' | 'pulse2' | 'bass',
    inst: InstrumentsBlock,
    bus: GainNode,
    gainScale: number,
  ): void {
    const ctx = this.audio.context();
    const osc = ctx.createOscillator();
    if (channel === 'bass') {
      osc.type = 'triangle';
    } else {
      const duty = inst[channel].duty;
      const wave = this.waves[duty];
      if (wave) osc.setPeriodicWave(wave);
      else osc.type = 'square';
    }
    osc.frequency.value = freq;
    const vol = inst[channel].vol * 0.5 * gainScale;
    const decay = inst[channel].decay;
    const g = ctx.createGain();
    const attack = 0.006;
    // Plucky chiptune envelope: fast attack, decay toward zero over the
    // instrument's decay time, hard release at note end.
    const end = at + Math.max(attack + 0.02, Math.min(dur, Math.max(decay, 0.04)));
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.linearRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(bus);
    osc.start(at);
    osc.stop(end + 0.02);
    const node: LiveNode = { osc, gain: g, stopAt: end + 0.02 };
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    this.live.push(node);
  }

  private prune(now: number): void {
    if (this.live.length > 64) this.live = this.live.filter((n) => n.stopAt > now);
  }

  stopSong(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.audio.context().currentTime;
    for (const n of this.live) {
      try {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setValueAtTime(0.0001, now);
        n.osc.stop(now + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.live = [];
    for (let i = 0; i < this.claimedVoices; i++) this.audio.releaseVoice();
    this.claimedVoices = 0;
    this.song = null;
    this.songName = null;
  }

  /** One-shot jingle; ducks the music bus to ~30% while it plays. */
  playJingle(name: 'victory' | 'gameover' | 'levelIntro', onDone?: () => void): void {
    this.ensureWaves();
    const ctx = this.audio.context();
    const pattern = this.music.jingles[name];
    if (!pattern) {
      onDone?.();
      return;
    }
    let parsed: ParsedPattern;
    try {
      parsed = parsePattern(pattern);
    } catch {
      onDone?.();
      return;
    }
    const spb = 60 / this.music.bpm / 4;
    const start = ctx.currentTime + 0.03;
    const barSeconds = spb * 16;
    const duck = this.audio.duckGain.gain;
    duck.cancelScheduledValues(ctx.currentTime);
    duck.setTargetAtTime(JINGLE_DUCK, ctx.currentTime, 0.04);
    duck.setTargetAtTime(1, start + barSeconds, 0.15);
    this.jingleUntil = start + barSeconds;
    this.scheduleBar(parsed, start, spb, this.audio.jingleBus, 0.9);
    if (onDone) setTimeout(onDone, (start + barSeconds - ctx.currentTime) * 1000 + 60);
  }

  isJinglePlaying(): boolean {
    return this.audio.context().currentTime < this.jingleUntil;
  }

  dispose(): void {
    this.stopSong();
  }
}
