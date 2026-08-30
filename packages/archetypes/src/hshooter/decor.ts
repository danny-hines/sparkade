import type { Coord, HShooterLevel, HShooterTileType } from '@sparkade/shared';

const MIN_HORIZONTAL_SPACING = 9;
const EDGE_CLEARANCE = 5;

function placementScore(seed: number, x: number, y: number): number {
  let h =
    ((Math.trunc(seed) >>> 0) ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Select sparse cosmetic detail cells on exposed solid terrain. Decorations
 * overlay the solid cell itself, so they never consume flight-lane clearance
 * or change collision and do not need to participate in route validation.
 */
export function corridorSurfaceDecorations(level: HShooterLevel, seed: number): Coord[] {
  const rows = level.tiles.length;
  const cols = level.tiles[0]?.length ?? 0;
  if (rows === 0 || cols <= EDGE_CLEARANCE * 2) return [];

  const kindAt = (x: number, y: number): HShooterTileType => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return 'empty';
    const ch = level.tiles[y]?.[x];
    if (ch === undefined || ch === '.') return 'empty';
    return level.legend[ch] ?? 'empty';
  };

  const candidates: Coord[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = EDGE_CLEARANCE; x < cols - EDGE_CLEARANCE; x++) {
      if (kindAt(x, y) !== 'solid') continue;
      const neighbours = [
        { x, y: y - 1 },
        { x: x + 1, y },
        { x, y: y + 1 },
        { x: x - 1, y },
      ];
      if (
        !neighbours.some(
          (cell) =>
            cell.x >= 0 &&
            cell.x < cols &&
            cell.y >= 0 &&
            cell.y < rows &&
            (kindAt(cell.x, cell.y) === 'empty' || kindAt(cell.x, cell.y) === 'decoration'),
        )
      ) {
        continue;
      }

      let nearHazard = false;
      for (let oy = -1; oy <= 1 && !nearHazard; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (kindAt(x + ox, y + oy) === 'hazard') {
            nearHazard = true;
            break;
          }
        }
      }
      if (!nearHazard) candidates.push({ x, y });
    }
  }

  candidates.sort((a, b) => {
    const byScore = placementScore(seed, a.x, a.y) - placementScore(seed, b.x, b.y);
    return byScore || a.x - b.x || a.y - b.y;
  });

  const target = Math.min(Math.ceil(candidates.length / 28), Math.max(1, Math.floor(cols / 18)));
  const selected: Coord[] = [];
  for (const candidate of candidates) {
    if (selected.every((other) => Math.abs(other.x - candidate.x) >= MIN_HORIZONTAL_SPACING)) {
      selected.push(candidate);
      if (selected.length >= target) break;
    }
  }
  return selected.sort((a, b) => a.x - b.x || a.y - b.y);
}
