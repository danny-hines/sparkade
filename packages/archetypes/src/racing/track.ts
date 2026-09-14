// Racing track: truly closed hover circuits built from periodic splines.
//
// A circuit is compiled from closed control points through a periodic
// Catmull-Rom spline, resampled uniformly by arc length. Because the spline
// is periodic, positional AND tangent continuity at the seam hold by
// construction (no wrap trickery): sample N-1 flows into sample 0 exactly
// like every other neighbor pair. Curvature, heading, minimap outline, and
// boost-pad placement all derive from the same compiled geometry.
//
// compileTrack is reusable: the next milestone adds two more bounded
// templates by supplying different control points. Arbitrary model-authored
// geometry stays out; templates are hand-authored and validated here.
import type {
  RacingBoostMode,
  RacingCraftShape,
  RacingDiscipline,
  RacingTrackMaterials,
} from '@sparkade/shared';

export interface TrackPoint {
  x: number;
  y: number;
}

export interface BoostPad {
  /** Start distance along the centerline. */
  start: number;
  /** Pad length in track units. */
  length: number;
}

/**
 * Banked-energy pickup: grants meter for manual boost (no immediate burn)
 * when a racer's forward sweep crosses it with lateral overlap. Per-racer,
 * per-lap availability lives in simulation state; the layout here is static.
 */
export interface EnergyPickup {
  /** Centerline distance (wrapped [0, length)). */
  s: number;
  /** Lateral lane offset from the centerline. */
  x: number;
}

export interface CompiledTrack {
  /** Total arc length in track units. */
  readonly length: number;
  /** Wrap any distance into [0, length). */
  wrap(s: number): number;
  /** Centerline position (world units). Continuous across the seam. */
  pointAt(s: number): TrackPoint;
  /** Unit tangent. Continuous across the seam. */
  tangentAt(s: number): TrackPoint;
  /** Absolute heading (radians) of the tangent. */
  headingAt(s: number): number;
  /** Signed heading change per unit; + turns right (clockwise). Smoothed. */
  curvatureAt(s: number): number;
  /** Closed-loop outline for the minimap (count+1 points, last === first). */
  outline(count?: number): TrackPoint[];
}

function catmullRom(p0: TrackPoint, p1: TrackPoint, p2: TrackPoint, p3: TrackPoint, t: number): TrackPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

const ARC_SAMPLES = 2048;
const CURVE_SAMPLES = 1024;
const CURVE_SMOOTH = 9;

