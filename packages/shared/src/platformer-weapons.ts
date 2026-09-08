import type { PlatformerSpec } from './types';
import { platformerMechanics } from './play-styles';

export type PlatformerChargeShot = 'none' | 'plasma' | 'arcane';

/** Older blaster saves already promised charging. Keep that behavior when omitted. */
export function platformerChargeShot(
  spec: Pick<PlatformerSpec, 'playStyle' | 'mechanics' | 'chargeShot'>,
): PlatformerChargeShot {
  return platformerMechanics(spec).combat === 'blaster' ? (spec.chargeShot ?? 'plasma') : 'none';
}

export const PLATFORMER_CHARGED_SHOT = {
  chargeSeconds: 0.8,
  damage: 3,
  radius: 8,
  drawSize: 22,
  enemyHits: 3,
} as const;
