import sharp from 'sharp';
import type { AdventureSecondaryBehavior } from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_ADVENTURE_OBJECTS = ['key', 'item', 'npc', 'secondaryEffect'] as const;
export type GeneratedAdventureObject = (typeof GENERATED_ADVENTURE_OBJECTS)[number];

export const ADVENTURE_OBJECT_ATLAS_ROLE = 'adventureObjectAtlas' as const;
export const ADVENTURE_OBJECT_BOARD_SIZE = 1024;
export const ADVENTURE_OBJECT_BOARD_COLUMNS = 3;
export const ADVENTURE_OBJECT_BOARD_ROWS = 3;
export const GENERATED_ADVENTURE_OBJECT_WIDTH = 96;
export const GENERATED_ADVENTURE_OBJECT_HEIGHT = 112;
export const GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH =
  GENERATED_ADVENTURE_OBJECT_WIDTH * GENERATED_ADVENTURE_OBJECTS.length;
export const ADVENTURE_OBJECT_BOARD_PROMPT_VERSION = 'adventure-object-board-v1';
export const ADVENTURE_OBJECT_JUDGE_PROMPT_VERSION = 'adventure-object-judge-v1';
export const ADVENTURE_OBJECT_PIPELINE_PROMPT_VERSION = 'adventure-object-pipeline-v1';

export interface AdventureObjectPromptOptions {
  gameTitle: string;
  tagline: string;
  keyConcept: string;
  itemName: string;
  itemConcept: string;
  npcConcept: string;
  secondaryBehavior: AdventureSecondaryBehavior;
  colors: string;
}

