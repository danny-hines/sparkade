// Composable traversal audio tests: bicycle/motorcycle/skateboard/invented
// racers sharing one engine plus accurate proximity sounds. Fake WebAudio
// only — no real AudioContext.
import { describe, expect, it } from 'vitest';
import type { RacingEngineProfile, RacingTraversal } from '@sparkade/shared';
import { HoverEngine, type HoverEngineCaps } from '../src/racing/audio';
import { RaceEngineAudio, rivalSound } from '../src/racing/rival-audio';
import { LEGACY_BURNER, LEGACY_ENGINE, resolveEngineProfile } from '../src/racing/sound-profile';
import {
  applyCadence,
  HUMAN_GAIN_CAP,
  humanCadenceHz,
  humanDriveGain,
  MAGIC_TONE_CAP,
} from '../src/racing/traversal-audio';

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

function world(budgetOpen = true, reserved = 0) {
  let held = reserved;
  let claims = 0;
  let releases = 0;
  let buffers = 0;
  let max = reserved;
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
      max = Math.max(max, held);
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
    stats: () => ({ held, claims, releases, buffers, max }),
    setOpen(v: boolean) {
      open = v;
    },
  };
}

const IDLE = { speed: 0, throttle: false, boosting: false, drifting: false };
const COAST = { speed: 60, throttle: false, boosting: false, drifting: false };
const CRUISE = { speed: 60, throttle: true, boosting: false, drifting: false };
const FAST = { speed: 80, throttle: true, boosting: false, drifting: false };
const BOOST = { speed: 80, throttle: true, boosting: true, drifting: false };

const MOTOR_GROUND: RacingTraversal = {
  label: 'Moto Sprint',
  handling: 'grip',
  surface: 'ground',
  rider: 'seated',
  propulsion: 'motor',
};
const MOTOR_WATER: RacingTraversal = {
  label: 'Tide Moto',
  handling: 'carve',
  surface: 'water',
  rider: 'seated',
  propulsion: 'motor',
};
const HUMAN_GROUND: RacingTraversal = {
  label: 'Cycle Sprint',
  handling: 'grip',
  surface: 'ground',
  rider: 'seated',
  propulsion: 'human',
};
const HUMAN_FOOT: RacingTraversal = {
  label: 'Street Carve',
  handling: 'carve',
  surface: 'ground',
  rider: 'onFoot',
  propulsion: 'human',
};
const HUMAN_WATER: RacingTraversal = {
  label: 'Paddle Sprint',
  handling: 'flow',
  surface: 'water',
  rider: 'standing',
  propulsion: 'human',
};
const MAGIC_GROUND: RacingTraversal = {
  label: 'Charm Drift',
  handling: 'flow',
  surface: 'ground',
  rider: 'standing',
  propulsion: 'magic',
};
const MAGIC_WATER: RacingTraversal = {
  label: 'Tide Charms',
  handling: 'carve',
  surface: 'water',
  rider: 'standing',
  propulsion: 'magic',
};
const combustion: RacingEngineProfile = { family: 'combustion' };

