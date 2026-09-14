// Bounded elevation projection for the racing renderer.
//
// Pure, preallocated helpers that map an optional periodic track-height
// profile onto the existing pinhole road projection. Lateral curve
// projection is untouched: only screen Y (depth) and occlusion change.
//
// Conventions (shared with game.ts):
//   camS      = player.s - CAM_BACK (world distance at the camera)
//   camHWorld = track height under the player + CAM_H, so the player's own
//               ground row is always HORIZON + CAM_H * FOCAL / CAM_BACK —
//               the exact legacy value, whatever the hills do elsewhere.
//   y(z)      = HORIZON + (camHWorld - heightAt(camS + z)) * FOCAL / z
// Absent height (legacy/flat tracks) never reaches this module: the caller
// branches on track.heightAt, and zero heights reproduce the legacy
// arithmetic exactly through the same formula.
//
// Occlusion model: elevation is uniform across the road width, so a nearer
// crest hides a farther point exactly when the camera-to-point sightline
// dips under nearer terrain. Dense forward samples (fixed count,
// preallocated) back both the generated integer-row table (nearest surface
// wins where crest rows overlap) and the shared sprite clip query.
/** Forward samples per frame; 1.5-unit spacing over the visible span. */
export const ELEVATION_SAMPLE_COUNT = 257;

/** Minimal strip view this module needs (compatible with Projected). */
export interface ElevationStripInput {
  readonly y: number;
  readonly cx: number;
  readonly half: number;
  readonly ppu: number;
  readonly z: number;
}

/**
 * Per-frame scratch: dense forward samples plus one entry per integer
 * screen row. All buffers are allocated once by createElevationFrame and
 * rewritten (never reallocated) by buildElevationFrame, so the hot path and
 * a paused race allocate nothing.
 */
export interface ElevationFrame {
  readonly screenH: number;
  // Dense samples, nearest to far (length ELEVATION_SAMPLE_COUNT).
  readonly n: number;
  readonly sz: Float64Array;
  readonly sy: Float64Array;
  readonly scx: Float64Array;
  readonly shalf: Float64Array;
  readonly sppu: Float64Array;
  /** Terrain height at each sample (world units, datum-relative). */
  readonly sh: Float64Array;
  // Integer-row surface table, rows [0, screenH).
  readonly rowHit: Uint8Array;
  readonly rowZ: Float64Array;
  readonly rowCx: Float64Array;
  readonly rowHalf: Float64Array;
  readonly rowPpu: Float64Array;
  /** World distance (camS + z) sampled by each claimed row. */
  readonly rowS: Float64Array;
  // Build context (rewritten per build).
  camS: number;
  camHWorld: number;
  zNear: number;
  zSpan: number;
  horizon: number;
  focal: number;
  heightAt: (s: number) => number;
  /** Smallest claimed row (loop start); screenH when nothing claimed. */
  minRow: number;
  readonly scratch: { cx: number; half: number; ppu: number };
}

/** Allocate frame scratch for a screen of height screenH. */
export function createElevationFrame(screenH: number): ElevationFrame {
  const n = ELEVATION_SAMPLE_COUNT;
  return {
    screenH,
    n,
    sz: new Float64Array(n),
    sy: new Float64Array(n),
    scx: new Float64Array(n),
    shalf: new Float64Array(n),
    sppu: new Float64Array(n),
    sh: new Float64Array(n),
    rowHit: new Uint8Array(screenH),
    rowZ: new Float64Array(screenH),
    rowCx: new Float64Array(screenH),
    rowHalf: new Float64Array(screenH),
    rowPpu: new Float64Array(screenH),
    rowS: new Float64Array(screenH),
    camS: 0,
    camHWorld: 0,
    zNear: 0,
    zSpan: 1,
    horizon: 0,
    focal: 1,
    heightAt: () => 0,
    minRow: screenH,
    scratch: { cx: 0, half: 0, ppu: 0 },
  };
}