export function compileTrack(control: TrackPoint[], targetLength: number): CompiledTrack {
  const n = control.length;
  if (n < 4) throw new Error('compileTrack needs at least 4 control points');
  if (!(targetLength > 0)) throw new Error('compileTrack needs a positive target length');

  // Uniformly scale the control cage so the finished circuit matches the
  // target length (pacing stays comparable across templates).
  const raw = (t: number): TrackPoint => {
    const seg = Math.floor(t) % n;
    const f = t - Math.floor(t);
    const p0 = control[(seg + n - 1) % n]!;
    const p1 = control[seg]!;
    const p2 = control[(seg + 1) % n]!;
    const p3 = control[(seg + 2) % n]!;
    return catmullRom(p0, p1, p2, p3, f);
  };
  let rawLen = 0;
  let prev = raw(0);
  for (let k = 1; k <= ARC_SAMPLES; k++) {
    const p = raw((k / ARC_SAMPLES) * n);
    rawLen += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const scale = targetLength / rawLen;
  const pts: TrackPoint[] = control.map((p) => ({ x: p.x * scale, y: p.y * scale }));

  const at = (t: number): TrackPoint => {
    const seg = ((Math.floor(t) % n) + n) % n;
    const f = t - Math.floor(t);
    return catmullRom(pts[(seg + n - 1) % n]!, pts[seg]!, pts[(seg + 1) % n]!, pts[(seg + 2) % n]!, f);
  };

  // Arc-length table over one period.
  const cum: number[] = [0];
  let walk = at(0);
  for (let k = 1; k <= ARC_SAMPLES; k++) {
    const p = at((k / ARC_SAMPLES) * n);
    cum.push(cum[k - 1]! + Math.hypot(p.x - walk.x, p.y - walk.y));
    walk = p;
  }
  const length = cum[ARC_SAMPLES]!;

  function wrap(s: number): number {
    const m = s % length;
    return m < 0 ? m + length : m;
  }

  // Arc-length -> spline parameter via binary search + lerp.
  function paramAt(s: number): number {
    const w = wrap(s);
    let lo = 0;
    let hi = ARC_SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < w) lo = mid + 1;
      else hi = mid;
    }
    const i1 = Math.max(1, lo);
    const c0 = cum[i1 - 1]!;
    const c1 = cum[i1]!;
    const f = c1 > c0 ? (w - c0) / (c1 - c0) : 0;
    return (((i1 - 1 + f) / ARC_SAMPLES) * n) % n;
  }

  function pointAt(s: number): TrackPoint {
    return at(paramAt(s));
  }

  function tangentAt(s: number): TrackPoint {
    const h = Math.max(1, length / CURVE_SAMPLES);
    const a = pointAt(s - h);
    const b = pointAt(s + h);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function headingAt(s: number): number {
    const t = tangentAt(s);
    return Math.atan2(t.x, -t.y);
  }

  // Raw curvature from tangent-angle differences, then box-smoothed over the
  // period (periodic indices keep the seam smooth too).
  const curveTable: number[] = (() => {
    const rawCurve: number[] = [];
    const h = length / CURVE_SAMPLES;
    for (let k = 0; k < CURVE_SAMPLES; k++) {
      const a = headingAt(k * h);
      const b = headingAt((k + 1) * h);
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rawCurve.push(d / h);
    }
    const out: number[] = [];
    for (let k = 0; k < CURVE_SAMPLES; k++) {
      let sum = 0;
      for (let j = -CURVE_SMOOTH; j <= CURVE_SMOOTH; j++) {
        sum += rawCurve[(k + j + CURVE_SAMPLES * 2) % CURVE_SAMPLES]!;
      }
      out.push(sum / (CURVE_SMOOTH * 2 + 1));
    }
    return out;
  })();

  function curvatureAt(s: number): number {
    const f = (wrap(s) / length) * CURVE_SAMPLES;
    const i0 = Math.floor(f) % CURVE_SAMPLES;
    const i1 = (i0 + 1) % CURVE_SAMPLES;
    const t = f - Math.floor(f);
    return curveTable[i0]! * (1 - t) + curveTable[i1]! * t;
  }

  function outline(count = 120): TrackPoint[] {
    const outPts: TrackPoint[] = [];
    for (let i = 0; i <= count; i++) outPts.push(pointAt((i / count) * length));
    return outPts;
  }

  return { length, wrap, pointAt, tangentAt, headingAt, curvatureAt, outline };
}

// ---------------------------------------------------------------------------
// Circuit templates: three deterministic hand-authored closed cages with
// distinct shape/corner rhythm. Later generation chooses a template plus
// bounded direction/length/width/surface/theme options; arbitrary
// model-authored control points are never accepted.
// ---------------------------------------------------------------------------

/** Trackside theme: all original flat-shaded Canvas2D art, no assets. */
export interface CircuitTheme {
  skyTop: string;
  skyBottom: string;
  sun: string;
  ridgeFar: string;
  ridgeNear: string;
  ground: string;
  roadA: [number, number, number];
  roadB: [number, number, number];
  accent: string;
  /** Roadside dressing variant. */
  scenery: 'posts' | 'pines' | 'crystals';
}

/** Hand-authored template input; compiled once at module load. */
export interface CircuitTemplateDef {
  id: string;
  name: string;
  blurb: string;
  control: TrackPoint[];
  targetLength: number;
  laps: number;
  /** Race clock limit (seconds); unfinished racers score DNF past it. */
  timeout: number;
  /** Per-racer top-speed scales, index 0 is the player (always 1). */
  aiScales: number[];
  /** Display names, index 0 is the player. */
  names: string[];
  theme: CircuitTheme;
}

/** Compiled per-race circuit: geometry, pads, rules, and presentation. */
export interface RaceCircuit {
  id: string;
  name: string;
  blurb: string;
  track: CompiledTrack;
  pads: BoostPad[];
  /** Static banked-energy layout; only collected when boostMode is pickups. */
  pickups: EnergyPickup[];
  /** Cup boost supply for this race. Legacy compiles default to pads. */
  boostMode: RacingBoostMode;
  laps: number;
  timeout: number;
  aiScales: number[];
  names: string[];
  theme: CircuitTheme;
  /** Authored player-craft silhouette; defaults to twinpod. */
  craftShape?: RacingCraftShape;
  /** Authored track-material styling, consumed by the pack renderer. */
  materials?: RacingTrackMaterials;
  /**
   * Movement discipline this circuit steps: hover craft or jet-ski. Always
   * present after compilation ('hover' when the spec omits identity or the
   * discipline), so the simulation never guesses — omission preserves legacy
   * hover behavior exactly.
   */
  discipline: RacingDiscipline;
}

