// Traversal-aware art routing for generated racing cups (generation side).
//
// Only the bounded enum axes (surface/rider/propulsion) drive art prompts;
// the freeform label NEVER does. Absent traversal preserves the legacy
// hover/jetski behavior exactly — every legacy prompt below keeps its
// byte-identical branch and these helpers are consulted only when a
// validated traversal contract is present.
import {
  resolveTraversal,
  type RacingIdentity,
  type RacingPropulsion,
  type RacingRider,
  type RacingSpec,
  type RacingTraversal,
} from '@sparkade/shared';

/** Effective art subject for one cup, derived from enum axes only. */
export interface RacingArtSubject {
  /** True for water cups: traversal surface water, else legacy jetski discipline. */
  water: boolean;
  /** Effective rider pose: traversal rider, else seated on jetski / none on hover. */
  rider: RacingRider;
  /** Presentation-only propulsion; undefined on legacy cups (legacy fiction kept). */
  propulsion: RacingPropulsion | undefined;
  /** True when the identity carries a validated traversal contract. */
  hasTraversal: boolean;
  /** The validated traversal, when present. */
  traversal: RacingTraversal | undefined;
}

/**
 * Resolve the effective art subject. Label is validated but never read here:
 * two traversals differing only in label resolve identically.
 */
export function racingArtSubject(identity: RacingIdentity | undefined): RacingArtSubject {
  const traversal = resolveTraversal(identity?.traversal);
  if (!traversal) {
    const jetski = identity?.discipline === 'jetski';
    return {
      water: jetski,
      rider: jetski ? 'seated' : 'none',
      propulsion: undefined,
      hasTraversal: false,
      traversal: undefined,
    };
  }
  return {
    water: traversal.surface === 'water',
    rider: traversal.rider,
    propulsion: traversal.propulsion,
    hasTraversal: true,
    traversal,
  };
}

export function racingArtSubjectFor(spec: RacingSpec): RacingArtSubject {
  return racingArtSubject(spec.identity);
}

/** Generic strip subject noun — never a sport name or label. */
export function racingSubjectNoun(rider: RacingRider): string {
  if (rider === 'onFoot') return 'runner';
  if (rider === 'none') return 'vehicle';
  return 'rider plus conveyance';
}

/** Identity sentence(s) for one roster slot's strip prompt. */
export function racingRiderIdentityLine(rider: RacingRider, concept: string): string {
  if (rider === 'none') {
    return `Vehicle identity: ${concept}. Keep one identical vehicle across all three cells: same silhouette, materials, markings, and livery.`;
  }
  if (rider === 'onFoot') {
    return `Runner identity: ${concept}. The SAME adult runner appears mid-stride in every cell: same outfit, same rear head. Strides rest on the basic bank-pose foundation below, never a dedicated run cycle.`;
  }
  if (rider === 'standing') {
    return `Conveyance and rider identity: ${concept}. Keep one identical conveyance across all three cells: same silhouette, materials, markings, and livery. The SAME adult rider stands on the conveyance in every cell: same outfit, same rear head, feet planted on the riding surface, leaning physically together with it.`;
  }
  return `Conveyance and rider identity: ${concept}. Keep one identical conveyance across all three cells: same silhouette, materials, markings, and livery. The SAME adult rider rides it in every cell: same outfit, same rear head, seated astride the conveyance and leaning physically together with it.`;
}

/** Banking coherence sentence shared by strips and bank edits. */
export function racingBankLine(rider: RacingRider): string {
  const who =
    rider === 'none'
      ? 'the SAME conveyance'
      : rider === 'onFoot'
        ? 'the runner'
        : 'rider and conveyance';
  return `Banking poses tilt ${who} together gently, roughly 8-12 degrees, and shift them sideways; never redesign either and never mirror an asymmetric livery into a missing pose.`;
}

/** Rear-camera contract for the rider axis. */
export function racingRearCameraLine(rider: RacingRider): string {
  if (rider === 'none') {
    return 'Rear camera orientation: the camera sits behind and slightly above every conveyance and all three point directly AWAY toward the horizon. Rear-view composition only: tail, stern, and rear markings are visible; no front, cockpit front, or face-on view.';
  }
  if (rider === 'onFoot') {
    return 'Rear camera orientation: the camera sits behind and slightly above the runner and all three point directly AWAY toward the horizon. Rear-view composition only: runner back, rear head, and stride silhouette are visible; never a face-on view. Never render a second runner, a conveyance, or a face pasted into the scene.';
  }
  const forbidden =
    rider === 'standing'
      ? 'never render the rider seated, detached, floating beside, or facing the camera'
      : 'never render the rider standing, detached, floating beside, or facing the camera';
  return `Rear camera orientation: the camera sits behind and slightly above every conveyance and all three point directly AWAY toward the horizon. Rear-view composition only: rider back, conveyance stern and rear, and tail markings are visible; no front, cockpit front, or face-on view. The rider may show the rear of the head; never paste a face into the conveyance and ${forbidden}.`;
}

/**
 * Exhaust/VFX fiction for the propulsion axis. Human propulsion never gets
 * motor exhaust; the runtime owns all motion VFX in every case.
 */
export function racingExhaustLine(propulsion: RacingPropulsion, water: boolean): string {
  if (propulsion === 'human') {
    return 'Human-powered fiction: no motor exhaust flames, engine plumes, or mechanical exhaust anywhere — the runtime owns all motion VFX. Banking poses may show a small idle motion hint at most.';
  }
  if (propulsion === 'magic') {
    return 'Magic propulsion: no mechanical exhaust or engine plumes — a small idle shimmer at most. The runtime owns all motion VFX.';
  }
  return water
    ? 'No baked wakes, spray plumes, or exhaust flames on the neutral-rear cruise pose — the runtime owns all water and boost VFX. Banking poses may show a small idle spray hint at most.'
    : 'No baked boost exhaust flames or drive plumes on the neutral-rear cruise pose — the runtime owns all throttle and boost VFX. Banking poses may show a small idle drive glow but no large exhaust plumes.';
}

/** Pack-plan camera lock for traversal strips: rear ROLL, never yaw. */
export function racingTraversalCameraLock(rider: RacingRider): string {
  const subject =
    rider === 'none'
      ? 'the rear bumper and exhaust end of the conveyance'
      : rider === 'onFoot'
        ? 'the runner back and stride'
        : 'the rider back and the conveyance stern';
  const keep =
    rider === 'none'
      ? 'Keep the body length and livery unchanged.'
      : rider === 'onFoot'
        ? 'Keep the runner outfit and stride unchanged.'
        : 'Keep the rider, conveyance length and livery unchanged.';
  return ` CAMERA LOCK: all three views show ${subject} facing the viewer, with the front farthest away. Banking is ROLL, never yaw to a side view. Cell 2 lowers the screen-left edge and raises the screen-right edge; cell 3 does the exact opposite. ${keep} The two bank poses must tilt in visibly opposite directions.`;
}

/** People/text ban for the rider axis. */
export function racingPeopleBanLine(rider: RacingRider): string {
  if (rider === 'none') {
    return 'Closed readable rear details; no person, pilot, rider, passenger, face, head, eyes, portrait, human body, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.';
  }
  return 'One rider only: no second person, passenger, portrait, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.';
}
