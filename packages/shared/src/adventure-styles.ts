import type { AdventureRoom, AdventureSpec } from './types';

export const ADVENTURE_PLAY_STYLES = ['dungeonExpedition', 'puzzleQuest', 'rescueRaid'] as const;
export type AdventurePlayStyle = (typeof ADVENTURE_PLAY_STYLES)[number];
export const ADVENTURE_STYLE_CATALOG = {
  dungeonExpedition: {
    name: 'Dungeon expedition',
    objective: 'Find the tool, unlock the guardian, and win the duel.',
  },
  puzzleQuest: {
    name: 'Puzzle quest',
    objective:
      'Push blocks onto every plate to solve the seals, then solve the final chamber. X resets the current puzzle.',
  },
  rescueRaid: {
    name: 'Rescue raid',
    objective:
      'Rescue the required captives with A, defeat the guardian, then return to the entrance and press A to extract. Extra rescues earn bonus points.',
  },
} as const;
export function adventurePlayStyle(
  spec: Pick<AdventureSpec, 'adventureStyle'>,
): AdventurePlayStyle {
  return spec.adventureStyle ?? 'dungeonExpedition';
}
export function adventureStylePreference(
  recent: readonly { archetype: string; playStyle: string }[],
): AdventurePlayStyle[] {
  const score = (style: string) =>
    recent.reduce(
      (sum, game, i) =>
        sum + (game.archetype === 'adventure' && game.playStyle === style ? 1 / (i + 1) : 0),
      0,
    );
  return [...ADVENTURE_PLAY_STYLES].sort((a, b) => score(a) - score(b));
}

export const ADVENTURE_PUZZLE_PATTERNS = ['pushLane', 'cornerTurn', 'splitPlates'] as const;
export type AdventurePuzzle = {
  pattern: (typeof ADVENTURE_PUZZLE_PATTERNS)[number];
  variant: 0 | 1 | 2;
};

/** Full room geometry for a bounded puzzle; mirrors change approach without touching door landings. */
export function adventurePuzzleGeometry(
  puzzle: AdventurePuzzle,
): Pick<AdventureRoom, 'tiles' | 'legend'> {
  const cells: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => (x === 0 || x === 31 || y === 0 || y === 15 ? '#' : '.')),
  );
  const put = (x: number, y: number, value: string) => {
    const px = puzzle.variant === 1 ? 31 - x : x;
    const py = puzzle.variant === 2 ? 15 - y : y;
    cells[py]![px] = value;
  };
  if (puzzle.pattern === 'pushLane') {
    for (let x = 7; x <= 12; x++) {
      put(x, 5, '#');
      put(x, 7, '#');
    }
    put(8, 6, 'B');
    put(11, 6, 'S');
    put(12, 6, '#');
  } else if (puzzle.pattern === 'cornerTurn') {
    put(9, 5, 'B');
    put(10, 5, '#');
    put(11, 7, 'S');
    put(12, 7, '#');
    put(9, 8, '#');
  } else {
    put(8, 6, 'B');
    put(11, 6, 'S');
    put(12, 6, '#');
    put(23, 9, 'B');
    put(20, 9, 'S');
    put(19, 9, '#');
  }
  // Clearly visible hazard patch retracts when the circuit completes; no damage is required.
  for (let x = 21; x <= 24; x++) put(x, 5, '!');
  return {
    tiles: cells.map((row) => row.join('')),
    legend: { '#': 'wall', B: 'block', S: 'switch', '!': 'hazard' },
  };
}
