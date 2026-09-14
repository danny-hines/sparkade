// Racing generated-art pack plan: pure prompt/data flow for the pipeline
// stage, plus the compact roster judge. No I/O here; the runner drives
// cachedGeneratedAsset/callImage and the validators from the M2 builders.
import sharp from 'sharp';
import {
  RACING_CRAFT_ROLES,
  RACING_PANORAMA_ROLES,
  type GeneratedGameAssetRole,
  type RacingCraftRole,
  type RacingPanoramaRole,
  type RacingSpec,
} from '@sparkade/shared';
import {
  RACING_CRAFT_STRIP_PROMPT_VERSION,
  RACING_JETSKI_STRIP_PROMPT_VERSION,
  buildRacingCraftStripPrompt,
  type RacingStripDiscipline,
} from './racing-craft';
import {
  RACING_JETSKI_PANORAMA_PROMPT_VERSION,
  RACING_PANORAMA_PROMPT_VERSION,
  buildRacingPanoramaPrompt,
} from './racing-scenery';
import {
  RACING_JETSKI_MATERIAL_TILES_VERSION,
  RACING_MATERIALS_PROMPT_VERSION,
  buildRacingMaterialsPrompt,
  racingJetskiMaterialTilePrompts,
} from './racing-materials';
import {
  RACING_JETSKI_SCENERY_OBJECTS_VERSION,
  RACING_SCENERY_OBJECTS_VERSION,
  racingSceneryObjectPrompts,
} from './racing-scenery-pack';

export const RACING_JUDGE_PROMPT_VERSION = 'racing-roster-judge-v1';
/** Jetski roster-judge fingerprint; hover keeps v1 byte-identical. */
export const RACING_JETSKI_JUDGE_PROMPT_VERSION = 'racing-jetski-judge-v1';

export type RacingPackDiscipline = 'hover' | 'jetski';

/** Discipline for a spec: omitted identity discipline means hover (legacy). */
export function racingPackDiscipline(spec: RacingSpec): RacingPackDiscipline {
  return spec.identity?.discipline === 'jetski' ? 'jetski' : 'hover';
}

/** The ten runtime files in manifest order: 3 panoramas, 5 strips, scenery, materials. */
export const RACING_PACK_REQUIRED_ROLES: readonly GeneratedGameAssetRole[] = [
  ...RACING_PANORAMA_ROLES,
  ...RACING_CRAFT_ROLES,
  'racingSceneryAtlas',
  'racingMaterialAtlas',
] as const;

export interface RacingPackEntry {
  role: GeneratedGameAssetRole;
  promptVersion: string;
  prompt: string;
  label: string;
  /** Image-model size hint; omitted entries use the configured default. */
  size?: string;
  /** Entries generated as edits of the finished key art. */
  reference?: 'keyArt';
}

export interface RacingPackPlan {
  playerStrip: RacingPackEntry;
  rivalStrips: RacingPackEntry[];
  panoramas: RacingPackEntry[];
  /**
   * Compatibility entry for the assembled atlas role (the runner's
   * ten-file check reads only `.role`). The six real prompts live in
   * `sceneryObjects` and match the generator byte-for-byte; this entry
   * carries no independent prompt.
   */
  scenery: RacingPackEntry;
  /** The six individually generated scenery objects, in atlas order. */
  sceneryObjects: RacingPackEntry[];
  materials: RacingPackEntry;
  /**
   * The four independently generated jetski material tiles, in
   * RACING_MATERIAL_SLOTS order. Empty for hover (single-sheet path).
   * The runner's ten-file check reads only `materials.role`; these entries
   * match the generator byte-for-byte like `sceneryObjects`.
   */
  materialTiles: RacingPackEntry[];
}

function colorsOf(spec: RacingSpec): string {
  return spec.palette.join(', ');
}

