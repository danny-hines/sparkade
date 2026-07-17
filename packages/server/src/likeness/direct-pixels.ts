// Experimental photo -> Muse-authored native game sprite. Muse draws one
// semantically indexed 28px master; local code derives the comparison sizes.
// Keeping palette roles stable makes topology (hair, cap bill, glasses,
// moustache) mechanically auditable instead of trusting a prose self-review.
import sharp from 'sharp';
import type { Provider, ProviderUsage } from '@sparkade/shared';
import { parseModelJson } from '../pipeline/prompts';
import {
  normalizeFaceFeatures,
  type FaceFeatures,
  type NormalizedFaceFeatures,
} from './features';

export const DIRECT_PIXEL_SIZES = [16, 20, 24, 28] as const;
export const DIRECT_PIXEL_MASTER_SIZE = 28;
export type DirectPixelSize = (typeof DIRECT_PIXEL_SIZES)[number];

export interface DirectPixelAnchors {
  crownTop: number;
  faceLeft: number;
  faceRight: number;
  leftEyeX: number;
  rightEyeX: number;
  eyeY: number;
  noseTipX: number;
  noseTipY: number;
  upperLipY: number;
  mouthY: number;
  chinY: number;
}

export interface DirectPixelDraft {
  anchors: DirectPixelAnchors;
  rows: string[];
}

export interface DirectPixelValidation {
  repaired: boolean;
  errors: string[];
  opaqueBox: { x: number; y: number; width: number; height: number };
  coverage: number;
}

export interface DirectPixelDocument {
  identityCues: string[];
  /** Slot 0 is deliberately unused; 1-f have fixed semantic roles. */
  palette: string[];
  master: DirectPixelDraft;
  sprites: Record<string, string[]>;
  validation: DirectPixelValidation;
}

export interface DirectPixelLikeness {
  document: DirectPixelDocument;
  pngs: Record<string, Buffer>;
  usage: ProviderUsage;
}

export const DIRECT_PIXEL_PROMPT_VERSION = 'direct-pixels-v6';
const SYMBOLS = '123456789abcdef';
const ANCHOR_NAMES: (keyof DirectPixelAnchors)[] = [
  'crownTop',
  'faceLeft',
  'faceRight',
  'leftEyeX',
  'rightEyeX',
  'eyeY',
  'noseTipX',
  'noseTipY',
  'upperLipY',
  'mouthY',
  'chinY',
];

