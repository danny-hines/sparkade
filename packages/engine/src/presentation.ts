import { PRESENTATION_CATALOG, type ControlLabel, type PresentationFamily } from '@sparkade/shared';
import { wrapText } from './font';
import type { Renderer } from './renderer';
import type { HudState } from './types';

export const shortLabel = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
export function runClock(seconds: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Rectangular pixel clusters only; no gradients, vector curves, or gameplay RNG. */
export function familyPanel(r: Renderer, x: number, y: number, w: number, h: number): void {
  const f = r.presentationFamily;
  const t = r.theme;
  r.rect(x + 3, y + 4, w, h, '#00000088');
  r.rect(x, y, w, h, t.panelBg);
  if (f === 'storybook') {
    r.frame(x, y, w, h, t.panelBorder);
    r.frame(x + 3, y + 3, w - 6, h - 6, t.barBg);
    for (const cx of [x + 5, x + w - 9])
      for (const cy of [y + 5, y + h - 9]) {
        r.rect(cx, cy, 4, 4, t.panelBorder);
        r.rect(cx + 1, cy + 1, 2, 2, t.panelBg);
      }
  } else if (f === 'tech') {
    r.frame(x, y, w, h, t.panelBorder);
    r.rect(x, y, 18, 2, t.dim);
    r.rect(x, y, 2, 8, t.dim);
    r.rect(x + w - 18, y + h - 2, 18, 2, t.dim);
    r.rect(x + w - 2, y + h - 8, 2, 8, t.dim);
  } else {
    r.frame(x, y, w, h, t.heading);
    r.rect(x - 2, y + 4, 3, h - 8, t.cursor);
    r.rect(x + w - 1, y + 4, 3, h - 8, t.cursor);
    r.rect(x + 4, y - 2, w - 8, 3, t.heading);
  }
}

export function familyBackdrop(r: Renderer): void {
  r.clear(r.theme.screenBg);
  const f = r.presentationFamily;
  if (f === 'storybook') {
    familyPanel(r, 18, 18, 476, 264);
    r.rect(28, 26, 2, 248, r.theme.barBg);
    r.rect(482, 26, 2, 248, r.theme.barBg);
  } else if (f === 'tech') {
    for (let x = 16; x < 512; x += 24)
      for (let y = 16; y < 300; y += 24) r.rect(x, y, 1, 1, r.theme.barMid);
    familyPanel(r, 18, 18, 476, 264);
    r.rect(30, 32, 3, 232, r.theme.accent);
  } else {
    for (let i = 0; i < 7; i++) {
      r.rect(i * 80 - 60, 18 + i * 3, 100, 3, r.theme.barMid);
      r.rect(i * 80 - 20, 276 - i * 3, 70, 3, r.theme.accent);
    }
    familyPanel(r, 24, 32, 464, 234);
  }
}

export function familyHeading(
  r: Renderer,
  text: string,
  x: number,
  y: number,
  width: number,
  big = true,
): void {
  const scale = big && r.textWidth(text, 2) <= width ? 2 : 1;
  const lines = r.wrapText(text, width, scale).slice(0, 2);
  lines.forEach((line, i) => {
    const cy = y + i * (8 * scale + 4);
    if (r.presentationFamily === 'arcade') r.text(line, x + 1, cy + 2, r.theme.cursor, { scale });
    r.text(line, x, cy, r.theme.heading, { scale });
  });
}

export function familyControls(
  r: Renderer,
  title: string,
  controls: ControlLabel[],
  footer: string,
): void {
  familyBackdrop(r);
  const family = PRESENTATION_CATALOG[r.presentationFamily!];
  r.text(family.intro, 42, 42, r.theme.dim);
  familyHeading(r, title, 42, 61, 428);
  r.rect(42, 90, 428, 1, r.theme.panelBorder);
  controls.forEach((c, i) => {
    const y = 103 + i * 18;
    r.rect(42, y - 2, 64, 13, r.theme.barBg);
    r.text(`(${c.button})`, 48, y, r.theme.heading);
    r.text(shortLabel(c.label, 43), 118, y, r.theme.text);
  });
  r.text('START PAUSE / HOLD TO EXIT', 42, 242, r.theme.dim);
  r.text(footer, 42, 254, r.theme.heading);
}

export function familyPause(
  r: Renderer,
  screen: 'menu' | 'controls' | 'audio',
  cursor: number,
  controls: ControlLabel[],
  volumes: { musicVol: number; sfxVol: number; uiVol: number },
): void {
  if (screen === 'controls') return familyControls(r, 'CONTROLS', controls, '(B) BACK');
  r.dim(0.72);
  const book = r.presentationFamily === 'storybook';
  const x = book ? 54 : r.presentationFamily === 'tech' ? 32 : 88;
  const w = book ? 404 : r.presentationFamily === 'tech' ? 448 : 336;
  familyPanel(r, x, 42, w, 216);
  familyHeading(
    r,
    screen === 'audio' ? 'AUDIO' : PRESENTATION_CATALOG[r.presentationFamily!].pause,
    x + 22,
    62,
    w - 44,
  );
  r.rect(x + 22, 91, w - 44, 1, r.theme.panelBorder);
  if (screen === 'audio') {
    [volumes.musicVol, volumes.sfxVol, volumes.uiVol].forEach((v, i) => {
      const y = 115 + i * 32;
      r.text(['MUSIC', 'SFX', 'UI'][i]!, x + 30, y, r.theme.text);
      for (let j = 0; j < 10; j++)
        r.rect(
          x + 100 + j * 13,
          y,
          10,
          8,
          j < Math.round(v * 10) ? r.theme.heading : r.theme.barMid,
        );
      if (cursor === i) r.text('<', x + 84, y, r.theme.cursor);
      r.text(`${Math.round(v * 100)}%`, x + w - 22, y, r.theme.dim, { align: 'right' });
    });
  } else {
    ['Resume', 'Restart', 'Controls', 'Audio', 'Quit to Menu'].forEach((item, i) => {
      const y = 108 + i * 23;
      if (cursor === i) {
        r.rect(x + 20, y - 4, w - 40, 17, r.theme.barBg);
        r.text('>', x + 28, y, r.theme.cursor);
      }
      r.text(item, x + 48, y, cursor === i ? r.theme.heading : r.theme.text);
    });
  }
  r.text(
    screen === 'audio' ? 'LEFT/RIGHT ADJUST  (B) BACK' : '(A) SELECT  (B) RESUME',
    x + 22,
    239,
    r.theme.dim,
  );
}

export function familyTally(
  r: Renderer,
  values: {
    score: number;
    shownBonus: number;
    shownTotal: number;
    won: boolean;
    elapsedSeconds?: number;
    ready: boolean;
  },
): void {
  familyBackdrop(r);
  const f = PRESENTATION_CATALOG[r.presentationFamily!];
  r.text(f.results, 42, 46, r.theme.dim);
  familyHeading(r, values.won ? f.won : f.lost, 42, 65, 428);
  const rows = [
    ['SCORE', String(values.score).padStart(7, '0')],
    ...(values.won ? [['TIME BONUS', String(values.shownBonus).padStart(7, '0')]] : []),
    ...(values.elapsedSeconds !== undefined
      ? [['PLAY TIME', runClock(values.elapsedSeconds)]]
      : []),
  ];
  if (r.presentationFamily === 'arcade') {
    r.text(String(values.shownTotal).padStart(7, '0'), 256, 114, r.theme.heading, {
      align: 'center',
      scale: 3,
    });
    rows.forEach(([label, value], i) => {
      r.text(label!, 64, 163 + i * 22, r.theme.dim);
      r.text(value!, 448, 163 + i * 22, r.theme.text, { align: 'right' });
    });
  } else {
    rows.forEach(([label, value], i) => {
      const y = 112 + i * 28;
      r.text(label!, 46, y, r.theme.dim);
      r.text(value!, 462, y, r.theme.text, { align: 'right' });
      r.rect(46, y + 16, 416, 1, r.theme.barBg);
    });
    r.text('TOTAL', 46, 213, r.theme.heading);
    r.text(String(values.shownTotal).padStart(7, '0'), 462, 207, r.theme.heading, {
      align: 'right',
      scale: 2,
    });
  }
  if (values.ready) r.text('(A) CONTINUE', 256, 249, r.theme.heading, { align: 'center' });
}

export function familyCardLayout(f: PresentationFamily) {
  return f === 'arcade'
    ? {
        text: { x: 42, y: 178, w: 428, rows: 5 },
        art: { x: 24, y: 66, w: 464, h: 94 },
        title: { x: 42, y: 42, w: 428 },
        kickerY: 18,
      }
    : {
        text: { x: 260, y: 100, w: 210, rows: 11 },
        art: { x: 38, y: 99, w: 204, h: 129 },
        title: { x: 40, y: 60, w: 430 },
        kickerY: 42,
      };
}

/** Pagination preserves all narrative text, including long unbroken words. */
export function familyCardPages(lines: readonly string[], family: PresentationFamily): string[][] {
  const { w, rows } = familyCardLayout(family).text;
  const wrapped = lines.flatMap((line, i) => [...(i ? [''] : []), ...wrapText(line, w)]);
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += rows) pages.push(wrapped.slice(i, i + rows));
  return pages.length ? pages : [[]];
}

