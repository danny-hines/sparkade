import { describe, expect, it } from 'vitest';
import { DEFAULT_SFX, renderSfx, SFX_SAMPLE_RATE, sfxLengthSamples } from '@sparkade/engine';
import { SFX_EVENTS } from '@sparkade/shared';

describe('sfx renderer (pure)', () => {
  it('buffer length = (attack + sustain + decay) × sampleRate, capped at 1.5s', () => {
    const n = sfxLengthSamples({ wave: 'square', freq: 440, attack: 0.1, sustain: 0.2, decay: 0.3 });
    expect(n).toBe(Math.floor(0.6 * SFX_SAMPLE_RATE));
    const capped = sfxLengthSamples({ wave: 'square', freq: 440, attack: 0.5, sustain: 0.5, decay: 1 });
    expect(capped).toBe(Math.floor(1.5 * SFX_SAMPLE_RATE));
    // defaults: attack 0.01, sustain 0.05
    const defaulted = sfxLengthSamples({ wave: 'sine', freq: 200, decay: 0.14 });
    expect(defaulted).toBe(Math.floor(0.2 * SFX_SAMPLE_RATE));
  });

  it('renders bounded, non-silent samples for every default event', () => {
    expect(Object.keys(DEFAULT_SFX).sort()).toEqual([...SFX_EVENTS].sort());
    for (const [name, params] of Object.entries(DEFAULT_SFX)) {
      const buf = renderSfx(params);
      expect(buf.length, name).toBe(sfxLengthSamples(params));
      let peak = 0;
      for (const v of buf) {
        expect(Math.abs(v), name).toBeLessThanOrEqual(1);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, `${name} should be audible`).toBeGreaterThan(0.05);
    }
  });

  it('is deterministic (identical params → identical buffers, incl. noise)', () => {
    const params = DEFAULT_SFX['die']!;
    const a = renderSfx(params);
    const b = renderSfx(params);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it('envelope decays to silence at the end', () => {
    const buf = renderSfx({ wave: 'square', freq: 440, decay: 0.2 });
    const tail = buf.slice(-20);
    for (const v of tail) expect(Math.abs(v)).toBeLessThan(0.05);
  });
});
