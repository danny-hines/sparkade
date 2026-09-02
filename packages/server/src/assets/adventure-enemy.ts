import sharp, { type OverlayOptions } from 'sharp';
import type { AdventureEntityType } from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_ADVENTURE_ENEMIES = [
  'walker',
  'flyer',
  'shooter',
  'chaser',
  'bruiser',
] as const;

export type GeneratedAdventureEnemy = Extract<
  AdventureEntityType,
  (typeof GENERATED_ADVENTURE_ENEMIES)[number]
>;

export const ADVENTURE_ENEMY_ATLAS_ROLE = 'adventureEnemyAtlas' as const;
export const ADVENTURE_ENEMY_BOARD_SIZE = 1024;
export const ADVENTURE_ENEMY_BOARD_COLUMNS = 4;
export const ADVENTURE_ENEMY_BOARD_ROWS = 3;
export const ADVENTURE_ENEMY_CANDIDATES_PER_ROLE = 2;
export const GENERATED_ADVENTURE_ENEMY_SIZE = 96;
export const GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH =
  GENERATED_ADVENTURE_ENEMY_SIZE * GENERATED_ADVENTURE_ENEMIES.length;
export const ADVENTURE_ENEMY_BOARD_PROMPT_VERSION = 'adventure-enemy-board-v2';
export const ADVENTURE_ENEMY_JUDGE_PROMPT_VERSION = 'adventure-enemy-judge-v2';
export const ADVENTURE_ENEMY_PIPELINE_PROMPT_VERSION = 'adventure-enemy-pipeline-v2';

const ROLE_DIRECTION: Record<GeneratedAdventureEnemy, string> = {
  walker:
    'WALKER: a grounded, steady patrol creature or machine with a stable low center of gravity and an unmistakable walking silhouette',
  flyer:
    'FLYER: an airborne creature, drone, or levitating construct with no walking legs planted on the ground; the silhouette must unmistakably communicate hovering or flight',
  shooter:
    'SHOOTER: a RIGHT-facing ranged attacker in clear side profile, with one clearly integrated muzzle, launcher, bow-like organ, casting focus, or other premise-specific firing feature visibly leading from the RIGHT edge of its silhouette in a calm ready state',
  chaser:
    'CHASER: a compact, fast pursuit creature or machine with an aggressive forward lean, swept-back forms, and a clearly speed-oriented silhouette',
  bruiser:
    'BRUISER: a broad, heavy elite enemy with visibly greater mass, armor, or strength than every other role, while still fitting completely inside its cell',
};

export interface AdventureEnemyPromptOptions {
  gameTitle: string;
  tagline: string;
  concepts: Readonly<Record<GeneratedAdventureEnemy, string>>;
  colors: string;
}

