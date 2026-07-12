// Pure jsfxr-style SFX rendering: parameters -> Float32Array of samples.
// No WebAudio here (unit-tested on Node); sfx.ts wraps the output in AudioBuffers.
import type { SfxParams } from '@sparkade/shared';

export const SFX_SAMPLE_RATE = 22050;
const MAX_SECONDS = 1.5;

/** Total rendered length in samples for a parameter set. */
export function sfxLengthSamples(p: SfxParams, sampleRate = SFX_SAMPLE_RATE): number {
  const total = Math.min(MAX_SECONDS, (p.attack ?? 0.01) + (p.sustain ?? 0.05) + p.decay);
  return Math.max(1, Math.floor(total * sampleRate));
}

export function renderSfx(p: SfxParams, sampleRate = SFX_SAMPLE_RATE): Float32Array {
  const attack = p.attack ?? 0.01;
  const sustain = p.sustain ?? 0.05;
  const decay = p.decay;
  const vol = p.vol ?? 0.5;
  const duty = p.duty ?? 0.5;
  const n = sfxLengthSamples(p, sampleRate);
  const out = new Float32Array(n);

  let phase = 0;
  // deterministic noise (LCG) so identical params always render identical buffers
  let noiseSeed = 0x2f6e2b1;
  let noiseValue = 0;
  let noisePhase = 0;

  // single-pole lowpass state
  let lp = 0;
  const lpAlpha =
    p.lowpass !== undefined
      ? (() => {
          const rc = 1 / (2 * Math.PI * p.lowpass!);
          const dt = 1 / sampleRate;
          return dt / (rc + dt);
        })()
      : 1;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;

    // pitch in semitone offsets: slide + arpeggio jump + vibrato
    let semis = (p.freqSlide ?? 0) * t;
    if (p.arpSemitones !== undefined && t >= (p.arpTime ?? 0.1)) semis += p.arpSemitones;
    if (p.vibratoDepth !== undefined && p.vibratoDepth > 0) {
      semis += p.vibratoDepth * Math.sin(2 * Math.PI * (p.vibratoSpeed ?? 8) * t);
    }
    const freq = Math.max(20, Math.min(sampleRate / 2 - 100, p.freq * Math.pow(2, semis / 12)));

    phase += freq / sampleRate;
    const frac = phase - Math.floor(phase);

    let sample: number;
    switch (p.wave) {
      case 'square':
        sample = frac < duty ? 1 : -1;
        break;
      case 'saw':
        sample = 2 * frac - 1;
        break;
      case 'sine':
        sample = Math.sin(2 * Math.PI * frac);
        break;
      case 'triangle':
        sample = frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
        break;
      case 'noise': {
        // sample-and-hold noise clocked at the current frequency
        noisePhase += freq / sampleRate;
        if (noisePhase >= 0.5) {
          noisePhase -= 0.5;
          noiseSeed = (Math.imul(noiseSeed, 1103515245) + 12345) >>> 0;
          noiseValue = (noiseSeed / 4294967296) * 2 - 1;
        }
        sample = noiseValue;
        break;
      }
    }

    // envelope
    let env: number;
    if (t < attack) env = attack > 0 ? t / attack : 1;
    else if (t < attack + sustain) env = 1;
    else env = Math.max(0, 1 - (t - attack - sustain) / decay);

    let v = sample * env * vol;
    if (p.lowpass !== undefined) {
      lp += lpAlpha * (v - lp);
      v = lp;
    }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** Engine default SFX for every canonical event — tasteful, distinct, subtle for UI. */
export const DEFAULT_SFX: Record<string, SfxParams> = {
  jump: { wave: 'square', freq: 300, freqSlide: 28, duty: 0.5, decay: 0.18, sustain: 0.02, vol: 0.4 },
  shoot: { wave: 'square', freq: 950, freqSlide: -36, duty: 0.25, decay: 0.12, sustain: 0.01, vol: 0.35 },
  hit: { wave: 'noise', freq: 720, freqSlide: -20, decay: 0.12, vol: 0.4 },
  hurt: { wave: 'saw', freq: 260, freqSlide: -24, decay: 0.25, vol: 0.45 },
  die: { wave: 'noise', freq: 420, freqSlide: -18, decay: 0.6, sustain: 0.05, vol: 0.5, lowpass: 2400 },
  pickup: { wave: 'square', freq: 1050, duty: 0.5, decay: 0.14, arpSemitones: 7, arpTime: 0.06, vol: 0.35 },
  powerup: {
    wave: 'square',
    freq: 520,
    duty: 0.25,
    decay: 0.4,
    sustain: 0.08,
    arpSemitones: 12,
    arpTime: 0.12,
    vibratoDepth: 0.3,
    vibratoSpeed: 9,
    vol: 0.4,
  },
  uiMove: { wave: 'square', freq: 700, duty: 0.25, decay: 0.05, vol: 0.22 },
  uiSelect: { wave: 'square', freq: 880, duty: 0.5, decay: 0.1, arpSemitones: 5, arpTime: 0.04, vol: 0.26 },
  uiBack: { wave: 'square', freq: 560, freqSlide: -18, duty: 0.5, decay: 0.09, vol: 0.22 },
  win: {
    wave: 'square',
    freq: 660,
    duty: 0.5,
    decay: 0.45,
    sustain: 0.1,
    arpSemitones: 12,
    arpTime: 0.1,
    vol: 0.4,
  },
  lose: { wave: 'triangle', freq: 330, freqSlide: -14, decay: 0.5, sustain: 0.05, vol: 0.45 },
};
