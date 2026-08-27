import sharp from 'sharp';
import type { GameSpec } from '@sparkade/shared';

export const KEY_ART_PROMPT_VERSION = 'key-art-v1';
export const STORY_ART_PROMPT_VERSION = 'story-scenes-v1';
export const KEY_ART_SIZE = { width: 480, height: 270 } as const;
export const STORY_ART_SIZE = { width: 420, height: 180 } as const;
export const KEY_ART_ASPECT_HINT = '1792x1024';
export const STORY_ART_ASPECT_HINT = '1792x768';

export type StoryArtRole = 'intro' | 'boss' | 'victory' | 'defeat';

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function visualBrief(spec: GameSpec): string {
  const fighterPlayer = spec.archetype === 'fighter' ? spec.player : undefined;
  return [
    `Game title for context only: ${clean(spec.meta.title)}. Do not render the title as text.`,
    `Genre: ${spec.archetype}.`,
    `Premise: ${clean(spec.meta.tagline)}.`,
    `Opening: ${clean(spec.story.intro.join(' '))}`,
    `Main villain: ${clean(spec.boss.name)}. ${clean(spec.story.bossIntro)}`,
    fighterPlayer
      ? `Player fighter design: ${clean(fighterPlayer.name)}; ${clean(fighterPlayer.build)} build; outfit: ${clean(fighterPlayer.outfit ?? 'classic arcade gear')}.`
      : '',
    `Use this exact limited color direction: ${spec.palette.join(', ')}.`,
  ].join(' ');
}

/** The photo is supplied as the edit reference when `hasPlayerPhoto` is true. */
export function buildKeyArtPrompt(spec: GameSpec, hasPlayerPhoto: boolean): string {
  return [
    hasPlayerPhoto
      ? 'Transform the exact person in the reference photo into the PLAYER HERO of this game. Preserve their recognizable face shape, skin tone, hair texture and style, facial hair, glasses, headwear, accessories, and body proportions; never replace them with a generic character.'
      : 'Create a distinctive original PLAYER HERO suited to this game premise.',
    visualBrief(spec),
    'Compose one dramatic landscape key-art image that clearly shows the player hero, the game world, and the main villain in the distance.',
    'Polished 16-bit console-game illustration: deliberate pixel clusters, crisp silhouettes, expressive characters, rich environmental detail, and cohesive limited colors. It should feel like premium SNES-era box art rendered by a master pixel artist.',
    'Landscape composition with important faces and action inside the central safe area. No UI, screenshot frame, arcade cabinet, text, letters, title, logo, caption, watermark, signature, border, photorealism, blur, or 3D render.',
  ].join(' ');
}

export function buildStoryArtPrompt(spec: GameSpec, role: StoryArtRole): string {
  const beat =
    role === 'intro'
      ? `Opening scene: ${clean(spec.story.intro.join(' '))}`
      : role === 'boss'
        ? `Boss confrontation with ${clean(spec.boss.name)}: ${clean(spec.story.bossIntro)}`
        : role === 'victory'
          ? `Victory scene: ${clean(spec.story.victory.join(' '))}`
          : `Defeat scene: ${clean(spec.story.defeat.join(' '))}`;
  return [
    'Using the reference key art as the immutable visual bible, create a new landscape story illustration from the same game.',
    `Preserve the exact same player hero identity, costume, villain design, palette, pixel-art technique, and world. ${beat}.`,
    role === 'boss'
      ? 'Frame the player hero and villain facing one another with immediate danger and a strong scale contrast.'
      : role === 'victory'
        ? 'Make the outcome unmistakably triumphant and emotionally warm.'
        : role === 'defeat'
          ? 'Show a clear but family-friendly setback. The player hero should look upset, worried, disappointed, or sad in a way that fits the defeat beat, while still recognizably themselves. No wounds, gore, death, humiliation, or cruelty.'
          : 'Establish the world and the player hero with a clear narrative focal point.',
    'Polished 16-bit console illustration with crisp deliberate pixel clusters and readable silhouettes. Keep faces and the main action away from the extreme edges.',
    'No text, letters, title, logo, caption, speech bubble, UI, watermark, signature, border, photorealism, blur, or 3D render.',
  ].join(' ');
}

/** Normalize arbitrary camera uploads before sending them to an edit endpoint. */
export async function prepareImageReference(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate().resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
}

export async function normalizeKeyArt(image: Buffer): Promise<Buffer> {
  return normalizeLandscape(image, KEY_ART_SIZE.width, KEY_ART_SIZE.height);
}

export async function normalizeStoryArt(image: Buffer): Promise<Buffer> {
  return normalizeLandscape(image, STORY_ART_SIZE.width, STORY_ART_SIZE.height);
}

