// Story-card screen renderer: letter-by-letter text, optional 64×64 portrait,
// A/START to skip-complete then advance. A reusable widget driven by archetypes
// and the host.
import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  PRESENTATION_CATALOG,
  type PresentationFamily,
} from '@sparkade/shared';
import type { Renderer } from './renderer';
import type { InputSnapshot } from './types';
import {
  familyBackdrop,
  familyCardLayout,
  familyCardPages,
  familyHeading,
  familyIllustration,
} from './presentation';

const CHARS_PER_SECOND = 40;

export interface CardContent {
  illustration?: CanvasImageSource | null;
  stage?: { index: number; total: number };
  title?: string;
  lines: string[];
  portrait?: CanvasImageSource | null;
  /** Selects image-generated scene art supplied by the host. */
  artRole?: 'intro' | 'boss' | 'victory' | 'defeat';
  /** Auto-advance after this many seconds once fully revealed (0 = wait for input). */
  autoAdvanceS?: number;
}

export interface StoryArt {
  intro?: CanvasImageSource | null;
  boss?: CanvasImageSource | null;
  victory?: CanvasImageSource | null;
  defeat?: CanvasImageSource | null;
}

export class StoryCards {
  private queue: CardContent[] = [];
  private revealed = 0;
  private fullyRevealedAt = -1;
  private t = 0;
  private onAllDone: (() => void) | null = null;
  private page = 0;
  private pages = new WeakMap<CardContent, string[][]>();

  constructor(
    private art: StoryArt = {},
    private family?: PresentationFamily,
    private onAdvance?: () => void,
  ) {}

  get active(): boolean {
    return this.queue.length > 0;
  }

  show(cards: CardContent[], onAllDone?: () => void): void {
    this.queue = [...cards];
    this.pages = new WeakMap();
    this.page = 0;
    this.revealed = 0;
    this.t = 0;
    this.fullyRevealedAt = -1;
    this.onAllDone = onAllDone ?? null;
  }

  /** Returns true while consuming input (card on screen). */
  update(dt: number, input: InputSnapshot): boolean {
    const card = this.queue[0];
    if (!card) return false;
    this.t += dt;
    const total = this.totalChars(card);
    if (this.revealed < total) {
      this.revealed = Math.min(total, this.revealed + CHARS_PER_SECOND * dt);
      if (input.A.pressed || input.START.pressed) this.revealed = total;
      if (this.revealed >= total) this.fullyRevealedAt = this.t;
    } else {
      const auto = card.autoAdvanceS ?? 0;
      const autoFire =
        auto > 0 && this.fullyRevealedAt >= 0 && this.t - this.fullyRevealedAt >= auto;
      if (input.A.pressed || input.START.pressed || autoFire) this.advance();
    }
    return true;
  }

  /** Attract/demo: drop all remaining cards and fire onAllDone so play begins
   *  immediately (no intro text to read in a library preview). */
  skip(): void {
    this.queue = [];
    this.page = 0;
    this.revealed = 0;
    this.t = 0;
    this.fullyRevealedAt = -1;
    const cb = this.onAllDone;
    this.onAllDone = null;
    cb?.();
  }

  private advance(): void {
    this.onAdvance?.();
    if (this.family && this.page + 1 < this.pagesFor(this.queue[0]!).length) this.page++;
    else {
      this.queue.shift();
      this.page = 0;
    }
    this.revealed = 0;
    this.t = 0;
    this.fullyRevealedAt = -1;
    if (this.queue.length === 0 && this.onAllDone) {
      const cb = this.onAllDone;
      this.onAllDone = null;
      cb();
    }
  }

  private pagesFor(card: CardContent): string[][] {
    let pages = this.pages.get(card);
    if (!pages) {
      pages = familyCardPages(card.lines, this.family!);
      this.pages.set(card, pages);
    }
    return pages;
  }

  private totalChars(card: CardContent): number {
    if (this.family) return this.pagesFor(card)[this.page]!.reduce((n, line) => n + line.length, 0);
    return card.lines.reduce((n, l) => n + l.length, 0);
  }

