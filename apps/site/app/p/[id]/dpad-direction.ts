export type DpadKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

type DpadBounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const EIGHTH_TURN = Math.PI / 4;
const DEAD_ZONE = 0.2;

/**
 * Treat the D-pad as a small eight-way stick. The returned keys can be held
 * until the pointer moves into a new sector or is released.
 */
export function dpadKeysAtPoint(
  clientX: number,
  clientY: number,
  bounds: DpadBounds,
): DpadKey[] {
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  if (halfWidth === 0 || halfHeight === 0) return [];

  const x = (clientX - (bounds.left + halfWidth)) / halfWidth;
  const y = (clientY - (bounds.top + halfHeight)) / halfHeight;
  if (Math.hypot(x, y) < DEAD_ZONE) return [];

  const sector = (Math.round(Math.atan2(y, x) / EIGHTH_TURN) + 8) % 8;
  return [
    ['ArrowRight'],
    ['ArrowRight', 'ArrowDown'],
    ['ArrowDown'],
    ['ArrowLeft', 'ArrowDown'],
    ['ArrowLeft'],
    ['ArrowLeft', 'ArrowUp'],
    ['ArrowUp'],
    ['ArrowRight', 'ArrowUp'],
  ][sector] as DpadKey[];
}
