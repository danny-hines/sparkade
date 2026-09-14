// Racing continuous-engine tests: helper behavior on fake WebAudio nodes plus
// game integration (lifecycle, pause hook, telemetry). No real AudioContext.
import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS } from '@sparkade/shared';
import type { EngineContext, GameInstance, InputSnapshot } from '@sparkade/engine';
import { HoverEngine, type HoverEngineCaps } from '../src/racing/audio';
import { createRacingGame, type RacingDevHandle } from '../src/racing/game';

const DT = 1 / 60;

interface FakeParam {
  value: number;
  sets: number[];
  setTargetAtTime(v: number, at: number, tc: number): void;
}

interface FakeNode {
  connected: unknown[];
  disconnects: number;
  connect(dest: unknown): void;
  disconnect(): void;
}

function fakeParam(value = 0): FakeParam {
  return {
    value,
    sets: [],
    setTargetAtTime(v: number) {
      this.value = v;
      this.sets.push(v);
    },
  };
}

function fakeNode(): FakeNode {
  return {
    connected: [],
    disconnects: 0,
    connect(dest: unknown) {
      this.connected.push(dest);
    },
    disconnect() {
      this.disconnects++;
    },
  };
}

interface FakeVoice {
  type: string;
  frequency: FakeParam;
  started: boolean;
  stopped: boolean;
  connect(dest: unknown): void;
  disconnect(): void;
  start(): void;
  stop(at?: number): void;
}

function fakeVoice(): FakeVoice {
  const node = fakeNode();
  return {
    type: '',
    frequency: fakeParam(0),
    started: false,
    stopped: false,
    ...node,
    start() {
      this.started = true;
    },
    stop() {
      this.stopped = true;
    },
  };
}

interface FakeCtx {
  currentTime: number;
  oscCount: number;
  lastOsc: FakeVoice | null;
  lastGain: ({ gain: FakeParam } & FakeNode) | null;
  createOscillator(): FakeVoice;
  createGain(): { gain: FakeParam } & FakeNode;
  createBiquadFilter(): { type: string; frequency: FakeParam } & FakeNode;
}

function fakeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    currentTime: 0,
    oscCount: 0,
    lastOsc: null,
    lastGain: null,
    createOscillator() {
      this.oscCount++;
      this.lastOsc = fakeVoice();
      return this.lastOsc;
    },
    createGain() {
      const node = fakeNode();
      const gain = { gain: fakeParam(0), ...node };
      this.lastGain = gain;
      return gain;
    },
    createBiquadFilter() {
      const node = fakeNode();
      return { type: '', frequency: fakeParam(0), ...node };
    },
  };
  return ctx;
}

interface FakeCaps extends HoverEngineCaps {
  claims: number;
  releases: number;
  budgetOpen: boolean;
}

function fakeCaps(ctx: FakeCtx): FakeCaps {
  const sfxBus = fakeNode();
  const caps = {
    claims: 0,
    releases: 0,
    budgetOpen: true,
    context: () => ctx as unknown as AudioContext,
    sfxBus: sfxBus as unknown as GainNode,
    claimVoice() {
      if (!this.budgetOpen) return false;
      this.claims++;
      return true;
    },
    releaseVoice() {
      this.releases++;
    },
  };
  return caps;
}

const IDLE = { speed: 0, throttle: false, boosting: false, drifting: false };
const FAST = { speed: 80, throttle: true, boosting: false, drifting: false };

