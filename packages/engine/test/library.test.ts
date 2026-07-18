import { describe, expect, it } from 'vitest';
import {
  FONT_GLYPHS,
  LIBRARY,
  anchorSpriteOpaqueTop,
  makeTallHeroEntry,
  makeTallHumanoidEntry,
  makeTallSpriteEntry,
  missingLibraryIds,
  resolveLikenessHead,
  SpriteStore,
} from '@sparkade/engine';
import {
  LIB_HEROES_ADVENTURE,
  LIB_HEROES_PLATFORMER,
  LIB_SHIPS,
  LIB_TILE_THEMES,
  LIB_THEMED_TILES,
  LIB_TILES,
} from '@sparkade/shared';

describe('built-in sprite library', () => {
  it('can remove accidental transparent padding above a surface sprite', () => {
    const source = {
      w: 5,
      h: 4,
      rows: ['.....', '00000', '.111.', '.....'],
    };

    const anchored = anchorSpriteOpaqueTop(source);
    expect(anchored.rows).toEqual(['.111.', '.....', '.....', '.....']);
    expect(anchored.w).toBe(source.w);
    expect(anchored.h).toBe(source.h);
    expect(source.rows).toEqual(['.....', '00000', '.111.', '.....']);
    expect(anchorSpriteOpaqueTop(anchored)).toBe(anchored);
  });

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

  it('assigns directional head views to movement frames', () => {
    for (const id of LIB_HEROES_PLATFORMER) {
      const views = LIBRARY[id]!.headSlots?.map((slot) => slot.view);
      expect(views, id).toEqual(['front', 'side', 'side', 'side']);
    }

    for (const id of LIB_HEROES_ADVENTURE) {
      expect(
        LIBRARY[id]!.headSlots?.map((slot) => slot.view),
        id,
      ).toEqual(['front', 'front', 'back', 'back', 'side', 'side']);
    }
  });

  it('selects directional likeness assets with front-view fallback', () => {
    const front12 = {} as CanvasImageSource;
    const side12 = {} as CanvasImageSource;
    const back12 = {} as CanvasImageSource;
    const front16 = {} as CanvasImageSource;
    const side16 = {} as CanvasImageSource;
    const likeness = {
      head12: front12,
      head16: front16,
      head12Side: side12,
      head12Back: back12,
      head16Side: side16,
    };

    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 12 })).toBe(front12);
    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 12, view: 'front' })).toBe(front12);
    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 12, view: 'side' })).toBe(side12);
    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 12, view: 'back' })).toBe(back12);
    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 16, view: 'side' })).toBe(side16);
    expect(resolveLikenessHead(likeness, { x: 0, y: 0, size: 16, view: 'back' })).toBe(front16);

    const store = new SpriteStore({} as never, likeness);
    expect(store.likenessHead(12, 'side')).toBe(side12);
    expect(store.likenessHead(16, 'side')).toBe(side16);
    expect(store.likenessHead(16, 'back')).toBe(front16);
    expect(new SpriteStore({} as never, null).likenessHead(16, 'side')).toBeNull();
  });

  it('builds a 16x32 humanoid presentation with a real 16px head budget', () => {
    const source = LIBRARY['hero_squire']!;
    const tall = makeTallHumanoidEntry(source);
    expect(tall).not.toBe(source);
    expect(tall.frames).toHaveLength(source.frames.length);
    for (const [i, frame] of tall.frames.entries()) {
      expect(frame.w, `frame ${i}`).toBe(16);
      expect(frame.h, `frame ${i}`).toBe(32);
      expect(frame.rows).toHaveLength(32);
      expect(frame.rows.slice(0, 16).every((row) => /^\.+$/.test(row))).toBe(true);
      expect(frame.rows.slice(16).some((row) => /[1-9a-f]/.test(row))).toBe(true);
      expect(tall.headSlots?.[i]).toEqual({
        x: 0,
        y: 0,
        size: 16,
        view: i === 0 ? 'front' : 'side',
      });
      expect(tall.likenessOverlays?.[i]?.h).toBe(32);
    }
    // Presentation transforms must never mutate the shared library entry.
    expect(source.frames[0]!.h).toBe(16);
    expect(source.headSlots?.[0]?.size).toBe(12);

    const ineligible = { frames: source.frames, anims: source.anims };
    expect(makeTallHumanoidEntry(ineligible)).toBe(ineligible);

    // Props that lived outside the old 12px face replacement survive the
    // larger compositor instead of becoming a broken pick/sword/scarf.
    const miner = makeTallHumanoidEntry(LIBRARY['hero_miner']!);
    expect(miner.likenessOverlays?.[0]?.rows.slice(0, 16).some((row) => /[1-9a-f]/.test(row))).toBe(
      true,
    );
  });

  it('keeps a scaled native head on a tall library hero when no photo exists', () => {
    const tall = makeTallHeroEntry(LIBRARY['hero_squire']!, true);
    expect(tall.frames.every((frame) => frame.w === 16 && frame.h === 32)).toBe(true);
    expect(tall.frames[0]!.rows.slice(0, 16).some((row) => /[1-9a-f]/.test(row))).toBe(true);
    expect(tall.frames[0]!.rows.slice(16).some((row) => /[1-9a-f]/.test(row))).toBe(true);
  });

  it('normalizes every frame of an old custom hero to the tall contract', () => {
    const custom = {
      frames: [
        { w: 4, h: 4, rows: ['1111', '1221', '1331', '1111'] },
        { w: 4, h: 4, rows: ['2222', '2332', '2442', '2222'] },
      ],
      anims: { idle: [0], walk: [0, 1] },
    };
    const tall = makeTallHeroEntry(custom, true);
    expect(tall).toEqual(makeTallSpriteEntry(custom));
    expect(tall.frames).toHaveLength(2);
    expect(tall.frames.every((frame) => frame.w === 16 && frame.h === 32)).toBe(true);
    expect(tall.anims).toEqual(custom.anims);
    expect(tall.frames[0]!.rows[0]).toBe('1111111111111111');
    expect(tall.frames[1]!.rows[31]).toBe('2222222222222222');
  });

  it('leaves the tall library head empty for the 16px photo compositor', () => {
    const tall = makeTallHeroEntry(LIBRARY['hero_squire']!, false);
    expect(tall.frames[0]!.rows.slice(0, 16).every((row) => /^\.+$/.test(row))).toBe(true);
    expect(tall.headSlots?.[0]).toEqual({ x: 0, y: 0, size: 16, view: 'front' });
  });

  it('supports every platformer hero body promised to the likeness renderer', () => {
    for (const id of LIB_HEROES_PLATFORMER) {
      const tall = makeTallHumanoidEntry(LIBRARY[id]!);
      expect(tall.frames.length, id).toBe(LIBRARY[id]!.frames.length);
      expect(
        tall.frames.every((frame) => frame.w === 16 && frame.h === 32),
        id,
      ).toBe(true);
      expect(
        tall.headSlots?.every((slot) => slot.size === 16),
        id,
      ).toBe(true);
      expect(tall.likenessOverlays?.length, id).toBe(tall.frames.length);
    }
  });

  it('tiles are 16×16 (default set and every themed family)', () => {
    for (const id of [...LIB_TILES, ...LIB_THEMED_TILES]) {
      expect(LIBRARY[id]!.frames[0]!.w, id).toBe(16);
      expect(LIBRARY[id]!.frames[0]!.h, id).toBe(16);
    }
  });

  it('provides a distinct seamless inner body for every solid cap family', () => {
    const families = ['tile', ...LIB_TILE_THEMES];
    for (const family of families) {
      const capId = `${family}_solid`;
      const innerId = `${family}_solid_inner`;
      const wallId = `${family}_wall`;
      const cap = LIBRARY[capId];
      const inner = LIBRARY[innerId];
      const wall = LIBRARY[wallId];

      expect(inner, innerId).toBeDefined();
      expect(inner, `${innerId} must be a dedicated entry, not ${wallId}`).not.toBe(wall);
      expect(inner, `${innerId} must not reuse its surface cap`).not.toBe(cap);

      for (const [frameIx, frame] of inner!.frames.entries()) {
        const label = `${innerId}#${frameIx}`;
        expect(frame.w, label).toBe(16);
        expect(frame.h, label).toBe(16);
        expect(frame.rows, label).toHaveLength(16);
        for (const row of frame.rows) {
          expect(row, label).toHaveLength(16);
          expect(row, `${label} must use only opaque palette slots`).toMatch(/^[1-9a-f]{16}$/);
        }
      }
      expect(
        inner!.frames.map((frame) => frame.rows),
        `${innerId} must read differently from ${capId}`,
      ).not.toEqual(cap!.frames.map((frame) => frame.rows));
      expect(
        inner!.frames.map((frame) => frame.rows),
        `${innerId} must not copy dungeon-wall art from ${wallId}`,
      ).not.toEqual(wall!.frames.map((frame) => frame.rows));
    }
  });

  it('keeps surface-anchored tile art touching its collision or placement baseline', () => {
    expect(LIBRARY['wasteland_platform']!.frames[0]!.rows[0]).not.toContain('.');
    expect(LIBRARY['castle_deco']!.frames[0]!.rows[15]).toMatch(/[2-9a-f]/);
  });

  it('structural tiles are near-fully opaque in every family', () => {
    for (const id of [...LIB_TILES, ...LIB_THEMED_TILES]) {
      if (!/(_solid(?:_inner)?|_wall|_floor|_block)$/.test(id)) continue;
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
