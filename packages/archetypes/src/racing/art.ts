// Generated-pack consumption helpers for the racing renderer: pose
// selection, panorama parallax, material sampling geometry, the combined
// depth-sorted sprite queue, scenery mapping, and stable roster names.
// Pure and canvas-agnostic (except opaque image handles); game.ts owns all
// drawing. Physics, road bounds, and timing are untouched.
import type { RacingArtBundle } from '@sparkade/engine';
import {
  RACING_CRAFT_CELL,
  RACING_MATERIAL_SLOTS,
  RACING_MATERIAL_TILE,
  RACING_PANORAMA_HEIGHT,
  RACING_PANORAMA_WIDTH,
  RACING_SCENERY_CELL,
  RACING_SCENERY_SLOTS,
  type RacingCraftPose,
  type RacingMaterialSlot,
  type RacingScenerySlot,
  type RacingSpec,
  type RacingTrackMaterials,
} from '@sparkade/shared';

/** Resolved per-race pack references. No copies, no canvas state. */
export interface RaceArtRefs {
  panorama: CanvasImageSource;
  strips: readonly CanvasImageSource[];
  scenery: CanvasImageSource;
  materials: CanvasImageSource;
}

/**
 * Per-race pack refs, or null without a complete bundle. The race index is
 * wrapped defensively; the loader guarantees order (cup race order).
 */
export function resolveRaceArt(
  bundle: RacingArtBundle | null | undefined,
  raceIndex: number,
): RaceArtRefs | null {
  if (!bundle || bundle.panoramas.length < 3 || bundle.strips.length < 5) return null;
  const pano = bundle.panoramas[((raceIndex % 3) + 3) % 3];
  if (!pano) return null;
  return {
    panorama: pano,
    strips: bundle.strips,
    scenery: bundle.sceneryAtlas,
    materials: bundle.materialAtlas,
  };
}

/**
 * Craft pose from smoothed steer and speed. Stopped craft stay neutral;
 * otherwise a small dead zone keeps straightaways on the rear cell. The
 * caller passes already-smoothed steer (steerVis / steerPos scaled).
 */
export function selectCraftPose(
  smoothedSteer: number,
  speed: number,
  bankThreshold = 0.12,
): RacingCraftPose {
  if (Math.abs(speed) < 1) return 'rear';
  if (smoothedSteer > bankThreshold) return 'bankRight';
  if (smoothedSteer < -bankThreshold) return 'bankLeft';
  return 'rear';
}

/** Source-x of a pose cell inside a 3-cell strip. Never mirrored. */
export function craftPoseSourceX(pose: RacingCraftPose): number {
  return pose === 'rear' ? 0 : pose === 'bankLeft' ? RACING_CRAFT_CELL : RACING_CRAFT_CELL * 2;
}

/**
 * Nominal baked bank lean per generated pose (radians, ~9deg). The runtime
 * residual transform compensates this expected angle: neutral gradually
 * leans toward the bank frame, which carries a compensating residual.
 * Generated poses can vary from the nominal angle and need visual review.
 */
export const BAKED_POSE_LEAN = 0.16;

/** Baked lean contribution of one pose cell (rear reads neutral). */
export function bakedPoseLean(pose: RacingCraftPose): number {
  return pose === 'bankRight' ? BAKED_POSE_LEAN : pose === 'bankLeft' ? -BAKED_POSE_LEAN : 0;
}

/** Pose-switch hysteresis band (same units as smoothed steer): the banked
 *  pose holds until steering falls this far back below the threshold, so
 *  inputs hovering at the boundary cannot chatter between cells. */
export const POSE_HYSTERESIS = 0.04;

/**
 * Pose switch with hysteresis around the bank threshold. Stopped craft stay
 * neutral; from neutral the plain threshold applies; a banked pose holds
 * until steering retreats past threshold minus hysteresis (or crosses hard
 * to the opposite bank). Pure function of (prev, steer, speed).
 */
