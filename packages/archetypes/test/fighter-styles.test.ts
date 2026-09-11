import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  FIGHTER_COMBAT_PROFILES,
  fighterStyleExample,
  fighterStylePreference,
  mechanicalFingerprint,
  stageSchema,
  type FighterSpec,
} from '@sparkade/shared';
import { lintFighter } from '../src/fighter/lint';

const golden = (): FighterSpec =>
  JSON.parse(readFileSync(join(__dirname, '../../generation/golden/golden-fighter.json'), 'utf8'));

it.each(FIGHTER_COMBAT_PROFILES)(
  '%s keeps the full mixed ladder valid and preserves reusable art',
  (style) => {
    const base = golden();
    const spec = fighterStyleExample(base, style);
    expect(lintFighter(spec)).toEqual([]);
    expect(spec.player.combatProfile).toBe(style);
    expect(new Set(spec.levels.map((l) => l.opponent.combatProfile))).toEqual(
      new Set(FIGHTER_COMBAT_PROFILES),
    );
    expect(spec.sprites).toEqual(base.sprites);
    expect(base.fighterStyle).toBeUndefined();
    expect(mechanicalFingerprint(spec).playStyle).toBe(style);
  },
);

it('rejects a changed player kit, a repetitive ladder, and a missing boss kit', () => {
  const spec = fighterStyleExample(golden(), 'rushdown');
  spec.player.combatProfile = 'counter';
  for (const level of spec.levels) level.opponent.combatProfile = 'counter';
  delete spec.boss.combatProfile;
  expect(lintFighter(spec).map((e) => e.code)).toEqual(
    expect.arrayContaining(['FIGHT_PLAYER_KIT', 'FIGHT_MATCHUP_VARIETY', 'FIGHT_BOSS_KIT']),
  );
  delete spec.fighterStyle;
  expect(lintFighter(spec).map((e) => e.code)).toContain('FIGHT_STYLE_REQUIRED');
});

it('keeps legacy ladders valid while requiring profiles in new generation stages', () => {
  expect(lintFighter(golden())).toEqual([]);
  expect(mechanicalFingerprint(golden())).toMatchObject({
    playStyle: 'arcadeLadder',
    weapons: ['sharedNormals'],
  });
  for (const [stage, def] of [
    ['levels', 'fighter'],
    ['entities', 'boss'],
  ] as const) {
    const schema = stageSchema('fighter', stage) as {
      $defs: Record<string, { required: string[] }>;
    };
    expect(schema.$defs[def]!.required).toContain('combatProfile');
  }
});

it('prioritizes unused profiles and recognizes roster composition beyond reskins', () => {
  expect(
    fighterStylePreference([
      { archetype: 'fighter', playStyle: 'rushdown' },
      { archetype: 'fighter', playStyle: 'counter' },
    ]),
  ).toEqual(['rangedControl', 'counter', 'rushdown']);
  const spec = fighterStyleExample(golden(), 'rushdown');
  const before = mechanicalFingerprint(spec);
  spec.meta.title = 'Another brand';
  spec.player.name = 'Another hero';
  expect(mechanicalFingerprint(spec)).toEqual(before);
  spec.boss.combatProfile = 'rangedControl';
  expect(mechanicalFingerprint(spec)).not.toEqual(before);
});
