import { describe, expect, it } from 'vitest';
import {
  PALETTE_MOODS,
  paletteProblems,
  nearestMood,
  contrastRatio,
  relLuminance,
} from '@sparkade/shared';

describe('palette legibility validator', () => {
  it('every curated mood passes paletteProblems (the quality-floor invariant)', () => {
    for (const m of PALETTE_MOODS) {
      const problems = paletteProblems(m.colors);
      expect(problems, `${m.name}: ${problems.map((p) => p.code).join(', ')}`).toEqual([]);
    }
  });

  it('every mood is 16 valid hex colors with a unique id', () => {
    const seen = new Set<string>();
    for (const m of PALETTE_MOODS) {
      expect(m.colors.length, m.id).toBe(16);
      for (const c of m.colors) expect(c, `${m.id} color`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(seen.has(m.id), `duplicate id ${m.id}`).toBe(false);
      seen.add(m.id);
    }
    expect(PALETTE_MOODS.length).toBeGreaterThanOrEqual(20);
  });

  it('rejects palettes that would be unplayable', () => {
    const base = PALETTE_MOODS[0]!.colors;
    const withSlot = (i: number, hex: string): string[] => base.map((c, j) => (j === i ? hex : c));

    // hero-primary (5) == bg-mid (3): hero vanishes into the background
    const heroOnBg = base.map((c, j) => (j === 5 ? base[3]! : j === 6 ? base[4]! : c));
    expect(paletteProblems(heroOnBg).map((p) => p.code)).toContain('PALETTE_HERO_ON_BG');

    // hero-primary (5) == bg-dark (2): the dominant backmost backdrop band swallows the hero
    expect(paletteProblems(withSlot(5, base[2]!)).map((p) => p.code)).toContain('PALETTE_HERO_ON_BG');

    // near-white (f) is actually dark: UI text disappears
    expect(paletteProblems(withSlot(15, '#404040')).map((p) => p.code)).toContain('PALETTE_WHITE_DARK');

    // light background: text loses contrast
    expect(paletteProblems(withSlot(2, '#d8d8e0')).map((p) => p.code)).toContain('PALETTE_BG_LIGHT');

    // hazard (b) == enemy (8): danger doesn't read
    expect(paletteProblems(withSlot(11, base[8]!)).map((p) => p.code)).toContain('PALETTE_HAZARD');

    // muddy monochrome mid-gray
    expect(paletteProblems(new Array(16).fill('#5a5a60')).length).toBeGreaterThan(0);

    // wrong shape
    expect(paletteProblems(['#000000']).map((p) => p.code)).toContain('PALETTE_SHAPE');
  });

  it('nearestMood returns a real mood and matches an exact mood to itself', () => {
    for (const m of PALETTE_MOODS) {
      expect(nearestMood(m.colors).id).toBe(m.id);
    }
  });

  it('color helpers are sane', () => {
    expect(relLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});
