// Renderer: offscreen 512×300 canvas, blitted once per frame to the visible
// canvas at 2× integer scale with smoothing off. Runtime drawing is drawImage
// and rect fills only — no per-frame getImageData/putImageData anywhere.
import { DISPLAY_SCALE, INTERNAL_HEIGHT, INTERNAL_WIDTH } from '@sparkade/shared';
import { drawText, textWidth, wrapText, type TextOpts } from './font';
import { DEFAULT_THEME, type UiTheme } from './theme';

export class Camera {
  x = 0;
  y = 0;
  /** Lookahead shifts the view toward facing direction; eased. */
  private lookX = 0;

  follow(
    targetX: number,
    targetY: number,
    facing: number,
    bounds: { w: number; h: number },
    dt: number,
  ): void {
    const lookTarget = facing * 40;
    this.lookX += (lookTarget - this.lookX) * Math.min(1, dt * 3);
    const want = targetX - INTERNAL_WIDTH / 2 + this.lookX;
    this.x += (want - this.x) * Math.min(1, dt * 8);
    const wantY = targetY - INTERNAL_HEIGHT * 0.55;
    this.y += (wantY - this.y) * Math.min(1, dt * 6);
    this.x = Math.max(0, Math.min(bounds.w - INTERNAL_WIDTH, this.x));
    this.y = Math.max(0, Math.min(Math.max(0, bounds.h - INTERNAL_HEIGHT), this.y));
    if (bounds.h <= INTERNAL_HEIGHT) this.y = bounds.h - INTERNAL_HEIGHT;
  }

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private visible: HTMLCanvasElement;
  private visibleCtx: CanvasRenderingContext2D;

  private shakeUntil = 0;
  private shakeMag = 0;
  /** Per-game chrome colors; set by the host from the game's palette. */
  theme: UiTheme = DEFAULT_THEME;

  constructor(visibleCanvas: HTMLCanvasElement) {
    this.visible = visibleCanvas;
    this.visible.width = INTERNAL_WIDTH * DISPLAY_SCALE;
    this.visible.height = INTERNAL_HEIGHT * DISPLAY_SCALE;
    this.visibleCtx = this.visible.getContext('2d', { alpha: false })!;
    this.canvas = document.createElement('canvas');
    this.canvas.width = INTERNAL_WIDTH;
    this.canvas.height = INTERNAL_HEIGHT;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    this.visibleCtx.imageSmoothingEnabled = false;
  }

  clear(color = '#000000'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  }

  /** One blit per frame. Screen shake is applied here as an integer offset. */
  present(): void {
    const now = performance.now();
    let ox = 0;
    let oy = 0;
    if (now < this.shakeUntil) {
      const m = this.shakeMag;
      ox = Math.round((Math.random() * 2 - 1) * m) * DISPLAY_SCALE;
      oy = Math.round((Math.random() * 2 - 1) * m) * DISPLAY_SCALE;
      this.visibleCtx.fillStyle = '#000000';
      this.visibleCtx.fillRect(0, 0, this.visible.width, this.visible.height);
    }
    this.visibleCtx.imageSmoothingEnabled = false;
    this.visibleCtx.drawImage(
      this.canvas,
      ox,
      oy,
      INTERNAL_WIDTH * DISPLAY_SCALE,
      INTERNAL_HEIGHT * DISPLAY_SCALE,
    );
  }

  shake(ms: number, magnitude = 3): void {
    this.shakeUntil = performance.now() + ms;
    this.shakeMag = magnitude;
  }

  draw(img: CanvasImageSource, x: number, y: number): void {
    this.ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  drawScaled(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.ctx.drawImage(img, Math.round(x), Math.round(y), w, h);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  frame(x: number, y: number, w: number, h: number, color: string, thickness = 1): void {
    this.rect(x, y, w, thickness, color);
    this.rect(x, y + h - thickness, w, thickness, color);
    this.rect(x, y, thickness, h, color);
    this.rect(x + w - thickness, y, thickness, h, color);
  }

  text(text: string, x: number, y: number, color?: string, opts?: TextOpts): void {
    drawText(this.ctx, text, Math.round(x), Math.round(y), color, opts);
  }

  textWidth = textWidth;
  wrapText = wrapText;

  /** Bordered panel used by overlays (pause, cards, initials). */
  panel(x: number, y: number, w: number, h: number, bg = this.theme.panelBg, border = this.theme.panelBorder): void {
    this.rect(x, y, w, h, bg);
    this.frame(x, y, w, h, border);
    this.frame(x + 2, y + 2, w - 4, h - 4, '#00000055' as string);
  }

  dim(alpha = 0.6): void {
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  }
}

/**
 * Tile layer renderer with camera: draws only the visible cell range.
 * `tileAt` returns a canvas (or null for empty) per cell — archetypes decide
 * what lives in each cell; animated tiles switch canvas by time.
 */
export function drawTileLayer(
  r: Renderer,
  cam: { x: number; y: number },
  cols: number,
  rows: number,
  tileSize: number,
  tileAt: (tx: number, ty: number) => HTMLCanvasElement | null,
): void {
  const x0 = Math.max(0, Math.floor(cam.x / tileSize));
  const y0 = Math.max(0, Math.floor(cam.y / tileSize));
  const x1 = Math.min(cols - 1, Math.ceil((cam.x + INTERNAL_WIDTH) / tileSize));
  const y1 = Math.min(rows - 1, Math.ceil((cam.y + INTERNAL_HEIGHT) / tileSize));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const img = tileAt(tx, ty);
      if (img) r.draw(img, tx * tileSize - cam.x, ty * tileSize - cam.y);
    }
  }
}
