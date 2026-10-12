import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN_MODEL, DEFAULT_MODEL, DEFAULT_PRICING } from '@sparkade/shared';
import { estimateGenerationCost } from '../src/pipeline/cost';
import { generationEstimate } from '../src/pipeline/generation-estimate';
import { stageProvider } from '../src/providers/index';
import { defaultConfig } from '../src/storage/config';

afterEach(() => vi.unstubAllEnvs());

it('runs review on Spark while design runs on Wonder by default', () => {
  vi.stubEnv('SPARKADE_PROVIDER', '');
  const config = defaultConfig();
  expect(stageProvider(config, 'design').model).toBe(DEFAULT_DESIGN_MODEL);
  expect(stageProvider(config, 'review').model).toBe(DEFAULT_MODEL);
});

it('resumes pre-review job snapshots with their design row for review calls', () => {
  vi.stubEnv('SPARKADE_PROVIDER', '');
  const snapshot = defaultConfig();
  snapshot.stages.design = { provider: 'meta', model: DEFAULT_MODEL };
  delete (snapshot.stages as Partial<typeof snapshot.stages>).review;
  expect(stageProvider(snapshot, 'review')).toMatchObject({
    providerName: 'meta',
    model: DEFAULT_MODEL,
  });
});

it('prices only the design pass at Wonder rates in the review-screen estimate', () => {
  const models = {
    design: DEFAULT_DESIGN_MODEL,
    levels: DEFAULT_MODEL,
    entities: DEFAULT_MODEL,
    music: DEFAULT_MODEL,
    review: DEFAULT_MODEL,
  };
  const options = { platformerBossJudge: true, platformerEnemyJudge: true };
  const hybrid = estimateGenerationCost(models, DEFAULT_PRICING, options)!;
  const spark = estimateGenerationCost(DEFAULT_MODEL, DEFAULT_PRICING, options)!;
  const wonder = estimateGenerationCost(DEFAULT_DESIGN_MODEL, DEFAULT_PRICING, options)!;
  // Typical design pass: 5,200 input + 1,800 output tokens.
  const designDelta = (5200 * (4 - 0.1) + 1800 * (20 - 0.2)) / 1e6;
  expect(hybrid - spark).toBeCloseTo(designDelta, 9);
  expect(hybrid).toBeLessThan(wonder / 4);
  expect(
    estimateGenerationCost({ ...models, review: 'unknown' }, DEFAULT_PRICING, options),
  ).toBeNull();

  const estimate = generationEstimate(defaultConfig(), false, 'platformer', false);
  expect(estimate.model).toBe(DEFAULT_DESIGN_MODEL);
  expect(estimate.usd).not.toBeNull();
});
