import type { GameSpec, LintError, PlatformerSpec } from './types';

export const PLATFORMER_PLAY_STYLES = [
  'acrobat',
  'runAndGun',
  'towerClimber',
  'meleeAction',
  'armedClimber',
] as const;
export type PlatformerPlayStyle = (typeof PLATFORMER_PLAY_STYLES)[number];

export interface PlatformerMechanics {
  traversal: 'jump' | 'wallJump';
  combat: 'stomp' | 'blaster' | 'melee';
  structure: 'horizontal' | 'tower' | 'mixed';
}

const PRESET_MECHANICS: Record<PlatformerPlayStyle, PlatformerMechanics> = {
  acrobat: { traversal: 'jump', combat: 'stomp', structure: 'horizontal' },
  runAndGun: { traversal: 'jump', combat: 'blaster', structure: 'horizontal' },
  towerClimber: { traversal: 'wallJump', combat: 'stomp', structure: 'tower' },
  meleeAction: { traversal: 'jump', combat: 'melee', structure: 'horizontal' },
  armedClimber: { traversal: 'wallJump', combat: 'blaster', structure: 'mixed' },
};

/** Presets select tested combinations; the runtime consumes the independent components. */
export function platformerMechanics(
  spec: Pick<PlatformerSpec, 'playStyle' | 'mechanics'>,
): PlatformerMechanics {
  return { ...PRESET_MECHANICS[spec.playStyle ?? 'acrobat'], ...spec.mechanics };
}

export function platformerTowerLevel(
  spec: Pick<PlatformerSpec, 'playStyle' | 'mechanics'>,
  level: { tiles: string[] },
): boolean {
  const { structure } = platformerMechanics(spec);
  return structure === 'tower' || (structure === 'mixed' && level.tiles.length > 32);
}

/** Released packages only. The model selects a package; runtime owns its balance. */
export const PLATFORMER_STYLE_CATALOG: Record<
  PlatformerPlayStyle,
  {
    name: string;
    summary: string;
    objective: string;
  }
> = {
  acrobat: {
    name: 'Acrobat',
    summary: 'Momentum, spin jumps, bouncing and optional ability pickups on a horizontal course.',
    objective: 'Reach the exit',
  },
  runAndGun: {
    name: 'Run and gun',
    summary:
      'A permanent starting blaster. Y fires, X charges, UP aims upward. Defeat enemies by shooting; contact is dangerous.',
    objective: 'Fight to the exit',
  },
  towerClimber: {
    name: 'Tower climber',
    summary:
      'Permanent wall slide and wall jump. Climb tall levels from the bottom to the summit using solid walls and safe rest ledges.',
    objective: 'Reach the summit',
  },
  meleeAction: {
    name: 'Melee action',
    summary:
      'A permanent close-range energy strike. Y attacks with windup and recovery. Active descending strikes damage enemies and bounce; ordinary jump contact hurts. Approach on foot or from the air.',
    objective: 'Fight to the exit',
  },
  armedClimber: {
    name: 'Armed climber',
    summary:
      'Permanent blaster and wall slide/jump. Keep charge through jumps, fire away from a wall, and alternate shooting lanes with vertical combat climbs. A jumps, B runs, Y fires, X charges, UP aims upward.',
    objective: 'Climb and fight to the exit',
  },
};

export function platformerPlayStyle(spec: Pick<PlatformerSpec, 'playStyle'>): PlatformerPlayStyle {
  return spec.playStyle ?? 'acrobat';
}

/** Checked on the design before level/image work, and again on the final game. */
export function platformerStyleDiagnostics(
  spec: Pick<
    PlatformerSpec,
    'playStyle' | 'mechanics' | 'movementProfile' | 'feel' | 'abilityLoadout'
  >,
): LintError[] {
  const out: LintError[] = [];
  const style = platformerPlayStyle(spec);
  const mechanics = platformerMechanics(spec);
  const preset = PRESET_MECHANICS[style];
  if (
    mechanics.traversal !== preset.traversal ||
    mechanics.combat !== preset.combat ||
    (style !== 'armedClimber' && mechanics.structure !== preset.structure)
  ) {
    out.push({
      code: 'PLAT_KIT_INCOMPATIBLE',
      path: '/mechanics',
      message:
        'Choose a tested preset combination. armedClimber combines wallJump and blaster with horizontal, tower or mixed structure; other presets retain their defined components.',
    });
  }
  if (
    (mechanics.traversal === 'wallJump' || preset.traversal === 'wallJump') &&
    (spec.movementProfile !== 'precision' || spec.feel)
  ) {
    out.push({
      code: 'PLAT_STYLE_MOVEMENT',
      path: '/movementProfile',
      message:
        'Wall-jump kits use the validated precision controller; set movementProfile to precision and omit feel',
    });
  }
  if (
    mechanics.combat === 'blaster' &&
    !spec.abilityLoadout?.some((a) => a.kind === 'projectile')
  ) {
    out.push({
      code: 'PLAT_STYLE_LOADOUT',
      path: '/abilityLoadout',
      message:
        'Blaster kits require a named projectile ability; the blaster is equipped from the start',
    });
  }
  if (mechanics.combat === 'melee' && spec.abilityLoadout?.some((a) => a.kind === 'projectile')) {
    out.push({
      code: 'PLAT_STYLE_LOADOUT',
      path: '/abilityLoadout',
      message:
        'meleeAction uses the permanent energy strike; select shield and/or doubleJump pickups instead of projectile',
    });
  }
  if (style === 'towerClimber' && spec.abilityLoadout?.some((a) => a.kind !== 'shield')) {
    out.push({
      code: 'PLAT_STYLE_LOADOUT',
      path: '/abilityLoadout',
      message: 'towerClimber uses permanent wall jumping; select shield pickups only',
    });
  }
  if (
    mechanics.traversal === 'wallJump' &&
    spec.abilityLoadout?.some((a) => a.kind === 'doubleJump')
  ) {
    out.push({
      code: 'PLAT_STYLE_LOADOUT',
      path: '/abilityLoadout',
      message: 'Wall-jump kits support shield and their starting blaster, not doubleJump pickups.',
    });
  }
  return out;
}