export interface AdventureEnemyBoardCellRect {
  index: number;
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AdventureEnemyCandidate {
  id: string;
  role: GeneratedAdventureEnemy;
  png: Buffer;
  metrics: ProcessedFighterPose['metrics'];
}

export interface AdventureEnemyCandidateFailure {
  id: string;
  role: GeneratedAdventureEnemy;
  reason: string;
}

export interface AdventureEnemyCandidateReview {
  id: string;
  role: GeneratedAdventureEnemy;
  scores: {
    conceptMatch: number;
    castCohesion: number;
    silhouette: number;
    roleReadability: number;
    technical: number;
  };
  issues: string[];
  summary: string;
}

export interface AdventureEnemySelection {
  role: GeneratedAdventureEnemy;
  candidateId: string;
  confidence: number;
  rationale: string;
}

export interface AdventureEnemyJudgeDecision {
  candidateReviews: AdventureEnemyCandidateReview[];
  selections: AdventureEnemySelection[];
  castSummary: string;
}

function clean(value: string | undefined, max = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function adventureEnemyBoardCellRect(index: number): AdventureEnemyBoardCellRect {
  if (!Number.isInteger(index) || index < 0 || index >= 12) {
    throw new RangeError('Adventure enemy board cell index must be between 0 and 11');
  }
  const column = index % ADVENTURE_ENEMY_BOARD_COLUMNS;
  const row = Math.floor(index / ADVENTURE_ENEMY_BOARD_COLUMNS);
  const left = Math.floor((column * ADVENTURE_ENEMY_BOARD_SIZE) / ADVENTURE_ENEMY_BOARD_COLUMNS);
  const right = Math.floor(
    ((column + 1) * ADVENTURE_ENEMY_BOARD_SIZE) / ADVENTURE_ENEMY_BOARD_COLUMNS,
  );
  const top = Math.floor((row * ADVENTURE_ENEMY_BOARD_SIZE) / ADVENTURE_ENEMY_BOARD_ROWS);
  const bottom = Math.floor(((row + 1) * ADVENTURE_ENEMY_BOARD_SIZE) / ADVENTURE_ENEMY_BOARD_ROWS);
  return { index, row, column, left, top, width: right - left, height: bottom - top };
}

export function adventureEnemyCandidateId(
  role: GeneratedAdventureEnemy,
  candidateIndex: number,
): string {
  return `${role}-${candidateIndex + 1}`;
}

export function buildAdventureEnemyBoardPrompt(options: AdventureEnemyPromptOptions): string {
  const cells = GENERATED_ADVENTURE_ENEMIES.flatMap((role, roleIndex) =>
    Array.from({ length: ADVENTURE_ENEMY_CANDIDATES_PER_ROLE }, (_, candidateIndex) => {
      const index = roleIndex * ADVENTURE_ENEMY_CANDIDATES_PER_ROLE + candidateIndex;
      const rect = adventureEnemyBoardCellRect(index);
      return `Cell ${index + 1} (row ${rect.row + 1}, column ${rect.column + 1}) — ${adventureEnemyCandidateId(role, candidateIndex)}: ${ROLE_DIRECTION[role]}. Story-specific concept: ${clean(options.concepts[role]) || 'a premise-specific hostile inhabitant'}.`;
    }),
  ).join(' ');
  return [
    'ADVENTURE ENEMY CAST BOARD CONTRACT: create exactly one square 4-column by 3-row board. The first TEN cells contain two candidates for each of five enemy roles in the exact order below. Cells 11 and 12 must remain completely empty solid green. Do not draw grid lines, gutters, labels, or borders.',
    `This is the coherent enemy cast for ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use the attached key art only as immutable world-style, era, material, atmosphere, and rendering-technique direction. Do not copy the player hero, boss, scenery, text, or props from it.`,
    cells,
    'Every populated cell contains exactly ONE complete isolated enemy in a grounded or hovering neutral locomotion-ready pose. Use the same classic overhead-adventure top-down three-quarter camera in all ten cells. Walker, flyer, chaser, and bruiser generally face toward the bottom edge. SHOOTER ALONE must face RIGHT in unmistakable side profile so runtime mirroring can aim it left or right; its firing feature must terminate at the rightmost leading edge. Nothing may cross a cell boundary or be cropped.',
    'The two candidates for a role must preserve the same authored concept while offering useful silhouette variation. Across roles, create one visibly related faction through shared material language, contour treatment, pixel density, and palette logic, but never make two roles easy to confuse.',
    'Behavior must read from silhouette at gameplay size: walker is stable, flyer unmistakably airborne, shooter has a readable ranged feature, chaser looks fast, and bruiser is the largest and heaviest. No role may look like a pickup, floor decoration, player character, or final boss.',
    `Limited cast color direction: ${clean(options.colors)}. Keep hostile accents distinct from likely player colors and preserve a clean darkest outer contour around every complete silhouette.`,
    `Polished high-density modern retro pixel art authored to become ${GENERATED_ADVENTURE_ENEMY_SIZE}x${GENERATED_ADVENTURE_ENEMY_SIZE} gameplay sprites: crisp deliberate square pixel clusters, hard edges, controlled limited flat colors, rich readable internal detail, and no huge chunky blocks. No antialiasing, blur, gradients, smooth vector art, photorealism, or 3D rendering.`,
    'No animation sequences, second creature within a cell, hero, boss, NPC, text, letters, numbers, logo, watermark, UI, floor, scenery, baked shadow, glow, particles, projectile, or detached prop.',
    'The entire board background must be perfectly flat solid #00ff00, including every gap inside and around each silhouette and both unused cells. Do not use #00ff00 or a near-neon imitation in any enemy.',
  ].join(' ');
}

async function processAdventureEnemyCandidate(
  image: Buffer,
  role: GeneratedAdventureEnemy,
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_ADVENTURE_ENEMY_SIZE,
    height: GENERATED_ADVENTURE_ENEMY_SIZE,
    padding: role === 'bruiser' ? 3 : 7,
    bottomPadding: role === 'flyer' ? 8 : 2,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 48,
    minSubjectFraction: 0.004,
    maxSubjectFraction: 0.72,
  });
  const minWidth = role === 'bruiser' ? 38 : 30;
  const minHeight = role === 'flyer' ? 28 : role === 'bruiser' ? 50 : 34;
  if (
    processed.metrics.outputBounds.width < minWidth ||
    processed.metrics.outputBounds.height < minHeight
  ) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `${role} candidate is too small (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return processed;
}

export async function splitGeneratedAdventureEnemyBoard(image: Buffer): Promise<{
  candidates: AdventureEnemyCandidate[];
  failures: AdventureEnemyCandidateFailure[];
}> {
  const normalized = await sharp(image)
    .rotate()
    .resize(ADVENTURE_ENEMY_BOARD_SIZE, ADVENTURE_ENEMY_BOARD_SIZE, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const candidates: AdventureEnemyCandidate[] = [];
  const failures: AdventureEnemyCandidateFailure[] = [];
  for (let index = 0; index < GENERATED_ADVENTURE_ENEMIES.length * 2; index++) {
    const role = GENERATED_ADVENTURE_ENEMIES[Math.floor(index / 2)]!;
    const id = adventureEnemyCandidateId(role, index % 2);
    const rect = adventureEnemyBoardCellRect(index);
    const cell = await sharp(normalized).extract(rect).png().toBuffer();
    try {
      const processed = await processAdventureEnemyCandidate(cell, role);
      candidates.push({ id, role, png: processed.png, metrics: processed.metrics });
    } catch (error) {
      failures.push({ id, role, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { candidates, failures };
}

export function buildAdventureEnemyJudgeSchema(
  candidates: readonly Pick<AdventureEnemyCandidate, 'id' | 'role'>[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Adventure enemy cast selection',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selections', 'castSummary'],
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
            role: { type: 'string', enum: GENERATED_ADVENTURE_ENEMIES },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: [
                'conceptMatch',
                'castCohesion',
                'silhouette',
                'roleReadability',
                'technical',
              ],
              properties: {
                conceptMatch: score,
                castCohesion: score,
                silhouette: score,
                roleReadability: score,
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
        minItems: GENERATED_ADVENTURE_ENEMIES.length,
        maxItems: GENERATED_ADVENTURE_ENEMIES.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'candidateId', 'confidence', 'rationale'],
          properties: {
            role: { type: 'string', enum: GENERATED_ADVENTURE_ENEMIES },
            candidateId: { type: 'string', enum: ids },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string' },
          },
        },
      },
      castSummary: { type: 'string' },
    },
  };
}

export function buildAdventureEnemyJudgePrompt(
  candidates: readonly Pick<AdventureEnemyCandidate, 'id' | 'role'>[],
  concepts: Readonly<Record<GeneratedAdventureEnemy, string>>,
): { system: string; user: string } {
  return {
    system: [
      'You are the art director selecting one complete five-role enemy cast for a premium top-down retro Adventure game.',
      'The top of the attached board is immutable world-style key art. The labeled processed candidates below appear over varied calm floors that test real gameplay contrast.',
      'Score each candidate for its authored concept, cohesion with the whole faction and key art, complete readable silhouette, immediate behavioral-role readability, and crisp residue-free technical execution.',
      'Walker must read as a stable ground patrol; flyer as airborne; shooter as ranged; chaser as fast pursuit; bruiser as the largest heavy threat. The shooter must visibly face RIGHT in side profile with its firing feature on the rightmost leading edge; a front-facing, left-facing, ambiguous, rear-mounted, or disconnected launcher is mechanically invalid because gameplay mirrors this source toward the player. Penalize any candidate that resembles floor decoration, a pickup, the hero, the final boss, or another selected role.',
      'Choose exactly one locally valid candidate for each role. Optimize the five selections as a combination: coherent materials and pixel density, deliberately distinct silhouettes, sensible relative scale, and strong visibility over every preview floor. Select the best available candidate for every role even when none is perfect. Return only the requested JSON.',
    ].join(' '),
    user: `Select walker, flyer, shooter, chaser, and bruiser from ${candidates.map(({ id }) => id).join(', ')}. Concepts: ${GENERATED_ADVENTURE_ENEMIES.map((role) => `${role}: ${clean(concepts[role])}`).join('; ')}.`,
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

export function bestAdventureEnemyCandidateId(
  role: GeneratedAdventureEnemy,
  decision: AdventureEnemyJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    if (review.role !== role) continue;
    const score =
      review.scores.roleReadability * 5 +
      review.scores.conceptMatch * 4 +
      review.scores.castCohesion * 3 +
      review.scores.silhouette * 3 +
      review.scores.technical * 2 -
      review.issues.length * 3;
    if (!best || score > best.score) best = { id: review.id, score };
  }
  return best?.id ?? null;
}

export function normalizeAdventureEnemyJudgeDecision(
  value: unknown,
  candidates: readonly Pick<AdventureEnemyCandidate, 'id' | 'role'>[],
): AdventureEnemyJudgeDecision {
  const root = record(value);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviews = new Map<string, AdventureEnemyCandidateReview>();
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
        castCohesion: numericScore(scores.castCohesion),
        silhouette: numericScore(scores.silhouette),
        roleReadability: numericScore(scores.roleReadability),
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
    (candidate): AdventureEnemyCandidateReview =>
      reviews.get(candidate.id) ?? {
        ...candidate,
        scores: {
          conceptMatch: 0,
          castCohesion: 0,
          silhouette: 0,
          roleReadability: 0,
          technical: 0,
        },
        issues: ['Judge omitted this candidate'],
        summary: 'No review was returned.',
      },
  );
  const provisional: AdventureEnemyJudgeDecision = {
    candidateReviews,
    selections: [],
    castSummary: text(root.castSummary),
  };
  const requested = new Map<GeneratedAdventureEnemy, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const selection = record(raw);
    const role = text(selection.role, 32) as GeneratedAdventureEnemy;
    if (GENERATED_ADVENTURE_ENEMIES.includes(role) && !requested.has(role)) {
      requested.set(role, selection);
    }
  }
  provisional.selections = GENERATED_ADVENTURE_ENEMIES.map((role) => {
    const selection = requested.get(role);
    const requestedId = text(selection?.candidateId, 64);
    const validRequested = candidates.some(
      (candidate) => candidate.role === role && candidate.id === requestedId,
    );
    return {
      role,
      candidateId:
        (validRequested ? requestedId : bestAdventureEnemyCandidateId(role, provisional)) ??
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
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0a1020"/><text x="${width / 2}" y="${height - 9}" text-anchor="middle" font-family="monospace" font-size="21" font-weight="bold" fill="#53def8">${safe}</text></svg>`,
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

export async function buildAdventureEnemyJudgeBoard(options: {
  keyArt: Buffer;
  candidates: readonly AdventureEnemyCandidate[];
}): Promise<Buffer> {
  const width = 1320;
  const keyArtWidth = 720;
  const keyArtHeight = 405;
  const previewSize = 172;
  const pairWidth = previewSize * 2 + 22;
  const groupWidth = 560;
  const groupHeight = 230;
  const startY = 455;
  const rows = 3;
  const height = startY + rows * groupHeight + 20;
  const keyArt = await sharp(options.keyArt)
    .resize(keyArtWidth, keyArtHeight, { fit: 'contain', background: '#0f1528' })
    .png()
    .toBuffer();
  const previews = new Map(
    await Promise.all(
      options.candidates.map(async (candidate, index) => {
        const sprite = await sharp(candidate.png)
          .resize(previewSize, previewSize, { fit: 'contain', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer();
        const preview = await sharp(previewFloor(previewSize, previewSize, index))
          .composite([{ input: sprite }])
          .png()
          .toBuffer();
        return [candidate.id, preview] as const;
      }),
    ),
  );
  const composites: OverlayOptions[] = [
    { input: keyArt, left: Math.floor((width - keyArtWidth) / 2), top: 42 },
    {
      input: labelSvg(keyArtWidth, 38, 'KEY ART · WORLD STYLE'),
      left: Math.floor((width - keyArtWidth) / 2),
      top: 4,
    },
  ];
  GENERATED_ADVENTURE_ENEMIES.forEach((role, roleIndex) => {
    const row = Math.floor(roleIndex / 2);
    const column = roleIndex % 2;
    const groupLeft = 70 + column * 620;
    const top = startY + row * groupHeight;
    composites.push({ input: labelSvg(groupWidth, 34, role.toUpperCase()), left: groupLeft, top });
    const roleCandidates = options.candidates.filter((candidate) => candidate.role === role);
    const pairLeft = groupLeft + Math.floor((groupWidth - pairWidth) / 2);
    roleCandidates.forEach((candidate, candidateIndex) => {
      const left = pairLeft + candidateIndex * (previewSize + 22);
      composites.push(
        { input: previews.get(candidate.id)!, left, top: top + 36 },
        { input: labelSvg(previewSize, 30, candidate.id), left, top: top + 204 },
      );
    });
  });
  return sharp({ create: { width, height, channels: 3, background: '#0a1020' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function buildGeneratedAdventureEnemyAtlas(
  selected: Readonly<Record<GeneratedAdventureEnemy, Buffer>>,
): Promise<Buffer> {
  const composites = GENERATED_ADVENTURE_ENEMIES.map((role, index) => {
    const input = selected[role];
    if (!input) throw new Error(`Adventure enemy atlas is missing ${role}`);
    return { input, left: index * GENERATED_ADVENTURE_ENEMY_SIZE, top: 0 };
  });
  const atlas = await sharp({
    create: {
      width: GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH,
      height: GENERATED_ADVENTURE_ENEMY_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ palette: true, colors: 128, compressionLevel: 9 })
    .toBuffer();
  await validateGeneratedAdventureEnemyAtlas(atlas);
  return atlas;
}

export async function validateGeneratedAdventureEnemyAtlas(atlas: Buffer): Promise<void> {
  const { data, info } = await sharp(atlas)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH ||
    info.height !== GENERATED_ADVENTURE_ENEMY_SIZE
  ) {
    throw new Error(
      `Adventure enemy atlas must be ${GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH}x${GENERATED_ADVENTURE_ENEMY_SIZE}`,
    );
  }
  for (let roleIndex = 0; roleIndex < GENERATED_ADVENTURE_ENEMIES.length; roleIndex++) {
    let opaque = 0;
    for (let y = 0; y < info.height; y++) {
      for (
        let x = roleIndex * GENERATED_ADVENTURE_ENEMY_SIZE;
        x < (roleIndex + 1) * GENERATED_ADVENTURE_ENEMY_SIZE;
        x++
      ) {
        if (data[(y * info.width + x) * 4 + 3]! > 8) opaque++;
      }
    }
    if (opaque < 180) {
      throw new Error(`${GENERATED_ADVENTURE_ENEMIES[roleIndex]} atlas cell is empty or too small`);
    }
  }
}