const ROLE_LABELS: Record<string, string> = {
  '1': 'outer outline',
  '2': 'deep skin shadow',
  '3': 'skin shadow',
  '4': 'skin base',
  '5': 'skin highlight',
  '6': 'visible scalp-hair shadow',
  '7': 'visible scalp-hair base',
  '8': 'facial hair only',
  '9': 'headwear shadow / underside of bill',
  a: 'headwear base / crown panels',
  b: 'glasses frame only',
  c: 'pupil, iris, eyebrow, nose detail',
  d: 'mouth / lip',
  e: 'eye white / tiny teeth highlight',
  f: 'small material or facial-hair highlight',
};

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function color(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`;
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = color(hex);
  return toHex([r * factor, g * factor, b * factor]);
}

function blend(a: string, b: string, amount: number): string {
  const ac = color(a);
  const bc = color(b);
  return toHex([
    ac[0] * (1 - amount) + bc[0] * amount,
    ac[1] * (1 - amount) + bc[1] * amount,
    ac[2] * (1 - amount) + bc[2] * amount,
  ]);
}

/** Stable semantic roles; Muse chooses pixels, never the meaning of an index. */
export function buildDirectPixelPalette(features: FaceFeatures): string[] {
  const feat = normalizeFaceFeatures(features);
  const skin = normalizeHex(feat.skinTone, '#c98f6b');
  const facialHair = normalizeHex(feat.facialHairColor, shade(skin, 0.38));
  const scalpHair = normalizeHex(feat.hairColor, facialHair);
  const headwear = normalizeHex(feat.headwearColor, scalpHair);
  const glasses = normalizeHex(feat.glassesColor, '#24242e');
  return [
    '#000000',
    blend(shade(skin, 0.22), '#17131f', 0.62),
    shade(skin, 0.56),
    shade(skin, 0.78),
    skin,
    blend(skin, '#ffffff', 0.2),
    shade(scalpHair, 0.58),
    scalpHair,
    facialHair,
    shade(headwear, 0.54),
    headwear,
    glasses,
    blend(shade(skin, 0.22), '#231c22', 0.72),
    blend(skin, '#9c3450', 0.52),
    '#f2f2f4',
    blend(headwear, '#ffffff', 0.24),
  ];
}

function authoritativeFacts(feat: NormalizedFaceFeatures): Record<string, unknown> {
  return {
    visibleScalpHair: {
      style: feat.hairStyle,
      length: feat.hairLength,
      texture: feat.hairTexture,
      part: feat.hairPart,
      regions: feat.topology.scalpHair,
    },
    headwear: {
      present: feat.headwear,
      type: feat.headwearType,
      ...feat.topology.headwear,
    },
    glasses: {
      present: feat.glasses,
      ...feat.topology.glasses,
    },
    facialHair: {
      kind: feat.facialHair,
      ...feat.topology.facialHair,
    },
    geometry: {
      faceShape: feat.faceShape,
      chin: feat.chin,
      noseSize: feat.noseSize,
      eyeSpacing: feat.eyeSpacing,
      eyeShape: feat.eyeShape,
      eyebrows: feat.eyebrows,
      eyebrowShape: feat.eyebrowShape,
      ears: feat.ears,
    },
  };
}

function identityCues(feat: NormalizedFaceFeatures): string[] {
  const cues: string[] = [];
  if (feat.headwear) {
    cues.push(`${feat.headwearType}: ${feat.topology.headwear.crown} crown + ${feat.topology.headwear.projection}`);
  } else {
    cues.push(
      feat.hairStyle === 'bald'
        ? 'exposed bald scalp with no crown hair'
        : `${feat.hairLength} ${feat.hairTexture} visible hair`,
    );
  }
  if (feat.glasses) {
    cues.push(`${feat.topology.glasses.frame} ${feat.topology.glasses.lensShape} glasses with two visible lenses`);
  }
  if (feat.facialHair !== 'none') {
    const regions = Object.entries(feat.topology.facialHair)
      .filter(([, value]) => value !== 'none')
      .map(([name, value]) => `${name} ${value}`)
      .join(', ');
    cues.push(`${feat.facialHair}: ${regions}`);
  }
  cues.push(`${feat.faceShape} face with ${feat.chin} chin`);
  cues.push(`${feat.eyeSpacing} ${feat.eyeShape} eyes; ${feat.noseSize} nose`);
  return cues.slice(0, 6);
}

function anchorsSchema(size: number): Record<string, unknown> {
  const coordinate = { type: 'integer', minimum: 0, maximum: size - 1 };
  return {
    type: 'object',
    additionalProperties: false,
    required: ANCHOR_NAMES,
    properties: Object.fromEntries(ANCHOR_NAMES.map((name) => [name, coordinate])),
  };
}

export function buildDirectPixelPrompt(
  features: FaceFeatures,
  palette = buildDirectPixelPalette(features),
  size = DIRECT_PIXEL_MASTER_SIZE,
): { system: string; user: string; jsonSchema: Record<string, unknown>; maxTokens: number } {
  const feat = normalizeFaceFeatures(features);
  const facts = authoritativeFacts(feat);
  const paletteLegend = SYMBOLS.split('')
    .map((symbol) => `${symbol} = ${palette[parseInt(symbol, 16)]} = ${ROLE_LABELS[symbol]}`)
    .join('\n');
  const roleRules = [
    !feat.topology.scalpHair.crown && !feat.topology.scalpHair.temples && !feat.topology.scalpHair.belowEars
      ? 'Symbols 6 and 7 are FORBIDDEN: no scalp hair is visible.'
      : 'Symbols 6/7 must reproduce only the visible hair regions and silhouette in the facts.',
    feat.headwear
      ? 'Symbols 9/a are REQUIRED for the observed headwear.'
      : 'Symbols 9 and a are FORBIDDEN: there is no headwear.',
    feat.glasses
      ? 'Symbol b is REQUIRED as thin frames around TWO separate visible eyes. Clear lenses are transparent/skin, never filled white rectangles.'
      : 'Symbol b is FORBIDDEN: there are no glasses.',
    feat.facialHair !== 'none'
      ? 'Symbol 8 is REQUIRED only in the reported upperLip/chin/jaw/cheeks regions.'
      : 'Symbol 8 is FORBIDDEN: there is no visible facial hair.',
  ];

  const system = [
    `You are Sparkade's SNES-era portrait sprite artist. Draw ONE final ${size}x${size} native-resolution indexed head sprite from the attached photo.`,
    'This is authored game art, not a downsampled photograph, emoji, UI icon, helmet, mask, or character-creator template.',
    'The normalized facts below are authoritative. Do not reclassify them or infer hidden hair.',
    '',
    'AUTHORITATIVE PORTRAIT FACTS:',
    JSON.stringify(facts, null, 2),
    '',
    'FIXED SEMANTIC PALETTE (the server chose the colors; you choose only their positions):',
    paletteLegend,
    '. = transparent. Never use 0.',
    ...roleRules,
    '',
    `COMPOSITION FOR EXACTLY ${size} PIXELS:`,
    '- head only, facing approximately toward camera; no neck, shoulders, torso, background, text, labels, or second character;',
    '- a single connected silhouette with a one-pixel dark outline and deliberately clustered pixels; every symbol-1 outline pixel touches colored head/hair/hat pixels within one cell. No detached rails, tendrils, second contour, antialiasing, gradients, dithering, noise, or confetti;',
    '- top of crown/headwear at y=1..3; eye centers at y=9..12; nose tip y=14..17; upper-lip hair y=17..19; mouth y=19..21; chin y=25..27;',
    '- the last opaque chin pixel is y=26 or y=27 so the head sits on the body; opaque height is 22..27 pixels; transparent corners remain;',
    '- this tiny in-game portrait is front-facing for readability: the two eyes share a row and similar scale, the nose stays between them, and the mouth is horizontal below it. Never turn a frontal source into a profile;',
    '- the facial plane at eye level is normally 15-22px wide. Hair may make the outer silhouette wider, but must not squeeze the face into a narrow central strip;',
    '- preserve asymmetry in the silhouette, hair clusters, bill, ears, and highlights—not by joining the facial features into a diagonal or vertical stripe;',
    '- make two separate eyes with pupils. Each eye gets only 1-3 total e pixels and at most 4 nearby c pixels. Put a short brow one row above rather than merging brow and eye into a dark rectangle;',
    '- build the nose from a broken 2-4px cluster of skin shadow plus at most 1-2 c detail pixels. Never connect it to glasses, eyes, facial hair, or mouth;',
    '- use d only for one short horizontal mouth cluster in one or two adjacent rows. A smile may have a short e teeth highlight immediately at the mouth, never down the chin;',
    '- symbol 1 belongs on the exterior silhouette, not as an internal nose or mask line. Internal features are small shapes, never full-width horizontal bands;',
    '',
    'TOPOLOGY GRAMMAR:',
    '- baseball cap = panelled crown PLUS a visibly projecting front bill/underside below it; the lower bill row is wider than the upper crown. A cap must not read as a beanie;',
    '- cap/beanie pixels stay above the eyes. A hat may overlap one temple row, but must never continue down the sides, surround the face, or form a helmet;',
    '- beanie = knit dome/cuff with no projecting bill; long/curly hair may remain visible only where the facts say it is visible;',
    '- curly/coily hair uses an irregular clustered outer edge. If it extends to the jaw/below ears, it frames both sides of the face; it is never a smooth helmet or cap;',
    '- clear glasses = two hollow frame loops around two eyes, joined by a bridge no wider than 2 pixels. Do not fill either lens with b or e;',
    '- upper-lip facial hair must appear above and separately from the mouth; chin/jaw/cheek hair belongs below/beside the mouth according to the facts;',
    '- a bald or fully hidden crown contains skin/headwear pixels, never invented 6/7 hair pixels.',
    '',
    'Return anchors that match the actual pixels, then the final rows. Rows are top-to-bottom; characters are left-to-right.',
    `Return exactly ${size} rows of exactly ${size} characters. Output only the structured fields.`,
  ].join('\n');

  return {
    system,
    user: `Author the final ${size}px Sparkade head from the attached source. Spend pixels on silhouette, cap/hair, glasses, and facial-hair topology before subtle face detail.`,
    // Muse can spend several thousand hidden reasoning tokens before emitting
    // this small grid. Keep proven headroom so content is not returned empty;
    // latency is bounded by one call rather than an automatic second call.
    maxTokens: 6500,
    jsonSchema: {
      title: `Sparkade ${size}px direct sprite`,
      type: 'object',
      additionalProperties: false,
      required: ['anchors', 'rows'],
      properties: {
        anchors: anchorsSchema(size),
        rows: {
          type: 'array',
          minItems: size,
          maxItems: size,
          items: { type: 'string', pattern: `^[.1-9a-fA-F]{${size}}$` },
        },
      },
    },
  };
}

