import sharp from 'sharp';
import { FIGHTER_POSES, type FighterPose, type GameSpec } from '@sparkade/shared';
import { fighterArtDirectionPrompt } from './fighter-art-direction';
import {
  ADVENTURE_ENEMY_BOARD_SIZE,
  GENERATED_ADVENTURE_ENEMIES,
  adventureEnemyBoardCellRect,
} from './adventure-enemy';
import {
  ADVENTURE_OBJECT_BOARD_SIZE,
  GENERATED_ADVENTURE_OBJECTS,
  adventureObjectCellRect,
} from './adventure-object';
import {
  GENERATED_HSHOOTER_ENEMIES,
  HSHOOTER_ENEMY_BOARD_SIZE,
  hshooterEnemyBoardCellRect,
} from './hshooter-enemy';
import { GENERATED_SHOOTER_ENEMIES, SHOOTER_ENEMY_BOARD_SIZE } from './shooter-enemy';
import { FIGHTER_POSE_SHEET_SIZE, fighterPoseSheetCellRect } from './fighter-pose-sheet';

export const KEY_ART_PROMPT_VERSION = 'key-art-v5';
export const STORY_ART_PROMPT_VERSION = 'story-scenes-v3';
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

function adventureCombatKitBrief(spec: GameSpec): string {
  if (spec.archetype !== 'adventure') return '';
  const primary = spec.combatKit.primary;
  const secondary = spec.combatKit.secondary;
  return [
    primary.unarmed
      ? `The hero's primary melee is unarmed ${clean(primary.name)} using the ${primary.profile} profile: ${clean(primary.visualConcept)}. Default ready poses show no held weapon.`
      : `The hero visibly carries their primary melee equipment in default ready poses: ${clean(primary.name)}, ${clean(primary.visualConcept)}. Its engine profile is ${primary.profile}.`,
    `Their collectible secondary is ${clean(secondary.name)}, ${clean(secondary.visualConcept)}, using the ${secondary.behavior} behavior. Preserve these exact equipment identities whenever they appear.`,
  ].join(' ');
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
    adventureCombatKitBrief(spec),
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
        ? 'The BOTTOM PANEL is the presentation-scale identity reference for the player craft. Preserve its signature silhouette, canopy, fins, engines, materials, colors, and markings, but RE-RENDER the vehicle naturally inside the scene at a physically plausible scale, perspective, and lighting. Do not paste, trace, enlarge, or copy the isolated reference pixels or its strict side-profile pose. The pilot and craft are separate identities: never put the pilot face, head, or body onto the vehicle.'
        : 'The reference image is the presentation-scale identity reference for the player craft. Preserve its signature silhouette, canopy, fins, engines, materials, colors, and markings, but RE-RENDER the vehicle naturally inside the scene at a physically plausible scale, perspective, and lighting. Do not paste, trace, enlarge, or copy the isolated reference pixels or its strict side-profile pose. Never give the vehicle a human face, head, or body.'
      : '',
    spec.archetype === 'adventure'
      ? spec.combatKit.primary.unarmed
        ? 'Show the hero in a clearly readable unarmed ready stance with both hands visible and no invented weapon.'
        : `Make the hero's ${clean(spec.combatKit.primary.name)} clearly visible in their hand as part of the central silhouette; do not substitute a generic sword.`
      : '',
    hasPlayerPhoto
      ? 'Keep the exact same neck-up identity while making the canonical outfit clearly readable in its silhouette, collar, torso, sleeves, legs, and footwear.'
      : '',
    playerCraft
      ? 'Compose one dramatic landscape key-art image that clearly shows the player pilot, their recognizable signature craft, the game world, and the main villain in the distance.'
      : 'Compose one dramatic landscape key-art image that clearly shows the player hero, the game world, and the main villain in the distance.',
    'Polished 16-bit console-game illustration: deliberate pixel clusters, crisp silhouettes, expressive characters, rich environmental detail, and cohesive limited colors. It should feel like premium SNES-era box art rendered by a master pixel artist.',
    'Landscape composition designed to survive a wide banner presentation. Keep every complete face, head, hairstyle, headwear, and essential action inside the middle 60% of the image height; reserve the outer 20% at both the top and bottom for expendable scenery only. Keep the player as the clear central focal point. No UI, screenshot frame, arcade cabinet, text, letters, title, logo, caption, watermark, signature, border, photorealism, blur, or 3D render.',
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
    adventureCombatKitBrief(spec),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `Preserve the separate player vehicle identity shown in the ${hasPlayerPhoto ? 'BOTTOM PANEL' : 'reference image'}: ${clean(playerCraft.visualConcept)}. Re-render it as an integrated part of the scene at natural scale, perspective, and lighting; never paste or enlarge the isolated reference. Never merge the person and vehicle identities.`
      : '',
    `Create polished landscape key art for a colorful ${spec.archetype} game world using this limited palette: ${spec.palette.join(', ')}.`,
    'Use a calm, adventurous composition with the player character as the central focal point. Keep every complete face, head, hairstyle, and headwear inside the middle 60% of the image height; reserve the outer 20% at both the top and bottom for expendable scenery only.',
    'Premium 16-bit console illustration with crisp pixel clusters, clear silhouettes, and rich environmental detail.',
    'No text, letters, title, logo, caption, UI, watermark, signature, border, photorealism, blur, or 3D render.',
  ].join(' ');
}

