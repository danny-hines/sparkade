// AABB + swept tile collision. Pure logic — unit-testable without a DOM.

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export type Solidity = 'empty' | 'solid' | 'platform';

export interface TileGrid {
  cols: number;
  rows: number;
  tileSize: number;
  solidityAt(tx: number, ty: number): Solidity;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
  onGround: boolean;
}

/**
 * Swept move of an AABB through a tile grid: integrate X then Y, clamping at
 * solid cells. One-way platforms collide only when falling onto them from above
 * (and not dropping through). Cells outside the grid are solid walls left/right,
 * open above/below.
 */
export function moveAABB(
  grid: TileGrid,
  box: AABB,
  dx: number,
  dy: number,
  opts: { dropThrough?: boolean } = {},
): MoveResult {
  const ts = grid.tileSize;
  const eps = 0.001;
  let { x, y } = box;
  let hitX = false;
  let hitY = false;
  let onGround = false;

  const solidAt = (tx: number, ty: number): Solidity => {
    if (tx < 0 || tx >= grid.cols) return 'solid';
    if (ty < 0 || ty >= grid.rows) return 'empty';
    return grid.solidityAt(tx, ty);
  };

  // --- X axis: step through every cell column the leading edge crosses ---
  if (dx !== 0) {
    const dir = Math.sign(dx);
    const startEdge = dir > 0 ? x + box.w : x;
    const endEdge = startEdge + dx;
    const ty0 = Math.floor((y + eps) / ts);
    const ty1 = Math.floor((y + box.h - eps) / ts);
    const fromTx = Math.floor((startEdge - (dir > 0 ? eps : -eps)) / ts);
    const toTx = Math.floor(endEdge / ts);
    let newX = x + dx;
    for (let tx = fromTx + dir; dir > 0 ? tx <= toTx : tx >= toTx; tx += dir) {
      let blocked = false;
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(tx, ty) === 'solid') {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        newX = dir > 0 ? tx * ts - box.w - eps : (tx + 1) * ts + eps;
        hitX = true;
        break;
      }
    }
    x = newX;
  }

  // --- Y axis: step through every cell row the leading edge crosses ---
  if (dy !== 0) {
    const prevBottom = y + box.h;
    const dir = Math.sign(dy);
    const startEdge = dir > 0 ? y + box.h : y;
    const endEdge = startEdge + dy;
    const tx0 = Math.floor((x + eps) / ts);
    const tx1 = Math.floor((x + box.w - eps) / ts);
    const fromTy = Math.floor((startEdge - (dir > 0 ? eps : -eps)) / ts);
    const toTy = Math.floor(endEdge / ts);
    let newY = y + dy;
    outer: for (let ty = fromTy + dir; dir > 0 ? ty <= toTy : ty >= toTy; ty += dir) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const s = solidAt(tx, ty);
        const landsOnPlatform =
          s === 'platform' && dir > 0 && !opts.dropThrough && prevBottom <= ty * ts + eps;
        if (s === 'solid' || landsOnPlatform) {
          if (dir > 0) {
            newY = ty * ts - box.h - eps;
            onGround = true;
          } else {
            newY = (ty + 1) * ts + eps;
          }
          hitY = true;
          break outer;
        }
      }
    }
    y = newY;
  } else {
    // Standing check (dy === 0): probe one pixel below.
    const ty = Math.floor((y + box.h + 1) / ts);
    const tx0 = Math.floor((x + eps) / ts);
    const tx1 = Math.floor((x + box.w - eps) / ts);
    for (let tx = tx0; tx <= tx1; tx++) {
      const s = solidAt(tx, ty);
      if (s === 'solid' || (s === 'platform' && Math.abs(y + box.h - ty * ts) < 2)) {
        onGround = true;
        break;
      }
    }
  }

  return { x, y, hitX, hitY, onGround };
}

/** Which tile cells an AABB overlaps (for hazard/pickup checks). */
export function cellsUnder(box: AABB, ts: number): { tx: number; ty: number }[] {
  const eps = 0.001;
  const out: { tx: number; ty: number }[] = [];
  const tx0 = Math.floor((box.x + eps) / ts);
  const tx1 = Math.floor((box.x + box.w - eps) / ts);
  const ty0 = Math.floor((box.y + eps) / ts);
  const ty1 = Math.floor((box.y + box.h - eps) / ts);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) out.push({ tx, ty });
  return out;
}
