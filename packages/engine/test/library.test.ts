import { describe, expect, it } from 'vitest';
import {
  FONT_GLYPHS,
  harmonizeSourcePalette,
  LIBRARY,
  PLATFORMER_HD_TILE_KINDS,
  anchorSpriteOpaqueTop,
  makeTallHeroEntry,
  makeTallHumanoidEntry,
  makeTallSpriteEntry,
  missingLibraryIds,
  platformerHdMovingPlatformRef,
  platformerHdTileRef,
  resolveLibraryEntryArt,
  resolveLikenessHead,
  semanticGamePaletteForSource,
  SpriteStore,
} from '@sparkade/engine';
import {
  LIB_HEROES_ADVENTURE,
  LIB_HEROES_PLATFORMER,
  LIB_PLATFORMER_ONLY_TILE_THEMES,
  LIB_PLATFORMER_TILE_KINDS,
  LIB_PLATFORMER_TILE_THEMES,
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
      if (entry.sourceFrames || entry.sourcePalette) {
        expect(entry.sourcePalette, `${id} source palette`).toHaveLength(16);
        expect(
          entry.sourcePalette!.every((color) => /^#[0-9a-f]{6}$/.test(color)),
          `${id} source palette colors`,
        ).toBe(true);
        const sourceFrames = entry.sourceFrames ?? entry.frames;
        expect(sourceFrames, `${id} source frames`).toHaveLength(entry.frames.length);
        for (const [fi, frame] of sourceFrames.entries()) {
          expect(frame.w, `${id} source#${fi}`).toBe(w);
          expect(frame.h, `${id} source#${fi}`).toBe(h);
          expect(frame.rows).toHaveLength(h);
          for (const row of frame.rows) {
            expect(row).toHaveLength(w);
            expect(row).toMatch(/^[0-9a-f.]+$/);
          }
        }
      }
    }
  });

  it('resolves compact source-color art without duplicating frames', () => {
    const source = { w: 1, h: 1, rows: ['a'] };
    const gamePalette = [
      '#000000',
      '#101010',
      '#123322',
      '#17613a',
      '#2a9a58',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
    ];
    const sourcePalette = [
      '#000000',
      '#291016',
      '#41151f',
      '#591b29',
      '#712033',
      '#89263d',
      '#a12b47',
      '#b93151',
      '#d1365b',
      '#d94a6a',
      '#e15e79',
      '#e97288',
      '#f18697',
      '#f49aaa',
      '#f7aebd',
      '#fac2d0',
    ];
    const entry = {
      frames: [source],
      sourcePalette,
      anims: { idle: [0] },
    };

    const harmonized = resolveLibraryEntryArt(entry, gamePalette);
    expect(harmonized.frames).toEqual([source]);
    expect(harmonized.palette).toHaveLength(16);
    expect(harmonized.palette).not.toEqual(sourcePalette);
    expect(harmonized.usesSourceColors).toBe(true);
    expect(harmonized.colorMode).toBe('harmonized');
    expect(resolveLibraryEntryArt(entry, gamePalette, 'source')).toEqual({
      frames: [source],
      palette: sourcePalette,
      usesSourceColors: true,
      colorMode: 'source',
    });
    expect(resolveLibraryEntryArt(entry, gamePalette, 'game')).toEqual({
      frames: [source],
      palette: semanticGamePaletteForSource(sourcePalette, gamePalette),
      usesSourceColors: false,
      colorMode: 'game',
    });
  });

  it('keeps compatibility with transitional dual-frame source art', () => {
    const semantic = { w: 1, h: 1, rows: ['2'] };
    const source = { w: 1, h: 1, rows: ['a'] };
    const gamePalette = Array(16).fill('#112233') as string[];
    const sourcePalette = Array(16).fill('#ee8844') as string[];
    const entry = {
      frames: [semantic],
      sourceFrames: [source],
      sourcePalette,
      anims: { idle: [0] },
    };

    const harmonized = resolveLibraryEntryArt(entry, gamePalette);
    expect(harmonized.frames).toEqual([source]);
    expect(harmonized.palette).toHaveLength(16);
    expect(harmonized.palette).not.toEqual(sourcePalette);
    expect(harmonized.usesSourceColors).toBe(true);
    expect(harmonized.colorMode).toBe('harmonized');
    expect(resolveLibraryEntryArt(entry, gamePalette, 'source')).toEqual({
      frames: [source],
      palette: sourcePalette,
      usesSourceColors: true,
      colorMode: 'source',
    });
    expect(resolveLibraryEntryArt(entry, gamePalette, 'game')).toEqual({
      frames: [semantic],
      palette: gamePalette,
      usesSourceColors: false,
      colorMode: 'game',
    });
    expect(
      resolveLibraryEntryArt({ ...entry, sourceFrames: [] }, gamePalette).usesSourceColors,
    ).toBe(false);
  });

  it('maps luminance-ordered source slots onto the four-color game ramp', () => {
    const sourcePalette = Array.from(
      { length: 16 },
      (_, index) => `#${index.toString(16).repeat(6)}`,
    );
    const gamePalette = Array.from(
      { length: 16 },
      (_, index) => `#${(15 - index).toString(16).repeat(6)}`,
    );

    expect(semanticGamePaletteForSource(sourcePalette, gamePalette)).toEqual([
      gamePalette[0],
      gamePalette[1],
      gamePalette[1],
      gamePalette[2],
      gamePalette[2],
      gamePalette[2],
      gamePalette[2],
      gamePalette[3],
      gamePalette[3],
      gamePalette[3],
      gamePalette[3],
      gamePalette[3],
      gamePalette[3],
      gamePalette[4],
      gamePalette[4],
      gamePalette[4],
    ]);
  });

  it('gently shifts source hues toward the game environment without flattening value', () => {
    const source = [
      '#000000',
      ...Array.from({ length: 15 }, (_, index) => (index < 8 ? '#d93652' : '#f2c45c')),
    ];
    const game = [
      '#000000',
      '#101010',
      '#123322',
      '#17613a',
      '#2a9a58',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#ffffff',
    ];
    const harmonized = harmonizeSourcePalette(source, game);

    expect(harmonized).toHaveLength(16);
    expect(harmonized[0]).toBe('#000000');
    expect(harmonized).not.toEqual(source);
    const original = source[1]!;
    const shifted = harmonized[1]!;
    expect(parseInt(shifted.slice(3, 5), 16)).toBeGreaterThan(parseInt(original.slice(3, 5), 16));
    const lightness = (hex: string): number => {
      const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      return (Math.max(...channels) + Math.min(...channels)) / 2;
    };
    expect(Math.abs(lightness(shifted) - lightness(original))).toBeLessThan(2);
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

  it('upgrades every reviewed platformer tile family to density-four art', () => {
    for (const theme of LIB_PLATFORMER_TILE_THEMES) {
      for (const kind of PLATFORMER_HD_TILE_KINDS.filter((value) => value !== 'moving_platform')) {
        expect(platformerHdTileRef(`lib:${theme}_${kind}`), `${theme}_${kind}`).toBe(
          `lib:${theme}_${kind}_hd`,
        );
      }
      expect(platformerHdMovingPlatformRef(`lib:${theme}_solid`), theme).toBe(
        `lib:${theme}_moving_platform_hd`,
      );

      expect(LIBRARY[`${theme}_solid_hd`]!.frames).toHaveLength(4);
      expect(LIBRARY[`${theme}_solid_inner_hd`]!.frames).toHaveLength(16);
      expect(LIBRARY[`${theme}_solid_hd`]!.frames[0]).toMatchObject({ w: 64, h: 64 });
      expect(LIBRARY[`${theme}_exit_hd`]!.frames[0]).toMatchObject({ w: 64, h: 128 });
      expect(LIBRARY[`${theme}_moving_platform_hd`]!.frames[0]).toMatchObject({ w: 96, h: 32 });

      const platform = LIBRARY[`${theme}_platform_hd`]!.frames[0]!;
      const opaqueRows = platform.rows.filter((row) => /[1-9a-f]/.test(row));
      expect(opaqueRows, `${theme}_platform_hd`).toHaveLength(20);
    }

    expect(platformerHdTileRef('lib:tile_solid')).toBe('lib:tile_solid');
    expect(platformerHdTileRef('custom:hand_drawn')).toBe('custom:hand_drawn');
    expect(platformerHdMovingPlatformRef('lib:tile_solid')).toBeNull();
  });

  it('provides validation-sized base refs for platformer-only HD families', () => {
    for (const theme of LIB_PLATFORMER_ONLY_TILE_THEMES) {
      for (const kind of LIB_PLATFORMER_TILE_KINDS) {
        const entry = LIBRARY[`${theme}_${kind}`];
        expect(entry, `${theme}_${kind}`).toBeDefined();
        expect(entry!.frames[0], `${theme}_${kind}`).toMatchObject({ w: 16, h: 16 });
      }
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