export function selectCraftPoseSteady(
  prev: RacingCraftPose,
  smoothedSteer: number,
  speed: number,
  bankThreshold = 0.12,
  hyst: number = POSE_HYSTERESIS,
): RacingCraftPose {
  if (Math.abs(speed) < 1) return 'rear';
  if (prev === 'bankRight') {
    if (smoothedSteer < -bankThreshold) return 'bankLeft';
    if (smoothedSteer < bankThreshold - hyst) return 'rear';
    return 'bankRight';
  }
  if (prev === 'bankLeft') {
    if (smoothedSteer > bankThreshold) return 'bankRight';
    if (smoothedSteer > -(bankThreshold - hyst)) return 'rear';
    return 'bankLeft';
  }
  return selectCraftPose(smoothedSteer, speed, bankThreshold);
}

/** Peak continuous lean toward a bank frame (radians, ~10deg at full lock). */
export const VIS_LEAN_MAX = 0.18;

/**
 * Residual rotation for a generated blit: desired smoothed lean minus the
 * nominal baked lean of the currently shown pose cell. Net orientation
 * (residual + nominal baked lean) equals the desired lean. This avoids
 * doubling the expected bank angle and stays exactly neutral at rest.
 */
export function packResidualLean(smoothedSteer: number, pose: RacingCraftPose): number {
  const c = smoothedSteer < -1 ? -1 : smoothedSteer > 1 ? 1 : smoothedSteer;
  const residual = c * VIS_LEAN_MAX - bakedPoseLean(pose);
  // Snap float dust: a settled stick must emit exactly zero so reused queue
  // entries and paused frames carry no phantom transform.
  if (Math.abs(residual) < 1e-9) return 0;
  return residual < -0.22 ? -0.22 : residual > 0.22 ? 0.22 : residual;
}

/**
 * Panorama source offset for a camera heading: truly turn-proportional
 * cyclic scroll. A heading delta always maps to a same-direction
 * proportional displacement (period per 2π), so full rotations and lap
 * wraps stay seamless with no reversal at sine extrema. Sine is gone on
 * purpose: it bunched motion at the center and reversed at the edges.
 * sin(π) equals sin(-π) only by accident of symmetry; the cyclic map meets
 * at ±π by construction (both land on period/2).
 */
export function panoramaSourceX(heading: number, period: number, repeats = 1): number {
  if (!(period > 0) || !Number.isFinite(heading)) return 0;
  // Integer repeats preserve the heading/lap seam. Five at the runtime
  // crop width gives ~429 screen px/rad, close to the road camera's 468.
  const turns = (heading * Math.max(1, Math.round(repeats))) / (Math.PI * 2);
  let x = (turns - Math.floor(turns)) * period;
  // Normalize -0 and float dust at the wrap point.
  if (x < 0) x += period;
  if (x >= period) x -= period;
  if (Object.is(x, -0)) return 0;
  return x;
}

/**
 * Panorama screen slice: a landmark-bearing lower band of the 480px plate.
 * Full height cannot fit the wide screen aspect (480px tall would need a
 * 2082px-wide slice of a 1536px plate), so this band keeps the horizon and
 * the world landmarks above it instead of cropping to empty sky.
 */
export const PANORAMA_SOURCE_WIDTH = 1216;
export const PANORAMA_SOURCE_HEIGHT = 280;
export const PANORAMA_SOURCE_Y = 200;
export function panoramaMaxOffset(): number {
  return RACING_PANORAMA_WIDTH - PANORAMA_SOURCE_WIDTH;
}
/**
 * Blend width for the once-per-image periodic strip. The generated plates
 * are valid art but not tileable, so the cached strip crossfades the last
 * OVERLAP pixels (tail) with the first OVERLAP pixels (head) over this
 * width. 256px hides the seam while keeping period (1280px)
 * comfortably wider than the 1216px view, so every frame draws at most
 * two slices. Never mirrored: the core pixels are copied in order.
 */
