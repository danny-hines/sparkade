import sharp from 'sharp';
import type { AdventureCombatKit } from '@sparkade/shared';
import { prepareGeneratedPlatformerReference } from './platformer-pose';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';
import type { PlatformerIdleCandidateDescriptor } from './platformer-idle-judge';

export const GENERATED_ADVENTURE_PLAYER_POSES = [
  'downIdle',
  'downWalk',
  'upIdle',
  'upWalk',
  'sideIdle',
  'sideWalk',
  'downMelee',
  'upMelee',
  'sideMelee',
  'downSecondary',
  'upSecondary',
  'sideSecondary',
] as const;
export type GeneratedAdventurePlayerPose = (typeof GENERATED_ADVENTURE_PLAYER_POSES)[number];

export const ADVENTURE_PLAYER_POSE_WIDTH = 112;
export const ADVENTURE_PLAYER_POSE_HEIGHT = 128;
export const ADVENTURE_PLAYER_POSE_PROMPT_VERSION = 'adventure-player-pose-v5';
export const ADVENTURE_PLAYER_PIPELINE_PROMPT_VERSION = 'adventure-player-pipeline-v6';

// Adventure equipment and side-facing actions legitimately make a silhouette
// wider than a platformer runner. Keep a useful mechanical floor, then restore
// the common character height without allowing a long rod, whip, bow, or gun
// to shrink the entire hero into a miniature.
const ADVENTURE_MIN_NORMALIZABLE_POSE_HEIGHT = 64;
const ADVENTURE_TARGET_POSE_HEIGHT = 112;

interface AdventurePlayerPromptOptions {
  heroConcept?: string;
  colors?: string;
  combatKit?: AdventureCombatKit;
}

interface AdventurePlayerIdentityPromptOptions extends AdventurePlayerPromptOptions {
  hasPhoto: boolean;
  retryGuidance?: string;
}

