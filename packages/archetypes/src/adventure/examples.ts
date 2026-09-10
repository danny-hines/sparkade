import {
  adventurePuzzleGeometry,
  ADVENTURE_STYLE_CATALOG,
  type AdventurePlayStyle,
  type AdventureRoom,
  type AdventureSpec,
} from '@sparkade/shared';

/** Authored complete references share artwork, but demonstrate different objectives and routes. */
export function adventureStyleExample(
  base: AdventureSpec,
  style: AdventurePlayStyle,
): AdventureSpec {
  const spec = structuredClone(base);
  spec.adventureStyle = style;
  spec.meta.title = {
    dungeonExpedition: 'Bramble Key',
    puzzleQuest: 'Clockwork Seals',
    rescueRaid: 'Lantern Rescue',
  }[style];
  spec.meta.tagline = {
    dungeonExpedition: 'Find the key. Face the keeper.',
    puzzleQuest: 'Four seals. One clever explorer.',
    rescueRaid: 'Leave no lantern behind.',
  }[style];
  spec.story.intro = [ADVENTURE_STYLE_CATALOG[style].objective];
  spec.story.levelIntros = [
    'Explore the open branches before spending your keys.',
    style === 'puzzleQuest'
      ? 'Push blocks onto every plate. X resets an unsolved room.'
      : style === 'rescueRaid'
        ? 'Press A near a captive. Extra rescues earn bonus points.'
        : 'The secondary tool waits beyond the first lock.',
    style === 'puzzleQuest'
      ? 'Solve all preliminary seals to open the final chamber.'
      : style === 'rescueRaid'
        ? 'After the guardian falls, return to the entrance beacon.'
        : 'Bring a key and your secondary tool to the guardian gate.',
  ];
  spec.story.bossIntro =
    style === 'puzzleQuest'
      ? 'The last seal tests everything you learned.'
      : style === 'rescueRaid'
        ? 'Defeat the guardian to clear the extraction route.'
        : 'The keeper guards the heart of the ruin.';
  spec.story.victory = [
    style === 'puzzleQuest'
      ? 'Every seal sings again.'
      : style === 'rescueRaid'
        ? 'The rescued travelers reach safety together.'
        : 'The keeper rests. The ruin is free.',
  ];
  spec.boss = {
    ...spec.boss,
    hp: 20,
    phases: [
      { pattern: 'charge', tempo: 0.75 },
      { pattern: 'spiral', tempo: 0.9 },
    ],
  };
  const positions: [string, number, number][] = [
    ['entrance', 0, 1],
    ['lesson', 0, 0],
    ['crossroads', 1, 1],
    ['vault', 1, 0],
    ['garden', 2, 1],
    ['workshop', 2, 0],
    ['archive', 3, 0],
    ['finale', 3, 1],
  ];
  const rooms: AdventureRoom[] = positions.map(([id, x, y]) => ({
    id,
    gridPos: { x, y },
    tiles: Array.from({ length: 16 }, (_, row) =>
      row === 0 || row === 15 ? '#'.repeat(32) : '#' + '.'.repeat(30) + '#',
    ),
    legend: { '#': 'wall' },
    entities: [],
    doors: { n: 'none', s: 'none', e: 'none', w: 'none' },
  }));
  const room = (id: string) => rooms.find((r) => r.id === id)!;
  const link = (
    a: string,
    b: string,
    dir: 'n' | 'e' | 's' | 'w',
    kind: 'open' | 'locked' | 'boss',
  ) => {
    room(a).doors[dir] = kind;
    room(b).doors[({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[dir]] = kind;
  };
  link('entrance', 'lesson', 'n', 'open');
  link('entrance', 'crossroads', 'e', 'open');
  link('crossroads', 'vault', 'n', 'locked');
  link('crossroads', 'garden', 'e', 'open');
  link('vault', 'workshop', 'e', 'open');
  link('workshop', 'archive', 'e', 'locked');
  link('archive', 'finale', 's', 'boss');
  if (style === 'puzzleQuest') {
    const patterns = ['pushLane', 'cornerTurn', 'splitPlates', 'splitPlates'] as const;
    ['lesson', 'workshop', 'archive', 'finale'].forEach((id, i) => {
      room(id).puzzle = { pattern: patterns[i]!, variant: i === 3 ? 2 : 0 };
      Object.assign(room(id), adventurePuzzleGeometry(room(id).puzzle!));
    });
  } else
    Object.assign(room('lesson'), adventurePuzzleGeometry({ pattern: 'pushLane', variant: 0 }));
  for (const id of ['entrance', 'lesson', 'garden'])
    room(id).entities.push({ type: 'key', x: 5, y: 12 });
  room('vault').entities.push({
    type: 'item',
    x: 25,
    y: 12,
    props: { item: spec.combatKit.secondary.behavior },
  });
  room('entrance').entities.push({
    type: 'npc',
    x: 25,
    y: 12,
    props: { dialog: spec.story.levelIntros[0] },
  });
  room('crossroads').entities.push({ type: 'walker', x: 8, y: 5 }, { type: 'flyer', x: 24, y: 10 });
  room('garden').entities.push({ type: 'shooter', x: 23, y: 5 }, { type: 'chaser', x: 8, y: 10 });
  for (const id of ['vault', 'workshop', 'archive'])
    room(id).entities.push({ type: 'heart', x: 5, y: 12 });
  if (style === 'rescueRaid')
    for (const id of ['lesson', 'garden', 'vault', 'archive']) {
      room(id).entities.push({
        type: 'npc',
        x: 26,
        y: 12,
        props: { rescue: true, dialog: 'Thank you! I can reach safety now.' },
      });
    }
  spec.levels = [
    {
      rooms,
      items: { secondary: spec.combatKit.secondary.behavior },
      startRoom: 'entrance',
      bossRoom: 'finale',
      ...(style === 'rescueRaid' ? { rescueTarget: 3 } : {}),
    },
  ];
  return spec;
}
