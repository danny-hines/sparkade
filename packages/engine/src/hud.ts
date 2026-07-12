// In-game HUD: score, lives, health, keys, bombs, boss bar. Drawn by the
// substrate every frame from HudState. Tiny icons are engine-owned art.
import { INTERNAL_WIDTH, type SpriteData } from '@sparkade/shared';
import { decodeSprite } from './sprites';
import type { Renderer } from './renderer';
import type { HudState } from './types';

const ICON_PALETTE = [
  '#000000',
  '#1a1c2c',
  '#29366f',
  '#3b5dc9',
  '#41a6f6',
  '#38b764',
  '#a7f070',
  '#ffcd75',
  '#b13e53',
  '#ef7d57',
  '#5d275d',
  '#e04040',
  '#ffa300',
  '#ffd75e',
  '#94b0c2',
  '#f4f4f4',
];

const HEART: SpriteData = {
  w: 8,
  h: 8,
  rows: ['.bb..bb.', 'bffbbbfb', 'bfbbbbbb', 'bbbbbbbb', '.bbbbbb.', '..bbbb..', '...bb...', '........'],
};
const HEART_EMPTY: SpriteData = {
  w: 8,
  h: 8,
  rows: ['.11..11.', '1..11..1', '1......1', '1......1', '.1....1.', '..1..1..', '...11...', '........'],
};
const KEY: SpriteData = {
  w: 8,
  h: 8,
  rows: ['.dd.....', 'd..d....', 'd..d....', '.dd.....', '..d.....', '..ddd...', '..d.....', '..dd....'],
};
const BOMB: SpriteData = {
  w: 8,
  h: 8,
  rows: ['.....c..', '....1...', '..111...', '.11111..', '.11111..', '.11111..', '..111...', '........'],
};
const LIFE: SpriteData = {
  w: 8,
  h: 8,
  rows: ['..555...', '.56655..', '.56555..', '.55555..', '..555...', '.5...5..', '........', '........'],
};

export class Hud {
  private icons: Record<string, HTMLCanvasElement> = {};

  constructor() {
    this.icons['heart'] = decodeSprite(HEART, ICON_PALETTE);
    this.icons['heartEmpty'] = decodeSprite(HEART_EMPTY, ICON_PALETTE);
    this.icons['key'] = decodeSprite(KEY, ICON_PALETTE);
    this.icons['bomb'] = decodeSprite(BOMB, ICON_PALETTE);
    this.icons['life'] = decodeSprite(LIFE, ICON_PALETTE);
  }

  render(r: Renderer, hud: HudState, opts: { showBombs?: boolean; showKeys?: boolean } = {}): void {
    // Top strip, translucent so gameplay stays visible beneath.
    r.rect(0, 0, INTERNAL_WIDTH, 20, 'rgba(6,7,20,0.75)');

    // Health hearts (left)
    let x = 6;
    for (let i = 0; i < hud.maxHealth; i++) {
      r.draw(this.icons[i < hud.health ? 'heart' : 'heartEmpty']!, x, 6);
      x += 10;
    }
    // Lives
    x += 8;
    r.draw(this.icons['life']!, x, 6);
    r.text(`x${hud.lives}`, x + 10, 6, '#f4f4f4');
    x += 36;
    if (opts.showKeys && hud.keys > 0) {
      r.draw(this.icons['key']!, x, 6);
      r.text(`x${hud.keys}`, x + 10, 6, '#ffd75e');
      x += 36;
    }
    if (opts.showBombs) {
      r.draw(this.icons['bomb']!, x, 6);
      r.text(`x${hud.bombs}`, x + 10, 6, '#f4f4f4');
      x += 36;
    }

    // Score (right)
    r.text(String(hud.score).padStart(7, '0'), INTERNAL_WIDTH - 6, 6, '#ffd75e', { align: 'right' });

    // Boss bar (center, only during boss fights)
    if (hud.boss) {
      const w = 160;
      const bx = (INTERNAL_WIDTH - w) / 2;
      r.text(hud.boss.name, INTERNAL_WIDTH / 2, 4, '#ef7d57', { align: 'center' });
      r.rect(bx, 13, w, 5, '#1a1c2c');
      const fill = Math.max(0, Math.round((hud.boss.hp / hud.boss.maxHp) * (w - 2)));
      r.rect(bx + 1, 14, fill, 3, '#e04040');
    }
  }
}
