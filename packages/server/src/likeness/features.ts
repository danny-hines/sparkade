// Vision-based likeness (opt-in via config.likeness.smartFeatures). Instead of
// quantizing the face to the game's arbitrary 16 colors — which turns a face
// gray when the palette has no skin tone, and is at the mercy of webcam
// lighting — we read the photo with the model, get the person's true (lighting-
// normalized) skin/hair colours, and build a portrait palette from THOSE. The
// real downscaled face still supplies the structure; only the colours change.
// The photo is sent to the provider only when the opt-in is on.
import type { BuiltPrompt } from '../pipeline/prompts';

export type FaceShape = 'round' | 'oval' | 'square' | 'long' | 'heart';
export type ChinShape = 'round' | 'pointed' | 'square' | 'wide';
export type Size3 = 'small' | 'medium' | 'large';
export type EyeSpacing = 'close' | 'average' | 'wide';
export type EyeShape = 'round' | 'almond' | 'narrow';
export type BrowThickness = 'thin' | 'medium' | 'thick';
export type BrowShape = 'straight' | 'arched' | 'angled';
export type EarProminence = 'hidden' | 'small' | 'average' | 'prominent';
export type FacialHair = 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';

export interface FaceFeatures {
  // Colouring — true tones, normalized for the photo's lighting.
  skinTone: string; // hex
  hairColor: string; // hex, or "none" (bald / shaved)
  facialHairColor: string; // hex, or "none" (clean-shaven)
  headwearColor: string; // hex, or "none"
  // Accessories.
  glasses: boolean;
  headwear: boolean;
  facialHair: FacialHair;
  // Proportions estimated from the photo, so the drawn avatar varies in
  // STRUCTURE (not just colour). Optional — the renderer defaults each.
  faceShape?: FaceShape;
  chin?: ChinShape;
  noseSize?: Size3;
  eyeSpacing?: EyeSpacing;
  eyeShape?: EyeShape;
  eyebrows?: BrowThickness;
  eyebrowShape?: BrowShape;
  ears?: EarProminence;
}

export const FACE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'skinTone', 'hairColor', 'facialHairColor', 'headwearColor', 'glasses', 'headwear', 'facialHair',
    'faceShape', 'chin', 'noseSize', 'eyeSpacing', 'eyeShape', 'eyebrows', 'eyebrowShape', 'ears',
  ],
  properties: {
    skinTone: { type: 'string', description: "hex of the person's true base skin tone in neutral daylight" },
    hairColor: { type: 'string', description: 'hex of hair colour, or "none" if bald/shaved' },
    facialHairColor: { type: 'string', description: 'hex of facial-hair colour, or "none" if clean-shaven' },
    headwearColor: { type: 'string', description: 'hex of the headwear, or "none"' },
    glasses: { type: 'boolean' },
    headwear: { type: 'boolean', description: 'true if wearing a hat / cap / head covering' },
    facialHair: { enum: ['none', 'stubble', 'mustache', 'goatee', 'beard'] },
    faceShape: { enum: ['round', 'oval', 'square', 'long', 'heart'], description: 'overall face outline & height:width ratio' },
    chin: { enum: ['round', 'pointed', 'square', 'wide'] },
    noseSize: { enum: ['small', 'medium', 'large'], description: 'nose size relative to the face' },
    eyeSpacing: { enum: ['close', 'average', 'wide'], description: 'gap between the eyes' },
    eyeShape: { enum: ['round', 'almond', 'narrow'] },
    eyebrows: { enum: ['thin', 'medium', 'thick'], description: 'eyebrow thickness' },
    eyebrowShape: { enum: ['straight', 'arched', 'angled'] },
    ears: { enum: ['hidden', 'small', 'average', 'prominent'], description: 'ear prominence, or "hidden" if covered/not visible' },
  },
};

