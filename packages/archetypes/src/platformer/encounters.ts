import {
  PLATFORMER_ENCOUNTERS,
  type EncounterEnemy,
  type PlatformerEncounterRoute,
  type PlatformerEncounterSection,
  type PlatformerLevel,
  type PlatformerSpec,
  type LintError,
  platformerPlayStyle,
  platformerMechanics,
} from '@sparkade/shared';

type Geometry = Omit<PlatformerLevel, 'name' | 'musicSong'>;
const enemyTypes = ['walker', 'flyer', 'shooter', 'chaser'];

export function compilePlatformerEncounterRoute(value: unknown): Geometry {
  if (!value || typeof value !== 'object') throw new Error('encounterRoute must be an object');
  const route = value as PlatformerEncounterRoute;
  if (
    !['horizontal', 'tower'].includes(route.orientation) ||
    !['left', 'right'].includes(route.direction) ||
    !Array.isArray(route.sections) ||
    route.sections.length < 5 ||
    route.sections.length > 6 ||
    Object.keys(route).some((k) => !['orientation', 'direction', 'sections'].includes(k))
  )
    throw new Error('encounterRoute needs an orientation, direction and 5-6 sections');
  route.sections.forEach((s, i) => {
    const pattern = s && PLATFORMER_ENCOUNTERS[s.pattern];
    if (
      !pattern ||
      pattern.orientation !== route.orientation ||
      !pattern.enemies.includes(s.enemy) ||
      !Number.isInteger(s.variant) ||
      s.variant < 0 ||
      s.variant > 2 ||
      !['introduce', 'develop', 'test'].includes(s.challenge) ||
      !['coins', 'heart', 'doubleJump', 'projectile', 'shield'].includes(s.reward) ||
      Object.keys(s).some(
        (k) => !['pattern', 'variant', 'challenge', 'enemy', 'reward'].includes(k),
      )
    )
      throw new Error(
        `invalid encounter section ${i}: check pattern, enemy and variant compatibility`,
      );
    if (i && s.pattern === route.sections[i - 1]!.pattern)
      throw new Error('adjacent encounters must use different patterns');
  });
  if (route.sections[0]!.challenge !== 'introduce' || route.sections.at(-1)!.challenge !== 'test')
    throw new Error('begin each route with introduce and end with test');
  if (new Set(route.sections.map((s) => s.pattern)).size < 3)
    throw new Error('each route needs at least three distinct patterns');

  const tower = route.orientation === 'tower';
  const width = tower ? 32 : 16 + route.sections.reduce((sum, s) => sum + 24 + s.variant * 2, 0);
  const height = tower ? 8 + route.sections.reduce((sum, s) => sum + 8 + s.variant, 0) : 18;
  const cells = Array.from({ length: height }, (_, y) =>
    Array<string>(width).fill(y >= height - (tower ? 1 : 2) ? '#' : '.'),
  );
  const entities: PlatformerLevel['entities'] = [];
  const tile = (x: number, y: number, ch: string) => {
    if (x < 0 || x >= width || y < 0 || y >= height)
      throw new Error('encounter terrain out of bounds');
    cells[y]![x] = ch;
  };
  const rect = (x: number, y: number, w: number, h: number, ch = '#') => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) tile(xx, yy, ch);
  };
  const platform = (x: number, y: number, w: number) => rect(x, y, w, 1, '=');
  const enemy = (
    type: EncounterEnemy,
    x: number,
    y: number,
    s: PlatformerEncounterSection,
    secondary = false,
  ) => {
    if (type === 'none') return;
    entities.push({
      type,
      x,
      y: type === 'flyer' ? y - 2 : y,
      props: {
        range: 1,
        speed: s.challenge === 'introduce' ? 0.6 : s.challenge === 'test' ? 0.9 : 0.75,
        amplitude: 0.5,
        periodMs: 3000,
        fireIntervalMs: secondary
          ? 3900
          : s.challenge === 'introduce'
            ? 3600
            : s.challenge === 'test'
              ? 2800
              : 3200,
      },
    });
  };
  const reward = (s: PlatformerEncounterSection, x: number, y: number) => {
    if (s.reward === 'coins') entities.push({ type: 'coin', x, y });
    else if (s.reward === 'heart') entities.push({ type: 'heart', x, y });
    else entities.push({ type: 'powerup', x, y, props: { kind: s.reward } });
  };
  let playerSpawn = { x: 2, y: 15 },
    exit = { x: width - 4, y: 15 };
  if (!tower) {
    let start = 8;
    route.sections.forEach((s, index) => {
      const span = 24 + s.variant * 2,
        shift = s.variant;
      let enemyX = start + span - 3,
        enemyY = 15;
      switch (s.pattern) {
        case 'bounce-run':
          rect(start + 9 + shift, 16, 2 + (s.variant % 2), 1, '.');
          rect(start + 9 + shift, 17, 2 + (s.variant % 2), 1, '!');
          platform(start + 14 + shift, 13, 4);
          if (s.challenge === 'test') enemy('walker', start + 5, 15, s, true);
          break;
        case 'stepped-route':
          for (let step = 0; step < 5; step++) {
            const rise = 3 - Math.abs(2 - step);
            rect(start + 6 + step * 2 + shift, 16 - rise, 2, rise);
          }
          break;
        case 'high-low':
          platform(start + 4 + shift, 13, 4);
          platform(start + 10 + shift, 11, 7);
          platform(start + 18 + shift, 13, 3);
          entities.push({ type: 'coin', x: start + 13 + shift, y: 10 });
          break;
        case 'cover-advance':
          rect(start + 7 + shift, 14, 2, 2);
          rect(start + 14 + shift, 14, 2, 2);
          break;
        case 'overhead-targets':
          platform(start + 6 + shift, 14, 4);
          platform(start + 13 + shift, 12, 6);
          enemyX = start + 16 + shift;
          enemyY = 11;
          break;
        case 'patrol-duel':
          platform(start + 7 + shift, 13, 3);
          if (s.challenge === 'test')
            enemy(s.enemy === 'chaser' ? 'walker' : 'chaser', start + 6, 15, s, true);
          break;
        case 'jump-in':
          platform(start + 5 + shift, 14, 4);
          platform(start + 10 + shift, 12, 5);
          enemyX = start + 17 + shift;
          break;
        case 'crossfire-break':
          platform(start + 6 + shift, 13, 5);
          rect(start + 14 + shift, 14, 2, 2);
          if (s.challenge !== 'introduce' && s.enemy !== 'none')
            enemy('shooter', start + 9 + shift, 12, s, true);
          break;
      }
      enemy(s.enemy, enemyX, enemyY, s);
      // Coins and rewards sit on the guaranteed lower route, outside obstacle cells.
      for (const dx of [1, 3, span - 2]) entities.push({ type: 'coin', x: start + dx, y: 15 });
      reward(s, start + 2, 15);
      if (index === 1 || index === route.sections.length - 2) tile(start + 1, 15, 'C');
      start += span;
    });
  } else {
    let surface = height - 1;
    let right = route.direction === 'right';
    playerSpawn = { x: 15, y: surface - 1 };
    route.sections.forEach((s, index) => {
      if (s.pattern === 'switchback-climb') right = !right;
      const rise = 8 + s.variant,
        top = surface - rise;
      rect(right ? 22 : 0, top, 10, rise);
      platform(10, top, 12);
      const rest = right ? 12 : 19,
        threat = right ? 17 : 14;
      if (s.pattern === 'sheltered-climb') {
        platform(right ? 18 : 10, top + Math.floor(rise / 2), 4);
        rect(right ? 16 : 15, top - 1, 1, 1);
      }
      if (s.pattern === 'armed-ascent') platform(right ? 17 : 12, top + 3, 3);
      enemy(s.enemy, threat, top - 1, s);
      for (const dx of [-1, 0, 1]) entities.push({ type: 'coin', x: rest + dx, y: top - 1 });
      reward(s, rest, top - 2);
      if (index === 1 || index === route.sections.length - 2) tile(rest, top - 1, 'C');
      exit = { x: rest, y: top - 1 };
      surface = top;
    });
  }
  if (!tower && route.direction === 'left') {
    cells.forEach((row) => row.reverse());
    playerSpawn.x = width - 1 - playerSpawn.x;
    exit.x = width - 1 - exit.x;
    entities.forEach((e) => {
      e.x = width - 1 - e.x;
    });
  }
  return {
    tiles: cells.map((row) => row.join('')),
    legend: { '#': 'solid', '=': 'platform', '!': 'hazard', C: 'checkpoint' },
    entities,
    playerSpawn,
    exit,
    encounters: { ...structuredClone(route), version: 1 },
  };
}

