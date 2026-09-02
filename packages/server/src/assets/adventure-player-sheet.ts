import sharp, { type OverlayOptions } from 'sharp';
import type { AdventureCombatKit } from '@sparkade/shared';
import {
  FIGHTER_POSE_SHEET_SIZE,
  fighterPoseSheetCellRect,
  segmentGeneratedFighterPoseSheet,
  type FighterPoseSheetCellRect,
  type FighterPoseSheetSegmentationMetrics,
} from './fighter-pose-sheet';
import {
  processGeneratedAdventurePlayerPose,
  type GeneratedAdventurePlayerPose,
} from './adventure-player';

export const ADVENTURE_PLAYER_SHEET_PROMPT_VERSION = 'adventure-player-sheet-v4';
export const ADVENTURE_PLAYER_SHEET_GROUPS = [
  {
    id: 'movement',
    poses: ['downIdle', 'downWalk', 'upIdle', 'upWalk', 'sideIdle', 'sideWalk'],
  },
  {
    id: 'combat',
    poses: ['downMelee', 'upMelee', 'sideMelee', 'downSecondary', 'upSecondary', 'sideSecondary'],
  },
] as const satisfies readonly {
  id: string;
  poses: readonly [
    GeneratedAdventurePlayerPose,
    GeneratedAdventurePlayerPose,
    GeneratedAdventurePlayerPose,
    GeneratedAdventurePlayerPose,
    GeneratedAdventurePlayerPose,
    GeneratedAdventurePlayerPose,
  ];
}[];
export type AdventurePlayerSheetGroup = (typeof ADVENTURE_PLAYER_SHEET_GROUPS)[number];
export type AdventurePlayerSheetGroupId = AdventurePlayerSheetGroup['id'];

export interface AdventurePlayerSheetCellResult {
  id: string;
  sheet: AdventurePlayerSheetGroupId;
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
  combatKit?: AdventureCombatKit;
}

