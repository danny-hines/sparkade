import { SOLID_NEIGHBOR_MASK, exposedSolidEdges, type SolidEdge } from './connected-tiles';

export type TopDownTerrainRelief = 'raised' | 'recessed';

export interface TopDownTerrainColors {
  raised: string;
  light: string;
  dark: string;
  recess: string;
}

const DEFAULT_COLORS: TopDownTerrainColors = {
  raised: 'rgba(255,255,255,0.08)',
  light: 'rgba(255,255,255,0.22)',
  dark: 'rgba(0,0,0,0.48)',
  recess: 'rgba(0,0,0,0.56)',
};

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

function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: SolidEdge,
  width: number,
  height: number,
  thickness: number,
  color: string,
): void {
  ctx.fillStyle = color;
  switch (edge) {
    case 'north':
      ctx.fillRect(0, 0, width, thickness);
      break;
    case 'east':
      ctx.fillRect(width - thickness, 0, thickness, height);
      break;
    case 'south':
      ctx.fillRect(0, height - thickness, width, thickness);
      break;
    case 'west':
      ctx.fillRect(0, 0, thickness, height);
      break;
  }
}

/**
 * Compose one top-down visual variant. Raised masses catch light on their
 * north/west edges and fall dark on south/east; pits invert that relationship
 * over a darkened material field. Collision stays a square semantic cell.
 */
export function renderTopDownTerrainVariant(
  source: CanvasImageSource,
  mask: number,
  relief: TopDownTerrainRelief,
  colors: TopDownTerrainColors = DEFAULT_COLORS,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const dimensions = sourceSize(source);
  out.width = dimensions.width;
  out.height = dimensions.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);

  const density = Math.max(1, Math.round(out.width / 16));
  ctx.fillStyle = relief === 'raised' ? colors.raised : colors.recess;
  ctx.fillRect(0, 0, out.width, out.height);

  for (const edge of exposedSolidEdges(mask)) {
    const leading = edge === 'north' || edge === 'west';
    const color =
      relief === 'raised'
        ? leading
          ? colors.light
          : colors.dark
        : leading
          ? colors.dark
          : colors.light;
    drawEdge(ctx, edge, out.width, out.height, density, color);
  }
  return out;
}

/** Precompose every four-neighbour variant once; room rendering is lookup-only. */
export class TopDownConnectedAutotiles {
  private variants: HTMLCanvasElement[][] = [];

  constructor(
    frames: readonly CanvasImageSource[],
    relief: TopDownTerrainRelief,
    colors: TopDownTerrainColors = DEFAULT_COLORS,
  ) {
    for (let mask = 0; mask <= SOLID_NEIGHBOR_MASK; mask++) {
      this.variants[mask] = frames.map((frame) =>
        renderTopDownTerrainVariant(frame, mask, relief, colors),
      );
    }
  }

  frame(mask: number, frameIx: number): HTMLCanvasElement | null {
    const frames = this.variants[mask & SOLID_NEIGHBOR_MASK] ?? [];
    if (frames.length === 0) return null;
    const normalized = ((Math.trunc(frameIx) % frames.length) + frames.length) % frames.length;
    return frames[normalized] ?? frames[0] ?? null;
  }
}
