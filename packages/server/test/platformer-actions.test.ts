import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLATFORMER_BASE_POSES,
  platformerActionReference,
  type PlatformerBasePose,
  type PlatformerSpec,
} from '@sparkade/shared';
import {
  buildPlatformerActionPrompt,
  generatePlatformerActions,
  type PlatformerActionGenerationOptions,
} from '../src/assets/platformer-actions';
import { GameAssetWorkspace, readGameAssetManifest } from '../src/assets/manifest';
import { mockGeneratedImage } from '../src/assets/game-art';
import { prepareGeneratedPlatformerReference } from '../src/assets/platformer-pose';
import { ArtifactCache } from '../src/pipeline/artifact-cache';
import { PipelineSuspended } from '../src/pipeline/durable';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const golden = join(__dirname, '../../generation/golden');
const base = Object.fromEntries(
  PLATFORMER_BASE_POSES.map((pose) => [
    pose,
    readFileSync(
      join(
        golden,
        `golden-platformer.assets/platformer-player-${pose === 'sideIdle' ? 'side-idle' : pose === 'walk1' ? 'walk-1' : pose === 'walk2' ? 'walk-2' : pose}.png`,
      ),
    ),
  ]),
) as Record<PlatformerBasePose, Buffer>;
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-actions-'));
  dirs.push(dir);
  const calls: string[] = [];
  const prompts: string[] = [];
  const options: PlatformerActionGenerationOptions = {
    spec: {
      ...JSON.parse(readFileSync(join(golden, 'golden-platformer.json'), 'utf8')),
      playStyle: 'armedClimber',
    } as PlatformerSpec,
    base,
    source: base.idle,
    sourceKind: 'key-art',
    wardrobe: { heroConcept: 'Charcoal jumpsuit and amber vest' },
    workspace: new GameAssetWorkspace(dir, 'mock-image'),
    cache: new ArtifactCache(join(dir, 'private')),
    attempt: 1,
    report: () => {},
    generate: async (pose, prompt, reference) => {
      calls.push(pose);
      prompts.push(prompt);
      if (!prompt.includes('RIGHT panel is an arm geometry guide'))
        expect(
          reference.equals(
            await prepareGeneratedPlatformerReference(
              platformerActionReference(pose) === 'wallSlide'
                ? readFileSync(join(dir, 'platformer-player-wall-slide.png'))
                : base[platformerActionReference(pose) as PlatformerBasePose],
            ),
          ),
        ).toBe(true);
      return mockGeneratedImage(prompt);
    },
    judge: async (_prompt, _schema, _board, mockDecision) => mockDecision,
  };
  return { dir, options, calls, prompts };
}

