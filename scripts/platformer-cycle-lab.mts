#!/usr/bin/env tsx
// Eight-frame run-cycle board experiment. For each saved platformer game, put
// its front idle in cell 1 of a 3x3 board and eight consecutive outline
// frames of one run cycle (from scripts/platformer-video-templates.mts) in
// cells 2-9, ask Muse Image to redraw them as the character in one edit, and
// normalize the eight results with one shared scale, ground line, anchor and
// palette. Defaults to mock (the unedited board stands in for Muse); --live
// is paid. Review the output with scripts/platformer-template-review.mts.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { GENERATED_GAME_ASSET_FILES, type PlatformerSpec } from '../packages/shared/src/index';
import {
  PLATFORMER_CYCLE_BOARD_PROMPT_VERSION,
  PLATFORMER_CYCLE_FRAMES,
  PLATFORMER_CYCLE_MANNEQUIN_VERSION,
  measureCycleDiversity,
  measureCycleIdentityShift,
  renderPlatformerCycleTemplates,
  type PlatformerCycleFarLines,
  buildPlatformerCycleBoard,
  buildPlatformerCycleBoardPrompt,
  measureCycleFrameAgreement,
  measureMannequinResidue,
  normalizePlatformerCycle,
  splitPlatformerCycleBoard,
} from '../packages/server/src/assets/platformer-template-board';
import { MetaImageAdapter } from '../packages/server/src/providers/meta-image';
import { ConfigStore } from '../packages/server/src/storage/config';

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
const root = resolve(import.meta.dirname, '..');
const live = process.argv.includes('--live');
/** Rescore a previous run's saved Muse outputs without image calls. */
const reuseDir = arg('reuse') ? resolve(arg('reuse')!) : undefined;
const boards = Math.max(1, Math.min(4, Number(arg('boards') ?? 2)));
const dataDir = resolve(process.env.SPARKADE_DATA ?? join(root, 'data'));
const videoRoot = join(dataDir, 'experiments', 'platformer-video-templates');
/** `--cycle code` uses the hand-posed mannequin cycle instead of video frames. */
const codeCycle = arg('cycle') === 'code';
const cycleDir = codeCycle
  ? 'code'
  : resolve(
      arg('cycle') ??
        join(
          videoRoot,
          readdirSync(videoRoot)
            .filter((name) => existsSync(join(videoRoot, name, 'cycle8')))
            .sort()
            .at(-1) ?? '',
          'cycle8',
        ),
    );
if (!codeCycle && !existsSync(join(cycleDir, 'silhouette')))
  throw new Error(`--cycle needs 0-7.png and silhouette/ (looked in ${cycleDir})`);
const games = (arg('games') ?? DEFAULT_GAMES.join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (games.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('Invalid --games id');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(
  arg('out') ??
    join(
      dataDir,
      'experiments',
      'platformer-templates',
      `${stamp}-cycle-${live ? 'live' : 'mock'}`,
    ),
);
if (live && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const imageConfig = new ConfigStore(dataDir).get().imageGeneration;
const adapter = new MetaImageAdapter({ ...imageConfig, name: 'platformer-cycle-lab' });
// cycle.json is written by the video script; older exports are 8 pale frames.
const cycleSpec: { frames: number; farLines: PlatformerCycleFarLines } = codeCycle
  ? { frames: PLATFORMER_CYCLE_FRAMES, farLines: 'magenta' }
  : existsSync(join(cycleDir, 'cycle.json'))
    ? (JSON.parse(readFileSync(join(cycleDir, 'cycle.json'), 'utf8')) as {
        frames: number;
        farLines: PlatformerCycleFarLines;
      })
    : { frames: 8, farLines: 'pale' };
const frameCount = cycleSpec.frames;
const frameAt = (dir: string) =>
  Array.from({ length: frameCount }, (_, k) => readFileSync(join(dir, `${k}.png`)));
const coded = codeCycle
  ? await renderPlatformerCycleTemplates({ height: 112, farLines: cycleSpec.farLines })
  : undefined;
const templateFrames = coded?.outline ?? frameAt(cycleDir);
const silhouetteFrames = coded?.silhouette ?? frameAt(join(cycleDir, 'silhouette'));

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
let imageCalls = 0;
function write(path: string, contents: Buffer | string): string {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  return relative(out, path);
}
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 800);

interface CycleBoardReport {
  index: number;
  raw?: string;
  error?: string;
  cycle?: string[];
  frames?: Array<{
    height: number;
    lift: number;
    residue: number;
    iou: number;
    nearestPhase: number;
    /** Fraction of the frame still drawn in the magenta far-limb label. */
    magenta: number;
  }>;
  distinct?: number;
  meanPairIou?: number;
  identityShift?: number;
}
interface CycleGameReport {
  game: string;
  kind: 'cycle';
  heroConcept?: string;
  identityResidue?: number;
  boardInput?: string;
  prompt?: string;
  production: Partial<Record<(typeof BASE_POSES)[number], string>>;
  templateCycle?: string[];
  templateMeanPairIou?: number;
  boards: CycleBoardReport[];
  error?: string;
}

async function magentaFraction(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let magenta = 0;
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3]! <= 8) continue;
    opaque++;
    if (data[o]! > 150 && data[o + 2]! > 150 && data[o + 1]! < 120) magenta++;
  }
  return opaque ? magenta / opaque : 0;
}