const POSE_DIRECTIONS: Record<Exclude<GeneratedAdventurePlayerPose, 'downIdle'>, string> = {
  downWalk:
    'a DOWN-facing top-down three-quarter walking contact frame, stepping toward the bottom edge with one foot clearly advanced; the free arm swings naturally while the primary-equipment arm remains low and passive',
  upIdle:
    'a neutral UP-facing back view, turned directly away toward the top edge with both feet planted; preserve the correct rear silhouette of the hair, headwear, eyewear temple arms when visible, collar, clothing, and body-worn accessories, with no face painted onto the back of the head',
  upWalk:
    'an UP-facing back-view walking contact frame, stepping toward the top edge with one foot clearly advanced; the free arm swings naturally while the primary-equipment arm remains low and passive; preserve the exact rear camera angle and head silhouette from the reference',
  sideIdle:
    'a neutral RIGHT-facing top-down three-quarter side view with both feet planted, upright posture, relaxed low hands, and a readable profile of the same face, hair, eyewear, and headwear',
  sideWalk:
    'a RIGHT-facing top-down three-quarter walking contact frame with a clear stride toward the right edge; the free arm swings naturally while the primary-equipment arm remains low and passive; preserve the exact side camera angle and head profile from the reference',
  downMelee:
    'a DOWN-facing top-down three-quarter primary-melee CONTACT frame aimed toward the bottom edge, with planted readable feet, a committed arm action, and the named primary attack visibly at full useful extension',
  upMelee:
    'an UP-facing true back-view primary-melee CONTACT frame aimed toward the top edge, with planted readable feet, correct rear identity, and the named primary attack visibly at full useful extension',
  sideMelee:
    'a RIGHT-facing top-down three-quarter primary-melee CONTACT frame aimed toward the right edge, with planted readable feet, an unmistakable profile action, and the named primary attack visibly at full useful extension',
  downSecondary:
    'a DOWN-facing top-down three-quarter secondary-use RELEASE frame aimed toward the bottom edge, clearly operating, firing, throwing, or placing the named secondary item without drawing an already-launched projectile or effect',
  upSecondary:
    'an UP-facing true back-view secondary-use RELEASE frame aimed toward the top edge, preserving correct rear identity while clearly operating, firing, throwing, or placing the named secondary item without a launched projectile or effect',
  sideSecondary:
    'a RIGHT-facing top-down three-quarter secondary-use RELEASE frame aimed toward the right edge, clearly operating, firing, throwing, or placing the named secondary item without drawing an already-launched projectile or effect',
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

function equipmentContract(
  pose: GeneratedAdventurePlayerPose,
  options: AdventurePlayerPromptOptions,
): string {
  const kit = options.combatKit;
  if (!kit) return 'Keep both hands empty and do not add a weapon or held prop.';
  const primary = kit.primary;
  const secondary = kit.secondary;
  const handedness =
    "CANONICAL HANDEDNESS: the hero is right-handed. Keep the primary's main grip in the hero's anatomical RIGHT hand in every movement and melee pose. In a DOWN/front view that hand appears on the viewer's LEFT; in an UP/back view it appears on the viewer's RIGHT; in the generated RIGHT-facing side view it is the near/lower arm. Preserve the anatomical hand rather than keeping the equipment on one screen side. Never swap the primary into the anatomical left hand, move it onto the back or shoulder, hang it from the belt, or change its stow location between directions.";
  if (pose.endsWith('Melee')) {
    return primary.unarmed
      ? `Primary melee contract: ${primary.name}, ${primary.visualConcept}. This is explicitly unarmed: show the hands and body performing the ${primary.profile} contact action with no invented weapon.`
      : `Primary melee contract: ${primary.name}, ${primary.visualConcept}. ${handedness} Show this exact ${primary.profile} equipment at the contact moment with the anatomical RIGHT hand as the main grip; the anatomical left hand may assist when the equipment clearly requires two hands, but it must never become the main grip. Never substitute a generic sword, knife, or fantasy weapon.`;
  }
  if (pose.endsWith('Secondary')) {
    return primary.unarmed
      ? `Secondary-use contract: ${secondary.name}, ${secondary.visualConcept}. Because the hero has no held primary, operate this exact ${secondary.behavior} item with the anatomical RIGHT hand at its release moment. Do not substitute generic gear and do not draw the launched projectile, explosion, trail, or effect.`
      : `Secondary-use contract: ${secondary.name}, ${secondary.visualConcept}. ${handedness} Operate this exact ${secondary.behavior} item with the anatomical LEFT hand at its release moment while the exact primary remains visibly low and passive in the anatomical RIGHT hand. Do not omit, sling, sheath, or move the primary to the back to make room for the secondary. Do not substitute generic gear and do not draw the launched projectile, explosion, trail, or effect.`;
  }
  return primary.unarmed
    ? `Default-ready contract: ${primary.name}, ${primary.visualConcept}. Because unarmed=true, keep both hands visibly empty in a relaxed but capable ready pose; never invent a held weapon.`
    : `Default-ready contract: visibly carry ${primary.name}, ${primary.visualConcept}, LOW AND PASSIVE BESIDE THE BODY. ${handedness} Keep the anatomical RIGHT grip hand at hip or thigh height, the anatomical left hand relaxed and free, both hands and elbows below the shoulders, and the equipment close to the right-hand outer side of the silhouette with its active end pointed down or resting toward the ground. A naturally long staff, bow, or tool may extend above the shoulder only along the OUTSIDE of the body; it must never be centered above the head. Idle and walk are non-attacking states: never raise the equipment overhead, brandish it across the chest, extend it toward the facing direction, aim it at a target, or pose as if winding up or making contact. Preserve this exact equipment identity, construction, grip, and carry location in every idle and walk pose; never replace it with a generic sword.`;
}

function spriteConstraints(): string[] {
  return [
    'Show exactly one complete full-body adult character, from the top of hair or headwear through both hands and both feet. Nothing may be cropped.',
    'Polished high-density 16-bit SNES-era top-down adventure-game sprite art authored for a native 112x128 canvas: crisp square pixel clusters, hard edges, limited flat colors, readable facial and costume landmarks, and no antialiasing, blur, gradients, photorealism, smooth vector art, or 3D rendering.',
    'Build a clean, strongly readable outer silhouette with a consistent darkest contour color around the head, shoulders, torso, arms, and legs. Preserve small identity details inside that contour, but do not let skin, hair, or wardrobe edges dissolve into a busy light, dark, or similarly colored floor.',
    'Keep the character centered, consistently proportioned, and foot-anchored on the same ground line. Required held equipment is part of the character silhouette and must remain fully inside the canvas.',
    'This is one sprite in one pose, not a sprite sheet, turnaround, sequence, collage, portrait, character-select card, or story illustration.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, extra unrequested object, or second character. Draw only the equipment explicitly required for this pose.',
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
    equipmentContract('downIdle', options),
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
    'The attached sprite is immutable identity, wardrobe, primary-equipment, proportion, pixel-technique, and scale truth. Preserve the same apparent adult age, face/head shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, visible head accessories, costume, footwear, body-worn accessories, and body proportions. Change only the requested facing and action state.',
    ...wardrobeAndColor(options),
    `Pose and camera: ${POSE_DIRECTIONS[pose]}.`,
    equipmentContract(pose, options),
    ...spriteConstraints(),
  ].join(' ');
}

export function buildAdventurePlayerIdentityJudgePrompt(
  candidates: readonly PlatformerIdleCandidateDescriptor[],
  heroConcept?: string,
  combatKit?: AdventureCombatKit,
  sourceKind: 'photo' | 'key-art' = 'photo',
): { system: string; user: string } {
  const ids = candidates.map(({ id }) => id).join(', ');
  const sourceName = sourceKind === 'key-art' ? 'SOURCE KEY ART' : 'SOURCE PHOTO';
  const wardrobe = clean(heroConcept);
  const primary = combatKit
    ? combatKit.primary.unarmed
      ? `${combatKit.primary.name}: ${combatKit.primary.visualConcept}; explicitly unarmed, so hands must be empty.`
      : `${combatKit.primary.name}: ${combatKit.primary.visualConcept}; it must be visibly held at rest and must not be replaced by a generic sword.`
    : '';
  return {
    system: [
      'You are the exacting identity art director for a premium SNES-style top-down adventure game.',
      `Inspect the attached identity-foundation review board. ${sourceName} is the canonical identity truth. Compare every candidate directly with it. The canonical game-world wardrobe in the user message is authoritative from the neck down.`,
      'Identity includes apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, and visible head accessories. Inventing or removing glasses, hats, hair, facial hair, or another head accessory is fatal. Becoming bald, childlike, generically younger, or a different person is fatal.',
      'Costume must realize the supplied wardrobe with consistent garments, materials, colors, footwear, silhouette, and body-worn details.',
      'A usable foundation shows exactly one complete uncropped adult, a neutral DOWN-facing top-down three-quarter idle, the exact primary-equipment state required by the combat kit, coherent anatomy, a clear ground line, readable native-scale pixel technique, and no extra props, text, scenery, or severe artifacts.',
      'For an armed hero, the down-idle foundation must carry the primary low and passive beside the hip or thigh with relaxed shoulders and low elbows. A weapon held overhead, centered above the head, across the chest, extended toward an opponent, aimed, wound up, or otherwise attack-like is a fatal pose and equipment error.',
      "The hero is canonically right-handed. In this DOWN/front foundation, the anatomical RIGHT hand appears on the viewer's LEFT. The exact primary must be held there, never in the anatomical left hand and never on the back, shoulder, or belt. A hand swap or alternate stow location is a fatal equipment error.",
      'Gameplay readability is part of technical quality. The complete head-to-foot silhouette and major limb separations must remain immediately legible over light, dark, and noisy floor art; weak or broken outer contour separation is not acceptable.',
      'Score every category from 0 to 5. Select the strongest candidate only if it has no fatal issue, eyewearMatch=true, and every score is at least 4. Otherwise reject the batch and give concrete retry guidance. Return only the requested JSON object.',
    ].join(' '),
    user: [
      `Review Adventure player candidates ${ids}. Compare every RAW and PROCESSED character directly with ${sourceName}, then select the safest shared identity foundation or reject the batch.`,
      wardrobe
        ? `CANONICAL GAME-WORLD WARDROBE: ${wardrobe}`
        : 'No separate wardrobe brief was supplied; require one coherent game-world costume.',
      primary ? `IMMUTABLE PRIMARY EQUIPMENT: ${primary}` : '',
    ]
      .filter(Boolean)
      .join(' '),
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

/** Give the compact dialogue portrait the same selected hero used by key art,
 * story scenes, and gameplay. The photo remains neck-up identity truth while
 * the other panels lock adult proportions, wardrobe, and pixel technique. */
export async function buildAdventurePortraitIdentityReference(
  photo: Buffer,
  keyArt: Buffer,
  downIdle: Buffer,
): Promise<Buffer> {
  const photoPanel = await sharp(photo)
    .resize(440, 440, { fit: 'contain', background: '#10131f' })
    .png()
    .toBuffer();
  const keyArtPanel = await sharp(keyArt)
    .resize(480, 300, { fit: 'contain', background: '#10131f' })
    .png()
    .toBuffer();
  const heroPanel = await sharp(downIdle)
    .resize(300, 340, { fit: 'contain', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const labels = Buffer.from(
    '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><text x="250" y="38" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="22" font-weight="bold">TOP LEFT · PHOTO · HEAD IDENTITY</text><text x="752" y="38" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="22" font-weight="bold">TOP RIGHT · KEY ART · PORTRAIT STYLE</text><text x="512" y="650" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="22" font-weight="bold">BOTTOM · SELECTED GAMEPLAY HERO · WARDROBE + PROPORTIONS</text></svg>',
  );
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#10131f' } })
    .composite([
      { input: photoPanel, left: 30, top: 55 },
      { input: keyArtPanel, left: 512, top: 120 },
      { input: heroPanel, left: 362, top: 670 },
      { input: labels, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

export const prepareGeneratedAdventurePlayerReference = prepareGeneratedPlatformerReference;

export async function processGeneratedAdventurePlayerPose(image: Buffer): Promise<Buffer> {
  const processed = await processGeneratedFighterPose(image, {
    width: ADVENTURE_PLAYER_POSE_WIDTH,
    height: ADVENTURE_PLAYER_POSE_HEIGHT,
    padding: 6,
    bottomPadding: 0,
    removeGreenSpill: true,
    colors: 32,
  });
  await assertNoAdventurePoseBackdrop(processed.png);
  if (processed.metrics.outputBounds.height < ADVENTURE_MIN_NORMALIZABLE_POSE_HEIGHT) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated Adventure pose is too wide to preserve player scale (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return normalizeAdventurePoseHeight(processed);
}

/** A failed green-screen edit can leave one opaque rectangular panel behind
 * the hero. Generic component checks mistake that panel for the subject and
 * shrink the actual character to fit it. A real articulated sprite does not
 * occupy both full horizontal edges of its own alpha bounds. */
async function assertNoAdventurePoseBackdrop(png: Buffer): Promise<void> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  if (maxX < minX || maxY < minY) return;
  const width = maxX - minX + 1;
  const edgeCoverage = (y: number): number => {
    let opaque = 0;
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * info.width + x) * 4 + 3]! > 8) opaque++;
    }
    return opaque / width;
  };
  if (edgeCoverage(minY) >= 0.8 && edgeCoverage(maxY) >= 0.8) {
    throw new FighterPoseImageError(
      'residual-background',
      'generated Adventure pose contains an opaque rectangular background panel',
    );
  }
}

async function normalizeAdventurePoseHeight(processed: ProcessedFighterPose): Promise<Buffer> {
  const bounds = processed.metrics.outputBounds;
  if (bounds.height >= ADVENTURE_TARGET_POSE_HEIGHT) return processed.png;

  const targetBounds = {
    ...bounds,
    top: ADVENTURE_PLAYER_POSE_HEIGHT - ADVENTURE_TARGET_POSE_HEIGHT,
    height: ADVENTURE_TARGET_POSE_HEIGHT,
  };
  return sharp(processed.png)
    .extract(bounds)
    .resize(bounds.width, targetBounds.height, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .extend({
      left: targetBounds.left,
      right: ADVENTURE_PLAYER_POSE_WIDTH - targetBounds.left - targetBounds.width,
      top: targetBounds.top,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      palette: true,
      colours: 32,
      dither: 0,
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toBuffer();
}

/** Every direction is atomic and must retain a common scale and ground line. */
export async function validateGeneratedAdventurePlayerPoseSet(
  poses: Readonly<Record<GeneratedAdventurePlayerPose, Buffer>>,
): Promise<void> {
  const bounds = await Promise.all(
    GENERATED_ADVENTURE_PLAYER_POSES.map(async (pose) => {
      await assertNoAdventurePoseBackdrop(poses[pose]);
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
    throw new Error('generated Adventure player poses change character height');
  }
}