/**
 * Complete generation plan for an identity-bearing racing spec. Every
 * authored concept lands in exactly one prompt: art direction everywhere,
 * per-slot vehicle concepts in their strips, per-course envConcept in its
 * panorama, world/env/materials in the materials entry, boost identity in
 * the sixth scenery object. Scenery is six individually generated objects
 * (see `generateRacingSceneryPack`), never a sheet; jetski materials are
 * four individually generated tiles (see
 * `generateRacingJetskiMaterialsPack`), never a grid the model must honor.
 * Legacy specs (no identity) never reach this function.
 */
export function buildRacingPackPlan(spec: RacingSpec): RacingPackPlan {
  const identity = spec.identity!;
  const colors = colorsOf(spec);
  const discipline: RacingStripDiscipline =
    identity.discipline === 'jetski' ? 'jetski' : 'hover';
  const stripVersion =
    discipline === 'jetski' ? RACING_JETSKI_STRIP_PROMPT_VERSION : RACING_CRAFT_STRIP_PROMPT_VERSION;
  const panoramaVersion =
    discipline === 'jetski' ? RACING_JETSKI_PANORAMA_PROMPT_VERSION : RACING_PANORAMA_PROMPT_VERSION;
  const sceneryVersion =
    discipline === 'jetski' ? RACING_JETSKI_SCENERY_OBJECTS_VERSION : RACING_SCENERY_OBJECTS_VERSION;
  // Single source of truth shared with the generator: the plan advertises
  // the exact prompts generateRacingSceneryPack will issue — and, for
  // jetski, the exact tile prompts generateRacingJetskiMaterialsPack will
  // issue (the single-sheet prompt cannot be trusted to honor a 2x2 grid).
  const objectPrompts = racingSceneryObjectPrompts(spec);
  const tilePrompts =
    discipline === 'jetski' ? racingJetskiMaterialTilePrompts(spec) : [];
  const materialsVersion =
    discipline === 'jetski' ? RACING_JETSKI_MATERIAL_TILES_VERSION : RACING_MATERIALS_PROMPT_VERSION;
  const craftRole = (index: number): RacingCraftRole => RACING_CRAFT_ROLES[index]!;
  const cameraLock =
    discipline === 'jetski'
      ? ' CAMERA LOCK: all three views show the rider back and the watercraft stern with the jet nozzle facing the viewer, with the bow farthest away. Banking is ROLL of rider and craft together, never yaw to a side view. Cell 2 lowers the screen-left edge and raises the screen-right edge; cell 3 does the exact opposite. Keep the rider, hull length, handlebars and livery unchanged. The two bank poses must tilt in visibly opposite directions.'
      : ' CAMERA LOCK: all three views show the REAR bumper and exhaust facing the viewer, with the nose farthest away. Banking is ROLL, never yaw to a side view. Cell 2 lowers the screen-left edge and raises the screen-right edge; cell 3 does the exact opposite. Keep the canopy, body length, wing count and livery unchanged. The two bank poses must tilt in visibly opposite directions.';
  const stripEntry = (
    role: RacingCraftRole,
    name: string,
    vehicleConcept: string,
    label: string,
  ): RacingPackEntry => ({
    role,
    promptVersion: stripVersion,
    prompt:
      buildRacingCraftStripPrompt({
        name,
        vehicleConcept,
        artDirection: identity.artDirection,
        colors,
        discipline,
      }) + cameraLock,
    label,
    size: '1536x1024',
  });
  return {
    playerStrip: stripEntry(
      craftRole(0),
      identity.pilotName,
      identity.playerCraftConcept,
      'Player vehicle strip',
    ),
    rivalStrips: identity.rivalCrafts.map((rival, k) =>
      stripEntry(craftRole(k + 1), rival.name, rival.vehicleConcept, `Rival ${rival.name} strip`),
    ),
    panoramas: spec.levels.map((level, k): RacingPackEntry => {
      const role: RacingPanoramaRole = RACING_PANORAMA_ROLES[k]!;
      return {
        role,
        promptVersion: panoramaVersion,
        prompt: buildRacingPanoramaPrompt({
          courseName: level.name,
          artDirection: identity.artDirection,
          worldConcept: identity.worldConcept,
          envConcept: level.envConcept ?? `Cup course ${k + 1} in the shared world`,
          colors,
          discipline,
        }),
        label: `${level.name} panorama`,
        size: '1792x1024',
        // A watercourse story image carries foreground docks and buoys;
        // use the authored world/style text for the distant horizon plate.
        ...(discipline === 'jetski' ? {} : { reference: 'keyArt' as const }),
      };
    }),
    scenery: {
      role: 'racingSceneryAtlas',
      promptVersion: sceneryVersion,
      prompt: objectPrompts.join('\n'),
      label: 'Roadside scenery atlas (6 generated objects)',
      size: '1024x1024',
      reference: 'keyArt',
    },
    sceneryObjects: objectPrompts.map((prompt, index): RacingPackEntry => ({
      // Informational role: all six compose the single public atlas.
      role: 'racingSceneryAtlas',
      promptVersion: sceneryVersion,
      prompt,
      label: `Roadside object ${index + 1} of 6`,
      size: '1024x1024',
      reference: 'keyArt',
    })),
    materials:
      discipline === 'jetski'
        ? {
            role: 'racingMaterialAtlas',
            promptVersion: materialsVersion,
            prompt: tilePrompts.join('\n'),
            label: 'Water material atlas (4 generated tiles)',
            size: '1024x1024',
          }
        : {
            role: 'racingMaterialAtlas',
            promptVersion: materialsVersion,
            prompt: buildRacingMaterialsPrompt({
              artDirection: identity.artDirection,
              worldConcept: identity.worldConcept,
              envContext: spec.levels
                .map((level, k) => `course ${k + 1} ${level.name}: ${level.envConcept ?? 'shared world'}`)
                .join('; '),
              materials: spec.levels[0]!.materials ?? {
                road: '#5c5e6e',
                ground: '#2f4a26',
                curb: '#d8d8cc',
                edge: '#35e0ff',
                pad: '#35e0ff',
              },
              boostMode: identity.boost.mode,
              colors,
              discipline,
            }),
            label: 'Track material atlas',
            size: '1024x1024',
          },
    materialTiles: tilePrompts.map((prompt, index): RacingPackEntry => ({
      // Informational role: all four compose the single public atlas.
      role: 'racingMaterialAtlas',
      promptVersion: materialsVersion,
      prompt,
      label: `Water material tile ${index + 1} of 4`,
      size: '1024x1024',
    })),
  };
}