export interface AdventureObjectCellRect {
  index: number;
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AdventureObjectCandidate {
  id: string;
  role: GeneratedAdventureObject;
  png: Buffer;
  metrics: ProcessedFighterPose['metrics'];
}

export interface AdventureObjectCandidateFailure {
  id: string;
  role: GeneratedAdventureObject;
  reason: string;
}

export interface AdventureObjectCandidateReview {
  id: string;
  role: GeneratedAdventureObject;
  scores: {
    conceptMatch: number;
    worldStyle: number;
    silhouette: number;
    gameplayReadability: number;
    technical: number;
  };
  issues: string[];
  summary: string;
}

export interface AdventureObjectSelection {
  role: GeneratedAdventureObject;
  candidateId: string;
  confidence: number;
  rationale: string;
}

export interface AdventureObjectJudgeDecision {
  candidateReviews: AdventureObjectCandidateReview[];
  selections: AdventureObjectSelection[];
  setSummary: string;
}

function clean(value: string | undefined, max = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function effectConcept(options: AdventureObjectPromptOptions): string {
  switch (options.secondaryBehavior) {
    case 'shot':
      return `the single in-flight projectile or ammunition visibly fired by ${options.itemName}; point it toward the RIGHT, show no launcher, muzzle flash, trail, or impact`;
    case 'returning':
      return `${options.itemName} itself in a clean RIGHT-moving thrown or returning flight state; preserve the item's exact construction and show no hand, trail, or duplicate`;
    case 'blast':
      return `${options.itemName} as one armed, placed charge immediately before detonation; show the intact device with no explosion, fire, smoke, or debris`;
  }
}

function roleConcept(
  role: GeneratedAdventureObject,
  options: AdventureObjectPromptOptions,
): string {
  switch (role) {
    case 'key':
      return `KEY: ${options.keyConcept}. One unmistakable portable gate-opening relic, credential, tool, or device; iconic silhouette, no lock or door.`;
    case 'item':
      return `SECONDARY ITEM PICKUP: ${options.itemName}; ${options.itemConcept}. Show the complete usable item alone in a calm collectible presentation, never in a hand and never activated.`;
    case 'npc':
      return `NPC: ${options.npcConcept}. One complete friendly adult world inhabitant in a neutral grounded front/down-facing top-down three-quarter idle, clearly non-hostile and distinct from the player and enemies.`;
    case 'secondaryEffect':
      return `ACTIVE SECONDARY: ${effectConcept(options)}.`;
  }
}

export function adventureObjectCellRect(index: number): AdventureObjectCellRect {
  if (!Number.isInteger(index) || index < 0 || index >= 9) {
    throw new RangeError('Adventure object board cell index must be between 0 and 8');
  }
  const column = index % ADVENTURE_OBJECT_BOARD_COLUMNS;
  const row = Math.floor(index / ADVENTURE_OBJECT_BOARD_COLUMNS);
  const left = Math.floor((column * ADVENTURE_OBJECT_BOARD_SIZE) / ADVENTURE_OBJECT_BOARD_COLUMNS);
  const right = Math.floor(
    ((column + 1) * ADVENTURE_OBJECT_BOARD_SIZE) / ADVENTURE_OBJECT_BOARD_COLUMNS,
  );
  const top = Math.floor((row * ADVENTURE_OBJECT_BOARD_SIZE) / ADVENTURE_OBJECT_BOARD_ROWS);
  const bottom = Math.floor(
    ((row + 1) * ADVENTURE_OBJECT_BOARD_SIZE) / ADVENTURE_OBJECT_BOARD_ROWS,
  );
  return { index, row, column, left, top, width: right - left, height: bottom - top };
}

export function adventureObjectCandidateId(
  role: GeneratedAdventureObject,
  candidateIndex: number,
): string {
  return `${role}-${candidateIndex + 1}`;
}

export function buildAdventureObjectBoardPrompt(options: AdventureObjectPromptOptions): string {
  const cells = GENERATED_ADVENTURE_OBJECTS.flatMap((role, roleIndex) =>
    [0, 1].map((candidateIndex) => {
      const index = roleIndex * 2 + candidateIndex;
      const rect = adventureObjectCellRect(index);
      return `Cell ${index + 1} (row ${rect.row + 1}, column ${rect.column + 1}) — ${adventureObjectCandidateId(role, candidateIndex)}: ${roleConcept(role, options)}`;
    }),
  ).join(' ');
  return [
    'ADVENTURE THEMED OBJECT BOARD CONTRACT: create exactly one square 3-column by 3-row board. The first EIGHT cells contain two candidates for each of four gameplay roles in the exact order below. Cell 9 must remain completely empty solid green. Do not draw grid lines, gutters, labels, or borders.',
    `These objects belong to ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use the attached key art only as immutable world-style, material, era, atmosphere, palette-logic, and pixel-technique direction. Never copy its player, boss, enemies, composition, scenery, or text.`,
    cells,
    'Keep each role mechanically honest and instantly distinguishable at small gameplay size. The key opens gates, the item is collected and operated by the player, the NPC is friendly and talkable, and the active secondary is the moving or placed gameplay object described above.',
    'The two candidates for one role preserve the same authored identity while offering useful silhouette variation. Across all roles, share material language, contour treatment, rendering density, and palette logic without making unrelated objects look identical.',
    `Limited color direction: ${clean(options.colors)}. Preserve a clean darkest outer contour and strong foreground contrast over light, dark, saturated, and noisy room floors.`,
    `Polished high-density modern retro pixel art authored to become ${GENERATED_ADVENTURE_OBJECT_WIDTH}x${GENERATED_ADVENTURE_OBJECT_HEIGHT} transparent gameplay sources: crisp deliberate square pixel clusters, hard edges, controlled limited flat colors, rich readable detail, and no huge chunky blocks. No antialiasing, blur, gradients, smooth vector art, photorealism, or 3D rendering.`,
    'Every populated cell contains exactly ONE complete isolated subject with generous clearance. Nothing may cross a cell boundary or be cropped. No second subject, player, enemy, boss, floor, scenery, baked shadow, glow, particles, UI, text, letters, numbers, logo, watermark, or detached decorative prop.',
    'The entire board background must be perfectly flat solid #00ff00, including every gap inside and around each subject and the unused cell. Do not use #00ff00 or a near-neon imitation in any subject.',
  ].join(' ');
}

async function processAdventureObject(
  image: Buffer,
  role: GeneratedAdventureObject,
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_ADVENTURE_OBJECT_WIDTH,
    height: GENERATED_ADVENTURE_OBJECT_HEIGHT,
    padding: role === 'npc' ? 5 : 9,
    bottomPadding: role === 'npc' ? 1 : 8,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 48,
    minSubjectFraction: 0.003,
    maxSubjectFraction: 0.72,
  });
  const { width, height } = processed.metrics.outputBounds;
  const minimums: Record<GeneratedAdventureObject, { width: number; height: number }> = {
    key: { width: 20, height: 22 },
    item: { width: 22, height: 20 },
    npc: { width: 30, height: 54 },
    secondaryEffect: { width: 20, height: 16 },
  };
  const minimum = minimums[role];
  if (width < minimum.width || height < minimum.height) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `${role} candidate is too small (${width}x${height})`,
    );
  }
  if (role === 'secondaryEffect') {
    const bounds = processed.metrics.outputBounds;
    const subject = await sharp(processed.png)
      .extract({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      })
      .png()
      .toBuffer();
    const left = Math.floor((GENERATED_ADVENTURE_OBJECT_WIDTH - bounds.width) / 2);
    const top = Math.floor((GENERATED_ADVENTURE_OBJECT_HEIGHT - bounds.height) / 2);
    return {
      png: await sharp({
        create: {
          width: GENERATED_ADVENTURE_OBJECT_WIDTH,
          height: GENERATED_ADVENTURE_OBJECT_HEIGHT,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: subject, left, top }])
        .png({ palette: true, colors: 48 })
        .toBuffer(),
      metrics: { ...processed.metrics, outputBounds: { ...bounds, left, top } },
    };
  }
  return processed;
}

