#!/usr/bin/env tsx
// Template-board pose experiment. For each saved platformer game, put its
// approved front idle in cell 1 of a 3x2 board, two-tone mannequins in cells
// 2-6, and ask Muse Image to redraw every mannequin as that character in one
// edit. Scores the result with production keying/normalization, silhouette
// agreement against the templates, and the production pose and jump judges,
// then re-judges the game's existing production frames for a baseline.
// Defaults to mock (the unedited board stands in for Muse); --live is paid.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import {
  GENERATED_GAME_ASSET_FILES,
  type CompleteRequest,
  type PlatformerSpec,
} from '../packages/shared/src/index';
import {
  PLATFORMER_TEMPLATE_BOARD_PROMPT_VERSION,
  PLATFORMER_TEMPLATE_MANNEQUIN_VERSION,
  PLATFORMER_TEMPLATE_POSES,
  PLATFORMER_TEMPLATE_STYLES,
  buildPlatformerTemplateBoard,
  buildPlatformerTemplateBoardPrompt,
  measureMannequinResidue,
  measurePlatformerSilhouetteAgreement,
  splitPlatformerTemplateBoard,
  type PlatformerTemplatePose,
  type PlatformerTemplateStyle,
} from '../packages/server/src/assets/platformer-template-board';
import {
  alignGeneratedPlatformerPoseCanvases,
  validateGeneratedPlatformerPoseSet,
  type GeneratedPlatformerPose,
} from '../packages/server/src/assets/platformer-pose';
import {
  PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
  buildPlatformerPoseJudgeBoard,
  buildPlatformerPoseJudgePrompt,
  buildPlatformerPoseJudgeSchema,
  normalizePlatformerPoseJudgeDecision,
  type PlatformerPoseCandidateDescriptor,
  type PlatformerPoseJudgeDecision,
} from '../packages/server/src/assets/platformer-pose-judge';
import {
  PLATFORMER_JUMP_JUDGE_PROMPT_VERSION,
  buildPlatformerJumpJudgeBoard,
  buildPlatformerJumpJudgePrompt,
  buildPlatformerJumpJudgeSchema,
  normalizePlatformerJumpJudgeDecision,
  type PlatformerJumpJudgeDecision,
} from '../packages/server/src/assets/platformer-jump-judge';
import { MetaImageAdapter } from '../packages/server/src/providers/meta-image';
import { ConfigStore } from '../packages/server/src/storage/config';
import { stageProvider } from '../packages/server/src/providers';
import { parseModelJson } from '../packages/server/src/pipeline/prompts';
import { costOf } from '../packages/server/src/pipeline/cost';

/** Varied by body plan: humans, a long-haired lead, animals with tails and
 * ears, a round robot, chibi and plant creatures, and a green-skinned hero. */
