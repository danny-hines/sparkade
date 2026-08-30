import sharp from 'sharp';
import {
  FIGHTER_POSE_SHEET_SIZE,
  fighterPoseSheetCellRect,
  segmentGeneratedFighterPoseSheet,
  type FighterPoseSheetCellRect,
  type FighterPoseSheetSegmentationMetrics,
} from './fighter-pose-sheet';
import {
  GENERATED_ADVENTURE_PLAYER_POSES,
  processGeneratedAdventurePlayerPose,
  type GeneratedAdventurePlayerPose,
} from './adventure-player';

export const ADVENTURE_PLAYER_SHEET_PROMPT_VERSION = 'adventure-player-sheet-v2';
export const ADVENTURE_PLAYER_SHEET_CANDIDATES = ['A', 'B'] as const;
export type AdventurePlayerSheetCandidate = (typeof ADVENTURE_PLAYER_SHEET_CANDIDATES)[number];

export interface AdventurePlayerSheetCellResult {
  id: string;
  sheet: AdventurePlayerSheetCandidate;
  pose: GeneratedAdventurePlayerPose;
  rect: FighterPoseSheetCellRect;
  raw: Buffer;
  processed?: Buffer;
  segmentation: FighterPoseSheetSegmentationMetrics;
  error?: string;
}

interface AdventurePlayerSheetPromptOptions {
  heroConcept?: string;
  colors?: string;
}

const POSE_CONTRACT: Record<GeneratedAdventurePlayerPose, string> = {
  downIdle:
    'DOWN-facing top-down three-quarter neutral idle, both feet planted, arms relaxed, face and head accessories readable',
  downWalk:
    'DOWN-facing walking contact pose toward the bottom edge, one foot clearly advanced with natural opposite arm swing',
  upIdle:
    'UP-facing true back-view neutral idle, both feet planted, correct rear hair, headwear, eyewear arms, collar, and costume back, with no face on the back of the head',
  upWalk:
    'UP-facing true back-view walking contact pose toward the top edge, one foot clearly advanced with natural opposite arm swing and no face on the back of the head',
  sideIdle:
    'RIGHT-facing top-down three-quarter side idle, both feet planted, exact matching face profile, hair, eyewear, headwear, and costume',
  sideWalk:
    'RIGHT-facing top-down three-quarter walking contact pose toward the right edge, clear stride and natural opposite arm swing',
};

function clean(value: string | undefined, max = 500): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

/** Repeat the selected gameplay identity into the exact geometry Muse edits.
 * Every requested view therefore receives direct identity, wardrobe, scale,
 * pixel-technique, and ground-line evidence rather than relying on prose. */
export async function buildAdventurePlayerSheetSeed(downIdle: Buffer): Promise<Buffer> {
  const first = fighterPoseSheetCellRect(0);
  const insetX = 28;
  const insetY = 42;
  const identity = await sharp(downIdle)
    .resize(first.width - insetX * 2, first.height - insetY * 2, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
    })
    .png()
    .toBuffer();
  const overlays = GENERATED_ADVENTURE_PLAYER_POSES.map((_, index): sharp.OverlayOptions => {
    const rect = fighterPoseSheetCellRect(index);
    return { input: identity, left: rect.left + insetX, top: rect.top + insetY };
  });
  return sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

export function buildAdventurePlayerSheetPrompt(
  candidate: AdventurePlayerSheetCandidate,
  options: AdventurePlayerSheetPromptOptions = {},
): string {
  const wardrobe = clean(options.heroConcept);
  const colors = clean(options.colors);
  const cells = GENERATED_ADVENTURE_PLAYER_POSES.map(
    (pose, index) =>
      `Cell ${index + 1} (row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}) — ${pose}: ${POSE_CONTRACT[pose]}.`,
  ).join(' ');
  return [
    `ADVENTURE PLAYER POSE SHEET CONTRACT: ${candidate} [${GENERATED_ADVENTURE_PLAYER_POSES.join(',')}].`,
    `Edit the attached fixed 3-column by 2-row board into exactly SIX isolated full-body top-down adventure-game sprites of the same adult hero, sheet candidate ${candidate}.`,
    'The board already repeats the exact selected gameplay hero once in every cell. It is immutable identity, head-accessory, wardrobe, body-proportion, pixel-technique, scale, and ground-line truth. Preserve the same apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, glasses, headwear, every visible head accessory, costume, footwear, and body-worn detail in all six cells. Never invent an absent accessory and never remove or replace one that is present.',
    wardrobe
      ? `Canonical game-world wardrobe shared by every cell: ${wardrobe}. The source-photo clothing is not identity and must not replace this outfit.`
      : '',
    colors ? `Limited costume color direction shared by every cell: ${colors}.` : '',
    `Use this exact row-major order and do not swap, omit, duplicate, or merge poses. ${cells}`,
    'Change only facing and locomotion. Keep the same camera pitch, character scale, foot ground line, silhouette proportions, costume construction, and crisp pixel density across the sheet. Both hands must remain empty because the engine adds weapons and items separately.',
    'Every pose needs the same clean darkest outer contour around the complete head-to-foot silhouette and readable separations between limbs and torso. Preserve the anchor character’s internal identity detail while ensuring no body edge dissolves into a light, dark, noisy, or similarly colored floor.',
    'Keep one and only one complete uncropped character inside each cell with generous green clearance on every edge. No body part may cross into another cell.',
    'Every background pixel, gutter, and gap enclosed by the body must remain perfectly flat solid #00ff00. Do not draw grid lines, borders, labels, text, letters, numbers, UI, scenery, floors, shadows, effects, props, weapons, tools, bags, or extra characters.',
    'Polished high-density 16-bit SNES-era top-down adventure sprite art with crisp square pixel clusters, hard edges, limited flat colors, and readable identity and costume landmarks. No blur, antialiasing, gradients, photorealism, smooth vector art, 3D rendering, or style changes between cells.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Component-aware six-cell extraction followed by Adventure's native
 * 112x128 keying, quantization, and foot anchoring for each cell. */
export async function splitGeneratedAdventurePlayerSheet(
  image: Buffer,
  sheet: AdventurePlayerSheetCandidate,
): Promise<AdventurePlayerSheetCellResult[]> {
  const segmented = await segmentGeneratedFighterPoseSheet(image);
  return Promise.all(
    GENERATED_ADVENTURE_PLAYER_POSES.map(
      async (pose, index): Promise<AdventurePlayerSheetCellResult> => {
        const cell = segmented[index]!;
        const id = `${pose}-${sheet}`;
        if (cell.error) return { id, sheet, pose, ...cell };
        try {
          return {
            id,
            sheet,
            pose,
            ...cell,
            processed: await processGeneratedAdventurePlayerPose(cell.raw),
          };
        } catch (error) {
          return {
            id,
            sheet,
            pose,
            ...cell,
            error:
              error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
          };
        }
      },
    ),
  );
}