/** Numeric audit of a compiled circuit for tests and generation bounds. */
export interface CircuitAudit {
  length: number;
  finite: boolean;
  /** Distance between the last arc sample and sample 0 (should be ~step). */
  seamStep: number;
  /** Ordinary neighbor-step size for comparison with seamStep. */
  meanStep: number;
  /** Tangent dot across the seam (1 = perfectly continuous). */
  seamTangentDot: number;
  maxCurvature: number;
  /** Min distance between non-adjacent centerline samples. */
  minSeparation: number;
  padsInBounds: boolean;
}

function findStraightOn(track: CompiledTrack, minS: number, need: number): number {
  const step = 5;
  for (let s = minS; s < track.length - need; s += step) {
    let ok = true;
    for (let k = 0; k <= need; k += 15) {
      if (Math.abs(track.curvatureAt(s + k)) > 0.0012) {
        ok = false;
        break;
      }
    }
    if (ok) return s;
  }
  return minS;
}

function padsFor(track: CompiledTrack): BoostPad[] {
  return [{ start: 150, length: 90 }, { start: findStraightOn(track, track.length * 0.35, 150), length: 90 }];
}

/** Bounded energy layout: exactly PICKUP_COUNT cells per lap on alternating
 *  road lanes, spread around the lap so no single corner decides supply. */
export const PICKUP_COUNT = 4;
/** Lateral collection half-width around a pickup lane (world units). */
export const PICKUP_HALF_X = 1.2;

const PICKUP_FRACTIONS = [0.12, 0.37, 0.62, 0.87] as const;
const PICKUP_LANES = [1.8, -1.8, -1.8, 1.8] as const;

export function pickupsFor(track: CompiledTrack): EnergyPickup[] {
  return PICKUP_FRACTIONS.map((f, k) => ({ s: track.wrap(f * track.length), x: PICKUP_LANES[k % PICKUP_LANES.length]! }));
}

/** Sample-based audit: finiteness, seam, curvature, self-intersection, pads. */
export function auditCircuit(track: CompiledTrack, pads: BoostPad[]): CircuitAudit {
  const N = 512;
  const pts: TrackPoint[] = [];
  let finite = true;
  for (let i = 0; i < N; i++) {
    const p = track.pointAt((i / N) * track.length);
    pts.push(p);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
  }
  let stepSum = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % N]!;
    stepSum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const meanStep = stepSum / N;
  const seamStep = Math.hypot(pts[0]!.x - pts[N - 1]!.x, pts[0]!.y - pts[N - 1]!.y);
  const tA = track.tangentAt(track.length - 1);
  const tB = track.tangentAt(0);
  const seamTangentDot = tA.x * tB.x + tA.y * tB.y;
  let maxCurvature = 0;
  for (let i = 0; i < N; i++) {
    const c = Math.abs(track.curvatureAt((i / N) * track.length));
    if (Number.isFinite(c) && c > maxCurvature) maxCurvature = c;
  }
  // Non-adjacent separation: ignore samples within 1/12 of the loop of each
  // other (neighbors along the road) and across the seam.
  let minSeparation = Infinity;
  const skip = Math.floor(N / 12);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const ring = Math.min(j - i, N - (j - i));
      if (ring <= skip) continue;
      const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
      if (d < minSeparation) minSeparation = d;
    }
  }
  const padsInBounds = pads.every((p) => p.start >= 0 && p.length > 0 && p.start + p.length < track.length);
  return { length: track.length, finite, seamStep, meanStep, seamTangentDot, maxCurvature, minSeparation, padsInBounds };
}

// "Ember Loop" control cage: start straight, gentle right, hairpin,
// recovery straight, S-curves, long sweeper, final straight home.
const EMBER_LOOP_CONTROL: TrackPoint[] = [
  { x: 0, y: -560 },
  { x: 300, y: -560 },
  { x: 500, y: -460 },
  { x: 560, y: -260 },
  { x: 480, y: -80 },
  { x: 480, y: 120 },
  { x: 560, y: 300 },
  { x: 480, y: 460 },
  { x: 300, y: 520 },
  { x: 120, y: 440 },
  { x: 120, y: 280 },
  { x: -80, y: 220 },
  { x: -220, y: 300 },
  { x: -220, y: 460 },
  { x: -420, y: 520 },
  { x: -560, y: 380 },
  { x: -520, y: 180 },
  { x: -420, y: -80 },
  { x: -300, y: -320 },
  { x: -140, y: -480 },
];

