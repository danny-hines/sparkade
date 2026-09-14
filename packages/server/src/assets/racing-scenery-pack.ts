import sharp from 'sharp';
import { RACING_SCENERY_SLOTS, type RacingSpec } from '@sparkade/shared';
import { FighterPoseImageError, processGeneratedFighterPose } from './fighter-pose';
import { GameAssetWorkspace, imagePromptHash } from './manifest';

export const RACING_SCENERY_OBJECTS_VERSION = 'racing-scenery-objects-v1';
const PRIVATE_ROLES = [
  'racingLandmarkFar',
  'racingLandmarkNear',
  'racingDressingA',
  'racingDressingB',
  'racingDressingC',
  'racingBoostObject',
] as const;

/** Each image owns one semantic slot; atlas layout is deterministic local work. */
export function racingSceneryObjectPrompts(spec: RacingSpec): string[] {
  const identity = spec.identity!;
  const subjects = [
    'a tall iconic landmark of this world, viewed from trackside',
    'a broad landmark with a different silhouette from the tall landmark, viewed from trackside',
    'a small upright roadside object characteristic of this world',
    'a small low, broad roadside object characteristic of this world',
    'a small sculptural roadside object characteristic of this world',
    identity.boost.mode === 'pickups'
      ? `one bankable boost collectible called ${identity.boost.displayName}: ${identity.boost.appearanceConcept}`
      : identity.boost.mode === 'pads'
        ? 'one flat decorative boost-pad chevron plate lying on the road surface'
        : 'a third landmark of this world, neither a collectible nor a boost object',
  ];
  return subjects.map((subject, index) =>
    [
      `Create exactly ONE isolated racing scenery object. Slot ${index + 1}: ${subject}.`,
      `World identity: ${identity.worldConcept}. Art direction: ${identity.artDirection}. Palette: ${spec.palette.join(', ')}.`,
      'The reference supplies only the world style. Paint only the requested object, without vehicles, people, roads or background scenery.',
      'Complete, centered silhouette with at least 15% empty margin on every side. One object only, no sheet, grid, collage, labels, letters, logo, frame or shadow.',
      'Crisp 16-bit pixel art, readable silhouette and flat color ramps. Background and all empty gaps must be perfectly flat #00ff00. No neon green on the object.',
    ].join(' '),
  );
}

export async function normalizeRacingSceneryObject(raw: Buffer): Promise<Buffer> {
  const meta = await sharp(raw).metadata();
  const result = await processGeneratedFighterPose(raw, {
    width: 96,
    height: 96,
    padding: 6,
    bottomPadding: 6,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 40,
    minSubjectFraction: 0.015,
    maxSubjectFraction: 0.85,
    minSubjectSpanFraction: 0.1,
  });
  const b = result.metrics.sourceBounds;
  if (
    b.left <= 1 ||
    b.top <= 1 ||
    b.left + b.width >= (meta.width ?? 0) - 1 ||
    b.top + b.height >= (meta.height ?? 0) - 1
  )
    throw new FighterPoseImageError(
      'invalid-image',
      'racing scenery object is cropped at the image edge',
    );
  return result.png;
}

export async function generateRacingSceneryPack(options: {
  spec: RacingSpec;
  workspace: GameAssetWorkspace;
  reference: Buffer;
  generate(prompt: string, slot: number): Promise<Buffer>;
  checkActive(): void;
  validationFailure(role: string): void;
}): Promise<Buffer> {
  const { workspace, reference } = options;
  const prompts = racingSceneryObjectPrompts(options.spec);
  const hash = imagePromptHash(JSON.stringify(prompts), reference);
  const cached = workspace.load('racingSceneryAtlas', RACING_SCENERY_OBJECTS_VERSION, hash);
  if (cached) return cached;
  // Drain failures before reporting them: no generation remains in flight on retry.
  const outcomes = await Promise.allSettled(
    prompts.map(async (prompt, index) => {
      const role = PRIVATE_ROLES[index]!;
      const slotHash = imagePromptHash(prompt, reference);
      const restored = workspace.loadPrivate(role, RACING_SCENERY_OBJECTS_VERSION, slotHash);
      if (restored) return restored;
      for (let attempt = 0; attempt < 2; attempt++) {
        options.checkActive();
        const raw = await options.generate(
          prompt +
            (attempt
              ? ' CORRECTION: one complete object only, generous empty green margins on all four sides.'
              : ''),
          index,
        );
        let cell: Buffer;
        try {
          cell = await normalizeRacingSceneryObject(raw);
        } catch (error) {
          options.checkActive();
          options.validationFailure(role);
          if (attempt === 1) throw error;
          continue;
        }
        await workspace.storePrivate(role, cell, RACING_SCENERY_OBJECTS_VERSION, slotHash);
        return cell;
      }
      throw new Error(`Missing scenery object ${role}`);
    }),
  );
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason;
  }
  const cells = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<Buffer>).value);
  const atlas = await sharp({
    create: { width: 288, height: 192, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(
      RACING_SCENERY_SLOTS.map((_, index) => ({
        input: cells[index]!,
        left: (index % 3) * 96,
        top: Math.floor(index / 3) * 96,
      })),
    )
    .png({ palette: true, colours: 256, dither: 0 })
    .toBuffer();
  await workspace.store('racingSceneryAtlas', atlas, RACING_SCENERY_OBJECTS_VERSION, hash);
  return atlas;
}