export const PANORAMA_BLEND_OVERLAP = 256;
/** Periodic strip width: full plate minus the blend overlap. */
export function panoramaPeriodWidth(): number {
  return RACING_PANORAMA_WIDTH - PANORAMA_BLEND_OVERLAP;
}
/** Blend weight of the head pixel at seam column j in [0, overlap). */
export function panoramaBlendWeight(j: number, overlap: number): number {
  if (!(overlap > 1)) return 1;
  const t = Math.max(0, Math.min(1, j / (overlap - 1)));
  return t * t * (3 - 2 * t);
}
/** One horizon slice drawn from the periodic strip (source + dest). */
export interface PanoramaSlice {
  sx: number;
  sw: number;
  dx: number;
  dw: number;
}
/**
 * Horizon slices covering a viewWidth window starting at srcX on a
 * periodic strip of width period, mapped to dest [0, destW). Writes into
 * out (preallocated capacity 2, no per-frame allocation) and returns the
 * span count (1 when the window fits, 2 when it wraps). Every span stays
 * inside [0, period); dest tiles are contiguous and gapless.
 */
export function panoramaSliceSpans(
  srcX: number,
  viewWidth: number,
  period: number,
  destW: number,
  out: PanoramaSlice[],
): number {
  if (!(period > 0) || !(viewWidth > 0) || !(destW > 0)) return 0;
  let x = srcX % period;
  if (x < 0) x += period;
  const first = Math.min(viewWidth, period - x);
  let a = out[0];
  if (!a) {
    a = { sx: 0, sw: 0, dx: 0, dw: 0 };
    out[0] = a;
  }
  a.sx = x;
  a.sw = first;
  a.dx = 0;
  a.dw = (first / viewWidth) * destW;
  if (first >= viewWidth - 1e-9) return 1;
  let b = out[1];
  if (!b) {
    b = { sx: 0, sw: 0, dx: 0, dw: 0 };
    out[1] = b;
  }
  b.sx = 0;
  b.sw = viewWidth - first;
  b.dx = a.dw;
  b.dw = destW - a.dw;
  return 2;
}
export function panoramaPlateHeight(): number {
  return RACING_PANORAMA_HEIGHT;
}

/** Atlas quadrant for a material slot (2x2 grid of 128px tiles). */
export function materialTileRect(slot: RacingMaterialSlot): {
  sx: number;
  sy: number;
  size: number;
} {
  const i = RACING_MATERIAL_SLOTS.indexOf(slot);
  return {
    sx: (i % 2) * RACING_MATERIAL_TILE,
    sy: Math.floor(i / 2) * RACING_MATERIAL_TILE,
    size: RACING_MATERIAL_TILE,
  };
}

/**
 * World-anchored texture phase in [0,1): a function of world distance only,
 * so the repeat scrolls with travel and is independent of screen strip
 * index. The lap seam matches exactly only when tileWorld divides the track
 * length — use fitTileWorld for the effective tile length.
 */
export function worldTilePhase(worldS: number, tileWorld: number): number {
  const f = worldS / tileWorld;
  return f - Math.floor(f);
}

/**
 * Effective tile world length with an integer repeat count per lap, so
 * wrapped longitudinal sampling meets itself at the start/finish seam.
 */
export function fitTileWorld(trackLength: number, nominal: number = ROAD_TILE_WORLD): number {
  const repeats = Math.max(1, Math.round(trackLength / nominal));
  return trackLength / repeats;
}

/**
 * Inverse-depth projection for one integer screen row: the camera-relative
 * forward distance whose ground-plane point lands at row center yCenter.
 * Rows on or above the horizon return +Infinity.
 */
export function perspectiveZ(
  yCenter: number,
  horizon: number,
  camH: number,
  focal: number,
): number {
  const d = yCenter - horizon;
  if (!(d > 0)) return Number.POSITIVE_INFINITY;
  return (camH * focal) / d;
}

