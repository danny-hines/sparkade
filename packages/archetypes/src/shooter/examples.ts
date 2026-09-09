import { type ShooterSpec, type ShooterWave, type ShooterPlayStyle } from '@sparkade/shared';

/** Three authored comparisons share art so their mechanical differences are easy to judge. */
export function shooterStyleExample(base: ShooterSpec, style: ShooterPlayStyle): ShooterSpec {
  const spec = structuredClone(base);
  spec.shooterStyle = style;
  const titles = {
    weaponSwitch: 'Prism Patrol',
    chargeSpecialist: 'Ion Pilgrim',
    lockOnStriker: 'Kestrel Command',
  };
  spec.meta.title = titles[style];
  spec.meta.tagline = {
    weaponSwitch: 'Pick your spread. Break their line.',
    chargeSpecialist: 'Line up. Charge through.',
    lockOnStriker: 'Mark the fleet. Release the storm.',
  }[style];
  spec.story.intro = [spec.meta.tagline];
  spec.story.levelIntros = [
    {
      weaponSwitch: 'X switches focus and spread. Match your fire to their formation.',
      chargeSpecialist: 'Hold X, then release to pierce a column. Charging slows your flight.',
      lockOnStriker: 'Hold X to mark ships ahead. Release to launch up to four tracking missiles.',
    }[style],
    'Read the next formation before committing your attack.',
    'Save a bomb for the final mixed formation.',
  ];
  spec.story.bossIntro = {
    weaponSwitch: 'Spread for the wing pods. Focus when the core settles.',
    chargeSpecialist: 'Dodge the volley. Charge the exposed core for double damage.',
    lockOnStriker: 'Dodge the barrage. Mark the separated pods during their reload.',
  }[style];
  spec.boss.hp = 100;
  spec.boss.pods = style === 'lockOnStriker' ? 4 : 2;
  spec.boss.podHp = 12;
  spec.boss.phases = [
    { pattern: 'fan', bulletSpeed: 0.8, fireIntervalMs: 1600 },
    { pattern: 'aimed', bulletSpeed: 1, fireIntervalMs: 1300 },
  ];
  spec.levels = spec.levels.map((level, index) => {
    const wide: ShooterWave = {
      t: 2,
      enemyType: 'popcorn',
      count: 5,
      formation: 'arc',
      path: 'dive',
      hp: 1,
      fireRate: 0.1,
      centerX: 256,
    };
    const column: ShooterWave = {
      t: 2,
      enemyType: 'tank',
      count: 3,
      formation: 'column',
      path: 'dive',
      hp: 4 + index,
      fireRate: 0.15,
      centerX: 256,
    };
    const screen: ShooterWave = {
      t: 2,
      enemyType: 'turret',
      count: 3,
      formation: 'line',
      path: 'hold',
      hp: 3,
      fireRate: 0.3,
      centerX: 256,
    };
    const signature =
      style === 'weaponSwitch' ? wide : style === 'chargeSpecialist' ? column : screen;
    const secondary = style === 'weaponSwitch' ? column : wide;
    const waves: ShooterWave[] = [
      { ...signature },
      { ...secondary, t: 10, centerX: 180 },
      { ...signature, t: 18, centerX: 320, count: style === 'weaponSwitch' ? 6 : 3 },
      {
        t: 28,
        enemyType: 'weaver',
        count: 3,
        formation: 'vee',
        path: 'sine',
        hp: 2,
        fireRate: 0.3,
        centerX: 230,
      },
      { ...secondary, t: 38, centerX: 330 },
      { ...signature, t: 48, centerX: 180 },
      {
        t: 58,
        enemyType: 'kamikaze',
        count: 2,
        formation: 'vee',
        path: 'dive',
        hp: 2,
        fireRate: 0,
        centerX: 280,
      },
      { ...(style === 'lockOnStriker' ? column : screen), t: 70, centerX: 256 },
    ];
    return {
      ...level,
      name: ['First Contact', 'Crossing Fire', 'Fleet Breaker'][index]!,
      durationS: 80,
      waves,
      pickups: [
        { t: 7, type: 'rapid', x: 256 },
        { t: 34, type: 'shield', x: 220 },
        { t: 65, type: 'bomb', x: 280 },
      ],
    };
  });
  return spec;
}