describe('traversal legacy exactness', () => {
  it('keeps the exact hover mix when traversal is absent or null', () => {
    const a = new HoverEngine();
    const b = new HoverEngine(null, null, null);
    const c = new HoverEngine(combustion, null, MOTOR_GROUND);
    const w1 = world();
    const w2 = world();
    const w3 = world();
    a.attach(w1.caps);
    b.attach(w2.caps);
    c.attach(w3.caps);
    a.update(FAST);
    b.update(FAST);
    c.update(FAST);
    expect(b.status().pitchHz).toBe(a.status().pitchHz);
    // Motor on ground reuses the hover surface engine exactly.
    expect(c.status().pitchHz).toBeCloseTo(
      78 + (80 / 128) * 138 + 34,
      6,
    );
    expect(w3.nodes.find((n) => n.kind === 'osc')!.type).toBe('sawtooth');
    expect(c.sources).toBe(1);
    a.stop();
    b.stop();
    c.stop();
  });

  it('maps motor on water to the jetski mix', () => {
    const ski = new HoverEngine(combustion, 'jetski');
    const trav = new HoverEngine(combustion, null, MOTOR_WATER);
    const w1 = world();
    const w2 = world();
    ski.attach(w1.caps);
    trav.attach(w2.caps);
    ski.update(FAST);
    trav.update(FAST);
    expect(trav.status().pitchHz).toBe(ski.status().pitchHz);
    expect(trav.sources).toBe(2);
    ski.stop();
    trav.stop();
  });

  it('keeps rivalSound byte-identical without traversal', () => {
    const p = { s: 100, x: 0, speed: 70, finished: false };
    const r = { s: 106, x: -2, speed: 66, finished: false };
    expect(rivalSound(p, r, 1, 3000, null, null, null)).toEqual(rivalSound(p, r, 1, 3000));
    expect(rivalSound(p, r, 1, 3000, null, null, undefined)).toEqual(
      rivalSound(p, r, 1, 3000),
    );
  });

  it('ignores the freeform label: same axes sound identical', () => {
    const a: RacingTraversal = { ...HUMAN_GROUND, label: 'Cycle Sprint' };
    const b: RacingTraversal = { ...HUMAN_GROUND, label: 'Invented Zoomers' };
    const w1 = world();
    const w2 = world();
    const e1 = new HoverEngine(null, null, a);
    const e2 = new HoverEngine(null, null, b);
    e1.attach(w1.caps);
    e2.attach(w2.caps);
    e1.update(CRUISE);
    e2.update(CRUISE);
    expect(w1.nodes.find((n) => n.kind === 'gain')!.gain.value).toBe(
      w2.nodes.find((n) => n.kind === 'gain')!.gain.value,
    );
    const p = { s: 100, x: 0, speed: 70, finished: false };
    const r = { s: 106, x: -2, speed: 66, finished: false };
    expect(rivalSound(p, r, 1, 3000, null, null, b)).toEqual(
      rivalSound(p, r, 1, 3000, null, null, a),
    );
    e1.stop();
    e2.stop();
  });
});

