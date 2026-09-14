// Deterministic engine-voice profiles for the racing soundscape.
//
// Maps the stored identity.sound.engine profile (family + bounded
// tone/pitch) onto concrete voice parameters for the player engine,
// the afterburner, and rival engines. Pure data and math only: no
// WebAudio nodes are created here, so this module is trivially
// deterministic and unit-testable without an AudioContext.
//
// Legacy rule: an absent profile (undefined/null) resolves to the exact
// pre-identity mix (combustion-family sawtooth at the original constants),
// so legacy cups sound byte-identical to before.
import type { RacingEngineFamily, RacingEngineProfile } from '@sparkade/shared';

/** Oscillator timbre per family: the strongest audible differentiator. */
export type EngineOscType = 'sine' | 'sawtooth' | 'square';

/** Clamped + derived voice parameters. No audio nodes held. */
export interface ResolvedEngineProfile {
  family: RacingEngineFamily;
  /** Timbre brightness 0..1 (clamped, default 0.5). */
  tone: number;
  /** Pitch offset in semitones -12..+12 (clamped, default 0). */
  pitch: number;
  /** Oscillator timbre for engine voices of this family. */
  oscType: EngineOscType;
  /** Frequency multiplier from pitch semitones (2^(pitch/12)). */
  pitchRatio: number;
  /** Filter-cutoff multiplier from tone (0.6..1.4, 1.0 at default). */
  filterScale: number;
  // Player-engine pitch/filter shape (pre-ratio, pre-scale).
  baseHz: number;
  speedHz: number;
  throttleHz: number;
  driftHz: number;
  filterBase: number;
  filterSpeed: number;
  filterThrottle: number;
  filterBoost: number;
  // Afterburner character (filtered noise; never a pitched bell).
  burnerCutoff: number;
  burnerGain: number;
}

/** Exact pre-identity player mix. resolveEngineProfile() with no input
 *  returns these numbers verbatim (filterScale 1, pitchRatio 1). */
export const LEGACY_ENGINE = {
  oscType: 'sawtooth',
  baseHz: 78,
  speedHz: 138,
  throttleHz: 34,
  driftHz: 6,
  filterBase: 320,
  filterSpeed: 850,
  filterThrottle: 650,
  filterBoost: 650,
} as const;

/** Exact pre-identity afterburner: lowpassed noise at these settings. */
export const LEGACY_BURNER = { cutoffHz: 950, gain: 0.46 } as const;

/** Exact pre-identity rival pitch shape. */
export const LEGACY_RIVAL = {
  baseHz: 92,
  speedCoef: 1.3,
  speedCap: 128,
  indexStep: 7,
  filterBase: 450,
  filterGainCoef: 7000,
} as const;

/** Deterministic noise seed shared by every afterburner buffer. */
export const ENGINE_NOISE_SEED = 173;

interface FamilyVoice {
  oscType: EngineOscType;
  baseHz: number;
  speedHz: number;
  throttleHz: number;
  driftHz: number;
  filterBase: number;
  filterSpeed: number;
  filterThrottle: number;
  filterBoost: number;
  burnerCutoff: number;
  burnerGain: number;
}

const FAMILY_VOICES: Record<RacingEngineFamily, FamilyVoice> = {
  // Legacy mix verbatim: the growling sawtooth every existing cup knows.
  combustion: {
    oscType: 'sawtooth',
    baseHz: 78,
    speedHz: 138,
    throttleHz: 34,
    driftHz: 6,
    filterBase: 320,
    filterSpeed: 850,
    filterThrottle: 650,
    filterBoost: 650,
    burnerCutoff: 950,
    burnerGain: 0.46,
  },
  // Clean high whir: pure sine, brighter base, hissier narrower boost.
  electric: {
    oscType: 'sine',
    baseHz: 96,
    speedHz: 150,
    throttleHz: 30,
    driftHz: 5,
    filterBase: 260,
    filterSpeed: 720,
    filterThrottle: 520,
    filterBoost: 430,
    burnerCutoff: 1500,
    burnerGain: 0.36,
  },
  // Hollow reed: square wave, deeper base, wider sweep, cavernous roar.
  arcane: {
    oscType: 'square',
    baseHz: 64,
    speedHz: 168,
    throttleHz: 42,
    driftHz: 8,
    filterBase: 480,
    filterSpeed: 1080,
    filterThrottle: 800,
    filterBoost: 820,
    burnerCutoff: 720,
    burnerGain: 0.52,
  },
};

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Clamp + derive a stored profile. Unknown families fall back to the
 * legacy combustion mix; out-of-range tone/pitch clamp to their bounds.
 * Null/undefined input is the legacy cup: exact legacy constants.
 */
export function resolveEngineProfile(
  input?: RacingEngineProfile | null,
): ResolvedEngineProfile {
  const family: RacingEngineFamily =
    input?.family === 'electric' || input?.family === 'arcane' || input?.family === 'combustion'
      ? input.family
      : 'combustion';
  const tone = clamp(input?.tone ?? 0.5, 0, 1, 0.5);
  const pitch = clamp(input?.pitch ?? 0, -12, 12, 0);
  const voice = FAMILY_VOICES[family];
  return {
    family,
    tone,
    pitch,
    oscType: voice.oscType,
    pitchRatio: 2 ** (pitch / 12),
    filterScale: 0.6 + tone * 0.8,
    baseHz: voice.baseHz,
    speedHz: voice.speedHz,
    throttleHz: voice.throttleHz,
    driftHz: voice.driftHz,
    filterBase: voice.filterBase,
    filterSpeed: voice.filterSpeed,
    filterThrottle: voice.filterThrottle,
    filterBoost: voice.filterBoost,
    burnerCutoff: voice.burnerCutoff,
    burnerGain: voice.burnerGain,
  };
}

/**
 * Fill a mono noise buffer with the deterministic afterburner texture:
 * seeded brown-ish noise with a smoothed loop seam (broad-band roar,
 * never a pitched note). Same seed + length → identical samples.
 */
export function renderEngineNoise(data: Float32Array, seed: number = ENGINE_NOISE_SEED): void {
  let s = seed >>> 0;
  let low = 0;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    low = low * 0.9 + (s / 2147483648 - 1) * 0.1;
    // Smooth the loop seam; texture is broad-band rather than pitched notes.
    const edge = Math.min(1, i / 220, (data.length - 1 - i) / 220);
    data[i] = low * 3 * edge;
  }
}
