import { describe, expect, it } from 'vitest';
import { FONT_GLYPHS, LIBRARY, missingLibraryIds } from '@sparkade/engine';
import {
  LIB_HEROES_ADVENTURE,
  LIB_HEROES_PLATFORMER,
  LIB_SHIPS,
  LIB_THEMED_TILES,
  LIB_TILES,
} from '@sparkade/shared';

describe('built-in sprite library', () => {
  it('implements every id the schemas/prompts promise', () => {
    expect(missingLibraryIds()).toEqual([]);
  });

  it('every frame is well-formed palette-indexed art', () => {
    for (const [id, entry] of Object.entries(LIBRARY)) {
      expect(entry.frames.length, id).toBeGreaterThan(0);
      expect(entry.anims['idle'], `${id} needs idle anim`).toBeDefined();
      const { w, h } = entry.frames[0]!;
      for (const [fi, f] of entry.frames.entries()) {
        expect(f.w, `${id}#${fi}`).toBe(w);
        expect(f.h, `${id}#${fi}`).toBe(h);
        expect(f.rows.length, `${id}#${fi}`).toBe(f.h);
        for (const row of f.rows) {
          expect(row.length, `${id}#${fi}`).toBe(f.w);
          expect(row, `${id}#${fi}`).toMatch(/^[0-9a-f.]+$/);
        }
      }
      for (const idxs of Object.values(entry.anims)) {
        for (const ix of idxs) expect(ix, id).toBeLessThan(entry.frames.length);
      }
    }
  });

  it('heroes and ships carry head slots for the likeness pipeline', () => {
    for (const id of [...LIB_HEROES_PLATFORMER, ...LIB_HEROES_ADVENTURE, ...LIB_SHIPS]) {
      const entry = LIBRARY[id]!;
      expect(entry.headSlots, id).toBeDefined();
      expect(entry.headSlots!.length, id).toBe(entry.frames.length);
    }
  });

  it('tiles are 16×16 (default set and every themed family)', () => {
    for (const id of [...LIB_TILES, ...LIB_THEMED_TILES]) {
      expect(LIBRARY[id]!.frames[0]!.w, id).toBe(16);
      expect(LIBRARY[id]!.frames[0]!.h, id).toBe(16);
    }
  });

  it('structural tiles are near-fully opaque in every family', () => {
    for (const id of [...LIB_TILES, ...LIB_THEMED_TILES]) {
      if (!/(_solid|_wall|_floor|_block)$/.test(id)) continue;
      const f = LIBRARY[id]!.frames[0]!;
      let opaque = 0;
      for (const row of f.rows) for (const ch of row) if (ch !== '.') opaque++;
      expect(opaque / (f.w * f.h), id).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('bitmap font', () => {
  it('covers A-Z 0-9 and punctuation with 8×8 glyphs', () => {
    const required = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?:;\'"()[]+-*/=<>_%#@&';
    for (const ch of required) {
      const glyph = FONT_GLYPHS[ch];
      expect(glyph, `glyph '${ch}'`).toBeDefined();
      expect(glyph!.length, `glyph '${ch}'`).toBe(8);
      for (const row of glyph!) expect(row, `glyph '${ch}'`).toMatch(/^[.#]{8}$/);
    }
  });
});
