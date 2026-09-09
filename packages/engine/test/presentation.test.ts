import { describe, expect, it, vi } from 'vitest';
import { PRESENTATION_FAMILIES, type PresentationFamily } from '@sparkade/shared';
import {
  familyCardLayout,
  familyCardPages,
  familyControls,
  familyHud,
  familyTally,
  runClock,
} from '../src/presentation';
import { StoryCards } from '../src/storycard';
import { HowToPlayCard } from '../src/overlays';
import type { Renderer } from '../src/renderer';
import type { HudState, InputSnapshot } from '../src/types';
import { makeUiTheme } from '../src/theme';
import { textWidth, wrapText, type TextOpts } from '../src/font';

const idle = Object.fromEntries(
  ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'START', 'SELECT', 'L', 'R'].map((button) => [
    button,
    { held: false, pressed: false, released: false },
  ]),
) as InputSnapshot;
const confirm = { ...idle, A: { held: true, pressed: true, released: false } };

function recorder(family: PresentationFamily) {
  const text: { value: string; x: number; y: number; w: number; h: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const r = {
    presentationFamily: family,
    theme: makeUiTheme([], family),
    ctx: { save() {}, restore() {}, globalAlpha: 1 },
    textWidth,
    wrapText,
    clear() {},
    dim() {},
    frame() {},
    drawScaled() {},
    rect(x: number, y: number, w: number, h: number, color: string) {
      rects.push({ x, y, w, h, color });
    },
    text(value: string, x: number, y: number, _color: string, opts: TextOpts = {}) {
      const w = textWidth(value, opts.scale);
      text.push({
        value,
        x: x - (opts.align === 'right' ? w : opts.align === 'center' ? w / 2 : 0),
        y,
        w,
        h: 8 * (opts.scale ?? 1),
      });
    },
  } as unknown as Renderer;
  return { r, text, rects };
}

describe.each(PRESENTATION_FAMILIES)('%s presentation', (family) => {
  it('paginates every story word and calls completion only after the last page', () => {
    const lines = ['An expedition '.repeat(85), 'X'.repeat(200), 'The final words.'];
    const pages = familyCardPages(lines, family);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().join('').replaceAll(' ', '')).toBe(lines.join('').replaceAll(' ', ''));
    const layout = familyCardLayout(family);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(layout.text.rows);
      for (const line of page) expect(textWidth(line)).toBeLessThanOrEqual(layout.text.w);
    }
    const done = vi.fn();
    const cards = new StoryCards({}, family);
    cards.show(
      [{ title: 'The remarkably lengthy title of a generated game in the forest', lines }],
      done,
    );
    for (let i = 0; i < pages.length; i++) {
      expect(cards.active).toBe(true);
      cards.update(0, confirm); // Reveal without also skipping the page.
      expect(done).not.toHaveBeenCalled();
      const { r, text } = recorder(family);
      cards.render(r);
      for (const line of text) {
        expect(line.x, line.value).toBeGreaterThanOrEqual(18);
        expect(line.x + line.w, line.value).toBeLessThanOrEqual(494);
        expect(line.y + line.h, line.value).toBeLessThanOrEqual(266);
        if (line.y === layout.title.y) expect(line.y + line.h).toBeLessThan(layout.art.y);
      }
      cards.update(0, confirm);
    }
    expect(cards.active).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    cards.skip();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps eight controls and the exit instruction inside the cabinet frame', () => {
    const controls = ['LEFT', 'RIGHT', 'DOWN', 'A', 'B', 'Y', 'X', 'UP'].map((button) => ({
      button: button as 'A',
      label: 'Hold / release charge',
    }));
    const { r, text } = recorder(family);
    familyControls(r, 'A long generated game title that should wrap safely', controls, '(A) BEGIN');
    expect(text.filter((line) => line.value === 'Hold / release charge')).toHaveLength(8);
    for (const line of text) {
      expect(line.x + line.w).toBeLessThanOrEqual(470);
      expect(line.y + line.h).toBeLessThanOrEqual(264);
    }
    const howto = new HowToPlayCard('Title', controls, family);
    howto.update(60, idle);
    expect(howto.done).toBe(false);
    howto.update(0, confirm);
    expect(howto.done).toBe(true);
  });

  it('shows actual score, elapsed time and charge readiness alongside boss HP', () => {
    const { r, text, rects } = recorder(family);
    const hud: HudState = {
      score: 4200,
      health: 2,
      maxHealth: 4,
      lives: 3,
      keys: 0,
      bombs: 0,
      collectibles: 17,
      mechanic: { label: 'WALL / CHARGE', value: '75%', progress: 0.75 },
      boss: { name: 'Clockwork Warden Supreme', hp: 5, maxHp: 20 },
    };
    familyHud(
      r,
      hud,
      {
        heart: {} as CanvasImageSource,
        empty: {} as CanvasImageSource,
        collectible: {} as CanvasImageSource,
      },
      312.8,
    );
    expect(text.map((t) => t.value)).toEqual(
      expect.arrayContaining(['0004200', '05:12', 'X17', 'WALL / CHARGE 75%']),
    );
    if (family === 'arcade') expect(text.map((t) => t.value)).toContain(hud.boss!.name);
    for (const line of text) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + line.w, line.value).toBeLessThanOrEqual(512);
    }
    const boss = rects.find((rect) => rect.color === r.theme.danger)!;
    const track = rects.find(
      (rect) => rect.x === boss.x && rect.y === boss.y && rect.color === r.theme.barBg,
    )!;
    expect(Math.abs(boss.w / track.w - 0.25)).toBeLessThan(0.01);
    if (family === 'tech')
      expect(rects.filter((rect) => rect.h === 10 && rect.color === r.theme.heading)).toHaveLength(
        2,
      );
  });

  it('does not show a time bonus for defeat', () => {
    const { r, text } = recorder(family);
    familyTally(r, {
      score: 4200,
      shownBonus: 0,
      shownTotal: 4200,
      won: false,
      ready: true,
      elapsedSeconds: 312,
    });
    expect(text.map((t) => t.value)).not.toContain('TIME BONUS');
    expect(text.map((t) => t.value)).toContain('05:12');
  });
});

it('keeps the legacy controls timeout and clamps invalid elapsed time', () => {
  const card = new HowToPlayCard('Legacy', []);
  card.update(3, idle);
  expect(card.done).toBe(true);
  expect(runClock(-5)).toBe('00:00');
  expect(runClock(NaN)).toBe('00:00');
});
