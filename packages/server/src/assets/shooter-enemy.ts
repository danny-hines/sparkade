import sharp, { type OverlayOptions } from 'sharp';
import type { ShooterEnemyType } from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';
import {
  HSHOOTER_ENEMY_BOARD_SIZE,
  HSHOOTER_ENEMY_CANDIDATES_PER_ROLE,
  bestHShooterEnemyCandidateId,
  buildGeneratedHShooterEnemyAtlas,
  buildHShooterEnemyJudgeSchema,
  hshooterEnemyBoardCellRect,
  normalizeHShooterEnemyJudgeDecision,
  validateGeneratedHShooterEnemyAtlas,
  type HShooterEnemyCandidateFailure,
  type HShooterEnemyJudgeDecision,
} from './hshooter-enemy';

export const GENERATED_SHOOTER_ENEMIES = [
  'popcorn',
  'weaver',
  'tank',
  'turret',
  'kamikaze',
] as const satisfies readonly ShooterEnemyType[];
export type GeneratedShooterEnemy = (typeof GENERATED_SHOOTER_ENEMIES)[number];

export const SHOOTER_ENEMY_ATLAS_ROLE = 'shooterEnemyAtlas' as const;
export const SHOOTER_ENEMY_BOARD_SIZE = HSHOOTER_ENEMY_BOARD_SIZE;
export const SHOOTER_ENEMY_CANDIDATES_PER_ROLE = HSHOOTER_ENEMY_CANDIDATES_PER_ROLE;
export const GENERATED_SHOOTER_ENEMY_SIZE = 96;
export const SHOOTER_ENEMY_BOARD_PROMPT_VERSION = 'shooter-enemy-board-v1';
export const SHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION = 'shooter-enemy-replacement-v1';
export const SHOOTER_ENEMY_JUDGE_PROMPT_VERSION = 'shooter-enemy-judge-v1';
export const SHOOTER_ENEMY_PIPELINE_PROMPT_VERSION = 'shooter-enemy-pipeline-v1';

const ROLE_DIRECTION: Record<GeneratedShooterEnemy, string> = {
  popcorn:
    'POPCORN: the smallest fragile swarm unit, with a simple disposable scout silhouette readable in a crowd',
  weaver:
    'WEAVER: a slim agile flyer with lateral fins, wings, feelers, or articulated vanes that suggest side-to-side weaving',
  tank: 'TANK: the largest and most heavily armored ordinary flyer, with a protected core and obvious integrated downward weapon',
  turret:
    'TURRET: a free-flying gun platform or hovering sentry with a stable broad body and one integrated barrel aimed DOWN; never a surface-mounted emplacement',
  kamikaze:
    'KAMIKAZE: a compact high-speed impact threat with a pointed DOWN-facing attack end and aggressive swept-back forms',
};

export interface ShooterEnemyPromptOptions {
  gameTitle: string;
  tagline: string;
  concepts: Readonly<Record<GeneratedShooterEnemy, string>>;
  colors: string;
}

export interface ShooterEnemyCandidate {
  id: string;
  role: GeneratedShooterEnemy;
  png: Buffer;
  metrics: ProcessedFighterPose['metrics'];
}