/**
 * Screen Y of terrain at camera-relative depth z. Exact for every z
 * (one height query, no interpolation), so sprites sit precisely on the
 * surface the row table paints. At z = CAM_BACK with
 * camHWorld = heightAt(playerS) + CAM_H this equals the legacy flat value.
 */
export function elevationGroundY(
  heightAt: (s: number) => number,
  camS: number,
  camHWorld: number,
  z: number,
  horizon: number,
  focal: number,
): number {
  const h = heightAt(camS + z);
  return horizon + ((camHWorld - h) * focal) / z;
}

/** Projected point shape (mirrors game.ts Projected, no import cycle). */
export interface ElevatedPoint {
  y: number;
  cx: number;
  half: number;
  ppu: number;
  z: number;
}

/**
 * Same depth interpolation as projectAtZ (identical cx/half/ppu for flat
 * and elevated alike — elevation never moves the road sideways) with the
 * screen Y replaced by the exact elevation formula. Null exactly when
 * projectAtZ is null, so caller culling is unchanged. projectAtZ is passed
 * in so this module never imports the renderer.
 */
export function projectElevatedAtZ(
  strips: readonly ElevationStripInput[],
  projectAtZ: (strips: readonly ElevationStripInput[], z: number) => ElevatedPoint | null,
  z: number,
  camS: number,
  camHWorld: number,
  heightAt: (s: number) => number,
  horizon: number,
  focal: number,
): ElevatedPoint | null {
  const proj = projectAtZ(strips, z);
  if (proj === null) return null;
  stripLerp(strips, z, strips[0]!.z, strips[strips.length - 1]!.z - strips[0]!.z, proj);
  proj.y = elevationGroundY(heightAt, camS, camHWorld, z, horizon, focal);
  return proj;
}

function stripLerp(
  strips: readonly ElevationStripInput[],
  z: number,
  zNear: number,
  zSpan: number,
  out: { cx: number; half: number; ppu: number },
): boolean {
  const segs = strips.length - 1;
  if (segs < 1 || !(z >= zNear)) return false;
  const span = Math.max(1e-6, zSpan);
  const f = Math.sqrt(Math.max(0, z - zNear) / span) * segs;
  if (!(f <= segs + 1e-9)) return false;
  const i0 = Math.min(segs - 1, Math.floor(f));
  const a = strips[i0]!;
  const b = strips[i0 + 1]!;
  const invA = 1 / a.z;
  const ft = Math.max(0, Math.min(1, (1 / z - invA) / (1 / b.z - invA)));
  out.cx = a.cx + (b.cx - a.cx) * ft;
  out.half = a.half + (b.half - a.half) * ft;
  out.ppu = a.ppu + (b.ppu - a.ppu) * ft;
  return true;
}

/**
 * Fill the frame's samples and row table from the projected strips.
 * Nearest-to-far first-fill wins: where a crest overlaps farther road,
 * the nearer surface keeps the row (occlusion); hidden or inverted sample
 * pairs (far edge at or below the near edge on screen) claim nothing.
 * Within a pair, depth interpolates in inverse Z (perspective-correct) and
 * lateral/width follow the same parameter.
 */