function integerField(raw: Record<string, unknown>, name: keyof DirectPixelAnchors, size: number): number {
  const value = raw[name];
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= size) {
    throw new Error(`anchors.${name} must be an integer from 0 to ${size - 1}`);
  }
  return value as number;
}

function parseDirectPixelDraftObject(value: unknown, size: number): DirectPixelDraft {
  const parsed = value;
  if (!parsed || typeof parsed !== 'object') throw new Error('direct sprite response is not an object');
  const raw = parsed as Record<string, unknown>;
  if (!raw['anchors'] || typeof raw['anchors'] !== 'object') throw new Error('anchors object is missing');
  const rawAnchors = raw['anchors'] as Record<string, unknown>;
  const anchors: DirectPixelAnchors = {
    crownTop: integerField(rawAnchors, 'crownTop', size),
    faceLeft: integerField(rawAnchors, 'faceLeft', size),
    faceRight: integerField(rawAnchors, 'faceRight', size),
    leftEyeX: integerField(rawAnchors, 'leftEyeX', size),
    rightEyeX: integerField(rawAnchors, 'rightEyeX', size),
    eyeY: integerField(rawAnchors, 'eyeY', size),
    noseTipX: integerField(rawAnchors, 'noseTipX', size),
    noseTipY: integerField(rawAnchors, 'noseTipY', size),
    upperLipY: integerField(rawAnchors, 'upperLipY', size),
    mouthY: integerField(rawAnchors, 'mouthY', size),
    chinY: integerField(rawAnchors, 'chinY', size),
  };

  const rawRows = raw['rows'];
  if (!Array.isArray(rawRows) || rawRows.length !== size) {
    throw new Error(`${size}px sprite must contain exactly ${size} rows`);
  }
  const rows = rawRows.map((row, y) => {
    if (typeof row !== 'string') throw new Error(`${size}px row ${y} is not a string`);
    const text = row.trim().toLowerCase();
    if (text.length !== size) throw new Error(`${size}px row ${y} has length ${text.length}`);
    if (![...text].every((symbol) => symbol === '.' || SYMBOLS.includes(symbol))) {
      throw new Error(`${size}px row ${y} contains an invalid palette symbol`);
    }
    return text;
  });
  return { anchors, rows };
}

