// Substrate-owned overlays: pause menu (with controls card + audio volumes),
// how-to-play card, score tally, initials entry, leaderboard view.
// All fully d-pad operable; A confirms, B backs — regardless of gameplay bindings.
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, type ControlLabel } from '@sparkade/shared';
import { MenuRepeater } from './input';
import type { Renderer } from './renderer';
import type { InputSnapshot } from './types';

export type PauseAction = 'resume' | 'restart' | 'quit' | null;

interface PauseHooks {
  controlHelp: ControlLabel[];
  getVolumes(): { musicVol: number; sfxVol: number; uiVol: number };
  setVolumes(v: { musicVol: number; sfxVol: number; uiVol: number }): void;
  uiBlip(kind: 'move' | 'select' | 'back'): void;
}

const PAUSE_ITEMS = ['Resume', 'Restart', 'Controls', 'Audio', 'Quit to Menu'] as const;

export class PauseOverlay {
  private cursor = 0;
  private screen: 'menu' | 'controls' | 'audio' = 'menu';
  private audioCursor = 0;
  private repeater = new MenuRepeater();

  constructor(private hooks: PauseHooks) {}

  reset(): void {
    this.cursor = 0;
    this.screen = 'menu';
  }

  /** Returns an action for the host, or null while still paused. */
  update(input: InputSnapshot): PauseAction {
    if (this.screen === 'controls') {
      if (input.B.pressed || input.A.pressed) {
        this.hooks.uiBlip('back');
        this.screen = 'menu';
      }
      return null;
    }
    if (this.screen === 'audio') {
      const vols = this.hooks.getVolumes();
      const keys = ['musicVol', 'sfxVol', 'uiVol'] as const;
      if (this.repeater.fires(input, 'UP')) {
        this.audioCursor = (this.audioCursor + 2) % 3;
        this.hooks.uiBlip('move');
      }
      if (this.repeater.fires(input, 'DOWN')) {
        this.audioCursor = (this.audioCursor + 1) % 3;
        this.hooks.uiBlip('move');
      }
      const key = keys[this.audioCursor]!;
      if (this.repeater.fires(input, 'LEFT')) {
        vols[key] = Math.max(0, Math.round((vols[key] - 0.1) * 10) / 10);
        this.hooks.setVolumes(vols);
        this.hooks.uiBlip('move');
      }
      if (this.repeater.fires(input, 'RIGHT')) {
        vols[key] = Math.min(1, Math.round((vols[key] + 0.1) * 10) / 10);
        this.hooks.setVolumes(vols);
        this.hooks.uiBlip('move');
      }
      if (input.B.pressed) {
        this.hooks.uiBlip('back');
        this.screen = 'menu';
      }
      return null;
    }
    // main pause menu — B resumes regardless of bindings
    if (input.B.pressed) {
      this.hooks.uiBlip('back');
      return 'resume';
    }
    if (this.repeater.fires(input, 'UP')) {
      this.cursor = (this.cursor + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
      this.hooks.uiBlip('move');
    }
    if (this.repeater.fires(input, 'DOWN')) {
      this.cursor = (this.cursor + 1) % PAUSE_ITEMS.length;
      this.hooks.uiBlip('move');
    }
    if (input.A.pressed || input.START.pressed) {
      this.hooks.uiBlip('select');
      switch (this.cursor) {
        case 0:
          return 'resume';
        case 1:
          return 'restart';
        case 2:
          this.screen = 'controls';
          return null;
        case 3:
          this.screen = 'audio';
          return null;
        case 4:
          return 'quit';
      }
    }
    return null;
  }

  render(r: Renderer): void {
    r.dim(0.7);
    const w = 240;
    const h = 170;
    const x = (INTERNAL_WIDTH - w) / 2;
    const y = (INTERNAL_HEIGHT - h) / 2;
    r.panel(x, y, w, h);
    if (this.screen === 'controls') {
      r.text('CONTROLS', INTERNAL_WIDTH / 2, y + 12, r.theme.heading, { align: 'center' });
      let cy = y + 34;
      for (const c of this.hooks.controlHelp) {
        r.text(`(${c.button})`, x + 20, cy, r.theme.accent);
        r.text(c.label, x + 84, cy, r.theme.text);
        cy += 14;
      }
      r.text('START Pause', x + 20, cy, r.theme.dim);
      r.text('(B) Back', x + w - 80, y + h - 16, r.theme.dim);
      return;
    }
    if (this.screen === 'audio') {
      r.text('AUDIO', INTERNAL_WIDTH / 2, y + 12, r.theme.heading, { align: 'center' });
      const vols = this.hooks.getVolumes();
      const rows: [string, number][] = [
        ['MUSIC', vols.musicVol],
        ['SFX', vols.sfxVol],
        ['UI', vols.uiVol],
      ];
      rows.forEach(([label, v], i) => {
        const cy = y + 44 + i * 26;
        const active = i === this.audioCursor;
        r.text(label, x + 24, cy, active ? r.theme.heading : r.theme.dim);
        const barX = x + 90;
        r.rect(barX, cy + 1, 110, 6, r.theme.barBg);
        r.rect(barX, cy + 1, Math.round(v * 110), 6, active ? r.theme.accent : r.theme.barMid);
        if (active) r.text('<', barX - 12, cy, r.theme.accent);
        if (active) r.text('>', barX + 114, cy, r.theme.accent);
      });
      r.text('(B) Back', x + w - 80, y + h - 16, r.theme.dim);
      return;
    }
    r.text('PAUSED', INTERNAL_WIDTH / 2, y + 12, r.theme.heading, { align: 'center' });
    PAUSE_ITEMS.forEach((item, i) => {
      const cy = y + 38 + i * 18;
      const active = i === this.cursor;
      if (active) r.text('>', x + 34, cy, r.theme.cursor);
      r.text(item, x + 48, cy, active ? r.theme.text : r.theme.dim);
    });
    r.text('(A) Select  (B) Resume', x + 24, y + h - 16, r.theme.dim);
  }
}

// ---------------------------------------------------------------------------

export class HowToPlayCard {
  private t = 0;
  done = false;

