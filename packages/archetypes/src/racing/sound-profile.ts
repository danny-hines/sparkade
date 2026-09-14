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
import type {
  RacingDiscipline,
  RacingEngineFamily,
  RacingEngineProfile,
} from '@sparkade/shared';

/** Oscillator timbre per family: the strongest audible differentiator. */
export type EngineOscType = 'sine' | 'sawtooth' | 'square';

/** Presentation-layer discipline for engine voices. Lenient on purpose:
 *  only 'jetski' selects the watercraft mix — omitted, null, or anything
 *  else stays 'hover' (byte-identical legacy). Unlike the simulation's
 *  throwing resolver, audio must never break a race over a bad string. */
export function normalizeEngineDiscipline(value: unknown): RacingDiscipline {
  return value === 'jetski' ? 'jetski' : 'hover';
}

/** Clamped + derived voice parameters. No audio nodes held. */
export interface ResolvedEngineProfile {
  family: RacingEngineFamily;
  /** Watercraft vs hovercraft mix. 'hover' is the exact legacy voice. */
  discipline: RacingDiscipline;
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
 *
 * The optional discipline selects the watercraft mix: 'hover' (or any
 * omitted/invalid value) returns the family voice verbatim, while 'jetski'
 * retunes the same family into a marine motor — deeper idle, wider
 * speed/throttle load sweep, stronger carve bite, and a hissier
 * water-rush noise band. Family/tone/pitch ordering is preserved, so a
 * jetski still sounds like its authored family, just on water.
 */
export function resolveEngineProfile(
  input?: RacingEngineProfile | null,
  discipline?: RacingDiscipline | null,
): ResolvedEngineProfile {
  const family: RacingEngineFamily =
    input?.family === 'electric' || input?.family === 'arcane' || input?.family === 'combustion'
      ? input.family
      : 'combustion';
  const tone = clamp(input?.tone ?? 0.5, 0, 1, 0.5);
  const pitch = clamp(input?.pitch ?? 0, -12, 12, 0);
  const resolved: RacingDiscipline = normalizeEngineDiscipline(discipline);
  const voice = FAMILY_VOICES[family];
  const jetski = resolved === 'jetski';
  return {
    family,
    discipline: resolved,
    tone,
    pitch,
    oscType: voice.oscType,
    pitchRatio: 2 ** (pitch / 12),
    filterScale: 0.6 + tone * 0.8,
    baseHz: jetski ? voice.baseHz * 0.9 : voice.baseHz,
    speedHz: jetski ? voice.speedHz * 1.15 : voice.speedHz,
    throttleHz: jetski ? voice.throttleHz * 1.5 : voice.throttleHz,
    driftHz: jetski ? voice.driftHz * 3 : voice.driftHz,
    filterBase: jetski ? voice.filterBase * 0.85 : voice.filterBase,
    filterSpeed: jetski ? voice.filterSpeed * 1.1 : voice.filterSpeed,
    filterThrottle: jetski ? voice.filterThrottle * 1.1 : voice.filterThrottle,
    filterBoost: jetski ? voice.filterBoost * 1.1 : voice.filterBoost,
    burnerCutoff: jetski ? voice.burnerCutoff * 1.8 : voice.burnerCutoff,
    burnerGain: jetski ? Math.min(0.5, voice.burnerGain * 0.9) : voice.burnerGain,
  };
}

/** Speed norm at or below which the jetski water rush stays fully silent. */
export const JETSKI_WATER_REST_NORM = 0.02;

/** Hard ceiling on the jetski water-rush gain: never clips, never buries
 *  the motor or the music bus. */
export const JETSKI_WATER_GAIN_CAP = 0.44;

/**
 * Jetski water-rush gain from live craft state: silent at rest, swelling
 * with speed, extra wash while carving (drift held at speed), and a
 * stronger deep-thrust surge under boost. Always 0 at rest unless
 * boosting, and capped so the rush supports the motor instead of
 * overpowering it. Pure math — no audio nodes.
 */
export function jetskiWaterGain(
  speedNorm: number,
  carving: boolean,
  boosting: boolean,
  voice: ResolvedEngineProfile,
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  if (!boosting && norm <= JETSKI_WATER_REST_NORM) return 0;
  const cruise = norm * 0.26;
  const wake = carving && norm > 0.05 ? 0.07 : 0;
  const thrust = boosting ? voice.burnerGain * 0.85 : 0;
  return Math.min(JETSKI_WATER_GAIN_CAP, cruise + wake + thrust);
}

/**
 * Jetski water-rush filter cutoff from live craft state: the hiss
 * brightens with speed and opens further under boost (rushing waterjet).
 * Pure math — no audio nodes.
 */
export function jetskiWaterCutoff(
  speedNorm: number,
  boosting: boolean,
  voice: ResolvedEngineProfile,
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  return voice.burnerCutoff + norm * 800 + (boosting ? 600 : 0);
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