/**
 * Meta's preview structured-output mode occasionally omits a comma while all
 * requested fields and fixed-width rows remain intact. Recover only this very
 * narrow, mechanically verifiable shape; never guess or pad pixel data.
 */
function salvageDirectPixelDraft(text: string, size: number): DirectPixelDraft {
  const anchorValues: Record<string, number> = {};
  for (const name of ANCHOR_NAMES) {
    const match = new RegExp(`["']?${name}["']?\\s*:\\s*(\\d+)`, 'i').exec(text);
    if (!match) throw new Error(`could not recover anchors.${name}`);
    anchorValues[name] = Number(match[1]);
  }

  const rowsMarker = /["']?rows["']?\s*:/i.exec(text);
  if (!rowsMarker) throw new Error('could not recover rows field');
  const tail = text.slice(rowsMarker.index + rowsMarker[0].length);
  const quotedRow = new RegExp(`["']([.1-9a-fA-F]{${size}})["']`, 'g');
  const rows: string[] = [];
  for (const match of tail.matchAll(quotedRow)) rows.push(match[1]!);
  if (rows.length < size) {
    rows.length = 0;
    const bareRow = new RegExp(`(?:^|[^.1-9a-fA-F])([.1-9a-fA-F]{${size}})(?=$|[^.1-9a-fA-F])`, 'gm');
    for (const match of tail.matchAll(bareRow)) rows.push(match[1]!);
  }
  if (rows.length !== size) throw new Error(`recovered ${rows.length} of ${size} exact rows`);
  return parseDirectPixelDraftObject({ anchors: anchorValues, rows }, size);
}

export function parseDirectPixelDraft(
  value: unknown,
  size = DIRECT_PIXEL_MASTER_SIZE,
): DirectPixelDraft {
  if (typeof value !== 'string') return parseDirectPixelDraftObject(value, size);
  try {
    return parseDirectPixelDraftObject(parseModelJson(value), size);
  } catch (error) {
    // If JSON parsed but failed our strict shape checks, preserve that error;
    // salvage is only for syntactically broken provider JSON.
    try {
      JSON.parse(value.trim());
    } catch {
      try {
        return salvageDirectPixelDraft(value, size);
      } catch (salvageError) {
        const initial = error instanceof Error ? error.message : String(error);
        const recovery = salvageError instanceof Error ? salvageError.message : String(salvageError);
        throw new Error(`direct sprite JSON was malformed (${initial}); recovery failed: ${recovery}`);
      }
    }
    throw error;
  }
}

function opaqueBox(rows: string[]): DirectPixelValidation['opaqueBox'] {
  const size = rows.length;
  let left = size;
  let right = -1;
  let top = size;
  let bottom = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rows[y]![x] === '.') continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function maxHorizontalRun(rows: string[], symbol: string, yStart = 0, yEnd = rows.length - 1): number {
  let maximum = 0;
  for (let y = Math.max(0, yStart); y <= Math.min(rows.length - 1, yEnd); y++) {
    let run = 0;
    for (const value of rows[y]!) {
      run = value === symbol ? run + 1 : 0;
      maximum = Math.max(maximum, run);
    }
  }
  return maximum;
}

function maxVerticalRun(
  rows: string[],
  symbols: string,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): number {
  let maximum = 0;
  for (let x = Math.max(0, xStart); x <= Math.min(rows.length - 1, xEnd); x++) {
    let run = 0;
    for (let y = Math.max(0, yStart); y <= Math.min(rows.length - 1, yEnd); y++) {
      run = symbols.includes(rows[y]![x]!) ? run + 1 : 0;
      maximum = Math.max(maximum, run);
    }
  }
  return maximum;
}

function symbolBox(rows: string[], symbol: string): DirectPixelValidation['opaqueBox'] {
  return opaqueBox(rows.map((row) => [...row].map((value) => value === symbol ? value : '.').join('')));
}

function hasSymbolNear(rows: string[], symbols: string, x: number, y: number, radius: number): boolean {
  for (let py = Math.max(0, y - radius); py <= Math.min(rows.length - 1, y + radius); py++) {
    for (let px = Math.max(0, x - radius); px <= Math.min(rows.length - 1, x + radius); px++) {
      if (symbols.includes(rows[py]![px]!)) return true;
    }
  }
  return false;
}

function countSymbol(rows: string[], symbol: string, predicate?: (x: number, y: number) => boolean): number {
  let count = 0;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows.length; x++) {
      if (rows[y]![x] === symbol && (!predicate || predicate(x, y))) count++;
    }
  }
  return count;
}

