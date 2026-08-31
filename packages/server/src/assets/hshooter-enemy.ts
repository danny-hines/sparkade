import sharp from 'sharp';
import type { ShooterEnemyType } from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_HSHOOTER_ENEMIES = [
  'popcorn',
  'weaver',
  'tank',
  'turret',
  'kamikaze',
] as const satisfies readonly ShooterEnemyType[];

export type GeneratedHShooterEnemy = (typeof GENERATED_HSHOOTER_ENEMIES)[number];

export const HSHOOTER_ENEMY_ATLAS_ROLE = 'hshooterEnemyAtlas' as const;
export const HSHOOTER_ENEMY_BOARD_SIZE = 1024;
export const HSHOOTER_ENEMY_BOARD_COLUMNS = 4;
export const HSHOOTER_ENEMY_BOARD_ROWS = 3;
export const HSHOOTER_ENEMY_CANDIDATES_PER_ROLE = 2;
export const GENERATED_HSHOOTER_ENEMY_SIZE = 96;
export const GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH =
  GENERATED_HSHOOTER_ENEMY_SIZE * GENERATED_HSHOOTER_ENEMIES.length;
export const HSHOOTER_ENEMY_BOARD_PROMPT_VERSION = 'hshooter-enemy-board-v1';
export const HSHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION = 'hshooter-enemy-replacement-v1';
export const HSHOOTER_ENEMY_JUDGE_PROMPT_VERSION = 'hshooter-enemy-judge-v1';
export const HSHOOTER_ENEMY_PIPELINE_PROMPT_VERSION = 'hshooter-enemy-pipeline-v1';

const ROLE_DIRECTION: Record<GeneratedHShooterEnemy, string> = {
  popcorn:
    'POPCORN: the smallest fragile swarm unit, with a simple disposable scout silhouette that stays readable when several overlap',
  weaver:
    'WEAVER: a slim agile flyer with swept fins, wings, feelers, or articulated vanes that unmistakably suggest lateral weaving',
  tank: 'TANK: the broadest and most heavily armored ordinary flyer, with a slow massive silhouette, protected core, and integrated forward weapon',
  turret:
    'TURRET: a compact surface-mounted weapon with an obvious attachment base along the BOTTOM edge and one integrated barrel aimed LEFT into the flight lane',
  kamikaze:
    'KAMIKAZE: a compact high-speed impact threat with a pointed LEFT-facing attack end, swept-back forms, and an unmistakably aggressive ramming silhouette',
};

export interface HShooterEnemyPromptOptions {
  gameTitle: string;
  tagline: string;
  concepts: Readonly<Record<GeneratedHShooterEnemy, string>>;
  colors: string;
}

