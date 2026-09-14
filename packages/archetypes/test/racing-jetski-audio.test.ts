// Jetski watercraft sound-identity tests: the bounded audio milestone for
// the racing jet-ski discipline. Hover omission stays byte-identical
// legacy; jetski retunes the same authored families into a marine motor
// plus a speed/carve/boost water rush on the repurposed second source.
// Fake WebAudio only — no real AudioContext.
import { describe, expect, it } from 'vitest';
import type { RacingEngineProfile } from '@sparkade/shared';
import { HoverEngine, type HoverEngineCaps } from '../src/racing/audio';
import { RaceEngineAudio, rivalSound } from '../src/racing/rival-audio';
import {
  JETSKI_WATER_GAIN_CAP,
  LEGACY_BURNER,
  LEGACY_ENGINE,
  jetskiWaterCutoff,
  jetskiWaterGain,
  normalizeEngineDiscipline,
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
  connected: unknown[];
  connect(dest: unknown): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

function world(budgetOpen = true) {
  let held = 0;
  let claims = 0;
  let releases = 0;
  let buffers = 0;
  let open = budgetOpen;
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
      connected: [],
      connect(dest: unknown) {
        this.connected.push(dest);
      },
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
  const sfxBus = {};
  const caps: HoverEngineCaps = {
    context: () => ctx as unknown as AudioContext,
    sfxBus: sfxBus as unknown as GainNode,
    claimVoice() {
      if (!open || held >= 8) return false;
      held++;
      claims++;
      return true;
    },
    releaseVoice() {
      held--;
      releases++;
    },
  };
  return {
    ctx,
    caps,
    sfxBus,
    nodes,
    stats: () => ({ held, claims, releases, buffers }),
    setOpen(v: boolean) {
      open = v;
    },
  };
}

const IDLE = { speed: 0, throttle: false, boosting: false, drifting: false };
const FAST = { speed: 80, throttle: true, boosting: false, drifting: false };
const CRUISE = { speed: 60, throttle: true, boosting: false, drifting: false };
const electric: RacingEngineProfile = { family: 'electric' };
const combustion: RacingEngineProfile = { family: 'combustion' };
const arcane: RacingEngineProfile = { family: 'arcane' };

describe('normalizeEngineDiscipline', () => {
  it('stays hover unless explicitly jetski', () => {
    for (const v of [undefined, null, 'hover', '', 'jetski ', 'JETSKI', 42] as const) {
      expect(normalizeEngineDiscipline(v)).toBe('hover');
    }
    expect(normalizeEngineDiscipline('jetski')).toBe('jetski');
  });
});

describe('resolveEngineProfile disciplines', () => {
  it('keeps the exact legacy voice when discipline is omitted', () => {
    for (const d of [undefined, null, 'hover'] as const) {
      const r = resolveEngineProfile(undefined, d);
      expect(r.discipline).toBe('hover');
      expect(r.baseHz).toBe(LEGACY_ENGINE.baseHz);
      expect(r.speedHz).toBe(LEGACY_ENGINE.speedHz);
      expect(r.throttleHz).toBe(LEGACY_ENGINE.throttleHz);
      expect(r.driftHz).toBe(LEGACY_ENGINE.driftHz);
      expect(r.filterBase).toBe(LEGACY_ENGINE.filterBase);
      expect(r.burnerCutoff).toBe(LEGACY_BURNER.cutoffHz);
      expect(r.burnerGain).toBe(LEGACY_BURNER.gain);
    }
  });

  it('retunes every family for jetski but keeps family/tone/pitch variation', () => {
    for (const profile of [electric, combustion, arcane]) {
      const hover = resolveEngineProfile(profile);
      const ski = resolveEngineProfile(profile, 'jetski');
      expect(ski.discipline).toBe('jetski');
      // Same authored family underneath the marine retune.
      expect(ski.family).toBe(hover.family);
      expect(ski.oscType).toBe(hover.oscType);
      // Detectably distinct motor + hissier water band.
      expect(ski.baseHz).not.toBe(hover.baseHz);
      expect(ski.speedHz).not.toBe(hover.speedHz);
      expect(ski.throttleHz).not.toBe(hover.throttleHz);
      expect(ski.driftHz).not.toBe(hover.driftHz);
      expect(ski.filterBase).not.toBe(hover.filterBase);
      expect(ski.burnerCutoff).toBeGreaterThan(hover.burnerCutoff);
      // Tone/pitch knobs survive the retune untouched.
      expect(ski.pitchRatio).toBe(hover.pitchRatio);
      expect(ski.filterScale).toBe(hover.filterScale);
    }
    // Families stay separated from each other on water too.
    const bases = [electric, combustion, arcane].map(
      (p) => resolveEngineProfile(p, 'jetski').baseHz,
    );
    expect(new Set(bases).size).toBe(3);
    const cutoffs = [electric, combustion, arcane].map(
      (p) => resolveEngineProfile(p, 'jetski').burnerCutoff,
    );
    expect(new Set(cutoffs).size).toBe(3);
    // Pitch semitones still double the motor on water.
    expect(
      resolveEngineProfile({ family: 'combustion', pitch: 12 }, 'jetski').pitchRatio,
    ).toBeCloseTo(2, 10);
  });
});

describe('jetskiWaterGain/Cutoff', () => {
  const voice = resolveEngineProfile(combustion, 'jetski');

  it('is silent at rest, swells with speed, and answers carve and boost', () => {
    expect(jetskiWaterGain(0, false, false, voice)).toBe(0);
    expect(jetskiWaterGain(0.01, true, false, voice)).toBe(0);
    const slow = jetskiWaterGain(0.08, false, false, voice);
    const fast = jetskiWaterGain(0.6, false, false, voice);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
    expect(jetskiWaterGain(0.5, true, false, voice)).toBeGreaterThan(
      jetskiWaterGain(0.5, false, false, voice),
    );
    expect(jetskiWaterGain(0.5, false, true, voice)).toBeGreaterThan(
      jetskiWaterGain(0.5, false, false, voice),
    );
    // Boost still thrusts from a standstill (manual boost at launch).
    expect(jetskiWaterGain(0, false, true, voice)).toBeGreaterThan(0);
  });

  it('never clips: capped below the motor+music headroom', () => {
    for (const norm of [0, 0.3, 0.6, 1, 5, NaN]) {
      for (const carving of [false, true]) {
        for (const boosting of [false, true]) {
          const g = jetskiWaterGain(norm, carving, boosting, voice);
          expect(Number.isFinite(g)).toBe(true);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(JETSKI_WATER_GAIN_CAP);
        }
      }
    }
  });

  it('brightens the rush with speed and opens further on boost', () => {
    const slow = jetskiWaterCutoff(0.1, false, voice);
    const fast = jetskiWaterCutoff(0.8, false, voice);
    expect(fast).toBeGreaterThan(slow);
    expect(jetskiWaterCutoff(0.5, true, voice)).toBeGreaterThan(
      jetskiWaterCutoff(0.5, false, voice),
    );
  });
});

describe('HoverEngine jetski voice', () => {
  it('holds the exact legacy mix when discipline is omitted', () => {
    const w = world();
    const e = new HoverEngine();
    expect(e.voiceDiscipline()).toBe('hover');
    e.attach(w.caps);
    e.update(FAST);
    expect(e.status().pitchHz).toBeCloseTo(78 + (80 / 128) * 138 + 34, 6);
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('sawtooth');
    // Cruise without boost holds the motor alone: no water on hover.
    expect(e.sources).toBe(1);
    expect(w.nodes.filter((n) => n.kind === 'noise')).toHaveLength(0);
    e.stop();
  });

  it('sounds distinct on water at identical state, keeping load response', () => {
    const hover = new HoverEngine(combustion);
    const ski = new HoverEngine(combustion, 'jetski');
    const w1 = world();
    const w2 = world();
    hover.attach(w1.caps);
    ski.attach(w2.caps);
    hover.update(FAST);
    ski.update(FAST);
    expect(ski.status().pitchHz).not.toBe(hover.status().pitchHz);
    expect(w2.nodes.find((n) => n.kind === 'gain')!.gain.value).not.toBe(
      w1.nodes.find((n) => n.kind === 'gain')!.gain.value,
    );
    // Speed / throttle / boost load response survives the retune.
    ski.update({ ...IDLE, speed: 10 });
    const slow = ski.status().pitchHz;
    ski.update(FAST);
    const fast = ski.status().pitchHz;
    expect(fast).toBeGreaterThan(slow);
    ski.update({ ...FAST, throttle: false });
    expect(ski.status().pitchHz).toBeLessThan(fast);
    const coastGain = w2.nodes.find((n) => n.kind === 'gain')!.gain.value;
    ski.update(FAST);
    expect(w2.nodes.find((n) => n.kind === 'gain')!.gain.value).toBeGreaterThan(coastGain);
    ski.update({ ...FAST, boosting: true });
    expect(ski.status().pitchHz).toBeLessThan(fast); // loaded deep thrust
    expect(w2.nodes.find((n) => n.kind === 'gain')!.gain.value).toBeGreaterThan(coastGain);
    hover.stop();
    ski.stop();
    expect(w1.stats().held).toBe(0);
    expect(w2.stats().held).toBe(0);
  });

  it('rushes water on the repurposed second source: rest silent, motion loud', () => {
    const w = world();
    const e = new HoverEngine(combustion, 'jetski');
    e.attach(w.caps);
    for (let k = 0; k < 10; k++) e.update(IDLE);
    expect(e.sources).toBe(1);
    expect(w.nodes.filter((n) => n.kind === 'noise')).toHaveLength(0);
    e.update(CRUISE);
    expect(e.sources).toBe(2);
    const rush = w.nodes.filter((n) => n.kind === 'noise');
    expect(rush).toHaveLength(1);
    expect(rush[0]!.loop).toBe(true);
    expect(rush[0]!.started).toBe(true);
    // Still looped noise through the shared SFX bus — never a bell.
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(1);
    const waterGain = w.nodes.filter((n) => n.kind === 'gain').at(-1)!;
    expect(waterGain.connected).toContain(w.sfxBus);
    const cruiseGain = waterGain.gain.value;
    expect(cruiseGain).toBeGreaterThan(0);
    // Faster water and carve wakes run louder; boost surges loudest.
    e.update({ ...CRUISE, speed: 110 });
    expect(waterGain.gain.value).toBeGreaterThan(cruiseGain);
    e.update({ ...CRUISE, drifting: true });
    expect(waterGain.gain.value).toBeGreaterThan(cruiseGain);
    e.update({ ...CRUISE, boosting: true });
    const boostGain = waterGain.gain.value;
    expect(boostGain).toBeGreaterThan(cruiseGain);
    expect(boostGain).toBeLessThanOrEqual(JETSKI_WATER_GAIN_CAP);
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('lets the tail fade after halting, then reuses the cached buffer', () => {
    const w = world();
    const e = new HoverEngine(combustion, 'jetski');
    e.attach(w.caps);
    e.update(CRUISE);
    const rush = w.nodes.find((n) => n.kind === 'noise')!;
    e.update(IDLE);
    w.ctx.currentTime += 0.2;
    e.update(IDLE);
    expect(e.sources).toBe(1);
    expect(rush.stopped).toBe(true);
    expect(rush.disconnected).toBe(true);
    e.update(CRUISE);
    expect(e.sources).toBe(2);
    expect(w.stats().buffers).toBe(1);
    e.stop();
    e.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
    expect(w.nodes.every((n) => n.disconnected)).toBe(true);
  });

  it('never exceeds two player sources across a speed/carve/boost sweep', () => {
    const w = world();
    const e = new HoverEngine(arcane, 'jetski');
    e.attach(w.caps);
    for (let speed = 0; speed <= 140; speed += 8) {
      for (const extra of [
        {},
        { drifting: true },
        { boosting: true },
        { boosting: true, drifting: true, throttle: true },
      ] as const) {
        e.update({ speed, throttle: speed > 0, boosting: false, drifting: false, ...extra });
        expect(e.sources).toBeLessThanOrEqual(2);
      }
      w.ctx.currentTime += 1 / 60;
    }
    e.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
  });

  it('switches discipline live with no new nodes and restores legacy on hover', () => {
    const w = world();
    const e = new HoverEngine(combustion);
    e.attach(w.caps);
    e.update(FAST);
    const legacyPitch = e.status().pitchHz;
    const before = w.nodes.length;
    e.setProfile(null, 'jetski');
    expect(e.voiceDiscipline()).toBe('jetski');
    e.update(FAST);
    // The switch claims exactly the one repurposed water voice, then holds
    // steady: further updates allocate nothing.
    expect(w.nodes.length).toBe(before + 3);
    expect(e.sources).toBe(2);
    for (let k = 0; k < 20; k++) {
      w.ctx.currentTime += 1 / 60;
      e.update(FAST);
    }
    expect(w.nodes.length).toBe(before + 3);
    expect(e.status().pitchHz).not.toBe(legacyPitch);
    // A bare timbre switch keeps the water mix (sticky discipline).
    e.setProfile(arcane);
    expect(e.voiceDiscipline()).toBe('jetski');
    expect(w.nodes.find((n) => n.kind === 'osc')!.type).toBe('square');
    // Explicit hover returns the exact legacy pitch.
    e.setProfile(null, 'hover');
    e.update(FAST);
    expect(e.status().pitchHz).toBe(legacyPitch);
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('stays silent on a spent budget for motor and water, then starts', () => {
    const w = world(false);
    const e = new HoverEngine(combustion, 'jetski');
    e.attach(w.caps);
    e.update(CRUISE);
    expect(e.active).toBe(false);
    expect(e.sources).toBe(0);
    w.setOpen(true);
    e.update(CRUISE);
    expect(e.active).toBe(true);
    expect(e.sources).toBe(2);
    e.stop();
    expect(w.stats().held).toBe(0);
  });
});

describe('jetski rivals', () => {
  const player = { s: 100, x: 0, speed: 70, finished: false };

  it('matches legacy without a discipline and separates at every speed with one', () => {
    const rival = { s: 106, x: -2, speed: 66, finished: false };
    expect(rivalSound(player, rival, 1, 3000, null, null)).toEqual(
      rivalSound(player, rival, 1, 3000),
    );
    for (let speed = 0; speed <= 140; speed += 5) {
      const r = { s: 106, x: -2, speed, finished: false };
      const hover = rivalSound(player, r, 1, 3000)!;
      const ski = rivalSound(player, r, 1, 3000, null, 'jetski')!;
      // Proportional marine retune: separated pitch + softer wash, same
      // distance envelope, pan, and seam behavior.
      expect(ski.pitchHz).toBeLessThan(hover.pitchHz);
      expect(ski.gain).toBeLessThan(hover.gain);
      expect(ski.gain).toBeGreaterThan(0);
      expect(ski.pan).toBe(hover.pan);
      expect(ski.distance).toBe(hover.distance);
    }
    // Pitch semitones still scale the jetski rival voice.
    const up = rivalSound(player, rival, 1, 3000, { family: 'combustion', pitch: 12 }, 'jetski')!;
    const flat = rivalSound(player, rival, 1, 3000, null, 'jetski')!;
    expect(up.pitchHz).toBeCloseTo(flat.pitchHz * 2, 6);
  });

  it('voices the whole jetski field within the race budget and releases all', () => {
    const field = (s0: number) => [
      { s: s0, x: 0, speed: 70, finished: false },
      { s: s0 + 6, x: -2, speed: 66, finished: false },
      { s: s0 + 12, x: 2, speed: 64, finished: false },
      { s: s0 + 200, x: 0, speed: 60, finished: false },
    ];
    const hoverMix = new RaceEngineAudio(combustion, [electric, arcane]);
    const skiMix = new RaceEngineAudio(combustion, [electric, arcane], 'jetski');
    const w1 = world();
    const w2 = world();
    expect(skiMix.voiceDiscipline()).toBe('jetski');
    expect(hoverMix.voiceDiscipline()).toBe('hover');
    hoverMix.attach(w1.caps);
    skiMix.attach(w2.caps);
    // At rest the water rush claims nothing, so both mixes voice two rivals.
    for (let i = 0; i < 30; i++) {
      w1.ctx.currentTime += 1 / 60;
      w2.ctx.currentTime += 1 / 60;
      hoverMix.update({ ...IDLE }, field(100), 0, 3000);
      skiMix.update({ ...IDLE }, field(100), 0, 3000);
    }
    // Same authored timbres on both mixes, jetski rivals pitched deeper.
    const hoverRivals = hoverMix.snapshot().rivals;
    const skiRivals = skiMix.snapshot().rivals;
    expect(skiRivals.map((r) => r.index).sort()).toEqual([1, 2]);
    for (const ski of skiRivals) {
      const twin = hoverRivals.find((r) => r.index === ski.index)!;
      expect(ski.pitchHz).toBeLessThan(twin.pitchHz);
    }
    const types = w2.nodes.filter((n) => n.kind === 'osc').map((n) => n.type);
    expect(types).toContain('sawtooth');
    expect(types).toContain('sine');
    expect(types).toContain('square');
    // Cruising, the water rush takes boost-style priority: it frees the
    // quieter rival first, so the player's own craft never starves and
    // the race still holds at most 3 sources.
    for (let i = 0; i < 30; i++) {
      w1.ctx.currentTime += 1 / 60;
      w2.ctx.currentTime += 1 / 60;
      hoverMix.update({ ...FAST }, field(100), 0, 3000);
      skiMix.update({ ...FAST }, field(100), 0, 3000);
    }
    expect(hoverMix.snapshot().rivals.map((r) => r.index).sort()).toEqual([1, 2]);
    expect(skiMix.snapshot().rivals).toHaveLength(1);
    expect(skiMix.snapshot().sources).toBeLessThanOrEqual(3);
    // Steady-state updates allocate no nodes on either mix.
    const count = w2.nodes.length;
    for (let i = 0; i < 30; i++) {
      w2.ctx.currentTime += 1 / 60;
      skiMix.update({ ...FAST }, field(100), 0, 3000);
    }
    expect(w2.nodes.length).toBe(count);
    // Boost saturation still yields to thrust, then everything releases.
    for (let i = 0; i < 60; i++) {
      w2.ctx.currentTime += 1 / 60;
      skiMix.update({ ...FAST, boosting: true }, field(100), 0, 3000);
    }
    expect(skiMix.snapshot().sources).toBeLessThanOrEqual(3);
    expect(skiMix.snapshot().rivals.length).toBeLessThanOrEqual(1);
    hoverMix.stop();
    skiMix.stop();
    skiMix.stop();
    expect(w1.stats().held).toBe(0);
    expect(w2.stats().held).toBe(0);
    expect(w1.stats().claims).toBe(w1.stats().releases);
    expect(w2.stats().claims).toBe(w2.stats().releases);
    expect(w2.nodes.every((n) => n.disconnected)).toBe(true);
  });
});