function geometryKey(level: Geometry): string {
  // Sort keys so harmless JSON property ordering does not invalidate provenance.
  return JSON.stringify([
    level.tiles,
    Object.entries(level.legend).sort(),
    level.playerSpawn.x,
    level.playerSpawn.y,
    level.exit.x,
    level.exit.y,
    level.entities.map((e) => [e.type, e.x, e.y, Object.entries(e.props ?? {}).sort()]),
  ]);
}

/** Validates the delivered artifact, including repair attempts, without trusting labels alone. */
export function lintPlatformerEncounters(spec: PlatformerSpec): LintError[] {
  const out: LintError[] = [];
  const fail = (code: string, path: string, message: string) => out.push({ code, path, message });
  if (spec.levels.some((level) => level.encounters) && spec.encounterVersion !== 1)
    fail(
      'PLAT_ENCOUNTER_VERSION',
      '/encounterVersion',
      'Compiled encounters require encounterVersion 1 so their firing and boss pacing contract is active.',
    );
  const style = platformerPlayStyle(spec),
    kit = platformerMechanics(spec);
  spec.levels.forEach((level, i) => {
    const path = `/levels/${i}`;
    if (!level.encounters) {
      if (spec.encounterVersion === 1)
        fail(
          'PLAT_ENCOUNTER_MISSING',
          path,
          'Regenerate this level with encounterRoute; retain its encounter contract.',
        );
      return;
    }
    const { version, ...route } = level.encounters;
    if (version !== 1) return;
    let compiled: Geometry;
    try {
      compiled = compilePlatformerEncounterRoute(route);
    } catch (error) {
      fail('PLAT_ENCOUNTER_PLAN', `${path}/encounters`, String(error));
      return;
    }
    if (geometryKey(compiled) !== geometryKey(level))
      fail(
        'PLAT_ENCOUNTER_DRIFT',
        path,
        'Encounter geometry or entities changed after compilation; regenerate the encounterRoute instead of flattening the course or keeping stale labels.',
      );
    for (const [j, s] of route.sections.entries()) {
      if (!PLATFORMER_ENCOUNTERS[s.pattern].styles.includes(style))
        fail(
          'PLAT_ENCOUNTER_KIT',
          `${path}/encounters/sections/${j}`,
          `${s.pattern} does not support ${style}`,
        );
    }
    if (
      (kit.structure === 'tower' && route.orientation !== 'tower') ||
      (kit.structure === 'horizontal' && route.orientation !== 'horizontal')
    )
      fail(
        'PLAT_ENCOUNTER_ORIENTATION',
        `${path}/encounters`,
        'The encounter route must use the selected gameplay structure.',
      );
    const anchors = [level.playerSpawn, level.exit];
    level.tiles.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (level.legend[ch] === 'checkpoint') anchors.push({ x, y });
      }),
    );
    for (const [j, e] of level.entities.entries()) {
      if (!enemyTypes.includes(e.type)) continue;
      if (anchors.some((a) => Math.abs(a.x - e.x) < 4 && Math.abs(a.y - e.y) < 3))
        fail(
          'PLAT_ENCOUNTER_UNSAFE_ANCHOR',
          `${path}/entities/${j}`,
          'Keep enemies at least four tiles horizontally or three tiles vertically from spawns, checkpoints and exits.',
        );
      if (e.type === 'shooter' && (e.props?.fireIntervalMs ?? 0) < 2400)
        fail(
          'PLAT_ENCOUNTER_VOLLEY',
          `${path}/entities/${j}`,
          'Give shooters a readable firing interval of at least 2400 ms.',
        );
      if (e.type !== 'flyer') {
        const kind = (x: number, y: number) => level.legend[level.tiles[y]?.[x] ?? '.'];
        const standing = (x: number) =>
          x >= 0 &&
          x < level.tiles[0]!.length &&
          !['solid', 'platform', 'hazard'].includes(kind(x, e.y) ?? '') &&
          !['solid', 'platform', 'hazard'].includes(kind(x, e.y - 1) ?? '') &&
          ['solid', 'platform'].includes(kind(x, e.y + 1) ?? '');
        if (![-1, 1].some((dir) => [1, 2].every((distance) => standing(e.x + dir * distance))))
          fail(
            'PLAT_ENCOUNTER_APPROACH',
            `${path}/entities/${j}`,
            'A ground threat needs at least two supported, body-clear approach/retreat cells on one side.',
          );
        const below = level.legend[level.tiles[e.y + 1]?.[e.x] ?? '.'];
        if (!['solid', 'platform'].includes(below ?? ''))
          fail(
            'PLAT_ENCOUNTER_ENEMY_SUPPORT',
            `${path}/entities/${j}`,
            'Ground enemies need a supported fighting surface.',
          );
      }
    }
  });
  return out;
}