  constructor(
    private title: string,
    private controls: ControlLabel[],
  ) {}

  update(dt: number, input: InputSnapshot): void {
    this.t += dt;
    if (this.t > 0.35 && (input.A.pressed || input.START.pressed)) this.done = true;
    if (this.t >= 3) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(r.theme.screenBg);
    r.text('HOW TO PLAY', INTERNAL_WIDTH / 2, 40, r.theme.heading, { align: 'center', scale: 2 });
    r.text(this.title, INTERNAL_WIDTH / 2, 70, r.theme.dim, { align: 'center' });
    let y = 105;
    for (const c of this.controls) {
      r.text(`(${c.button})`, INTERNAL_WIDTH / 2 - 100, y, r.theme.accent);
      r.text(c.label, INTERNAL_WIDTH / 2 - 40, y, r.theme.text);
      y += 16;
    }
    r.text('START Pause', INTERNAL_WIDTH / 2 - 40, y + 4, r.theme.dim);
    if (Math.floor(this.t * 2) % 2 === 0)
      r.text('(A) Skip', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 30, r.theme.accent, { align: 'center' });
  }
}

// ---------------------------------------------------------------------------

export class ScoreTally {
  private t = 0;
  done = false;
  total: number;

  constructor(
    private score: number,
    private timeBonusSeconds: number,
    private bonusPerSecond: number,
    private won: boolean,
  ) {
    this.total = score + Math.max(0, Math.round(timeBonusSeconds * bonusPerSecond));
  }

  update(dt: number, input: InputSnapshot): void {
    this.t += dt;
    if ((input.A.pressed || input.START.pressed) && this.t > 0.5) {
      if (this.t < 2.5) this.t = 2.5;
      else this.done = true;
    }
    if (this.t > 6) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(r.theme.screenBg);
    const bonus = Math.max(0, Math.round(this.timeBonusSeconds * this.bonusPerSecond));
    const reveal = Math.min(1, Math.max(0, (this.t - 0.8) / 1.5));
    const shownBonus = Math.round(bonus * reveal);
    const shownTotal = this.score + shownBonus;
    r.text(this.won ? 'STAGE CLEAR!' : 'GAME OVER', INTERNAL_WIDTH / 2, 60, this.won ? r.theme.heading : r.theme.bossName, {
      align: 'center',
      scale: 2,
    });
    r.text(`SCORE      ${String(this.score).padStart(7, '0')}`, INTERNAL_WIDTH / 2, 120, r.theme.text, {
      align: 'center',
    });
    if (this.won) {
      r.text(`TIME BONUS ${String(shownBonus).padStart(7, '0')}`, INTERNAL_WIDTH / 2, 140, r.theme.dim, {
        align: 'center',
      });
    }
    r.text(`TOTAL      ${String(shownTotal).padStart(7, '0')}`, INTERNAL_WIDTH / 2, 168, r.theme.heading, {
      align: 'center',
    });
    if (this.t > 2.5 && Math.floor(this.t * 2) % 2 === 0)
      r.text('(A) Continue', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 40, r.theme.accent, { align: 'center' });
  }
}

// ---------------------------------------------------------------------------

const INITIALS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.';

export class InitialsEntry {
  private slots = [0, 0, 0];
  private slot = 0;
  private repeater = new MenuRepeater();
  private t = 0;
  done = false;
  skipped = false;

  constructor(private uiBlip: (kind: 'move' | 'select' | 'back') => void) {}

  get initials(): string {
    if (this.skipped) return 'GST';
    return this.slots.map((i) => INITIALS_CHARS[i]).join('');
  }

