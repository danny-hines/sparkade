import sharp from 'sharp';
import {
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
} from './platformer-pose';
import type { PlatformerIdleCandidateDescriptor } from './platformer-idle-judge';

export const GENERATED_ADVENTURE_PLAYER_POSES = [
  'downIdle',
  'downWalk',
  'upIdle',
  'upWalk',
  'sideIdle',
  'sideWalk',
] as const;
export type GeneratedAdventurePlayerPose = (typeof GENERATED_ADVENTURE_PLAYER_POSES)[number];

export const ADVENTURE_PLAYER_POSE_WIDTH = 112;
export const ADVENTURE_PLAYER_POSE_HEIGHT = 128;
export const ADVENTURE_PLAYER_POSE_PROMPT_VERSION = 'adventure-player-pose-v2';
export const ADVENTURE_PLAYER_PIPELINE_PROMPT_VERSION = 'adventure-player-pipeline-v3';

interface AdventurePlayerPromptOptions {
  heroConcept?: string;
  colors?: string;
}

interface AdventurePlayerIdentityPromptOptions extends AdventurePlayerPromptOptions {
  hasPhoto: boolean;
  retryGuidance?: string;
}

const POSE_DIRECTIONS: Record<Exclude<GeneratedAdventurePlayerPose, 'downIdle'>, string> = {
  downWalk:
    'a DOWN-facing top-down three-quarter walking contact frame, stepping toward the bottom edge with one foot clearly advanced and the opposite arm swinging naturally',
  upIdle:
    'a neutral UP-facing back view, turned directly away toward the top edge with both feet planted; preserve the correct rear silhouette of the hair, headwear, eyewear temple arms when visible, collar, clothing, and body-worn accessories, with no face painted onto the back of the head',
  upWalk:
    'an UP-facing back-view walking contact frame, stepping toward the top edge with one foot clearly advanced and a natural opposite arm swing; preserve the exact rear camera angle and head silhouette from the reference',
  sideIdle:
    'a neutral RIGHT-facing top-down three-quarter side view with both feet planted, upright posture, empty relaxed hands, and a readable profile of the same face, hair, eyewear, and headwear',
  sideWalk:
    'a RIGHT-facing top-down three-quarter walking contact frame with a clear stride toward the right edge and natural opposite arm swing; preserve the exact side camera angle and head profile from the reference',
};

function clean(value: string | undefined, max = 500): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function wardrobeAndColor(options: AdventurePlayerPromptOptions): string[] {
  const heroConcept = clean(options.heroConcept);
  const colors = clean(options.colors);
  return [
    heroConcept
      ? `Canonical game-world wardrobe contract: ${heroConcept}. Reproduce these garments, materials, colors, footwear, and body-worn costume details from the neck down. The source photo clothing is not identity and must not replace this outfit.`
      : '',
    colors ? `Limited costume color direction: ${colors}.` : '',
  ].filter(Boolean);
}

function spriteConstraints(): string[] {
  return [
    'Show exactly one complete full-body adult character, from the top of hair or headwear through both hands and both feet. Nothing may be cropped.',
    'Polished high-density 16-bit SNES-era top-down adventure-game sprite art authored for a native 112x128 canvas: crisp square pixel clusters, hard edges, limited flat colors, readable facial and costume landmarks, and no antialiasing, blur, gradients, photorealism, smooth vector art, or 3D rendering.',
    'Build a clean, strongly readable outer silhouette with a consistent darkest contour color around the head, shoulders, torso, arms, and legs. Preserve small identity details inside that contour, but do not let skin, hair, or wardrobe edges dissolve into a busy light, dark, or similarly colored floor.',
    'Keep the character centered, consistently proportioned, and foot-anchored on the same ground line. Both hands must be empty; the engine adds the sword and items separately.',
    'This is one sprite in one pose, not a sprite sheet, turnaround, sequence, collage, portrait, character-select card, or story illustration.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, weapon, shield, tool, bag, held prop, extra object, or second character.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap around the arms and legs. Do not use #00ff00 or a near-neon imitation in the character.',
  ];
}