describe('human movement voice', () => {
  it('is silent at rest with no hum and no burner', () => {
    const w = world();
    const e = new HoverEngine(combustion, null, HUMAN_GROUND);
    e.attach(w.caps);
    for (let k = 0; k < 10; k++) e.update(IDLE);
    expect(e.sources).toBe(0);
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(0);
    expect(w.nodes.filter((n) => n.kind === 'noise')).toHaveLength(0);
    expect(e.status()).toEqual({ on: false, pitchHz: 0 });
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('rolls audibly under accel: throttle raises exertion, boost pushes loudest', () => {
    const w = world();
    const e = new HoverEngine(combustion, null, HUMAN_GROUND);
    e.attach(w.caps);
    e.update(COAST);
    expect(e.sources).toBe(1);
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(0);
    const rush = w.nodes.filter((n) => n.kind === 'noise');
    expect(rush).toHaveLength(1);
    expect(rush[0]!.loop).toBe(true);
    expect(rush[0]!.started).toBe(true);
    // Noise runs through filter/gain into the shared SFX bus.
    expect(w.nodes.filter((n) => n.kind === 'gain').at(-1)!.connected).toContain(w.sfxBus);
    const coastGain = w.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(coastGain).toBeGreaterThan(0);
    expect(coastGain).toBeLessThanOrEqual(HUMAN_GAIN_CAP);
    e.update(CRUISE);
    const accelGain = w.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(accelGain).toBeGreaterThan(coastGain);
    e.update(BOOST);
    const boostGain = w.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(boostGain).toBeGreaterThan(accelGain);
    // Never a combustion burner: cutoff is the movement band, not the roar.
    const cutoff = w.nodes.filter((n) => n.kind === 'filter').at(-1)!.frequency.value;
    expect(cutoff).not.toBe(LEGACY_BURNER.cutoffHz);
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('colors exertion by rider and washes water on surface water', () => {
    expect(humanDriveGain(0.5, true, false, 'onFoot')).toBeGreaterThan(
      humanDriveGain(0.5, true, false, 'none'),
    );
    expect(humanCadenceHz(0.5, 'onFoot')).toBeGreaterThan(
      humanCadenceHz(0.1, 'onFoot'),
    );
    // Cadence modulates from monotonic audio time with no allocation.
    expect(applyCadence(0.1, 0.05, 5)).not.toBe(applyCadence(0.1, 0, 5));
    const g = world();
    const aq = world();
    const ground = new HoverEngine(null, null, HUMAN_GROUND);
    const wet = new HoverEngine(null, null, HUMAN_WATER);
    ground.attach(g.caps);
    wet.attach(aq.caps);
    ground.update(CRUISE);
    wet.update(CRUISE);
    const dryGain = g.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    const wetGain = aq.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(wetGain).toBeGreaterThan(dryGain);
    ground.stop();
    wet.stop();
  });

  it('reuses one cached noise buffer across rest/motion cycles', () => {
    const w = world();
    const e = new HoverEngine(null, null, HUMAN_FOOT);
    e.attach(w.caps);
    e.update(CRUISE);
    expect(e.sources).toBe(1);
    e.update(IDLE);
    w.ctx.currentTime += 0.2;
    e.update(IDLE);
    expect(e.sources).toBe(0);
    e.update(CRUISE);
    expect(e.sources).toBe(1);
    expect(w.stats().buffers).toBe(1);
    e.stop();
    e.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
  });
});

describe('magic voice', () => {
  it('stays silent at rest with no idle buzz', () => {
    const w = world();
    const e = new HoverEngine(combustion, null, MAGIC_GROUND);
    e.attach(w.caps);
    for (let k = 0; k < 10; k++) e.update(IDLE);
    expect(e.sources).toBe(0);
    expect(e.status()).toEqual({ on: false, pitchHz: 0 });
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('swells a restrained soft tone plus wind: coast < cruise < boost', () => {
    const w = world();
    const e = new HoverEngine(combustion, null, MAGIC_GROUND);
    e.attach(w.caps);
    e.update(COAST);
    expect(e.sources).toBe(2);
    const osc = w.nodes.find((n) => n.kind === 'osc')!;
    expect(osc.type).toBe('sine');
    const tone = w.nodes.filter((n) => n.kind === 'gain')[0]!.gain.value;
    expect(tone).toBeGreaterThan(0);
    expect(tone).toBeLessThanOrEqual(MAGIC_TONE_CAP);
    e.update(CRUISE);
    const cruiseTone = w.nodes.filter((n) => n.kind === 'gain')[0]!.gain.value;
    const cruiseWind = w.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(cruiseWind).toBeGreaterThan(0);
    e.update(BOOST);
    const boostWind = w.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(boostWind).toBeGreaterThan(cruiseWind);
    // No bells: exactly one tonal oscillator plus at most one wind source.
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(1);
    expect(w.nodes.filter((n) => n.kind === 'noise')).toHaveLength(1);
    expect(e.sources).toBeLessThanOrEqual(2);
    void cruiseTone;
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('washes water on surface water without getting loud', () => {
    const g = world();
    const aq = world();
    const dry = new HoverEngine(null, null, MAGIC_GROUND);
    const wet = new HoverEngine(null, null, MAGIC_WATER);
    dry.attach(g.caps);
    wet.attach(aq.caps);
    dry.update(CRUISE);
    wet.update(CRUISE);
    const dryWind = g.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    const wetWind = aq.nodes.filter((n) => n.kind === 'gain').at(-1)!.gain.value;
    expect(wetWind).toBeGreaterThan(dryWind);
    expect(wetWind).toBeLessThanOrEqual(0.3);
    dry.stop();
    wet.stop();
  });
});

describe('traversal rivals', () => {
  const player = { s: 100, x: 0, speed: 70, finished: false };

  it('voices human rivals as quiet proximity noise, silent at rest', () => {
    const resting = { s: 106, x: -2, speed: 0, finished: false };
    const rolling = { s: 106, x: -2, speed: 40, finished: false };
    const humanRest = rivalSound(player, resting, 1, 3000, null, null, HUMAN_GROUND)!;
    expect(humanRest.gain).toBe(0);
    const human = rivalSound(player, rolling, 1, 3000, null, null, HUMAN_GROUND)!;
    const motor = rivalSound(player, rolling, 1, 3000)!;
    expect(human.gain).toBeGreaterThan(0);
    expect(human.gain).toBeLessThan(motor.gain);
    // Proportional distance with stereo pan, same seam behavior.
    const far = rivalSound(player, { s: 150, x: -2, speed: 40, finished: false }, 1, 3000, null, null, HUMAN_GROUND)!;
    expect(human.gain).toBeGreaterThan(far.gain * 2);
    expect(human.pan).toBeLessThan(0);
    expect(
      rivalSound(player, { s: 106, x: 3, speed: 40, finished: false }, 1, 3000, null, null, HUMAN_GROUND)!.pan,
    ).toBeGreaterThan(0);
    const seam = rivalSound({ s: 2995, x: 0, speed: 70, finished: false }, { s: 5, x: 2, speed: 40, finished: false }, 2, 3000, null, null, HUMAN_GROUND)!;
    const straight = rivalSound({ s: 95, x: 0, speed: 70, finished: false }, { s: 105, x: 2, speed: 40, finished: false }, 2, 3000, null, null, HUMAN_GROUND)!;
    expect(seam.gain).toBeCloseTo(straight.gain, 10);
    expect(seam.pan).toBeCloseTo(straight.pan, 10);
  });

  it('voices magic rivals as a restrained shimmer, silent at rest', () => {
    const resting = { s: 106, x: -2, speed: 0, finished: false };
    const moving = { s: 106, x: -2, speed: 40, finished: false };
    expect(rivalSound(player, resting, 1, 3000, null, null, MAGIC_GROUND)!.gain).toBe(0);
    const magic = rivalSound(player, moving, 1, 3000, null, null, MAGIC_GROUND)!;
    const motor = rivalSound(player, moving, 1, 3000)!;
    expect(magic.gain).toBeGreaterThan(0);
    expect(magic.gain).toBeLessThan(motor.gain);
    expect(magic.gain).toBeLessThanOrEqual(MAGIC_TONE_CAP);
  });

  it('holds human rivals in noise voices and magic rivals in soft voices', () => {
    const field = (speed: number) => [
      { s: 100, x: 0, speed: 70, finished: false },
      { s: 106, x: -2, speed, finished: false },
      { s: 112, x: 2, speed, finished: false },
    ];
    const hw = world();
    const mw = world();
    const human = new RaceEngineAudio(null, [], null, HUMAN_GROUND);
    const magic = new RaceEngineAudio(null, [], null, MAGIC_GROUND);
    human.attach(hw.caps);
    magic.attach(mw.caps);
    for (let i = 0; i < 30; i++) {
      hw.ctx.currentTime += 1 / 60;
      mw.ctx.currentTime += 1 / 60;
      human.update({ ...CRUISE }, field(40), 0, 3000);
      magic.update({ ...CRUISE }, field(40), 0, 3000);
    }
    // Human rivals ride looped noise (no rival oscillators); magic rivals
    // ride soft sine oscillators.
    expect(hw.nodes.filter((n) => n.kind === 'noise').length).toBeGreaterThanOrEqual(1);
    expect(hw.nodes.filter((n) => n.kind === 'osc' && n.started)).toHaveLength(0);
    expect(mw.nodes.filter((n) => n.kind === 'osc').map((n) => n.type)).toContain('sine');
    // Resting human rivals hold no voice at all.
    for (let i = 0; i < 30; i++) {
      hw.ctx.currentTime += 1 / 60;
      human.update({ ...IDLE }, field(0), 0, 3000);
    }
    expect(human.snapshot().rivals).toHaveLength(0);
    human.stop();
    magic.stop();
    expect(hw.stats().held).toBe(0);
    expect(mw.stats().held).toBe(0);
  });
});

describe('traversal race budget and lifecycle', () => {
  const field = (s0: number, speed = 66) => [
    { s: s0, x: 0, speed: 70, finished: false },
    { s: s0 + 6, x: -2, speed, finished: false },
    { s: s0 + 12, x: 2, speed: speed - 2, finished: false },
    { s: s0 + 200, x: 0, speed: 60, finished: false },
  ];

  it('holds at most 3 sources under boost saturation for every propulsion', () => {
    for (const traversal of [MOTOR_GROUND, HUMAN_GROUND, MAGIC_GROUND, MAGIC_WATER] as const) {
      const w = world();
      const mix = new RaceEngineAudio(combustion, [combustion, combustion], null, traversal);
      mix.attach(w.caps);
      for (let i = 0; i < 60; i++) {
        w.ctx.currentTime += 1 / 60;
        mix.update({ ...FAST, boosting: true }, field(100), 0, 3000);
      }
      expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
      const count = w.nodes.length;
      for (let i = 0; i < 30; i++) {
        w.ctx.currentTime += 1 / 60;
        mix.update({ ...FAST, boosting: true }, field(100), 0, 3000);
      }
      expect(w.nodes.length).toBe(count);
      mix.stop();
      mix.stop();
      expect(w.stats().held).toBe(0);
      expect(w.stats().claims).toBe(w.stats().releases);
    }
  });

  it('leaves one transient voice free with music for traversal mixes', () => {
    const w = world(true, 4);
    const mix = new RaceEngineAudio(combustion, [combustion, combustion], null, HUMAN_GROUND);
    mix.attach(w.caps);
    for (let i = 0; i < 60; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...CRUISE }, field(100), 0, 3000);
    }
    expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
    expect(w.caps.claimVoice()).toBe(true);
    expect(w.caps.claimVoice()).toBe(false);
    w.caps.releaseVoice();
    mix.stop();
    expect(w.nodes.every((n) => n.disconnected)).toBe(true);
  });

  it('survives repeat attach/update/stop lifecycles and profile switches', () => {
    const w = world();
    const mix = new RaceEngineAudio(combustion, [combustion], null, HUMAN_GROUND);
    mix.attach(w.caps);
    for (let i = 0; i < 20; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...CRUISE }, field(100), 0, 3000);
    }
    mix.stop();
    mix.attach(w.caps);
    mix.setProfile(combustion, [combustion], null, MAGIC_WATER);
    for (let i = 0; i < 20; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...CRUISE }, field(100), 0, 3000);
    }
    // Back to the exact legacy path mid-session.
    mix.setProfile(null, [], null, null);
    for (let i = 0; i < 20; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...FAST }, field(100), 0, 3000);
    }
    expect(mix.status().pitchHz).toBeCloseTo(78 + (80 / 128) * 138 + 34, 6);
    mix.stop();
    mix.attach(null);
    expect(w.stats().claims).toBe(w.stats().releases);
    expect(w.stats().held).toBe(0);
  });

  it('stays silent on a spent budget and never throws without capability', () => {
    const w = world(false);
    const e = new HoverEngine(null, null, HUMAN_GROUND);
    e.attach(w.caps);
    expect(() => e.update(CRUISE)).not.toThrow();
    expect(e.sources).toBe(0);
    w.setOpen(true);
    e.update(CRUISE);
    expect(e.sources).toBe(1);
    const bare = new HoverEngine(null, null, MAGIC_GROUND);
    expect(() => bare.update(CRUISE)).not.toThrow();
    expect(() => bare.setProfile(null, null, HUMAN_GROUND)).not.toThrow();
    expect(() => bare.stop()).not.toThrow();
    e.stop();
    expect(w.stats().held).toBe(0);
  });

  it('keeps the legacy engine constants untouched', () => {
    expect(resolveEngineProfile(undefined).baseHz).toBe(LEGACY_ENGINE.baseHz);
    expect(LEGACY_ENGINE.baseHz).toBe(78);
  });
});

