import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_MODEL,
  DEFAULT_MODEL,
  DEFAULT_STT_MODEL,
  STAGE_NAMES,
} from '@sparkade/shared';
import { ConfigStore, defaultConfig } from '../src/storage/config';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-config-test-'));
  dirs.push(dir);
  return dir;
}

describe('config defaults and migrations', () => {
  it('uses Muse Wonder for design, Muse Voice for STT and Spark 1.3 Contributor elsewhere on a fresh install', () => {
    const config = new ConfigStore(tempDir()).get();
    for (const stage of STAGE_NAMES) {
      expect(config.stages[stage].provider).toBe('meta');
      expect(config.stages[stage].model).toBe(
        stage === 'stt'
          ? DEFAULT_STT_MODEL
          : stage === 'design'
            ? DEFAULT_DESIGN_MODEL
            : DEFAULT_MODEL,
      );
    }
    expect(DEFAULT_DESIGN_MODEL).toBe('muse-wonder-1.0');
    expect(config.pricing['muse-spark-1.1']).toBeDefined();
    expect(config.pricing[DEFAULT_MODEL]).toBeDefined();
    expect(config.pricing[DEFAULT_DESIGN_MODEL]).toEqual({
      inputPerM: 4,
      outputPerM: 20,
      cachedInputPerM: 0.2,
    });
    expect(config.pricing[DEFAULT_STT_MODEL]).toEqual({ audioPerHour: 0.18 });
  });

  it('migrates only legacy Meta stage defaults and persists only those changes', () => {
    const dir = tempDir();
    const path = join(dir, 'config.json');
    const legacy = defaultConfig();
    delete (legacy.stages as Partial<typeof legacy.stages>).review;
    legacy.stages.design = { provider: 'meta', model: 'muse-spark-1.1' };
    legacy.stages.levels = {
      provider: 'meta',
      model: 'muse-spark-1.2-contributor',
      reasoningEffort: 'high',
    };
    legacy.stages.entities = { provider: 'compat', model: 'muse-spark-1.1' };
    legacy.stages.music = { provider: 'meta', model: 'muse-spark-1.2' };
    legacy.stages.repair = { provider: 'meta', model: 'custom-meta-model' };
    legacy.stages.stt = { provider: 'meta', model: 'muse-spark-1.2-contributor' };
    legacy.audio.musicVol = 0.123;
    writeFileSync(path, JSON.stringify(legacy, null, 2));

    const config = new ConfigStore(dir).get();
    expect(config.stages.design.model).toBe(DEFAULT_DESIGN_MODEL);
    expect(config.stages.review).toEqual({ provider: 'meta', model: DEFAULT_MODEL });
    expect(config.stages.levels).toEqual({
      provider: 'meta',
      model: DEFAULT_MODEL,
      reasoningEffort: 'high',
    });
    expect(config.stages.entities).toEqual({ provider: 'compat', model: 'muse-spark-1.1' });
    expect(config.stages.music).toEqual({ provider: 'meta', model: 'muse-spark-1.2' });
    expect(config.stages.repair).toEqual({ provider: 'meta', model: 'custom-meta-model' });
    expect(config.stages.stt.model).toBe(DEFAULT_STT_MODEL);
    expect(config.audio.musicVol).toBe(0.123);

    const persisted = JSON.parse(readFileSync(path, 'utf8')) as typeof legacy;
    expect(persisted.stages).toEqual(config.stages);
    expect(persisted.audio.musicVol).toBe(0.123);
  });

  it('moves a stock Spark 1.3 design row to Wonder and keeps review calls on Spark', () => {
    const dir = tempDir();
    const previous = defaultConfig();
    delete (previous.stages as Partial<typeof previous.stages>).review;
    previous.stages.design = { provider: 'meta', model: DEFAULT_MODEL };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(previous, null, 2));

    const config = new ConfigStore(dir).get();

    expect(config.stages.design).toEqual({ provider: 'meta', model: DEFAULT_DESIGN_MODEL });
    expect(config.stages.review).toEqual({ provider: 'meta', model: DEFAULT_MODEL });
    expect(config.stages.levels.model).toBe(DEFAULT_MODEL);
  });

  it('keeps a customized design provider for both design and the new review stage', () => {
    const dir = tempDir();
    const custom = defaultConfig();
    delete (custom.stages as Partial<typeof custom.stages>).review;
    custom.stages.design = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(custom, null, 2));

    const config = new ConfigStore(dir).get();

    expect(config.stages.design).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(config.stages.review).toEqual(config.stages.design);
  });

  it('ignores retired likeness switches so old configs cannot disable Muse generation', () => {
    const dir = tempDir();
    const legacy = {
      ...defaultConfig(),
      likeness: {
        describeInStory: true,
        smartFeatures: false,
        style: 'photo',
        portraitGen: { enabled: false },
      },
    };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(legacy, null, 2));

    const config = new ConfigStore(dir).get();

    expect(config.likeness).toEqual({ describeInStory: true });
    expect(config.imageGeneration).toMatchObject({
      model: 'muse-image-1.0',
      pricePerImageUsd: 0.01,
    });
    expect(config.imageGeneration).not.toHaveProperty('enabled');
  });
});
