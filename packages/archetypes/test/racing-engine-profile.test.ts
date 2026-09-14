// M5 sound-identity tests: profile resolution, thematic timbres, legacy
// preservation, budgets, and cleanup. Fake WebAudio only — no real context.
import { describe, expect, it } from 'vitest';
import type { RacingEngineProfile } from '@sparkade/shared';
import { HoverEngine, type HoverEngineCaps } from '../src/racing/audio';
import { RaceEngineAudio, rivalSound } from '../src/racing/rival-audio';
import {
  ENGINE_NOISE_SEED,
  LEGACY_BURNER,
  LEGACY_ENGINE,
  LEGACY_RIVAL,
  renderEngineNoise,
  resolveEngineProfile,
} from '../src/racing/sound-profile';

function param() {
  return {
    value: 0,
    sets: [] as number[],
    setTargetAtTime(v: number) {
      this.value = v;
      this.sets.push(v);
    },
  };
}
type Param = ReturnType<typeof param>;

interface FakeNode {
  kind: string;
  type: string;
  frequency: Param;
  gain: Param;
  pan: Param;
  buffer: { data: Float32Array } | null;
  loop: boolean;
  started: boolean;
  stopped: boolean;
  disconnected: boolean;
  connect(): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

function world() {
  let held = 0;
  let claims = 0;
  let releases = 0;
  let buffers = 0;
  const nodes: FakeNode[] = [];
  function node(kind: string): FakeNode {
    const n: FakeNode = {
      kind,
      type: '',
      frequency: param(),
      gain: param(),
      pan: param(),
      buffer: null,
      loop: false,
      started: false,
      stopped: false,
      disconnected: false,
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
    };
    nodes.push(n);
    return n;
  }
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
    createGain: () => node('gain'),
    createStereoPanner: () => node('pan'),
    createBufferSource: () => node('noise'),
    createBuffer: (_channels: number, size: number) => {
      buffers++;
      const data = new Float32Array(size);
      return { getChannelData: () => data, data };
    },
  };
  const caps: HoverEngineCaps = {
    context: () => ctx as unknown as AudioContext,
    sfxBus: {} as GainNode,
    claimVoice() {
      if (held >= 8) return false;
      held++;
      claims++;
      return true;
    },
    releaseVoice() {
      held--;
      releases++;
    },
  };
  return { ctx, caps, nodes, stats: () => ({ held, claims, releases, buffers }) };
}

const IDLE = { speed: 0, throttle: false, boosting: false, drifting: false };
const FAST = { speed: 80, throttle: true, boosting: false, drifting: false };
const electric: RacingEngineProfile = { family: 'electric' };
const combustion: RacingEngineProfile = { family: 'combustion' };
const arcane: RacingEngineProfile = { family: 'arcane' };

describe('resolveEngineProfile', () => {
  it('resolves absent profiles to the exact legacy mix', () => {
    for (const input of [undefined, null] as const) {
      const r = resolveEngineProfile(input);
      expect(r.family).toBe('combustion');
      expect(r.tone).toBe(0.5);
      expect(r.pitch).toBe(0);
      expect(r.oscType).toBe(LEGACY_ENGINE.oscType);
      expect(r.pitchRatio).toBe(1);
      expect(r.filterScale).toBe(1);
      expect(r.baseHz).toBe(LEGACY_ENGINE.baseHz);
      expect(r.speedHz).toBe(LEGACY_ENGINE.speedHz);
      expect(r.throttleHz).toBe(LEGACY_ENGINE.throttleHz);
      expect(r.driftHz).toBe(LEGACY_ENGINE.driftHz);
      expect(r.filterBase).toBe(LEGACY_ENGINE.filterBase);
      expect(r.filterSpeed).toBe(LEGACY_ENGINE.filterSpeed);
      expect(r.filterThrottle).toBe(LEGACY_ENGINE.filterThrottle);
      expect(r.filterBoost).toBe(LEGACY_ENGINE.filterBoost);
      expect(r.burnerCutoff).toBe(LEGACY_BURNER.cutoffHz);
      expect(r.burnerGain).toBe(LEGACY_BURNER.gain);
    }
  });

  it('clamps tone/pitch and falls back on unknown families', () => {
    expect(resolveEngineProfile({ family: 'electric', tone: 9, pitch: -99 }).tone).toBe(1);
    expect(resolveEngineProfile({ family: 'electric', tone: 9, pitch: -99 }).pitch).toBe(-12);
    expect(resolveEngineProfile({ family: 'electric', tone: -2, pitch: 99 }).tone).toBe(0);
    expect(resolveEngineProfile({ family: 'electric', tone: -2, pitch: 99 }).pitch).toBe(12);
    expect(resolveEngineProfile({ family: 'electric', tone: NaN, pitch: NaN }).tone).toBe(0.5);
    expect(resolveEngineProfile({ family: 'electric', tone: NaN, pitch: NaN }).pitch).toBe(0);
    const weird = resolveEngineProfile({ family: 'diesel' as never });
    expect(weird.family).toBe('combustion');
    expect(weird.oscType).toBe('sawtooth');
  });

  it('derives pitch ratio in semitones and filter scale from tone', () => {
    expect(resolveEngineProfile({ family: 'arcane', pitch: 12 }).pitchRatio).toBeCloseTo(2, 10);
    expect(resolveEngineProfile({ family: 'arcane', pitch: -12 }).pitchRatio).toBeCloseTo(0.5, 10);
    expect(resolveEngineProfile({ family: 'arcane', tone: 0 }).filterScale).toBeCloseTo(0.6, 10);
    expect(resolveEngineProfile({ family: 'arcane', tone: 1 }).filterScale).toBeCloseTo(1.4, 10);
  });

  it('gives each family a clearly different thematic timbre', () => {
    const types = [electric, combustion, arcane].map((p) => resolveEngineProfile(p).oscType);
    expect(new Set(types).size).toBe(3);
    expect(types).toEqual(['sine', 'sawtooth', 'square']);
    const cutoffs = [electric, combustion, arcane].map((p) => resolveEngineProfile(p).burnerCutoff);
    expect(new Set(cutoffs).size).toBe(3);
    const bases = [electric, combustion, arcane].map((p) => resolveEngineProfile(p).baseHz);
    expect(new Set(bases).size).toBe(3);
  });
});