// "Coral Sweep" cage: flowing double-apex sweepers and one kink rhythm —
// long fast arcs instead of Ember's hairpin + S-curves.
const CORAL_SWEEP_CONTROL: TrackPoint[] = [
  { x: 0, y: -520 },
  { x: 320, y: -500 },
  { x: 520, y: -360 },
  { x: 560, y: -140 },
  { x: 460, y: 60 },
  { x: 520, y: 260 },
  { x: 400, y: 440 },
  { x: 180, y: 520 },
  { x: -80, y: 480 },
  { x: -300, y: 520 },
  { x: -500, y: 420 },
  { x: -560, y: 200 },
  { x: -480, y: -40 },
  { x: -540, y: -280 },
  { x: -320, y: -440 },
  { x: -120, y: -520 },
];

// "Ratchet Chicane" cage: tight stadium rhythm — chicanes, a hairpin, and
// short bursts instead of sustained sweepers.
const RATCHET_CHICANE_CONTROL: TrackPoint[] = [
  { x: 0, y: -480 },
  { x: 240, y: -480 },
  { x: 420, y: -420 },
  { x: 420, y: -240 },
  { x: 300, y: -140 },
  { x: 300, y: 40 },
  { x: 440, y: 140 },
  { x: 440, y: 320 },
  { x: 260, y: 440 },
  { x: 60, y: 380 },
  { x: -40, y: 440 },
  { x: -260, y: 440 },
  { x: -440, y: 340 },
  { x: -380, y: 160 },
  { x: -460, y: 0 },
  { x: -420, y: -200 },
  { x: -280, y: -300 },
  { x: -140, y: -380 },
];

const TEMPLATE_DEFS: CircuitTemplateDef[] = [
  {
    id: 'ember',
    name: 'Ember Loop',
    blurb: 'Hairpin and S-curves through the ember fields.',
    control: EMBER_LOOP_CONTROL,
    targetLength: 3400,
    laps: 3,
    timeout: 300,
    aiScales: [1, 0.93, 0.9, 0.87, 0.84],
    names: ['YOU', 'VEX', 'JUNO', 'PIP', 'KAZ'],
    theme: {
      skyTop: '#0b1030',
      skyBottom: '#5e2f6e',
      sun: '#ffb02e',
      ridgeFar: '#241d4d',
      ridgeNear: '#3a2a5e',
      ground: '#2f4a26',
      roadA: [92, 94, 110],
      roadB: [84, 86, 102],
      accent: '#35e0ff',
      scenery: 'posts',
    },
  },
  {
    id: 'coral',
    name: 'Coral Sweep',
    blurb: 'Fast double-apex sweepers along the coral coast.',
    control: CORAL_SWEEP_CONTROL,
    targetLength: 3200,
    laps: 3,
    timeout: 280,
    aiScales: [1, 0.94, 0.91, 0.88, 0.85],
    names: ['YOU', 'VEX', 'JUNO', 'PIP', 'KAZ'],
    theme: {
      skyTop: '#06283a',
      skyBottom: '#0f7a80',
      sun: '#ffe9a8',
      ridgeFar: '#0d3f52',
      ridgeNear: '#14606b',
      ground: '#7a5a34',
      roadA: [104, 100, 108],
      roadB: [94, 90, 100],
      accent: '#ff4fd8',
      scenery: 'pines',
    },
  },
  {
    id: 'ratchet',
    name: 'Ratchet Chicane',
    blurb: 'Tight stadium chicanes. VEX PRIME defends the finale.',
    control: RATCHET_CHICANE_CONTROL,
    targetLength: 2900,
    laps: 3,
    timeout: 280,
    // Finale rival: VEX runs a faster setup (higher top scale) — same
    // driver all cup, same physics, same rules, no fakery. The separate
    // "VEX PRIME" display title lives in spec boss metadata, not here.
    aiScales: [1, 0.985, 0.93, 0.9, 0.87],
    names: ['YOU', 'VEX', 'JUNO', 'PIP', 'KAZ'],
    theme: {
      skyTop: '#120a24',
      skyBottom: '#4d1f5e',
      sun: '#ff5a5a',
      ridgeFar: '#1d1440',
      ridgeNear: '#2e2060',
      ground: '#26334a',
      roadA: [98, 96, 118],
      roadB: [88, 86, 108],
      accent: '#ffb02e',
      scenery: 'crystals',
    },
  },
];

