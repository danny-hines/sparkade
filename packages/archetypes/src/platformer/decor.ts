import type { Coord, PlatformerLevel, PlatformerTileType } from '@sparkade/shared';

const MIN_HORIZONTAL_SPACING = 6;
const IMPORTANT_RADIUS_X = 3;
const IMPORTANT_RADIUS_Y = 2;
const FIXTURE_RADIUS_X = 2;
const FIXTURE_RADIUS_Y = 2;

type CellKind = PlatformerTileType;

/**
 * Stable coordinate hash for cosmetic placement. Keeping this local means
 * decoration never advances the engine's gameplay RNG stream.
 */
function placementScore(seed: number, x: number, y: number): number {
  let h = (
    (Math.trunc(seed) >>> 0) ^
    Math.imul(x + 1, 0x9e3779b1) ^
    Math.imul(y + 1, 0x85ebca77)
  ) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Pick sparse, deterministic walk-through decoration cells from the authored
 * terrain. Decorations and exit markers in the source grid are deliberately
 * treated as empty: their placement is engine-owned, not model-authored.
 */
export function surfaceDecorations(level: PlatformerLevel, seed: number): Coord[] {
  const h = level.tiles.length;
  const w = level.tiles[0]?.length ?? 0;
  if (w === 0 || h < 3) return [];

  const rawKindAt = (x: number, y: number): CellKind => {
    if (x < 0 || x >= w || y < 0 || y >= h) return 'empty';
    const ch = level.tiles[y]?.[x];
    if (ch === undefined || ch === '.') return 'empty';
    return level.legend[ch] ?? 'empty';
  };
  const terrainKindAt = (x: number, y: number): CellKind => {
    const kind = rawKindAt(x, y);
    return kind === 'decoration' || kind === 'exit' ? 'empty' : kind;
  };

  const protectedCells = new Set<number>();
  const protect = (cx: number, cy: number, rx: number, ry: number): void => {
    const centerX = Math.round(cx);
    const centerY = Math.round(cy);
    for (let y = centerY - ry; y <= centerY + ry; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = centerX - rx; x <= centerX + rx; x++) {
        if (x >= 0 && x < w) protectedCells.add(y * w + x);
      }
    }
  };

  // Leave entrances and the player's initial landing visually clear.
  protect(level.playerSpawn.x, level.playerSpawn.y, IMPORTANT_RADIUS_X, IMPORTANT_RADIUS_Y);
  protect(level.exit.x, level.exit.y, IMPORTANT_RADIUS_X, IMPORTANT_RADIUS_Y);

  // Tile fixtures and danger zones need breathing room of their own.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const kind = rawKindAt(x, y);
      if (kind === 'checkpoint' || kind === 'hazard') {
        protect(x, y, FIXTURE_RADIUS_X, FIXTURE_RADIUS_Y);
      }
    }
  }

  // Protect every entity, including pickups and springs. Moving platforms
  // reserve their whole authored travel segment rather than only their origin.
  for (const entity of level.entities) {
    if (entity.type === 'movingPlatform') {
      const dx = entity.props?.dx ?? 0;
      const dy = entity.props?.dy ?? 0;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        protect(
          entity.x + dx * t,
          entity.y + dy * t,
          FIXTURE_RADIUS_X,
          FIXTURE_RADIUS_Y,
        );
      }
    } else {
      protect(entity.x, entity.y, FIXTURE_RADIUS_X, FIXTURE_RADIUS_Y);
    }
  }

  const candidates: Coord[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      if (protectedCells.has(y * w + x)) continue;
      // The decoration occupies one tile, while the open tile above preserves
      // a clean two-tile-high corridor for the taller player silhouette.
      if (terrainKindAt(x, y) !== 'empty' || terrainKindAt(x, y - 1) !== 'empty') continue;
      const support = terrainKindAt(x, y + 1);
      if (support !== 'solid' && support !== 'platform') continue;
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    const byScore = placementScore(seed, a.x, a.y) - placementScore(seed, b.x, b.y);
    return byScore || a.x - b.x || a.y - b.y;
  });

  // About one decoration per twelve viable surface cells, bounded again by
  // level width. Horizontal spacing is global so stacked ledges do not form
  // conspicuous vertical decoration columns.
  const target = Math.min(
    Math.ceil(candidates.length / 12),
    Math.max(1, Math.floor(w / MIN_HORIZONTAL_SPACING)),
  );
  const selected: Coord[] = [];
  for (const candidate of candidates) {
    if (selected.every((other) => Math.abs(other.x - candidate.x) >= MIN_HORIZONTAL_SPACING)) {
      selected.push(candidate);
      if (selected.length >= target) break;
    }
  }

  return selected.sort((a, b) => a.x - b.x || a.y - b.y);
}
