import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestAllowance } from '../lib/website-spend';
import { defaultConfig } from '@sparkade/server/storage/config';
import { JobState } from '@sparkade/server/pipeline/job-state';
import { httpJson } from '@sparkade/server/providers/base';
import { withProviderRequestPolicy } from '@sparkade/server/providers/request-policy';
const state = () => {
  const db = new JobState();
  db.state.config = defaultConfig();
  db.state.pricing = { 'priced-model': { inputPerM: 1, outputPerM: 2 } };
  return db.state;
};
afterEach(() => vi.unstubAllGlobals());
describe('provider spend policy', () => {
  it('reserves text and reasoning allowance, reconciles valid usage, and preserves unknown charges', () => {
    const budget = requestAllowance(
      'https://api.meta.ai/v1/chat/completions',
      JSON.stringify({
        model: 'priced-model',
        messages: [{ content: 'Hello' }],
        max_completion_tokens: 8000,
      }),
      state(),
    );
    expect(budget.reserved).toBeGreaterThan(0.02);
    expect(budget.actual({ usage: { prompt_tokens: 100, completion_tokens: 200 } })).toBe(0.0005);
    expect(budget.actual({ usage: {} })).toBeNull();
  });
  it('fails closed for unpriced models, unconstrained outputs, and other endpoints', () => {
    expect(() =>
      requestAllowance(
        'https://api.meta.ai/v1/chat/completions',
        '{"model":"unknown","max_completion_tokens":100}',
        state(),
      ),
    ).toThrow('pricing');
    expect(() =>
      requestAllowance(
        'https://api.meta.ai/v1/chat/completions',
        '{"model":"priced-model"}',
        state(),
      ),
    ).toThrow('output limit');
    expect(() =>
      requestAllowance('https://example.com/v1/chat/completions', '{}', state()),
    ).toThrow('priced provider');
    expect(() =>
      requestAllowance('https://api.meta.ai/v1/audio/transcriptions', '{}', state()),
    ).toThrow('not enabled');
  });
  it('does not call fetch when admission fails', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      withProviderRequestPolicy(
        async () => {
          throw new Error('Budget exhausted');
        },
        () =>
          httpJson('https://api.meta.ai/v1/chat/completions', {
            headers: {},
            body: '{}',
            timeoutMs: 1000,
          }),
      ),
    ).rejects.toThrow('Budget exhausted');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('applies the request-local guard to every HTTP attempt without leaking it to other requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1 } })),
    );
    const settle = vi.fn(async () => {}),
      guard = vi.fn(async () => settle);
    const request = () =>
      httpJson('https://api.meta.ai/v1/chat/completions', {
        headers: {},
        body: '{}',
        timeoutMs: 1000,
      });
    await withProviderRequestPolicy(guard, async () => {
      await request();
      await request();
    });
    await request();
    expect(guard).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(2);
  });
});
