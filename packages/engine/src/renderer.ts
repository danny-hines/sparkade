// Renderer: logical 512×300 coordinates on a 1024×600 backing store. Existing
// art scales by the cabinet's 2× display factor; matching-density sources can
// retain native pixels inside the same logical footprint. Runtime drawing is
// drawImage and rect fills only — no per-frame pixel reads.
import {
  DISPLAY_SCALE,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  type ButtonLabels,
  type PromptButton,
  type PresentationFamily,
} from '@sparkade/shared';
import { drawText, textWidth, wrapText, type TextOpts } from './font';
import type { SilhouetteAura, SilhouetteAuraBand } from './sprites';
import { DEFAULT_THEME, type UiTheme } from './theme';
import type { WorldZoom } from './types';

export interface WorldZoomRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface WorldTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

/** Pure crop calculation kept separate from canvas work for boundary tests. */
export function worldZoomRect(
  zoom: WorldZoom,
  width = INTERNAL_WIDTH,
  height = INTERNAL_HEIGHT,
): WorldZoomRect {
  const scale = Math.max(1, Math.floor(zoom.scale));
  const sw = Math.max(1, Math.floor(width / scale));
  const sh = Math.max(1, Math.floor(height / scale));
  const maxX = Math.max(0, width - sw);
  const maxY = Math.max(0, height - sh);
  const sx = Math.max(0, Math.min(maxX, Math.round(zoom.sourceX ?? 0)));
  const sy = Math.max(0, Math.min(maxY, Math.round(zoom.sourceY ?? 0)));
  return { sx, sy, sw, sh };
}

/** Direct integer world transform. Unlike a post-render crop, this lets a
 * high-density source retain all of its pixels while occupying the same
 * logical world footprint as a lower-density fallback. */
export function worldTransform(
  zoom: WorldZoom,
  width = INTERNAL_WIDTH,
  height = INTERNAL_HEIGHT,
): WorldTransform {
  const { sx, sy } = worldZoomRect(zoom, width, height);
  const scale = Math.max(1, Math.floor(zoom.scale));
  return {
    scale,
    translateX: sx === 0 ? 0 : -sx * scale,
    translateY: sy === 0 ? 0 : -sy * scale,
  };
}

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
    viewport: { w: number; h: number; lookahead: number } = {
      w: INTERNAL_WIDTH,
      h: INTERNAL_HEIGHT,
      lookahead: 40,
    },
  ): void {
    const lookTarget = facing * viewport.lookahead;
    this.lookX += (lookTarget - this.lookX) * Math.min(1, dt * 3);
    const want = targetX - viewport.w / 2 + this.lookX;
    this.x += (want - this.x) * Math.min(1, dt * 8);
    const wantY = targetY - viewport.h * 0.55;
    this.y += (wantY - this.y) * Math.min(1, dt * 6);
    this.x = Math.max(0, Math.min(bounds.w - viewport.w, this.x));
    this.y = Math.max(0, Math.min(Math.max(0, bounds.h - viewport.h), this.y));
    if (bounds.h <= viewport.h) this.y = bounds.h - viewport.h;
  }

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}