describe('renderEngineNoise', () => {
  it('is deterministic per seed, seamless at the loop edge, and never NaN', () => {
    const a = new Float32Array(2048);
    const b = new Float32Array(2048);
    renderEngineNoise(a);
    renderEngineNoise(b);
    expect(a).toEqual(b);
    expect(Math.abs(a[0]!)).toBeLessThan(1e-9);
    expect(Math.abs(a[a.length - 1]!)).toBeLessThan(1e-9);
    expect(a.some((v) => !Number.isFinite(v))).toBe(false);
    expect(Math.max(...a.map((v) => Math.abs(v)))).toBeGreaterThan(0.05);
    const c = new Float32Array(2048);
    renderEngineNoise(c, ENGINE_NOISE_SEED + 1);
    expect(c).not.toEqual(a);
  });
});

describe('HoverEngine profiles', () => {
  it('keeps the legacy sawtooth mix without a profile', () => {
    const w = world();
    const e = new HoverEngine();
    e.attach(w.caps);
    e.update(FAST);
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(1);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('sawtooth');
  });

  it('voices the constructor profile from the first frame with no extra nodes', () => {
    const w = world();
    const e = new HoverEngine(electric);
    e.attach(w.caps);
    e.update(FAST);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('sine');
    const before = w.nodes.length;
    e.setProfile(arcane);
    for (let k = 0; k < 20; k++) e.update(FAST);
    expect(w.nodes.length).toBe(before);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('square');
  });

  it('restores the legacy mix on setProfile(null)', () => {
    const w = world();
    const e = new HoverEngine(arcane);
    e.attach(w.caps);
    e.update(FAST);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('square');
    e.setProfile(null);
    e.update(FAST);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('sawtooth');
    expect(e.status().pitchHz).toBeCloseTo(78 + (80 / 128) * 138 + 34, 6);
  });

  it('preserves throttle/speed/boost response for every family', () => {
    for (const profile of [undefined, electric, combustion, arcane] as const) {
      const w = world();
      const e = new HoverEngine(profile ?? undefined);
      e.attach(w.caps);
      e.update({ ...IDLE, speed: 10 });
      const slow = e.status().pitchHz;
      e.update(FAST);
      const fast = e.status().pitchHz;
      const fastGain = w.nodes.find((n) => n.kind === 'gain')!.gain.value;
      e.update({ ...FAST, boosting: true });
      const boost = e.status().pitchHz;
      const boostGain = w.nodes.find((n) => n.kind === 'gain')!.gain.value;
      expect(fast).toBeGreaterThan(slow);
      expect(boost).toBeLessThan(fast);
      expect(boostGain).toBeGreaterThan(fastGain);
      e.stop();
      expect(w.stats().held).toBe(0);
      expect(w.stats().claims).toBe(w.stats().releases);
    }
  });

  it('separates family pitch at identical craft state', () => {
    const pitches = [electric, combustion, arcane].map((profile) => {
      const w = world();
      const e = new HoverEngine(profile);
      e.attach(w.caps);
      e.update(FAST);
      const p = e.status().pitchHz;
      e.stop();
      return p;
    });
    expect(new Set(pitches).size).toBe(3);
  });

  it('applies pitch semitones as a frequency ratio', () => {
    const plain = new HoverEngine(combustion);
    const up = new HoverEngine({ family: 'combustion', pitch: 12 });
    const w1 = world();
    const w2 = world();
    plain.attach(w1.caps);
    up.attach(w2.caps);
    plain.update(FAST);
    up.update(FAST);
    expect(up.status().pitchHz).toBeCloseTo(plain.status().pitchHz * 2, 6);
    plain.stop();
    up.stop();
  });

  it('never throws setProfile without capability and releases once', () => {
    const e = new HoverEngine();
    expect(() => e.setProfile(arcane)).not.toThrow();
    e.update(FAST);
    expect(e.active).toBe(false);
    const w = world();
    e.attach(w.caps);
    e.update(FAST);
    e.stop();
    e.stop();
    expect(w.stats().claims).toBe(w.stats().releases);
  });
});

