// Racing game shell: GameInstance wrapper around the pure simulation with a
// behind-vehicle pseudo-3D road projection (bounded Canvas2D segment strips),
// rival craft sprites, HUD, and minimap. Only engine.renderer is used, so the
// core stays reusable for later GameHost integration.
//
// Cabinet controls: D-PAD steer, B accelerate, Y brake/reverse, A boost,
// L/R drift/airbrake. A also continues past titles, results, and standings;
// START belongs to the host (pause / hold-to-exit) and never advances the cup.
import type {
  EngineContext,
  GameInstance,
  GameResult,
  HudState,
  InputSnapshot,
} from '@sparkade/engine';
import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  type LogicalButton,
  type RacingCraftShape,
  type RacingSpec,
} from '@sparkade/shared';
import {
  BARRIER_X,
  CHECKPOINT_FRACTIONS,
  CURB_WIDTH,
  PAD_HALF_X,
  RACE_CIRCUITS,
  ROAD_HALF,
  compileTrackVariant,
  type CompiledTrack,
  type RaceCircuit,
} from './track';
import type { HoverEngineCaps } from './audio';
import { RaceEngineAudio, type RivalSound } from './rival-audio';
import {
  PANORAMA_SOURCE_HEIGHT,
  PANORAMA_SOURCE_WIDTH,
  PANORAMA_SOURCE_Y,
  ROAD_TILE_WORLD,
  STRIP_BODY_FILL,
  authoredPalette,
  craftPoseSourceX,
  depthShade,
  exhaustFlame,
  fitTileWorld,
  groundSourceSpans,
  makeArtSpriteQueue,
  materialTileRect,
  perspectiveZ,
  rowAtlasRow,
  sampleStripRow,
  panoramaMaxOffset,
  panoramaSourceX,
  resolveRaceArt,
  scaleRgb,
  sceneryAtlasCell,
  scenerySlotFor,
  selectCraftPose,
  sortArtSprites,
  stableRosterNames,
  isLandmarkSlot,
  withAlpha,
  type ArtSprite,
  type GroundSpan,
  type RaceArtRefs,
} from './art';
import {
  formatDelta,
  localStorageStore,
  LapAttempt,
  PersonalBests,
  type PersonalBest,
} from './timing';
import {
  analyzeBends,
  bannerStale,
  boardChevrons,
  boardsFor,
  nearestRival,
  nextBend,
  playerPos,
  positionEvent,
  UNITS_TO_M,
  type Bend,
  type RivalGap,
  type Upcoming,
} from './feedback';
import {
  BOOST_COST,
  CUP_POINTS,
  PLAYER_INDEX,
  RACER_COUNT,
  aiInputFor,
  classifyRace,
  createCup,
  createRaceFor,
  cupComplete,
  cupStandings,
  isPickupTaken,
  pickupsRemaining,
  racePosition,
  recordRaceResult,
  restartCup,
  restartRace,
  stepRace,
  type ClassifiedEntry,
  type CupState,
  type RaceState,
  type RacerInput,
} from './simulation';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
export const RACING_HORIZON = 118;
export const RACING_SEGMENTS = 24;
export const RACING_SEG_LEN = 16;
/**
 * One coherent pinhole projection shared by road, player, rivals, pads and
 * finish art. The camera hovers CAM_H world units above the road and
 * CAM_BACK units behind the player; every visible point sits at a
 * camera-relative forward distance z, and a single scale (FOCAL / z) turns
 * world units into pixels both across (road half-width, craft size) and
 * down (ground-plane height) the screen:
 *
 *   pixelsPerUnit(z) = FOCAL / z
 *   halfWidth(z)     = ROAD_HALF * pixelsPerUnit(z)
 *   screenY(z)       = HORIZON + CAM_H * FOCAL / z
 *
 * At the player (z = CAM_BACK = 9) the road is ~347 px wide and the craft
 * 52 px wide (road ~= 6.5 craft widths, ~104 display px at 2x); strip 0
 * lands exactly on the bottom edge (H) ~2.4 units behind the player, so
 * real road shows under the craft, and the far strip converges near the
 * horizon.
 */
const HORIZON = RACING_HORIZON;
const SEGMENTS = RACING_SEGMENTS;
const SEG_LEN = RACING_SEG_LEN;
/** Focal length in pixels: screen size = worldSize * FOCAL / z. */
export const RACING_FOCAL = 390;
/** Camera height above the road plane in world units. */
export const RACING_CAM_H = 3.1;
/** Camera distance behind the player; the player craft lives at this depth. */
export const RACING_CAM_BACK = 9;
/** Nearest visible distance from the camera (projects to y = H). */
export const RACING_Z_NEAR = (RACING_CAM_H * RACING_FOCAL) / (H - RACING_HORIZON);
/**
 * Visible depth span: the far strip sits at Z_NEAR + Z_SPAN. Strips follow
 * z(i) = Z_NEAR + Z_SPAN * (i/SEGMENTS)^2, dense near the camera where the
 * 1/z projection changes fastest, so strip interpolation stays within a
 * couple of pixels of the analytic curve everywhere (player included).
 */
export const RACING_Z_SPAN = 384;
/** Craft full body width in world units; player and rivals share this scale. */
export const CRAFT_WORLD_W = 1.2;
/** Pad lane as a fraction of the road half-width (mirrors PAD_HALF_X). */
const PAD_LANE_FRAC = PAD_HALF_X / ROAD_HALF;
/**
 * Visual lateral gain for road-bend integration (screen readability).
 * The projection integrates curvature into heading, then heading into
 * lateral centerline offset, so a constant bend produces a genuinely
 * bending road (offset growing with distance) instead of a constant
 * screen shift: direction and magnitude follow the physics curvature,
 * straights render straight, mirrors mirror.
 */
const CURVE_GAIN = 1.2;

const CRAFT_COLORS = ['#35e0ff', '#ff4fd8', '#ffb02e', '#7dff5a', '#b07dff'];
const CRAFT_DARK = ['#0e6f8a', '#8a1f70', '#8a5a10', '#2f7a24', '#4d2f8a'];

export const RACING_CONTROLS: Array<{ button: LogicalButton; label: string }> = [
  { button: 'LEFT', label: 'D-PAD left' },
  { button: 'RIGHT', label: 'D-PAD right' },
  { button: 'B', label: 'ACCEL' },
  { button: 'Y', label: 'BRAKE' },
  { button: 'A', label: 'BOOST / CONTINUE' },
  { button: 'L', label: 'DRIFT' },
];

export interface Projected {
  y: number;
  cx: number;
  half: number;
  /** Pixels per world unit at this depth; sprites scale by this. */
  ppu: number;
  /** Forward distance from the camera in world units. */
  z: number;
}

/**
 * Project the road around distance s with lateral camera x into strips.
 * The camera sits CAM_BACK behind s, so strip depths are camera-relative
 * (z = Z_NEAR + i * SEG_LEN) and half-width, craft scale, and screen height
 * all derive from the single pinhole scale FOCAL / z: half-width and y are
 * strictly monotonic from the broad bottom edge to the narrow horizon.
 * Strip 0 lands ~2.4 units behind the player, so road shows under the craft.
 * Fills `out` (preallocated, length SEGMENTS+1) when provided so the hot
 * path allocates nothing; otherwise allocates once for tests/probes.
 */
/** Strip depth law: quadratic in the index, dense near the camera. */
function stripZ(i: number): number {
  const t = i / SEGMENTS;
  return RACING_Z_NEAR + RACING_Z_SPAN * t * t;
}

export function projectRoad(
  s: number,
  camX: number,
  out?: Projected[],
  track: CompiledTrack = RACE_CIRCUITS[0]!.track,
): Projected[] {
  const strips =
    out ?? Array.from({ length: SEGMENTS + 1 }, () => ({ y: 0, cx: 0, half: 0, ppu: 0, z: 0 }));
  // Camera-relative projection: depth increases strictly with strip index
  // while curvature integrates into heading and heading into lateral
  // centerline offset, so a constant bend visibly bends (offset growing
  // with distance) and a straight renders straight. Depth (y, half-width)
  // never depends on lateral offset, so nothing folds back on itself;
  // the player tangent is the local forward direction.
  const camS = s - RACING_CAM_BACK;
  const behind = RACING_CAM_BACK - RACING_Z_NEAR;
  const localCurve = track.curvatureAt(s) * CURVE_GAIN;
  let heading = -localCurve * behind;
  let lat = 0.5 * localCurve * behind * behind;
  for (let i = 0; i <= SEGMENTS; i++) {
    const z = stripZ(i);
    if (i > 0) {
      const pz = stripZ(i - 1);
      // Small, bounded integration steps resolve bends even between the
      // widely spaced distant strips. Midpoint curvature and trapezoidal
      // heading integration avoid stretching corners with strip length.
      const steps = Math.ceil((z - pz) / 4);
      const dz = (z - pz) / steps;
      for (let k = 0; k < steps; k++) {
        const curve = track.curvatureAt(camS + pz + (k + 0.5) * dz) * CURVE_GAIN;
        lat += heading * dz + 0.5 * curve * dz * dz;
        heading += curve * dz;
      }
    }
    const ppu = RACING_FOCAL / z;
    const half = ROAD_HALF * ppu;
    const strip = strips[i]!;
    strip.y = HORIZON + (RACING_CAM_H * RACING_FOCAL) / z;
    strip.cx = W / 2 + (lat - camX) * ppu;
    strip.half = half;
    strip.ppu = ppu;
    strip.z = z;
  }
  // Use the same interpolation as sprites to pin the player-depth road
  // center exactly to its lateral position, including between strips.
  // This removes tiny local integration/interpolation errors, not bends.
  const f = Math.sqrt((RACING_CAM_BACK - RACING_Z_NEAR) / RACING_Z_SPAN) * SEGMENTS;
  const i = Math.floor(f);
  const t = f - i;
  const a = strips[i]!;
  const b = strips[i + 1]!;
  const anchorPpu = a.ppu + (b.ppu - a.ppu) * t;
  const anchorX = a.cx + (b.cx - a.cx) * t;
  const correction = (anchorX - W / 2) / anchorPpu + camX;
  for (const strip of strips) strip.cx -= correction * strip.ppu;
  return strips;
}

/**
 * Interpolate a camera-relative forward distance z into the strip buffer.
 * Returns null when z is outside the visible range. Craft at any z share
 * the road's exact depth law, so player, rivals, pads and finish art agree.
 */
export function projectAtZ(strips: Projected[], z: number): Projected | null {
  if (z < RACING_Z_NEAR) return null;
  const f = Math.sqrt((z - RACING_Z_NEAR) / RACING_Z_SPAN) * SEGMENTS;
  if (f > SEGMENTS - 0.001) return null;
  const i0 = Math.min(SEGMENTS - 1, Math.floor(f));
  const ft = f - i0;
  const s0 = strips[i0]!;
  const s1 = strips[i0 + 1]!;
  return {
    y: s0.y + (s1.y - s0.y) * ft,
    cx: s0.cx + (s1.cx - s0.cx) * ft,
    half: s0.half + (s1.half - s0.half) * ft,
    ppu: s0.ppu + (s1.ppu - s0.ppu) * ft,
    z,
  };
}

/** Signed shortest longitudinal gap from b to a along the track. */
function signedGap(track: CompiledTrack, a: number, b: number): number {
  let d = track.wrap(a - b);
  if (d > track.length / 2) d -= track.length;
  return d;
}

function padAtCircuit(circuit: RaceCircuit, s: number): boolean {
  const w = circuit.track.wrap(s);
  for (const pad of circuit.pads) {
    if (w >= pad.start && w <= pad.start + pad.length) return true;
  }
  return false;
}

function shade(base: [number, number, number], f: number): string {
  return `rgb(${Math.round(base[0] * f)},${Math.round(base[1] * f)},${Math.round(base[2] * f)})`;
}

/**
 * Deterministic 0..1 visual hash. All render-time flicker/jitter derives
 * from the race clock, so a paused (or otherwise frozen) race renders
 * byte-identical frames — no render-time Math.random anywhere.
 */
function visHash(t: number): number {
  const h = Math.sin(t * 12.9898) * 43758.5453;
  return h - Math.floor(h);
}

/** Deterministic spark PRNG (mulberry32); reseeded on every race rebuild. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turn cue direction for the road ahead of s: -1 (left), +1 (right),
 * 0 (straight). Reads the compiled curvature sign, so mirrored circuits cue
 * the mirrored direction automatically. Single source for boards and ground
 * arrows — they can never disagree about a bend.
 */
export function turnCueAt(track: CompiledTrack, s: number): -1 | 0 | 1 {
  const ahead = track.curvatureAt(s + 70);
  if (ahead > 0.0025) return 1;
  if (ahead < -0.0025) return -1;
  return 0;
}

/**
 * World-anchored roadside marker lattice. Scenery, ground arrows, and turn
 * boards live at fixed periodic circuit positions: each lattice holds a
 * fixed count of markers per lap (world position s = k * trackLength/count
 * for stable ids k in [0, count)), so every lap shows the same landmarks in
 * the same colors and the finish seam is perfectly smooth, including on
 * generated lengths. Markers smoothly approach and pass the camera as the
 * craft advances, never popping between screen strips. Each marker projects
 * through the same strip buffer as the road, so depth, scale, and lateral
 * road position agree exactly with the asphalt underneath it.
 */
export const RACING_SCENERY_COUNT = 64;
export const RACING_ARROW_COUNT = 72;

