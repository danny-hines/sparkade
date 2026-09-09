import type { ControlLabel, ShooterSpec, ShooterWave } from './types';
import type { MechanicalFingerprint } from './play-styles';

export const SHOOTER_PLAY_STYLES = ['weaponSwitch', 'chargeSpecialist', 'lockOnStriker'] as const;
export type ShooterPlayStyle = (typeof SHOOTER_PLAY_STYLES)[number];

export const SHOOTER_STYLE_CATALOG: Record<ShooterPlayStyle, { name: string; summary: string }> = {
  weaponSwitch: {
    name: 'Switching assault',
    summary:
      'Tap X to switch focused twin-power fire and a wide three-shot spread. Alternate broad fragile formations with narrow armored targets. Boss pods spread apart during volleys, then the core settles for focused fire.',
  },
  chargeSpecialist: {
    name: 'Charge specialist',
    summary:
      'Hold X for 0.8 seconds, release a six-damage piercing energy bolt. Charging slows flight and pauses Y fire. Line up armored columns; boss volleys give way to a stationary exposed core that takes double charge damage.',
  },
  lockOnStriker: {
    name: 'Lock-on striker',
    summary:
      'Hold X to acquire up to four missile locks ahead of the craft, then release. Targeting slows flight and pauses Y fire. Sweep the targeting field across scattered gunships; missiles track moving targets. Boss pods fan outward and stop firing during a targeting opening.',
  },
};

export function shooterPlayStyle(spec: Pick<ShooterSpec, 'shooterStyle'>): ShooterPlayStyle {
  return spec.shooterStyle ?? 'chargeSpecialist';
}

export function shooterControlHelp(spec: Pick<ShooterSpec, 'shooterStyle'>): ControlLabel[] {
  const style = shooterPlayStyle(spec);
  return [
    ...(['LEFT', 'RIGHT', 'UP', 'DOWN'] as const).map((button) => ({ button, label: 'Move' })),
    { button: 'Y', label: 'Fire (hold)' },
    {
      button: 'X',
      label:
        style === 'weaponSwitch'
          ? 'Switch weapon'
          : style === 'lockOnStriker'
            ? 'Hold lock / release salvo'
            : 'Hold charge / release',
    },
    { button: 'B', label: 'Bomb' },
    { button: 'A', label: 'Speed toggle' },
  ];
}

/** Inspect playable geometry, not a model-authored label claiming an encounter exists. */
export type ShooterEncounter = 'wideSwarm' | 'armorColumn' | 'lockScreen' | 'pressure';
export function shooterEncounters(wave: ShooterWave): ShooterEncounter[] {
  const encounters: ShooterEncounter[] = [];
  if (wave.path === 'hold' && wave.count >= 3 && wave.formation !== 'column')
    encounters.push('lockScreen');
  if (wave.formation === 'column' && wave.count >= 2 && wave.hp >= 3 && wave.path === 'dive')
    encounters.push('armorColumn');
  if (
    (wave.formation === 'line' || wave.formation === 'arc' || wave.formation === 'vee') &&
    wave.count >= 4 &&
    wave.hp <= 2
  )
    encounters.push('wideSwarm');
  return encounters.length ? encounters : ['pressure'];
}

export function shooterStylePreference(
  recent: readonly MechanicalFingerprint[],
): ShooterPlayStyle[] {
  const used = recent
    .filter((entry) => entry.archetype === 'shooter')
    .map((entry) => entry.playStyle);
  return [...SHOOTER_PLAY_STYLES].sort((a, b) => {
    const rank = (style: string) => (used.includes(style) ? used.indexOf(style) : Infinity);
    return rank(b) - rank(a) || SHOOTER_PLAY_STYLES.indexOf(a) - SHOOTER_PLAY_STYLES.indexOf(b);
  });
}