export async function splitGeneratedAdventureObjectBoard(image: Buffer): Promise<{
  candidates: AdventureObjectCandidate[];
  failures: AdventureObjectCandidateFailure[];
}> {
  const normalized = await sharp(image)
    .rotate()
    .resize(ADVENTURE_OBJECT_BOARD_SIZE, ADVENTURE_OBJECT_BOARD_SIZE, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const candidates: AdventureObjectCandidate[] = [];
  const failures: AdventureObjectCandidateFailure[] = [];
  for (let index = 0; index < GENERATED_ADVENTURE_OBJECTS.length * 2; index++) {
    const role = GENERATED_ADVENTURE_OBJECTS[Math.floor(index / 2)]!;
    const id = adventureObjectCandidateId(role, index % 2);
    const rect = adventureObjectCellRect(index);
    const cell = await sharp(normalized).extract(rect).png().toBuffer();
    try {
      const processed = await processAdventureObject(cell, role);
      candidates.push({ id, role, png: processed.png, metrics: processed.metrics });
    } catch (error) {
      failures.push({ id, role, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { candidates, failures };
}

export function buildAdventureObjectJudgeSchema(
  candidates: readonly Pick<AdventureObjectCandidate, 'id' | 'role'>[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Adventure themed gameplay-object selection',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selections', 'setSummary'],
    properties: {
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'role', 'scores', 'issues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            role: { type: 'string', enum: GENERATED_ADVENTURE_OBJECTS },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: [
                'conceptMatch',
                'worldStyle',
                'silhouette',
                'gameplayReadability',
                'technical',
              ],
              properties: {
                conceptMatch: score,
                worldStyle: score,
                silhouette: score,
                gameplayReadability: score,
                technical: score,
              },
            },
            issues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selections: {
        type: 'array',
        minItems: GENERATED_ADVENTURE_OBJECTS.length,
        maxItems: GENERATED_ADVENTURE_OBJECTS.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'candidateId', 'confidence', 'rationale'],
          properties: {
            role: { type: 'string', enum: GENERATED_ADVENTURE_OBJECTS },
            candidateId: { type: 'string', enum: ids },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string' },
          },
        },
      },
      setSummary: { type: 'string' },
    },
  };
}