const BUTTON_TOKEN = /\((A|B|X|Y|L|R|START|SELECT|D-PAD)\)/g;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private visible: HTMLCanvasElement;
  private visibleCtx: CanvasRenderingContext2D;

  private shakeUntil = 0;
  private shakeMag = 0;
  /** Per-game chrome colors; set by the host from the game's palette. */
  theme: UiTheme = DEFAULT_THEME;
  presentationFamily?: PresentationFamily;
  /** Per-game VFX intensity (screen-shake) multiplier; 1 = default feel. */
  juice = 1;
  /** Player-facing button names (e.g. keyboard keys on the web). Empty = gamepad
   *  names. `text()` rewrites "(A)"-style prompt tokens through this map. */
  buttonLabels: ButtonLabels = {};

  constructor(visibleCanvas: HTMLCanvasElement) {
    this.visible = visibleCanvas;
    this.visible.width = INTERNAL_WIDTH * DISPLAY_SCALE;
    this.visible.height = INTERNAL_HEIGHT * DISPLAY_SCALE;
    this.visibleCtx = this.visible.getContext('2d', { alpha: false })!;
    this.canvas = document.createElement('canvas');
    this.canvas.width = INTERNAL_WIDTH * DISPLAY_SCALE;
    this.canvas.height = INTERNAL_HEIGHT * DISPLAY_SCALE;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ctx.setTransform(DISPLAY_SCALE, 0, 0, DISPLAY_SCALE, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.visibleCtx.imageSmoothingEnabled = false;
  }

  clear(color = '#000000'): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
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
    this.visibleCtx.drawImage(this.canvas, ox, oy, this.canvas.width, this.canvas.height);
  }

  shake(ms: number, magnitude = 3): void {
    this.shakeUntil = performance.now() + ms;
    this.shakeMag = magnitude * this.juice;
  }

  draw(img: CanvasImageSource, x: number, y: number): void {
    this.ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  drawScaled(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.ctx.drawImage(img, Math.round(x), Math.round(y), w, h);
  }

  drawScaledFlipped(
    img: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
    flip: boolean,
  ): void {
    if (!flip) {
      this.drawScaled(img, x, y, w, h);
      return;
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    this.ctx.save();
    this.ctx.translate(rx * 2 + w, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(img, rx, ry, w, h);
    this.ctx.restore();
  }

  /** Draw selected cached distance bands around a sprite's alpha silhouette. */
  drawSilhouetteAura(
    aura: SilhouetteAura,
    x: number,
    y: number,
    w: number,
    h: number,
    bands: readonly SilhouetteAuraBand[],
    flip = false,
  ): void {
    const padX = (aura.padding * w) / aura.contentWidth;
    const padY = (aura.padding * h) / aura.contentHeight;
    const previousAlpha = this.ctx.globalAlpha;
    this.ctx.save();
    for (const { radius, alpha } of bands) {
      const ring = aura.rings[Math.round(radius) - 1];
      if (!ring || alpha <= 0) continue;
      this.ctx.globalAlpha = previousAlpha * Math.min(1, alpha);
      this.drawScaledFlipped(ring, x - padX, y - padY, w + padX * 2, h + padY * 2, flip);
    }
    this.ctx.restore();
  }

  /** Begin direct integer world rendering. Low-density art is nearest-neighbor
   * enlarged, while a source with matching physical dimensions renders 1:1. */
  beginWorld(zoom?: WorldZoom): void {
    this.ctx.save();
    if (!zoom || zoom.scale <= 1) return;
    const transform = worldTransform(zoom);
    this.ctx.setTransform(
      transform.scale * DISPLAY_SCALE,
      0,
      0,
      transform.scale * DISPLAY_SCALE,
      transform.translateX * DISPLAY_SCALE,
      transform.translateY * DISPLAY_SCALE,
    );
    this.ctx.imageSmoothingEnabled = false;
  }

  endWorld(): void {
    this.ctx.restore();
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

  /** The name the player should see for a logical button. */
  button(button: PromptButton): string {
    return this.buttonLabels[button] ?? button;
  }

  text(text: string, x: number, y: number, color?: string, opts?: TextOpts): void {
    drawText(this.ctx, this.relabel(text), Math.round(x), Math.round(y), color, opts);
  }

  /** Rewrites "(A)"-style prompt tokens to the current button names. */
  relabel(text: string): string {
    if (!text.includes('(')) return text;
    return text.replace(BUTTON_TOKEN, (_, b: PromptButton) => `(${this.button(b)})`);
  }

  textWidth = textWidth;
  wrapText = wrapText;

  /** Bordered panel used by overlays (pause, cards, initials). */
  panel(
    x: number,
    y: number,
    w: number,
    h: number,
    bg = this.theme.panelBg,
    border = this.theme.panelBorder,
  ): void {
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
  tileAt: (tx: number, ty: number) => CanvasImageSource | null,
): void {
  const x0 = Math.max(0, Math.floor(cam.x / tileSize));
  const y0 = Math.max(0, Math.floor(cam.y / tileSize));
  const x1 = Math.min(cols - 1, Math.ceil((cam.x + INTERNAL_WIDTH) / tileSize));
  const y1 = Math.min(rows - 1, Math.ceil((cam.y + INTERNAL_HEIGHT) / tileSize));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const img = tileAt(tx, ty);
      if (img) r.drawScaled(img, tx * tileSize - cam.x, ty * tileSize - cam.y, tileSize, tileSize);
    }
  }
}

// Obstacle contrast pass. Dungeon wall/block/floor art all share palette slot 2
// as its base fill, so a wall's face is the *same color* as the floor — the art
// separates them only with thin slot-1/slot-3 bevels. On a low-contrast
// generated palette (the bg 2/3/4 bands bunched together, which the validator
// permits) and on the cabinet's dark-crushing LCD, those bevels wash out and
// solid obstacles turn invisible against the terrain. These helpers stamp a
// palette-INDEPENDENT raised-block silhouette — lit top/left edges, shadowed
// bottom/right edges, plus a shadow cast onto the floor — so an obstacle always
// reads as a discrete block whatever the palette or panel does.
const OBSTACLE_LIGHT = 'rgba(255,255,255,0.20)'; // lit top-left bevel
const OBSTACLE_SEAM = 'rgba(0,0,0,0.40)'; // shadowed bottom-right bevel
const OBSTACLE_CAST = 'rgba(0,0,0,0.30)'; // shadow cast onto adjacent floor
const OBSTACLE_EDGE = 2; // bevel thickness, px
const OBSTACLE_CAST_PX = 2; // cast-shadow width, px

/**
 * Draw the raised-block silhouette for one obstacle tile at screen (sx, sy).
 * Each flag says whether that side faces walkable floor (so it needs an edge);
 * sides facing another obstacle are left seamless. `n`/`w` get a light bevel,
 * `s`/`e` a dark bevel + a shadow cast outward onto the floor.
 */
/** Just the bit of {@link Renderer} these helpers need — so a dev tool can drive
 *  them with a bare canvas context via a `{ rect }` adapter. */
export interface RectSink {
  rect(x: number, y: number, w: number, h: number, color: string): void;
}

export function drawObstacleTile(
  r: RectSink,
  sx: number,
  sy: number,
  size: number,
  n: boolean,
  s: boolean,
  e: boolean,
  w: boolean,
): void {
  if (n) r.rect(sx, sy, size, OBSTACLE_EDGE, OBSTACLE_LIGHT);
  if (w) r.rect(sx, sy, OBSTACLE_EDGE, size, OBSTACLE_LIGHT);
  if (s) r.rect(sx, sy + size - OBSTACLE_EDGE, size, OBSTACLE_EDGE, OBSTACLE_SEAM);
  if (e) r.rect(sx + size - OBSTACLE_EDGE, sy, OBSTACLE_EDGE, size, OBSTACLE_SEAM);
  if (s) r.rect(sx, sy + size, size + (e ? OBSTACLE_CAST_PX : 0), OBSTACLE_CAST_PX, OBSTACLE_CAST);
  if (e) r.rect(sx + size, sy, OBSTACLE_CAST_PX, size, OBSTACLE_CAST);
}

/**
 * Grid convenience for {@link drawObstacleTile}: over the visible cell range,
 * outline every `solidAt` cell that borders a `floorAt` cell. Run it AFTER the
 * tile layer and BEFORE sprites so obstacles sit above the floor but under
 * actors. Free-standing obstacles (pushable blocks at sub-tile positions) call
 * {@link drawObstacleTile} directly at their pixel position.
 */
export function drawObstacleShadows(
  r: RectSink,
  cam: { x: number; y: number },
  cols: number,
  rows: number,
  tileSize: number,
  solidAt: (tx: number, ty: number) => boolean,
  floorAt: (tx: number, ty: number) => boolean,
): void {
  const x0 = Math.max(0, Math.floor(cam.x / tileSize));
  const y0 = Math.max(0, Math.floor(cam.y / tileSize));
  const x1 = Math.min(cols - 1, Math.ceil((cam.x + INTERNAL_WIDTH) / tileSize));
  const y1 = Math.min(rows - 1, Math.ceil((cam.y + INTERNAL_HEIGHT) / tileSize));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solidAt(tx, ty)) continue;
      const n = floorAt(tx, ty - 1);
      const s = floorAt(tx, ty + 1);
      const e = floorAt(tx + 1, ty);
      const w = floorAt(tx - 1, ty);
      if (n || s || e || w)
        drawObstacleTile(r, tx * tileSize - cam.x, ty * tileSize - cam.y, tileSize, n, s, e, w);
    }
  }
}
