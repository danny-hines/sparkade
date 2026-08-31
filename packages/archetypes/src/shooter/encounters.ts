import { INTERNAL_WIDTH, type ShooterWave } from '@sparkade/shared';

export const SHOOTER_SPAWN_MARGIN_PX = 28;
export const SHOOTER_DENSE_WAVE_RECOVERY_S = 1.4;
export const SHOOTER_PICKUP_CLEARANCE_S = 1.25;

export interface ShooterFormationOffset {
  x: number;
  y: number;
}

/** Canonical formation geometry shared by runtime placement and semantic linting. */
export function shooterFormationOffsets(
  wave: Pick<ShooterWave, 'count' | 'formation'>,
): ShooterFormationOffset[] {
  const count = Math.max(1, Math.floor(wave.count));
  const width = Math.max(96, (count - 1) * 32);
  return Array.from({ length: count }, (_, index) => {
    switch (wave.formation) {
      case 'line':
        return { x: (index - (count - 1) / 2) * 32, y: 0 };
      case 'vee': {
        const rank = Math.ceil(index / 2);
        const side = index === 0 ? 0 : index % 2 === 1 ? -1 : 1;
        return { x: side * rank * 26, y: rank === 0 ? 0 : -rank * 20 };
      }
      case 'column':
        return { x: 0, y: -index * 36 };
      case 'arc': {
        const fraction = count > 1 ? index / (count - 1) : 0.5;
        return { x: (fraction - 0.5) * width, y: -Math.sin(fraction * Math.PI) * 26 };
      }
    }
  });
}

export function shooterFormationBounds(wave: Pick<ShooterWave, 'count' | 'formation'>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  stagger: number;
} {
  const offsets = shooterFormationOffsets(wave);
  const minX = Math.min(...offsets.map((offset) => offset.x));
  const maxX = Math.max(...offsets.map((offset) => offset.x));
  const minY = Math.min(...offsets.map((offset) => offset.y));
  const maxY = Math.max(...offsets.map((offset) => offset.y));
  return { minX, maxX, minY, maxY, width: maxX - minX, stagger: maxY - minY };
}

/** Clamp a whole formation into the readable screen area without squeezing members together. */
export function planShooterWaveCenterX(
  wave: Pick<ShooterWave, 'count' | 'formation'>,
  preferredCenterX: number,
  screenWidth = INTERNAL_WIDTH,
): number | null {
  const bounds = shooterFormationBounds(wave);
  const minCenter = SHOOTER_SPAWN_MARGIN_PX - bounds.minX;
  const maxCenter = screenWidth - SHOOTER_SPAWN_MARGIN_PX - bounds.maxX;
  if (minCenter > maxCenter) return null;
  return Math.max(minCenter, Math.min(maxCenter, preferredCenterX));
}

export function isShooterWaveDense(wave: ShooterWave): boolean {
  return wave.count >= 6 || wave.count * wave.fireRate >= 3.2 || wave.hp * wave.count >= 24;
}