export function buildAdventureObjectJudgePrompt(
  candidates: readonly Pick<AdventureObjectCandidate, 'id' | 'role'>[],
  options: AdventureObjectPromptOptions,
): { system: string; user: string } {
  return {
    system: [
      'You are the art director selecting four small but important gameplay visuals for a premium top-down retro Adventure game.',
      'The top of the attached review board is immutable world-style key art. Labeled processed candidates below appear over varied room floors to test real gameplay contrast.',
      'Score exact authored-concept match, world-style cohesion, complete readable silhouette, immediate gameplay-role readability, and crisp residue-free technical execution.',
      'The key must read as a portable gate-opening object; item as the collectible secondary equipment; NPC as one friendly grounded world inhabitant; active secondary as the correct in-flight or placed gameplay object. Penalize candidates that resemble enemies, floor decoration, the player, the boss, or another role.',
      'Choose exactly one locally valid candidate per role. Optimize the set for coherent materials and rendering density while keeping every role unmistakably distinct. Select the best available candidate for every role even when none is perfect. Return only the requested JSON.',
    ].join(' '),
    user: `Select key, item, npc, and secondaryEffect from ${candidates.map(({ id }) => id).join(', ')}. Contracts: ${GENERATED_ADVENTURE_OBJECTS.map((role) => roleConcept(role, options)).join(' ')}`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numericScore(value: unknown): number {
  return Math.max(
    0,
    Math.min(5, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : 0)),
  );
}

export function bestAdventureObjectCandidateId(
  role: GeneratedAdventureObject,
  decision: AdventureObjectJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    if (review.role !== role) continue;
    const score =
      review.scores.gameplayReadability * 5 +
      review.scores.conceptMatch * 4 +
      review.scores.worldStyle * 3 +
      review.scores.silhouette * 3 +
      review.scores.technical * 2 -
      review.issues.length * 3;
    if (!best || score > best.score) best = { id: review.id, score };
  }
  return best?.id ?? null;
}

export function normalizeAdventureObjectJudgeDecision(
  value: unknown,
  candidates: readonly Pick<AdventureObjectCandidate, 'id' | 'role'>[],
): AdventureObjectJudgeDecision {
  const root = record(value);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviews = new Map<string, AdventureObjectCandidateReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 64);
    const candidate = candidateById.get(id);
    if (!candidate || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      role: candidate.role,
      scores: {
        conceptMatch: numericScore(scores.conceptMatch),
        worldStyle: numericScore(scores.worldStyle),
        silhouette: numericScore(scores.silhouette),
        gameplayReadability: numericScore(scores.gameplayReadability),
        technical: numericScore(scores.technical),
      },
      issues: Array.isArray(review.issues)
        ? review.issues
            .map((issue) => text(issue, 240))
            .filter(Boolean)
            .slice(0, 8)
        : [],
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    (candidate): AdventureObjectCandidateReview =>
      reviews.get(candidate.id) ?? {
        ...candidate,
        scores: {
          conceptMatch: 0,
          worldStyle: 0,
          silhouette: 0,
          gameplayReadability: 0,
          technical: 0,
        },
        issues: ['Judge omitted this candidate'],
        summary: 'No review was returned.',
      },
  );
  const provisional: AdventureObjectJudgeDecision = {
    candidateReviews,
    selections: [],
    setSummary: text(root.setSummary),
  };
  const requested = new Map<GeneratedAdventureObject, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const selection = record(raw);
    const role = text(selection.role, 32) as GeneratedAdventureObject;
    if (GENERATED_ADVENTURE_OBJECTS.includes(role) && !requested.has(role)) {
      requested.set(role, selection);
    }
  }
  provisional.selections = GENERATED_ADVENTURE_OBJECTS.map((role) => {
    const selection = requested.get(role);
    const requestedId = text(selection?.candidateId, 64);
    const validRequested = candidates.some(
      (candidate) => candidate.role === role && candidate.id === requestedId,
    );
    return {
      role,
      candidateId:
        (validRequested ? requestedId : bestAdventureObjectCandidateId(role, provisional)) ??
        candidates.find((candidate) => candidate.role === role)?.id ??
        '',
      confidence:
        typeof selection?.confidence === 'number' && Number.isFinite(selection.confidence)
          ? Math.max(0, Math.min(1, selection.confidence))
          : 0,
      rationale: text(selection?.rationale),
    };
  });
  return provisional;
}

function labelSvg(width: number, height: number, label: string): Buffer {
  const safe = label.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0a1020"/><text x="${width / 2}" y="${height - 9}" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold" fill="#53def8">${safe}</text></svg>`,
  );
}

function previewFloor(width: number, height: number, index: number): Buffer {
  const palettes = [
    ['#dfd3b8', '#89785f'],
    ['#161c2b', '#303950'],
    ['#714885', '#352544'],
    ['#527b69', '#26473f'],
  ];
  const [base, accent] = palettes[index % palettes.length]!;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${base}"/><path d="M0 0h${width / 2}v${height / 2}H0zm${width / 2} ${height / 2}H${width}V${height}H${width / 2}z" fill="${accent}" opacity=".5"/></svg>`,
  );
}