function clean(value: string | undefined, max = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function shooterEnemyCandidateId(role: GeneratedShooterEnemy, index: number): string {
  return `${role}-${index + 1}`;
}

export function buildShooterEnemyBoardPrompt(options: ShooterEnemyPromptOptions): string {
  const cells = GENERATED_SHOOTER_ENEMIES.flatMap((role, roleIndex) =>
    Array.from({ length: SHOOTER_ENEMY_CANDIDATES_PER_ROLE }, (_, candidateIndex) => {
      const index = roleIndex * SHOOTER_ENEMY_CANDIDATES_PER_ROLE + candidateIndex;
      const rect = hshooterEnemyBoardCellRect(index);
      return `Cell ${index + 1} (row ${rect.row + 1}, column ${rect.column + 1}) — ${shooterEnemyCandidateId(role, candidateIndex)}: ${ROLE_DIRECTION[role]}. Story-specific concept: ${clean(options.concepts[role]) || 'a premise-specific hostile craft or creature'}.`;
    }),
  ).join(' ');
  return [
    'VERTICAL-SHOOTER ENEMY CAST BOARD CONTRACT: create exactly one square 4-column by 3-row board. The first TEN cells contain two candidates for each of five enemy roles in the exact order below. Cells 11 and 12 remain completely empty solid green. No grid lines, gutters, labels, or borders.',
    `This is the coherent ordinary-enemy cast for ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use attached key art only for world style, hostile faction, materials, atmosphere, palette, and rendering technique. Never copy its player pilot, player craft, finale boss, scenery, text, or props.`,
    cells,
    'Every populated cell contains exactly ONE complete isolated vertical-shooter enemy from a strict TOP-DOWN overhead camera, with its attack end pointing DOWN toward the player. Use one neutral combat-ready flight pose. Nothing crosses a cell boundary or is cropped.',
    'The two candidates for a role preserve the same concept with useful silhouette variation. Across roles, share faction materials, contour treatment, pixel density, and palette logic while keeping all five roles unmistakably distinct.',
    'Behavior must read from silhouette at gameplay size: popcorn small and disposable, weaver agile and laterally expressive, tank large and armored, turret a stable free-flying gun platform, and kamikaze pointed and aggressive.',
    `Limited hostile color direction: ${clean(options.colors)}. Keep hostile accents distinct from the player craft and preserve a clean darkest contour around every silhouette.`,
    'Polished high-density modern retro pixel art authored for 96x96 gameplay cells: crisp deliberate square pixel clusters, hard edges, limited flat colors, readable internal detail, and no huge chunky blocks, antialiasing, blur, gradients, vectors, photorealism, or smooth 3D rendering.',
    'No animation, second subject, player, pilot, player craft, finale boss, pod, pickup, text, logo, UI, terrain, floor, wall, scenery, baked shadow, glow, particles, projectile, muzzle flash, exhaust, or detached prop.',
    'The entire board background must be perfectly flat solid #00ff00, including every gap and both unused cells. Do not use #00ff00 or near-neon imitation in any enemy.',
  ].join(' ');
}

export function buildShooterEnemyReplacementPrompt(
  options: ShooterEnemyPromptOptions & { role: GeneratedShooterEnemy; correction: string },
): string {
  return [
    'VERTICAL-SHOOTER ENEMY ROLE REPLACEMENT: create exactly ONE complete isolated top-down enemy gameplay sprite.',
    `Role: ${options.role}. ${ROLE_DIRECTION[options.role]}. Concept: ${clean(options.concepts[options.role]) || 'a premise-specific hostile craft or creature'}.`,
    `Game: ${clean(options.gameTitle, 100)} — ${clean(options.tagline, 180)}. Use attached key art only for world style, hostile-faction materials, palette logic, and pixel technique.`,
    `CORRECTION FROM LOCAL VALIDATION: ${clean(options.correction, 420)}.`,
    'Strict TOP-DOWN overhead camera, attack end pointing DOWN, one neutral combat-ready pose, complete uncropped silhouette centered with generous clearance. Turret is a free-flying or hovering gun platform, never a surface-mounted emplacement.',
    `Color direction: ${clean(options.colors)}. Polished high-density modern retro pixel art for a 96x96 gameplay cell, crisp square pixels, hard edges, limited flat colors, strong darkest contour, and no antialiasing, blur, gradients, photorealism, or 3D rendering.`,
    'No player, pilot, player craft, boss, other enemy, pod, projectile, muzzle flash, exhaust, particles, text, logo, UI, terrain, floor, scenery, shadow, or detached object.',
    'The entire empty background must be perfectly flat solid #00ff00. Do not use #00ff00 in the enemy.',
  ].join(' ');
}

export async function processGeneratedShooterEnemy(
  image: Buffer,
  role: GeneratedShooterEnemy,
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_SHOOTER_ENEMY_SIZE,
    height: GENERATED_SHOOTER_ENEMY_SIZE,
    padding: role === 'tank' ? 3 : 6,
    bottomPadding: 6,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 48,
    minSubjectFraction: 0.004,
    maxSubjectFraction: 0.72,
  });
  const { width, height } = processed.metrics.outputBounds;
  const minWidth = role === 'tank' ? 30 : role === 'turret' ? 28 : 20;
  const minHeight = role === 'tank' ? 38 : role === 'turret' ? 30 : 28;
  // Weaver silhouettes intentionally use lateral fins or vanes to communicate
  // their side-to-side movement, so they may be wider than the other light roles.
  const minimumAspect =
    role === 'weaver' ? 0.75 : role === 'tank' || role === 'turret' ? 0.82 : 1.05;
  if (width < minWidth || height < minHeight || height / Math.max(1, width) < minimumAspect) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `${role} candidate needs a readable top-down silhouette (${width}x${height})`,
    );
  }
  return processed;
}