/**
 * Smooth depth lighting in [0.45, 1]: 1 at the camera, 0.45 at the far end
 * of the visible span. A pure function of depth, so neighboring rows never
 * disagree the way camera-fixed segment bands do.
 */
export function depthShade(z: number, zNear: number, zSpan: number): number {
  const span = Math.max(1e-6, zSpan);
  const f = Math.max(0, Math.min(1, (z - zNear) / span));
  return 0.45 + 0.55 * (1 - f);
}

/**
 * Intersect a screen row with the existing projected road edges. Screen Y
 * is proportional to inverse depth, so interpolation must use 1/z, not
 * the strip index or world Z. Width then matches the pinhole law exactly,
 * and the center follows the same edges as the original road polygons.
 */
export function sampleStripRow(
  strips: ReadonlyArray<{ cx: number; half: number; ppu: number; z: number }>,
  z: number,
  zNear: number,
  zSpan: number,
  out: { cx: number; half: number; ppu: number } = { cx: 0, half: 0, ppu: 0 },
): { cx: number; half: number; ppu: number } | null {
  const segs = strips.length - 1;
  if (segs < 1 || !(z >= zNear)) return null;
  const span = Math.max(1e-6, zSpan);
  const f = Math.sqrt(Math.max(0, z - zNear) / span) * segs;
  if (f > segs + 1e-9) return null;
  const i0 = Math.min(segs - 1, Math.floor(f));
  const a = strips[i0]!;
  const b = strips[i0 + 1]!;
  const ft = Math.max(0, Math.min(1, (1 / z - 1 / a.z) / (1 / b.z - 1 / a.z)));
  out.cx = a.cx + (b.cx - a.cx) * ft;
  out.half = a.half + (b.half - a.half) * ft;
  out.ppu = a.ppu + (b.ppu - a.ppu) * ft;
  return out;
}

/**
 * Atlas row (0..tilePx-1) for a world distance: pure world function, so a
 * strip join shared by two rows samples identically from either side, and
 * fitTileWorld keeps the lap seam continuous.
 */
export function rowAtlasRow(worldS: number, tileWorld: number, tilePx: number): number {
  if (!(tileWorld > 0) || !(tilePx > 0)) return 0;
  const phase = worldTilePhase(worldS, tileWorld);
  if (phase > 1 - 1e-10) return 0;
  return Math.min(tilePx - 1, Math.floor(phase * tilePx));
}

/** One world-anchored ground run inside a single atlas quadrant. */
export interface GroundSpan {
  /** Source x inside [quadSx, quadSx + quadSize). */
  sx: number;
  /** Source width; sx + sw never leaves the quadrant. */
  sw: number;
  /** Destination x and width on screen. */
  dx: number;
  dw: number;
}

/**
 * World-anchored ground spans covering screen [x0, x1) at one row: U follows
 * world lateral distance ((x - cx) / ppu / tileWorld), so the ground scrolls
 * with travel and bends with the road instead of sitting screen-fixed.
 * Splits at quadrant wrap boundaries; every span stays inside the quadrant.
 * Reuses out (bounded: at most ~x-range/tile-width + 1 spans).
 */
export function groundSourceSpans(
  x0: number,
  x1: number,
  cx: number,
  ppu: number,
  tileWorld: number,
  quadSx: number,
  quadSize: number,
  out: GroundSpan[] = [],
): GroundSpan[] {
  if (!(x1 > x0) || !(ppu > 0) || !(tileWorld > 0) || !(quadSize > 0)) {
    out.length = 0;
    return out;
  }
  const tilePxW = tileWorld * ppu;
  let count = 0;
  let u = (x0 - cx) / ppu / tileWorld;
  let x = x0;
  for (let guard = 0; x < x1 - 1e-9 && guard < 64; guard++) {
    let phase = u - Math.floor(u);
    // Roundoff at an exact tile boundary must start the next tile, rather
    // than producing a zero-width run and abandoning the rest of the row.
    if (phase > 1 - 1e-10) phase = 0;
    const sx = quadSx + Math.min(quadSize - 1e-6, phase * quadSize);
    const dw = Math.min((1 - phase) * tilePxW, x1 - x);
    if (!(dw > 1e-9)) break;
    const sw = Math.min((dw / tilePxW) * quadSize, quadSx + quadSize - sx);
    if (!(sw > 0)) break;
    const run = out[count] ?? { sx: 0, sw: 0, dx: 0, dw: 0 };
    run.sx = sx;
    run.sw = sw;
    run.dx = x;
    run.dw = dw;
    out[count++] = run;
    x += dw;
    u += dw / tilePxW;
  }
  out.length = count;
  return out;
}