async function normalizeLandscape(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** Deterministic binary fixture used only when the whole app runs with the mock
 * provider. It exercises the exact normalization/manifest/runtime path without
 * pretending that a local placeholder came from Muse Image. */
export async function mockGeneratedImage(prompt: string): Promise<Buffer> {
  // A 256px fixture is plenty for deterministic pipeline coverage and keeps
  // mock photo-fighter generation fast. Silhouette helpers use a 512px design
  // grid so their coordinates stay easy to reason about.
  const width = 256;
  const height = 256;
  const greenScreen = prompt.includes('#00ff00');
  const fighter = greenScreen && prompt.includes('fighting-game sprite');
  const head = greenScreen && prompt.includes('HEAD sprite');
  let hash = 2166136261;
  for (const char of prompt) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const subject =
        greenScreen &&
        (fighter
          ? mockFighterSubject(x * 2, y * 2, prompt)
          : head
            ? mockHeadSubject(x * 2, y * 2, prompt)
            : x >= 90 && x < 166 && y >= 27 && y < 235);
      if (greenScreen && !subject) {
        raw[offset] = 0;
        raw[offset + 1] = 255;
        raw[offset + 2] = 0;
      } else {
        raw[offset] = (48 + (hash & 127) + Math.floor((x / width) * 45)) % 256;
        raw[offset + 1] = (36 + ((hash >>> 8) & 127) + Math.floor((y / height) * 35)) % 256;
        raw[offset + 2] = (72 + ((hash >>> 16) & 127)) % 256;
      }
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function mockHeadSubject(x: number, y: number, prompt: string): boolean {
  const side = prompt.includes('side-view');
  const back = prompt.includes('back-view');
  const cx = side ? 270 : 256;
  const rx = side ? 115 : 132;
  const ellipse = ((x - cx) / rx) ** 2 + ((y - 250) / 170) ** 2 <= 1;
  const ear = !back && (x - (side ? 164 : 124)) ** 2 + (y - 260) ** 2 <= 28 ** 2;
  const profile = side && x >= 360 && x <= 406 && y >= 225 && y <= 285;
  return ellipse || ear || profile;
}

function mockFighterSubject(x: number, y: number, prompt: string): boolean {
  if (prompt.includes('knocked-out pose')) {
    return (
      circle(x, y, 126, 365, 34) ||
      thickSegment(x, y, 155, 366, 330, 366, 35) ||
      thickSegment(x, y, 225, 360, 350, 312, 17) ||
      thickSegment(x, y, 300, 370, 410, 410, 20) ||
      thickSegment(x, y, 300, 372, 405, 365, 20)
    );
  }

  const airborne = prompt.includes('airborne fighting pose');
  const crouching = prompt.includes('low stationary crouching');
  const offsetY = airborne ? -70 : crouching ? 55 : 0;
  const headY = 105 + offsetY;
  const shoulderY = 155 + offsetY;
  const hipY = crouching ? 316 : 300 + offsetY;
  const torso = thickSegment(x, y, 252, shoulderY, crouching ? 235 : 250, hipY, 38);
  const head = circle(x, y, 252, headY, 38);
  const neck = thickSegment(x, y, 252, headY + 24, 252, shoulderY, 20);

  let arms =
    thickSegment(x, y, 226, shoulderY + 8, 190, 235 + offsetY, 18) ||
    thickSegment(x, y, 276, shoulderY + 8, 302, 228 + offsetY, 18);
  if (prompt.includes('high straight punch')) {
    arms =
      thickSegment(x, y, 272, shoulderY + 8, 420, shoulderY - 6, 19) ||
      thickSegment(x, y, 225, shoulderY + 12, 205, 205 + offsetY, 18);
  } else if (prompt.includes('low body punch')) {
    arms =
      thickSegment(x, y, 270, shoulderY + 12, 405, 265 + offsetY, 19) ||
      thickSegment(x, y, 225, shoulderY + 12, 205, 205 + offsetY, 18);
  } else if (prompt.includes('defensive guard')) {
    arms =
      thickSegment(x, y, 220, shoulderY + 12, 238, headY + 2, 19) ||
      thickSegment(x, y, 280, shoulderY + 12, 268, headY + 2, 19);
  } else if (prompt.includes('hurt recoil')) {
    arms =
      thickSegment(x, y, 220, shoulderY + 8, 145, 175 + offsetY, 18) ||
      thickSegment(x, y, 280, shoulderY + 8, 350, 130 + offsetY, 18);
  }

  let legs =
    thickSegment(x, y, 228, hipY - 4, 198, 446 + offsetY, 22) ||
    thickSegment(x, y, 273, hipY - 4, 318, 446 + offsetY, 22);
  if (crouching) {
    legs =
      thickSegment(x, y, 225, hipY - 8, 175, 376, 23) ||
      thickSegment(x, y, 175, 376, 132, 430, 21) ||
      thickSegment(x, y, 266, hipY - 8, 325, 380, 23) ||
      thickSegment(x, y, 325, 380, 382, 430, 21);
  } else if (airborne) {
    legs =
      thickSegment(x, y, 228, hipY, 180, 355, 22) ||
      thickSegment(x, y, 180, 355, 238, 385, 20) ||
      thickSegment(x, y, 272, hipY, 330, 350, 22) ||
      thickSegment(x, y, 330, 350, 285, 390, 20);
  } else if (prompt.includes('high side kick')) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 198, 446, 22) ||
      thickSegment(x, y, 272, hipY - 4, 420, 190, 24);
  } else if (prompt.includes('low sweeping kick')) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 205, 444, 22) ||
      thickSegment(x, y, 272, hipY - 4, 430, 405, 24);
  } else if (prompt.includes('mid-stride')) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 150, 446, 22) ||
      thickSegment(x, y, 272, hipY - 4, 372, 430, 22);
  }

  return head || neck || torso || arms || legs;
}

function circle(x: number, y: number, cx: number, cy: number, radius: number): boolean {
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function thickSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}
