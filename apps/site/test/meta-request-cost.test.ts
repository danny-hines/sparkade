import { expect, it } from 'vitest';
import { defaultConfig } from '@sparkade/server/storage/config';
import { metaRequestAllowance, requestAllowance } from '../lib/meta-request-cost';
import { parseMetaKeyLimits } from '../lib/kiosk-meta-spend';
const config = defaultConfig();
const pricing = {
  config,
  pricing: config.pricing,
  imagePricing: { model: config.imageGeneration.model, perImageUsd: 0.01 },
};
const audioForm = () => {
  const audio = Buffer.alloc(44 + 32000 * 3);
  audio.write('RIFF');
  audio.writeUInt32LE(0xffffffff, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(0xffffffff, 40);
  const body = new FormData();
  body.set('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0' })]));
  body.set('audio', new Blob([new Uint8Array(audio)]));
  return body;
};
it('prices streamed WAV input conservatively and uses reported voice duration when available', async () => {
  const allowance = await metaRequestAllowance(
    'https://api.meta.ai/v1/asr/transcribe',
    audioForm(),
    pricing,
  );
  expect(allowance.operation).toBe('voice');
  expect(allowance.reserved).toBeCloseTo(0.00015, 6);
  expect(allowance.actual({ audioDurationMs: 2500 })).toBeCloseTo(0.0001, 6);
  expect(allowance.actual({})).toBeNull();
  const bad = audioForm();
  bad.set('audio', new Blob(['invalid audio']));
  await expect(
    metaRequestAllowance('https://api.meta.ai/v1/asr/transcribe', bad, pricing),
  ).rejects.toThrow('duration');
});
it('uses cached token rates without changing the conservative reservation', () => {
  const allowance = requestAllowance(
    'https://api.meta.ai/v1/chat/completions',
    JSON.stringify({
      model: 'muse-spark-1.1',
      max_completion_tokens: 4000,
      messages: [],
    }),
    pricing,
  );
  expect(allowance.reserved).toBeGreaterThan(0.01);
  expect(
    allowance.actual({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 800 },
      },
    }),
  ).toBeCloseTo(0.000795, 6);
  expect(allowance.actual({ usage: { prompt_tokens: -1, completion_tokens: 100 } })).toBeNull();
});
it('prices image edits and segmentation and refuses unpriced operations', async () => {
  const image = new FormData();
  image.set('model', 'muse-image-1.0');
  image.set('n', '1');
  expect(
    (await metaRequestAllowance('https://api.meta.ai/v1/images/edits', image, pricing)).reserved,
  ).toBe(0.01);
  expect(
    (
      await metaRequestAllowance(
        'https://api.meta.ai/v1/responses',
        JSON.stringify({ model: 'sam-3.1', input: [{ content: [{ type: 'input_image' }] }] }),
        pricing,
      )
    ).reserved,
  ).toBe(0.0025);
  await expect(
    metaRequestAllowance(
      'https://api.meta.ai/v1/chat/completions',
      JSON.stringify({ model: 'unpriced', max_completion_tokens: 100 }),
      pricing,
    ),
  ).rejects.toThrow('pricing');
});
it('distinguishes an uncapped budget from a zero budget and rejects invalid limits', () => {
  expect(parseMetaKeyLimits({ dailyUsd: '', weeklyUsd: '0', concurrency: '2' })).toEqual({
    dailyUsd: null,
    weeklyUsd: 0,
    concurrency: 2,
  });
  for (const value of ['NaN', 'Infinity', '-1', '1e3', '0.001', '1000000001']) {
    expect(() => parseMetaKeyLimits({ dailyUsd: value, weeklyUsd: '', concurrency: '' })).toThrow(
      'Budgets',
    );
  }
  for (const value of ['0', '1.5', '10001', '-5', 'abc']) {
    expect(() => parseMetaKeyLimits({ dailyUsd: '', weeklyUsd: '', concurrency: value })).toThrow(
      'Concurrent',
    );
  }
});
