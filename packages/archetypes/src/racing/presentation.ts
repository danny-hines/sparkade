// Racing runtime presentation: bounded derivation of look/feel/words from
// the traversal contract. Pure data and math only — no canvas, no audio
// nodes, no physics numbers. Physics reads ONLY (handling, surface) through
// movement.ts; everything here reads (surface, rider, propulsion) and
// optionally handling for WORDS only (CARVE vs DRIFT), never for pace.
//
// Legacy rule: an omitted traversal resolves to the exact legacy hovercraft
// presentation (motor flames, 2.4 KM/H scale, ACCEL/DRIFT wording), so
// legacy cups render byte-identically to before.
import type {
  PromptButton,
  RacingDiscipline,
  RacingHandling,
  RacingRider,
  RacingSurface,
  RacingTraversal,
} from '@sparkade/shared';
import { exhaustFlame } from './art';

/** Bounded presentation view of one cup: surface, rider, and propulsion. */
export interface RacePresentation {
  /** Riding surface: ground renders asphalt contact, water renders wake. */
  readonly surface: RacingSurface;
  /** Rider pose: presentation-only, never physics. */
  readonly rider: RacingRider;
  /** Propulsion fiction: presentation-only, never physics. */
  readonly propulsion: 'motor' | 'human' | 'magic';
  /** True on water: wake, spray, and hull contact replace shadow/flames. */
  readonly water: boolean;
  /** True for human-powered racers: cadence cues, no flames, scaled speed. */
  readonly human: boolean;
  /** True for magic-propelled racers: a single restrained trail. */
  readonly magic: boolean;
}

/** Legacy presentation: omitted traversal is the classic motor hovercraft. */
export const LEGACY_PRESENTATION: RacePresentation = {
  surface: 'ground',
  rider: 'none',
  propulsion: 'motor',
  water: false,
  human: false,
  magic: false,
};

/**
 * Bounded presentation resolver. Omitted/null traversal returns the shared
 * legacy object (same reference); a present traversal derives surface, rider,
 * and propulsion only. Handling and label are never consulted.
 */
export function resolveRacePresentation(
  traversal?: RacingTraversal | null,
): RacePresentation {
  if (traversal === undefined || traversal === null) return LEGACY_PRESENTATION;
  const surface: RacingSurface = traversal.surface === 'water' ? 'water' : 'ground';
  const rider: RacingRider = traversal.rider;
  const propulsion = traversal.propulsion;
  // Ground + motor reads exactly legacy in every resolver below (flames,
  // 2.4 scale, ACCEL verbs, no bob, no trail), so share the legacy object
  // regardless of the rider pose.
  if (surface === 'ground' && propulsion === 'motor') {
    return LEGACY_PRESENTATION;
  }
  return {
    surface,
    rider,
    propulsion,
    water: surface === 'water',
    human: propulsion === 'human',
    magic: propulsion === 'magic',
  };
}

/**
 * Effective riding surface for a circuit: the traversal surface when a
 * traversal is compiled in, otherwise the legacy discipline's surface
 * (jetski → water, anything else → ground). Surface-based: no sport-name
 * branches anywhere downstream.
 */
export function surfaceForCircuit(circuit: {
  traversal?: RacingTraversal | null;
  discipline?: RacingDiscipline | null;
}): RacingSurface {
  if (circuit.traversal !== undefined && circuit.traversal !== null) {
    return circuit.traversal.surface === 'water' ? 'water' : 'ground';
  }
  return circuit.discipline === 'jetski' ? 'water' : 'ground';
}

/**
 * Effective legacy discipline for a circuit: derived from the traversal
 * surface when present (water → jetski, ground → hover), otherwise the
 * compiled discipline (omission → hover). Lets every legacy
 * discipline-keyed helper (bank threshold, wording, audio mix) follow the
 * surface without sport-name branching at the call sites.
 */
export function surfaceDisciplineFor(
  traversal?: RacingTraversal | null,
  discipline?: RacingDiscipline | null,
): RacingDiscipline {
  if (traversal !== undefined && traversal !== null) {
    return traversal.surface === 'water' ? 'jetski' : 'hover';
  }
  return discipline === 'jetski' ? 'jetski' : 'hover';
}

/** True when this circuit renders the water course (buoys, wake, spray). */
export function isWaterCircuit(circuit: {
  traversal?: RacingTraversal | null;
  discipline?: RacingDiscipline | null;
}): boolean {
  return surfaceForCircuit(circuit) === 'water';
}

/**
 * Exhaust flame level for a racer: human-powered racers never burn
 * (no flames/exhaust on bicycles, boards, or runners); magic caps at a
 * restrained flicker (its read is the trail, not the flame); motor keeps
 * the exact legacy exhaust grades. Water callers already gate flames off
 * through the water flag — this only shapes the ground path.
 */
export function flameForPresentation(
  presentation: RacePresentation,
  speed: number,
  boostT: number,
): 0 | 1 | 2 {
  if (presentation.human) return 0;
  const flame = exhaustFlame(speed, boostT);
  if (presentation.magic) return flame === 2 ? 1 : flame;
  return flame;
}

/**
 * Restrained magic trail: 1 while a magic racer runs at pace or boosts,
 * 0 otherwise (and always 0 for motor/human — motor reads through the
 * flame, human through the cadence bob). The runtime draws at most one
 * spark per emission through the shared gated pool.
 */