  render(r: Renderer): void {
    const card = this.queue[0];
    if (!card) return;
    if (this.family) {
      const f = PRESENTATION_CATALOG[this.family];
      const layout = familyCardLayout(this.family);
      const pages = this.pagesFor(card);
      familyBackdrop(r);
      const kicker = card.stage
        ? `${f.stage} ${card.stage.index} / ${card.stage.total}`
        : card.artRole === 'boss'
          ? f.boss
          : card.artRole === 'victory'
            ? f.won
            : card.artRole === 'defeat'
              ? f.lost
              : f.intro;
      r.text(kicker, 40, layout.kickerY, r.theme.dim);
      familyHeading(r, card.title ?? '', layout.title.x, layout.title.y, layout.title.w);
      const scene = card.artRole ? this.art[card.artRole] : null;
      const picture = scene ?? card.illustration ?? card.portrait;
      r.rect(layout.art.x, layout.art.y, layout.art.w, layout.art.h, r.theme.barBg);
      if (picture) familyIllustration(r, picture, layout.art);
      else {
        // A small chapter path replaces missing art; it never implies a map or objective.
        for (let i = 0; i < 5; i++) {
          const x = layout.art.x + 24 + i * 34,
            y = layout.art.y + layout.art.h / 2 + (i % 2 ? 8 : -8);
          r.rect(x, y, 8, 8, r.theme.accent);
          if (i < 4) r.rect(x + 8, y + 3, 26, 2, r.theme.panelBorder);
        }
      }
      if (this.family === 'storybook') r.rect(250, 96, 2, 136, r.theme.panelBorder);
      r.frame(layout.art.x, layout.art.y, layout.art.w, layout.art.h, r.theme.panelBorder);
      let budget = Math.floor(this.revealed);
      pages[this.page]!.forEach((line, i) => {
        r.text(line, layout.text.x, layout.text.y + i * 12, r.theme.text, {
          reveal: Math.max(0, budget),
        });
        budget -= line.length;
      });
      r.text(`${this.page + 1}/${pages.length}`, 42, 251, r.theme.dim);
      r.text(
        this.revealed >= this.totalChars(card) ? '(A) CONTINUE' : '(A) REVEAL',
        468,
        251,
        r.theme.heading,
        { align: 'right' },
      );
      return;
    }
    r.dim(0.82);
    const hasPortrait = !!card.portrait;
    const panelW = 420;
    const panelH = 180;
    const px = (INTERNAL_WIDTH - panelW) / 2;
    const py = (INTERNAL_HEIGHT - panelH) / 2;
    const scene = card.artRole ? this.art[card.artRole] : null;
    if (scene) {
      // Muse art remains visible as the card's setting while a dark wash keeps
      // the small bitmap font readable against arbitrary generated imagery.
      r.drawScaled(scene, px, py, panelW, panelH);
      r.ctx.fillStyle = 'rgba(4, 6, 14, 0.64)';
      r.ctx.fillRect(px, py, panelW, panelH);
      r.frame(px, py, panelW, panelH, r.theme.panelBorder);
      r.frame(px + 2, py + 2, panelW - 4, panelH - 4, '#00000055');
    } else {
      r.panel(px, py, panelW, panelH);
    }

    let textX = px + 16;
    let textW = panelW - 32;
    if (hasPortrait) {
      r.frame(px + 14, py + 16, 68, 68, r.theme.accent);
      r.drawScaled(card.portrait!, px + 16, py + 18, 64, 64);
      textX = px + 96;
      textW = panelW - 112;
    }
    let y = py + 16;
    if (card.title) {
      r.text(card.title, textX, y, r.theme.heading);
      y += 16;
    }
    // Letter-by-letter across wrapped lines.
    let budget = Math.floor(this.revealed);
    for (const line of card.lines) {
      const wrapped = r.wrapText(line, textW);
      for (const wl of wrapped) {
        if (budget <= 0) break;
        r.text(wl, textX, y, r.theme.text, { reveal: budget });
        budget -= wl.length;
        y += 12;
      }
      if (budget <= 0) break;
      y += 4; // paragraph gap
    }
    const total = this.totalChars(card);
    if (this.revealed >= total && Math.floor(this.t * 2) % 2 === 0) {
      r.text('(A)', px + panelW - 30, py + panelH - 16, r.theme.accent);
    }
  }
}