export interface WorldMarker {
  /** Stable per-lap circuit id in [0, count): same landmark every lap. */
  k: number;
  /** Camera-relative forward distance from the camera. */
  z: number;
}

/**
 * Periodic marker ids visible from camS. Marker k sits at lap position
 * k * trackLength/count; its camera depth is the wrapped lap-relative
 * distance from camS. Ids with depth inside the visible span return
 * far-to-near for overdraw. Pure function of (camS mod trackLength), so
 * camS and camS + trackLength render identical lattices.
 */
export function worldMarkerSlots(camS: number, trackLength: number, count: number): WorldMarker[] {
  const spacing = trackLength / count;
  const out: WorldMarker[] = [];
  for (let k = 0; k < count; k++) {
    let rel = (k * spacing - camS) % trackLength;
    if (rel < 0) rel += trackLength;
    if (rel >= RACING_Z_NEAR && rel <= RACING_Z_NEAR + RACING_Z_SPAN) out.push({ k, z: rel });
  }
  out.sort((a, b) => b.z - a.z);
  return out;
}

/** Stable non-negative identity gate for a marker key (seam-safe for k < 0). */
export function markerGate(k: number, n: number): number {
  return ((k % n) + n) % n;
}

/**
 * Speed-scaled steering display (pure, visual only): zero bank/lean/offset
 * while stopped, smooth progression at low pace, full effect at race pace.
 * Physics input smoothing (steerPos/steerVis) is untouched — only the
 * rendered transforms scale, so a parked craft never visibly turns.
 */
export function steerVisScale(speed: number): number {
  const t = Math.max(0, Math.min(1, Math.abs(speed) / 30));
  return t * t * (3 - 2 * t);
}

/**
 * Subtle dark panel behind overlay cards so text stays legible over busy
 * craft and road art. Flat rect (no rounded corners) for the Canvas2D budget.
 */
function cardPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = 'rgba(4,6,18,0.62)';
  ctx.fillRect(x, y, w, h);
}

function drawTrap(
  ctx: CanvasRenderingContext2D,
  cx0: number,
  cx1: number,
  h0: number,
  h1: number,
  y0: number,
  y1: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx0 - h0, y0);
  ctx.lineTo(cx1 - h1, y1);
  ctx.lineTo(cx1 + h1, y1);
  ctx.lineTo(cx0 + h0, y0);
  ctx.closePath();
  ctx.fill();
}

export type RacingCupPhase = 'title' | 'countdown' | 'race' | 'results' | 'cupEnd';

/** Read-only playtest snapshot for the DEV-only diagnostics panel. */
export interface RacingDevSnapshot {
  t: number;
  /** Measured render frames per second (render-timed, not fixed-update). */
  fps: number;
  countdown: number;
  over: boolean;
  autopilot: boolean;
  phase: RacingCupPhase;
  trackId: string;
  trackName: string;
  cup: {
    raceIndex: number;
    raceCount: number;
    points: number[];
    playerCupPlace: number;
    complete: boolean;
  };
  player: {
    /** Wrapped centerline distance [0, circuit length). */
    s: number;
    x: number;
    speed: number;
    lap: number;
    pos: number;
    boost: number;
    boostT: number;
    offroad: boolean;
    /** Smoothed steering position (-1..1) for handling playtests. */
    steerPos: number;
    /** True while drift/airbrake is actively held at speed. */
    drifting: boolean;
    /** Continuous engine voice active (read-only audio activity). */
    engineOn: boolean;
    /** Engine target pitch in Hz (0 while stopped). */
    enginePitchHz: number;
  };
  /** Read-only soundscape diagnostics. */
  audio?: { sources: number; rivals: RivalSound[] };
  /** Read-only personal-timing status (no setters; host verification only). */
  timing: {
    /** Versioned record key for this generated course. */
    key: string;
    /** Saved best flying lap, null until earned. */
    best: number | null;
    /** Live checkpoint delta text, null when none showing. */
    delta: string | null;
    /** Current attempt can still set a record. */
    eligible: boolean;
  };
  /** Read-only corner/rival feedback (no setters; host verification only). */
  feedback: {
    /** Next substantial bend: direction, severity, metres. */
    corner: { dir: 'L' | 'R'; sev: string; distM: number } | null;
    /** Nearest rival by progress: name, signed metres, side. */
    rival: { name: string; gapM: number; side: string } | null;
    /** Live position banner, null when none showing. */
    posEvent: string | null;
  };
  /** Read-only generated-art diagnostics (no setters; host verification only). */
  art: {
    /** Loader-activated pack in use (false = legacy procedural renderer). */
    pack: boolean;
    /** Cup race index the background/panorama was resolved for. */
    race: number;
    /** Player strip pose selected this frame. */
    pose: 'rear' | 'bankLeft' | 'bankRight';
    /** Boost supply mode of the current circuit. */
    mode: string;
  };
}

/**
 * DEV-only handle: read-only snapshot plus reset/autopilot controls for
 * host playtesting. Lives on the game object returned to the DEV-only
 * racing screen — never on window/global, never in production builds
 * (the screen itself is gated behind import.meta.env.DEV in app.tsx).
 */
export interface RacingDevHandle {
  racingDev: {
    snapshot(): RacingDevSnapshot;
    setAutopilot(on: boolean): void;
    reset(): void;
    /** Advance from results to the next circuit (same as the A button there). */
    advance(): void;
  };
}

/**
 * Number of cup circuits. Kept in sync with RACE_CIRCUITS by construction
 * (cupComplete defaults to RACE_CIRCUITS.length).
 */
export const CUP_RACE_COUNT = RACE_CIRCUITS.length;
/** 3-2-1-GO countdown length for cup races (seconds). */
export const CUP_COUNTDOWN = 3.0;

/**
 * Cup craft liveries from the spec palette (slots: 5-7 hero, 8+ enemies):
 * player hull on hero slot 6, rivals on enemy slots 8/9/10/12, all outlined
 * dark slot 1. Same index, same livery, every race. Falls back to the
 * authored defaults when no spec palette exists (DEV renderer-only).
 */
export function cupCraftColors(spec?: RacingSpec): { hulls: string[]; darks: string[] } {
  const pal = spec?.palette;
  if (!pal || pal.length < 16 || pal.some((c) => typeof c !== 'string')) {
    return { hulls: [...CRAFT_COLORS], darks: [...CRAFT_DARK] };
  }
  const dark = pal[1] ?? CRAFT_DARK[0]!;
  return {
    hulls: [
      pal[6] ?? CRAFT_COLORS[0]!,
      pal[8] ?? CRAFT_COLORS[1]!,
      pal[9] ?? CRAFT_COLORS[2]!,
      pal[10] ?? CRAFT_COLORS[3]!,
      pal[12] ?? CRAFT_COLORS[4]!,
    ],
    darks: [dark, dark, dark, dark, dark],
  };
}

type SfxPlay = { play(event: string, opts?: { gain?: number }): void };
type MusicPlay = { playSong(name: string): void; stopSong(): void };
interface StoryCard {
  title?: string;
  lines: string[];
  portrait?: unknown;
  artRole?: 'intro' | 'boss' | 'victory' | 'defeat';
  stage?: { index: number; total: number };
}
type CardsShow = { show(cards: StoryCard[]): void; readonly active: boolean };

/**
 * Truncate a display name to a hard column width (ASCII-safe: the bitmap
 * font has no ellipsis glyph, so long generated names are cut, never wrapped).
 */
export function truncateName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max) : name;
}

/** One cup race with its spec-resolved identity and music. */
export interface ResolvedCupRace {
  circuit: RaceCircuit;
  musicSong: string;
}

/**
 * Resolve the cup's races from a spec, or the built-in template defaults.
 * Every spec name/theme/pace parameter is applied to the returned circuits —
 * accepted-but-ignored parameters are a bug, not a default.
 */
export function resolveCupRaces(spec?: RacingSpec): ResolvedCupRace[] {
  if (!spec) {
    return RACE_CIRCUITS.map((circuit, i) => ({
      circuit,
      musicSong: i === RACE_CIRCUITS.length - 1 ? 'boss' : 'theme',
    }));
  }
  // Difficulty applies bounded rival pace (chill calms the field, spicy
  // sharpens it, never past player top speed); standard runs spec pace.
  const pace = spec.difficulty === 'chill' ? 0.92 : spec.difficulty === 'spicy' ? 1.03 : 1;
  // The cup's one primary boost supply (legacy pads when identity is
  // omitted). Exactly one source family survives per mode: pads keep their
  // compiled pads, pickups keep the compiled cell layout, none keeps
  // neither — the simulation gates triggers by this same mode.
  const mode = spec.identity?.boost.mode ?? 'pads';
  return spec.levels.map((level) => {
    const base = RACE_CIRCUITS.find((c) => c.id === level.template) ?? RACE_CIRCUITS[0]!;
    // Bounded geometry variation recompiles the template (same renderer and
    // physics: pads, gates, and timing all derive from the compiled track).
    const length = Math.min(3600, Math.max(2800, Math.round(level.length ?? base.track.length)));
    const template =
      length !== Math.round(base.track.length) || level.mirror === true
        ? compileTrackVariant(base.id, { length, mirror: level.mirror === true })
        : base;
    const circuit: RaceCircuit = {
      ...template,
      name: level.name,
      laps: level.laps,
      timeout: level.timeoutS ?? template.timeout,
      aiScales: [
        1,
        ...level.rivals.map(
          (r) => Math.round(Math.min(1, Math.max(0.7, r.topScale * pace)) * 1000) / 1000,
        ),
      ],
      names: ['YOU', ...level.rivals.map((r) => r.name)],
      theme: { ...template.theme, ...level.theme },
      craftShape: level.craftShape ?? template.craftShape,
      boostMode: mode,
      pads: mode === 'pads' ? template.pads : [],
      pickups: mode === 'pickups' ? template.pickups : [],
      materials: level.materials ?? template.materials,
    };
    return { circuit, musicSong: level.musicSong };
  });
}

/**
 * Stable per-generated-game identity for record keys: title plus the
 * server-assigned spec seed, delimiter-sanitized, so same-title courses
 * from distinct generations never share personal bests.
 */
export function gameIdentity(spec?: RacingSpec): string {
  const title = (spec?.meta.title ?? 'Ember Cup').replace(/\|/g, '~').trim().slice(0, 64);
  const seed = spec === undefined ? 0 : spec.seed;
  return `${title === '' ? 'Ember Cup' : title}~${Number.isFinite(seed) ? seed : 0}`;
}