export function trailForPresentation(
  presentation: RacePresentation,
  speed: number,
  boostT: number,
): 0 | 1 {
  if (!presentation.magic) return 0;
  if (boostT > 0) return 1;
  return Math.abs(speed) > 30 ? 1 : 0;
}

/**
 * Tiny rider movement cue (screen pixels, vertical) for human-powered
 * racers: a cadence/posture bob that grows with pace and freezes to
 * exactly 0 at rest — a stopped racer stays exactly still. Motor/magic
 * racers return 0 (their craft reads through lean and flame/trail, never
 * through body motion). Deterministic in the race clock; never image
 * warping, just a small reusable offset around the planted base.
 */
export function riderBobFor(
  presentation: RacePresentation,
  speed: number,
  t: number,
): number {
  if (!presentation.human) return 0;
  if (Math.abs(speed) < 1) return 0;
  const pace = Math.min(1, Math.abs(speed) / 40);
  const cadence = 4 + Math.abs(speed) * 0.15;
  return Math.sin(t * cadence) * pace;
}

/**
 * Presentation-only speed scale (never physics): motor keeps the legacy
 * 2.4 factor byte-identically; human-powered racers read a believable
 * cadence pace; magic sits between. A human cup therefore never shows
 * 200 KM/H at full pace.
 */
export function speedScaleFor(presentation: RacePresentation): number {
  if (presentation.human) return 0.5;
  if (presentation.magic) return 1.2;
  return 2.4;
}

/** Presentation-only speed readout, e.g. "42 KM/H". Legacy-identical unscaled. */
export function speedTextFor(presentation: RacePresentation, speed: number): string {
  return `${Math.round(Math.abs(speed) * speedScaleFor(presentation))} KM/H`;
}

/**
 * Throttle action word: the rider/propulsion fiction picks the verb —
 * runners RUN, seated humans PEDAL, standing humans PUSH, everything else
 * keeps the legacy ACCEL. Presentation only; inputs are untouched.
 */
export function accelWordFor(presentation: RacePresentation): string {
  if (presentation.propulsion !== 'human') return 'ACCEL';
  if (presentation.rider === 'onFoot') return 'RUN';
  if (presentation.rider === 'standing') return 'PUSH';
  return 'PEDAL';
}

/**
 * Slide action word: CARVE for carving handling (carve/flow) or — without
 * a traversal — for the legacy water discipline; DRIFT otherwise. Words
 * only; the steering model is untouched.
 */
export function slideWordFor(
  presentation: RacePresentation,
  handling?: RacingHandling | null,
  discipline?: RacingDiscipline | null,
): string {
  if (handling !== undefined && handling !== null) {
    return handling === 'carve' || handling === 'flow' ? 'CARVE' : 'DRIFT';
  }
  const water = presentation.water || discipline === 'jetski';
  return water ? 'CARVE' : 'DRIFT';
}

/**
 * Title-screen control line for a traversal: the legacy discipline line
 * when no traversal is present (byte-identical), otherwise the same shape
 * with the presentation verbs (PEDAL/PUSH/RUN over ACCEL/THROTTLE, CARVE
 * over DRIFT on carving handling).
 */
export function helpControlsLineFor(
  presentation: RacePresentation,
  handling?: RacingHandling | null,
  button: (button: PromptButton) => string = (b) => b,
): string {
  const legacy =
    presentation === LEGACY_PRESENTATION && (handling === undefined || handling === null);
  const throttle =
    legacy || presentation.propulsion === 'motor' ? 'ACCEL' : accelWordFor(presentation);
  const slide = legacy ? 'DRIFT' : slideWordFor(presentation, handling);
  return `${button('D-PAD')} STEER - ${button('B')} ${throttle} - ${button('Y')} BRAKE - ${button('A')} BOOST (HALF METER) - ${button('L')}/${button('R')} ${slide}`;
}

/**
 * Cabinet control labels for a traversal: legacy ACCEL/DRIFT entries when
 * no traversal is present, otherwise the presentation verbs. Shape matches
 * RACING_CONTROLS (button order unchanged) so hosts can swap labels only.
 */
export function racingControlsFor(
  presentation: RacePresentation,
  handling?: RacingHandling | null,
): Array<{ button: 'LEFT' | 'RIGHT' | 'B' | 'Y' | 'A' | 'L'; label: string }> {
  const slide = slideWordFor(presentation, handling);
  return [
    { button: 'LEFT', label: 'D-PAD left' },
    { button: 'RIGHT', label: 'D-PAD right' },
    { button: 'B', label: accelWordFor(presentation) },
    { button: 'Y', label: 'BRAKE' },
    { button: 'A', label: 'BOOST / CONTINUE' },
    { button: 'L', label: slide },
  ];
}

/**
 * Traversal label for title/subtitle use only: trimmed, single-line, and
 * hard-truncated so a freeform invented name can never overflow the card.
 * Returns null without a traversal (legacy titles are untouched).
 */
export function titleLabelFor(traversal?: RacingTraversal | null, max = 28): string | null {
  if (traversal === undefined || traversal === null) return null;
  const clean = traversal.label.replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  return clean.length > max ? clean.slice(0, max) : clean;
}