export function familyIllustration(
  r: Renderer,
  image: CanvasImageSource,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const source = image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const ratio =
    (source.naturalWidth || source.width || 420) / (source.naturalHeight || source.height || 180);
  const w = Math.min(rect.w, rect.h * ratio),
    h = w / ratio;
  r.drawScaled(
    image,
    Math.round(rect.x + (rect.w - w) / 2),
    Math.round(rect.y + (rect.h - h) / 2),
    Math.round(w),
    Math.round(h),
  );
}

export interface FamilyHudAssets {
  heart: CanvasImageSource;
  empty: CanvasImageSource;
  collectible: CanvasImageSource;
  collectibleIcon?: CanvasImageSource | null;
  abilityIcons?: Partial<
    Record<NonNullable<HudState['abilities']>[number]['kind'], CanvasImageSource | null>
  >;
}

export function familyHud(
  r: Renderer,
  hud: HudState,
  assets: FamilyHudAssets,
  elapsedSeconds = 0,
): void {
  const f = r.presentationFamily!;
  const tech = f === 'tech',
    arcade = f === 'arcade';
  if (arcade) r.rect(0, 0, 512, 44, '#05070eef');
  else {
    familyPanel(r, 5, 4, 155, 38);
    familyPanel(r, 166, 4, 176, 38);
    familyPanel(r, 348, 4, 159, 38);
  }
  if (tech) {
    r.text('ENERGY', 13, 10, r.theme.dim);
    const n = Math.min(8, Math.max(1, hud.maxHealth));
    for (let i = 0; i < n; i++)
      r.rect(13 + i * 10, 24, 8, 10, i < hud.health ? r.theme.heading : r.theme.barMid);
  } else {
    for (let i = 0; i < Math.min(8, hud.maxHealth); i++)
      r.drawScaled(
        i < hud.health ? assets.heart : assets.empty,
        13 + i * 10,
        f === 'storybook' ? 14 : 11,
        8,
        8,
      );
    r.text(`LIVES ${hud.lives}`, 13, f === 'storybook' ? 24 : 28, r.theme.text);
  }
  if (tech) r.text(`X${hud.lives}`, 126, 10, r.theme.text);
  for (const [i, ability] of (hud.abilities ?? []).entries()) {
    const x = 113 + i * 17,
      y = 26;
    const image = assets.abilityIcons?.[ability.kind];
    r.ctx.save();
    r.ctx.globalAlpha = ability.active ? 1 : 0.35;
    if (image) r.drawScaled(image, x, y, 10, 10);
    else r.text(ability.name.slice(0, 1), x + 1, y + 1, r.theme.accent);
    r.ctx.restore();
    if (ability.active) r.rect(x, y + 11, 10, 1, r.theme.heading);
  }
  if (arcade) {
    r.text(String(hud.score).padStart(7, '0'), 256, 8, r.theme.heading, {
      align: 'center',
      scale: 2,
    });
    r.drawScaled(assets.collectibleIcon ?? assets.collectible, 361, 10, 8, 8);
    r.text(`X${hud.collectibles ?? 0}`, 375, 10, r.theme.text);
    r.text(runClock(elapsedSeconds), 501, 10, r.theme.dim, { align: 'right' });
  } else {
    r.text(String(hud.score).padStart(7, '0'), 496, 11, r.theme.heading, { align: 'right' });
    r.drawScaled(assets.collectibleIcon ?? assets.collectible, 357, 27, 8, 8);
    r.text(`X${hud.collectibles ?? 0}`, 370, 27, r.theme.text);
    r.text(runClock(elapsedSeconds), 497, 27, r.theme.dim, { align: 'right' });
  }
  if (hud.boss) {
    const x = arcade ? 166 : 176,
      y = arcade ? 29 : 12;
    // The arcade second row has room to the right edge. Fit every allowed
    // 24-character boss name; still bound oversized legacy/imported names.
    const w = arcade ? 335 : 155;
    const barY = y + (arcade ? 11 : 12);
    r.text(
      shortLabel(hud.boss.name, arcade ? Math.floor(w / r.textWidth('M')) : 20),
      x,
      y,
      r.theme.heading,
    );
    r.rect(x, barY, w, 4, r.theme.barBg);
    r.rect(
      x,
      barY,
      Math.round(w * Math.max(0, Math.min(1, hud.boss.hp / Math.max(1, hud.boss.maxHp)))),
      4,
      r.theme.danger,
    );
  } else if (!arcade && hud.mechanic) {
    r.text(shortLabel(hud.mechanic.label, 20), 175, 10, r.theme.dim);
    r.text(shortLabel(hud.mechanic.value, 20), 175, 24, r.theme.text);
  }
  if (arcade && !hud.boss && hud.mechanic)
    r.text(shortLabel(`${hud.mechanic.label} ${hud.mechanic.value}`, 24), 166, 31, r.theme.text);
  if (hud.mechanic?.progress !== undefined && !hud.boss && !arcade) {
    const progress = Math.max(0, Math.min(1, hud.mechanic.progress));
    r.rect(175, 37, 156, 2, r.theme.barBg);
    r.rect(175, 37, Math.round(156 * progress), 2, r.theme.heading);
  }
  if (hud.stage && !hud.boss) {
    const label = `${PRESENTATION_CATALOG[f].stage} ${hud.stage.index}/${hud.stage.total}`;
    r.rect(6, 47, r.textWidth(label) + 12, 14, r.theme.panelBg);
    r.text(label, 12, 50, r.theme.heading);
  }
  // Boss HP must not hide charge/strike readiness. A separate bounded strip
  // keeps both live values visible without occupying the playfield's center.
  if (hud.boss && hud.mechanic) {
    const label = shortLabel(`${hud.mechanic.label} ${hud.mechanic.value}`, 30);
    r.rect(6, 47, r.textWidth(label) + 12, 14, r.theme.panelBg);
    r.text(label, 12, 50, r.theme.text);
  }
}
