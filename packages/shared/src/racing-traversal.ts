// Racing traversal contract (P1: composable traversal + physics resolution).
//
// Optional RacingIdentity.traversal lets one shared engine drive bicycles,
// motorcycles, skateboards, and invented racers without sport-name branching:
// authoring supplies a short freeform user-facing label plus two bounded
// physics-adjacent axes (handling, surface) and two presentation-only axes
// (rider, propulsion). The label, rider, and propulsion NEVER drive physics —
// only (handling, surface) resolve to numbers, through the bounded tables
// below. Model-authored specs may not supply raw tuning; every number the
// simulation steps lives in this file and movement.ts.
//
// Legacy compatibility: absence of traversal preserves exactly the old
// hover/jetski behavior (movement.ts returns the identical profile object).

/** Bounded steering/lateral feel. Only this and surface affect physics. */
export type RacingHandling = 'direct' | 'grip' | 'carve' | 'flow';
/** Bounded riding surface. Only this and handling affect physics. */
export type RacingSurface = 'ground' | 'water';
/** Presentation-only rider pose. Never affects physics. */
export type RacingRider = 'none' | 'seated' | 'standing' | 'onFoot';
/** Presentation-only propulsion fiction. Never affects physics. */
export type RacingPropulsion = 'motor' | 'human' | 'magic';
/** Optional generated locomotion; presentation only, never physics. */
export type RacingMotion = 'static' | 'pedal' | 'stride' | 'push' | 'pulse';
export const RACING_MOTIONS: readonly RacingMotion[] = [
  'static',
  'pedal',
  'stride',
  'push',
  'pulse',
];

/**
 * Composable traversal authoring. label is a short freeform user-facing
 * activity name (e.g. "Cycle Sprint"); invented names never drive code.
 */
export interface RacingTraversal {
  label: string;
  handling: RacingHandling;
  surface: RacingSurface;
  rider: RacingRider;
  propulsion: RacingPropulsion;
  motion?: RacingMotion;
}

export const RACING_HANDLINGS: readonly RacingHandling[] = [
  'direct',
  'grip',
  'carve',
  'flow',
] as const;
export const RACING_SURFACES: readonly RacingSurface[] = ['ground', 'water'] as const;
export const RACING_RIDERS: readonly RacingRider[] = [
  'none',
  'seated',
  'standing',
  'onFoot',
] as const;
export const RACING_PROPULSIONS: readonly RacingPropulsion[] = ['motor', 'human', 'magic'] as const;

/**
 * Bounded per-handling steering/lateral tuning. Direct repeats hover
 * steering and carve repeats jet-ski steering. Grip responds more sharply;
 * flow retains momentum longer. These are fixed, tested profiles, with no
 * model-authored numeric tuning.
 */
export interface RacingHandlingTuning {
  readonly handling: RacingHandling;
  readonly steerAttack: number;
  readonly steerRelease: number;
  readonly steerCounter: number;
  /** 0 = direct slide (legacy hover branch); >0 = momentum chase (jetski branch). */
  readonly lateralResponse: number;
  readonly lateralSnap: number;
}

export const TRAVERSAL_HANDLING_TUNINGS: Record<RacingHandling, RacingHandlingTuning> = {
  // Hover steering, direct slide: the legacy arithmetic branch.
  direct: {
    handling: 'direct',
    steerAttack: 6.5,
    steerRelease: 8,
    steerCounter: 13,
    lateralResponse: 0,
    lateralSnap: 0,
  },
  // Planted steering, direct slide: hover rates nudged within the envelope.
  grip: {
    handling: 'grip',
    steerAttack: 7,
    steerRelease: 8,
    steerCounter: 14,
    lateralResponse: 0,
    lateralSnap: 0,
  },
  // Jet-ski steering with hull momentum: the proven water branch on any surface.
  carve: {
    handling: 'carve',
    steerAttack: 5.5,
    steerRelease: 7,
    steerCounter: 12,
    lateralResponse: 5,
    lateralSnap: 0.05,
  },
  // Softer momentum chase between direct and carve.
  flow: {
    handling: 'flow',
    steerAttack: 5,
    steerRelease: 6.5,
    steerCounter: 11,
    lateralResponse: 3,
    lateralSnap: 0.05,
  },
};

/** Authoring presets. Reference data only — the resolver never branches on them. */
export const BICYCLE_TRAVERSAL: RacingTraversal = {
  label: 'Cycle Sprint',
  handling: 'grip',
  surface: 'ground',
  rider: 'seated',
  propulsion: 'human',
};
export const MOTORCYCLE_TRAVERSAL: RacingTraversal = {
  label: 'Moto Sprint',
  handling: 'grip',
  surface: 'ground',
  rider: 'seated',
  propulsion: 'motor',
};
export const SKATEBOARD_TRAVERSAL: RacingTraversal = {
  label: 'Street Carve',
  handling: 'carve',
  surface: 'ground',
  rider: 'standing',
  propulsion: 'human',
};
export const MAGIC_BOARD_TRAVERSAL: RacingTraversal = {
  label: 'Tide Charms',
  handling: 'carve',
  surface: 'water',
  rider: 'standing',
  propulsion: 'magic',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asciiText(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= 48 && /^[ -~]+$/.test(value)
  );
}

/**
 * Validate an authoring value into a RacingTraversal. undefined stays
 * undefined (legacy hover/jetski path); anything else must carry every field
 * with a bounded enum value. Throws rather than racing wrong physics.
 */
export function resolveTraversal(value: unknown): RacingTraversal | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error('unknown racing traversal (expected an object or omission)');
  const { label, handling, surface, rider, propulsion } = value;
  if (!asciiText(label)) {
    throw new Error('unknown racing traversal label (expected 1-48 printable ASCII characters)');
  }
  if (!RACING_HANDLINGS.includes(handling as RacingHandling)) {
    throw new Error(
      `unknown racing traversal handling "${String(handling)}" (expected ${RACING_HANDLINGS.join(' | ')})`,
    );
  }
  if (!RACING_SURFACES.includes(surface as RacingSurface)) {
    throw new Error(
      `unknown racing traversal surface "${String(surface)}" (expected ${RACING_SURFACES.join(' | ')})`,
    );
  }
  if (!RACING_RIDERS.includes(rider as RacingRider)) {
    throw new Error(
      `unknown racing traversal rider "${String(rider)}" (expected ${RACING_RIDERS.join(' | ')})`,
    );
  }
  if (!RACING_PROPULSIONS.includes(propulsion as RacingPropulsion)) {
    throw new Error(
      `unknown racing traversal propulsion "${String(propulsion)}" (expected ${RACING_PROPULSIONS.join(' | ')})`,
    );
  }
  if (value.motion !== undefined && !RACING_MOTIONS.includes(value.motion as RacingMotion)) {
    throw new Error('unknown racing motion (expected static | pedal | stride | push | pulse)');
  }
  return {
    ...(value.motion === undefined ? {} : { motion: value.motion as RacingMotion }),
    label: label as string,
    handling: handling as RacingHandling,
    surface: surface as RacingSurface,
    rider: rider as RacingRider,
    propulsion: propulsion as RacingPropulsion,
  };
}

/** Bounded handling tuning for a validated traversal; label/rider/propulsion never consulted. */
export function handlingTuningFor(traversal: RacingTraversal): RacingHandlingTuning {
  const tuning = TRAVERSAL_HANDLING_TUNINGS[traversal.handling];
  if (!tuning) throw new Error(`unknown racing traversal handling "${String(traversal.handling)}"`);
  return tuning;
}