export interface MechanicalFingerprint {
  version: 1;
  archetype: GameSpec['archetype'];
  playStyle: string;
  movement: string;
  weapons: string[];
  objective: string;
  topology: string;
  progression: string;
  encounters: string[];
}

/** Derived from the final spec, including old saves, never from an unfulfilled design promise. */
export function mechanicalFingerprint(spec: GameSpec): MechanicalFingerprint {
  const base = { version: 1 as const, archetype: spec.archetype };
  switch (spec.archetype) {
    case 'platformer': {
      const style = platformerPlayStyle(spec);
      const kit = platformerMechanics(spec);
      return {
        ...base,
        playStyle: style,
        movement: `${spec.movementProfile ?? 'balanced'}${kit.traversal === 'wallJump' ? '+wallJump' : ''}`,
        weapons: [
          ...new Set([
            ...(kit.combat === 'blaster'
              ? ['startingBlaster', ...(spec.chargeShot === 'none' ? [] : ['chargeShot'])]
              : []),
            ...(kit.combat === 'melee' ? ['committedMelee'] : []),
            ...(kit.combat === 'stomp' ? ['stomp'] : []),
            ...(spec.abilityLoadout?.map((a) => a.kind) ?? ['legacyPickups']),
          ]),
        ].sort(),
        objective: kit.structure === 'tower' ? 'summit' : 'exit',
        topology:
          kit.structure === 'tower'
            ? 'verticalCourse'
            : kit.structure === 'mixed'
              ? 'mixedCourse'
              : 'horizontalCourse',
        progression: style === 'acrobat' ? 'pickupAbilities' : 'permanentSignature+pickups',
        encounters: [
          ...new Set(
            spec.levels.flatMap((level) => [
              ...(level.encounters?.sections.flatMap((s) => [
                `pattern:${s.pattern}`,
                `variant:${s.pattern}:${s.variant}`,
                ...(s.modifier && s.modifier !== 'none'
                  ? [`modifier:${s.pattern}:${s.modifier}`]
                  : []),
              ]) ?? []),
              ...level.entities.map((e) => e.type),
              ...[...new Set(level.tiles.join(''))].flatMap((ch) =>
                level.legend[ch] ? [level.legend[ch]!] : [],
              ),
            ]),
          ),
        ].sort(),
      };
    }
    case 'adventure':
      return {
        ...base,
        playStyle: 'toolDungeon',
        movement: 'topDown',
        weapons: [
          spec.combatKit?.primary?.profile ?? 'legacyPrimary',
          spec.combatKit?.secondary?.behavior ?? 'legacySecondary',
        ].sort(),
        objective: 'unlockBoss',
        topology: 'roomGraph',
        progression: 'keys+secondaryItem',
        encounters: [
          ...new Set(
            spec.levels.flatMap((d) => d.rooms.flatMap((r) => r.entities.map((e) => e.type))),
          ),
        ].sort(),
      };
    case 'fighter':
      return {
        ...base,
        playStyle: 'arcadeLadder',
        movement: spec.player.build,
        weapons: ['sharedNormals'],
        objective: 'winBouts',
        topology: 'duelArena',
        progression: 'bestOfThree',
        encounters: [...new Set(spec.levels.map((l) => l.opponent.build))].sort(),
      };
    case 'shooter':
    case 'hshooter':
      return {
        ...base,
        playStyle: spec.archetype === 'shooter' ? 'formationShooter' : 'corridorShooter',
        movement: 'twoSpeedFlight',
        weapons: [
          'shot',
          'charge',
          'bomb',
          ...new Set(spec.levels.flatMap((l) => l.pickups.map((p) => p.type))),
        ].sort(),
        objective: 'surviveWaves+boss',
        topology: spec.archetype === 'shooter' ? 'verticalScroll' : 'terrainCorridor',
        progression: 'weaponPickups',
        encounters: [
          ...new Set(
            spec.levels.flatMap((l) =>
              l.waves.map((w) => `${w.enemyType}:${w.formation}:${w.path}`),
            ),
          ),
        ].sort(),
      };
  }
}

/** A recency preference, never a ban or an override of the player's requested mechanics. */
export function platformerStylePreference(
  recent: readonly MechanicalFingerprint[],
): PlatformerPlayStyle[] {
  const penalty = (style: PlatformerPlayStyle) =>
    recent.reduce(
      (sum, game, i) =>
        sum + (game.archetype === 'platformer' && game.playStyle === style ? 1 / (i + 1) : 0),
      0,
    );
  return [...PLATFORMER_PLAY_STYLES].sort((a, b) => penalty(a) - penalty(b));
}