export function buildElevationFrame(
  frame: ElevationFrame,
  strips: readonly ElevationStripInput[],
  heightAt: (s: number) => number,
  camS: number,
  camHWorld: number,
  zNear: number,
  zSpan: number,
  horizon: number,
  focal: number,
): void {
  frame.camS = camS;
  frame.camHWorld = camHWorld;
  frame.zNear = zNear;
  frame.zSpan = zSpan;
  frame.horizon = horizon;
  frame.focal = focal;
  frame.heightAt = heightAt;
  frame.rowHit.fill(0);
  frame.minRow = frame.screenH;
  const n = frame.n;
  const tmp = frame.scratch;
  for (let i = 0; i < n; i++) {
    const z = zNear + (zSpan * i) / (n - 1);
    const h = heightAt(camS + z);
    frame.sz[i] = z;
    frame.sh[i] = h;
    frame.sy[i] = horizon + ((camHWorld - h) * focal) / z;
    if (stripLerp(strips, z, zNear, zSpan, tmp)) {
      frame.scx[i] = tmp.cx;
      frame.shalf[i] = tmp.half;
      frame.sppu[i] = tmp.ppu;
    } else if (i > 0) {
      frame.scx[i] = frame.scx[i - 1]!;
      frame.shalf[i] = frame.shalf[i - 1]!;
      frame.sppu[i] = frame.sppu[i - 1]!;
    } else {
      frame.scx[i] = 0;
      frame.shalf[i] = 0;
      frame.sppu[i] = 0;
    }
  }
  // Nearest-to-far row fill.
  const H = frame.screenH;
  for (let i = 0; i < n - 1; i++) {
    const y0 = frame.sy[i]!;
    const y1 = frame.sy[i + 1]!;
    if (!(y1 < y0)) continue; // hidden or inverted band: nearer keeps it
    const r0 = Math.max(0, Math.ceil(y1 - 0.5));
    const r1 = Math.min(H - 1, Math.floor(y0 - 0.5));
    if (r1 < r0) continue;
    const z0 = frame.sz[i]!;
    const z1 = frame.sz[i + 1]!;
    const cx0 = frame.scx[i]!;
    const cx1 = frame.scx[i + 1]!;
    const ha0 = frame.shalf[i]!;
    const ha1 = frame.shalf[i + 1]!;
    const pp0 = frame.sppu[i]!;
    const pp1 = frame.sppu[i + 1]!;
    const inv0 = 1 / z0;
    const invSpan = 1 / z1 - inv0;
    const ySpan = y1 - y0;
    for (let r = r0; r <= r1; r++) {
      if (frame.rowHit[r] === 1) continue;
      const yc = r + 0.5;
      const t = (yc - y0) / ySpan;
      const z = 1 / (inv0 + invSpan * t);
      frame.rowHit[r] = 1;
      frame.rowZ[r] = z;
      frame.rowCx[r] = cx0 + (cx1 - cx0) * t;
      frame.rowHalf[r] = ha0 + (ha1 - ha0) * t;
      frame.rowPpu[r] = pp0 + (pp1 - pp0) * t;
      frame.rowS[r] = camS + z;
      if (r < frame.minRow) frame.minRow = r;
    }
  }
}

export interface ElevationClip {
  /** True when nearer terrain covers the point's ground row entirely. */
  blocked: boolean;
  /**
   * Screen Y of the blocking crest: rows above this stay visible, so a
   * tall sprite clips its base here instead of vanishing. screenH (no
   * clip) when unblocked.
   */
  clipY: number;
}

/**
 * Shared visible-depth/clip query for rivals, scenery, buoys, gates, and
 * pickups: does nearer terrain block the sightline from the camera
 * (height camHWorld at depth 0) to the ground point (z, heightAt(worldS))?
 * Exact per sprite (one height query plus a linear sample sweep); the fixed
 * front player never queries (always drawn).
 */
export function elevationClipFor(frame: ElevationFrame, z: number): ElevationClip {
  const H = frame.screenH;
  if (!(z > 0) || !(z > frame.zNear)) return { blocked: false, clipY: H };
  const targetY = elevationGroundY(
    frame.heightAt,
    frame.camS,
    frame.camHWorld,
    z,
    frame.horizon,
    frame.focal,
  );
  let crestY = H;
  for (let i = 0; i < frame.n && frame.sz[i]! < z; i++) {
    crestY = Math.min(crestY, frame.sy[i]!);
  }
  // The highest projected nearer crest is the silhouette. Choosing the
  // largest world-space excess could expose a base behind a nearer crest.
  return targetY > crestY + 0.01
    ? { blocked: true, clipY: Math.ceil(crestY) }
    : { blocked: false, clipY: H };
}