export function buildAdventurePlayerIdentityPrompt(
  candidateId: string,
  options: AdventurePlayerIdentityPromptOptions,
): string {
  const retryGuidance = clean(options.retryGuidance);
  return [
    'Create exactly ONE isolated full-body player sprite for a top-down adventure game.',
    options.hasPhoto
      ? "The TOP PANEL of the attached reference board is the exact player's photo and immutable identity truth from the neck up. Preserve their recognizable adult face and head shape, skin tone, hairline, hair texture and style, facial hair, glasses, headwear, and every visible head accessory. Never invent an absent accessory and never remove or replace one that is present. The BOTTOM PANEL is the game's key art and establishes the canonical game-world wardrobe, materials, palette, and character styling."
      : "The attached key art is the immutable visual identity and costume reference for the game's player hero. Preserve that exact character rather than inventing a replacement.",
    ...wardrobeAndColor(options),
    'Pose and camera: neutral DOWN-facing idle in a classic top-down three-quarter adventure view, facing toward the bottom edge and slightly toward the camera. Both feet are planted, posture is ready but relaxed, face and head accessories are clearly readable, and arms rest naturally at the sides.',
    `Generate independent identity-foundation candidate ${candidateId} for evaluation. Do not render the candidate label.`,
    'The face must remain recognizably the same adult. Do not make the person bald, childlike, generically younger, differently proportioned, or more stylized than needed for the requested pixel-art treatment.',
    ...spriteConstraints(),
    retryGuidance
      ? `RETRY CORRECTION FROM THE ART DIRECTOR: ${retryGuidance}. Apply only this correction while preserving identity, accessories, wardrobe, camera, proportions, and pose.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildAdventurePlayerPosePrompt(
  pose: Exclude<GeneratedAdventurePlayerPose, 'downIdle'>,
  options: AdventurePlayerPromptOptions = {},
): string {
  return [
    'Create exactly ONE isolated full-body top-down adventure-game sprite of the exact character in the attached gameplay reference.',
    'The attached sprite is immutable identity, wardrobe, proportion, pixel-technique, and scale truth. Preserve the same apparent adult age, face/head shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, visible head accessories, costume, footwear, body-worn accessories, and body proportions. Change only the requested facing and walking pose.',
    ...wardrobeAndColor(options),
    `Pose and camera: ${POSE_DIRECTIONS[pose]}.`,
    ...spriteConstraints(),
  ].join(' ');
}

export function buildAdventurePlayerIdentityJudgePrompt(
  candidates: readonly PlatformerIdleCandidateDescriptor[],
  heroConcept?: string,
): { system: string; user: string } {
  const ids = candidates.map(({ id }) => id).join(', ');
  const wardrobe = clean(heroConcept);
  return {
    system: [
      'You are the exacting identity art director for a premium SNES-style top-down adventure game.',
      'Inspect the attached identity-foundation review board. SOURCE PHOTO is the only identity truth from the neck up; its clothing below the neck is not identity. Compare every candidate directly with that photo. The canonical game-world wardrobe in the user message is authoritative from the neck down.',
      'Identity includes apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, and visible head accessories. Inventing or removing glasses, hats, hair, facial hair, or another head accessory is fatal. Becoming bald, childlike, generically younger, or a different person is fatal.',
      'Costume must realize the supplied wardrobe with consistent garments, materials, colors, footwear, silhouette, and body-worn details. Copying the source-photo clothing is a costume failure.',
      'A usable foundation shows exactly one complete uncropped adult, a neutral DOWN-facing top-down three-quarter idle, empty hands, coherent anatomy, a clear ground line, readable native-scale pixel technique, and no props, text, scenery, or severe artifacts.',
      'Gameplay readability is part of technical quality. The complete head-to-foot silhouette and major limb separations must remain immediately legible over light, dark, and noisy floor art; weak or broken outer contour separation is not acceptable.',
      'Score every category from 0 to 5. Select the strongest candidate only if it has no fatal issue, eyewearMatch=true, and every score is at least 4. Otherwise reject the batch and give concrete retry guidance. Return only the requested JSON object.',
    ].join(' '),
    user: [
      `Review Adventure player candidates ${ids}. Compare every RAW and PROCESSED head directly with SOURCE PHOTO, then select the safest shared identity foundation or reject the batch.`,
      wardrobe
        ? `CANONICAL GAME-WORLD WARDROBE: ${wardrobe}`
        : 'No separate wardrobe brief was supplied; require one coherent game-world costume.',
    ].join(' '),
  };
}

/** Build the one-image identity board accepted by Muse's edit endpoint. */
export async function buildAdventurePlayerIdentityReference(
  keyArt: Buffer,
  photo?: Buffer,
): Promise<Buffer> {
  if (!photo) {
    return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#10131f' } })
      .composite([
        {
          input: await sharp(keyArt)
            .resize(960, 540, { fit: 'contain', background: '#10131f' })
            .png()
            .toBuffer(),
          left: 32,
          top: 242,
        },
      ])
      .png()
      .toBuffer();
  }

  const photoPanel = await sharp(photo)
    .resize(430, 430, { fit: 'contain', background: '#10131f' })
    .png()
    .toBuffer();
  const keyArtPanel = await sharp(keyArt)
    .resize(960, 540, { fit: 'contain', background: '#10131f' })
    .png()
    .toBuffer();
  const labels = Buffer.from(
    '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><text x="512" y="38" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="24" font-weight="bold">TOP · PLAYER PHOTO · HEAD IDENTITY TRUTH</text><text x="512" y="495" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="24" font-weight="bold">BOTTOM · KEY ART · WARDROBE + WORLD STYLE</text></svg>',
  );
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#10131f' } })
    .composite([
      { input: photoPanel, left: 297, top: 52 },
      { input: keyArtPanel, left: 32, top: 504 },
      { input: labels, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Give Adventure story scenes both the key-art world and the exact selected
 * gameplay identity/costume foundation without exposing green-screen pixels. */
export async function buildAdventureStoryIdentityReference(
  keyArt: Buffer,
  downIdle: Buffer,
): Promise<Buffer> {
  const keyArtPanel = await sharp(keyArt)
    .resize(960, 540, { fit: 'contain', background: '#10131f' })
    .png()
    .toBuffer();
  const heroPanel = await sharp(downIdle)
    .resize(280, 320, { fit: 'contain', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const labels = Buffer.from(
    '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><text x="512" y="38" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="24" font-weight="bold">TOP · KEY ART · WORLD + STORY IDENTITY</text><text x="512" y="666" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="24" font-weight="bold">BOTTOM · EXACT GAMEPLAY HERO IDENTITY + WARDROBE</text></svg>',
  );
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#10131f' } })
    .composite([
      { input: keyArtPanel, left: 32, top: 58 },
      { input: heroPanel, left: 372, top: 686 },
      { input: labels, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

export const prepareGeneratedAdventurePlayerReference = prepareGeneratedPlatformerReference;

export async function processGeneratedAdventurePlayerPose(image: Buffer): Promise<Buffer> {
  return (await processGeneratedPlatformerPose(image)).png;
}

/** Every direction is atomic and must retain a common scale and ground line. */
export async function validateGeneratedAdventurePlayerPoseSet(
  poses: Readonly<Record<GeneratedAdventurePlayerPose, Buffer>>,
): Promise<void> {
  const bounds = await Promise.all(
    GENERATED_ADVENTURE_PLAYER_POSES.map(async (pose) => {
      const { data, info } = await sharp(poses[pose])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        info.width !== ADVENTURE_PLAYER_POSE_WIDTH ||
        info.height !== ADVENTURE_PLAYER_POSE_HEIGHT
      ) {
        throw new Error(
          `generated Adventure ${pose} pose has an unexpected ${info.width}x${info.height} canvas`,
        );
      }
      let minX = info.width;
      let minY = info.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3]! <= 8) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxY !== info.height - 1 || maxX < minX) {
        throw new Error(`generated Adventure ${pose} pose is empty or not foot-anchored`);
      }
      return { pose, width: maxX - minX + 1, height: maxY - minY + 1 };
    }),
  );
  const heights = bounds.map(({ height }) => height);
  if (Math.max(...heights) - Math.min(...heights) > 10) {
    throw new Error('generated Adventure player directions change character height');
  }
}