async function runGame(game: string): Promise<CycleGameReport> {
  const assets = join(dataDir, 'games', game, 'assets');
  const dir = join(out, game);
  const report: CycleGameReport = { game, kind: 'cycle', production: {}, boards: [] };
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
    report.heroConcept = spec.meta?.heroConcept;
    const colors = (spec.palette ?? [])
      .filter((hex) => {
        const r = Number.parseInt(hex.slice(1, 3), 16);
        const g = Number.parseInt(hex.slice(3, 5), 16);
        const b = Number.parseInt(hex.slice(5, 7), 16);
        return !(g > r * 1.15 && g > b * 1.15);
      })
      .join(', ');
    report.identityResidue = await measureMannequinResidue(production.idle);
    const built = await buildPlatformerCycleBoard({
      identity: production.idle,
      frames: templateFrames,
    });
    report.boardInput = write(join(dir, 'board-input.png'), built.board);
    const prompt = buildPlatformerCycleBoardPrompt({
      heroConcept: report.heroConcept,
      colors,
      frameCount,
      farLines: cycleSpec.farLines,
    });
    report.prompt = write(join(dir, 'prompt.txt'), prompt);
    // The requested motion at this character's scale, normalized exactly
    // like the output, from the filled cutouts of the same frames.
    const solid = await buildPlatformerCycleBoard({
      identity: production.idle,
      frames: silhouetteFrames,
    });
    const reference = await normalizePlatformerCycle(
      await splitPlatformerCycleBoard(solid.board, frameCount),
      solid.upscale,
    );
    report.templateMeanPairIou = (await measureCycleDiversity(reference.frames)).meanPairIou;
    report.templateCycle = reference.frames.map((png, k) =>
      write(join(dir, 'template-cycle', `${k}.png`), png),
    );

    report.boards = await Promise.all(
      Array.from({ length: boards }, async (_, i): Promise<CycleBoardReport> => {
        const index = i + 1;
        const boardDir = join(dir, `board-${index}`);
        const board: CycleBoardReport = { index };
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
                      imageFilename: `${game}-cycle-board.png`,
                      outputFormat: 'png',
                      size: '1024x1024',
                      user: 'platformer-cycle-lab',
                    });
                    imageCalls += result.imageCount;
                    return result;
                  })
                ).image
              : built.board;
        } catch (error) {
          board.error = `Muse Image edit failed: ${message(error)}`;
          return board;
        }
        board.raw = write(join(boardDir, 'raw.png'), raw);
        try {
          board.identityShift = await measureCycleIdentityShift(built.board, raw);
          const cells = await splitPlatformerCycleBoard(raw, frameCount);
          for (const cell of cells)
            write(join(boardDir, 'cells', `${cell.index - 1}.png`), cell.raw);
          const cycle = await normalizePlatformerCycle(cells, built.upscale);
          board.cycle = cycle.frames.map((png, k) =>
            write(join(boardDir, 'cycle', `${k}.png`), png),
          );
          board.frames = await Promise.all(
            cycle.frames.map(async (png, k) => {
              const overlaps = await Promise.all(
                reference.frames.map((template) => measureCycleFrameAgreement(png, template)),
              );
              return {
                ...cycle.metrics[k]!,
                residue: await measureMannequinResidue(png),
                iou: overlaps[k]!,
                nearestPhase: overlaps.indexOf(Math.max(...overlaps)),
                magenta: await magentaFraction(png),
              };
            }),
          );
          Object.assign(board, await measureCycleDiversity(cycle.frames));
        } catch (error) {
          board.error = message(error);
        }
        return board;
      }),
    );
  } catch (error) {
    report.error = message(error);
  }
  write(join(dir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(
    `${game}: ${report.error ?? report.boards.map((b) => `board ${b.index} ${b.error ?? 'cycle ok'}`).join('; ')}`,
  );
  return report;
}

mkdirSync(out, { recursive: true });
if (coded)
  for (const [k, png] of coded.outline.entries()) {
    write(join(out, 'cycle-source', `${k}.png`), png);
    write(join(out, 'cycle-source', 'silhouette', `${k}.png`), coded.silhouette[k]!);
  }
console.log(`${live ? 'LIVE' : 'MOCK'} run-cycle board experiment → ${out}`);
const reports: CycleGameReport[] = [];
for (let i = 0; i < games.length; i += 3) {
  reports.push(...(await Promise.all(games.slice(i, i + 3).map(runGame))));
}
const allBoards = reports.flatMap((r) => r.boards);
const average = (values: number[]) =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null;
const rate = (values: boolean[]) =>
  values.length ? `${values.filter(Boolean).length}/${values.length}` : 'n/a';
const frames = reports.flatMap((r) =>
  r.boards.flatMap((b) =>
    (b.frames ?? []).map((f, k) => ({ ...f, k, base: r.identityResidue ?? 0 })),
  ),
);
const summary = {
  mode: live ? 'live' : 'mock',
  createdAt: new Date().toISOString(),
  out,
  options: {
    games,
    boards,
    cycle: cycleDir,
    frames: frameCount,
    farLines: cycleSpec.farLines,
    style: 'outline cycle (imported)',
  },
  versions: {
    board: PLATFORMER_CYCLE_BOARD_PROMPT_VERSION,
    ...(codeCycle ? { mannequin: PLATFORMER_CYCLE_MANNEQUIN_VERSION } : {}),
  },
  models: {
    image: reuseDir
      ? `reused from ${reuseDir}`
      : live
        ? imageConfig.model
        : 'mock (unedited board)',
  },
  rates: {
    boardsWithFullCycle: rate(allBoards.map((b) => Boolean(b.cycle))),
    framesDressed: rate(frames.map((f) => f.residue - f.base <= 0.15)),
    // Phases k and k + count/2 are depth mirrors with near-identical silhouettes.
    framesNearestOwnPhase: rate(
      frames.map((f) => f.nearestPhase % (frameCount / 2) === f.k % (frameCount / 2)),
    ),
    boardsAllPosesDistinct: rate(
      allBoards.filter((b) => b.distinct !== undefined).map((b) => b.distinct === frameCount),
    ),
    framesMagentaLeft: rate(frames.map((f) => f.magenta > 0.02)),
    // Mean color of cell 1 moved by more than 20 (of 441) from the input identity.
    boardsIdentityDrift: rate(
      allBoards.filter((b) => b.identityShift !== undefined).map((b) => b.identityShift! > 20),
    ),
    meanDistinctPoses: average(
      allBoards.flatMap((b) => (b.distinct === undefined ? [] : [b.distinct])),
    ),
    meanPairIou: average(
      allBoards.flatMap((b) => (b.meanPairIou === undefined ? [] : [b.meanPairIou])),
    ),
    templateMeanPairIou: average(
      reports.flatMap((r) => (r.templateMeanPairIou === undefined ? [] : [r.templateMeanPairIou])),
    ),
  },
  usage: { imageCalls, imageCostUsd: live ? imageCalls * imageConfig.pricePerImageUsd : 0 },
  games: reports.map((r) => ({ game: r.game, error: r.error })),
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ rates: summary.rates, usage: summary.usage, out }, null, 2));
