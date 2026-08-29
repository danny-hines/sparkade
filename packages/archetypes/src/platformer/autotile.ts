/**
 * Platformer solid-terrain autotiling.
 *
 * The authored grid remains a grid of square `solid` collision cells. This
 * module derives a visual-only four-neighbour mask, then stamps exposed edges
 * and outside corners onto a small, eagerly cached set of canvases.
 */

export const SOLID_NORTH = 1 << 0;
export const SOLID_EAST = 1 << 1;
export const SOLID_SOUTH = 1 << 2;
export const SOLID_WEST = 1 << 3;
export const SOLID_NEIGHBOR_MASK = SOLID_NORTH | SOLID_EAST | SOLID_SOUTH | SOLID_WEST;

export type SolidEdge = 'north' | 'east' | 'south' | 'west';
export type SolidCorner = 'northWest' | 'northEast' | 'southEast' | 'southWest';
export type SolidTileVariant = 'cap' | 'inner';

/** Select a spatial variant from a 4×4 continuous density-four atlas. */
export function terrainAtlasFrame(tx: number, ty: number, columns = 4, rows = 4): number {
  const safeColumns = Math.max(1, Math.trunc(columns));
  const safeRows = Math.max(1, Math.trunc(rows));
  const column = ((Math.trunc(tx) % safeColumns) + safeColumns) % safeColumns;
  const row = ((Math.trunc(ty) % safeRows) + safeRows) % safeRows;
  return column + row * safeColumns;
}

/** Build a four-neighbour connectivity mask for one square solid cell. */
export function solidNeighborMask(
  solidAt: (tx: number, ty: number) => boolean,
  tx: number,
  ty: number,
): number {
  let mask = 0;
  if (solidAt(tx, ty - 1)) mask |= SOLID_NORTH;
  if (solidAt(tx + 1, ty)) mask |= SOLID_EAST;
  if (solidAt(tx, ty + 1)) mask |= SOLID_SOUTH;
  if (solidAt(tx - 1, ty)) mask |= SOLID_WEST;
  return mask;
}

/** Buried cells use body art; any cell exposed above uses surface/cap art. */
export function solidTileVariant(mask: number): SolidTileVariant {
  return (mask & SOLID_NORTH) !== 0 ? 'inner' : 'cap';
}

/** Sides without a solid neighbour receive the one-pixel dark outline. */
export function exposedSolidEdges(mask: number): SolidEdge[] {
  const edges: SolidEdge[] = [];
  if ((mask & SOLID_NORTH) === 0) edges.push('north');
  if ((mask & SOLID_EAST) === 0) edges.push('east');
  if ((mask & SOLID_SOUTH) === 0) edges.push('south');
  if ((mask & SOLID_WEST) === 0) edges.push('west');
  return edges;
}

/**
 * Round only convex outside corners. Diagonal occupancy is deliberately not
 * consulted: a corner exists when both of its cardinal sides are exposed.
 */
export function roundedSolidCorners(mask: number): SolidCorner[] {
  const north = (mask & SOLID_NORTH) === 0;
  const east = (mask & SOLID_EAST) === 0;
  const south = (mask & SOLID_SOUTH) === 0;
  const west = (mask & SOLID_WEST) === 0;
  const corners: SolidCorner[] = [];
  if (north && west) corners.push('northWest');
  if (north && east) corners.push('northEast');
  if (south && east) corners.push('southEast');
  if (south && west) corners.push('southWest');
  return corners;
}

/** Infer the conventional companion id for a built-in solid cap. */
export function inferSolidInnerRef(capRef: string): string | null {
  const match = /^lib:([a-z][a-z0-9_]*_solid)$/.exec(capRef);
  return match ? `lib:${match[1]}_inner` : null;
}

/** Built-in body art is deliberately limited to the solid-inner tile family. */
export function isSolidInnerLibraryId(id: string): boolean {
  return /^[a-z][a-z0-9_]*_solid_inner$/.test(id);
}