export async function splitGeneratedShooterEnemyBoard(image: Buffer): Promise<{
  candidates: ShooterEnemyCandidate[];
  failures: HShooterEnemyCandidateFailure[];
}> {
  const normalized = await sharp(image)
    .rotate()
    .resize(SHOOTER_ENEMY_BOARD_SIZE, SHOOTER_ENEMY_BOARD_SIZE, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const candidates: ShooterEnemyCandidate[] = [];
  const failures: HShooterEnemyCandidateFailure[] = [];
  for (let index = 0; index < GENERATED_SHOOTER_ENEMIES.length * 2; index++) {
    const role = GENERATED_SHOOTER_ENEMIES[Math.floor(index / 2)]!;
    const id = shooterEnemyCandidateId(role, index % 2);
    const cell = await sharp(normalized)
      .extract(hshooterEnemyBoardCellRect(index))
      .png()
      .toBuffer();
    try {
      const processed = await processGeneratedShooterEnemy(cell, role);
      candidates.push({ id, role, png: processed.png, metrics: processed.metrics });
    } catch (error) {
      failures.push({ id, role, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { candidates, failures };
}

export const buildShooterEnemyJudgeSchema = buildHShooterEnemyJudgeSchema;
export const normalizeShooterEnemyJudgeDecision = normalizeHShooterEnemyJudgeDecision;
export const bestShooterEnemyCandidateId = bestHShooterEnemyCandidateId;
export const buildGeneratedShooterEnemyAtlas = buildGeneratedHShooterEnemyAtlas;
export const validateGeneratedShooterEnemyAtlas = validateGeneratedHShooterEnemyAtlas;

export function buildShooterEnemyJudgePrompt(
  candidates: readonly Pick<ShooterEnemyCandidate, 'id' | 'role'>[],
  concepts: Readonly<Record<GeneratedShooterEnemy, string>>,
): { system: string; user: string } {
  return {
    system: [
      'You are the art director selecting one complete five-role enemy cast for a premium top-down vertical shooter.',
      'The attached board shows immutable world-style key art above labeled, locally valid processed candidates on subdued vertical flyover previews.',
      'Score authored-concept match, hostile-faction cohesion, complete readable TOP-DOWN silhouette, immediate role readability, crisp technical execution, and a clearly DOWN-facing attack end.',
      'Popcorn is the smallest swarm unit; weaver agile; tank the broadest armored ordinary threat; turret a stable free-flying gun platform; kamikaze a pointed impact threat. Penalize anything resembling the player craft, finale boss, projectile, pickup, scenery, or another selected role.',
      'Choose exactly one candidate per role and optimize the five as a coherent but deliberately distinct combination. Select the best locally valid candidate for every role even if none is perfect. Return only requested JSON.',
    ].join(' '),
    user: `Select popcorn, weaver, tank, turret, and kamikaze from ${candidates.map(({ id }) => id).join(', ')}. Concepts: ${GENERATED_SHOOTER_ENEMIES.map((role) => `${role}: ${clean(concepts[role])}`).join('; ')}.`,
  };
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

function previewField(width: number, height: number, index: number): Buffer {
  const palettes = [
    ['#0d1320', '#25334a'],
    ['#151227', '#3b2f58'],
    ['#0d2023', '#285057'],
    ['#231720', '#56334a'],
  ];
  const [base, accent] = palettes[index % palettes.length]!;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${base}"/><path d="M${width * 0.18} 0h${width * 0.1}v${height}h-${width * 0.1}zm${width * 0.55} 0h${width * 0.08}v${height}h-${width * 0.08}z" fill="${accent}" opacity=".55"/></svg>`,
  );
}

export async function buildShooterEnemyJudgeBoard(options: {
  keyArt: Buffer;
  candidates: readonly ShooterEnemyCandidate[];
}): Promise<Buffer> {
  const width = 1320;
  const keyArtWidth = 720;
  const keyArtHeight = 405;
  const previewSize = 172;
  const groupWidth = 560;
  const groupHeight = 230;
  const startY = 455;
  const height = startY + 3 * groupHeight + 20;
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
        return [
          candidate.id,
          await sharp(previewField(previewSize, previewSize, index))
            .composite([{ input: sprite }])
            .png()
            .toBuffer(),
        ] as const;
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
  GENERATED_SHOOTER_ENEMIES.forEach((role, roleIndex) => {
    const row = Math.floor(roleIndex / 2);
    const column = roleIndex % 2;
    const groupLeft = 70 + column * 620;
    const top = startY + row * groupHeight;
    composites.push({ input: labelSvg(groupWidth, 34, role.toUpperCase()), left: groupLeft, top });
    const roleCandidates = options.candidates.filter((candidate) => candidate.role === role);
    const pairLeft = groupLeft + Math.floor((groupWidth - (previewSize * 2 + 22)) / 2);
    roleCandidates.forEach((candidate, index) => {
      const left = pairLeft + index * (previewSize + 22);
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

export type ShooterEnemyJudgeDecision = HShooterEnemyJudgeDecision;