describe('traversal rival preemption', () => {
  const nearby = (speed = 40) => [
    { s: 100, x: 0, speed: 70, finished: false },
    { s: 106, x: -2, speed, finished: false },
    { s: 112, x: 2, speed: speed - 2, finished: false },
  ];

  it('holds two nearby human rivals steady across 120 moving updates', () => {
    const w = world();
    const mix = new RaceEngineAudio(null, [], null, HUMAN_GROUND);
    mix.attach(w.caps);
    for (let i = 0; i < 10; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...CRUISE }, nearby(), 0, 3000);
    }
    // One movement-noise source plus two rival noises: exactly the budget.
    expect(mix.snapshot().sources).toBe(3);
    expect(
      mix.snapshot().rivals.map((r) => r.index).sort(),
    ).toEqual([1, 2]);
    const steady = w.nodes.length;
    for (let i = 0; i < 120; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update({ ...CRUISE }, nearby(), 0, 3000);
      expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
      expect(
        mix.snapshot().rivals.map((r) => r.index).sort(),
      ).toEqual([1, 2]);
    }
    // No per-frame kill/recreate: node creation holds steady while both
    // rivals stay continuously voiced.
    expect(w.nodes.length).toBe(steady);
    mix.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
  });

  it('respects the 3-voice budget without churn across motor/human/magic, boost, and rest', () => {
    const w = world();
    const mix = new RaceEngineAudio(combustion, [combustion], null, MOTOR_GROUND);
    mix.attach(w.caps);
    const phases: { traversal: RacingTraversal; state: typeof CRUISE }[] = [
      { traversal: MOTOR_GROUND, state: CRUISE },
      { traversal: HUMAN_GROUND, state: CRUISE },
      { traversal: MAGIC_GROUND, state: CRUISE },
      { traversal: MAGIC_GROUND, state: BOOST },
      { traversal: HUMAN_GROUND, state: IDLE },
    ];
    for (const { traversal, state } of phases) {
      mix.setProfile(combustion, [combustion], null, traversal);
      for (let i = 0; i < 30; i++) {
        w.ctx.currentTime += 1 / 60;
        mix.update({ ...state }, nearby(), 0, 3000);
        expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
      }
      // Past the transition, steady updates allocate no nodes.
      const steady = w.nodes.length;
      for (let i = 0; i < 25; i++) {
        w.ctx.currentTime += 1 / 60;
        mix.update({ ...state }, nearby(), 0, 3000);
        expect(mix.snapshot().sources).toBeLessThanOrEqual(3);
      }
      expect(w.nodes.length).toBe(steady);
    }
    mix.stop();
    mix.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
  });
});
