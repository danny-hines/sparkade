import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    report: () => {},
    generate: async (pose, prompt, reference) => {
      calls.push(pose);
      prompts.push(prompt);
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
    expect(calls).toHaveLength(12);
    expect(calls.filter((pose) => pose === 'wallShoot')).toHaveLength(2);
    expect(prompts.at(-1)).toContain('Aim must point away from the wall');
    expect(readGameAssetManifest(dir)?.assets).toHaveLength(10);
    calls.length = 0;
    options.workspace = new GameAssetWorkspace(dir, 'mock-image');
    options.judge = async (_prompt, _schema, _board, mock) => mock;
    const result = await generatePlatformerActions(options);
    expect(calls).toEqual(['wallShoot']);
    expect(Object.keys(result)).toHaveLength(11);
    calls.length = 0;
    await generatePlatformerActions(options);
    expect(calls).toEqual([]);
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
