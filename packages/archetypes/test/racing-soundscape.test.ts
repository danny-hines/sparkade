import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS } from '@sparkade/shared';
import type { EngineContext, GameInstance, InputSnapshot } from '@sparkade/engine';
import { HoverEngine, type HoverEngineCaps } from '../src/racing/audio';
import { RaceEngineAudio, rivalSound } from '../src/racing/rival-audio';
import { createRacingGame, type RacingDevHandle } from '../src/racing/game';

function world(reserved = 0) {
  let held = reserved,
    claims = 0,
    releases = 0,
    max = reserved,
    buffers = 0;
  const param = () => ({
    value: 0,
    setTargetAtTime(v: number) {
      this.value = v;
    },
  });
  function makeNode(kind: string) {
    return {
      kind,
      type: '',
      frequency: param(),
      gain: param(),
      pan: param(),
      buffer: null as unknown,
      loop: false,
      stopped: false,
      disconnected: false,
      failStart: false,
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
      start() {
        if (this.failStart) throw new Error('injected source failure');
      },
      stop() {
        this.stopped = true;
      },
    };
  }
  const nodes: ReturnType<typeof makeNode>[] = [];
  function node(kind: string) {
    const n = makeNode(kind);
    nodes.push(n);
    return n;
  }
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
    createGain: () => node('gain'),
    createStereoPanner: () => node('pan'),
    createBufferSource: () => node('noise'),
    createBuffer: (_channels: number, size: number) => {
      buffers++;
      const data = new Float32Array(size);
      return { getChannelData: () => data };
    },
  };
  const bus = {} as GainNode;
  const caps: HoverEngineCaps = {
    context: () => ctx as unknown as AudioContext,
    sfxBus: bus,
    claimVoice() {
      if (held >= 8) return false;
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
  return { ctx, caps, nodes, stats: () => ({ held, claims, releases, max, buffers }) };
}
const state = { speed: 70, throttle: true, boosting: false, drifting: false };
const racer = (s: number, x = 0, speed = 65) => ({ s, x, speed, finished: false });

describe('engine feedback and afterburner', () => {
  it('responds to throttle at the same speed, and relaxes on lift', () => {
    const w = world();
    const h = new HoverEngine();
    h.attach(w.caps);
    h.update({ ...state, throttle: false });
    const coast = h.status().pitchHz;
    const gain = w.nodes.find((n) => n.kind === 'gain')!;
    const coastGain = gain.gain.value;
    h.update(state);
    expect(h.status().pitchHz).toBeGreaterThan(coast + 20);
    expect(gain.gain.value).toBeGreaterThan(coastGain * 1.5);
    h.update({ ...state, throttle: false });
    expect(h.status().pitchHz).toBe(coast);
    h.stop();
    expect(w.stats().held).toBe(0);
  });

  it('holds one noise source for the full boost, then releases its tail and reuses its buffer', () => {
    const w = world();
    const h = new HoverEngine();
    h.attach(w.caps);
    h.update(state);
    expect(h.sources).toBe(1);
    for (let i = 0; i < 90; i++) {
      w.ctx.currentTime += 1 / 60;
      h.update({ ...state, boosting: true });
    }
    expect(w.nodes.filter((n) => n.kind === 'noise')).toHaveLength(1);
    expect(h.sources).toBe(2);
    const burningNoise = w.nodes.find((n) => n.kind === 'noise')!;
    expect(burningNoise.loop).toBe(true);
    expect(burningNoise.stopped).toBe(false);
    h.update(state);
    w.ctx.currentTime += 0.2;
    h.update(state);
    expect(h.sources).toBe(1);
    expect(burningNoise.stopped).toBe(true);
    expect(burningNoise.disconnected).toBe(true);
    h.update({ ...state, boosting: true });
    expect(w.stats().buffers).toBe(1);
    h.stop();
    h.stop();
    expect(w.stats().held).toBe(0);
    expect(w.stats().claims).toBe(w.stats().releases);
    expect(w.nodes.every((n) => n.disconnected)).toBe(true);
  });

  it('cleans a failed afterburner without losing the working engine, then retries', () => {
    const w = world();
    const create = w.ctx.createBufferSource;
    w.ctx.createBufferSource = () => {
      const n = create();
      n.failStart = true;
      return n;
    };
    const h = new HoverEngine();
    h.attach(w.caps);
    h.update({ ...state, boosting: true });
    expect(h.active).toBe(true);
    expect(h.sources).toBe(1);
    const failed = w.nodes.find((n) => n.kind === 'noise')!;
    expect(failed.disconnected).toBe(true);
    w.ctx.createBufferSource = create;
    h.update({ ...state, boosting: true });
    expect(h.sources).toBe(2);
    h.stop();
    expect(w.stats().held).toBe(0);
  });

  it('ignites real manual boost without dispatching the powerup bell', () => {
    const events: string[] = [];
    const game = createRacingGame({
      renderer: { ctx: {} },
      sfx: { play: (event: string) => events.push(event) },
    } as unknown as EngineContext) as GameInstance & RacingDevHandle;
    const blank = Object.fromEntries(
      LOGICAL_BUTTONS.map((b) => [b, { held: false, pressed: false, released: false }]),
    ) as InputSnapshot;
    game.racingDev.setAutopilot(true);
    for (let i = 0; i < 200 && game.racingDev.snapshot().phase !== 'race'; i++)
      game.update(1 / 60, blank);
    game.racingDev.setAutopilot(false);
    events.length = 0;
    game.update(1 / 60, {
      ...blank,
      A: { held: true, pressed: true, released: false },
      B: { held: true, pressed: false, released: false },
    });
    expect(game.racingDev.snapshot().player.boostT).toBeGreaterThan(0);
    expect(events).not.toContain('powerup');
    game.dispose();
  });
});

describe('nearby rival engines', () => {
  it('fades with physical distance, pans to the craft side, and ignores distant/finished racers', () => {
    const p = racer(100);
    const near = rivalSound(p, racer(110, -3), 1, 3000)!;
    const far = rivalSound(p, racer(180, -3), 1, 3000)!;
    expect(near.gain).toBeGreaterThan(far.gain * 5);
    expect(near.pan).toBeLessThan(0);
    expect(rivalSound(p, racer(110, 3), 1, 3000)!.pan).toBeGreaterThan(0);
    expect(rivalSound(p, racer(300), 1, 3000)).toBeNull();
    expect(rivalSound(p, { ...racer(102), finished: true }, 1, 3000)).toBeNull();
  });

  it('remains continuous across the lap seam and lowers passing pitch as a rival recedes', () => {
    const seam = rivalSound(racer(2995), racer(5, 2), 2, 3000)!;
    const straight = rivalSound(racer(95), racer(105, 2), 2, 3000)!;
    expect(seam).toEqual(straight);
    const approaching = rivalSound(racer(100, 0, 80), racer(120, 0, 60), 1, 3000)!;
    const receding = rivalSound(racer(100, 0, 80), racer(80, 0, 60), 1, 3000)!;
    expect(approaching.pitchHz).toBeGreaterThan(receding.pitchHz);
  });

  it('keeps nearby sources stable, prioritizes the boost, and leaves one transient voice free with music', () => {
    const w = world(4);
    const mix = new RaceEngineAudio();
    mix.attach(w.caps);
    const field = [racer(100), racer(105, -2), racer(112, 2), racer(180), racer(240)];
    for (let i = 0; i < 120; i++) {
      w.ctx.currentTime += 1 / 60;
      mix.update(state, field, 0, 3000);
    }
    expect(w.nodes.filter((n) => n.kind === 'osc')).toHaveLength(3);
    expect(
      mix
        .snapshot()
        .rivals.map((r) => r.index)
        .sort(),
    ).toEqual([1, 2]);
    expect(w.stats().held).toBe(7);
    mix.update({ ...state, boosting: true }, field, 0, 3000);
    expect(mix.snapshot().sources).toBe(3);
    expect(mix.snapshot().rivals).toHaveLength(1);
    expect(w.nodes.filter((n) => n.kind === 'noise' && !n.stopped)).toHaveLength(1);
    expect(w.caps.claimVoice()).toBe(true);
    expect(w.caps.claimVoice()).toBe(false);
    w.caps.releaseVoice();
    mix.stop();
    mix.stop();
    expect(w.stats().held).toBe(4);
    expect(w.nodes.every((n) => n.disconnected)).toBe(true);
  });

  it('releases distant rivals and handles exhausted capacity without silencing a playing player', () => {
    const w = world(7);
    const mix = new RaceEngineAudio();
    mix.attach(w.caps);
    const field = [racer(100), racer(105), racer(110)];
    mix.update(state, field, 0, 3000);
    expect(mix.status().on).toBe(true);
    expect(mix.snapshot().rivals).toHaveLength(0);
    mix.stop();
    expect(w.stats().held).toBe(7);
    const free = world();
    mix.attach(free.caps);
    mix.update(state, field, 0, 3000);
    mix.update(state, [field[0]!, racer(400), racer(500)], 0, 3000);
    expect(mix.snapshot().rivals).toHaveLength(0);
    expect(mix.snapshot().sources).toBe(1);
    mix.stop();
    expect(free.stats().held).toBe(0);
  });
});