export interface HShooterEnemyBoardCellRect {
  index: number;
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HShooterEnemyCandidate {
  id: string;
  role: GeneratedHShooterEnemy;
  png: Buffer;
  metrics: ProcessedFighterPose['metrics'];
}

export interface HShooterEnemyCandidateFailure {
  id: string;
  role: GeneratedHShooterEnemy;
  reason: string;
}

export interface HShooterEnemyCandidateReview {
  id: string;
  role: GeneratedHShooterEnemy;
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

export interface HShooterEnemySelection {
  role: GeneratedHShooterEnemy;
  candidateId: string;
  confidence: number;
  rationale: string;
}

export interface HShooterEnemyJudgeDecision {
  candidateReviews: HShooterEnemyCandidateReview[];
  selections: HShooterEnemySelection[];
  castSummary: string;
}

function clean(value: string | undefined, max = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function hshooterEnemyBoardCellRect(index: number): HShooterEnemyBoardCellRect {
  if (!Number.isInteger(index) || index < 0 || index >= 12) {
    throw new RangeError('H-scroll enemy board cell index must be between 0 and 11');
  }
  const column = index % HSHOOTER_ENEMY_BOARD_COLUMNS;
  const row = Math.floor(index / HSHOOTER_ENEMY_BOARD_COLUMNS);
  const left = Math.floor((column * HSHOOTER_ENEMY_BOARD_SIZE) / HSHOOTER_ENEMY_BOARD_COLUMNS);
  const right = Math.floor(
    ((column + 1) * HSHOOTER_ENEMY_BOARD_SIZE) / HSHOOTER_ENEMY_BOARD_COLUMNS,
  );
  const top = Math.floor((row * HSHOOTER_ENEMY_BOARD_SIZE) / HSHOOTER_ENEMY_BOARD_ROWS);
  const bottom = Math.floor(((row + 1) * HSHOOTER_ENEMY_BOARD_SIZE) / HSHOOTER_ENEMY_BOARD_ROWS);
  return { index, row, column, left, top, width: right - left, height: bottom - top };
}

export function hshooterEnemyCandidateId(
  role: GeneratedHShooterEnemy,
  candidateIndex: number,
): string {
  return `${role}-${candidateIndex + 1}`;
}

export function buildHShooterEnemyBoardPrompt(options: HShooterEnemyPromptOptions): string {
  const cells = GENERATED_HSHOOTER_ENEMIES.flatMap((role, roleIndex) =>
    Array.from({ length: HSHOOTER_ENEMY_CANDIDATES_PER_ROLE }, (_, candidateIndex) => {
      const index = roleIndex * HSHOOTER_ENEMY_CANDIDATES_PER_ROLE + candidateIndex;
      const rect = hshooterEnemyBoardCellRect(index);
      return `Cell ${index + 1} (row ${rect.row + 1}, column ${rect.column + 1}) — ${hshooterEnemyCandidateId(role, candidateIndex)}: ${ROLE_DIRECTION[role]}. Story-specific concept: ${clean(options.concepts[role]) || 'a premise-specific hostile craft or creature'}.`;
    }),
  ).join(' ');
  return [
    'H-SCROLL ENEMY CAST BOARD CONTRACT: create exactly one square 4-column by 3-row board. The first TEN cells contain two candidates for each of five enemy roles in the exact order below. Cells 11 and 12 must remain completely empty solid green. Do not draw grid lines, gutters, labels, or borders.',
    `This is the coherent ordinary-enemy cast for ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use the attached key art only as immutable world-style, faction, material, atmosphere, and rendering-technique direction. Do not copy the player pilot, player craft, finale boss, scenery, text, or props from it.`,
    cells,
    'Every populated cell contains exactly ONE complete isolated horizontal-shooter enemy in a strict LEFT-facing side profile, confronting a player craft approaching from the left. Use one neutral combat-ready flight or mounted pose. Nothing may cross a cell boundary or be cropped.',
    'The two candidates for a role preserve the same authored concept while offering useful silhouette variation. Across roles, create one visibly related faction through shared material language, contour treatment, pixel density, and palette logic, but never make two roles easy to confuse.',
    'Behavior must read from silhouette at gameplay size: popcorn is small and disposable, weaver agile, tank broad and armored, turret surface-mounted with its base along the bottom, and kamikaze pointed and aggressive. Turret art will be vertically mirrored at runtime for ceiling mounting.',
    `Limited cast color direction: ${clean(options.colors)}. Keep hostile accents distinct from the player craft and preserve a clean darkest outer contour around every complete silhouette.`,
    `Polished high-density modern retro pixel art authored to become ${GENERATED_HSHOOTER_ENEMY_SIZE}x${GENERATED_HSHOOTER_ENEMY_SIZE} gameplay sprites: crisp deliberate square pixel clusters, hard edges, controlled limited flat colors, rich readable internal detail, and no huge chunky blocks. No antialiasing, blur, gradients, smooth vector art, photorealism, or 3D rendering.`,
    'No animation sequence, second subject within a cell, player, pilot, player craft, finale boss, pod, pickup, text, letters, numbers, logo, watermark, UI, terrain, floor, scenery, baked shadow, glow, particles, projectile, exhaust trail, or detached prop.',
    'The entire board background must be perfectly flat solid #00ff00, including every gap inside and around each silhouette and both unused cells. Do not use #00ff00 or a near-neon imitation in any enemy.',
  ].join(' ');
}

export function buildHShooterEnemyReplacementPrompt(
  options: HShooterEnemyPromptOptions & { role: GeneratedHShooterEnemy; correction: string },
): string {
  return [
    'H-SCROLL ENEMY ROLE REPLACEMENT: create exactly ONE complete isolated horizontal-shooter enemy gameplay sprite.',
    `Role: ${options.role}. ${ROLE_DIRECTION[options.role]}. Story-specific concept: ${clean(options.concepts[options.role]) || 'a premise-specific hostile craft or creature'}.`,
    `Game context: ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use the attached key art only for world style, hostile-faction materials, palette logic, and pixel technique. Never copy its player, player craft, finale boss, scenery, or composition.`,
    `CORRECTION FROM LOCAL VALIDATION: ${clean(options.correction, 420)}.`,
    'Strict LEFT-facing side profile, one neutral combat-ready flight or mounted pose, complete uncropped silhouette centered with generous clearance. For turret, put the attachment base along the bottom edge of the silhouette and aim its integrated barrel left.',
    `Use this limited color direction: ${clean(options.colors)}. Polished high-density modern retro pixel art authored for a 96x96 gameplay cell: crisp square pixel clusters, hard edges, limited flat colors, strong darkest contour, no antialiasing, blur, gradients, photorealism, or 3D rendering.`,
    'No player, pilot, player craft, boss, other enemy, pod, projectile, muzzle flash, exhaust trail, particles, text, logo, UI, terrain, floor, scenery, shadow, or detached object.',
    'The entire empty background must be perfectly flat solid #00ff00, including every gap inside and around the silhouette. Do not use #00ff00 in the enemy.',
  ].join(' ');
}

export async function processGeneratedHShooterEnemy(
  image: Buffer,
  role: GeneratedHShooterEnemy,
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_HSHOOTER_ENEMY_SIZE,
    height: GENERATED_HSHOOTER_ENEMY_SIZE,
    padding: role === 'tank' ? 3 : 6,
    bottomPadding: role === 'turret' ? 2 : 6,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 48,
    minSubjectFraction: 0.004,
    maxSubjectFraction: 0.72,
  });
  const { width, height } = processed.metrics.outputBounds;
  const minWidth = role === 'tank' ? 42 : role === 'turret' ? 30 : 28;
  const minHeight = role === 'tank' ? 28 : role === 'turret' ? 24 : 18;
  if (width < minWidth || height < minHeight || width / Math.max(1, height) < 1.05) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `${role} candidate needs a broad side-view silhouette (${width}x${height})`,
    );
  }
  return processed;
}

