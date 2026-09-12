import type { FighterProjectileKind } from '@sparkade/shared';

type PixelRenderer = { rect(x: number, y: number, w: number, h: number, color: string): void };

// Hand-authored pixel silhouettes keep every effect legible at cabinet scale.
// Bright central pixels represent contact; loose embers/arcs are visual trails.
const EFFECTS: Record<
  FighterProjectileKind,
  { colors: readonly string[]; body: readonly string[] }
> = {
  energyBlast: {
    colors: ['#143658', '#246ea3', '#38cfed', '#a8f6ff', '#ffffff'],
    body: [
      '.....00000.....',
      '...001222100...',
      '..01233333210..',
      '.0123334333210.',
      '012334444433210',
      '012344444443210',
      '.0123344433210.',
      '..01233333210..',
      '...001222100...',
      '.....00000.....',
    ],
  },
  fireball: {
    colors: ['#6d1732', '#bd2f28', '#ff6935', '#ffca55', '#fff4c5'],
    body: [
      '......11.......',
      '..1..122210....',
      '...122333210...',
      '.122233433210..',
      '12233344433210.',
      '.22334444433210',
      '12223344433210.',
      '..12233333210..',
      '....1222210....',
      '...1..110......',
    ],
  },
  frostShard: {
    colors: ['#20335d', '#327ab3', '#7fcfe3', '#c4faff', '#ffffff'],
    body: [
      '......0........',
      '.....0120......',
      '....012320.....',
      '...012343210...',
      '.00123344332100',
      '012234444444321',
      '.00123344332100',
      '...012343210...',
      '....012320.....',
      '.....0120......',
      '......0........',
    ],
  },
  arcBolt: {
    colors: ['#282661', '#6154c7', '#9491ff', '#e7df80', '#fffbd6'],
    body: [
      '......10.......',
      '....1230.......',
      '..123430...10..',
      '123443222123410',
      '.0123444444320.',
      '...0122344320..',
      '......123410...',
      '.....123410....',
      '.....1340......',
      '.....10........',
    ],
  },
  spiritOrb: {
    colors: ['#35214f', '#79529e', '#b590ee', '#d9c9ff', '#fff7ff'],
    body: [
      '.....0000......',
      '...00122100....',
      '..0123333210...',
      '.012334443210..',
      '.1234433443210.',
      '01234322343210.',
      '.1234433443210.',
      '..12334443210..',
      '...122333210...',
      '..12..12210....',
      '.1.....110.....',
    ],
  },
};

export function drawFighterProjectile(
  r: PixelRenderer,
  kind: FighterProjectileKind,
  x: number,
  y: number,
  direction: number,
  age: number,
): void {
  const effect = EFFECTS[kind];
  const frame = Math.floor(age * 18) % 3;
  for (let i = 0; i < 7; i++) {
    const distance = 8 + i * 3;
    const wave = Math.round(Math.sin(i * 1.9 + frame * 2) * (kind === 'arcBolt' ? 5 : 3));
    const yy = kind === 'fireball' ? wave - Math.floor(i / 3) : wave;
    const size = i < 3 ? 3 : 2;
    r.rect(
      x - direction * distance,
      y + yy,
      size,
      kind === 'frostShard' ? 1 : size,
      effect.colors[i < 3 ? 2 : 1]!,
    );
  }
  effect.body.forEach((row, iy) =>
    [...row].forEach((color, ix) => {
      if (color === '.') return;
      // A breathing highlight changes the surface without resizing collision.
      const index = Number(color);
      const shimmer = index === 3 && (ix + iy + frame) % 5 === 0 ? 4 : index;
      r.rect(
        x + direction * (ix - 7),
        y + iy - Math.floor(effect.body.length / 2),
        1,
        1,
        effect.colors[shimmer]!,
      );
    }),
  );
  if (kind === 'arcBolt') {
    for (let i = 0; i < 4; i++)
      r.rect(
        x + direction * (i * 3 - 5),
        y + (i % 2 ? 7 : -7) + frame - 1,
        3,
        1,
        effect.colors[3]!,
      );
  }
}

export function drawFighterProjectileWindup(
  r: PixelRenderer,
  kind: FighterProjectileKind,
  x: number,
  y: number,
  progress: number,
): void {
  const colors = EFFECTS[kind].colors;
  const spread = Math.round(13 * (1 - progress)) + 3;
  const core = progress > 0.65 ? 3 : 2;
  r.rect(x - core - 1, y - core, core * 2 + 2, core * 2, colors[1]!);
  r.rect(x - core, y - core - 1, core * 2, core * 2 + 2, colors[2]!);
  r.rect(x - 1, y - 1, 2, 2, colors[4]!);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + progress * (kind === 'spiritOrb' ? 5 : 2);
    const px = x + Math.round(Math.cos(angle) * spread);
    const py = y + Math.round(Math.sin(angle) * spread);
    r.rect(px, py, kind === 'frostShard' ? 1 : 2, 2, colors[3]!);
    if (kind === 'arcBolt') r.rect(px - 2, py + 2, 3, 1, colors[2]!);
  }
}

export function drawFighterProjectileImpact(
  r: PixelRenderer,
  kind: FighterProjectileKind,
  x: number,
  y: number,
  age: number,
  guarded: boolean,
): void {
  const colors = EFFECTS[kind].colors;
  const progress = Math.min(1, age / 0.28);
  const radius = (guarded ? 10 : 22) * progress + 2;
  if (progress < 0.35) {
    r.rect(x - 5, y - 2, 10, 4, colors[4]!);
    r.rect(x - 2, y - 5, 4, 10, colors[3]!);
  }
  for (let i = 0; i < (guarded ? 6 : 10); i++) {
    const angle = i * 2.4;
    const px = x + Math.round(Math.cos(angle) * radius);
    const py = y + Math.round(Math.sin(angle) * radius - (kind === 'fireball' ? progress * 9 : 0));
    const size = progress > 0.6 ? 1 : 2;
    r.rect(
      px,
      py,
      kind === 'arcBolt' ? size * 3 : size,
      kind === 'frostShard' ? size * 2 : size,
      colors[progress < 0.5 ? 3 : 2]!,
    );
  }
}