function dominantComponentRatio(rows: string[]): number {
  const size = rows.length;
  const seen = new Set<number>();
  let opaque = 0;
  let largest = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rows[y]![x] === '.') continue;
      opaque++;
      const key = y * size + x;
      if (seen.has(key)) continue;
      const queue = [key];
      seen.add(key);
      let component = 0;
      while (queue.length) {
        const current = queue.pop()!;
        component++;
        const cx = current % size;
        const cy = Math.floor(current / size);
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || rows[ny]![nx] === '.') continue;
          const neighbor = ny * size + nx;
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      largest = Math.max(largest, component);
    }
  }
  return opaque === 0 ? 0 : largest / opaque;
}

function spanAt(rows: string[], y: number, symbols: string): { left: number; right: number; width: number } {
  let left = rows.length;
  let right = -1;
  for (let x = 0; x < rows.length; x++) {
    if (!symbols.includes(rows[y]?.[x] ?? '.')) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  return right < left ? { left: 0, right: -1, width: 0 } : { left, right, width: right - left + 1 };
}

/** Pixel-grounded checks used both for repair feedback and lab diagnostics. */
export function auditDirectPixelDraft(
  draft: DirectPixelDraft,
  features: FaceFeatures,
): Omit<DirectPixelValidation, 'repaired'> {
  const feat = normalizeFaceFeatures(features);
  const { anchors, rows } = draft;
  const size = rows.length;
  const errors: string[] = [];
  const box = opaqueBox(rows);
  const opaque = rows.join('').replace(/\./g, '').length;
  const coverage = opaque / (size * size);

  if (!(anchors.faceLeft < anchors.leftEyeX && anchors.leftEyeX < anchors.rightEyeX && anchors.rightEyeX < anchors.faceRight)) {
    errors.push('eye anchors must be ordered inside faceLeft/faceRight');
  }
  const anchoredFaceWidth = anchors.faceRight - anchors.faceLeft + 1;
  if (anchoredFaceWidth < Math.ceil(size * 0.54)) {
    errors.push(`facial plane is only ${anchoredFaceWidth}px wide; a frontal ${size}px face must be at least ${Math.ceil(size * 0.54)}px`);
  }
  if (!(anchors.crownTop < anchors.eyeY && anchors.eyeY < anchors.noseTipY && anchors.noseTipY <= anchors.upperLipY && anchors.upperLipY <= anchors.mouthY && anchors.mouthY < anchors.chinY)) {
    errors.push('vertical anchors must order crown < eyes < nose <= upper lip <= mouth < chin');
  }
  if (box.height < Math.ceil(size * 0.75)) errors.push(`opaque silhouette is only ${box.height}px tall; it must be at least ${Math.ceil(size * 0.75)}px`);
  if (box.height > 0 && box.width > 0 && box.height / box.width < 0.78) errors.push(`silhouette is a horizontal sandwich (height/width ${(box.height / box.width).toFixed(2)})`);
  if (box.y > 3) errors.push(`crown begins at y=${box.y}; it must begin by y=3`);
  if (box.y + box.height - 1 < size - 2) errors.push(`chin ends at y=${box.y + box.height - 1}; it must reach y=${size - 2} or ${size - 1}`);
  if (coverage < 0.22 || coverage > 0.78) errors.push(`coverage ${(coverage * 100).toFixed(0)}% is outside 22-78%`);
  const componentRatio = dominantComponentRatio(rows);
  if (componentRatio < 0.88) errors.push(`largest connected silhouette contains only ${(componentRatio * 100).toFixed(0)}% of opaque pixels`);
  const strayOutline = countSymbol(rows, '1', (x, y) => {
    for (let py = Math.max(0, y - 1); py <= Math.min(size - 1, y + 1); py++) {
      for (let px = Math.max(0, x - 1); px <= Math.min(size - 1, x + 1); px++) {
        const neighbor = rows[py]![px]!;
        if (neighbor !== '.' && neighbor !== '1') return false;
      }
    }
    return true;
  });
  if (strayOutline > Math.ceil(size * 0.25)) {
    errors.push(`${strayOutline} outline pixels form detached rails/tendrils instead of touching the colored silhouette`);
  }
  if (!hasSymbolNear(rows, 'ce', anchors.leftEyeX, anchors.eyeY, 1)) errors.push('left eye anchor has no pupil/eye-white pixels nearby');
  if (!hasSymbolNear(rows, 'ce', anchors.rightEyeX, anchors.eyeY, 1)) errors.push('right eye anchor has no pupil/eye-white pixels nearby');
  if (!hasSymbolNear(rows, '123c', anchors.noseTipX, anchors.noseTipY, 1)) errors.push('nose-tip anchor has no shaded/detail pixel nearby');
  if (!hasSymbolNear(rows, 'd', Math.round((anchors.faceLeft + anchors.faceRight) / 2), anchors.mouthY, 2)) errors.push('mouth anchor has no mouth pixels nearby');
  for (const [label, eyeX] of [['left', anchors.leftEyeX], ['right', anchors.rightEyeX]] as const) {
    const whiteCount = countSymbol(rows, 'e', (x, y) => Math.abs(x - eyeX) <= 2 && Math.abs(y - anchors.eyeY) <= 2);
    if (whiteCount > 3) errors.push(`${label} eye contains ${whiteCount} white pixels; tiny game eyes may use at most 3`);
    const darkCount = countSymbol(rows, 'c', (x, y) => Math.abs(x - eyeX) <= 2 && Math.abs(y - anchors.eyeY) <= 1);
    if (darkCount > 5) errors.push(`${label} eye/brow merges into a ${darkCount}px dark block; keep the pupil and brow separate`);
  }
  const noseDetailCount = countSymbol(rows, 'c', (x, y) =>
    x > anchors.leftEyeX && x < anchors.rightEyeX && y > anchors.eyeY + 1 && y <= anchors.upperLipY,
  );
  if (noseDetailCount > 4) errors.push(`nose uses ${noseDetailCount} dark detail pixels; use broken skin shading and at most 4`);
  if (maxVerticalRun(rows, '1c', anchors.leftEyeX + 1, anchors.rightEyeX - 1, anchors.eyeY + 1, anchors.upperLipY) > 2) {
    errors.push('nose/central detail forms a continuous vertical rail from the eye band toward the mouth');
  }
  const mouthBox = symbolBox(rows, 'd');
  if (mouthBox.height > 2 || (mouthBox.height > 0 && mouthBox.width < mouthBox.height)) {
    errors.push(`mouth pixels form a ${mouthBox.width}x${mouthBox.height} vertical/stacked shape instead of a short horizontal mouth`);
  }
  const strayMouth = countSymbol(rows, 'd', (_x, y) => y < anchors.upperLipY - 1 || y > anchors.mouthY + 1);
  if (strayMouth > 0) errors.push(`${strayMouth} mouth pixels appear outside the upper-lip/mouth rows`);
  const strayWhite = countSymbol(rows, 'e', (_x, y) =>
    Math.abs(y - anchors.eyeY) > 2 && Math.abs(y - anchors.mouthY) > 1,
  );
  if (strayWhite > 0) errors.push(`${strayWhite} eye-white/highlight pixels appear away from the eyes or immediate smile`);

  const visibleHair = feat.topology.scalpHair.crown || feat.topology.scalpHair.temples || feat.topology.scalpHair.belowEars;
  const scalpCount = countSymbol(rows, '6') + countSymbol(rows, '7');
  if (!visibleHair && scalpCount > 0) errors.push(`invented ${scalpCount} visible scalp-hair pixels despite hidden/bald topology`);
  if (visibleHair && scalpCount < 3) errors.push('visible hair topology is missing from the pixels');

  const headwearCount = countSymbol(rows, '9') + countSymbol(rows, 'a');
  if (!feat.headwear && headwearCount > 0) errors.push('headwear pixels are present even though headwear=false');
  if (feat.headwear && headwearCount < 5) errors.push('observed headwear is missing from the pixels');
  if (feat.headwear) {
    const lowHeadwear = countSymbol(rows, '9', (_x, y) => y > anchors.eyeY + 1) +
      countSymbol(rows, 'a', (_x, y) => y > anchors.eyeY + 1);
    if (lowHeadwear > 2) errors.push(`${lowHeadwear} headwear pixels continue below the eye line, turning the hat into a helmet`);
  }
  if (feat.topology.headwear.projection === 'front-bill') {
    const spans = Array.from({ length: Math.max(0, anchors.eyeY - 1) }, (_, y) => spanAt(rows, y, '9a'))
      .filter((span) => span.width > 0);
    const upper = spans.slice(0, Math.max(1, Math.ceil(spans.length / 2)));
    const lower = spans.slice(Math.max(1, Math.ceil(spans.length / 2)));
    const upperWidth = Math.max(0, ...upper.map((span) => span.width));
    const lowerWidth = Math.max(0, ...lower.map((span) => span.width));
    if (lowerWidth < upperWidth + 2) errors.push('baseball-cap crown has no visibly projecting lower bill; it will read as a beanie');
  }

  const frameCount = countSymbol(rows, 'b');
  if (!feat.glasses && frameCount > 0) errors.push('glasses-frame pixels are present even though glasses=false');
  if (feat.glasses) {
    if (frameCount < 6) errors.push('observed glasses are missing or too incomplete');
    if (!hasSymbolNear(rows, 'b', anchors.leftEyeX, anchors.eyeY, 2)) errors.push('left glasses frame is not around the left eye');
    if (!hasSymbolNear(rows, 'b', anchors.rightEyeX, anchors.eyeY, 2)) errors.push('right glasses frame is not around the right eye');
    const faceWidth = Math.max(1, anchoredFaceWidth);
    if (maxHorizontalRun(rows, 'b', anchors.eyeY - 2, anchors.eyeY + 2) > Math.ceil(faceWidth * 0.68)) {
      errors.push('glasses contain a visor-like continuous frame bar');
    }
    if (maxHorizontalRun(rows, 'e', anchors.eyeY - 2, anchors.eyeY + 2) > Math.ceil(faceWidth * 0.34)) {
      errors.push('eye white/lens fill forms a visor-like horizontal block');
    }
  }

  const hairTopology = feat.topology.facialHair;
  const hasFacialHair = Object.values(hairTopology).some((region) => region !== 'none');
  const facialCount = countSymbol(rows, '8');
  if (!hasFacialHair && facialCount > 0) errors.push('facial-hair pixels are present even though every facial region is none');
  if (hasFacialHair && facialCount < 2) errors.push('reported facial hair is missing from the pixels');
  if (hairTopology.upperLip !== 'none') {
    const upperLipCount = countSymbol(rows, '8', (x, y) =>
      y >= anchors.upperLipY - 1 && y <= anchors.mouthY && x > anchors.faceLeft && x < anchors.faceRight,
    );
    if (upperLipCount === 0) errors.push('upper-lip hair is reported but no facial-hair pixels sit above the mouth');
  }
  if (hairTopology.chin !== 'none' || hairTopology.jaw !== 'none' || hairTopology.cheeks !== 'none') {
    const lowerCount = countSymbol(rows, '8', (_x, y) => y > anchors.mouthY);
    if (lowerCount === 0) errors.push('chin/jaw/cheek hair is reported but no facial-hair pixels sit below the mouth');
  }
  const faceWidth = Math.max(1, anchoredFaceWidth);
  if (maxHorizontalRun(rows, '8') > Math.ceil(faceWidth * 0.72)) errors.push('facial hair is a full-width horizontal band');
  if (maxHorizontalRun(rows, 'd') > Math.ceil(faceWidth * 0.5)) errors.push('mouth is a full-width horizontal band');

  return { errors, opaqueBox: box, coverage };
}

const REDUCTION_WEIGHT: Record<string, number> = {
  '.': 1.1,
  '1': 1.45,
  '2': 1,
  '3': 1,
  '4': 1,
  '5': 1.05,
  '6': 1.3,
  '7': 1.25,
  '8': 2.4,
  '9': 1.45,
  a: 1.25,
  b: 2.35,
  c: 1.7,
  d: 2.8,
  e: 2.25,
  f: 1.8,
};

function scaleCoordinate(value: number, source: number, target: number): number {
  return Math.max(0, Math.min(target - 1, Math.round((value * (target - 1)) / (source - 1))));
}

/** Role-aware majority reduction: thin identity cues outvote broad skin fills. */
export function reduceDirectPixelRows(
  sourceRows: string[],
  targetSize: DirectPixelSize,
  anchors: DirectPixelAnchors,
  features: FaceFeatures,
): string[] {
  const sourceSize = sourceRows.length;
  if (targetSize === sourceSize) return [...sourceRows];
  const votes = Array.from({ length: targetSize * targetSize }, () => new Map<string, number>());
  for (let sy = 0; sy < sourceSize; sy++) {
    for (let sx = 0; sx < sourceSize; sx++) {
      const tx = Math.min(targetSize - 1, Math.floor(((sx + 0.5) * targetSize) / sourceSize));
      const ty = Math.min(targetSize - 1, Math.floor(((sy + 0.5) * targetSize) / sourceSize));
      const symbol = sourceRows[sy]![sx]!;
      const cell = votes[ty * targetSize + tx]!;
      cell.set(symbol, (cell.get(symbol) ?? 0) + (REDUCTION_WEIGHT[symbol] ?? 1));
    }
  }
  const grid = Array.from({ length: targetSize }, () => Array<string>(targetSize).fill('.'));
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const choices = [...votes[y * targetSize + x]!.entries()].sort((a, b) => b[1] - a[1]);
      grid[y]![x] = choices[0]?.[0] ?? '.';
    }
  }

  const feat = normalizeFaceFeatures(features);
  const mapped = {
    leftEyeX: scaleCoordinate(anchors.leftEyeX, sourceSize, targetSize),
    rightEyeX: scaleCoordinate(anchors.rightEyeX, sourceSize, targetSize),
    eyeY: scaleCoordinate(anchors.eyeY, sourceSize, targetSize),
    upperLipY: scaleCoordinate(anchors.upperLipY, sourceSize, targetSize),
    mouthY: scaleCoordinate(anchors.mouthY, sourceSize, targetSize),
  };
  if (targetSize <= 20) {
    // A broad 28px brow/pupil cluster must become a deliberately redrawn LOD,
    // not a weighted dark rectangle. The Muse anchors still determine exactly
    // where the eyes sit; this only spends the smaller pixel budget cleanly.
    for (const [eyeX, whiteDirection] of [
      [mapped.leftEyeX, -1],
      [mapped.rightEyeX, 1],
    ] as const) {
      for (let y = Math.max(0, mapped.eyeY - 1); y <= Math.min(targetSize - 1, mapped.eyeY + 1); y++) {
        for (let x = Math.max(0, eyeX - 1); x <= Math.min(targetSize - 1, eyeX + 1); x++) {
          if ('ce'.includes(grid[y]![x]!)) grid[y]![x] = '4';
        }
      }
      const browY = Math.max(0, mapped.eyeY - 1);
      if (grid[browY]![eyeX] !== 'b') grid[browY]![eyeX] = 'c';
      grid[mapped.eyeY]![eyeX] = 'c';
      const whiteX = Math.max(0, Math.min(targetSize - 1, eyeX + whiteDirection));
      if (grid[mapped.eyeY]![whiteX] !== 'b') grid[mapped.eyeY]![whiteX] = 'e';
    }
  }
  // Critical one-pixel cues can disappear under any resampler. Restore only a
  // missing cue at its Muse-authored anchor; never invent a new category.
  for (const eyeX of [mapped.leftEyeX, mapped.rightEyeX]) {
    const current = grid[mapped.eyeY]![eyeX]!;
    if (!'ce'.includes(current)) grid[mapped.eyeY]![eyeX] = 'c';
  }
  const mouthPresent = grid.some((row, y) =>
    Math.abs(y - mapped.mouthY) <= 1 && row.some((symbol) => symbol === 'd'),
  );
  if (!mouthPresent) {
    const centerX = Math.round((mapped.leftEyeX + mapped.rightEyeX) / 2);
    grid[mapped.mouthY]![centerX] = 'd';
  }
  if (feat.topology.facialHair.upperLip !== 'none') {
    const upperLipPresent = grid.some((row, y) =>
      Math.abs(y - mapped.upperLipY) <= 1 && row.some((symbol) => symbol === '8'),
    );
    if (!upperLipPresent) {
      const centerX = Math.round((mapped.leftEyeX + mapped.rightEyeX) / 2);
      grid[mapped.upperLipY]![centerX] = '8';
    }
  }
  return grid.map((row) => row.join(''));
}