/** True when every pack role is advertised available. */
export function isRacingPackComplete(assets: Record<string, boolean>): boolean {
  return RACING_PACK_REQUIRED_ROLES.every((role) => assets[role]);
}

export interface RacingRosterSlotDescriptor {
  id: string;
  name: string;
  vehicleConcept: string;
}

/** Roster slots in pack order for the semantic review. */
export function racingRosterSlots(spec: RacingSpec): RacingRosterSlotDescriptor[] {
  const identity = spec.identity!;
  return [
    { id: 'player', name: identity.pilotName, vehicleConcept: identity.playerCraftConcept },
    ...identity.rivalCrafts.map((rival, k) => ({
      id: `rival${k + 1}`,
      name: rival.name,
      vehicleConcept: rival.vehicleConcept,
    })),
  ];
}

export function buildRacingRosterJudgePrompt(
  slots: readonly RacingRosterSlotDescriptor[],
  references: readonly RacingRosterSlotDescriptor[] = [],
  discipline: RacingPackDiscipline = 'hover',
): {
  system: string;
  user: string;
} {
  const subject =
    discipline === 'jetski' ? 'rear-view jetski (rider plus watercraft) strips' : 'rear-view hovercraft strips';
  const required =
    discipline === 'jetski'
      ? 'Required: true rear camera (behind and slightly above, craft pointing away), the SAME watercraft plus its SAME seated adult rider across neutral-rear, banking-left, and banking-right cells of each row, distinct coherent hulls across rows, readable rear camera, no green panels, no text, no cropping. Every row must show exactly one seated rider astride the hull: a missing rider, a standing or detached rider, or a face pasted into the hull is fatal.'
      : 'Required: true rear camera (behind and slightly above, craft pointing away), the SAME vehicle across neutral-rear, banking-left, and banking-right cells of each row, distinct coherent vehicles across rows, no green panels, no people, no text, no cropping.';
  const fatal =
    discipline === 'jetski'
      ? 'Score concept fidelity, exact rear orientation, same rider-plus-hull coherence, small gameplay readability, and technical pixel-art quality from 1 to 5. A fatal issue is a wrong camera direction, mismatched poses within a row, same-direction banks, duplicated hulls across rows, a missing or doubled rider, a detached rider, a face pasted into the hull, cropped/multiple craft, or broken transparency.'
      : 'Score concept fidelity, exact rear orientation, same-vehicle coherence, small gameplay readability, and technical pixel-art quality from 1 to 5. A fatal issue is a wrong camera direction, mismatched poses within a row, same-direction banks, duplicated vehicles across rows, cropped/multiple craft, a person, or broken transparency.';
  return {
    system:
      'You are Muse Spark, the art director selecting gameplay vehicle art. Judge only the labeled TARGET rows; REFERENCE rows are frozen prior approvals shown for distinctness comparison. Return strict JSON.',
    user: [
      `Review the ${slots.length} TARGET ${subject} in order: ${slots.map((s) => `${s.id} (${s.name})`).join(', ')}.`,
      ...slots.map((s) => `${s.id} concept: ${s.vehicleConcept}.`),
      references.length
        ? `Frozen REFERENCE rows (already approved, never judge, never list in slotReviews or rejectedIds): ${references.map((s) => `${s.id} (${s.name})`).join(', ')}. Compare every target against the references for distinctness — a target duplicating a reference vehicle is fatal.`
        : '',
      required,
      'Banking is opposite ROLL, never yaw and never a mirrored livery: the banking-left cell leans left (left side low, right side high) and the banking-right cell leans right (right side low, left side high). Two banks yawing the same way, yawed side profiles, or mirrored asymmetric markings are fatal.',
      fatal,
      'accepted should be true only when every target row has no fatal issue and is production quality. Even when accepted is false, retryGuidance must describe the single most important correction for the rejected rows.',
      'For EACH target row, set correction to "banking" ONLY when its neutral-rear cell is accepted as the right vehicle, rear camera, and concept and only the bank rolls are wrong; otherwise — bad neutral camera or concept, a duplicate of another vehicle, or any doubt — set "vehicle". Give the per-row fix in guidance.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function buildRacingRosterJudgeSchema(
  slots: readonly RacingRosterSlotDescriptor[],
): Record<string, unknown> {
  const ids = slots.map(({ id }) => id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['slotReviews', 'selection'],
    properties: {
      slotReviews: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'concept',
            'orientation',
            'coherence',
            'readability',
            'technical',
            'fatalIssues',
            'summary',
            'correction',
            'guidance',
          ],
          properties: {
            id: { type: 'string', enum: ids },
            correction: { type: 'string', enum: ['none', 'banking', 'vehicle'] },
            guidance: { type: 'string' },
            concept: { type: 'integer', minimum: 1, maximum: 5 },
            orientation: { type: 'integer', minimum: 1, maximum: 5 },
            coherence: { type: 'integer', minimum: 1, maximum: 5 },
            readability: { type: 'integer', minimum: 1, maximum: 5 },
            technical: { type: 'integer', minimum: 1, maximum: 5 },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['accepted', 'rejectedIds', 'rationale', 'retryGuidance'],
        properties: {
          accepted: { type: 'boolean' },
          rejectedIds: { type: 'array', items: { type: 'string', enum: ids } },
          rationale: { type: 'string' },
          retryGuidance: { type: 'string' },
        },
      },
    },
  };
}

/**
 * Per-slot correction category. `banking` means the neutral-rear cell is
 * accepted (right vehicle, camera, concept) and only the bank rolls are
 * wrong — the only case where the neutral-preserving two-pose edit applies.
 * `vehicle` means anything else (bad neutral camera/concept, duplicates, or
 * any doubt) and takes a full-strip regeneration. `none` marks accepted slots.
 */
export type RacingSlotCorrectionKind = 'none' | 'banking' | 'vehicle';

export interface RacingRosterJudgeDecision {
  accepted: boolean;
  rejectedIds: string[];
  retryGuidance: string;
  /** Correction category for every judged target id. */
  correctionKinds: Record<string, RacingSlotCorrectionKind>;
  /** Per-target fix instruction; empty means use the global retryGuidance. */
  slotGuidance: Record<string, string>;
}

/**
 * Fail-closed normalization of the roster review. Unknown shapes reject.
 * `slots` are the judged TARGET slots only — reference ids are never valid
 * here. A target row carrying fatalIssues contradicts an acceptance, so it
 * fails closed into the rejected set.
 */
export function normalizeRacingRosterJudgeDecision(
  raw: unknown,
  slots: readonly RacingRosterSlotDescriptor[],
): RacingRosterJudgeDecision {
  const ids = new Set(slots.map(({ id }) => id));
  const allVehicle = (): Pick<RacingRosterJudgeDecision, 'correctionKinds' | 'slotGuidance'> => {
    const correctionKinds: Record<string, RacingSlotCorrectionKind> = {};
    const slotGuidance: Record<string, string> = {};
    for (const id of ids) {
      correctionKinds[id] = 'vehicle';
      slotGuidance[id] = '';
    }
    return { correctionKinds, slotGuidance };
  };
  if (typeof raw !== 'object' || raw === null) {
    return {
      accepted: false,
      rejectedIds: [...ids],
      retryGuidance: 'Unparseable roster review.',
      ...allVehicle(),
    };
  }
  const selection = (raw as { selection?: unknown }).selection;
  if (typeof selection !== 'object' || selection === null) {
    return {
      accepted: false,
      rejectedIds: [...ids],
      retryGuidance: 'Roster review has no selection.',
      ...allVehicle(),
    };
  }
  const { accepted, rejectedIds, retryGuidance } = selection as {
    accepted?: unknown;
    rejectedIds?: unknown;
    retryGuidance?: unknown;
  };
  const rejected = new Set<string>();
  if (Array.isArray(rejectedIds)) {
    for (const id of rejectedIds) if (typeof id === 'string' && ids.has(id)) rejected.add(id);
  }
  const reviews = new Map<string, { correction?: unknown; guidance?: unknown }>();
  const reviewsRaw = (raw as { slotReviews?: unknown }).slotReviews;
  if (Array.isArray(reviewsRaw)) {
    for (const review of reviewsRaw) {
      if (typeof review !== 'object' || review === null) continue;
      const { id, correction, guidance, fatalIssues } = review as {
        id?: unknown;
        correction?: unknown;
        guidance?: unknown;
        fatalIssues?: unknown;
      };
      if (typeof id !== 'string' || !ids.has(id) || reviews.has(id)) continue;
      reviews.set(id, { correction, guidance });
      if (Array.isArray(fatalIssues) && fatalIssues.length > 0) rejected.add(id);
    }
  }
  if (accepted !== true && rejected.size === 0) {
    for (const id of ids) rejected.add(id);
  }
  const rejectedList = [...rejected];
  // Per-slot categories: explicit valid values stand; an unclassified
  // rejection safely falls back to a full vehicle regeneration, never to a
  // neutral-preserving bank edit that cannot repair the defect.
  const correctionKinds: Record<string, RacingSlotCorrectionKind> = {};
  const slotGuidance: Record<string, string> = {};
  for (const id of ids) {
    if (!rejected.has(id)) {
      correctionKinds[id] = 'none';
      slotGuidance[id] = '';
      continue;
    }
    const stated = reviews.get(id)?.correction;
    correctionKinds[id] = stated === 'banking' || stated === 'vehicle' ? stated : 'vehicle';
    const guidance = reviews.get(id)?.guidance;
    slotGuidance[id] = typeof guidance === 'string' ? guidance : '';
  }
  return {
    accepted: accepted === true && rejectedList.length === 0,
    rejectedIds:
      accepted === true && rejectedList.length === 0 ? [] : rejectedList.length ? rejectedList : [...ids],
    retryGuidance: typeof retryGuidance === 'string' && retryGuidance ? retryGuidance : '',
    correctionKinds,
    slotGuidance,
  };
}

/** Target ids surviving a review: rejected ids (if any) removed. */
export function acceptedReviewIds(
  targetIds: readonly string[],
  rejectedIds: readonly string[],
): string[] {
  const rejected = new Set(rejectedIds);
  return targetIds.filter((id) => !rejected.has(id));
}

/** Review new candidates against frozen references and checkpoint every approval. */
export async function reviewPendingRacingStrips(options: {
  slots: readonly RacingRosterSlotDescriptor[];
  buffers: readonly Buffer[];
  approvedIds: ReadonlySet<string>;
  review: (
    buffers: Buffer[],
    slots: RacingRosterSlotDescriptor[],
    references: { slot: RacingRosterSlotDescriptor; png: Buffer }[],
  ) => Promise<RacingRosterJudgeDecision>;
  approve: (id: string, png: Buffer) => Promise<void>;
}): Promise<RacingRosterJudgeDecision> {
  const rows = options.slots.map((slot, index) => ({ slot, png: options.buffers[index]! }));
  const targets = rows.filter(({ slot }) => !options.approvedIds.has(slot.id));
  if (!targets.length) {
    return { accepted: true, rejectedIds: [], retryGuidance: '', correctionKinds: {}, slotGuidance: {} };
  }
  const decision = await options.review(
    targets.map(({ png }) => png),
    targets.map(({ slot }) => slot),
    rows.filter(({ slot }) => options.approvedIds.has(slot.id)),
  );
  const accepted = acceptedReviewIds(targets.map(({ slot }) => slot.id), decision.rejectedIds);
  for (const { slot, png } of targets) {
    if (accepted.includes(slot.id)) await options.approve(slot.id, png);
  }
  return decision;
}

/**
 * Labeled strip rows for the semantic review board. Frozen approvals ride
 * along as explicitly labeled reference rows so the judge can compare
 * targets for distinctness without ever judging them.
 */
export async function buildRacingRosterJudgeBoard(
  strips: readonly { id: string; png: Buffer; referenceOnly?: boolean }[],
): Promise<Buffer> {
  const rowWidth = 320;
  const rowHeight = 128;
  const rows = await Promise.all(
    strips.map(async ({ id, png, referenceOnly }, index) => {
      const label = referenceOnly ? `${id} (reference)` : id;
      const strip = await sharp(png)
        .resize(288, 96, {
          fit: 'contain',
          kernel: sharp.kernel.nearest,
          background: { r: 25, g: 31, b: 45, alpha: 1 },
        })
        .extend({
          top: 32,
          bottom: 0,
          left: 16,
          right: 16,
          background: { r: 25, g: 31, b: 45, alpha: 1 },
        })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="32"><rect width="320" height="32" fill="#0d1320"/><text x="160" y="23" text-anchor="middle" font-family="monospace" font-size="20" fill="#ffffff">${label}</text></svg>`,
            ),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
      return { input: strip, left: 0, top: index * rowHeight };
    }),
  );
  return sharp({
    create: {
      width: rowWidth,
      height: Math.max(1, strips.length) * rowHeight,
      channels: 4,
      background: { r: 13, g: 19, b: 32, alpha: 1 },
    },
  })
    .composite(rows)
    .png()
    .toBuffer();
}