export async function buildAdventureObjectJudgeBoard(options: {
  keyArt: Buffer;
  candidates: readonly AdventureObjectCandidate[];
}): Promise<Buffer> {
  const width = 1320;
  const keyArtWidth = 720;
  const keyArtHeight = 405;
  const previewWidth = 154;
  const previewHeight = 180;
  const groupWidth = 560;
  const groupHeight = 245;
  const startY = 455;
  const height = startY + groupHeight * 2 + 20;
  const keyArt = await sharp(options.keyArt)
    .resize(keyArtWidth, keyArtHeight, { fit: 'contain', background: '#0f1528' })
    .png()
    .toBuffer();
  const previews = new Map(
    await Promise.all(
      options.candidates.map(async (candidate, index) => {
        const sprite = await sharp(candidate.png)
          .resize(previewWidth, previewHeight, { fit: 'contain', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer();
        const preview = await sharp(previewFloor(previewWidth, previewHeight, index))
          .composite([{ input: sprite }])
          .png()
          .toBuffer();
        return [candidate.id, preview] as const;
      }),
    ),
  );
  const composites: sharp.OverlayOptions[] = [
    { input: keyArt, left: Math.floor((width - keyArtWidth) / 2), top: 42 },
    {
      input: labelSvg(keyArtWidth, 38, 'KEY ART · WORLD STYLE'),
      left: Math.floor((width - keyArtWidth) / 2),
      top: 4,
    },
  ];
  GENERATED_ADVENTURE_OBJECTS.forEach((role, roleIndex) => {
    const row = Math.floor(roleIndex / 2);
    const column = roleIndex % 2;
    const groupLeft = 70 + column * 620;
    const top = startY + row * groupHeight;
    composites.push({ input: labelSvg(groupWidth, 34, role.toUpperCase()), left: groupLeft, top });
    const roleCandidates = options.candidates.filter((candidate) => candidate.role === role);
    const pairWidth = previewWidth * 2 + 24;
    const pairLeft = groupLeft + Math.floor((groupWidth - pairWidth) / 2);
    roleCandidates.forEach((candidate, candidateIndex) => {
      const left = pairLeft + candidateIndex * (previewWidth + 24);
      composites.push(
        { input: previews.get(candidate.id)!, left, top: top + 36 },
        { input: labelSvg(previewWidth, 30, candidate.id), left, top: top + 212 },
      );
    });
  });
  return sharp({ create: { width, height, channels: 3, background: '#0a1020' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function buildGeneratedAdventureObjectAtlas(
  selected: Readonly<Record<GeneratedAdventureObject, Buffer>>,
): Promise<Buffer> {
  const composites = GENERATED_ADVENTURE_OBJECTS.map((role, index) => {
    const input = selected[role];
    if (!input) throw new Error(`Adventure object atlas is missing ${role}`);
    return { input, left: index * GENERATED_ADVENTURE_OBJECT_WIDTH, top: 0 };
  });
  const atlas = await sharp({
    create: {
      width: GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH,
      height: GENERATED_ADVENTURE_OBJECT_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ palette: true, colors: 128, compressionLevel: 9 })
    .toBuffer();
  await validateGeneratedAdventureObjectAtlas(atlas);
  return atlas;
}

export async function validateGeneratedAdventureObjectAtlas(atlas: Buffer): Promise<void> {
  const { data, info } = await sharp(atlas)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH ||
    info.height !== GENERATED_ADVENTURE_OBJECT_HEIGHT
  ) {
    throw new Error(
      `Adventure object atlas must be ${GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH}x${GENERATED_ADVENTURE_OBJECT_HEIGHT}`,
    );
  }
  for (let roleIndex = 0; roleIndex < GENERATED_ADVENTURE_OBJECTS.length; roleIndex++) {
    let opaque = 0;
    for (let y = 0; y < info.height; y++) {
      for (
        let x = roleIndex * GENERATED_ADVENTURE_OBJECT_WIDTH;
        x < (roleIndex + 1) * GENERATED_ADVENTURE_OBJECT_WIDTH;
        x++
      ) {
        if (data[(y * info.width + x) * 4 + 3]! > 8) opaque++;
      }
    }
    if (opaque < 140) {
      throw new Error(`${GENERATED_ADVENTURE_OBJECTS[roleIndex]} atlas cell is empty or too small`);
    }
  }
}