  update(dt: number, input: InputSnapshot): void {
    this.t += dt;
    if (this.repeater.fires(input, 'UP')) {
      this.slots[this.slot] = (this.slots[this.slot]! + INITIALS_CHARS.length - 1) % INITIALS_CHARS.length;
      this.uiBlip('move');
    }
    if (this.repeater.fires(input, 'DOWN')) {
      this.slots[this.slot] = (this.slots[this.slot]! + 1) % INITIALS_CHARS.length;
      this.uiBlip('move');
    }
    if (input.LEFT.pressed && this.slot > 0) {
      this.slot--;
      this.uiBlip('move');
    }
    if (input.RIGHT.pressed && this.slot < 2) {
      this.slot++;
      this.uiBlip('move');
    }
    if (input.A.pressed) {
      this.uiBlip('select');
      if (this.slot < 2) this.slot++;
      else this.done = true;
    }
    if (input.B.pressed) {
      if (this.slot > 0) {
        this.slot--;
        this.uiBlip('back');
      } else {
        this.skipped = true;
        this.done = true;
        this.uiBlip('back');
      }
    }
  }

  render(r: Renderer, score: number): void {
    r.clear(r.theme.screenBg);
    r.text('NEW HIGH SCORE!', INTERNAL_WIDTH / 2, 56, r.theme.heading, { align: 'center', scale: 2 });
    r.text(String(score).padStart(7, '0'), INTERNAL_WIDTH / 2, 92, r.theme.text, { align: 'center' });
    r.text('ENTER YOUR INITIALS', INTERNAL_WIDTH / 2, 120, r.theme.dim, { align: 'center' });
    const cx = INTERNAL_WIDTH / 2 - 45;
    for (let i = 0; i < 3; i++) {
      const active = i === this.slot;
      const ch = INITIALS_CHARS[this.slots[i]!]!;
      const x = cx + i * 34;
      r.panel(x, 140, 26, 34, r.theme.panelBg, active ? r.theme.cursor : r.theme.barMid);
      r.text(ch, x + 13, 152, active ? r.theme.heading : r.theme.text, { align: 'center', scale: 2 });
      if (active && Math.floor(this.t * 3) % 2 === 0) {
        r.text('^', x + 13, 130, r.theme.accent, { align: 'center' });
        r.text('v', x + 13, 180, r.theme.accent, { align: 'center' });
      }
    }
    r.text('(A) Confirm  (B) Skip', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT - 40, r.theme.dim, {
      align: 'center',
    });
  }
}

// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  initials: string;
  score: number;
}

export class LeaderboardView {
  private cursor = 0;
  private repeater = new MenuRepeater();
  action: 'again' | 'exit' | null = null;

  constructor(
    private rows: LeaderboardRow[],
    private highlightIndex: number,
    private uiBlip: (kind: 'move' | 'select' | 'back') => void,
  ) {}

  update(input: InputSnapshot): void {
    if (this.repeater.fires(input, 'LEFT') || this.repeater.fires(input, 'RIGHT')) {
      this.cursor = 1 - this.cursor;
      this.uiBlip('move');
    }
    if (input.A.pressed || input.START.pressed) {
      this.uiBlip('select');
      this.action = this.cursor === 0 ? 'again' : 'exit';
    }
    if (input.B.pressed) {
      this.uiBlip('back');
      this.action = 'exit';
    }
  }

  render(r: Renderer): void {
    r.clear(r.theme.screenBg);
    r.text('HIGH SCORES', INTERNAL_WIDTH / 2, 24, r.theme.heading, { align: 'center', scale: 2 });
    const top = 56;
    for (let i = 0; i < 10; i++) {
      const row = this.rows[i];
      const y = top + i * 16;
      const hl = i === this.highlightIndex;
      const rank = `${String(i + 1).padStart(2, ' ')}.`;
      if (row) {
        r.text(rank, INTERNAL_WIDTH / 2 - 90, y, hl ? r.theme.cursor : r.theme.dim);
        r.text(row.initials, INTERNAL_WIDTH / 2 - 50, y, hl ? r.theme.heading : r.theme.text);
        r.text(String(row.score).padStart(7, '0'), INTERNAL_WIDTH / 2 + 90, y, hl ? r.theme.heading : r.theme.text, {
          align: 'right',
        });
      } else {
        r.text(rank, INTERNAL_WIDTH / 2 - 90, y, '#333c57');
        r.text('---', INTERNAL_WIDTH / 2 - 50, y, '#333c57');
        r.text('-------', INTERNAL_WIDTH / 2 + 90, y, '#333c57', { align: 'right' });
      }
    }
    const by = INTERNAL_HEIGHT - 28;
    const options: [string, number][] = [
      ['PLAY AGAIN', INTERNAL_WIDTH / 2 - 90],
      ['EXIT', INTERNAL_WIDTH / 2 + 50],
    ];
    options.forEach(([label, x], i) => {
      const active = this.cursor === i;
      if (active) r.text('>', x - 14, by, r.theme.cursor);
      r.text(label, x, by, active ? r.theme.text : r.theme.dim);
    });
  }
}