describe('afterburner profiles', () => {
  it('burns looped noise (never a pitched bell) with family character', () => {
    const cutoffs = [electric, combustion, arcane].map((profile) => {
      const w = world();
      const e = new HoverEngine(profile);
      e.attach(w.caps);
      e.update(FAST);
      w.ctx.currentTime += 1 / 60;
      e.update({ ...FAST, boosting: true });
      const noise = w.nodes.find((n) => n.kind === 'noise')!;
      expect(noise.loop).toBe(true);
      // No oscillator is ever created for the boost itself.
      expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(1);
      // Engine filter is created first; the burner filter is the last one.
      const cutoff = w.nodes.filter((n) => n.kind === 'filter').at(-1)!.frequency.value;
      e.stop();
      expect(w.stats().held).toBe(0);
      return cutoff;
    });
    expect(cutoffs[1]).toBe(LEGACY_BURNER.cutoffHz);
    expect(new Set(cutoffs).size).toBe(3);
  });
});

describe('RaceEngineAudio profiles', () => {
  const field = (s0: number) => [
    { s: s0, x: 0, speed: 70, finished: false },
    { s: s0 + 6, x: -2, speed: 66, finished: false },
    { s: s0 + 12, x: 2, speed: 64, finished: false },
    { s: s0 + 200, x: 0, speed: 60, finished: false },
  ];

  it('themes player and rivals independently from the constructor', () => {
    const w = world();
    const mix = new RaceEngineAudio(combustion, [electric, arcane]);
    mix.attach(w.caps);
    for (let i = 0; i < 30; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...FAST }, field(100), 0, 3000);
    }
    expect(mix.snapshot().rivals.map((r) => r.index).sort()).toEqual([1, 2]);
    const types = w.nodes.filter((n) => n.kind === 'osc').map((n) => n.type);
    expect(types).toContain('sawtooth'); // player
    expect(types).toContain('sine'); // rival 1
    expect(types).toContain('square'); // rival 2
    mix.stop();
    expect(w.stats().held).toBe(0);
  });

  it('keeps legacy pitch identical without profiles and shifts it with pitch', () => {
    const p = { s: 100, x: 0, speed: 70, finished: false };
    const r = { s: 106, x: -2, speed: 66, finished: false };
    const legacy = rivalSound(p, r, 1, 3000)!;
    const nulled = rivalSound(p, r, 1, 3000, null)!;
    expect(nulled).toEqual(legacy);
    // ds=+6 closing at +4 units: doppler 1.008 over the legacy shape.
    const expected =
      (LEGACY_RIVAL.baseHz + 66 * LEGACY_RIVAL.speedCoef + LEGACY_RIVAL.indexStep) * 1.008;
    expect(legacy.pitchHz).toBeCloseTo(expected, 10);
    const up = rivalSound(p, r, 1, 3000, { family: 'combustion', pitch: 12 })!;
    expect(up.pitchHz).toBeCloseTo(legacy.pitchHz * 2, 6);
    expect(up.gain).toBe(legacy.gain);
    expect(up.pan).toBe(legacy.pan);
  });

  it('holds at most 3 race sources under boost saturation and releases all', () => {
    const w = world();
    const mix = new RaceEngineAudio(arcane, [electric, arcane, combustion, electric]);
    mix.attach(w.caps);
    const racers = field(100);
    for (let i = 0; i < 60; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...FAST, boosting: true }, racers, 0, 3000);
    }
    expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
    expect(mix.snapshot().rivals.length).toBeLessThanOrEqual(1);
    const count = w.nodes.length;
    for (let i = 0; i < 60; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...FAST, boosting: true }, racers, 0, 3000);
    }
    // Steady-state updates create no nodes (only scheduled param ramps).
    expect(w.nodes.length).toBe(count);
    mix.stop();
    mix.stop();
    expect(w.stats().held).toBe(0);
    expect(w.nodes.every((n) => n.disconnected)).toBe(true);
  });
});