describe('hover engine helper', () => {
  it('stays silent with no capability and never throws', () => {
    const e = new HoverEngine();
    e.update(FAST);
    e.stop();
    expect(e.active).toBe(false);
    expect(e.status()).toEqual({ on: false, pitchHz: 0 });
  });

  it('skips a spent voice budget and starts when it frees', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    caps.budgetOpen = false;
    const e = new HoverEngine();
    e.attach(caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    expect(ctx.oscCount).toBe(0);
    caps.budgetOpen = true;
    e.update(FAST);
    expect(e.active).toBe(true);
    expect(ctx.oscCount).toBe(1);
  });

  it('reuses one harmonic/lowpass voice routed to the SFX bus', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    const e = new HoverEngine();
    e.attach(caps);
    for (let k = 0; k < 30; k++) e.update(FAST);
    expect(ctx.oscCount).toBe(1);
    expect(ctx.lastOsc!.type).toBe('sawtooth');
    expect(ctx.lastOsc!.started).toBe(true);
    // Chain ends at the shared SFX bus: bus volume/mute apply untouched.
    expect(ctx.lastGain!.connected).toEqual([caps.sfxBus]);
  });

  it('raises pitch with speed and adds deeper load with boost', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    const e = new HoverEngine();
    e.attach(caps);
    e.update({ ...IDLE, speed: 10 });
    const slowPitch = ctx.lastOsc!.frequency.sets.at(-1)!;
    const slowGain = ctx.lastGain!.gain.sets.at(-1)!;
    e.update(FAST);
    const fastPitch = ctx.lastOsc!.frequency.sets.at(-1)!;
    const fastGain = ctx.lastGain!.gain.sets.at(-1)!;
    e.update({ ...FAST, boosting: true });
    const boostPitch = ctx.lastOsc!.frequency.sets.at(-1)!;
    const boostGain = ctx.lastGain!.gain.sets.at(-1)!;
    expect(fastPitch).toBeGreaterThan(slowPitch);
    expect(fastGain).toBeGreaterThan(slowGain);
    expect(boostPitch).toBeLessThan(fastPitch);
    expect(boostGain).toBeGreaterThan(fastGain);
    expect(e.status().on).toBe(true);
    expect(e.status().pitchHz).toBeGreaterThan(0);
  });

  it('releases the voice exactly once across repeated stops', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    const e = new HoverEngine();
    e.attach(caps);
    e.update(FAST);
    expect(e.active).toBe(true);
    e.stop();
    e.stop();
    e.stop();
    expect(caps.releases).toBe(1);
    expect(ctx.lastOsc!.stopped).toBe(true);
    expect(e.active).toBe(false);
    expect(e.status()).toEqual({ on: false, pitchHz: 0 });
  });
});

type DevGame = GameInstance & RacingDevHandle & { setPaused(paused: boolean): void };

function blankInput(): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const b of LOGICAL_BUTTONS) input[b] = { held: false, pressed: false, released: false };
  return input;
}

function devGame(extra: Record<string, unknown> = {}): DevGame {
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient') return () => gradient;
        return (..._args: unknown[]) => undefined;
      },
      set: () => true,
    },
  );
  const engine = { renderer: { ctx }, ...extra } as unknown as EngineContext;
  return createRacingGame(engine) as DevGame;
}

/** Advance past title + countdown into live racing. */
function driveToRace(game: DevGame): void {
  game.racingDev.setAutopilot(true);
  for (let f = 0; f < 300 && game.racingDev.snapshot().phase !== 'race'; f++) {
    game.update(DT, blankInput());
  }
  expect(game.racingDev.snapshot().phase).toBe('race');
}

interface ProbeParam {
  value: number;
  sets: number[];
  throwOnSet: boolean;
  setTargetAtTime(v: number, at: number, tc: number): void;
}

interface ProbeNode {
  type: string;
  frequency: ProbeParam;
  gain: ProbeParam;
  connections: number;
  disconnects: number;
  started: boolean;
  stopped: boolean;
  throwOnStop: boolean;
  throwOnDisconnect: boolean;
  connect(dest: unknown): void;
  disconnect(): void;
  start(): void;
  stop(at?: number): void;
}

interface ProbeCtl {
  currentTime: number;
  nodes: ProbeNode[];
  connects: number;
  failStart: boolean;
  failConnectAt: number;
  failCreate: string | null;
  throwOnDisconnect: string | null;
}

function probeParam(): ProbeParam {
  return {
    value: 0,
    sets: [],
    throwOnSet: false,
    setTargetAtTime(v: number) {
      if (this.throwOnSet) throw new Error('injected param failure');
      this.value = v;
      this.sets.push(v);
    },
  };
}

