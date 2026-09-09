import { describe, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import {
  shooterEncounters,
  mechanicalFingerprint,
  shooterControlHelp,
  shooterStylePreference,
  SHOOTER_PLAY_STYLES,
  type ShooterSpec,
} from '@sparkade/shared';
import { shooterStyleExample } from '../src/shooter/examples';
import { lintShooter } from '../src/shooter/lint';
import { ShooterLocks, shooterBossOpening } from '../src/shooter/weapons';

describe('shooter play styles', () => {
  const base = loadGolden('shooter') as ShooterSpec;
  it.each(SHOOTER_PLAY_STYLES)(
    '%s authors a complete playable timeline with truthful controls',
    (style) => {
      const spec = shooterStyleExample(base, style);
      expect(lintShooter(spec)).toEqual([]);
      expect(mechanicalFingerprint(spec).playStyle).toBe(style);
      expect(shooterControlHelp(spec).find((c) => c.button === 'X')?.label).toBe(
        style === 'weaponSwitch'
          ? 'Switch weapon'
          : style === 'chargeSpecialist'
            ? 'Hold charge / release'
            : 'Hold lock / release salvo',
      );
      const broken = structuredClone(spec);
      broken.levels[0]!.waves = broken.levels[0]!.waves.map((w) => ({ ...w, count: 1 }));
      expect(
        lintShooter(broken).some(
          (e) => e.code === 'SHOOT_STYLE_ENCOUNTERS' && e.path === '/levels/0/waves',
        ),
      ).toBe(true);
    },
  );
  it('recognizes a broad holding swarm as both coverage and targeting geometry', () => {
    expect(
      shooterEncounters({
        t: 2,
        enemyType: 'popcorn',
        formation: 'line',
        count: 4,
        hp: 1,
        path: 'hold',
        fireRate: 0,
      }),
    ).toEqual(['lockScreen', 'wideSwarm']);
  });
  it('prefers unseen styles and keeps a cosmetic reskin mechanically identical', () => {
    const spec = shooterStyleExample(base, 'weaponSwitch');
    const fingerprint = mechanicalFingerprint(spec);
    spec.meta.title = 'Reskinned';
    expect(mechanicalFingerprint(spec)).toEqual(fingerprint);
    expect(shooterStylePreference([fingerprint])).toEqual([
      'chargeSpecialist',
      'lockOnStriker',
      'weaponSwitch',
    ]);
  });
  it('acquires distinct targets before stacking and releases stale spawns and out-of-field locks', () => {
    const locks = new ShooterLocks();
    const targets = [
      { key: 'a:1', x: 220, y: 90 },
      { key: 'b:1', x: 280, y: 90 },
      { key: 'behind', x: 256, y: 290 },
    ];
    for (let i = 0; i < 80; i++) locks.update(1 / 60, targets, 256, 270);
    expect(locks.keys).toHaveLength(4);
    expect(new Set(locks.keys)).toEqual(new Set(['a:1', 'b:1']));
    locks.update(0, [{ key: 'a:2', x: 220, y: 90 }], 256, 270);
    expect(locks.keys).toEqual([]);
    locks.update(0.4, targets, 256, 270);
    locks.update(0, targets, 500, 270);
    expect(locks.keys).toEqual([]);
    locks.clear();
    expect(locks.progress).toBe(0);
  });
  it('offers a 2.4 second boss opening after a 4.8 second attack and preserves unstyled cadence', () => {
    expect(shooterBossOpening(6.79, true)).toBe(false);
    expect(shooterBossOpening(6.81, true)).toBe(true);
    expect(shooterBossOpening(9.21, true)).toBe(false);
    expect(shooterBossOpening(7, false)).toBe(false);
  });
});
