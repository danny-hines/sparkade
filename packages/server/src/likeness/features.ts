// Vision-based likeness (opt-in via config.likeness.smartFeatures). Instead of
// quantizing the face to the game's arbitrary 16 colors — which turns a face
// gray when the palette has no skin tone, and is at the mercy of webcam
// lighting — we read the photo with the model, get the person's true (lighting-
// normalized) skin/hair colours, and build a portrait palette from THOSE. The
// real downscaled face still supplies the structure; only the colours change.
// The photo is sent to the provider only when the opt-in is on.
import type { BuiltPrompt } from '../pipeline/prompts';

export interface FaceFeatures {
  skinTone: string; // hex — true base skin, normalized for lighting
  hairColor: string; // hex, or "none"
  glasses: boolean;
  facialHair: boolean;
  headwear: boolean;
  headwearColor: string; // hex, or "none"
}

export const FACE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['skinTone', 'hairColor', 'glasses', 'facialHair', 'headwear', 'headwearColor'],
  properties: {
    skinTone: { type: 'string', description: "hex of the person's true base skin tone in neutral daylight" },
    hairColor: { type: 'string', description: 'hex of hair colour, or "none" if bald/shaved/no visible hair' },
    glasses: { type: 'boolean' },
    facialHair: { type: 'boolean' },
    headwear: { type: 'boolean' },
    headwearColor: { type: 'string', description: 'hex of the headwear, or "none"' },
  },
};

export function buildFaceAnalysisPrompt(): BuiltPrompt {
  const system = [
    "You describe a person's face from a photo so we can build a faithful pixel-art avatar of them for a retro video game.",
    '',
    "Report the person's ACTUAL colouring, normalized for the photo's lighting — ignore colour casts, harsh shadows, and flash; infer the true tones as they would look in neutral daylight.",
    '',
    'Fields:',
    "- skinTone: hex of the person's true base skin tone.",
    '- hairColor: hex of their hair colour, or "none" if bald / shaved / no visible hair.',
    '- glasses: true if they are wearing glasses.',
    '- facialHair: true if they have visible facial hair (beard / moustache / stubble).',
    '- headwear: true if they are wearing a hat / cap / head covering.',
    '- headwearColor: hex of the headwear, or "none".',
    '',
    'Be accurate and respectful about skin tone across all ethnicities — never lighten or darken. Output only the structured fields.',
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