function probeNode(ctl: ProbeCtl, type: string): ProbeNode {
  const node: ProbeNode = {
    type,
    frequency: probeParam(),
    gain: probeParam(),
    connections: 0,
    disconnects: 0,
    started: false,
    stopped: false,
    throwOnStop: false,
    throwOnDisconnect: false,
    connect() {
      ctl.connects++;
      if (ctl.failConnectAt === ctl.connects)
        throw new Error(`injected connect failure #${ctl.connects}`);
      this.connections++;
    },
    disconnect() {
      if (this.throwOnDisconnect || ctl.throwOnDisconnect === type) {
        throw new Error('injected disconnect failure');
      }
      this.connections = 0;
      this.disconnects++;
    },
    start() {
      if (ctl.failStart) throw new Error('injected start failure');
      this.started = true;
    },
    stop() {
      if (this.throwOnStop) throw new Error('injected stop failure');
      this.stopped = true;
    },
  };
  ctl.nodes.push(node);
  return node;
}

/** Failure-injecting audio world: tracks every node, claim, and release. */
function probeAudio(): {
  ctl: ProbeCtl;
  caps: HoverEngineCaps;
  counts: { claims: number; releases: number };
} {
  const ctl: ProbeCtl = {
    currentTime: 0,
    nodes: [],
    connects: 0,
    failStart: false,
    failConnectAt: 0,
    failCreate: null,
    throwOnDisconnect: null,
  };
  const context = {
    get currentTime() {
      return ctl.currentTime;
    },
    createOscillator() {
      if (ctl.failCreate === 'osc') throw new Error('injected create failure');
      return probeNode(ctl, 'osc');
    },
    createBiquadFilter() {
      if (ctl.failCreate === 'filter') throw new Error('injected create failure');
      return probeNode(ctl, 'filter');
    },
    createGain() {
      if (ctl.failCreate === 'gain') throw new Error('injected create failure');
      return probeNode(ctl, 'gain');
    },
  };
  const counts = { claims: 0, releases: 0 };
  const caps: HoverEngineCaps = {
    context: () => context as unknown as AudioContext,
    sfxBus: fakeNode() as unknown as GainNode,
    claimVoice() {
      counts.claims++;
      return true;
    },
    releaseVoice() {
      counts.releases++;
    },
  };
  return { ctl, caps, counts };
}