export async function rasterizeDirectPixelSprite(palette: string[], rows: string[]): Promise<Buffer> {
  const size = rows.length;
  const raw = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const row = rows[y]!;
    for (let x = 0; x < size; x++) {
      const symbol = row[x]!;
      if (symbol === '.') continue;
      const value = palette[parseInt(symbol, 16)]!;
      const offset = (y * size + x) * 4;
      raw[offset] = parseInt(value.slice(1, 3), 16);
      raw[offset + 1] = parseInt(value.slice(3, 5), 16);
      raw[offset + 2] = parseInt(value.slice(5, 7), 16);
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

export async function generateDirectPixelLikeness(
  photo: Buffer,
  features: FaceFeatures,
  provider: Provider,
  model: string,
  sizes: readonly DirectPixelSize[] = DIRECT_PIXEL_SIZES,
): Promise<DirectPixelLikeness> {
  if (!provider.capabilities.imageIn) throw new Error('the configured provider does not support image input');
  const normalizedFeatures = normalizeFaceFeatures(features);
  const palette = buildDirectPixelPalette(normalizedFeatures);
  const normalizedPhoto = await sharp(photo)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const prompt = buildDirectPixelPrompt(normalizedFeatures, palette);
  const complete = async (user: string) => provider.complete(
    {
      system: prompt.system,
      user,
      maxTokens: prompt.maxTokens,
      temperature: 0,
      effort: 'minimal',
      jsonSchema: prompt.jsonSchema,
      image: normalizedPhoto,
      timeoutMs: 100_000,
    },
    { model },
  );

  const first = await complete(prompt.user);
  const draft = parseDirectPixelDraft(first.text);
  const audit = auditDirectPixelDraft(draft, normalizedFeatures);

  const sprites = Object.fromEntries(
    sizes.map((size) => [
      String(size),
      reduceDirectPixelRows(draft.rows, size, draft.anchors, normalizedFeatures),
    ]),
  );
  const pngs = Object.fromEntries(
    await Promise.all(
      sizes.map(async (size) => [
        String(size),
        await rasterizeDirectPixelSprite(palette, sprites[String(size)]!),
      ] as const),
    ),
  );
  return {
    document: {
      identityCues: identityCues(normalizedFeatures),
      palette,
      master: draft,
      sprites,
      // Validation is diagnostic in the lab. A second paid Muse call is always
      // explicit via "Refresh candidate", never an invisible automatic wait.
      validation: { repaired: false, ...audit },
    },
    pngs,
    usage: first.usage,
  };
}