const POSE_CONTRACT: Record<GeneratedAdventurePlayerPose, string> = {
  downIdle:
    'DOWN-facing top-down three-quarter neutral idle, both feet planted, shoulders and elbows relaxed, primary carried low beside the hip or thigh and never overhead or attack-ready, face and head accessories readable',
  downWalk:
    'DOWN-facing walking contact pose toward the bottom edge, one foot clearly advanced, free arm swinging naturally, and primary carried low and passive beside the body',
  upIdle:
    'UP-facing true back-view neutral idle, both feet planted, primary carried low and passive beside the hip or thigh, correct rear hair, headwear, eyewear arms, collar, and costume back, with no face on the back of the head',
  upWalk:
    'UP-facing true back-view walking contact pose toward the top edge, one foot clearly advanced, free arm swinging naturally, primary carried low beside the body, and no face on the back of the head',
  sideIdle:
    'RIGHT-facing top-down three-quarter side idle, both feet planted, primary carried low and passive beside the hip or thigh, exact matching face profile, hair, eyewear, headwear, and costume',
  sideWalk:
    'RIGHT-facing top-down three-quarter walking contact pose toward the right edge, clear stride, natural free-arm swing, and primary carried low and passive beside the body',
  downMelee:
    'DOWN-facing primary-melee contact frame toward the bottom edge, planted feet and full readable attack extension',
  upMelee:
    'UP-facing true back-view primary-melee contact frame toward the top edge, planted feet, correct rear identity, and no face on the back of the head',
  sideMelee:
    'RIGHT-facing primary-melee contact frame toward the right edge, planted feet and full readable attack extension',
  downSecondary:
    'DOWN-facing secondary-use release frame toward the bottom edge, clearly operating the item without a launched projectile or effect',
  upSecondary:
    'UP-facing true back-view secondary-use release frame toward the top edge, correct rear identity, no face on the back of the head, and no launched projectile or effect',
  sideSecondary:
    'RIGHT-facing secondary-use release frame toward the right edge, clearly operating the item without a launched projectile or effect',
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
  const overlays = Array.from({ length: 6 }, (_, index): OverlayOptions => {
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
  group: AdventurePlayerSheetGroup,
  options: AdventurePlayerSheetPromptOptions = {},
): string {
  const wardrobe = clean(options.heroConcept);
  const colors = clean(options.colors);
  const cells = group.poses
    .map(
      (pose, index) =>
        `Cell ${index + 1} (row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}) — ${pose}: ${POSE_CONTRACT[pose]}.`,
    )
    .join(' ');
  const kit = options.combatKit;
  const equipment = kit
    ? [
        kit.primary.unarmed
          ? `PRIMARY: ${kit.primary.name}; ${kit.primary.visualConcept}; ${kit.primary.profile}; explicitly unarmed, so movement cells keep empty hands and melee cells show an unarmed contact action.`
          : `PRIMARY: ${kit.primary.name}; ${kit.primary.visualConcept}; ${kit.primary.profile}; the hero is canonically right-handed. Every movement and melee cell keeps the primary's main grip in the hero's anatomical RIGHT hand: viewer's LEFT in DOWN/front cells, viewer's RIGHT in UP/back cells, and the near/lower arm in generated RIGHT-facing side cells. Preserve the anatomical hand, not one screen side. Never swap it into the anatomical left hand or move it onto the back, shoulder, or belt. Movement cells carry this exact equipment low and passive beside the hip or thigh, with the anatomical left hand free and both hands and elbows low. A long item may rise along the outside of the body but never above the center of the head. Movement cells never hold it overhead, across the chest, extended, aimed, wound up, or attack-ready. Melee cells alone show it raised or extended at contact; the anatomical left hand may assist only when its construction clearly requires two hands. Never substitute a generic sword.`,
        kit.primary.unarmed
          ? `SECONDARY: ${kit.secondary.name}; ${kit.secondary.visualConcept}; ${kit.secondary.behavior}; secondary cells operate this exact item with the anatomical RIGHT hand at the use/release moment without a launched projectile, explosion, trail, or effect.`
          : `SECONDARY: ${kit.secondary.name}; ${kit.secondary.visualConcept}; ${kit.secondary.behavior}; secondary cells operate this exact item with the anatomical LEFT hand while the exact primary remains visibly low and passive in the anatomical RIGHT hand. Never omit, sling, sheath, or move the primary to the back. Do not draw a launched projectile, explosion, trail, or effect.`,
      ].join(' ')
    : 'No combat-kit brief was supplied; keep hands empty and do not invent equipment.';
  return [
    `ADVENTURE PLAYER POSE SHEET CONTRACT: ${group.id} [${group.poses.join(',')}].`,
    `Edit the attached fixed 3-column by 2-row board into exactly SIX isolated full-body top-down adventure-game sprites of the same adult hero for the ${group.id} sheet.`,
    'The board already repeats the exact selected gameplay hero once in every cell. It is immutable identity, head-accessory, wardrobe, primary-equipment, body-proportion, pixel-technique, scale, and ground-line truth. Preserve the same apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, glasses, headwear, every visible head accessory, costume, footwear, and body-worn detail in all six cells. Never invent an absent accessory and never remove or replace one that is present.',
    wardrobe
      ? `Canonical game-world wardrobe shared by every cell: ${wardrobe}. The source-photo clothing is not identity and must not replace this outfit.`
      : '',
    colors ? `Limited costume color direction shared by every cell: ${colors}.` : '',
    `IMMUTABLE COMBAT-KIT CONTRACT: ${equipment}`,
    `Use this exact row-major order and do not swap, omit, duplicate, or merge poses. ${cells}`,
    'STATE-CONTRAST CONTRACT: idle and walk silhouettes must read as calm locomotion at a glance, with the primary resting low at one side. Only melee cells may raise, brandish, swing, thrust, or extend the primary. An idle or walk cell that resembles a melee wind-up or contact frame is wrong.',
    "EQUIPMENT-CONTINUITY CONTRACT: preserve the primary's exact silhouette, length, active end, handle, palette, anatomical grip hand, and carry location across all six cells. Camera rotation changes where the anatomical RIGHT hand appears on screen; it does not authorize a hand swap or moving the equipment to the hero's back.",
    'Change only facing and the requested locomotion or combat state. Keep the same camera pitch, character scale, foot ground line, silhouette proportions, costume construction, equipment construction, and crisp pixel density across the sheet.',
    'Every pose needs the same clean darkest outer contour around the complete head-to-foot silhouette and readable separations between limbs and torso. Preserve the anchor character’s internal identity detail while ensuring no body edge dissolves into a light, dark, noisy, or similarly colored floor.',
    'Keep one and only one complete uncropped character inside each cell with generous green clearance on every edge. No body part may cross into another cell.',
    'Every background pixel, gutter, and gap enclosed by the body must remain perfectly flat solid #00ff00. Do not draw grid lines, borders, labels, text, letters, numbers, UI, scenery, floors, shadows, effects, bags, extra characters, or any prop beyond the exact combat-kit equipment required in that cell.',
    'Polished high-density 16-bit SNES-era top-down adventure sprite art with crisp square pixel clusters, hard edges, limited flat colors, and readable identity and costume landmarks. No blur, antialiasing, gradients, photorealism, smooth vector art, 3D rendering, or style changes between cells.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Component-aware six-cell extraction followed by Adventure's native
 * 112x128 keying, quantization, and foot anchoring for each cell. */
export async function splitGeneratedAdventurePlayerSheet(
  image: Buffer,
  group: AdventurePlayerSheetGroup,
): Promise<AdventurePlayerSheetCellResult[]> {
  const segmented = await segmentGeneratedFighterPoseSheet(image);
  return Promise.all(
    group.poses.map(async (pose, index): Promise<AdventurePlayerSheetCellResult> => {
      const cell = segmented[index]!;
      const id = `${pose}-${group.id}`;
      if (cell.error) return { id, sheet: group.id, pose, ...cell };
      try {
        return {
          id,
          sheet: group.id,
          pose,
          ...cell,
          processed: await processGeneratedAdventurePlayerPose(cell.raw),
        };
      } catch (error) {
        return {
          id,
          sheet: group.id,
          pose,
          ...cell,
          error: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
        };
      }
    }),
  );
}
