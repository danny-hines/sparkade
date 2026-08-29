export type LibraryColorMode = 'game' | 'source' | 'harmonized';

/**
 * Decode luminance-ordered source indices through the game's structural ramp.
 * This keeps the gallery's game-palette comparison without storing a second
 * copy of every frame. Source palettes produced by the authoring pipeline are
 * sorted darkest-to-lightest after the transparent zero slot.
 */
export function semanticGamePaletteForSource(
  sourcePalette: readonly string[],
  gamePalette: readonly string[],
): string[] {
  if (sourcePalette.length !== 16 || gamePalette.length !== 16) return [...gamePalette];
  return sourcePalette.map((_, index) => {
    if (index === 0) return gamePalette[0]!;
    if (index <= 2) return gamePalette[1]!;
    if (index <= 6) return gamePalette[2]!;
    if (index <= 12) return gamePalette[3]!;
    return gamePalette[4]!;
  });
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgbToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return { h: (hue + 360) % 360, s: saturation, l: lightness };
}

function hueToRgb(p: number, q: number, t: number): number {
  let wrapped = t;
  if (wrapped < 0) wrapped += 1;
  if (wrapped > 1) wrapped -= 1;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  let r = l;
  let g = l;
  let b = l;
  if (s > 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function circularHue(colors: readonly Hsl[]): number | null {
  let x = 0;
  let y = 0;
  let total = 0;
  for (const color of colors) {
    const middleWeight = Math.max(0.2, 1 - Math.abs(color.l - 0.5) * 1.4);
    const weight = color.s * middleWeight;
    if (weight < 0.025) continue;
    const radians = (color.h * Math.PI) / 180;
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
    total += weight;
  }
  return total > 0 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : null;
}

function shortestHueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Apply a gentle whole-palette grade: relative source hues and value contrast
 * survive, while the game's environment ramp supplies a customization bias.
 */
export function harmonizeSourcePalette(
  sourcePalette: readonly string[],
  gamePalette: readonly string[],
  strength = 0.28,
): string[] {
  if (sourcePalette.length !== 16 || gamePalette.length !== 16) return [...sourcePalette];
  const source = sourcePalette.slice(1).map(rgbToHsl);
  const environment = [2, 3, 4].map((index) => rgbToHsl(gamePalette[index]!));
  const sourceHue = circularHue(source);
  const targetHue = circularHue(environment);
  if (sourceHue === null || targetHue === null) return [...sourcePalette];
  const amount = clamp01(strength);
  const hueShift = shortestHueDelta(sourceHue, targetHue) * amount;
  const targetSaturation =
    environment.reduce((sum, color) => sum + color.s, 0) / environment.length;

  return sourcePalette.map((hex, index) => {
    if (index === 0) return '#000000';
    const color = rgbToHsl(hex);
    const chromatic = color.s >= 0.06;
    const saturationFloor = chromatic
      ? color.s * (1 - amount * 0.14)
      : targetSaturation * amount * 0.12;
    return hslToHex({
      h: chromatic ? color.h + hueShift : targetHue,
      s: clamp01(Math.max(saturationFloor, color.s + (targetSaturation - color.s) * amount * 0.12)),
      // Source lightness is intentionally unchanged: this preserves the
      // authored contrast and prevents the subdued background ramp returning.
      l: color.l,
    });
  });
}