export async function splitGeneratedHShooterEnemyBoard(image: Buffer): Promise<{
  candidates: HShooterEnemyCandidate[];
  failures: HShooterEnemyCandidateFailure[];
}> {
  const normalized = await sharp(image)
    .rotate()
    .resize(HSHOOTER_ENEMY_BOARD_SIZE, HSHOOTER_ENEMY_BOARD_SIZE, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const candidates: HShooterEnemyCandidate[] = [];
  const failures: HShooterEnemyCandidateFailure[] = [];
  for (let index = 0; index < GENERATED_HSHOOTER_ENEMIES.length * 2; index++) {
    const role = GENERATED_HSHOOTER_ENEMIES[Math.floor(index / 2)]!;
    const id = hshooterEnemyCandidateId(role, index % 2);
    const rect = hshooterEnemyBoardCellRect(index);
    const cell = await sharp(normalized).extract(rect).png().toBuffer();
    try {
      const processed = await processGeneratedHShooterEnemy(cell, role);
      candidates.push({ id, role, png: processed.png, metrics: processed.metrics });
    } catch (error) {
      failures.push({ id, role, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { candidates, failures };
}

export function buildHShooterEnemyJudgeSchema(
  candidates: readonly Pick<HShooterEnemyCandidate, 'id' | 'role'>[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'H-scroll enemy cast selection',
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
            role: { type: 'string', enum: GENERATED_HSHOOTER_ENEMIES },
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
        minItems: GENERATED_HSHOOTER_ENEMIES.length,
        maxItems: GENERATED_HSHOOTER_ENEMIES.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'candidateId', 'confidence', 'rationale'],
          properties: {
            role: { type: 'string', enum: GENERATED_HSHOOTER_ENEMIES },
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

export function buildHShooterEnemyJudgePrompt(
  candidates: readonly Pick<HShooterEnemyCandidate, 'id' | 'role'>[],
  concepts: Readonly<Record<GeneratedHShooterEnemy, string>>,
): { system: string; user: string } {
  return {
    system: [
      'You are the art director selecting one complete five-role enemy cast for a premium side-view horizontal shooter.',
      'The top of the attached board is immutable world-style key art. The labeled processed candidates below appear over subdued horizontal flight lanes that test real gameplay contrast.',
      'Score each candidate for its authored concept, cohesion with the hostile faction and key art, complete readable LEFT-facing side silhouette, immediate behavioral-role readability, and crisp residue-free technical execution.',
      'Popcorn must be the smallest disposable swarm unit; weaver agile; tank the broadest armored ordinary threat; turret a surface-mounted gun with an integrated leftward barrel; kamikaze a pointed aggressive impact threat. Penalize anything resembling the player craft, finale boss, projectile, pickup, scenery, or another selected role.',
      'Choose exactly one locally valid candidate for each role. Optimize the five selections as a combination: coherent materials and pixel density, deliberately distinct silhouettes, sensible relative scale, and strong visibility during projectile-heavy play. Select the best available candidate for every role even when none is perfect. Return only the requested JSON.',
    ].join(' '),
    user: `Select popcorn, weaver, tank, turret, and kamikaze from ${candidates.map(({ id }) => id).join(', ')}. Concepts: ${GENERATED_HSHOOTER_ENEMIES.map((role) => `${role}: ${clean(concepts[role])}`).join('; ')}.`,
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

export function bestHShooterEnemyCandidateId(
  role: GeneratedHShooterEnemy,
  decision: HShooterEnemyJudgeDecision,
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

export function normalizeHShooterEnemyJudgeDecision(
  value: unknown,
  candidates: readonly Pick<HShooterEnemyCandidate, 'id' | 'role'>[],
): HShooterEnemyJudgeDecision {
  const root = record(value);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviews = new Map<string, HShooterEnemyCandidateReview>();
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
    (candidate): HShooterEnemyCandidateReview =>
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
  const provisional: HShooterEnemyJudgeDecision = {
    candidateReviews,
    selections: [],
    castSummary: text(root.castSummary),
  };
  const requested = new Map<GeneratedHShooterEnemy, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const selection = record(raw);
    const role = text(selection.role, 32) as GeneratedHShooterEnemy;
    if (GENERATED_HSHOOTER_ENEMIES.includes(role) && !requested.has(role)) {
      requested.set(role, selection);
    }
  }
  provisional.selections = GENERATED_HSHOOTER_ENEMIES.map((role) => {
    const selection = requested.get(role);
    const requestedId = text(selection?.candidateId, 64);
    const validRequested = candidates.some(
      (candidate) => candidate.role === role && candidate.id === requestedId,
    );
    return {
      role,
      candidateId:
        (validRequested ? requestedId : bestHShooterEnemyCandidateId(role, provisional)) ??
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

function previewLane(width: number, height: number, index: number): Buffer {
  const palettes = [
    ['#0d1320', '#25334a'],
    ['#151227', '#3b2f58'],
    ['#0d2023', '#285057'],
    ['#231720', '#56334a'],
  ];
  const [base, accent] = palettes[index % palettes.length]!;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${base}"/><path d="M0 ${height * 0.22}h${width}v${height * 0.12}H0zm0 ${height * 0.7}h${width}v${height * 0.08}H0z" fill="${accent}" opacity=".55"/></svg>`,
  );
}

export async function buildHShooterEnemyJudgeBoard(options: {
  keyArt: Buffer;
  candidates: readonly HShooterEnemyCandidate[];
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
        const preview = await sharp(previewLane(previewSize, previewSize, index))
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
  GENERATED_HSHOOTER_ENEMIES.forEach((role, roleIndex) => {
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

export async function buildGeneratedHShooterEnemyAtlas(
  selected: Readonly<Record<GeneratedHShooterEnemy, Buffer>>,
): Promise<Buffer> {
  const composites = GENERATED_HSHOOTER_ENEMIES.map((role, index) => {
    const input = selected[role];
    if (!input) throw new Error(`H-scroll enemy atlas is missing ${role}`);
    return { input, left: index * GENERATED_HSHOOTER_ENEMY_SIZE, top: 0 };
  });
  const atlas = await sharp({
    create: {
      width: GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH,
      height: GENERATED_HSHOOTER_ENEMY_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ palette: true, colors: 128, compressionLevel: 9 })
    .toBuffer();
  await validateGeneratedHShooterEnemyAtlas(atlas);
  return atlas;
}

export async function validateGeneratedHShooterEnemyAtlas(atlas: Buffer): Promise<void> {
  const { data, info } = await sharp(atlas)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH ||
    info.height !== GENERATED_HSHOOTER_ENEMY_SIZE
  ) {
    throw new Error(
      `H-scroll enemy atlas must be ${GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH}x${GENERATED_HSHOOTER_ENEMY_SIZE}`,
    );
  }
  for (let roleIndex = 0; roleIndex < GENERATED_HSHOOTER_ENEMIES.length; roleIndex++) {
    let opaque = 0;
    for (let y = 0; y < info.height; y++) {
      for (
        let x = roleIndex * GENERATED_HSHOOTER_ENEMY_SIZE;
        x < (roleIndex + 1) * GENERATED_HSHOOTER_ENEMY_SIZE;
        x++
      ) {
        if (data[(y * info.width + x) * 4 + 3]! > 8) opaque++;
      }
    }
    if (opaque < 160) {
      throw new Error(`${GENERATED_HSHOOTER_ENEMIES[roleIndex]} atlas cell is empty or too small`);
    }
  }
}