/** One V-run of a longitudinal texture sample (wraps into at most 2 runs). */
export interface SourceRun {
  sy: number;
  sh: number;
  dyFrac: number;
  dhFrac: number;
}

/**
 * Longitudinal source runs for one projection strip: V follows wrapped
 * world distance (wsFarW/wsNearW in [0, trackLength)), so texture scrolls
 * with travel toward the camera and stays continuous across strip
 * boundaries. U is the caller's full quadrant width (physical x across the
 * surface). Writes into out, returns the run count (0 when degenerate).
 *
 * Signed physical direction: the far edge sits AHEAD of the near edge, so
 * the strip span is the forward distance (wsFarW - wsNearW mod length).
 * The old near-minus-far order spanned almost the whole lap whenever
 * wsFarW > wsNearW (the normal case) and read far outside the atlas
 * quadrant.
 */
export function stripSourceRuns(
  wsFarW: number,
  wsNearW: number,
  trackLength: number,
  tileWorld: number,
  tilePx: number,
  out: SourceRun[],
): number {
  let span = (wsFarW - wsNearW) % trackLength;
  if (span < 0) span += trackLength;
  if (span <= 0 || tileWorld <= 0 || tilePx <= 0) return 0;
  // V decreases from the far edge toward the near edge (worldS decreases
  // far→near), so the first run counts DOWN from v0 and wraps at zero.
  const vSpan = (span / tileWorld) * tilePx;
  const v0 = ((((wsFarW / tileWorld) * tilePx) % tilePx) + tilePx) % tilePx;
  const first = Math.min(vSpan, v0);
  out[0]!.sy = v0 - first;
  out[0]!.sh = first;
  out[0]!.dyFrac = 0;
  out[0]!.dhFrac = first / vSpan;
  if (vSpan - first <= 1e-9) return 1;
  const rest = vSpan - first;
  out[1]!.sy = tilePx - rest;
  out[1]!.sh = rest;
  out[1]!.dyFrac = first / vSpan;
  out[1]!.dhFrac = rest / vSpan;
  return 2;
}

/** World length of one road-texture repeat. */
export const ROAD_TILE_WORLD = 64;

/** Parse #rrggbb into an rgb triple for the legacy shade() helper. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Scale an rgb triple (band alternation without per-frame allocation). */
export function scaleRgb(c: [number, number, number], f: number): [number, number, number] {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
}

/** Authored hex with an alpha channel for edge/safety markings. */
export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Authored base palette, or null to keep the legacy theme path. */
export function authoredPalette(materials: RacingTrackMaterials | undefined): {
  road: [number, number, number];
  ground: [number, number, number];
  curb: [number, number, number];
  edge: string;
  pad: string;
} | null {
  if (!materials) return null;
  return {
    road: hexRgb(materials.road),
    ground: hexRgb(materials.ground),
    curb: hexRgb(materials.curb),
    edge: materials.edge,
    pad: materials.pad,
  };
}

/**
 * Atlas slot for a roadside marker from stable marker identity ONLY — never
 * camera distance, so objects cannot morph between landmark and dressing as
 * the player approaches. Every sixth marker is a landmark (alternating far
 * and near designs); the rest cycle dressing. The boost slot is NEVER
 * decoration — pickups own it.
 */
