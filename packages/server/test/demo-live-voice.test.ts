import { afterEach, expect, it, vi } from 'vitest';
import { STAGE_NAMES } from '@sparkade/shared';
import { defaultConfig } from '../src/storage/config';
import { stageProvider } from '../src/providers/index';

afterEach(() => vi.unstubAllEnvs());

it('keeps every ordinary demo stage mock, including transcription', () => {
  vi.stubEnv('SPARKADE_PROVIDER', 'mock');
  vi.stubEnv('SPARKADE_DEMO_LIVE_VOICE', '0');
  for (const stage of STAGE_NAMES) {
    expect(stageProvider(defaultConfig(), stage).providerName).toBe('mock');
  }
});

it('opts only speech recognition into the configured live provider', () => {
  vi.stubEnv('SPARKADE_PROVIDER', 'mock');
  vi.stubEnv('SPARKADE_DEMO_LIVE_VOICE', '1');
  const config = defaultConfig();
  for (const stage of STAGE_NAMES) {
    expect(stageProvider(config, stage).providerName).toBe(stage === 'stt' ? 'meta' : 'mock');
  }
  expect(stageProvider(config, 'stt').model).toBe(config.stages.stt.model);
});

it('does not override an explicitly selected non-demo provider', () => {
  vi.stubEnv('SPARKADE_PROVIDER', 'compat');
  vi.stubEnv('SPARKADE_DEMO_LIVE_VOICE', '1');
  const config = defaultConfig();
  config.providers.compat!.baseUrl = 'https://example.invalid/v1';
  expect(stageProvider(config, 'stt').providerName).toBe('compat');
});