describe('mechanic-specific image pipeline', () => {
  it('submits independent review batches before waiting for either', async () => {
    const { options } = setup();
    const pending: Array<() => void> = [];
    let released = false;
    options.judge = async (_prompt, _schema, _board, mock) => {
      if (!released) await new Promise<void>((resolve) => pending.push(resolve));
      return mock;
    };
    const run = generatePlatformerActions(options);
    try {
      await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 15_000 });
    } finally {
      released = true;
      pending.forEach((resolve) => resolve());
    }
    expect(Object.keys(await run)).toHaveLength(11);
  });
  it('uses action directions without leaking idle or no-attack jump instructions', () => {
    expect(buildPlatformerActionPrompt('jumpShoot')).toContain('airborne jump');
    expect(buildPlatformerActionPrompt('jumpShoot')).not.toContain('neutral standing pose');
    expect(buildPlatformerActionPrompt('jumpShoot')).not.toContain('no attack in progress');
    expect(buildPlatformerActionPrompt('wallShoot')).toContain('free arm LEFT');
    expect(buildPlatformerActionPrompt('wallShoot')).toContain('Hands remain empty');
  });

  it('persists accepted actions and retries only a rejected wall-shot, including after failure/restart', async () => {
    const { dir, options, calls, prompts } = setup();
    options.judge = async (_prompt, _schema, _board, mock) => {
      const result = structuredClone(mock) as {
        candidateReviews: { id: string; fatalIssues: string[]; summary: string }[];
      };
      for (const r of result.candidateReviews)
        if (r.id === 'wallShoot') {
          r.fatalIssues = ['Aim must point away from the wall'];
          r.summary = 'Wrong aim';
        }
      return result;
    };
    await expect(generatePlatformerActions(options)).rejects.toThrow('wallShoot');
    expect(calls).toHaveLength(14);
    expect(calls.filter((pose) => pose === 'wallShoot')).toHaveLength(4);
    expect(prompts.at(-1)).toContain('Aim must point away from the wall');
    expect(readGameAssetManifest(dir)?.assets).toHaveLength(10);
    calls.length = 0;
    options.workspace = new GameAssetWorkspace(dir, 'mock-image');
    options.cache = new ArtifactCache(join(dir, 'private'));
    await expect(generatePlatformerActions(options)).rejects.toThrow('wallShoot');
    expect(calls).toEqual([]);
    options.attempt++;
    options.judge = async (_prompt, _schema, _board, mock) => mock;
    const result = await generatePlatformerActions(options);
    expect(calls).toEqual(['wallShoot']);
    expect(Object.keys(result)).toHaveLength(11);
    calls.length = 0;
    await generatePlatformerActions(options);
    expect(calls).toEqual([]);
  });

  it('automatically repairs a rejected upward pose within its persisted budget', async () => {
    const { options, calls, prompts } = setup();
    let reviews = 0;
    options.judge = async (_prompt, _schema, _board, mock) => {
      const result = structuredClone(mock) as {
        candidateReviews: { id: string; fatalIssues: string[]; summary: string }[];
      };
      for (const review of result.candidateReviews) {
        if (review.id === 'runShootUp1' && ++reviews < 4) {
          review.fatalIssues = ['Palm aims forward instead of up'];
          review.summary = 'Keep the running stride and bend the elbow to aim upward';
        }
      }
      return result;
    };
    expect(Object.keys(await generatePlatformerActions(options))).toHaveLength(11);
    expect(calls.filter((p) => p === 'runShootUp1')).toHaveLength(4);
    expect(prompts.filter((p) => p.includes('RIGHT panel is an arm geometry guide'))).toHaveLength(
      3,
    );
  });

  it('reuses processed candidates when review suspends without spending the repair budget', async () => {
    const { options, calls, dir } = setup();
    options.judge = async () => {
      throw new PipelineSuspended();
    };
    await expect(generatePlatformerActions(options)).rejects.toBeInstanceOf(PipelineSuspended);
    const initialCalls = [...calls];
    options.cache = new ArtifactCache(join(dir, 'private'));
    options.judge = async (_prompt, _schema, _board, mock) => mock;
    await generatePlatformerActions(options);
    expect(calls.slice(initialCalls.length).sort()).toEqual(['wallShoot', 'wallShootUp']);
  });

  it('keeps an in-flight review board stable when more images complete', async () => {
    const { options } = setup();
    const generate = options.generate;
    let releaseImages = false;
    const first = new Set(['shoot', 'runShoot1', 'runShoot2']);
    options.generate = async (pose, prompt, reference) => {
      if (!releaseImages && !first.has(pose)) throw new PipelineSuspended();
      return generate(pose, prompt, reference);
    };
    const boards: string[][] = [];
    options.judge = async (_prompt, _schema, _board, mock) => {
      boards.push(
        (mock as { candidateReviews: { id: string }[] }).candidateReviews.map((r) => r.id),
      );
      throw new PipelineSuspended();
    };
    await expect(generatePlatformerActions(options)).rejects.toBeInstanceOf(PipelineSuspended);
    expect(boards).toEqual([['shoot', 'runShoot1', 'runShoot2']]);
    releaseImages = true;
    await expect(generatePlatformerActions(options)).rejects.toBeInstanceOf(PipelineSuspended);
    expect(boards.slice(1)).toContainEqual(boards[0]);
    expect(
      boards
        .slice(1)
        .flat()
        .filter((id) => first.has(id))
        .sort(),
    ).toEqual([...first].sort());
  });

  it('fails closed if a judge omits the required action review', async () => {
    const { options } = setup();
    options.spec.playStyle = 'towerClimber';
    options.spec.abilityLoadout = [{ kind: 'shield', name: 'Guard', visualConcept: 'A crest' }];
    options.judge = async () => ({
      candidateReviews: [],
      selection: { accepted: true, candidateId: 'wallSlide' },
    });
    await expect(generatePlatformerActions(options)).rejects.toThrow('wallSlide');
  });
});
