// Palette legibility + the curated palette-mood library.
//
// A Sparkade palette is 16 hex colors whose SLOT positions carry meaning (see
// PALETTE_SLOTS in constants): the whole game — sprites, tiles, backdrops, the
// baked player likeness, and near-white UI text — is recolored through them.
// A palette that clears the JSON schema (16 valid hex strings) can still be
// unplayable: a hero that vanishes into the background, story text that can't be
// read, a hazard indistinguishable from an ordinary enemy. `paletteProblems`
// encodes the measurable relationships a shippable palette must satisfy; the
// curated PALETTE_MOODS all pass it (a unit test enforces that) and serve as the
// model's cookbook and the pipeline's fallback when a generated palette fails.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** WCAG relative luminance in 0..1. */
export function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio 1..21 between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * "Redmean" perceptual color distance (0..~765) — the same metric the likeness
 * baker uses. Plain RGB distance collapses hues that read as clearly different
 * to the eye; redmean weights the channels by where they sit on the red axis.
 */
export function redmean(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const rm = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export interface PaletteProblem {
  code: string;
  message: string;
}

// Thresholds calibrated so the three shipped golden palettes pass with margin
// while obviously-broken palettes (hero==background, muddy monochrome, a light
// background that erases near-white text) fail. Distances are redmean (0..765);
// ratios are WCAG (1..21); luminances are relative (0..1).
const T = {
  outlineMaxLum: 0.14, // slot 1 must read as a dark outline
  whiteMinLum: 0.62, // slot f (near-white) — text + highlights
  lightMinLum: 0.34, // slot e (light)
  bgDarkMaxLum: 0.16, // slot 2 must be dark so backdrops recede + text pops
  heroVsBg: 96, // hero-primary (5) vs bg mid/light (3,4)
  heroVsBgLum: 0.1, // …and a value gap, so the hero pops even at low saturation
  enemyVsHero: 90, // enemy-primary (8) vs hero-primary (5): friend/foe
  hazardVsEnemy: 70, // hazard (b) vs enemy-primary (8): danger reads
  goldVsBg: 80, // gold (d) vs bg-light (4): pickups pop
  textContrast: 4.2, // near-white (f) over bg-dark (2): story/HUD legibility
  spanMinLum: 0.55, // lightest minus darkest: palette isn't a muddy mid-tone smear
};

/**
 * Structural legibility problems with a 16-color palette. Empty ⇒ shippable.
 * Order-of-magnitude, perceptual checks — deliberately lenient enough that any
 * genuinely coherent palette passes, strict enough to catch the failures that
 * make a game unplayable.
 */
export function paletteProblems(palette: readonly string[]): PaletteProblem[] {
  const out: PaletteProblem[] = [];
  if (palette.length !== 16 || palette.some((c) => !/^#[0-9a-fA-F]{6}$/.test(c))) {
    return [{ code: 'PALETTE_SHAPE', message: 'palette must be exactly 16 #rrggbb colors' }];
  }
  const lum = palette.map(relLuminance);
  const add = (code: string, message: string): void => void out.push({ code, message });

  if (lum[1]! > T.outlineMaxLum)
    add('PALETTE_OUTLINE_LIGHT', `slot 1 (outline) is too light (luminance ${lum[1]!.toFixed(2)}); outlines must read dark`);
  if (lum[15]! < T.whiteMinLum)
    add('PALETTE_WHITE_DARK', `slot f (near-white) is too dark (luminance ${lum[15]!.toFixed(2)}); it carries UI text and highlights`);
  if (lum[14]! < T.lightMinLum)
    add('PALETTE_LIGHT_DARK', `slot e (light) is too dark (luminance ${lum[14]!.toFixed(2)})`);
  if (lum[2]! > T.bgDarkMaxLum)
    add('PALETTE_BG_LIGHT', `slot 2 (bg-dark) is too light (luminance ${lum[2]!.toFixed(2)}); backgrounds must recede behind gameplay and text`);

  // Background value ramp 2 -> 3 -> 4 should ascend (small tolerance).
  if (lum[3]! < lum[2]! - 0.02 || lum[4]! < lum[3]! - 0.02)
    add('PALETTE_BG_RAMP', 'background slots 2,3,4 should ascend dark->light in value');

  // The hero must not blend into ANY background band. bg-dark (2) is the
  // dominant, backmost parallax band (makeBackdrop paints the whole far layer
  // from slot 2), so it counts as much as 3/4. A band the hero matches in BOTH
  // hue and value swallows the sprite.
  const heroBlends = [2, 3, 4].some(
    (i) => redmean(palette[5]!, palette[i]!) < T.heroVsBg && Math.abs(lum[5]! - lum[i]!) < T.heroVsBgLum,
  );
  if (heroBlends)
    add('PALETTE_HERO_ON_BG', 'hero-primary (5) blends into a background band (2,3,4): too close in both hue and value');

  if (redmean(palette[8]!, palette[5]!) < T.enemyVsHero)
    add('PALETTE_ENEMY_HERO', 'enemy-primary (8) is too close to hero-primary (5); friend and foe must be tellable apart');

  if (redmean(palette[11]!, palette[8]!) < T.hazardVsEnemy)
    add('PALETTE_HAZARD', 'hazard (b) is too close to enemy-primary (8); danger must read distinctly');

  if (redmean(palette[13]!, palette[4]!) < T.goldVsBg)
    add('PALETTE_GOLD', 'gold (d) is too close to bg-light (4); pickups/treasure must pop');

  if (contrastRatio(palette[15]!, palette[2]!) < T.textContrast)
    add('PALETTE_TEXT_CONTRAST', `near-white text (f) on bg-dark (2) is only ${contrastRatio(palette[15]!, palette[2]!).toFixed(1)}:1; needs ${T.textContrast}:1 to read`);

  const span = Math.max(...lum) - Math.min(...lum);
  if (span < T.spanMinLum)
    add('PALETTE_FLAT', `palette spans only ${span.toFixed(2)} in luminance; too flat/muddy to separate layers`);

  return out;
}

export interface PaletteMood {
  /** kebab-case id, e.g. 'ember-forge'. */
  id: string;
  /** Human label for the gallery, e.g. 'Ember Forge'. */
  name: string;
  /** One-line mood descriptor for the design cookbook. */
  hint: string;
  /** Exactly 16 hex colors following PALETTE_SLOTS. */
  colors: string[];
}

// The curated mood DATA and the fallback picker (nearestMood) live in
// ./palette-moods so this module stays a pure, dependency-free legibility
// validator that a standalone check script can import without pulling in the
// (agent-authored) mood family files.