export function buildStoryArtPrompt(
  spec: GameSpec,
  role: StoryArtRole,
  heroConcept?: string,
  playerCraft?: PlayerCraftArtBrief,
  gameplayHeroReference = false,
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
    gameplayHeroReference
      ? 'The TOP PANEL of the reference board is the immutable key-art world and story bible. The BOTTOM PANEL is the exact selected gameplay hero: use it as head identity, head accessories, and neck-down wardrobe truth. Create a new landscape story illustration from the same game. Preserve the same person and outfit at story-art scale; never invent or remove glasses, headwear, hair, facial hair, or another head accessory. Do not copy the panel layout or dark reference background.'
      : playerCraft
        ? 'The TOP PANEL of the reference board is the immutable key-art visual bible and the BOTTOM PANEL is a presentation-scale identity reference for the player craft. Create a new landscape story illustration from the same game; do not copy the panel layout or isolated craft presentation.'
        : 'Using the reference key art as the immutable visual bible, create a new landscape story illustration from the same game.',
    `Preserve the exact same player hero identity, costume, villain design, palette, pixel-art technique, and world. ${beat}.`,
    wardrobeBrief(canonicalHeroConcept),
    adventureCombatKitBrief(spec),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `Whenever the player vehicle is visible, preserve the BOTTOM PANEL's separate craft identity: ${clean(playerCraft.visualConcept)}. RE-RENDER it naturally at the scene's scale, perspective, pose, and lighting. Do not paste, trace, enlarge, or copy the isolated reference pixels. Never place the pilot's face or body onto the craft.`
      : '',
    spec.archetype === 'adventure'
      ? role === 'intro'
        ? `The hero has not collected ${clean(spec.combatKit.secondary.name)} yet; show only the canonical primary equipment and do not place the secondary in the scene.`
        : `The hero may use the canonical ${clean(spec.combatKit.primary.name)} and ${clean(spec.combatKit.secondary.name)} appropriate to this story beat; never replace them with generic fantasy gear.`
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
  gameplayHeroReference = false,
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
    gameplayHeroReference
      ? 'Use the TOP PANEL as the key-art world guide and the BOTTOM PANEL as the exact selected gameplay hero identity and wardrobe guide. Preserve its head identity, glasses, headwear, hair, facial hair, other head accessories, and neck-down wardrobe without additions or removals. Create a new family-friendly landscape story illustration from the same game without copying the reference-board layout.'
      : playerCraft
        ? 'Use the TOP PANEL as the key-art visual guide and the BOTTOM PANEL as a separate presentation-scale player-craft identity guide. Create a new family-friendly landscape story illustration from the same game without copying the panel layout or isolated craft presentation.'
        : 'Using the reference key art as the visual guide, create a new family-friendly landscape story illustration from the same game.',
    `Preserve the same adult player character identity, costume, palette, pixel-art technique, and world. ${scene}`,
    wardrobeBrief(canonicalHeroConcept),
    adventureCombatKitBrief(spec),
    spec.archetype === 'fighter'
      ? `Immutable Fighter art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`
      : '',
    playerCraft
      ? `If the vehicle appears, preserve this craft identity and never merge it with the pilot: ${clean(playerCraft.visualConcept)}. Re-render it as part of the scene at natural scale, perspective, and lighting; never paste or enlarge the isolated reference.`
      : '',
    spec.archetype === 'adventure'
      ? role === 'intro'
        ? `Show the canonical primary ${clean(spec.combatKit.primary.name)} only; the secondary has not been collected.`
        : `Preserve the canonical primary and secondary equipment identities if visible.`
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
  if (prompt.includes('ADVENTURE THEMED OBJECT BOARD CONTRACT')) {
    return mockGeneratedAdventureObjectBoard();
  }
  if (prompt.includes('VERTICAL-SHOOTER ENEMY CAST BOARD CONTRACT')) {
    return mockGeneratedShooterEnemyBoard();
  }
  if (prompt.includes('H-SCROLL ENEMY CAST BOARD CONTRACT')) {
    return mockGeneratedHShooterEnemyBoard();
  }
  if (prompt.includes('ADVENTURE ENEMY CAST BOARD CONTRACT')) {
    return mockGeneratedAdventureEnemyBoard();
  }
  if (prompt.includes('ADVENTURE BOSS CANDIDATE BOARD CONTRACT')) {
    return mockGeneratedAdventureBossBoard();
  }
  const adventureSheetPoses = mockAdventurePlayerSheetPoses(prompt);
  if (adventureSheetPoses) return mockGeneratedAdventurePlayerSheet(adventureSheetPoses);
  const sheetPoses = mockFighterPoseSheetPoses(prompt);
  if (sheetPoses) return mockGeneratedFighterPoseSheet(sheetPoses);
  // A 256px fixture is plenty for deterministic pipeline coverage and keeps
  // mock photo-fighter generation fast. Silhouette helpers use a 512px design
  // grid so their coordinates stay easy to reason about.
  const wideEnvironment =
    prompt.includes('panoramic BACKGROUND PLATE') || prompt.includes('ROOM-SURFACE ATLAS');
  const verticalEnvironment = prompt.includes('portrait BACKGROUND FLYOVER PLATE');
  const width = wideEnvironment ? 512 : 256;
  const height = verticalEnvironment ? 512 : 256;
  const greenScreen = prompt.includes('#00ff00');
  const fighter = greenScreen && prompt.includes('fighting-game sprite');
  const platformer = greenScreen && prompt.includes('platform-game sprite');
  const adventurePlayer = greenScreen && prompt.includes('adventure-game sprite');
  const hshooterCraft = greenScreen && prompt.includes('horizontal-shooter player craft');
  const hshooterBoss = greenScreen && prompt.includes('horizontal-shooter MAIN BOSS');
  const hshooterEnemy = greenScreen && prompt.includes('horizontal-shooter enemy');
  const shooterCraft = greenScreen && prompt.includes('vertical-shooter player craft');
  const shooterBoss = greenScreen && prompt.includes('vertical-shooter MAIN BOSS');
  const shooterEnemy = greenScreen && prompt.includes('top-down enemy gameplay sprite');
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
          : hshooterBoss
            ? mockHShooterBossSubject(x * 2, y * 2)
            : hshooterEnemy
              ? mockHShooterEnemySubject(x * 2, y * 2, prompt)
              : shooterCraft
                ? mockShooterCraftSubject(x * 2, y * 2)
                : shooterBoss
                  ? mockShooterBossSubject(x * 2, y * 2)
                  : shooterEnemy
                    ? mockShooterEnemySubject(x * 2, y * 2, prompt)
                    : fighter || platformer || adventurePlayer
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

async function mockGeneratedAdventureObjectBoard(): Promise<Buffer> {
  const cells = await Promise.all(
    GENERATED_ADVENTURE_OBJECTS.flatMap((role) =>
      [0, 1].map(async (candidateIndex): Promise<sharp.OverlayOptions> => {
        const index = GENERATED_ADVENTURE_OBJECTS.indexOf(role) * 2 + candidateIndex;
        const rect = adventureObjectCellRect(index);
        const image = await mockGeneratedImage(
          `One isolated top-down adventure-game sprite on #00ff00. ${role} candidate ${candidateIndex + 1}.`,
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
    ),
  );
  return sharp({
    create: {
      width: ADVENTURE_OBJECT_BOARD_SIZE,
      height: ADVENTURE_OBJECT_BOARD_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

async function mockGeneratedAdventureEnemyBoard(): Promise<Buffer> {
  const cells = await Promise.all(
    GENERATED_ADVENTURE_ENEMIES.flatMap((role) =>
      [0, 1].map(async (candidateIndex): Promise<sharp.OverlayOptions> => {
        const index = GENERATED_ADVENTURE_ENEMIES.indexOf(role) * 2 + candidateIndex;
        const rect = adventureEnemyBoardCellRect(index);
        const image = await mockGeneratedImage(
          `One isolated top-down adventure-game sprite on #00ff00. ${role} enemy candidate ${candidateIndex + 1}.`,
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
    ),
  );
  return sharp({
    create: {
      width: ADVENTURE_ENEMY_BOARD_SIZE,
      height: ADVENTURE_ENEMY_BOARD_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

async function mockGeneratedHShooterEnemyBoard(): Promise<Buffer> {
  const cells = await Promise.all(
    GENERATED_HSHOOTER_ENEMIES.flatMap((role) =>
      [0, 1].map(async (candidateIndex): Promise<sharp.OverlayOptions> => {
        const index = GENERATED_HSHOOTER_ENEMIES.indexOf(role) * 2 + candidateIndex;
        const rect = hshooterEnemyBoardCellRect(index);
        const image = await mockGeneratedImage(
          `One isolated horizontal-shooter enemy sprite on #00ff00. ${role} candidate ${candidateIndex + 1}.`,
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
    ),
  );
  return sharp({
    create: {
      width: HSHOOTER_ENEMY_BOARD_SIZE,
      height: HSHOOTER_ENEMY_BOARD_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

async function mockGeneratedShooterEnemyBoard(): Promise<Buffer> {
  const cells = await Promise.all(
    GENERATED_SHOOTER_ENEMIES.flatMap((role) =>
      [0, 1].map(async (candidateIndex): Promise<sharp.OverlayOptions> => {
        const index = GENERATED_SHOOTER_ENEMIES.indexOf(role) * 2 + candidateIndex;
        const rect = hshooterEnemyBoardCellRect(index);
        const image = await mockGeneratedImage(
          `One isolated top-down enemy gameplay sprite on #00ff00. ${role} candidate ${candidateIndex + 1}.`,
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
    ),
  );
  return sharp({
    create: {
      width: SHOOTER_ENEMY_BOARD_SIZE,
      height: SHOOTER_ENEMY_BOARD_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

async function mockGeneratedAdventureBossBoard(): Promise<Buffer> {
  const cells = await Promise.all(
    [0, 1, 2, 3].map(async (index): Promise<sharp.OverlayOptions> => {
      const image = await mockGeneratedImage(
        `One isolated top-down adventure-game sprite on #00ff00. Boss candidate ${index + 1}, neutral ready fighting stance.`,
      );
      const input = await sharp(image)
        .resize(512, 512, {
          fit: 'contain',
          kernel: sharp.kernel.nearest,
          background: { r: 0, g: 255, b: 0, alpha: 1 },
        })
        .png()
        .toBuffer();
      return { input, left: (index % 2) * 512, top: Math.floor(index / 2) * 512 };
    }),
  );
  return sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

const MOCK_ADVENTURE_PLAYER_POSES = [
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
type MockAdventurePlayerPose = (typeof MOCK_ADVENTURE_PLAYER_POSES)[number];

function mockAdventurePlayerSheetPoses(prompt: string): MockAdventurePlayerPose[] | null {
  const match = /ADVENTURE PLAYER POSE SHEET CONTRACT: [a-z-]+ \[([^\]]+)\]/.exec(prompt);
  if (!match) return null;
  const valid = new Set<string>(MOCK_ADVENTURE_PLAYER_POSES);
  const poses = match[1]!.split(',').map((pose) => pose.trim());
  return poses.length === 6 && poses.every((pose) => valid.has(pose))
    ? (poses as MockAdventurePlayerPose[])
    : null;
}

async function mockGeneratedAdventurePlayerSheet(
  poses: readonly MockAdventurePlayerPose[],
): Promise<Buffer> {
  const cells = await Promise.all(
    poses.map(async (pose, index): Promise<sharp.OverlayOptions> => {
      const rect = fighterPoseSheetCellRect(index);
      const action = pose.includes('Walk')
        ? 'mid-stride walking contact pose'
        : pose.includes('Melee')
          ? 'high straight punch contact pose'
          : pose.includes('Secondary')
            ? 'defensive guard release pose'
            : 'neutral idle pose';
      const image = await mockGeneratedImage(
        `One top-down adventure-game sprite on #00ff00. ${action}.`,
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

function mockHShooterBossSubject(x: number, y: number): boolean {
  const armoredHull =
    x >= 58 &&
    x <= 454 &&
    y >= 150 &&
    y <= 362 &&
    Math.abs(y - 256) <= 106 - Math.max(0, x - 330) * 0.55;
  const upperCrown = x >= 235 && x <= 395 && y >= 88 && y <= 175 && y >= 175 - (x - 235) * 0.55;
  const lowerFin = x >= 170 && x <= 345 && y >= 337 && y <= 418 && y <= 337 + (x - 170) * 0.46;
  const rearEngine = x >= 395 && x <= 478 && y >= 196 && y <= 316;
  const forwardJaw = x >= 34 && x <= 104 && y >= 215 && y <= 302;
  return armoredHull || upperCrown || lowerFin || rearEngine || forwardJaw;
}

function mockHShooterEnemySubject(x: number, y: number, prompt: string): boolean {
  const tank = prompt.includes('tank');
  const turret = prompt.includes('turret');
  const kamikaze = prompt.includes('kamikaze');
  const halfHeight = tank ? 76 : turret ? 64 : kamikaze ? 42 : 52;
  const left = tank ? 72 : 102;
  const right = tank ? 446 : kamikaze ? 432 : 410;
  const body =
    x >= left && x <= right && Math.abs(y - 256) <= halfHeight - Math.max(0, left + 46 - x) * 0.18;
  const rearFin = x >= right - 72 && x <= right + 24 && y >= 186 && y <= 326;
  const forwardPoint = x >= left - 34 && x <= left + 34 && Math.abs(y - 256) <= 34;
  const turretBase = turret && x >= 190 && x <= 356 && y >= 310 && y <= 346;
  const barrel = turret && x >= 42 && x <= 210 && y >= 237 && y <= 275;
  return body || rearFin || forwardPoint || turretBase || barrel;
}

function mockShooterCraftSubject(x: number, y: number): boolean {
  return mockHShooterCraftSubject(y, 512 - x);
}

function mockShooterBossSubject(x: number, y: number): boolean {
  return mockHShooterBossSubject(512 - y, x);
}

function mockShooterEnemySubject(x: number, y: number, prompt: string): boolean {
  return mockHShooterEnemySubject(512 - y, x, prompt);
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
