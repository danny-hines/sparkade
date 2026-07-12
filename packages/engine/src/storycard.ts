// Story-card screen renderer: letter-by-letter text, optional 64×64 portrait,
// A/START to skip-complete then advance. A reusable widget driven by archetypes
// and the host.
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '@sparkade/shared';
import type { Renderer } from './renderer';
import type { InputSnapshot } from './types';

const CHARS_PER_SECOND = 40;

export interface CardContent {
  title?: string;
  lines: string[];
  portrait?: CanvasImageSource | null;
  /** Auto-advance after this many seconds once fully revealed (0 = wait for input). */
  autoAdvanceS?: number;
}

export class StoryCards {
  private queue: CardContent[] = [];
  private revealed = 0;
  private fullyRevealedAt = -1;
  private t = 0;
  private onAllDone: (() => void) | null = null;

  get active(): boolean {
    return this.queue.length > 0;
  }

  show(cards: CardContent[], onAllDone?: () => void): void {
    this.queue = [...cards];
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
      const autoFire = auto > 0 && this.fullyRevealedAt >= 0 && this.t - this.fullyRevealedAt >= auto;
      if (input.A.pressed || input.START.pressed || autoFire) this.advance();
    }
    return true;
  }

  private advance(): void {
    this.queue.shift();
    this.revealed = 0;
    this.t = 0;
    this.fullyRevealedAt = -1;
    if (this.queue.length === 0 && this.onAllDone) {
      const cb = this.onAllDone;
      this.onAllDone = null;
      cb();
    }
  }

  private totalChars(card: CardContent): number {
    return card.lines.reduce((n, l) => n + l.length, 0);
  }

  render(r: Renderer): void {
    const card = this.queue[0];
    if (!card) return;
    r.dim(0.82);
    const hasPortrait = !!card.portrait;
    const panelW = 420;
    const panelH = 180;
    const px = (INTERNAL_WIDTH - panelW) / 2;
    const py = (INTERNAL_HEIGHT - panelH) / 2;
    r.panel(px, py, panelW, panelH);

    let textX = px + 16;
    let textW = panelW - 32;
    if (hasPortrait) {
      r.frame(px + 14, py + 16, 68, 68, '#41a6f6');
      r.drawScaled(card.portrait!, px + 16, py + 18, 64, 64);
      textX = px + 96;
      textW = panelW - 112;
    }
    let y = py + 16;
    if (card.title) {
      r.text(card.title, textX, y, '#ffd75e');
      y += 16;
    }
    // Letter-by-letter across wrapped lines.
    let budget = Math.floor(this.revealed);
    for (const line of card.lines) {
      const wrapped = r.wrapText(line, textW);
      for (const wl of wrapped) {
        if (budget <= 0) break;
        r.text(wl, textX, y, '#f4f4f4', { reveal: budget });
        budget -= wl.length;
        y += 12;
      }
      if (budget <= 0) break;
      y += 4; // paragraph gap
    }
    const total = this.totalChars(card);
    if (this.revealed >= total && Math.floor(this.t * 2) % 2 === 0) {
      r.text('(A)', px + panelW - 30, py + panelH - 16, '#41a6f6');
    }
  }
}
