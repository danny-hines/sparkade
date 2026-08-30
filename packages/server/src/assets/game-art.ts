import sharp from 'sharp';
import { FIGHTER_POSES, type FighterPose, type GameSpec } from '@sparkade/shared';
import { fighterArtDirectionPrompt } from './fighter-art-direction';
import { FIGHTER_POSE_SHEET_SIZE, fighterPoseSheetCellRect } from './fighter-pose-sheet';

export const KEY_ART_PROMPT_VERSION = 'key-art-v3';
export const STORY_ART_PROMPT_VERSION = 'story-scenes-v2';
export const KEY_ART_SIZE = { width: 480, height: 270 } as const;
export const STORY_ART_SIZE = { width: 420, height: 180 } as const;
export const KEY_ART_ASPECT_HINT = '1792x1024';
export const STORY_ART_ASPECT_HINT = '1792x768';

export type StoryArtRole = 'intro' | 'boss' | 'victory' | 'defeat';
export interface PlayerCraftArtBrief {
  visualConcept: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function wardrobeBrief(heroConcept: string | undefined): string {
  const concept = heroConcept ? clean(heroConcept) : '';
  return concept ? `Canonical player hero design and game-world outfit: ${concept}.` : '';
}

function visualBrief(
  spec: GameSpec,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
): string {
  const fighterPlayer = spec.archetype === 'fighter' ? spec.player : undefined;
  const canonicalHeroConcept = heroConcept ?? spec.meta.heroConcept;
  return [
    `Game title for context only: ${clean(spec.meta.title)}. Do not render the title as text.`,
    `Genre: ${spec.archetype}.`,
    `Premise: ${clean(spec.meta.tagline)}.`,
    `Opening: ${clean(spec.story.intro.join(' '))}`,
    `Main villain: ${clean(spec.boss.name)}. ${clean(spec.story.bossIntro)}`,
    fighterPlayer
      ? `Player fighter design: ${clean(fighterPlayer.name)}; ${clean(fighterPlayer.visualConcept)}; ${clean(fighterPlayer.build)} build; outfit: ${clean(fighterPlayer.outfit ?? 'classic arcade gear')}.`
      : wardrobeBrief(canonicalHeroConcept),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction for every character and environment: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `Canonical player craft identity, wholly separate from the pilot's likeness: ${clean(playerCraft.visualConcept)}.`
      : '',
    `Use this exact limited color direction: ${spec.palette.join(', ')}.`,
  ].join(' ');
}

/** The photo is supplied as the edit reference when `hasPlayerPhoto` is true. */
export function buildKeyArtPrompt(
  spec: GameSpec,
  hasPlayerPhoto: boolean,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
): string {
  return [
    hasPlayerPhoto
      ? playerCraft
        ? 'The TOP PANEL of the reference board contains the exact person who is the PLAYER PILOT. It is immutable identity truth from the neck up: preserve their recognizable face and head shape, skin tone, hair texture and style, facial hair, glasses, headwear, and visible head accessories; never replace them with a generic character. The source photo clothing below the neck is NOT identity: replace it with the canonical game-world outfit in the visual brief.'
        : 'Transform the exact person in the reference photo into the PLAYER HERO of this game. The reference is immutable identity truth from the neck up: preserve their recognizable face and head shape, skin tone, hair texture and style, facial hair, glasses, headwear, and visible head accessories; never replace them with a generic character. The source photo clothing below the neck is NOT identity: replace it with the canonical game-world outfit in the visual brief.'
      : 'Create a distinctive original PLAYER HERO suited to this game premise.',
    visualBrief(spec, heroConcept, playerCraft),
    playerCraft
      ? hasPlayerPhoto
        ? 'The BOTTOM PANEL is the exact player craft used in gameplay. Preserve its side-view silhouette, canopy, fins, engines, materials, colors, and signature markings. The pilot and craft are separate identities: never put the pilot face, head, or body onto the vehicle.'
        : 'The reference image is the exact player craft used in gameplay. Preserve its side-view silhouette, canopy, fins, engines, materials, colors, and signature markings. Never give the vehicle a human face, head, or body.'
      : '',
    hasPlayerPhoto
      ? 'Keep the exact same neck-up identity while making the canonical outfit clearly readable in its silhouette, collar, torso, sleeves, legs, and footwear.'
      : '',
    playerCraft
      ? 'Compose one dramatic landscape key-art image that clearly shows the player pilot, their exact craft, the game world, and the main villain in the distance.'
      : 'Compose one dramatic landscape key-art image that clearly shows the player hero, the game world, and the main villain in the distance.',
    'Polished 16-bit console-game illustration: deliberate pixel clusters, crisp silhouettes, expressive characters, rich environmental detail, and cohesive limited colors. It should feel like premium SNES-era box art rendered by a master pixel artist.',
    'Landscape composition with important faces and action inside the central safe area. No UI, screenshot frame, arcade cabinet, text, letters, title, logo, caption, watermark, signature, border, photorealism, blur, or 3D render.',
  ].join(' ');
}

/**
 * Conservative second-chance prompt for a provider policy rejection. It
 * deliberately excludes authored story prose and combat language: generated
 * copy can be perfectly appropriate for the game while still combining with
 * a real-person reference in a way that trips an image policy classifier.
 */
export function buildKeyArtPolicyFallbackPrompt(
  spec: GameSpec,
  hasPlayerPhoto: boolean,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
): string {
  const canonicalHeroConcept = heroConcept ?? spec.meta.heroConcept;
  return [
    hasPlayerPhoto
      ? playerCraft
        ? 'Render the adult person in the TOP PANEL of the reference board as the friendly player pilot. Preserve their recognizable identity from the neck up, including face, skin tone, hair, eyewear, headwear, and visible head accessories. Replace their source clothing below the neck with the canonical game-world outfit.'
        : 'Render the adult person in the reference image as the friendly player character. Preserve their recognizable identity from the neck up, including face, skin tone, hair, eyewear, headwear, and visible head accessories. Replace their source clothing below the neck with the canonical game-world outfit.'
      : 'Create one friendly original player character.',
    wardrobeBrief(canonicalHeroConcept),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `Preserve the separate exact player vehicle shown in the ${hasPlayerPhoto ? 'BOTTOM PANEL' : 'reference image'}: ${clean(playerCraft.visualConcept)}. Never merge the person and vehicle identities.`
      : '',
    `Create polished landscape key art for a colorful ${spec.archetype} game world using this limited palette: ${spec.palette.join(', ')}.`,
    'Use a calm, adventurous composition with the player character centered safely in the environment.',
    'Premium 16-bit console illustration with crisp pixel clusters, clear silhouettes, and rich environmental detail.',
    'No text, letters, title, logo, caption, UI, watermark, signature, border, photorealism, blur, or 3D render.',
  ].join(' ');
}

export function buildStoryArtPrompt(
  spec: GameSpec,
  role: StoryArtRole,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
): string {
  const canonicalHeroConcept = heroConcept ?? spec.meta.heroConcept;
  const beat =
    role === 'intro'
      ? `Opening scene: ${clean(spec.story.intro.join(' '))}`
      : role === 'boss'
        ? `Boss confrontation with ${clean(spec.boss.name)}: ${clean(spec.story.bossIntro)}`
        : role === 'victory'
          ? `Victory scene: ${clean(spec.story.victory.join(' '))}`
          : `Defeat scene: ${clean(spec.story.defeat.join(' '))}`;
  return [
    playerCraft
      ? 'The TOP PANEL of the reference board is the immutable key-art visual bible and the BOTTOM PANEL is the exact gameplay craft. Create a new landscape story illustration from the same game.'
      : 'Using the reference key art as the immutable visual bible, create a new landscape story illustration from the same game.',
    `Preserve the exact same player hero identity, costume, villain design, palette, pixel-art technique, and world. ${beat}.`,
    wardrobeBrief(canonicalHeroConcept),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `Whenever the player vehicle is visible, preserve the BOTTOM PANEL's exact separate craft identity: ${clean(playerCraft.visualConcept)}. Never place the pilot's face or body onto the craft.`
      : '',
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

/** A story-role-specific prompt that is safe to use after a policy rejection. */
export function buildStoryArtPolicyFallbackPrompt(
  spec: GameSpec,
  role: StoryArtRole,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
): string {
  const canonicalHeroConcept = heroConcept ?? spec.meta.heroConcept;
  const scene =
    role === 'intro'
      ? 'Show the player character arriving safely in the world with a curious, hopeful expression.'
      : role === 'boss'
        ? 'Show the player character and a large fantasy rival at a respectful distance before a friendly arcade challenge.'
        : role === 'victory'
          ? 'Show the player character celebrating a successful adventure in warm, welcoming surroundings.'
          : 'Show the player character resting safely after a difficult challenge, looking tired and disappointed while the peaceful world waits for another try.';
  return [
    playerCraft
      ? 'Use the TOP PANEL as the key-art visual guide and the BOTTOM PANEL as the exact separate player-craft guide. Create a new family-friendly landscape story illustration from the same game.'
      : 'Using the reference key art as the visual guide, create a new family-friendly landscape story illustration from the same game.',
    `Preserve the same adult player character identity, costume, palette, pixel-art technique, and world. ${scene}`,
    wardrobeBrief(canonicalHeroConcept),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `If the vehicle appears, preserve this exact craft identity and never merge it with the pilot: ${clean(playerCraft.visualConcept)}.`
      : '',
    `Use this limited color direction: ${spec.palette.join(', ')}.`,
    'Polished 16-bit console illustration with crisp pixel clusters, readable silhouettes, and the main subject away from the extreme edges.',
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
  const sheetPoses = mockFighterPoseSheetPoses(prompt);
  if (sheetPoses) return mockGeneratedFighterPoseSheet(sheetPoses);
  // A 256px fixture is plenty for deterministic pipeline coverage and keeps
  // mock photo-fighter generation fast. Silhouette helpers use a 512px design
  // grid so their coordinates stay easy to reason about.
  const platformerBackdrop = prompt.includes('panoramic BACKGROUND PLATE');
  const width = platformerBackdrop ? 512 : 256;
  const height = 256;
  const greenScreen = prompt.includes('#00ff00');
  const fighter = greenScreen && prompt.includes('fighting-game sprite');
  const platformer = greenScreen && prompt.includes('platform-game sprite');
  const hshooterCraft = greenScreen && prompt.includes('horizontal-shooter player craft');
  const head = greenScreen && prompt.includes('HEAD sprite');
  let hash = 2166136261;
  for (const char of prompt) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const subject =
        greenScreen &&
        (hshooterCraft
          ? mockHShooterCraftSubject(x * 2, y * 2)
          : fighter || platformer
            ? mockFighterSubject(x * 2, y * 2, prompt)
            : head
              ? mockHeadSubject(x * 2, y * 2, prompt)
              : x >= 90 && x < 166 && y >= 27 && y < 235);
      if (greenScreen && !subject) {
        raw[offset] = 0;
        raw[offset + 1] = 255;
        raw[offset + 2] = 0;
      } else {
        const red = (48 + (hash & 127) + Math.floor((x / width) * 45)) % 256;
        const green = (36 + ((hash >>> 8) & 127) + Math.floor((y / height) * 35)) % 256;
        const blue = (72 + ((hash >>> 16) & 127)) % 256;
        // Green-screen fixtures must honor the same no-green subject contract
        // as the live prompt or spill cleanup can correctly mistake the mock
        // costume for its background. Swap the dominant channels while keeping
        // deterministic prompt-derived colors and pose silhouettes.
        const greenDominant = greenScreen && green > red * 1.15 && green > blue * 1.15;
        raw[offset] = greenDominant ? green : red;
        raw[offset + 1] = greenDominant ? red : green;
        raw[offset + 2] = blue;
      }
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function mockHShooterCraftSubject(x: number, y: number): boolean {
  const hull =
    x >= 78 &&
    x <= 432 &&
    y >= 190 &&
    y <= 322 &&
    Math.abs(y - 256) <= 66 - Math.max(0, x - 330) * 0.36;
  const upperFin = x >= 132 && x <= 260 && y >= 142 && y <= 208 && y >= 208 - (x - 132) * 0.52;
  const lowerFin = x >= 132 && x <= 260 && y >= 304 && y <= 370 && y <= 304 + (x - 132) * 0.52;
  const engine = x >= 52 && x <= 116 && y >= 212 && y <= 300;
  return hull || upperFin || lowerFin || engine;
}

const MOCK_FIGHTER_POSE_HINTS: Record<FighterPose, string> = {
  idle: 'neutral ready fighting stance',
  walk: 'mid-stride',
  crouch: 'low stationary crouching',
  jump: 'airborne fighting pose',
  punchHigh: 'high straight punch',
  punchLow: 'low body punch',
  kickHigh: 'high side kick',
  kickLow: 'low sweeping kick',
  airPunch: 'airborne fighting pose high straight punch',
  airKick: 'airborne fighting pose high side kick',
  block: 'defensive guard',
  hit: 'hurt recoil',
  ko: 'non-violent post-match defeat pose',
};

function mockFighterPoseSheetPoses(prompt: string): FighterPose[] | null {
  const match = /FIGHTER POSE SHEET CONTRACT: [a-z-]+ \[([^\]]+)\]/.exec(prompt);
  if (!match) return null;
  const valid = new Set<string>(FIGHTER_POSES);
  const poses = match[1]!.split(',').map((pose) => pose.trim());
  return poses.length === 6 && poses.every((pose) => valid.has(pose))
    ? (poses as FighterPose[])
    : null;
}

/** Deterministic six-cell fixture for the sheet-mode lab and mock pipeline. */
export async function mockGeneratedFighterPoseSheet(
  poses: readonly FighterPose[],
): Promise<Buffer> {
  if (poses.length !== 6) throw new RangeError('mock fighter pose sheet requires six poses');
  const cells = await Promise.all(
    poses.map(async (pose, index): Promise<sharp.OverlayOptions> => {
      const rect = fighterPoseSheetCellRect(index);
      const image = await mockGeneratedImage(
        `One fighting-game sprite on #00ff00. ${MOCK_FIGHTER_POSE_HINTS[pose]}.`,
      );
      const input = await sharp(image)
        .resize(rect.width, rect.height, {
          fit: 'contain',
          kernel: sharp.kernel.nearest,
          background: { r: 0, g: 255, b: 0, alpha: 1 },
        })
        .png()
        .toBuffer();
      return { input, left: rect.left, top: rect.top };
    }),
  );
  return sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
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
  if (
    prompt.includes('knocked-out pose') ||
    prompt.includes('non-violent post-match defeat pose')
  ) {
    return (
      circle(x, y, 126, 365, 34) ||
      thickSegment(x, y, 155, 366, 330, 366, 35) ||
      thickSegment(x, y, 225, 360, 350, 312, 17) ||
      thickSegment(x, y, 300, 370, 410, 410, 20) ||
      thickSegment(x, y, 300, 372, 405, 365, 20)
    );
  }

  const airborne =
    prompt.includes('airborne fighting pose') || prompt.includes('airborne platforming pose');
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
  } else if (prompt.includes('PASSING/COMPRESSION')) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 232, 444, 22) ||
      thickSegment(x, y, 272, hipY - 4, 315, 350, 22) ||
      thickSegment(x, y, 315, 350, 280, 402, 20);
  } else if (
    prompt.includes('run-cycle PHASE A') ||
    prompt.includes('left foot reaching forward') ||
    prompt.includes('extended running CONTACT')
  ) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 145, 446, 22) ||
      thickSegment(x, y, 272, hipY - 4, 335, 355, 22) ||
      thickSegment(x, y, 335, 355, 390, 420, 20);
  } else if (
    prompt.includes('run-cycle PHASE B') ||
    prompt.includes('right foot reaching forward')
  ) {
    legs =
      thickSegment(x, y, 228, hipY - 4, 175, 355, 22) ||
      thickSegment(x, y, 175, 355, 120, 420, 20) ||
      thickSegment(x, y, 272, hipY - 4, 410, 446, 22);
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