function compileCircuit(def: CircuitTemplateDef): RaceCircuit {
  return compileTrackVariant(def.id);
}

/** Mirror a control cage across the racing line (reverses turn direction). */
export function mirrorPoints(control: TrackPoint[]): TrackPoint[] {
  return control.map((p) => ({ x: -p.x, y: p.y }));
}

/**
 * Compile one template with bounded variation: a shorter/longer lap within
 * 2800-3600 units and/or a mirrored direction. Mirroring is an isometry
 * (seam, smoothness, and curvature magnitude survive; turn handedness
 * flips); rescaling length scales curvature inversely, so the lint band and
 * AI drivability tests cover the extrema. Pads re-derive from the geometry.
 */
export function compileTrackVariant(
  templateId: string,
  opts: { length?: number; mirror?: boolean; discipline?: RacingDiscipline } = {},
): RaceCircuit {
  const def = TEMPLATE_DEFS.find((d) => d.id === templateId) ?? TEMPLATE_DEFS[0]!;
  const control = opts.mirror ? mirrorPoints(def.control) : def.control;
  const track = compileTrack(control, opts.length ?? def.targetLength);
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    track,
    pads: padsFor(track),
    pickups: pickupsFor(track),
    boostMode: 'pads',
    laps: def.laps,
    timeout: def.timeout,
    aiScales: [...def.aiScales],
    names: [...def.names],
    theme: def.theme,
    discipline: opts.discipline ?? 'hover',
  };
}

/** The three cup circuits in race order. Built-in defaults for dev/tests. */
export const RACE_CIRCUITS: RaceCircuit[] = TEMPLATE_DEFS.map(compileCircuit);

const DEFAULT_CIRCUIT = RACE_CIRCUITS[0]!;
const TRACK = DEFAULT_CIRCUIT.track;

export const TRACK_LENGTH: number = TRACK.length;

/** Lateral half-width of the road surface. */
export const ROAD_HALF = 4.0;
/**
 * Forgiving curb/apron band past the asphalt edge (world units). Inside it
 * the craft still counts as on-road (no HUD OFFROAD, no surface penalty);
 * past it the surface penalty ramps with penetration to the deep-shoulder
 * cap at the barrier.
 */
export const CURB_WIDTH = 0.4;
/**
 * Boost-pad lane half-width (world units). Pads are painted 70% of the road
 * half-width each side of the centerline, and the physics trigger uses this
 * same lane so the drawn pad and the hit area agree exactly.
 */
export const PAD_HALF_X = ROAD_HALF * 0.7;
/** |x| is clamped here; hitting it scrapes speed off. */
export const BARRIER_X = 6.2;

/** Checkpoint fractions of a lap (finish gate itself is fraction 0/1). */
export const CHECKPOINT_FRACTIONS = [0.25, 0.5, 0.75] as const;

export const BOOST_PADS: BoostPad[] = DEFAULT_CIRCUIT.pads;

export function wrapS(s: number): number {
  return TRACK.wrap(s);
}

/** Heading change per unit at distance s. */
export function curvatureAt(s: number): number {
  return TRACK.curvatureAt(s);
}

/** Absolute heading (radians) of the centerline at distance s. */
export function headingAt(s: number): number {
  return TRACK.headingAt(s);
}

/** Interpolated centerline position at distance s (world units). */
export function pointAt(s: number): TrackPoint {
  return TRACK.pointAt(s);
}

/** Unit tangent at distance s (world units). */
export function tangentAt(s: number): TrackPoint {
  return TRACK.tangentAt(s);
}

/** Closed-loop outline for the minimap (count+1 points, last === first). */
export function trackOutlinePoints(count = 120): TrackPoint[] {
  return TRACK.outline(count);
}

/** True when wrapped distance s lies on any boost pad. */
export function padAt(s: number): BoostPad | null {
  const w = TRACK.wrap(s);
  for (const pad of BOOST_PADS) {
    if (w >= pad.start && w <= pad.start + pad.length) return pad;
  }
  return null;
}