const DEFAULT_GAMES = [
  'golden-platformer',
  'g-3ozov1rfzj',
  'g-9ncsqbiwot',
  'g-gwj65cz1hv',
  'g-hsqnmk8ntw',
  'g-mkujetzsu4',
  'g-aco9qwvbvx',
  'g-hehhcnoczp',
  'g-28mdl1klva',
  'g-k8dta3erxq',
];
const BASE_POSES = ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'] as const;
const ROLE: Record<(typeof BASE_POSES)[number], keyof typeof GENERATED_GAME_ASSET_FILES> = {
  idle: 'platformerIdle',
  sideIdle: 'platformerSideIdle',
  walk1: 'platformerWalk1',
  walk2: 'platformerWalk2',
  jump: 'platformerJump',
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const root = resolve(import.meta.dirname, '..');
const live = flag('live');
const boards = Math.max(1, Math.min(4, Number(arg('boards') ?? 1)));
const identityPose = arg('identity') === 'sideIdle' ? 'sideIdle' : 'idle';
const judgeEnabled = !flag('no-judge');
const judgeProduction = judgeEnabled && !flag('no-production-judge');
const templatesDir = arg('templates') ? resolve(arg('templates')!) : undefined;
// Reprocess a previous run's saved Muse outputs: no image calls, and judges
// stay mock unless --live is also passed.
const reuseDir = arg('reuse') ? resolve(arg('reuse')!) : undefined;
const style = (arg('style') ?? 'volume') as PlatformerTemplateStyle;
if (!PLATFORMER_TEMPLATE_STYLES.includes(style))
  throw new Error(`--style must be one of ${PLATFORMER_TEMPLATE_STYLES.join(', ')}`);
const dataDir = resolve(process.env.SPARKADE_DATA ?? join(root, 'data'));
const games = (arg('games') ?? DEFAULT_GAMES.join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (games.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('Invalid --games id');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(
  arg('out') ??
    join(dataDir, 'experiments', 'platformer-templates', `${stamp}-${live ? 'live' : 'mock'}`),
);
if (live && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = new ConfigStore(dataDir).get();
const imageConfig = config.imageGeneration;
const adapter = new MetaImageAdapter({ ...imageConfig, name: 'platformer-template-lab' });
const judge = stageProvider(config, 'design');
if (live && judgeEnabled && judge.providerName === 'mock')
  throw new Error(
    '--live judging requires a real design provider; unset SPARKADE_PROVIDER=mock or pass --no-judge.',
  );
if (live && judgeEnabled && !judge.provider.capabilities.imageIn)
  throw new Error(`judge provider "${judge.providerName}" does not support image input`);

const importedLifts =
  templatesDir && existsSync(join(templatesDir, 'lifts.json'))
    ? (JSON.parse(readFileSync(join(templatesDir, 'lifts.json'), 'utf8')) as Partial<
        Record<PlatformerTemplatePose, number>
      >)
    : undefined;
/** Filled cutouts for overlap metrics when imported templates are line art. */
const importedSilhouettes =
  templatesDir && existsSync(join(templatesDir, 'silhouette'))
    ? (Object.fromEntries(
        PLATFORMER_TEMPLATE_POSES.map((pose) => [
          pose,
          readFileSync(join(templatesDir, 'silhouette', `${pose}.png`)),
        ]),
      ) as Record<PlatformerTemplatePose, Buffer>)
    : undefined;
const importedTemplates = templatesDir
  ? (Object.fromEntries(
      PLATFORMER_TEMPLATE_POSES.map((pose) => {
        const path = join(templatesDir, `${pose}.png`);
        if (!existsSync(path)) throw new Error(`--templates is missing ${pose}.png`);
        return [pose, readFileSync(path)];
      }),
    ) as Record<PlatformerTemplatePose, Buffer>)
  : undefined;

// One bounded pool for every paid call, matching the action lab.
let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiters.push(r));
  else active++;
  try {
    return await work();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

const usage = { imageCalls: 0, judgeCalls: 0, judgeCostUsd: 0 as number | null };

function write(path: string, contents: Buffer | string): string {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  return relative(out, path);
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

async function complete<T>(
  name: string,
  dir: string,
  request: CompleteRequest,
  mock: () => unknown,
  normalize: (value: unknown) => T,
): Promise<T> {
  write(join(dir, `${name}-board.jpg`), request.image!);
  write(
    join(dir, `${name}-prompt.json`),
    JSON.stringify({ system: request.system, user: request.user }, null, 2),
  );
  let value: unknown = mock();
  if (live) {
    const response = await slot(() =>
      judge.provider.complete(
        {
          ...request,
          jsonSchema: judge.provider.capabilities.structuredOutput ? request.jsonSchema : undefined,
          timeoutMs: 120_000,
        },
        { model: judge.model },
      ),
    );
    usage.judgeCalls++;
    const cost = costOf(response.model ?? judge.model, response.usage, config.pricing);
    usage.judgeCostUsd =
      usage.judgeCostUsd === null || cost === null ? null : usage.judgeCostUsd + cost;
    write(join(dir, `${name}-response.txt`), response.text);
    value = parseModelJson(response.text);
  }
  const decision = normalize(value);
  write(join(dir, `${name}.json`), JSON.stringify(decision, null, 2));
  return decision;
}

function mockPoseDecision(candidates: readonly PlatformerPoseCandidateDescriptor[]) {
  const a = candidates.filter(({ kind }) => kind === 'phase-a');
  const b = candidates.filter(({ kind }) => kind === 'phase-b');
  const scores = { identity: 5, costume: 5, pose: 5, technical: 5 };
  return {
    anchorReview: {
      identity: 5,
      sideView: 5,
      costume: 5,
      fatalIssues: [],
      summary: 'Mock anchor.',
    },
    candidateReviews: candidates.map(({ id, kind }) => ({
      id,
      kind,
      scores,
      fatalIssues: [],
      summary: 'Mock.',
    })),
    pairReviews: a.flatMap(({ id: phaseAId }) =>
      b.map(({ id: phaseBId }) => ({
        phaseAId,
        phaseBId,
        legAlternation: 5,
        armAlternation: 5,
        pairConsistency: 5,
        fatalIssues: [],
        summary: 'Mock pair.',
      })),
    ),
    selection: {
      accepted: true,
      phaseAId: a[0]!.id,
      phaseBId: b[0]!.id,
      confidence: 1,
      rationale: 'Mock selection.',
      retryGuidance: '',
    },
  };
}

function mockJumpDecision(ids: readonly string[]) {
  return {
    candidateReviews: ids.map((id) => ({
      id,
      scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
      fatalIssues: [],
      summary: 'Mock jump.',
    })),
    selection: {
      accepted: true,
      candidateId: ids[0]!,
      confidence: 1,
      rationale: 'Mock.',
      retryGuidance: '',
    },
  };
}

interface JudgeInputs {
  source: Buffer;
  idle: Buffer;
  sideAnchor: Buffer;
  walk1: Array<{ id: string; png: Buffer }>;
  walk2: Array<{ id: string; png: Buffer }>;
  jump: Array<{ id: string; png: Buffer }>;
  heroConcept?: string;
}

interface JudgeSummary {
  pose?: {
    accepted: boolean;
    selected: string;
    legAlternation: number;
    rationale: string;
    anchor: PlatformerPoseJudgeDecision['anchorReview'];
  };
  jump?: { accepted: boolean; selected: string; best: Record<string, number>; rationale: string };
  skipped?: string;
  error?: string;
}

async function runJudges(name: string, dir: string, input: JudgeInputs): Promise<JudgeSummary> {
  const summary: JudgeSummary = {};
  const descriptors: PlatformerPoseCandidateDescriptor[] = [
    ...input.walk1.map(({ id }) => ({ id, kind: 'phase-a' as const })),
    ...input.walk2.map(({ id }) => ({ id, kind: 'phase-b' as const })),
  ];
  try {
    if (input.walk1.length && input.walk2.length) {
      const prompt = buildPlatformerPoseJudgePrompt(descriptors, 'key-art');
      const decision = await complete(
        `${name}-pose`,
        dir,
        {
          ...prompt,
          image: await buildPlatformerPoseJudgeBoard({
            source: input.source,
            sourceKind: 'key-art',
            idle: input.idle,
            sideAnchor: input.sideAnchor,
            candidates: [
              ...input.walk1.map(({ id, png }) => ({
                id,
                kind: 'phase-a' as const,
                processed: png,
              })),
              ...input.walk2.map(({ id, png }) => ({
                id,
                kind: 'phase-b' as const,
                processed: png,
              })),
            ],
          }),
          jsonSchema: buildPlatformerPoseJudgeSchema(descriptors),
          maxTokens: 4000,
          temperature: 0,
          effort: 'low',
        },
        () => mockPoseDecision(descriptors),
        (value) => normalizePlatformerPoseJudgeDecision(value, descriptors),
      );
      const pair = decision.pairReviews.find(
        (review) =>
          review.phaseAId === decision.selection.phaseAId &&
          review.phaseBId === decision.selection.phaseBId,
      );
      summary.pose = {
        accepted: decision.selection.accepted,
        selected: decision.selection.accepted
          ? `${decision.selection.phaseAId}+${decision.selection.phaseBId}`
          : '',
        legAlternation:
          pair?.legAlternation ?? Math.max(0, ...decision.pairReviews.map((r) => r.legAlternation)),
        rationale: decision.selection.rationale || decision.selection.retryGuidance,
        anchor: decision.anchorReview,
      };
    }
    if (input.jump.length) {
      const ids = input.jump.map(({ id }) => ({ id }));
      const decision: PlatformerJumpJudgeDecision = await complete(
        `${name}-jump`,
        dir,
        {
          ...buildPlatformerJumpJudgePrompt(ids, {
            heroConcept: input.heroConcept,
            sourceKind: 'key-art',
          }),
          image: await buildPlatformerJumpJudgeBoard({
            source: input.source,
            sourceKind: 'key-art',
            idle: input.idle,
            sideAnchor: input.sideAnchor,
            candidates: input.jump.map(({ id, png }) => ({ id, processed: png })),
          }),
          jsonSchema: buildPlatformerJumpJudgeSchema(ids),
          maxTokens: 3000,
          temperature: 0,
          effort: 'low',
        },
        () => mockJumpDecision(ids.map(({ id }) => id)),
        (value) => normalizePlatformerJumpJudgeDecision(value, ids),
      );
      const best = decision.candidateReviews.reduce<
        (typeof decision.candidateReviews)[number] | undefined
      >(
        (top, review) =>
          !top ||
          review.scores.identity + review.scores.pose > top.scores.identity + top.scores.pose
            ? review
            : top,
        undefined,
      );
      summary.jump = {
        accepted: decision.selection.accepted,
        selected: decision.selection.candidateId,
        best: { ...(best?.scores ?? {}), fatalIssues: best?.fatalIssues.length ?? 0 },
        rationale: decision.selection.rationale || decision.selection.retryGuidance,
      };
    }
  } catch (error) {
    summary.error = message(error);
  }
  return summary;
}

interface CellReport {
  pose: PlatformerTemplatePose;
  raw: string;
  frame?: string;
  error?: string;
  iou?: number;
  lowerBodyIou?: number;
  /** Mannequin-gray fraction of the frame; compare with the game's identityResidue. */
  residue?: number;
  nearestTemplate?: PlatformerTemplatePose;
}

interface BoardReport {
  index: number;
  raw?: string;
  error?: string;
  cells: CellReport[];
  aligned?: Partial<Record<GeneratedPlatformerPose | 'runPass', string>>;
  setValid?: boolean;
  setError?: string;
  judge?: JudgeSummary;
}

interface GameReport {
  game: string;
  heroConcept?: string;
  build?: number;
  upscale?: number;
  identityResidue?: number;
  keyArt?: string;
  boardInput?: string;
  prompt?: string;
  templates?: Partial<Record<PlatformerTemplatePose, string>>;
  production: Partial<Record<GeneratedPlatformerPose, string>>;
  boards: BoardReport[];
  productionJudge?: JudgeSummary;
  error?: string;
}

async function padTo(png: Buffer, width: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const padding = width - meta.width!;
  if (padding <= 0) return png;
  return sharp(png)
    .extend({
      left: Math.floor(padding / 2),
      right: Math.ceil(padding / 2),
      top: 0,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function runGame(game: string): Promise<GameReport> {
  const assets = join(dataDir, 'games', game, 'assets');
  const dir = join(out, game);
  const report: GameReport = { game, production: {}, boards: [] };
  try {
    const production = Object.fromEntries(
      BASE_POSES.map((pose) => {
        const path = join(assets, GENERATED_GAME_ASSET_FILES[ROLE[pose]]);
        if (!existsSync(path)) throw new Error(`${game} has no generated ${pose} player sprite`);
        return [pose, readFileSync(path)];
      }),
    ) as Record<(typeof BASE_POSES)[number], Buffer>;
    for (const pose of BASE_POSES)
      report.production[pose] = write(join(dir, 'production', `${pose}.png`), production[pose]);
    const spec = JSON.parse(
      readFileSync(join(dataDir, 'games', game, 'game.json'), 'utf8'),
    ) as PlatformerSpec;
    const heroConcept = spec.meta?.heroConcept;
    report.heroConcept = heroConcept;
    // Same green-free palette guidance production passes to every pose.
    const colors = (spec.palette ?? [])
      .filter((hex) => {
        const r = Number.parseInt(hex.slice(1, 3), 16);
        const g = Number.parseInt(hex.slice(3, 5), 16);
        const b = Number.parseInt(hex.slice(5, 7), 16);
        return !(g > r * 1.15 && g > b * 1.15);
      })
      .join(', ');
    const keyArtPath = join(assets, 'key-art.png');
    const source = existsSync(keyArtPath) ? readFileSync(keyArtPath) : production.idle;
    report.keyArt = write(join(dir, 'key-art.png'), source);

    const built = await buildPlatformerTemplateBoard({
      identity: production[identityPose],
      templates: importedTemplates,
      templateLifts: importedLifts,
      style,
    });
    report.build = built.build;
    report.upscale = built.upscale;
    report.identityResidue = await measureMannequinResidue(production.idle);
    report.boardInput = write(join(dir, 'board-input.png'), built.board);
    const prompt = buildPlatformerTemplateBoardPrompt({
      heroConcept,
      colors,
      identityView: identityPose === 'sideIdle' ? 'side' : 'front',
      style,
    });
    report.prompt = write(join(dir, 'prompt.txt'), prompt);
    report.templates = {};
    for (const pose of PLATFORMER_TEMPLATE_POSES) {
      report.templates[pose] = write(join(dir, 'templates', `${pose}.png`), built.templates[pose]);
    }
    // Silhouette references come from the filled figure in the same poses,
    // normalized by the same splitter and keying as the output. Line styles
    // have no solid silhouette of their own.
    const silhouetteBoard = importedSilhouettes
      ? (
          await buildPlatformerTemplateBoard({
            identity: production[identityPose],
            templates: importedSilhouettes,
            templateLifts: importedLifts,
          })
        ).board
      : style === 'volume' || importedTemplates
        ? built.board
        : (
            await buildPlatformerTemplateBoard({
              identity: production[identityPose],
              style: 'volume',
            })
          ).board;
    const templateFrames = {} as Record<PlatformerTemplatePose, Buffer>;
    for (const cell of await splitPlatformerTemplateBoard(silhouetteBoard)) {
      if (!cell.processed)
        throw new Error(`template ${cell.pose} failed normalization: ${cell.error}`);
      templateFrames[cell.pose] = cell.processed;
    }

    report.boards = await Promise.all(
      Array.from({ length: boards }, async (_, i): Promise<BoardReport> => {
        const index = i + 1;
        const boardDir = join(dir, `board-${index}`);
        const board: BoardReport = { index, cells: [] };
        let raw: Buffer;
        try {
          const saved = reuseDir && join(reuseDir, game, `board-${index}`, 'raw.png');
          if (saved && !existsSync(saved)) throw new Error(`no saved output at ${saved}`);
          raw = saved
            ? readFileSync(saved)
            : live
              ? (
                  await slot(async () => {
                    const result = await adapter.edit({
                      prompt,
                      image: built.board,
                      imageMimeType: 'image/png',
                      imageFilename: `${game}-template-board.png`,
                      outputFormat: 'png',
                      size: '1024x1024',
                      user: 'platformer-template-lab',
                    });
                    usage.imageCalls += result.imageCount;
                    return result;
                  })
                ).image
              : built.board;
        } catch (error) {
          board.error = `${reuseDir ? 'Reuse' : 'Muse Image edit'} failed: ${message(error)}`;
          return board;
        }
        board.raw = write(join(boardDir, 'raw.png'), raw);
        const cells = await splitPlatformerTemplateBoard(raw);
        const frames: Partial<Record<PlatformerTemplatePose, Buffer>> = {};
        for (const cell of cells) {
          const entry: CellReport = {
            pose: cell.pose,
            raw: write(join(boardDir, 'cells', `${cell.pose}.png`), cell.raw),
          };
          if (cell.processed) {
            frames[cell.pose] = cell.processed;
            entry.frame = write(join(boardDir, 'frames', `${cell.pose}.png`), cell.processed);
            const agreements = await Promise.all(
              PLATFORMER_TEMPLATE_POSES.map(async (pose) => ({
                pose,
                ...(await measurePlatformerSilhouetteAgreement(
                  cell.processed!,
                  templateFrames[pose],
                )),
              })),
            );
            const own = agreements.find(({ pose }) => pose === cell.pose)!;
            entry.iou = own.iou;
            entry.lowerBodyIou = own.lowerBodyIou;
            entry.residue = await measureMannequinResidue(cell.processed);
            // Ties go to the cell's own template (walk1 and walk2 share a silhouette).
            entry.nearestTemplate = agreements.reduce(
              (best, next) => (next.iou > best.iou ? next : best),
              own,
            ).pose;
          } else {
            entry.error = cell.error;
          }
          board.cells.push(entry);
        }
        if (frames.sideIdle && frames.walk1 && frames.walk2 && frames.jump) {
          try {
            const set = await alignGeneratedPlatformerPoseCanvases({
              idle: production.idle,
              sideIdle: frames.sideIdle,
              walk1: frames.walk1,
              walk2: frames.walk2,
              jump: frames.jump,
            });
            await validateGeneratedPlatformerPoseSet(set, { strictMotion: false });
            board.setValid = true;
            const width = (await sharp(set.sideIdle).metadata()).width!;
            board.aligned = {};
            for (const pose of BASE_POSES)
              board.aligned[pose] = write(join(boardDir, 'aligned', `${pose}.png`), set[pose]);
            if (frames.runPass) {
              board.aligned.runPass = write(
                join(boardDir, 'aligned', 'runPass.png'),
                await padTo(
                  frames.runPass,
                  Math.max(width, (await sharp(frames.runPass).metadata()).width!),
                ),
              );
            }
          } catch (error) {
            board.setValid = false;
            board.setError = message(error);
          }
        } else {
          board.setValid = false;
          board.setError = 'one or more production poses failed normalization';
        }
        return board;
      }),
    );

    if (judgeEnabled) {
      const judgeDir = join(dir, 'judge');
      // Each board is judged alone against its own side idle, so acceptance
      // measures one edit with no best-of-N selection.
      await Promise.all(
        report.boards.map(async (board) => {
          const frame = (pose: PlatformerTemplatePose) => {
            const path = board.cells.find((cell) => cell.pose === pose)?.frame;
            return path ? readFileSync(join(out, path)) : undefined;
          };
          const anchor = frame('sideIdle');
          const one = (pose: PlatformerTemplatePose, id: string) => {
            const png = frame(pose);
            return png ? [{ id, png }] : [];
          };
          board.judge = anchor
            ? await runJudges(`board-${board.index}`, judgeDir, {
                source,
                idle: production.idle,
                sideAnchor: anchor,
                walk1: one('walk1', 'A1'),
                walk2: one('walk2', 'B1'),
                jump: one('jump', 'J1'),
                heroConcept,
              })
            : { skipped: 'the side idle cell failed normalization, so there is no review anchor' };
        }),
      );
      if (judgeProduction) {
        report.productionJudge = await runJudges('production', judgeDir, {
          source,
          idle: production.idle,
          sideAnchor: production.sideIdle,
          walk1: [{ id: 'A1', png: production.walk1 }],
          walk2: [{ id: 'B1', png: production.walk2 }],
          jump: [{ id: 'J1', png: production.jump }],
          heroConcept,
        });
      }
    }
  } catch (error) {
    report.error = message(error);
  }
  write(join(dir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(
    `${game}: ${report.error ?? report.boards.map((b) => b.error ?? `board ${b.index} ${b.cells.filter((c) => c.frame).length}/5 cells${b.setValid ? ', set valid' : ''}`).join('; ')}`,
  );
  return report;
}

mkdirSync(out, { recursive: true });
console.log(`${live ? 'LIVE' : 'MOCK'} template-board experiment → ${out}`);
const reports: GameReport[] = [];
for (let i = 0; i < games.length; i += 2) {
  reports.push(...(await Promise.all(games.slice(i, i + 2).map(runGame))));
}

const silhouetteGroup = (pose: PlatformerTemplatePose) => (pose === 'walk2' ? 'walk1' : pose);
const rate = (values: boolean[]) =>
  values.length ? `${values.filter(Boolean).length}/${values.length}` : 'n/a';
const allBoards = reports.flatMap((r) => r.boards);
const summary = {
  mode: live ? 'live' : 'mock',
  createdAt: new Date().toISOString(),
  out,
  options: {
    games,
    boards,
    identity: identityPose,
    templates: templatesDir ?? 'mannequin',
    style: templatesDir ? `${style} (imported)` : style,
    reusedFrom: reuseDir,
    judge: judgeEnabled,
    judgeProduction,
  },
  versions: {
    board: PLATFORMER_TEMPLATE_BOARD_PROMPT_VERSION,
    mannequin: PLATFORMER_TEMPLATE_MANNEQUIN_VERSION,
    poseJudge: PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
    jumpJudge: PLATFORMER_JUMP_JUDGE_PROMPT_VERSION,
  },
  models: {
    image: reuseDir
      ? `reused from ${reuseDir}`
      : live
        ? imageConfig.model
        : 'mock (unedited board)',
    judge: live ? judge.model : 'mock',
  },
  rates: {
    boardsAllCellsValid: rate(allBoards.map((b) => b.cells.filter((c) => c.frame).length === 5)),
    cellsValid: rate(allBoards.flatMap((b) => b.cells.map((c) => Boolean(c.frame)))),
    productionSetValid: rate(allBoards.map((b) => b.setValid === true)),
    templatePoseAccepted: rate(
      allBoards.flatMap((b) => (b.judge?.pose ? [b.judge.pose.accepted] : [])),
    ),
    productionPoseAccepted: rate(
      reports.flatMap((r) => (r.productionJudge?.pose ? [r.productionJudge.pose.accepted] : [])),
    ),
    templateJumpAccepted: rate(
      allBoards.flatMap((b) => (b.judge?.jump ? [b.judge.jump.accepted] : [])),
    ),
    productionJumpAccepted: rate(
      reports.flatMap((r) => (r.productionJudge?.jump ? [r.productionJudge.jump.accepted] : [])),
    ),
    // Contact A and B differ only in limb depth, so silhouettes group them.
    // More than 15% of the sprite still mannequin gray beyond the identity's own grays.
    grayBodyLeft: rate(
      reports.flatMap((r) =>
        r.boards.flatMap((b) =>
          b.cells
            .filter((c) => c.residue !== undefined)
            .map((c) => c.residue! - (r.identityResidue ?? 0) > 0.15),
        ),
      ),
    ),
    nearestTemplateIsOwn: rate(
      allBoards.flatMap((b) =>
        b.cells
          .filter((c) => c.nearestTemplate)
          .map((c) => silhouetteGroup(c.nearestTemplate!) === silhouetteGroup(c.pose)),
      ),
    ),
  },
  usage: {
    ...usage,
    imageCostUsd: live ? usage.imageCalls * imageConfig.pricePerImageUsd : 0,
  },
  games: reports.map((r) => ({ game: r.game, error: r.error })),
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'report.html'), renderReport(summary, reports));
console.log(
  JSON.stringify(
    { rates: summary.rates, usage: summary.usage, report: join(out, 'report.html') },
    null,
    2,
  ),
);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function judgeHtml(label: string, judgeSummary: JudgeSummary | undefined): string {
  if (!judgeSummary) return '';
  const parts: string[] = [];
  if (judgeSummary.skipped) parts.push(`<em>skipped: ${escapeHtml(judgeSummary.skipped)}</em>`);
  if (judgeSummary.error)
    parts.push(`<span class="bad">error: ${escapeHtml(judgeSummary.error)}</span>`);
  if (judgeSummary.pose) {
    const p = judgeSummary.pose;
    parts.push(
      `<b class="${p.accepted ? 'ok' : 'bad'}">run pair ${p.accepted ? `accepted ${p.selected}` : 'rejected'}</b> · legs ${p.legAlternation}/5 · anchor id ${p.anchor.identity} side ${p.anchor.sideView} costume ${p.anchor.costume}<br><small>${escapeHtml(p.rationale)}</small>`,
    );
  }
  if (judgeSummary.jump) {
    const j = judgeSummary.jump;
    parts.push(
      `<b class="${j.accepted ? 'ok' : 'bad'}">jump ${j.accepted ? `accepted ${j.selected}` : 'rejected'}</b> · best ${Object.entries(
        j.best,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}<br><small>${escapeHtml(j.rationale)}</small>`,
    );
  }
  return `<div class="judge"><h4>${label}</h4>${parts.join('<br>')}</div>`;
}

function sprite(path: string | undefined, caption: string, note = '', size = ''): string {
  return `<figure>${path ? `<img class="px ${size}" src="${escapeHtml(path)}">` : '<div class="missing">missing</div>'}<figcaption>${escapeHtml(caption)}${note ? `<br><small>${note}</small>` : ''}</figcaption></figure>`;
}

function animation(frames: Array<string | undefined>, caption: string): string {
  if (frames.some((f) => !f)) return '';
  return `<figure><img class="px anim" src="${escapeHtml(frames[0]!)}" data-frames="${escapeHtml(frames.join('|'))}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function renderReport(s: typeof summary, games: GameReport[]): string {
  const rows = games
    .map((g) => {
      const b = g.boards[0];
      const mark = (value: boolean | undefined) => (value === undefined ? '–' : value ? '✓' : '✗');
      const boardMarks = (key: 'pose' | 'jump') =>
        g.boards.map((x) => mark(x.judge?.[key]?.accepted)).join(' ');
      return `<tr><td><a href="#${g.game}">${g.game}</a></td><td>${g.error ? `<span class="bad">${escapeHtml(g.error)}</span>` : g.boards.map((x) => `${x.cells.filter((c) => c.frame).length}/5`).join(', ')}</td><td>${g.boards.map((x) => mark(x.setValid)).join(' ')}</td><td>${boardMarks('pose')} / ${mark(g.productionJudge?.pose?.accepted)}</td><td>${boardMarks('jump')} / ${mark(g.productionJudge?.jump?.accepted)}</td><td>${b ? b.cells.map((c) => (c.iou === undefined ? '–' : c.iou.toFixed(2))).join(' ') : ''}</td></tr>`;
    })
    .join('');
  const sections = games
    .map((g) => {
      const boardsHtml = g.boards
        .map((b) => {
          const a = b.aligned ?? {};
          return `<div class="board"><h3>Template board ${b.index}${b.error ? ` <span class="bad">${escapeHtml(b.error)}</span>` : ''}</h3>
          <div class="row">${b.raw ? `<figure><img class="board-img" src="${escapeHtml(b.raw)}"><figcaption>Muse output</figcaption></figure>` : ''}
          ${b.cells.map((c) => sprite(c.frame, c.pose, c.error ? `<span class="bad">${escapeHtml(c.error)}</span>` : `IoU ${c.iou?.toFixed(2)} · legs ${c.lowerBodyIou?.toFixed(2)} · nearest ${c.nearestTemplate}<br><span class="${(c.residue ?? 0) - (g.identityResidue ?? 0) > 0.15 ? 'bad' : ''}">gray ${((c.residue ?? 0) * 100).toFixed(0)}%</span>`)).join('')}
          ${animation([a.walk1, a.sideIdle, a.walk2, a.sideIdle], 'runtime gait')}
          ${animation([a.walk1, a.runPass, a.walk2, a.runPass], 'with passing frame (reused)')}</div>
          ${b.setValid === false ? `<p class="bad">Production set validation: ${escapeHtml(b.setError ?? '')}</p>` : ''}
          ${judgeHtml('Spark on this board', b.judge)}</div>`;
        })
        .join('');
      const p = g.production;
      return `<section id="${g.game}"><h2>${g.game}</h2>
      <p>${escapeHtml(g.heroConcept ?? '')}${g.build ? ` · mannequin build ${g.build.toFixed(2)} · ×${g.upscale} · identity gray ${((g.identityResidue ?? 0) * 100).toFixed(0)}%` : ''} · <a href="${escapeHtml(g.prompt ?? '')}">prompt</a></p>
      ${g.error ? `<p class="bad">${escapeHtml(g.error)}</p>` : ''}
      <div class="row"><figure><img class="thumb" src="${escapeHtml(g.keyArt ?? '')}"><figcaption>key art (judge source)</figcaption></figure>
      ${g.boardInput ? `<figure><img class="board-img" src="${escapeHtml(g.boardInput)}"><figcaption>board input</figcaption></figure>` : ''}
      ${PLATFORMER_TEMPLATE_POSES.map((pose) => sprite(g.templates?.[pose], `template ${pose}`, '', 'small')).join('')}</div>
      <div class="board"><h3>Production (existing game)</h3><div class="row">
      ${BASE_POSES.map((pose) => sprite(p[pose], pose)).join('')}
      ${animation([p.walk1, p.sideIdle, p.walk2, p.sideIdle], 'runtime gait')}</div></div>
      ${boardsHtml}
      ${judgeHtml('Spark on production frames', g.productionJudge)}
      </section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Template Board Lab</title>
<style>
:root{--bg:#f4f5f7;--fg:#1d2129;--card:#fff;--line:#d9dde4;--ok:#1a7f37;--bad:#c62828;--sprite:#b9c3cf}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--fg:#e6e8ec;--card:#1d2027;--line:#333844;--ok:#5cc87a;--bad:#ff7a7a;--sprite:#3a4250}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
table{border-collapse:collapse;background:var(--card)}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}figure{margin:0;text-align:center}
figcaption{font-size:12px;max-width:240px}img.px{image-rendering:pixelated;height:192px;background:var(--sprite);border-radius:4px}
img.px.small{height:128px}img.board-img{width:256px;height:256px;image-rendering:pixelated}img.thumb{height:192px;max-width:100%;border-radius:4px}
.missing{width:96px;height:192px;display:grid;place-items:center;background:var(--sprite);border-radius:4px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.judge{max-width:560px}h3{margin:12px 0 6px}h2{margin:0 0 4px}
</style></head><body>
<h1>Template board lab · ${escapeHtml(s.mode)} · ${escapeHtml(String(s.options.style))} templates</h1>
<p>${escapeHtml(s.createdAt)} · ${escapeHtml(s.models.image)} · judge ${escapeHtml(s.models.judge)} · ${s.usage.imageCalls} image calls ($${s.usage.imageCostUsd.toFixed(2)}) · ${s.usage.judgeCalls} judge calls${s.usage.judgeCostUsd === null ? '' : ` ($${s.usage.judgeCostUsd.toFixed(3)})`}</p>
<p>Boards with all cells valid ${s.rates.boardsAllCellsValid} · cells ${s.rates.cellsValid} · production set validation ${s.rates.productionSetValid} · run pair accepted template ${s.rates.templatePoseAccepted} vs production ${s.rates.productionPoseAccepted} · jump template ${s.rates.templateJumpAccepted} vs production ${s.rates.productionJumpAccepted} · nearest template is own ${s.rates.nearestTemplateIsOwn} · mannequin gray left ${s.rates.grayBodyLeft}</p>
<p><small>Production frames were already selected from ~9 candidates; each template board is one edit with no retries, judged on its own. Silhouette IoU is a pose signal only: broad characters overlap a slim mannequin less.</small></p>
<table><tr><th>Game</th><th>Cells valid</th><th>Set valid</th><th>Run pair (tmpl / prod)</th><th>Jump (tmpl / prod)</th><th>IoU side·w1·w2·jump·pass</th></tr>${rows}</table>
${sections}
<script>
const timings = [180, 140, 180, 140];
for (const img of document.querySelectorAll('img.anim')) {
  const frames = img.dataset.frames.split('|');
  let i = 0;
  const tick = () => { i = (i + 1) % frames.length; img.src = frames[i]; setTimeout(tick, timings[i % timings.length]); };
  setTimeout(tick, timings[0]);
}
</script></body></html>`;
}
