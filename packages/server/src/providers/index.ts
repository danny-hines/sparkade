// Provider factory + per-stage resolution. Pipeline code depends only on the
// Provider interface — no provider checks scattered through business logic.
import {
  DEFAULT_MODEL,
  type Provider,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import { AnthropicProvider } from './anthropic';
import { MetaProvider } from './meta';
import { MockProvider } from './mock';
import { OpenAiCompatProvider } from './openai-compat';

const cache = new Map<string, Provider>();

export function buildProvider(name: string, config: SparkadeConfig): Provider {
  const hit = cache.get(name);
  if (hit) return hit;
  const cfg = config.providers[name];
  if (!cfg) throw new Error(`unknown provider "${name}" — check config.json providers`);
  let provider: Provider;
  switch (cfg.kind) {
    case 'meta':
      provider = new MetaProvider(name, cfg);
      break;
    case 'openai-compatible':
      provider = new OpenAiCompatProvider(name, cfg);
      break;
    case 'anthropic':
      provider = new AnthropicProvider(name, cfg);
      break;
    case 'mock':
      provider = new MockProvider(name);
      break;
  }
  cache.set(name, provider);
  return provider;
}

/** Demo stages stay mock unless its explicit live-voice option enables configured STT. */
export function stageProvider(
  config: SparkadeConfig,
  stage: StageName,
): { provider: Provider; providerName: string; model: string } {
  const override = process.env.SPARKADE_PROVIDER;
  const liveDemoVoice =
    override === 'mock' && stage === 'stt' && process.env.SPARKADE_DEMO_LIVE_VOICE === '1';
  if (override && !liveDemoVoice) {
    return {
      provider: buildProvider(override, config),
      providerName: override,
      model: config.stages[stage]?.model ?? DEFAULT_MODEL,
    };
  }
  const stageCfg = config.stages[stage];
  if (!stageCfg) throw new Error(`no stage config for "${stage}"`);
  return {
    provider: buildProvider(stageCfg.provider, config),
    providerName: stageCfg.provider,
    model: stageCfg.model,
  };
}

export { MockProvider } from './mock';
export { MetaProvider } from './meta';
export { OpenAiCompatProvider } from './openai-compat';
export { AnthropicProvider } from './anthropic';
export { ProviderHttpError, ProviderNetworkError, ProviderAuthError } from './base';