/**
 * Select an explicit inner assignment when valid, otherwise a valid inferred
 * built-in companion. `null` means callers must reuse the already-resolved cap
 * frames, preserving custom and legacy terrain exactly.
 */
export function resolveSolidInnerRef(
  capRef: string,
  explicitInnerRef: string | undefined,
  refExists: (ref: string) => boolean,
): string | null {
  if (explicitInnerRef !== undefined && refExists(explicitInnerRef)) return explicitInnerRef;
  const inferred = inferSolidInnerRef(capRef);
  return inferred && refExists(inferred) ? inferred : null;
}

function drawExposedEdges(
  ctx: CanvasRenderingContext2D,
  mask: number,
  w: number,
  h: number,
  color: string,
  thickness: number,
): void {
  ctx.fillStyle = color;
  for (const edge of exposedSolidEdges(mask)) {
    switch (edge) {
      case 'north':
        ctx.fillRect(0, 0, w, thickness);
        break;
      case 'east':
        ctx.fillRect(w - thickness, 0, thickness, h);
        break;
      case 'south':
        ctx.fillRect(0, h - thickness, w, thickness);
        break;
      case 'west':
        ctx.fillRect(0, 0, thickness, h);
        break;
    }
  }
}

/**
 * Cut a two-pixel square from a convex corner and restore its inner diagonal
 * pixel in the outline color. Together with the two edge endpoints this makes
 * a crisp three-step pixel arc while leaving collision fully square.
 */
function drawRoundedCorner(
  ctx: CanvasRenderingContext2D,
  corner: SolidCorner,
  w: number,
  h: number,
  color: string,
  density: number,
): void {
  const cut = density * 2;
  if (w < cut + density || h < cut + density) return;
  let x = 0;
  let y = 0;
  let diagonalX = density;
  let diagonalY = density;
  if (corner === 'northEast' || corner === 'southEast') {
    x = w - cut;
    diagonalX = w - cut;
  }
  if (corner === 'southEast' || corner === 'southWest') {
    y = h - cut;
    diagonalY = h - cut;
  }
  ctx.clearRect(x, y, cut, cut);
  ctx.fillStyle = color;
  ctx.fillRect(diagonalX, diagonalY, density, density);
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  const sized = source as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
  };
  return {
    width: sized.naturalWidth || sized.videoWidth || sized.width || 16,
    height: sized.naturalHeight || sized.videoHeight || sized.height || 16,
  };
}

export function renderSolidVariant(
  source: CanvasImageSource,
  mask: number,
  borderColor: string,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const dimensions = sourceSize(source);
  out.width = dimensions.width;
  out.height = dimensions.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  const density = Math.max(1, Math.round(out.width / 16));
  drawExposedEdges(ctx, mask, out.width, out.height, borderColor, density);
  for (const corner of roundedSolidCorners(mask)) {
    drawRoundedCorner(ctx, corner, out.width, out.height, borderColor, density);
  }
  return out;
}

/**
 * Eagerly compose every four-neighbour mask once. Rendering a level then does
 * only a mask lookup and an animation-frame modulo, never per-cell canvas work.
 */
export class PlatformerSolidAutotiles {
  private variants: HTMLCanvasElement[][] = [];

  constructor(
    capFrames: readonly CanvasImageSource[],
    innerFrames: readonly CanvasImageSource[],
    borderColor: string,
  ) {
    for (let mask = 0; mask <= SOLID_NEIGHBOR_MASK; mask++) {
      const requested = solidTileVariant(mask) === 'inner' ? innerFrames : capFrames;
      const sources = requested.length > 0 ? requested : capFrames;
      this.variants[mask] = sources.map((source) => renderSolidVariant(source, mask, borderColor));
    }
  }

  frame(mask: number, frameIx: number): HTMLCanvasElement | null {
    const frames = this.variants[mask & SOLID_NEIGHBOR_MASK] ?? [];
    if (frames.length === 0) return null;
    const normalized = ((Math.trunc(frameIx) % frames.length) + frames.length) % frames.length;
    return frames[normalized] ?? frames[0] ?? null;
  }
}