describe('hover engine failure teardown', () => {
  it('disconnects wired nodes when start throws after connection', () => {
    const p = probeAudio();
    p.ctl.failStart = true;
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    expect(p.counts.claims).toBe(1);
    expect(p.counts.releases).toBe(1);
    expect(p.ctl.nodes).toHaveLength(3);
    for (const n of p.ctl.nodes) {
      expect(n.connections).toBe(0);
      expect(n.disconnects).toBe(1);
    }
  });

  it('tears down partial graphs when a mid-chain connect throws', () => {
    const p = probeAudio();
    p.ctl.failConnectAt = 2; // osc->filter wired, filter->gain throws
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    expect(p.counts.releases).toBe(1);
    expect(p.ctl.nodes).toHaveLength(3);
    for (const n of p.ctl.nodes) {
      expect(n.connections).toBe(0);
      expect(n.disconnects).toBe(1);
    }
  });

  it('releases the claim when node creation throws mid-way', () => {
    const p = probeAudio();
    p.ctl.failCreate = 'gain';
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    expect(p.ctl.nodes).toHaveLength(2);
    expect(p.counts.claims).toBe(1);
    expect(p.counts.releases).toBe(1);
  });

  it('retries after failure and keeps later updates working', () => {
    const p = probeAudio();
    p.ctl.failStart = true;
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    p.ctl.failStart = false;
    e.update(IDLE);
    expect(e.active).toBe(true);
    expect(p.counts.claims).toBe(2);
    expect(p.counts.releases).toBe(1);
    const osc = p.ctl.nodes[3]!; // retry voice oscillator (first attempt left nodes 0-2)
    const before = osc.frequency.sets.length;
    e.update(FAST);
    expect(osc.frequency.sets.length).toBeGreaterThan(before);
    expect(osc.frequency.sets.at(-1)!).toBeGreaterThan(osc.frequency.sets[0]!);
    e.stop();
    expect(p.counts.releases).toBe(2);
    e.stop();
    expect(p.counts.releases).toBe(2);
  });

  it('still stops the oscillator when the gain ramp throws', () => {
    const p = probeAudio();
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    p.ctl.nodes[2]!.gain.throwOnSet = true;
    expect(() => e.stop()).not.toThrow();
    expect(p.ctl.nodes[0]!.stopped).toBe(true);
    for (const n of p.ctl.nodes) expect(n.disconnects).toBe(1);
    expect(p.counts.releases).toBe(1);
  });

  it('still disconnects everything when the oscillator stop throws', () => {
    const p = probeAudio();
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    p.ctl.nodes[0]!.throwOnStop = true;
    expect(() => e.stop()).not.toThrow();
    for (const n of p.ctl.nodes) expect(n.disconnects).toBe(1);
    expect(p.counts.releases).toBe(1);
    expect(e.active).toBe(false);
  });

  it('one throwing disconnect cannot strand sibling nodes', () => {
    const p = probeAudio();
    p.ctl.failStart = true;
    p.ctl.throwOnDisconnect = 'filter';
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(false);
    // Siblings still cleaned up despite the filter refusing disconnect.
    expect(p.ctl.nodes[0]!.connections).toBe(0);
    expect(p.ctl.nodes[0]!.disconnects).toBe(1);
    expect(p.ctl.nodes[2]!.connections).toBe(0);
    expect(p.ctl.nodes[2]!.disconnects).toBe(1);
    expect(p.counts.releases).toBe(1);
  });

  it('contains update parameter failures without crashing and recovers', () => {
    const p = probeAudio();
    const e = new HoverEngine();
    e.attach(p.caps);
    e.update(FAST);
    expect(e.active).toBe(true);
    p.ctl.nodes[0]!.frequency.throwOnSet = true;
    expect(() => e.update(FAST)).not.toThrow();
    expect(e.active).toBe(false);
    p.ctl.nodes[0]!.frequency.throwOnSet = false;
    // New voice (old nodes were dropped); updates work again.
    e.update(FAST);
    expect(e.active).toBe(true);
    expect(e.status().pitchHz).toBeGreaterThan(0);
  });
});

describe('racing engine integration', () => {
  it('runs silent without audio capability and reports it', () => {
    const game = devGame();
    driveToRace(game);
    game.update(DT, blankInput());
    const s = game.racingDev.snapshot();
    expect(s.player.engineOn).toBe(false);
    expect(s.player.enginePitchHz).toBe(0);
    game.dispose();
  });

  it('starts on GO, pauses, restarts, and disposes exactly once', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    const game = devGame({ audio: caps });
    // Title and countdown stay quiet.
    game.update(DT, blankInput());
    expect(game.racingDev.snapshot().player.engineOn).toBe(false);
    expect(ctx.oscCount).toBe(0);
    driveToRace(game);
    game.update(DT, blankInput());
    expect(game.racingDev.snapshot().player.engineOn).toBe(true);
    expect(game.racingDev.snapshot().player.enginePitchHz).toBeGreaterThan(0);
    expect(ctx.oscCount).toBe(3);
    // Host pause halts the hum; resume restarts lazily on the same voice budget.
    game.setPaused(true);
    expect(game.racingDev.snapshot().player.engineOn).toBe(false);
    game.setPaused(false);
    game.update(DT, blankInput());
    expect(game.racingDev.snapshot().player.engineOn).toBe(true);
    // Restart is quiet until the next GO; dispose balances the budget.
    game.restart();
    expect(game.racingDev.snapshot().player.engineOn).toBe(false);
    game.dispose();
    game.dispose();
    expect(caps.claims).toBe(caps.releases);
    expect(caps.releases).toBeGreaterThanOrEqual(1);
  });

  it('never drives audio from render', () => {
    const ctx = fakeCtx();
    const caps = fakeCaps(ctx);
    const game = devGame({ audio: caps });
    driveToRace(game);
    const before = ctx.oscCount;
    for (let k = 0; k < 10; k++) game.render();
    expect(ctx.oscCount).toBe(before);
    game.dispose();
  });
});