export function createRacingGame(engine: EngineContext, spec?: RacingSpec): GameInstance {
  const ctx = engine.renderer.ctx;
  // Sound is an optional engine capability: the DEV harness only provides a
  // renderer, while GameHost supplies a full SfxSynth. Every call below is
  // guarded, so the cup runs silent-but-correct without one. Canonical
  // engine events used: uiMove (countdown tick), uiSelect (GO), pickup
  // (lap), powerup (race win), hit (barrier scrape), win/lose (cup).
  const sfx: SfxPlay | null =
    (engine as unknown as { sfx?: SfxPlay }).sfx !== undefined
      ? (engine as unknown as { sfx: SfxPlay }).sfx
      : null;
  function blip(event: string): void {
    try {
      sfx?.play(event);
    } catch {
      // Audio must never break the race.
    }
  }
  // Continuous hover hum: guarded like sfx (DEV harnesses have no audio),
  // and never in attract/library previews. Created lazily on the first
  // racing update; driven from update only, never from render.
  const hover = new RaceEngineAudio();
  if ((engine as unknown as { attract?: boolean }).attract !== true) {
    hover.attach((engine as unknown as { audio?: HoverEngineCaps }).audio ?? null);
    hover.setProfile(spec?.identity?.sound?.engine ?? null);
  }
  const cup: CupState = createCup();
  const cupRaces = resolveCupRaces(spec);
  const raceCount = cupRaces.length;
  const { hulls: craftHulls, darks: craftDarks } = cupCraftColors(spec);
  let race: RaceState = createRaceFor(cupRaces[0]!.circuit, CUP_COUNTDOWN);
  let phase: RacingCupPhase = 'title';
  /** Cup standings confirmed (A press): releases the final GameResult. */
  let confirmed = false;
  let classification: ClassifiedEntry[] = [];
  let resultsT = 0;
  let goT = 0;
  let lastCount = 0;
  let lastLap = 0;
  /** Player energy cells already chimed (lifetime counter mirror). */
  let lastCells = 0;
  let scrapeSfxT = 0;
  let steerVis = 0;
  /** Total cup elapsed (countdown + racing, never results/title): scores the time bonus. */
  let cupElapsed = 0;
  /** Cup elapsed when the current race started: restarts rewind to here. */
  let elapsedAtRaceStart = 0;
  // Attract/demo mode self-drives with the same neutral AI (no rubber-band);
  // the DEV toggle overrides this below. Guarded: renderer-only harnesses
  // and tests have no attract flag.
  let autopilot = (engine as unknown as { attract?: boolean }).attract === true;
  // Personal timing: best lap + checkpoint deltas per generated course.
  // Pure observation of gate/lap state — never touches physics or scoring.
  const timingBests = new PersonalBests(
    localStorageStore('sparkade.racing.pb.'),
    gameIdentity(spec),
  );
  const lapAttempt = new LapAttempt();
  let timingCourse = '';
  let timingKey = '';
  let timingBest: PersonalBest | null = null;
  let shownLap = 0;
  let shownCp = 0;
  let lastDelta: { text: string; ahead: boolean } | null = null;
  let deltaTtl = 0;
  let newBestTtl = 0;
  /** (Re)load this course's record; clears transient lap state, keeps PB. */
  function loadTiming(): void {
    timingCourse = `${race.circuit.id}#${cup.raceIndex}`;
    timingKey = timingBests.keyFor(timingCourse, race.circuit);
    timingBest = timingBests.get(timingCourse, race.circuit);
    lapAttempt.reset();
    shownLap = 0;
    shownCp = 0;
    lastDelta = null;
    deltaTtl = 0;
    newBestTtl = 0;
    // Precomputed once per course: bend regions plus rival/position reset.
    // The badge considers every bend (sweeps included); approach boards
    // only ever target substantial (SHARP/TIGHT) bends.
    warnBends = analyzeBends(race.circuit);
    warnSharp = warnBends.filter((b) => b.severity !== 'SWEEP');
    upcoming = null;
    upcomingBoards = null;
    rivalGap = null;
    posShown = null;
    posEventT = -1e9;
    posText = null;
    posEventPos = null;
  }
  let warnBends: Bend[] = [];
  let warnSharp: Bend[] = [];
  let upcoming: Upcoming | null = null;
  let upcomingBoards: Upcoming | null = null;
  let rivalGap: RivalGap | null = null;
  let posShown: number | null = null;
  let posEventT = -1e9;
  let posText: string | null = null;
  let posEventPos: number | null = null;
  /**
   * Boost meter cue shared by the canvas HUD and the host HUD hook: the
   * readiness label plus the cup's real supply state — cells left in
   * pickups mode, REGEN in none mode, the authored supply name in pads
   * mode (legacy no-identity cups keep the bare label).
   */
  function boostTag(): string | null {
    const mode = race.circuit.boostMode ?? 'pads';
    if (mode === 'pickups') return `${pickupsRemaining(race, PLAYER_INDEX)} LEFT`;
    if (mode === 'none') return 'REGEN';
    const name = (spec?.identity?.boost.displayName ?? '').trim().slice(0, 12).toUpperCase();
    return name === '' ? null : name;
  }
  function boostValue(burning: boolean, meter: number): string {
    const label = burning
      ? 'ACTIVE'
      : meter >= BOOST_COST
        ? 'READY'
        : `${Math.round(meter * 100)}%`;
    const tag = boostTag();
    return tag === null ? label : `${label} ${tag}`;
  }
  /** Guarded production music: one song per race from the spec. */
  function playRaceMusic(): void {
    try {
      (engine as unknown as { music?: MusicPlay }).music?.playSong(
        cupRaces[cup.raceIndex]?.musicSong ?? 'theme',
      );
    } catch {
      // Music must never break the race.
    }
  }
  // Render-measured FPS: EMA over actual render() intervals, so dropped
  // renderer frames show up (unlike 1/dt from the fixed update, which is
  // always 60 by construction). No globals — one EMA per game instance.
  let renderFps = 60;
  let lastRenderT = 0;
  // Reusable per-frame buffers: projection strips, rival slots, race inputs.
  const strips: Projected[] = Array.from({ length: SEGMENTS + 1 }, () => ({
    y: 0,
    cx: 0,
    half: 0,
    ppu: 0,
    z: 0,
  }));
  const rivalSlots: Array<{ rel: number; idx: number }> = Array.from(
    { length: RACER_COUNT - 1 },
    () => ({
      rel: 0,
      idx: 0,
    }),
  );
  // Generated-pack refs, refreshed when the cup race or bundle changes (never
  // allocated per frame). Null without a complete loader-activated pack.
  let artBundleSeen: unknown = null;
  let artRaceIndex = -1;
  let raceArt: RaceArtRefs | null = null;
  /** Derived band shades for the authored palette (refreshed with raceArt). */
  let paletteB: {
    groundB: [number, number, number];
    roadB: [number, number, number];
    curbB: [number, number, number];
  } | null = null;
  /** Authored base palette (refreshed with raceArt, never per frame). */
  let paletteCache: ReturnType<typeof authoredPalette> = null;
  /** Player pose selected this frame (readonly DEV/art diagnostic). */
  let lastPlayerPose: 'rear' | 'bankLeft' | 'bankRight' = 'rear';
  // Combined far-to-near sprite queue: 64 markers x 2 sides + cells + rivals
  // + player, preallocated once. Legacy path never touches it.
  const spriteQueue: ArtSprite[] = makeArtSpriteQueue(144);
  /** Effective tile world length with integer repeats (refreshed per race). */
  let tileWorldEff = ROAD_TILE_WORLD;
  /**
   * One integer screen row of a generated surface. U is anchored across the
   * row's own surface span (never an enclosing segment bbox) and V is the
   * physical world distance at that row, so texture motion follows the
   * inverse-depth projection and joins agree from either side. Source always
   * stays inside the quadrant (sh=1); dest is exactly (y, y+1].
   */
  function drawSurfaceRow(
    img: CanvasImageSource,
    quad: { sx: number; sy: number; size: number },
    atlasRow: number,
    sx: number,
    sw: number,
    dx: number,
    y: number,
    dw: number,
    alpha: number,
  ): void {
    if (!(dw > 0.01) || !(sw > 0) || quad.size <= 0) return;
    const sy = quad.sy + Math.max(0, Math.min(quad.size - 1, atlasRow));
    let ssx = sx;
    let ssw = sw;
    let ddx = dx;
    let ddw = dw;
    // Clip horizontally to the quadrant without shifting U phase: source and
    // dest shrink proportionally from the same edge.
    if (ssx < quad.sx) {
      const cut = (quad.sx - ssx) / ssw;
      ssx = quad.sx;
      ssw *= 1 - cut;
      ddx += ddw * cut;
      ddw *= 1 - cut;
    }
    const over = ssx + ssw - (quad.sx + quad.size);
    if (over > 0) {
      const cut = over / ssw;
      ssw -= over;
      ddw *= 1 - cut;
    }
    if (!(ddw > 0.01) || !(ssw > 0)) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, ssx, sy, ssw, 1, ddx, y, ddw, 1);
    ctx.globalAlpha = 1;
  }
  /** Reusable row geometry and ground-span array. */
  const groundSpans: GroundSpan[] = [];
  const surfaceRow = { cx: 0, half: 0, ppu: 0 };
  /**
   * Procedural ground effects under a generated vehicle: shadow always, plus
   * a throttle flame — full boost burn (2) or a subtle cruise flicker (1).
   * Drawn immediately at push time (ground plane); the sprite blit itself
   * joins the depth queue. Never obscures the art.
   */
  function drawStripShadow(
    cx: number,
    baseY: number,
    w: number,
    flame: 0 | 1 | 2,
    flick: number,
  ): void {
    if (w < 2) return;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY, w * 0.5, w * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    if (flame > 0) {
      const fl = flame === 2 ? w * (0.5 + 0.28 * flick) : w * 0.22;
      ctx.fillStyle = flame === 2 ? '#fff7c0' : 'rgba(255,247,192,0.55)';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.2, baseY - w * 0.32);
      ctx.lineTo(cx, baseY - w * 0.32 + fl);
      ctx.lineTo(cx + w * 0.2, baseY - w * 0.32);
      ctx.closePath();
      ctx.fill();
    }
  }
  const inputBuf: RacerInput[] = Array.from({ length: RACER_COUNT }, () => ({
    steer: 0,
    accel: false,
    brake: false,
    boost: false,
    drift: false,
  }));

  function playerInput(input: InputSnapshot, out: RacerInput): void {
    out.steer = (input.RIGHT.held ? 1 : 0) - (input.LEFT.held ? 1 : 0);
    out.accel = input.B.held;
    out.brake = input.Y.held;
    out.boost = input.A.pressed;
    out.drift = input.L.held || input.R.held;
  }

  /**
   * Rear-view hovercraft from locally authored original shapes: hover skirt,
   * twin side pods, tapered hull, canopy with glint, spine stripe, tail
   * light bar, and thruster pods. Boost adds a flame + trail particles.
   */
  function drawCraft(
    x: number,
    y: number,
    w: number,
    color: string,
    dark: string,
    tilt: number,
    boosting: boolean,
    engineGlow: boolean,
    shape: RacingCraftShape = 'twinpod',
    roll = 0,
    flick = 1,
  ): void {
    if (w < 2) return;
    // Banking roll around the craft center: lean into steered turns, harder
    // while drifting. One save/restore per craft, no allocation.
    ctx.save();
    if (roll !== 0) {
      ctx.translate(x, y);
      ctx.rotate(roll);
      ctx.translate(-x, -y);
    }
    const h = w * 0.44;
    // Authored silhouette variants: dart darts narrow, wedge runs wide aft.
    const rearW = shape === 'wedge' ? 0.5 : shape === 'dart' ? 0.34 : 0.42;
    const noseW = shape === 'dart' ? 0.16 : 0.3;
    // Hover shadow + skirt glow.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.44, w * 0.5, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = boosting ? 'rgba(255,247,192,0.5)' : 'rgba(53,224,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.36, w * 0.42, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Boost flame. Flicker is race-clock derived (frozen under pause).
    if (boosting) {
      const fw = w * 0.44;
      const fl = h * (0.9 + 0.5 * flick);
      ctx.fillStyle = '#fff7c0';
      ctx.beginPath();
      ctx.moveTo(x - fw / 2, y + h * 0.3);
      ctx.lineTo(x, y + h * 0.3 + fl);
      ctx.lineTo(x + fw / 2, y + h * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff9a2e';
      ctx.beginPath();
      ctx.moveTo(x - fw / 4, y + h * 0.3);
      ctx.lineTo(x, y + h * 0.3 + fl * 0.6);
      ctx.lineTo(x + fw / 4, y + h * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    // Twin side pods (dark) with light caps.
    ctx.fillStyle = dark;
    ctx.fillRect(x - w * 0.5 + tilt * 0.4, y - h * 0.1, w * 0.2, h * 0.5);
    ctx.fillRect(x + w * 0.3 + tilt * 0.4, y - h * 0.1, w * 0.2, h * 0.5);
    ctx.fillStyle = color;
    ctx.fillRect(x - w * 0.5 + tilt * 0.4, y - h * 0.1, w * 0.2, h * 0.1);
    ctx.fillRect(x + w * 0.3 + tilt * 0.4, y - h * 0.1, w * 0.2, h * 0.1);
    // Main hull: wide rear trapezoid tapering toward the nose.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w * rearW + tilt * 0.4, y + h * 0.4);
    ctx.lineTo(x - w * noseW + tilt, y - h * 0.4);
    ctx.lineTo(x + w * noseW + tilt, y - h * 0.4);
    ctx.lineTo(x + w * rearW + tilt * 0.4, y + h * 0.4);
    ctx.closePath();
    ctx.fill();
    // Hull side shading + spine stripe.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - w * rearW + tilt * 0.4, y + h * 0.1, w * 0.1, h * 0.3);
    ctx.fillRect(x + w * (rearW - 0.1) + tilt * 0.4, y + h * 0.1, w * 0.1, h * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x - w * 0.05 + tilt * 0.8, y - h * 0.4, w * 0.1, h * 0.5);
    // Cockpit canopy with glint.
    ctx.fillStyle = 'rgba(8,16,36,0.92)';
    ctx.beginPath();
    ctx.ellipse(x + tilt * 0.7, y - h * 0.12, w * 0.15, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,220,255,0.8)';
    ctx.fillRect(x - w * 0.08 + tilt * 0.7, y - h * 0.22, w * 0.16, h * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x - w * 0.08 + tilt * 0.7, y - h * 0.22, w * 0.05, h * 0.08);
    // Tail light bar + thruster pods glow at the rear.
    ctx.fillStyle = engineGlow ? '#ffffff' : '#ff5a5a';
    ctx.fillRect(x - w * 0.2, y + h * 0.28, w * 0.4, h * 0.07);
    ctx.fillStyle = engineGlow ? '#ffffff' : color;
    ctx.fillRect(x - w * 0.46 + tilt * 0.4, y + h * 0.22, w * 0.12, h * 0.16);
    ctx.fillRect(x + w * 0.34 + tilt * 0.4, y + h * 0.22, w * 0.12, h * 0.16);
    // Accel exhaust plume: small restrained glow behind the thrusters.
    if (engineGlow && !boosting) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x - w * 0.3, y + h * 0.3, w * 0.6, h * 0.1);
    }
    ctx.restore();
  }

  interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
  }
  const sparks: Spark[] = [];
  /** Seeded spark randomness: reseeded per race, advanced only while racing. */
  let sparkRand = mulberry32(0xc0ffee);
  /** Race clock at the last spark emission/step; frozen frames repeat output. */
  let lastSparkT = -1;

  function emitSparks(x: number, y: number, n: number, color: string, spread: number): void {
    for (let i = 0; i < n; i++) {
      if (sparks.length > 160) return;
      sparks.push({
        x,
        y,
        vx: (sparkRand() * 2 - 1) * spread,
        vy: -sparkRand() * spread * 0.9,
        life: 0.35 + sparkRand() * 0.25,
        color,
      });
    }
  }

  function stepSparks(dt: number): void {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vy += 2.2 * dt * 60;
    }
  }

  function drawSparks(): void {
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // Minimap outline follows the current race's circuit (recomputed per
  // render from the deterministic compiled geometry — no caching needed).
  function drawMinimap(): void {
    const outline = race.circuit.track.outline(120);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of outline) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const mw = 104;
    const mh = 64;
    const mx = W - mw - 8;
    const my = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    const sx = mw / Math.max(1, maxX - minX);
    const sy = mh / Math.max(1, maxY - minY);
    const sc = Math.min(sx, sy) * 0.92;
    const ox = mx + (mw - (maxX - minX) * sc) / 2 - minX * sc;
    const oy = my + (mh - (maxY - minY) * sc) / 2 - minY * sc;
    ctx.strokeStyle = '#8a93b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [i, pt] of outline.entries()) {
      const px = ox + pt.x * sc;
      const py = oy + pt.y * sc;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    const start = outline[0]!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox + start.x * sc - 2, oy + start.y * sc - 2, 4, 4);
    for (const [i, racer] of race.racers.entries()) {
      const p = race.circuit.track.pointAt(racer.s);
      ctx.fillStyle = craftHulls[i % craftHulls.length]!;
      const dx = ox + p.x * sc;
      const dy = oy + p.y * sc;
      if (i === PLAYER_INDEX) {
        ctx.fillRect(dx - 3, dy - 3, 6, 6);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(dx - 3.5, dy - 3.5, 7, 7);
      } else {
        ctx.fillRect(dx - 2, dy - 2, 4, 4);
      }
    }
  }

  function fmtTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  /**
   * Top HUD bar: bounded left columns plus a right-aligned speed/points
   * block, so long generated names can never clip past the logical width.
   */
  function drawHud(): void {
    const circuit = race.circuit;
    const player = race.racers[PLAYER_INDEX]!;
    const pos = racePosition(race, PLAYER_INDEX);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(
      `R${displayRaceNumber()}/${raceCount} ${truncateName(circuit.name.toUpperCase(), 14)}`,
      8,
      6,
    );
    ctx.fillText(`LAP ${Math.min(player.lap + 1, circuit.laps)}/${circuit.laps}`, 168, 6);
    ctx.fillStyle = pos === 1 ? '#ffd94d' : '#ffffff';
    ctx.fillText(`POS ${pos}/${RACER_COUNT}`, 232, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`TIME ${fmtTime(race.t)}`, 292, 6);
    const kmh = Math.round(Math.abs(player.speed) * 2.4);
    ctx.textAlign = 'right';
    ctx.fillText(`${kmh} KM/H`, W - 76, 6);
    ctx.fillStyle = '#aee9f1';
    ctx.fillText(`PTS ${cup.points[PLAYER_INDEX] ?? 0}`, W - 8, 6);
    ctx.textAlign = 'left';
  }

  function render(): void {
    // Render-timed FPS: measured here, once per presented frame.
    const nowT = performance.now();
    if (lastRenderT > 0) {
      const dtMs = nowT - lastRenderT;
      // Clamp the instantaneous sample: tight probe loops otherwise report
      // thousands of fps, and hidden-tab stalls report ~0.
      if (dtMs > 0) renderFps += (Math.min(120, 1000 / dtMs) - renderFps) * 0.05;
    }
    lastRenderT = nowT;

    const circuit = race.circuit;
    const theme = circuit.theme;
    const player = race.racers[PLAYER_INDEX]!;
    // Generated pack refs refresh only on race/bundle change — never per frame.
    const bundle = (engine as unknown as { racingArt?: unknown }).racingArt as
      import('@sparkade/engine').RacingArtBundle | null | undefined;
    // Cup scoring advances the index before the results screen. Keep the
    // completed course's artwork until the next race actually starts.
    const visibleRaceIndex = Math.max(0, displayRaceNumber() - 1);
    if (artBundleSeen !== bundle || artRaceIndex !== visibleRaceIndex) {
      artBundleSeen = bundle;
      artRaceIndex = visibleRaceIndex;
      raceArt = resolveRaceArt(bundle ?? null, visibleRaceIndex);
      paletteCache = raceArt ? authoredPalette(circuit.materials) : null;
      tileWorldEff = fitTileWorld(circuit.track.length);
      const pal = paletteCache;
      paletteB = pal
        ? {
            groundB: scaleRgb(pal.ground, 0.9),
            roadB: scaleRgb(pal.road, 0.9),
            curbB: scaleRgb(pal.curb, 0.85),
          }
        : null;
    }
    const art = raceArt;
    const palette = paletteCache;
    const heading = circuit.track.headingAt(player.s);
    if (art !== null) {
      // Generated panorama fully replaces the generic skyline: a 2x
      // supersampled band sliding with heading (smooth periodic parallax,
      // wrap- and seam-safe by construction in panoramaSourceX).
      const srcX = panoramaSourceX(heading, panoramaMaxOffset());
      ctx.drawImage(
        art.panorama,
        srcX,
        PANORAMA_SOURCE_Y,
        PANORAMA_SOURCE_WIDTH,
        PANORAMA_SOURCE_HEIGHT,
        0,
        0,
        W,
        HORIZON,
      );
    } else {
      // Sky from the circuit theme.
      const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, theme.skyTop);
      sky.addColorStop(1, theme.skyBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, HORIZON);
      // Sun + parallax ridge keyed to heading so turning feels real.
      const pan = heading * 60;
      ctx.fillStyle = theme.sun;
      ctx.beginPath();
      ctx.arc(W / 2 - (pan % W), 58, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.sun;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(W / 2 - (pan % W), 58, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.ridgeFar;
      ctx.beginPath();
      ctx.moveTo(0, HORIZON);
      for (let x = 0; x <= W; x += 16) {
        ctx.lineTo(x, HORIZON - 16 - 12 * Math.sin((x + pan * 2) * 0.02));
      }
      ctx.lineTo(W, HORIZON);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.ridgeNear;
      ctx.beginPath();
      ctx.moveTo(0, HORIZON);
      for (let x = 0; x <= W; x += 32) {
        ctx.lineTo(x, HORIZON - 6 - 6 * Math.sin((x + pan * 3.1) * 0.03 + 2));
      }
      ctx.lineTo(W, HORIZON);
      ctx.closePath();
      ctx.fill();
    }
    // Ground base: authored ground hex on the pack path, theme otherwise.
    // (Ground texture is sampled per strip inside the road loop so it
    // scrolls with world travel like every other surface.)
    ctx.fillStyle = palette ? shade(palette.ground, 1) : theme.ground;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);

    projectRoad(player.s, player.x, strips, circuit.track);
    const camS = player.s - RACING_CAM_BACK;
    const camW = circuit.track.wrap(camS);
    const grassA: [number, number, number] = [62, 96, 48];
    const grassB: [number, number, number] = [54, 86, 42];
    const roadA = theme.roadA;
    const roadB = theme.roadB;
    // Authored base colors replace every hardcoded grass/curb paint on the
    // pack path; the legacy path keeps its exact theme colors.
    const gA = palette ? palette.ground : grassA;
    const gB = palette && paletteB ? paletteB.groundB : grassB;
    const rA = palette ? palette.road : roadA;
    const rB = palette && paletteB ? paletteB.roadB : roadB;
    const cA = palette ? palette.curb : ([200, 60, 60] as [number, number, number]);
    const cB = palette && paletteB ? paletteB.curbB : ([235, 235, 230] as [number, number, number]);
    if (art === null) {
      for (let i = SEGMENTS; i >= 1; i--) {
        const near = strips[i - 1]!;
        const far = strips[i]!;
        const band = Math.floor((camS + far.z) / SEG_LEN) % 2 === 0;
        // Grass slice (authored ground hex on the pack path).
        ctx.fillStyle = shade(band ? gA : gB, 0.4 + 0.6 * (1 - i / SEGMENTS));
        ctx.fillRect(0, far.y, W, near.y - far.y + 1);
        const ws = camS + far.z;
        // Rumble: authored curb contrast on the pack path, legacy red/white.
        const rum = palette
          ? shade(band ? cA : cB, 0.5 + 0.5 * (1 - i / SEGMENTS))
          : Math.floor(ws / SEG_LEN) % 2 === 0
            ? '#c33'
            : '#ddd';
        ctx.fillStyle = rum;
        drawTrap(ctx, near.cx, far.cx, near.half * 1.18, far.half * 1.18, near.y, far.y);
        // Shoulder: dark band between rumble and curb; the offroad onset
        // lives past the curb paint (|x| > ROAD_HALF + CURB_WIDTH).
        const dim = 0.45 + 0.55 * (1 - i / SEGMENTS);
        ctx.fillStyle = shade(band ? rA : rB, dim * 0.42);
        drawTrap(ctx, near.cx, far.cx, near.half * 1.08, far.half * 1.08, near.y, far.y);
        // Curb/apron: band just past the asphalt matching the forgiving
        // physics curb exactly (no penalty inside it), alternating per band.
        const curbW = (ROAD_HALF + CURB_WIDTH) / ROAD_HALF;
        if (palette) {
          ctx.fillStyle = shade(band ? cA : cB, dim);
        } else {
          ctx.fillStyle = band
            ? `rgba(200,60,60,${0.55 * dim})`
            : `rgba(235,235,230,${0.55 * dim})`;
        }
        drawTrap(ctx, near.cx, far.cx, near.half * curbW, far.half * curbW, near.y, far.y);
        // Asphalt.
        ctx.fillStyle = shade(band ? rA : rB, dim);
        drawTrap(ctx, near.cx, far.cx, near.half, far.half, near.y, far.y);
        // Crisp edge lines: safety white on the legacy path (generated
        // surfaces render in the pack branch above). Two narrow bands riding
        // the asphalt edges — never an expanded filled road (that repainted
        // the asphalt). Always paints after surfaces.
        ctx.fillStyle = palette
          ? withAlpha(palette.edge, 0.85 * dim)
          : `rgba(240,240,235,${0.85 * dim})`;
        for (const edgeSide of [-1, 1]) {
          drawTrap(
            ctx,
            near.cx + edgeSide * near.half,
            far.cx + edgeSide * far.half,
            Math.max(1, near.half * 0.03),
            Math.max(1, far.half * 0.03),
            near.y,
            far.y,
          );
        }
        // Edge glow line in the circuit accent color.
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.35 * dim;
        for (const side of [-1, 1]) {
          drawTrap(
            ctx,
            near.cx + side * near.half,
            far.cx + side * far.half,
            near.half * 0.04,
            far.half * 0.04,
            near.y,
            far.y,
          );
        }
        ctx.globalAlpha = 1;
        // Center dashes.
        if (Math.floor(ws / SEG_LEN) % 4 < 2) {
          ctx.fillStyle = `rgba(240,240,220,${0.7 * dim})`;
          drawTrap(ctx, near.cx, far.cx, near.half * 0.035 + 0.5, far.half * 0.035, near.y, far.y);
        }
        // Boost pad overlay: same lane fraction the physics trigger uses, with
        // white lane rails and a forward chevron every fourth strip.
        if (padAtCircuit(circuit, ws)) {
          {
            ctx.fillStyle = theme.accent;
            ctx.globalAlpha = 0.5 * dim + 0.2;
            drawTrap(
              ctx,
              near.cx,
              far.cx,
              near.half * PAD_LANE_FRAC,
              far.half * PAD_LANE_FRAC,
              near.y,
              far.y,
            );
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = `rgba(255,255,255,${0.6 * dim})`;
          drawTrap(ctx, near.cx, far.cx, near.half * 0.14, far.half * 0.14, near.y, far.y);
          if (Math.floor(ws / SEG_LEN) % 4 === 0) {
            const cw = far.half * PAD_LANE_FRAC * 0.55;
            ctx.fillStyle = `rgba(255,255,255,${0.85 * dim})`;
            ctx.beginPath();
            ctx.moveTo(far.cx - cw, far.y);
            ctx.lineTo(far.cx + cw, far.y);
            ctx.lineTo(near.cx, near.y);
            ctx.closePath();
            ctx.fill();
          }
        }
        // Start/finish checker.
        const w0 = circuit.track.wrap(ws - SEG_LEN);
        const w1 = circuit.track.wrap(ws);
        if (w0 > w1) {
          ctx.fillStyle = `rgba(255,255,255,${0.85 * dim})`;
          drawTrap(ctx, near.cx, far.cx, near.half, far.half, near.y, (near.y + far.y) / 2);
          ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`;
          for (let k = -4; k < 4; k++) {
            const f = k / 4;
            drawTrap(
              ctx,
              near.cx + near.half * f,
              far.cx + far.half * f,
              near.half * 0.12,
              far.half * 0.12,
              near.y,
              (near.y + far.y) / 2,
            );
          }
        }
        // Checkpoint gate banners: posts + accent banner across the road at
        // each quarter gate, so lap progress reads as approaching landmarks.
        // Interpolated within the strip from the same projection — no new depth.
        if (far.half > 4) {
          const len = circuit.track.length;
          const camW = circuit.track.wrap(camS);
          for (let gi = 0; gi < CHECKPOINT_FRACTIONS.length; gi++) {
            const gateW = CHECKPOINT_FRACTIONS[gi]! * len;
            let rel = (gateW - camW) % len;
            if (rel < 0) rel += len;
            const nearZ = strips[i - 1]!.z;
            const farZ = strips[i]!.z;
            if (rel >= nearZ && rel < farZ) {
              const ft = (rel - nearZ) / Math.max(1e-6, farZ - nearZ);
              const gx = near.cx + (far.cx - near.cx) * ft;
              const gy = near.y + (far.y - near.y) * ft;
              const gh = Math.max(2, far.half * 0.5);
              ctx.fillStyle = '#f2f4ff';
              ctx.fillRect(gx - far.half * 1.35 - 1, gy - gh, 2, gh);
              ctx.fillRect(gx + far.half * 1.35 - 1, gy - gh, 2, gh);
              ctx.fillStyle = theme.accent;
              ctx.fillRect(
                gx - far.half * 1.35 - 1,
                gy - gh,
                far.half * 2.7 + 2,
                Math.max(1.5, gh * 0.22),
              );
              break;
            }
          }
        }
      }
    } else {
      // Generated surfaces: bounded integer-row projection. Every logical row
      // y in [HORIZON, H) maps through the inverse-depth law
      // z = CAM_H*FOCAL/(yc-HORIZON) to a world distance (worldS = camS + z),
      // and lateral center/width interpolate the same strip buffer the sprites
      // use — so texture V/U, lighting, and markings are pure functions of the
      // row. Neighboring rows always agree (no joins to mismatch), and
      // dashes/pads/checkers evaluated per row never snap at camera-fixed
      // segment edges. Base fills are smooth and opaque (no band alternation
      // bleeding through the semitransparent texture), and every source rect
      // stays inside its atlas quadrant with sh=1 and dest (y, y+1].
      const zFarMax = RACING_Z_NEAR + RACING_Z_SPAN;
      const gq = materialTileRect('ground');
      const cq = materialTileRect('curb');
      const rq = materialTileRect('road');
      const bq = materialTileRect('boost');
      const mats = art.materials;
      const curbW = (ROAD_HALF + CURB_WIDTH) / ROAD_HALF;
      const yTop = Math.ceil(strips[SEGMENTS]!.y - 0.5);
      for (let y = yTop; y < H; y++) {
        const zRaw = perspectiveZ(y + 0.5, HORIZON, RACING_CAM_H, RACING_FOCAL);
        const z = Math.max(RACING_Z_NEAR, Math.min(zFarMax, zRaw));
        const sRow = camS + z;
        const wrapped = circuit.track.wrap(sRow);
        const row = sampleStripRow(strips, z, RACING_Z_NEAR, RACING_Z_SPAN, surfaceRow);
        if (row === null) continue;
        const depthF = Math.max(0, Math.min(1, 1 - (z - RACING_Z_NEAR) / RACING_Z_SPAN));
        const dim = depthShade(z, RACING_Z_NEAR, RACING_Z_SPAN);
        const half = row.half;
        const cx = row.cx;
        // Ground base (smooth, opaque) plus world-anchored ground texture: U
        // follows world lateral distance, so the ground scrolls with travel
        // and bends with the road instead of sitting screen-fixed.
        ctx.fillStyle = shade(gA, 0.4 + 0.6 * depthF);
        ctx.fillRect(0, y, W, 1);
        if (tileWorldEff > 0) {
          const atlasRow = rowAtlasRow(wrapped, tileWorldEff, gq.size);
          const spans = groundSourceSpans(
            0,
            W,
            cx,
            row.ppu,
            tileWorldEff,
            gq.sx,
            gq.size,
            groundSpans,
          );
          ctx.globalAlpha = 0.5 * dim;
          for (let gi = 0; gi < spans.length; gi++) {
            const sp = spans[gi]!;
            ctx.drawImage(mats, sp.sx, gq.sy + atlasRow, sp.sw, 1, sp.dx, y, sp.dw, 1);
          }
          ctx.globalAlpha = 1;
        }
        // Rumble ring between ground and curb (smooth authored contrast).
        const rumL0 = cx - half * 1.18;
        const rumL1 = cx - half * curbW;
        const rumR0 = cx + half * curbW;
        const rumR1 = cx + half * 1.18;
        if (rumL1 - rumL0 >= 1 || rumR1 - rumR0 >= 1) {
          ctx.fillStyle = shade(cA, 0.5 + 0.5 * depthF);
          if (rumL1 - rumL0 >= 1) ctx.fillRect(rumL0, y, rumL1 - rumL0, 1);
          if (rumR1 - rumR0 >= 1) ctx.fillRect(rumR0, y, rumR1 - rumR0, 1);
        }
        // Curb base plus texture per side, U anchored across each side's own
        // span (never an enclosing bbox).
        const curbHalf = (half * (curbW - 1)) / 2;
        if (curbHalf >= 0.5 && tileWorldEff > 0) {
          ctx.fillStyle = shade(cA, dim);
          const curbRow = rowAtlasRow(wrapped, tileWorldEff, cq.size);
          for (const side of [-1, 1]) {
            const ccx = cx + (side * half * (1 + curbW)) / 2;
            ctx.fillRect(ccx - curbHalf, y, curbHalf * 2, 1);
            drawSurfaceRow(
              mats,
              cq,
              curbRow,
              cq.sx,
              cq.size,
              ccx - curbHalf,
              y,
              curbHalf * 2,
              0.5 * dim,
            );
          }
        }
        // Asphalt base plus texture, U anchored across this row's own span.
        ctx.fillStyle = shade(rA, dim);
        ctx.fillRect(cx - half, y, half * 2, 1);
        if (tileWorldEff > 0) {
          drawSurfaceRow(
            mats,
            rq,
            rowAtlasRow(wrapped, tileWorldEff, rq.size),
            rq.sx,
            rq.size,
            cx - half,
            y,
            half * 2,
            0.55 * dim,
          );
        }
        // Boost pad overlay, evaluated per row from the world position.
        const onPad = padAtCircuit(circuit, wrapped);
        if (onPad && tileWorldEff > 0) {
          drawSurfaceRow(
            mats,
            bq,
            rowAtlasRow(wrapped, tileWorldEff, bq.size),
            bq.sx,
            bq.size,
            cx - half * PAD_LANE_FRAC,
            y,
            half * PAD_LANE_FRAC * 2,
            0.5 * dim + 0.35,
          );
        }
        // Crisp edge lines over every texture: authored edge hex on the pack
        // path, safety white otherwise. Always paints after surfaces.
        ctx.fillStyle = palette
          ? withAlpha(palette.edge, 0.85 * dim)
          : `rgba(240,240,235,${0.85 * dim})`;
        const edgeW = Math.max(1, half * 0.03);
        ctx.fillRect(cx - half - edgeW / 2, y, edgeW, 1);
        ctx.fillRect(cx + half - edgeW / 2, y, edgeW, 1);
        const glowW = half * 0.04;
        if (glowW >= 1) {
          ctx.globalAlpha = 0.35 * dim;
          ctx.fillStyle = theme.accent;
          ctx.fillRect(cx - half - glowW / 2, y, glowW, 1);
          ctx.fillRect(cx + half - glowW / 2, y, glowW, 1);
          ctx.globalAlpha = 1;
        }
        // Center dashes: world-anchored phase from the row's own distance, so
        // dash boundaries never snap when they pass a segment edge.
        if (Math.floor(sRow / SEG_LEN) % 4 < 2) {
          ctx.fillStyle = `rgba(240,240,220,${0.7 * dim})`;
          const dashW = half * 0.035 + 0.5;
          ctx.fillRect(cx - dashW, y, dashW * 2, 1);
        }
        if (onPad) {
          ctx.fillStyle = `rgba(255,255,255,${0.6 * dim})`;
          ctx.fillRect(cx - half * 0.14, y, half * 0.28, 1);
          if (Math.floor(sRow / SEG_LEN) % 4 === 0) {
            ctx.fillStyle = `rgba(255,255,255,${0.85 * dim})`;
            ctx.fillRect(cx - half * PAD_LANE_FRAC * 0.55, y, half * PAD_LANE_FRAC * 1.1, 1);
          }
        }
        // Start/finish checker: world-anchored band just past the seam.
        if (wrapped < SEG_LEN) {
          ctx.fillStyle = `rgba(255,255,255,${0.85 * dim})`;
          ctx.fillRect(cx - half, y, half * 2, 1);
          ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`;
          for (let k = -4; k < 4; k++) {
            const f = k / 4;
            ctx.fillRect(cx + half * f - half * 0.12, y, half * 0.24, 1);
          }
        }
      }
      // Checkpoint gate banners project through the same strip buffer from
      // their world-anchored gate positions — never snapped to a segment.
      const packLen = circuit.track.length;
      const packCamW = circuit.track.wrap(camS);
      for (let gi = 0; gi < CHECKPOINT_FRACTIONS.length; gi++) {
        const gateW = CHECKPOINT_FRACTIONS[gi]! * packLen;
        let rel = (gateW - packCamW) % packLen;
        if (rel < 0) rel += packLen;
        const proj = projectAtZ(strips, rel);
        if (proj === null || proj.half <= 4) continue;
        const gh = Math.max(2, proj.half * 0.5);
        ctx.fillStyle = '#f2f4ff';
        ctx.fillRect(proj.cx - proj.half * 1.35 - 1, proj.y - gh, 2, gh);
        ctx.fillRect(proj.cx + proj.half * 1.35 - 1, proj.y - gh, 2, gh);
        ctx.fillStyle = theme.accent;
        ctx.fillRect(
          proj.cx - proj.half * 1.35 - 1,
          proj.y - gh,
          proj.half * 2.7 + 2,
          Math.max(1.5, gh * 0.22),
        );
      }
    }

    // World-anchored markers: scenery, ground arrows, and turn boards at
    // fixed circuit positions (worldMarkerSlots, far-to-near), each
    // interpolated through the same strip buffer as the road — never snapped
    // to a screen strip. Depth fade mirrors the strip loop's distance dim.
    const markerDim = (z: number): number => {
      const f = (z - RACING_Z_NEAR) / RACING_Z_SPAN;
      return 0.45 + 0.55 * Math.max(0, Math.min(1, 1 - f));
    };
    const trackLen = circuit.track.length;
    // Combined depth queue cursor: scenery, pickups, and rivals sort
    // far-to-near below, so nearer sprites always overdraw farther ones
    // regardless of pass ordering. Legacy path draws immediately as before.
    let spriteCount = 0;
    const pushSprite = (
      z: number,
      order: number,
      img: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
      alpha: number,
    ): void => {
      if (spriteCount >= spriteQueue.length) return;
      const e = spriteQueue[spriteCount]!;
      e.z = z;
      e.order = order;
      e.img = img;
      e.sx = sx;
      e.sy = sy;
      e.sw = sw;
      e.sh = sh;
      e.dx = dx;
      e.dy = dy;
      e.dw = dw;
      e.dh = dh;
      e.alpha = alpha;
      spriteCount++;
    };
    for (const m of worldMarkerSlots(camS, trackLen, RACING_SCENERY_COUNT)) {
      const proj = projectAtZ(strips, m.z);
      if (proj === null || proj.half <= 4) continue;
      const postH = proj.half * 0.5;
      const postW = Math.max(1, proj.half * 0.05);
      const lx = proj.cx - proj.half * 1.3;
      const rx = proj.cx + proj.half * 1.3;
      if (art !== null) {
        // Atlas roadside from stable marker identity: the slot (and therefore
        // the size class) never changes as the marker approaches — only
        // perspective scales it. Landmarks stand off the road with real
        // setback so their width cannot cover the asphalt; dressing hugs the
        // verges. The boost slot never decorates; pickups own the road.
        const slot = scenerySlotFor(m.k);
        const cell = sceneryAtlasCell(slot);
        const landmark = isLandmarkSlot(slot);
        const h = proj.half * (landmark ? 2.6 : 1.2);
        const w = Math.min(proj.half * (landmark ? 3.2 : 1.6), h);
        const off = proj.half * (landmark ? 2.4 : 1.7);
        const dimA = markerDim(m.z);
        pushSprite(
          m.z,
          m.k * 2,
          art.scenery,
          cell.sx,
          cell.sy,
          cell.size,
          cell.size,
          proj.cx - off - w / 2,
          proj.y - h,
          w,
          h,
          dimA,
        );
        pushSprite(
          m.z,
          m.k * 2 + 1,
          art.scenery,
          cell.sx,
          cell.sy,
          cell.size,
          cell.size,
          proj.cx + off - w / 2,
          proj.y - h,
          w,
          h,
          dimA,
        );
        continue;
      }
      const alt = markerGate(m.k, 6) === 0;
      if (theme.scenery === 'pines') {
        ctx.fillStyle = '#1d5a2e';
        for (const px of [lx, rx]) {
          ctx.beginPath();
          ctx.moveTo(px, proj.y - postH * 1.6);
          ctx.lineTo(px - postW * 3, proj.y);
          ctx.lineTo(px + postW * 3, proj.y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#4a2f1d';
        ctx.fillRect(lx - postW / 2, proj.y - postH * 0.5, postW, postH * 0.5);
        ctx.fillRect(rx - postW / 2, proj.y - postH * 0.5, postW, postH * 0.5);
      } else if (theme.scenery === 'crystals') {
        ctx.fillStyle = alt ? theme.accent : '#b07dff';
        for (const px of [lx, rx]) {
          ctx.beginPath();
          ctx.moveTo(px, proj.y - postH * 1.4);
          ctx.lineTo(px - postW * 2, proj.y - postH * 0.3);
          ctx.lineTo(px, proj.y);
          ctx.lineTo(px + postW * 2, proj.y - postH * 0.3);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Ember posts carry accent pennants (existing theme accent data —
        // no new assets) so the home circuit reads distinct at a glance.
        ctx.fillStyle = alt ? theme.accent : '#ff4fd8';
        ctx.fillRect(lx - postW / 2, proj.y - postH, postW, postH);
        ctx.fillRect(rx - postW / 2, proj.y - postH, postW, postH);
        if (proj.half > 8) {
          ctx.fillStyle = theme.accent;
          for (const px of [lx, rx]) {
            ctx.beginPath();
            ctx.moveTo(px + postW / 2, proj.y - postH);
            ctx.lineTo(px + postW / 2 + postW * 4, proj.y - postH * 0.8);
            ctx.lineTo(px + postW / 2, proj.y - postH * 0.6);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }
    for (const m of worldMarkerSlots(camS, trackLen, RACING_ARROW_COUNT)) {
      const proj = projectAtZ(strips, m.z);
      if (proj === null) continue;
      const dim = markerDim(m.z);
      const ms = circuit.track.wrap((m.k * trackLen) / RACING_ARROW_COUNT);
      // Ground direction arrow ahead of bends: painted on the surface at the
      // cue direction (single source with the turn boards, mirror-safe).
      // One slot in three carries paint; turn boards take a disjoint gate.
      if (markerGate(m.k, 3) === 1 && proj.half > 5) {
        const cue = turnCueAt(circuit.track, ms);
        if (cue !== 0) {
          const ax = proj.cx + cue * proj.half * 0.45;
          const aw = proj.half * 0.28;
          const ah = proj.half * 0.35;
          ctx.fillStyle = theme.accent;
          ctx.globalAlpha = 0.8 * dim;
          ctx.beginPath();
          ctx.moveTo(ax - aw * 0.4, proj.y);
          ctx.lineTo(ax + aw * 0.6 * cue, proj.y + ah * 0.5);
          ctx.lineTo(ax - aw * 0.4, proj.y + ah);
          ctx.lineTo(ax - aw * 0.1, proj.y + ah * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // Turn boards: a dark backplate with a direction chevron ahead of
      // sharp bends so corners read early. Same turnCueAt source as the
      // ground arrows, so boards and paint agree on every bend, mirrored too.
      if (markerGate(m.k, 6) === 3 && proj.half > 6) {
        const side = turnCueAt(circuit.track, ms);
        if (side !== 0) {
          const bh = Math.min(28, proj.half * 0.55);
          const bw = bh * 0.9;
          const bx = proj.cx + side * proj.half * 1.5;
          const by = proj.y - bh * 1.1;
          ctx.fillStyle = 'rgba(6,8,20,0.78)';
          ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.moveTo(bx - side * bw * 0.28, by - bh * 0.3);
          ctx.lineTo(bx + side * bw * 0.28, by);
          ctx.lineTo(bx - side * bw * 0.28, by + bh * 0.3);
          ctx.lineTo(bx - side * bw * 0.02, by + bh * 0.3);
          ctx.lineTo(bx + side * bw * 0.5, by);
          ctx.lineTo(bx - side * bw * 0.02, by - bh * 0.3);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Corner approach boards: world-anchored countdown boards at fixed
    // offsets before each substantial (SHARP/TIGHT) bend start, chevrons
    // growing with proximity. Same projection as all world art.
    if (phase === 'race' && upcomingBoards !== null) {
      const spots = boardsFor(upcomingBoards.bend.start, trackLen);
      for (let bi = 0; bi < spots.length; bi++) {
        let rel = (spots[bi]! - camW) % trackLen;
        if (rel < 0) rel += trackLen;
        const proj = projectAtZ(strips, rel);
        if (proj === null || proj.half <= 6) continue;
        const chevrons = boardChevrons(bi);
        const bdir = upcomingBoards.bend.dir;
        const bh = Math.min(30, proj.half * 0.6);
        const bw = bh * (0.6 + 0.35 * chevrons);
        const bx = proj.cx + bdir * proj.half * 1.5;
        const by = proj.y - bh * 1.1;
        ctx.fillStyle = 'rgba(6,8,20,0.78)';
        ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
        ctx.fillStyle = theme.accent;
        for (let c = 0; c < chevrons; c++) {
          const cxp = bx + bdir * (c - (chevrons - 1) / 2) * bw * 0.28;
          ctx.beginPath();
          ctx.moveTo(cxp - bdir * bw * 0.1, by - bh * 0.3);
          ctx.lineTo(cxp + bdir * bw * 0.1, by);
          ctx.lineTo(cxp - bdir * bw * 0.1, by + bh * 0.3);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Banked-energy cells drawn only while bankable for the PLAYER this lap
    // — taken cells vanish, so the road shows real availability. Generated
    // pack shows the themed atlas boost slot; legacy keeps the diamond.
    if ((circuit.boostMode ?? 'pads') === 'pickups') {
      const cells = circuit.pickups ?? [];
      for (let pi = 0; pi < cells.length; pi++) {
        if (isPickupTaken(race, PLAYER_INDEX, pi)) continue;
        const cell = cells[pi]!;
        let rel = (circuit.track.wrap(cell.s) - camW) % trackLen;
        if (rel < 0) rel += trackLen;
        const proj = projectAtZ(strips, rel);
        if (proj === null || proj.half <= 4) continue;
        const cx = proj.cx + cell.x * proj.ppu;
        if (art !== null) {
          const boost = sceneryAtlasCell('boost');
          const bw = Math.min(22, proj.half * 0.9);
          const flick = 0.75 + 0.25 * visHash(Math.floor(race.t * 3) * 1.7 + pi);
          pushSprite(
            rel,
            1000 + pi,
            art.scenery,
            boost.sx,
            boost.sy,
            boost.size,
            boost.size,
            cx - bw / 2,
            proj.y - bw * 0.9,
            bw,
            bw,
            flick,
          );
          continue;
        }
        const cw = Math.min(14, proj.half * 0.3);
        const flick = 0.75 + 0.25 * visHash(Math.floor(race.t * 3) * 1.7 + pi);
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.9 * flick;
        ctx.beginPath();
        ctx.moveTo(cx, proj.y - cw);
        ctx.lineTo(cx + cw * 0.62, proj.y);
        ctx.lineTo(cx, proj.y + cw);
        ctx.lineTo(cx - cw * 0.62, proj.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 1, proj.y - 1, 2, 2);
      }
    }

    // Rivals at camera-relative depth. Generated pack queues strip sprites
    // into the combined far-to-near queue; legacy draws immediately as before.
    // Signed gaps keep slightly-behind rivals visible instead of clipping
    // them below the screen; projectAtZ culls anything outside the strips.
    let rivalCount = 0;
    for (let i = 0; i < race.racers.length; i++) {
      if (i === PLAYER_INDEX) continue;
      const r = race.racers[i]!;
      const rel = signedGap(circuit.track, r.s, player.s);
      const z = RACING_CAM_BACK + rel;
      if (z < RACING_Z_NEAR || z > RACING_Z_NEAR + RACING_Z_SPAN) continue;
      if (art !== null) {
        const proj = projectAtZ(strips, z);
        if (proj === null) continue;
        const cx = proj.cx + r.x * proj.ppu;
        const w = Math.max(4, CRAFT_WORLD_W * proj.ppu);
        const pose = selectCraftPose(r.steerPos * steerVisScale(r.speed), r.speed);
        // Body fill compensation: the keyed body spans ~52/64 of its cell,
        // so the blit is widened to restore the true physical world width.
        const bw = w / STRIP_BODY_FILL;
        drawStripShadow(
          cx,
          proj.y - w * 0.075,
          w,
          exhaustFlame(r.speed, r.boostT),
          visHash(race.t * 3 + i),
        );
        pushSprite(
          z,
          2000 + i,
          art.strips[i]!,
          craftPoseSourceX(pose),
          0,
          64,
          64,
          cx - bw / 2,
          proj.y - w * 0.075 - bw,
          bw,
          bw,
          1,
        );
        continue;
      }
      const slot = rivalSlots[rivalCount]!;
      slot.rel = rel;
      slot.idx = i;
      rivalCount++;
    }
    if (art === null) {
      // Insertion sort far-to-near so nearer craft overdraw (scalar temps:
      // the slots are shared objects, so aliasing one would duplicate it).
      for (let a = 1; a < rivalCount; a++) {
        const tempRel = rivalSlots[a]!.rel;
        const tempIdx = rivalSlots[a]!.idx;
        let b = a - 1;
        while (b >= 0 && rivalSlots[b]!.rel < tempRel) {
          rivalSlots[b + 1]!.rel = rivalSlots[b]!.rel;
          rivalSlots[b + 1]!.idx = rivalSlots[b]!.idx;
          b--;
        }
        rivalSlots[b + 1]!.rel = tempRel;
        rivalSlots[b + 1]!.idx = tempIdx;
      }
      for (let k = 0; k < rivalCount; k++) {
        const slot = rivalSlots[k]!;
        const r = race.racers[slot.idx]!;
        // Same strip buffer the road uses: one consistent depth projection.
        const proj = projectAtZ(strips, RACING_CAM_BACK + slot.rel);
        if (proj === null) continue;
        const cx = proj.cx + r.x * proj.ppu;
        const w = Math.max(4, CRAFT_WORLD_W * proj.ppu);
        drawCraft(
          cx,
          proj.y - w * 0.075,
          w,
          craftHulls[slot.idx % craftHulls.length]!,
          craftDarks[slot.idx % craftDarks.length]!,
          0,
          r.boostT > 0,
          r.speed > 20,
          'twinpod',
          r.steerPos * 0.14 * steerVisScale(r.speed),
          visHash(race.t * 3 + slot.idx),
        );
      }
    }

    // Player craft at its true camera-relative depth (z = CAM_BACK), sized
    // by the same world scale as rivals — never faked at another depth.
    // Banking comes from the smoothed steering position (drift leans harder);
    // scrape jitter and flame flicker derive from the frozen-when-paused
    // race clock, so pause renders identical frames.
    const visK = steerVisScale(player.speed);
    const tilt = player.steerPos * 12 * (inputBuf[PLAYER_INDEX]!.drift ? 1.5 : 1) * visK;
    const roll = (player.steerPos * 0.14 + (player.drifting ? player.steerPos * 0.08 : 0)) * visK;
    const scrape = Math.abs(player.x) >= BARRIER_X - 0.05 && Math.abs(player.speed) > 20;
    const px = W / 2 + steerVis * 26 * visK + (scrape ? visHash(race.t * 61.7) * 4 - 2 : 0);
    const pProj = projectAtZ(strips, RACING_CAM_BACK);
    if (pProj !== null) {
      const pw = CRAFT_WORLD_W * pProj.ppu;
      const py = pProj.y - pw * 0.075;
      // Boost/scrape/drift VFX advance only while the race clock advances, so
      // paused frames emit and step nothing and stay byte-identical.
      if (race.t !== lastSparkT) {
        lastSparkT = race.t;
        if (player.boostT > 0 && Math.abs(player.speed) > 10) {
          emitSparks(px, py + pw * 0.3, 2, '#fff7c0', 1.2);
        }
        if (scrape) emitSparks(px + Math.sign(player.x) * pw * 0.5, py, 3, '#ffd94d', 2.2);
        if (player.drifting && Math.abs(player.speed) > 30) {
          emitSparks(
            px - Math.sign(player.steerPos || 1) * pw * 0.5,
            py + pw * 0.3,
            2,
            '#cfd6ea',
            1.6,
          );
        }
        stepSparks(1 / 60);
      }
      if (art !== null) {
        // Generated player strip: baked bank pose, never rotated or mirrored.
        lastPlayerPose = selectCraftPose(steerVis * visK, player.speed);
        const pbw = pw / STRIP_BODY_FILL;
        drawStripShadow(
          px,
          py,
          pw,
          exhaustFlame(player.speed, player.boostT),
          visHash(race.t * 7 + 1),
        );
        pushSprite(
          RACING_CAM_BACK,
          3000,
          art.strips[PLAYER_INDEX]!,
          craftPoseSourceX(lastPlayerPose),
          0,
          64,
          64,
          px - pbw / 2,
          py - pbw,
          pbw,
          pbw,
          1,
        );
      } else {
        drawCraft(
          px,
          py,
          pw,
          craftHulls[0]!,
          craftDarks[0]!,
          tilt,
          player.boostT > 0,
          player.speed > 1,
          race.circuit.craftShape ?? 'twinpod',
          roll,
          visHash(race.t * 7 + 1),
        );
      }
    }
    if (art !== null) {
      // One combined painter's pass: nearer sprites (pickups, rivals,
      // player, foreground scenery) overdraw farther ones no matter which
      // pass queued them.
      sortArtSprites(spriteQueue, spriteCount);
      for (let q = 0; q < spriteCount; q++) {
        const e = spriteQueue[q]!;
        if (e.alpha !== 1) {
          ctx.globalAlpha = e.alpha;
          ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);
        }
      }
    }
    drawSparks();
    // Restrained speed sensation: faint edge streaks scrolling with pace at
    // high speed or boost. Screen-space only, deterministic in race clock.
    const streak =
      player.boostT > 0 ? 0.22 : Math.max(0, Math.min(0.18, (Math.abs(player.speed) - 62) / 220));
    if (streak > 0.01) {
      ctx.fillStyle = '#ffffff';
      for (let si = 0; si < 8; si++) {
        const sx = visHash(si * 3.7 + 0.5) * W;
        const span = H - HORIZON;
        const sy =
          HORIZON + ((visHash(si * 9.1) * span + race.t * Math.abs(player.speed) * 3) % span);
        ctx.globalAlpha = streak * (sx < W * 0.2 || sx > W * 0.8 ? 1 : 0.25);
        ctx.fillRect(sx, sy, 1.5, 18);
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Overlay pass for the host HUD hook: HUD bar, boost meter, minimap, and
   * phase cards. GameHost calls this after world effects; the DEV harness
   * calls it right after render().
   */
  function renderHud(): void {
    const circuit = race.circuit;
    const theme = circuit.theme;
    const player = race.racers[PLAYER_INDEX]!;
    drawHud();
    // Boost meter.
    ctx.textBaseline = 'top';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, H - 22, 496, 14);
    ctx.fillStyle = '#123';
    ctx.fillRect(10, H - 20, 100, 10);
    ctx.fillStyle = player.boostT > 0 ? '#fff7c0' : theme.accent;
    ctx.fillRect(10, H - 20, 100 * Math.max(0, Math.min(1, player.boost)), 10);
    // Cost tick: one burst costs BOOST_COST of the bar, so readiness reads
    // at a glance. Burning shows BOOST ACTIVE, a banked burst shows READY.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10 + 100 * BOOST_COST - 1, H - 20, 2, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`BOOST ${boostValue(player.boostT > 0, player.boost)}`, 114, H - 21);
    if (player.offroad) {
      ctx.fillStyle = '#ffb02e';
      ctx.fillText('OFFROAD', 198, H - 21);
    }
    if (player.lapTimes.length > 0) {
      ctx.fillStyle = '#aee9f1';
      ctx.fillText(`LAST ${fmtTime(player.lapTimes[player.lapTimes.length - 1]!)}`, 270, H - 21);
    }
    // Personal best slot (right of LAST, clear of road/craft): NEW BEST
    // flash, then transient checkpoint delta (words + sign + color), else
    // the saved BEST for this course.
    if (newBestTtl > 0) {
      ctx.fillStyle = '#ffd94d';
      ctx.fillText('NEW BEST!', 386, H - 21);
    } else if (lastDelta !== null && deltaTtl > 0) {
      ctx.fillStyle = lastDelta.ahead ? '#7dff5a' : '#ff5a5a';
      ctx.fillText(`${lastDelta.text} ${lastDelta.ahead ? 'AHEAD' : 'BEHIND'}`, 372, H - 21);
    } else if (timingBest !== null) {
      ctx.fillStyle = '#aee9f1';
      ctx.fillText(`BEST ${fmtTime(timingBest.lap)}`, 386, H - 21);
    } else {
      ctx.fillStyle = '#8a93b8';
      ctx.fillText('BEST --:--', 386, H - 21);
    }

    drawMinimap();

    // Corner + rival context in the spare upper-left sky: compact lines on
    // a small panel, race phase only (never over title/result/cup cards).
    if (phase === 'race' && !race.over) {
      const lines: Array<{ text: string; color: string }> = [];
      if (upcoming !== null) {
        const arrow = upcoming.bend.dir > 0 ? '>' : '<';
        const distM = Math.max(0, Math.round(upcoming.dist * UNITS_TO_M));
        lines.push({ text: `NEXT ${arrow} ${upcoming.bend.severity} ${distM}M`, color: '#ffd94d' });
      }
      if (rivalGap !== null) {
        const name = truncateName(rivalGap.name, 10).toUpperCase();
        const gapM = Math.round(Math.abs(rivalGap.gap) * UNITS_TO_M);
        const text =
          rivalGap.side === 'ALONGSIDE' ? `${name} ALONGSIDE` : `${name} ${gapM}M ${rivalGap.side}`;
        lines.push({ text, color: '#ffffff' });
      }
      if (posText !== null && race.t - posEventT < 4) {
        lines.push({ text: posText, color: '#7dff5a' });
      }
      if (lines.length > 0) {
        ctx.textBaseline = 'top';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(6, 26, 156, lines.length * 12 + 4);
        ctx.fillStyle = '#ffffff';
        for (const [li, line] of lines.entries()) {
          ctx.fillStyle = line.color;
          ctx.fillText(line.text, 10, 28 + li * 12);
        }
        ctx.textAlign = 'left';
      }
    }

    if (phase === 'title') {
      cardPanel(ctx, 0, 92, W, 128);
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 26px monospace';
      ctx.fillStyle = '#ffd94d';
      const title = `RACE ${displayRaceNumber()}/${raceCount}: ${truncateName(circuit.name.toUpperCase(), 20)}`;
      ctx.fillText(title, W / 2 - title.length * 7.8, 110);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#ffffff';
      const isFinale = cup.raceIndex === raceCount - 1;
      const bossLine = spec?.boss
        ? truncateName(
            `${spec.boss.title ?? spec.boss.name}${spec.boss.titleQuote ? `: ${spec.boss.titleQuote}` : ''}`,
            60,
          )
        : 'VEX PRIME defends the finale.';
      const lines = [
        circuit.blurb,
        `${circuit.laps} LAPS - ${race.circuit.names
          .slice(1)
          .map((n) => truncateName(n, 10))
          .join(' / ')}`,
        ...(isFinale ? [bossLine] : []),
        'D-PAD STEER - B ACCEL - Y BRAKE - A BOOST (HALF METER) - L/R DRIFT',
        'PRESS A OR B TO RACE',
      ];
      for (const [li, line] of lines.entries()) {
        ctx.fillText(line, W / 2 - line.length * 3, 145 + li * 14);
      }
      ctx.textBaseline = 'top';
    } else if (phase === 'countdown' && race.countdown > 0) {
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#ffd94d';
      ctx.textBaseline = 'middle';
      const n = Math.ceil(race.countdown);
      ctx.fillText(`${n}`, W / 2 - 8, 150);
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';
    } else if (goT > 0 && (phase === 'race' || phase === 'countdown')) {
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#7dff5a';
      ctx.textBaseline = 'middle';
      ctx.fillText('GO!', W / 2 - 24, 150);
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';
    } else if (phase === 'results') {
      drawClassification('RACE RESULT', classification, cup.raceIndex >= raceCount);
    } else if (phase === 'cupEnd') {
      drawCupFinal();
    }
  }

  /**
   * Standings name: the authored pilot name for the player seat, the cup
   * cast everywhere else. Legacy no-identity cups keep racing as YOU.
   */
  function displayName(idx: number, names: string[]): string {
    // Stable identity cast overrides per-course names everywhere (HUD,
    // results, standings); legacy specs keep course names.
    const stable = stableRosterNames(spec, names);
    return truncateName(stable[idx] ?? `R${idx + 1}`, 16);
  }

  function drawClassification(title: string, rows: ClassifiedEntry[], lastRace: boolean): void {
    cardPanel(ctx, 0, 70, W, rows.length * 14 + 58);
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffd94d';
    ctx.fillText(title, W / 2 - title.length * 6.6, 84);
    ctx.font = '10px monospace';
    for (const [ri, e] of rows.entries()) {
      const name = displayName(e.index, race.circuit.names);
      // '--' marks unfinished classified followers; DNF is only for real timeouts.
      const time = e.time !== null ? fmtTime(e.time) : e.dnf ? 'DNF' : '--';
      const pts = `+${[9, 6, 4, 2, 1][e.place - 1] ?? 0}`;
      const line = `P${e.place} ${name} ${time} ${pts} PTS`;
      ctx.fillStyle = e.index === PLAYER_INDEX ? '#35e0ff' : '#ffffff';
      ctx.fillText(line, W / 2 - line.length * 3, 112 + ri * 14);
    }
    ctx.fillStyle = '#ffffff';
    const sub = lastRace ? 'PRESS A FOR CUP RESULT' : 'PRESS A FOR NEXT RACE';
    ctx.fillText(sub, W / 2 - sub.length * 3, 112 + rows.length * 14 + 8);
    ctx.textBaseline = 'top';
  }

  function drawCupFinal(): void {
    const order = cupStandings(cup);
    cardPanel(ctx, 0, 70, W, order.length * 14 + 60);
    const playerCupPlace = order.indexOf(PLAYER_INDEX) + 1;
    const won = playerCupPlace === 1;
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = won ? '#ffd94d' : '#ffffff';
    const title = won ? 'CUP CHAMPION!' : `CUP P${playerCupPlace} OF ${RACER_COUNT}`;
    ctx.fillText(title, W / 2 - title.length * 7.2, 84);
    ctx.font = '10px monospace';
    for (const [ri, idx] of order.entries()) {
      const cupNames = cupRaces[cupRaces.length - 1]!.circuit.names;
      const name = displayName(idx, cupNames);
      const line = `P${ri + 1} ${name} ${cup.points[idx] ?? 0} PTS`;
      ctx.fillStyle = idx === PLAYER_INDEX ? '#35e0ff' : '#ffffff';
      ctx.fillText(line, W / 2 - line.length * 3, 114 + ri * 14);
    }
    ctx.fillStyle = '#ffffff';
    const sub = confirmed ? '' : 'PRESS A TO CONFIRM';
    if (sub) ctx.fillText(sub, W / 2 - sub.length * 3, 114 + order.length * 14 + 8);
    ctx.textBaseline = 'top';
  }

  /** Build the race for the cup's current index (title phase). */
  function startCupRace(announce = false): void {
    const resolved = cupRaces[Math.min(cup.raceIndex, cupRaces.length - 1)]!;
    race = createRaceFor(resolved.circuit, CUP_COUNTDOWN);
    artRaceIndex = -1;
    sparkRand = mulberry32(0xc0ffee);
    sparks.length = 0;
    lastSparkT = -1;
    classification = [];
    resultsT = 0;
    goT = 0;
    lastCount = Math.ceil(CUP_COUNTDOWN);
    lastLap = 0;
    lastCells = 0;
    scrapeSfxT = 0;
    steerVis = 0;
    confirmed = false;
    elapsedAtRaceStart = cupElapsed;
    loadTiming();
    phase = 'title';
    // Announce follow-on races through the host card system (intro covers
    // race 1 via start()). Guarded: DEV/test harnesses have no cards.
    if (announce) showCards(raceCards());
  }

  /**
   * Safe restart from anywhere, shared by the pause menu and DEV reset:
   * - results: roll back the just-finished race (points/wins/history/elapsed)
   *   and re-run that same circuit — never double-count, never skip one.
   * - cupEnd: restart the whole cup from race 1 with clear semantics.
   * - mid-race/title: rebuild the current race; previous results stand.
   */
  function restartFlow(): void {
    if (phase === 'cupEnd') {
      restartCup(cup);
      cupElapsed = 0;
      startCupRace();
      blip('uiSelect');
      return;
    }
    if (phase === 'results') {
      const last = cup.history.pop();
      if (last) {
        for (const e of last) {
          cup.points[e.index] = (cup.points[e.index] ?? 0) - (CUP_POINTS[e.place - 1] ?? 0);
          if (e.place === 1) cup.wins[e.index] = Math.max(0, (cup.wins[e.index] ?? 0) - 1);
        }
      }
      cup.raceIndex = cup.history.length;
      cupElapsed = elapsedAtRaceStart;
      startCupRace();
      blip('uiSelect');
      return;
    }
    restartRace(race, CUP_COUNTDOWN);
    sparkRand = mulberry32(0xc0ffee);
    sparks.length = 0;
    lastSparkT = -1;
    classification = [];
    resultsT = 0;
    goT = 0;
    lastCount = Math.ceil(CUP_COUNTDOWN);
    lastLap = 0;
    lastCells = 0;
    steerVis = 0;
    cupElapsed = elapsedAtRaceStart;
    loadTiming();
    if (phase !== 'title') phase = 'countdown';
  }

  function showCards(cards: StoryCard[]): void {
    try {
      (engine as unknown as { cards?: CardsShow }).cards?.show(cards);
    } catch {
      // No card system outside GameHost; the canvas titles carry the story.
    }
  }

  function cardsActive(): boolean {
    try {
      return (engine as unknown as { cards?: CardsShow }).cards?.active === true;
    } catch {
      return false;
    }
  }

  function portrait(defeat = false): unknown {
    try {
      const eng = engine as unknown as { portrait?: unknown; portraitDefeat?: unknown };
      if (defeat) return eng.portraitDefeat ?? eng.portrait ?? null;
      return eng.portrait ?? null;
    } catch {
      return null;
    }
  }

  function introCards(): StoryCard[] {
    if (spec) {
      return [
        { title: spec.meta.title, lines: spec.story.intro, artRole: 'intro', portrait: portrait() },
      ];
    }
    return [
      {
        title: 'EMBER CUP',
        lines: [
          'Three circuits, four rivals, one hovering trophy.',
          'Beat VEX, JUNO, PIP and KAZ, and take the finale from VEX PRIME.',
        ],
        artRole: 'intro',
        portrait: portrait(),
      },
    ];
  }

  function raceCards(): StoryCard[] {
    const i = cup.raceIndex;
    const last = i === raceCount - 1;
    if (spec) {
      const lines = [spec.story.levelIntros[i] ?? ''];
      if (last) {
        lines.push(spec.story.bossIntro);
        lines.push(
          `${spec.boss.title}${spec.boss.titleQuote ? `: "${spec.boss.titleQuote}"` : ''}`,
        );
      }
      return [
        {
          title: cupRaces[i]!.circuit.name,
          lines,
          artRole: last ? 'boss' : 'intro',
          stage: { index: i, total: raceCount },
          portrait: portrait(),
        },
      ];
    }
    const lines = [cupRaces[i]!.circuit.blurb];
    if (last) lines.push('VEX PRIME defends the finale.');
    return [
      {
        title: cupRaces[i]!.circuit.name,
        lines,
        artRole: last ? 'boss' : 'intro',
        stage: { index: i, total: raceCount },
      },
    ];
  }

  function finalCards(won: boolean): StoryCard[] {
    if (spec) {
      return [
        {
          title: spec.meta.title,
          lines: won ? spec.story.victory : spec.story.defeat,
          artRole: won ? 'victory' : 'defeat',
          portrait: portrait(!won),
        },
      ];
    }
    return [
      {
        title: 'EMBER CUP',
        lines: won
          ? ['Checkered flag. The cup is yours.', 'The pits chant your line home.']
          : ['VEX PRIME keeps the cup.', 'Run the lines again.'],
        artRole: won ? 'victory' : 'defeat',
        portrait: portrait(),
      },
    ];
  }

  /** Confirm the cup standings: queue the narrative, then release the result. */
  function confirmCupEnd(): void {
    if (confirmed) return;
    confirmed = true;
    const order = cupStandings(cup);
    const won = order[0] === PLAYER_INDEX;
    showCards(finalCards(won));
    blip(won ? 'win' : 'lose');
  }

  /** Leave the title: countdown begins and the race song starts. */
  function beginCountdown(): void {
    phase = 'countdown';
    lastCount = Math.ceil(race.countdown);
    playRaceMusic();
  }

  /**
   * Advance out of results: next circuit title, or the cup final table.
   * recordRaceResult already moved cup.raceIndex to the next unrun race, so
   * there is no second increment here (it used to skip a circuit).
   */
  function advanceFromResults(): void {
    if (cup.raceIndex >= raceCount) {
      phase = 'cupEnd';
      // Attract/demo confirms hands-off so the host demo loops; a human
      // confirms with A after reading the standings.
      if (autopilot) confirmCupEnd();
      else {
        const order = cupStandings(cup);
        blip(order[0] === PLAYER_INDEX ? 'win' : 'lose');
      }
    } else {
      startCupRace(true);
      blip('uiSelect');
    }
  }

  /** 1-based race number for display (results show the just-finished race). */
  function displayRaceNumber(): number {
    return phase === 'results' || phase === 'cupEnd' ? cup.raceIndex : cup.raceIndex + 1;
  }

  loadTiming();
  const game: GameInstance = {
    start() {
      showCards(introCards());
    },
    update(dt: number, input: InputSnapshot) {
      // START belongs to the host (pause / hold-to-exit) and never advances
      // the cup here: A confirms/continues, B starts a title.
      const goPressed = input.A.pressed || input.B.pressed;
      if (phase === 'title') {
        // Opening race title + control cue; any start/accel press races.
        // Autopilot starts hands-off (with a short countdown) so it can run
        // full cups for end-to-end verification with no button input.
        hover.stop();
        if (autopilot) {
          race.countdown = Math.min(race.countdown, 1.2);
          beginCountdown();
        } else if (goPressed) {
          beginCountdown();
        }
        return;
      }
      if (phase === 'results') {
        resultsT += dt;
        hover.stop();
        // Autopilot advances hands-off for end-to-end verification.
        if (input.A.pressed) advanceFromResults();
        else if (autopilot && resultsT > 3) advanceFromResults();
        return;
      }
      if (phase === 'cupEnd') {
        // A confirms the standings and plays the narrative; the host owns
        // everything after the result goes final (tally and beyond).
        hover.stop();
        if (input.A.pressed) confirmCupEnd();
        else if (autopilot && !confirmed) confirmCupEnd();
        return;
      }
      // Countdown + racing. Cup elapsed accrues here only — results/title
      // pauses never inflate the time bonus.
      cupElapsed += dt;
      if (autopilot) aiInputFor(race, PLAYER_INDEX, inputBuf[PLAYER_INDEX]);
      else playerInput(input, inputBuf[PLAYER_INDEX]!);
      for (let i = 0; i < race.racers.length; i++) {
        if (i !== PLAYER_INDEX) aiInputFor(race, i, inputBuf[i]);
      }
      const steerTarget = inputBuf[PLAYER_INDEX]!.steer;
      steerVis += (steerTarget - steerVis) * Math.min(1, dt * 8);
      const wasCountdown = race.countdown;
      stepRace(race, inputBuf, dt);
      // The countdown phase is only the 3-2-1: racing proper begins at GO.
      if (phase === 'countdown' && race.countdown === 0) phase = 'race';
      const player = race.racers[PLAYER_INDEX]!;
      // Hover hum follows the live craft, racing phase only — countdown
      // stays quiet, and update (never render) is the only driver.
      if (phase === 'race' && !race.over) {
        hover.update(
          {
            speed: player.speed,
            throttle: inputBuf[PLAYER_INDEX]!.accel,
            boosting: player.boostT > 0,
            drifting: player.drifting,
          },
          race.racers,
          PLAYER_INDEX,
          race.circuit.track.length,
        );
      } else {
        hover.stop();
      }
      // Countdown ticks + GO sting.
      if (wasCountdown > 0) {
        const n = Math.ceil(race.countdown);
        if (n < lastCount && n > 0) {
          lastCount = n;
          blip('uiMove');
        }
        if (race.countdown === 0) {
          goT = 1.0;
          blip('uiSelect');
        }
      }
      if (goT > 0) goT = Math.max(0, goT - dt);
      // Lap chime for the player.
      if (player.lap > lastLap) {
        lastLap = player.lap;
        blip('pickup');
      }
      // Energy-cell chime for the player (pickups mode only; the counter
      // only advances through the shared collection step).
      if (player.pickupsTaken > lastCells) {
        lastCells = player.pickupsTaken;
        blip('pickup');
      }
      // Personal timing: observe gate/lap state in the racing phase only —
      // countdown/titles/results/cards never accrue. The standing-start lap
      // (banked lap 1) is an out-lap by policy; only flying laps record.
      if (phase === 'race') {
        const res = lapAttempt.observe(
          { t: race.t, lap: player.lap, nextCp: player.nextCp },
          player.lapStartT,
          autopilot,
        );
        const flying = player.lap >= 1;
        if (player.lap === shownLap && player.nextCp > shownCp) {
          if (timingBest !== null && flying && lapAttempt.live) {
            const split = race.t - player.lapStartT;
            lastDelta = formatDelta(split - timingBest.splits[player.nextCp - 1]!);
            deltaTtl = 3;
          }
          shownCp = player.nextCp;
        } else if (player.lap > shownLap) {
          shownLap = player.lap;
          shownCp = player.nextCp;
        } else if (player.lap === shownLap && player.nextCp < shownCp) {
          shownCp = player.nextCp;
          lastDelta = null;
          deltaTtl = 0;
        }
        // Finish comparison only on a valid completed attempt against the
        // previous best: invalid/autopilot/out-lap finishes show nothing.
        if (res !== null) {
          if (timingBest === null || res.lapTime < timingBest.lap) {
            timingBests.set(timingCourse, race.circuit, { lap: res.lapTime, splits: res.splits });
            timingBest = timingBests.get(timingCourse, race.circuit);
            newBestTtl = 4;
            lastDelta = null;
            deltaTtl = 0;
          } else {
            lastDelta = formatDelta(res.lapTime - timingBest.lap);
            deltaTtl = 3;
          }
        }
        if (deltaTtl > 0) deltaTtl = Math.max(0, deltaTtl - dt);
        if (newBestTtl > 0) newBestTtl = Math.max(0, newBestTtl - dt);
        // Readability feedback, live race only: upcoming bend, nearest
        // rival, position changes. Distances run from the PLAYER position
        // (camera is projection-only); frozen with the race clock under
        // pause; cleared on results/cards/restart via loadTiming.
        const playerW = race.circuit.track.wrap(player.s);
        upcoming = nextBend(warnBends, playerW, race.circuit.track.length);
        upcomingBoards = nextBend(warnSharp, playerW, race.circuit.track.length);
        if (!race.over) {
          rivalGap = nearestRival(race, stableRosterNames(spec, race.circuit.names));
          const posNow = playerPos(race);
          // A banner goes stale the instant the position changes again,
          // rather than lingering past the top-HUD readout.
          if (bannerStale(posEventPos, posNow)) posText = null;
          const ev = positionEvent(posNow, posShown, race.t, posEventT);
          posShown = ev.shown;
          if (ev.text !== null) {
            posText = ev.text;
            posEventT = ev.eventT;
            posEventPos = ev.shown;
            blip('uiMove');
          }
        }
      }
      // Boost is a sustained afterburner in the engine mixer; barrier scrape is throttled.
      scrapeSfxT -= dt;
      if (
        Math.abs(player.x) >= BARRIER_X - 0.05 &&
        Math.abs(player.speed) > 20 &&
        scrapeSfxT <= 0
      ) {
        scrapeSfxT = 0.3;
        blip('hit');
      }
      // Race over: freeze time, classify once, record cup points. (Phase is
      // necessarily countdown|race here — title/results/cupEnd returned above.)
      if (race.over) {
        classification = classifyRace(race);
        recordRaceResult(cup, classification);
        resultsT = 0;
        phase = 'results';
        hover.stop();
        const place = classification.find((e) => e.index === PLAYER_INDEX)?.place ?? RACER_COUNT;
        blip(place === 1 ? 'powerup' : 'uiBack');
      }
    },
    render() {
      render();
    },
    renderHud() {
      renderHud();
    },
    restart() {
      hover.stop();
      restartFlow();
    },
    /**
     * Host pause hook: the host stops calling update while paused, so halt
     * the hum here; resume restarts it lazily on the next racing update.
     */
    setPaused(paused: boolean) {
      if (paused) hover.stop();
    },
    get hud(): HudState {
      const player = race.racers[PLAYER_INDEX]!;
      const pos = racePosition(race, PLAYER_INDEX);
      return {
        score:
          (cup.points[PLAYER_INDEX] ?? 0) * 1000 +
          (RACER_COUNT - pos) * 100 +
          player.lap * 40 +
          Math.floor((race.circuit.track.wrap(player.s) / race.circuit.track.length) * 10),
        lives: 1,
        health: Math.round(player.boost * 100),
        maxHealth: 100,
        keys: 0,
        bombs: 0,
        mechanic: {
          label: 'BOOST',
          value: boostValue(player.boostT > 0, player.boost),
          progress: Math.max(0, Math.min(1, player.boost)),
        },
      };
    },
    get result(): GameResult | null {
      // Final only once the cup is complete, the standings are confirmed,
      // and the victory/defeat narrative has played. The host switches to
      // tally the moment this goes non-null, so it must not fire early.
      if (!cupComplete(cup, raceCount) || !confirmed || cardsActive()) return null;
      const order = cupStandings(cup);
      const place = order.indexOf(PLAYER_INDEX) + 1;
      return {
        outcome: place === 1 ? 'won' : 'lost',
        score: game.hud.score,
        // TOTAL cup elapsed across all three races — never just the finale.
        timeBonusSeconds: place === 1 ? Math.max(0, Math.round(900 - cupElapsed)) : 0,
      };
    },
    dispose() {
      hover.stop();
      try {
        (engine as unknown as { music?: MusicPlay }).music?.stopSong();
      } catch {
        // Silence must never throw.
      }
    },
  };
  const racingDev: RacingDevHandle['racingDev'] = {
    snapshot(): RacingDevSnapshot {
      const player = race.racers[PLAYER_INDEX]!;
      return {
        t: race.t,
        fps: Math.round(renderFps),
        countdown: race.countdown,
        over: race.over,
        autopilot,
        phase,
        trackId: race.circuit.id,
        trackName: race.circuit.name,
        cup: {
          raceIndex: cup.raceIndex,
          raceCount,
          points: [...cup.points],
          playerCupPlace: cupStandings(cup).indexOf(PLAYER_INDEX) + 1,
          complete: cupComplete(cup, raceCount),
        },
        player: {
          s: race.circuit.track.wrap(player.s),
          x: player.x,
          speed: player.speed,
          lap: player.lap,
          pos: racePosition(race, PLAYER_INDEX),
          boost: player.boost,
          boostT: player.boostT,
          offroad: player.offroad,
          steerPos: player.steerPos,
          drifting: player.drifting,
          engineOn: hover.status().on,
          enginePitchHz: Math.round(hover.status().pitchHz),
        },
        audio: hover.snapshot(),
        timing: {
          key: timingKey,
          best: timingBest === null ? null : timingBest.lap,
          delta: lastDelta !== null && deltaTtl > 0 ? lastDelta.text : null,
          eligible: phase === 'race' && !race.over && lapAttempt.live && player.lap >= 1,
        },
        feedback: {
          corner:
            phase === 'race' && upcoming !== null
              ? {
                  dir: upcoming.bend.dir > 0 ? 'R' : 'L',
                  sev: upcoming.bend.severity,
                  distM: Math.max(0, Math.round(upcoming.dist * UNITS_TO_M)),
                }
              : null,
          rival:
            phase === 'race' && rivalGap !== null
              ? {
                  name: rivalGap.name,
                  gapM: Math.round(rivalGap.gap * UNITS_TO_M),
                  side: rivalGap.side,
                }
              : null,
          posEvent: phase === 'race' && posText !== null && race.t - posEventT < 4 ? posText : null,
        },
        art: {
          pack: raceArt !== null,
          race: artRaceIndex,
          pose: lastPlayerPose,
          mode: race.circuit.boostMode ?? 'pads',
        },
      };
    },
    setAutopilot(on: boolean): void {
      autopilot = on;
    },
    reset(): void {
      restartFlow();
      // DEV reset drops straight into the countdown for quick iteration.
      if (phase === 'title') beginCountdown();
    },
    advance(): void {
      // DEV-only shortcut mirroring the A button (titles, results, standings).
      if (phase === 'results') advanceFromResults();
      else if (phase === 'title') beginCountdown();
      else if (phase === 'cupEnd') confirmCupEnd();
    },
  };
  return Object.assign(game, { racingDev });
}