export function scenerySlotFor(markerK: number): RacingScenerySlot {
  const m = ((markerK % 12) + 12) % 12;
  if (m === 0) return 'landmarkFar';
  if (m === 6) return 'landmarkNear';
  const dressing: readonly RacingScenerySlot[] = ['dressingA', 'dressingB', 'dressingC'];
  return dressing[m % dressing.length]!;
}

/** Landmark slots read large with real roadside setback; dressing stays small. */
export function isLandmarkSlot(slot: RacingScenerySlot): boolean {
  return slot === 'landmarkFar' || slot === 'landmarkNear';
}

/**
 * Exhaust flame level: 2 while boosting, 1 as a subtle cruise flicker above
 * throttle speed, 0 stopped. Baked exhaust was removed from the art, so the
 * runtime owns every flame.
 */
export function exhaustFlame(speed: number, boostT: number): 0 | 1 | 2 {
  if (boostT > 0) return 2;
  if (Math.abs(speed) < 1) return 0;
  return Math.abs(speed) > 30 ? 1 : 0;
}

/**
 * Body fill of a normalized strip cell: the keyer fits subjects into the
 * 64px cell minus 6px padding per side, so the body spans ~52/64 of the
 * cell. Divide physical draw sizes by this to restore true world width.
 */
export const STRIP_BODY_FILL = 52 / 64;

/** Atlas cell rect for a scenery slot. */
export function sceneryAtlasCell(slot: RacingScenerySlot): {
  sx: number;
  sy: number;
  size: number;
} {
  const i = RACING_SCENERY_SLOTS.indexOf(slot);
  return {
    sx: (i % 3) * RACING_SCENERY_CELL,
    sy: Math.floor(i / 3) * RACING_SCENERY_CELL,
    size: RACING_SCENERY_CELL,
  };
}

/** One depth-sorted world sprite: far-to-near painter's order by z. */
export interface ArtSprite {
  /** Camera-relative depth; larger draws first. */
  z: number;
  /** Stable tiebreak so equal depths never flicker. */
  order: number;
  img: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  alpha: number;
  /**
   * Residual rotation (radians) about the blit base center. Zero for every
   * non-craft sprite; reassigned on every push so reused queue entries can
   * never leak a stale transform into scenery, pickups, or the HUD path.
   */
  rot: number;
}

/** Preallocated sprite queue (no per-frame allocation in the renderer). */
export function makeArtSpriteQueue(capacity: number): ArtSprite[] {
  return Array.from({ length: capacity }, () => ({
    z: 0,
    order: 0,
    img: null as unknown as CanvasImageSource,
    sx: 0,
    sy: 0,
    sw: 0,
    sh: 0,
    dx: 0,
    dy: 0,
    dw: 0,
    dh: 0,
    alpha: 1,
    rot: 0,
  }));
}

/**
 * Stable far-to-near insertion sort over the first count entries. Moves
 * whole object references (the queue owns every object), so payloads such
 * as img can never alias, duplicate, or collapse during shifts.
 */
export function sortArtSprites(list: ArtSprite[], count: number): void {
  for (let a = 1; a < count; a++) {
    const tmp = list[a]!;
    let b = a - 1;
    while (b >= 0 && (list[b]!.z < tmp.z || (list[b]!.z === tmp.z && list[b]!.order > tmp.order))) {
      list[b + 1] = list[b]!;
      b--;
    }
    list[b + 1] = tmp;
  }
}

/**
 * Stable roster names: the identity cast overrides per-course names
 * everywhere (HUD, results, standings). Legacy specs keep course names.
 */
export function stableRosterNames(
  spec: RacingSpec | undefined,
  names: readonly string[],
): string[] {
  if (!spec?.identity) return [...names];
  return names.map((name, i) =>
    i === 0 ? spec.identity!.pilotName : (spec.identity!.rivalCrafts[i - 1]?.name ?? name),
  );
}
