// Continuous engine and afterburner for the racing archetype.
//
// A harmonic engine tone and a boost-only noise source share the SFX bus, so
// bus volume and mute apply with no extra plumbing. Pitch and gain follow
// the real craft state (speed, throttle, boost, drift) with smoothed WebAudio
// ramps; everything is created lazily on the first racing update and torn
// down on pause/results/restart/dispose. At most two voices are held, and
// a spent voice budget (or missing capability) stays silent instead of loud.

import type { RacingEngineProfile } from '@sparkade/shared';
import {
  renderEngineNoise,
  resolveEngineProfile,
  type ResolvedEngineProfile,
} from './sound-profile';

/** Minimal structural capability; AudioSys satisfies it, fakes are trivial. */
export interface HoverEngineCaps {
  context(): AudioContext;
  sfxBus: GainNode;
  claimVoice(): boolean;
  releaseVoice(): void;
}

/** Live craft state driving the hum. Numbers only — no allocation. */
export interface HoverEngineState {
  /** Forward speed in track units. */
  speed: number;
  /** Throttle held. */
  throttle: boolean;
  /** Manual boost burning. */
  boosting: boolean;
  /** Drift/airbrake held at speed. */
  drifting: boolean;
}

/** Read-only activity snapshot for DEV telemetry. */
export interface HoverEngineStatus {
  on: boolean;
  /** Current target pitch in Hz (0 while stopped). */
  pitchHz: number;
}

const TOP_SPEED = 128;

function pitchFor(s: HoverEngineState, v: ResolvedEngineProfile): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  const rpm =
    v.baseHz + norm * v.speedHz + (s.throttle ? v.throttleHz : 0) + (s.drifting ? v.driftHz : 0);
  return rpm * v.pitchRatio * (s.boosting ? 0.84 : 1);
}

function gainFor(s: HoverEngineState): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  return 0.025 + norm * 0.14 + (s.boosting ? 0.055 : 0) + (s.throttle ? 0.12 : 0);
}

function filterFor(s: HoverEngineState, v: ResolvedEngineProfile): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  return (
    (v.filterBase +
      norm * v.filterSpeed +
      (s.throttle ? v.filterThrottle : 0) +
      (s.boosting ? v.filterBoost : 0)) *
    v.filterScale
  );
}

export class HoverEngine {
  private caps: HoverEngineCaps | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private voiceHeld = false;
  private pitchHz = 0;
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private burner = new Afterburner();

  /** Optional authored timbre; omit/null for the exact legacy mix. */
  constructor(profile?: RacingEngineProfile | null) {
    this.setProfile(profile);
  }

  /**
   * Select the engine timbre (identity.sound.engine). Stores parameters
   * only: no nodes are created, no voice is claimed, and a running voice
   * keeps playing with its timbre switched live. Null/undefined restores
   * the exact legacy mix.
   */
  setProfile(profile?: RacingEngineProfile | null): void {
    this.voice = resolveEngineProfile(profile ?? null);
    this.burner.setProfile(this.voice);
    try {
      if (this.osc) this.osc.type = this.voice.oscType;
    } catch {
      // A dead voice must never break a profile switch; next update retries.
    }
  }

  /** Remember the capability; creates no nodes and claims no voice. */
  attach(caps: HoverEngineCaps | null | undefined): void {
    this.caps = caps ?? null;
    this.burner.attach(this.caps);
  }

  get active(): boolean {
    return this.osc !== null;
  }

  /** Live source count lets the race mixer leave room for rivals and effects. */
  get sources(): number {
    return (this.voiceHeld ? 1 : 0) + this.burner.sources;
  }

  /** Read-only status for DEV snapshots. */
  status(): HoverEngineStatus {
    return { on: this.active, pitchHz: this.active ? this.pitchHz : 0 };
  }

  /**
   * Drive the hum from live craft state. Lazily starts the single voice on
   * the first call; a missing capability or spent budget stays silent and
   * retries on a later call. Reuses all nodes — no per-update allocation.
   */
  update(s: HoverEngineState): void {
    if (!this.caps) return;
    if (!this.start()) return;
    try {
      const ctx = this.caps.context();
      const t = ctx.currentTime;
      this.pitchHz = pitchFor(s, this.voice);
      const response = s.throttle ? 0.07 : 0.18;
      this.osc!.frequency.setTargetAtTime(this.pitchHz, t, response);
      this.gain!.gain.setTargetAtTime(gainFor(s), t, response);
      this.filter!.frequency.setTargetAtTime(filterFor(s, this.voice), t, response);
      this.burner.update(s.boosting);
    } catch {
      // Dead context or parameters must never crash racing: drop the broken
      // voice quietly; a later update retries from a clean claim.
      this.stop();
    }
  }