export function buildFaceAnalysisPrompt(): BuiltPrompt {
  const system = [
    "You are a character artist. Study the attached photo and describe the person's face as a set of PROPORTIONS and traits, so we can DRAW a faithful pixel-art avatar of them (we do not trace the photo — we redraw from your description). Judge every shape by its proportion relative to the head.",
    '',
    "Colour — report the person's ACTUAL tones, normalized for the photo's lighting (ignore colour casts, flash, and harsh shadows; infer the true colours as in neutral daylight):",
    '- skinTone: hex of the true base skin tone.',
    '- hairColor: hex, or "none" if bald / shaved.',
    '- facialHairColor: hex, or "none" if clean-shaven.',
    '- headwearColor: hex, or "none".',
    '',
    'Accessories:',
    '- glasses / headwear: booleans.',
    '- facialHair: none | stubble | mustache | goatee | beard.',
    '',
    'Proportions (estimate from the photo):',
    '- faceShape: round | oval | square | long | heart — the overall outline and height:width.',
    '- chin: round | pointed | square | wide.',
    '- noseSize: small | medium | large (relative to the face).',
    '- eyeSpacing: close | average | wide.',
    '- eyeShape: round | almond | narrow.',
    '- eyebrows: thin | medium | thick.',
    '- eyebrowShape: straight | arched | angled.',
    '- ears: hidden | small | average | prominent.',
    '',
    'Be accurate and respectful about skin tone across all ethnicities — never lighten or darken. Do NOT infer age, gender, health, identity, or any other sensitive attribute; describe only the visible geometry and colours. Output only the structured fields.',
  ].join('\n');
  return {
    system,
    user: 'Analyze the attached face photo and return the fields.',
    jsonSchema: FACE_SCHEMA,
    maxTokens: 2000,
  };
}

// ---------------------------------------------------------------- palette ----

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}
function normHex(hex: string | undefined, fallback: string): string {
  let h = (hex ?? '').trim();
  if (h && h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!;
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : fallback;
}
function shade(hex: string, f: number): string {
  return toHex(parseInt(hex.slice(1, 3), 16) * f, parseInt(hex.slice(3, 5), 16) * f, parseInt(hex.slice(5, 7), 16) * f);
}
function blend(a: string, b: string, t: number): string {
  const mix = (i: number) => parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t;
  return toHex(mix(1), mix(3), mix(5));
}

/**
 * A 16-slot palette centered on the person's real skin + hair, for
 * bakeLikeness to quantize the downscaled face against. Skin/hair land on the
 * right tones; dark features (eyes, glasses, beard) fall to the dark slots.
 * Slot 0 is unused and slot 1 is the outline (bakeSize's conventions).
 */
export function buildPortraitPalette(feat: FaceFeatures): string[] {
  const skin = normHex(feat.skinTone, '#c98f6b');
  const bald = (feat.hairColor ?? '').trim().toLowerCase() === 'none';
  const hair = bald ? shade(skin, 0.66) : normHex(feat.hairColor, '#2a2320');
  const hw =
    feat.headwear && (feat.headwearColor ?? '').trim().toLowerCase() !== 'none'
      ? normHex(feat.headwearColor, hair)
      : hair;
  return [
    '#000000', // 0 unused (transparent)
    shade(skin, 0.24), // 1 outline + darkest features
    shade(skin, 0.6), // 2 skin deep shadow
    shade(skin, 0.8), // 3 skin shadow
    skin, // 4 skin base
    shade(skin, 1.12), // 5 skin highlight
    shade(hair, 0.6), // 6 hair dark
    hair, // 7 hair base
    shade(hair, 1.22), // 8 hair highlight
    blend(skin, '#9c3450', 0.42), // 9 lip / mouth
    '#1b1622', // 10 eye / feature dark
    hw, // 11 headwear
    '#f2f2f4', // 12 white (eye/teeth highlight)
    shade(skin, 0.9), // 13 skin mid
    shade(hair, 0.85), // 14 hair mid
    shade(skin, 0.7), // 15 skin shadow (weight toward skin)
  ];
}