  /**
   * Silence and release everything. Idempotent: repeated calls (pause,
   * results, restart, dispose) release the voice at most once and never
   * throw, even against a torn-down context.
   */
  stop(): void {
    this.burner.stop();
    if (!this.voiceHeld) {
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.pitchHz = 0;
      return;
    }
    this.voiceHeld = false;
    this.pitchHz = 0;
    let t = 0;
    try {
      const ctx = this.caps?.context();
      t = ctx ? ctx.currentTime : 0;
    } catch {
      // A dead context must never break teardown; ramp instantly.
    }
    try {
      this.gain?.gain.setTargetAtTime(0, t, 0.02);
    } catch {
      // A dead parameter must not spare the oscillator stop below.
    }
    try {
      this.osc?.stop(t + 0.08);
    } catch {
      // Already stopped.
    }
    try {
      this.osc?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.gain?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.filter?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.osc = null;
    this.gain = null;
    this.filter = null;
    try {
      this.caps?.releaseVoice();
    } catch {
      // Accounting must never throw.
    }
  }

  /** Start the single voice; false when there is nothing to start with. */
  private start(): boolean {
    if (this.osc !== null) return true;
    if (!this.caps || !this.caps.claimVoice()) return false;
    this.voiceHeld = true;
    try {
      const ctx = this.caps.context();
      this.osc = ctx.createOscillator();
      this.osc.type = this.voice.oscType;
      this.osc.frequency.value = this.voice.baseHz * this.voice.pitchRatio;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 420;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(this.caps.sfxBus);
      this.osc.start();
      return true;
    } catch {
      // Partial-start teardown: nodes may already be wired (e.g. start()
      // threw after connection). Disconnect each in its own guard so one
      // failure cannot strand the rest, then release the single claim once.
      const nodes = [this.osc, this.filter, this.gain];
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.voiceHeld = false;
      for (const node of nodes) {
        try {
          node?.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      try {
        this.caps?.releaseVoice();
      } catch {
        // Accounting must never throw.
      }
      return false;
    }
  }
}

/** Boost-only filtered noise. One cached buffer, one claimed source while burning. */
class Afterburner {
  private caps: HoverEngineCaps | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferContext: AudioContext | null = null;
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private held = false;
  private lastBurnAt = -Infinity;

  attach(caps: HoverEngineCaps | null): void {
    this.caps = caps;
  }

  /** Authored boost roar; stores parameters only, never touches nodes. */
  setProfile(voice: ResolvedEngineProfile): void {
    this.voice = voice;
  }
  get sources(): number {
    return this.held ? 1 : 0;
  }

  update(burning: boolean): void {
    if (!this.caps) return;
    try {
      const ctx = this.caps.context();
      const now = ctx.currentTime;
      if (burning) this.lastBurnAt = now;
      if (!burning && now - this.lastBurnAt > 0.16) {
        this.stop();
        return;
      }
      if (!this.source) {
        if (!burning || !this.caps.claimVoice()) return;
        this.held = true;
        if (!this.buffer || this.bufferContext !== ctx) {
          this.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          this.bufferContext = ctx;
          renderEngineNoise(this.buffer.getChannelData(0));
        }
        this.source = ctx.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.loop = true;
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = this.voice.burnerCutoff;
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.source.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.caps.sfxBus);
        this.source.start();
      }
      this.filter!.frequency.setTargetAtTime(this.voice.burnerCutoff, now, 0.05);
      this.gain!.gain.setTargetAtTime(
        burning ? this.voice.burnerGain : 0,
        now,
        burning ? 0.025 : 0.035,
      );
    } catch {
      this.stop();
    }
  }

  stop(): void {
    this.lastBurnAt = -Infinity;
    try {
      this.source?.stop();
    } catch {
      /* Partial or stopped source. */
    }
    for (const node of [this.source, this.filter, this.gain]) {
      try {
        node?.disconnect();
      } catch {
        /* Continue cleaning siblings. */
      }
    }
    this.source = null;
    this.filter = null;
    this.gain = null;
    if (this.held) {
      this.held = false;
      try {
        this.caps?.releaseVoice();
      } catch {
        /* Audio is optional. */
      }
    }
  }
}
