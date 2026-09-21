import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  apiKeyFor,
  metaApiKeyFor,
  ProviderAuthError,
  ProviderHttpError,
  withMetaApiKey,
} from '../src/providers/base';
import { MetaProvider } from '../src/providers/meta';
import { MetaImageAdapter } from '../src/providers/meta-image';
import { MetaSamAdapter } from '../src/providers/meta-sam';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('isolates overlapping kiosk credentials across text, voice, image and segmentation calls', async () => {
  vi.stubEnv('META_API_KEY', 'shared-key');
  vi.stubEnv('OTHER_KEY', 'other-provider-key');
  const requests: { url: string; key: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      requests.push({ url: String(url), key: new Headers(init.headers).get('authorization')! });
      if (url.includes('/images/'))
        return Response.json({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
      if (url.endsWith('/responses')) return Response.json({ status: 'completed', output: [] });
      if (url.includes('/transcribe')) return Response.json({ transcript: 'A game about a moon' });
      return Response.json({ choices: [{ message: { content: '{}' } }], usage: {} });
    }),
  );
  // The same provider instances serve both kiosks, as they do in the factory cache.
  const text = new MetaProvider('meta', { kind: 'meta' });
  const images = new MetaImageAdapter();
  const mask = new MetaSamAdapter();
  const png = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  const run = async (key: string | null) =>
    withMetaApiKey(key, async () => {
      expect(apiKeyFor('OTHER_KEY', 'other')).toBe('other-provider-key');
      await Promise.all([
        text.complete(
          { system: 'Test', user: 'Test', maxTokens: 100 },
          { model: 'muse-spark-1.2-contributor' },
        ),
        text.transcribe(Buffer.from('audio'), 'audio/wav', { model: 'muse-voice-transcribe-1.0' }),
        images.generate({ prompt: 'Test' }),
        images.edit({ prompt: 'Test', image: png }),
        mask.segmentImage(png, 'person'),
      ]);
      await Promise.resolve();
      expect(metaApiKeyFor('META_API_KEY', 'meta')).toBe(key ?? 'shared-key');
    });
  await Promise.all([run('event-a'), run('event-b'), run(null)]);
  for (const key of ['event-a', 'event-b', 'shared-key']) {
    expect(requests.filter((r) => r.key === `Bearer ${key}`)).toHaveLength(5);
  }
  expect(process.env.META_API_KEY).toBe('shared-key');
  expect(metaApiKeyFor('META_API_KEY', 'meta')).toBe('shared-key');
});

it.each([401, 403, 429])(
  'does not use shared billing after an override returns HTTP %s',
  async (status) => {
    vi.stubEnv('META_API_KEY', 'shared-key');
    const fetchMock = vi.fn(async () => new Response('event-private-key', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const failure = await withMetaApiKey('event-private-key', () =>
      new MetaImageAdapter().generate({ prompt: 'Test' }),
    ).catch((e) => e);
    expect(failure).toBeInstanceOf(status === 429 ? ProviderHttpError : ProviderAuthError);
    expect(`${failure.message} ${failure.body ?? ''}`).not.toContain('event-private-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get(
        'authorization',
      ),
    ).toBe('Bearer event-private-key');
  },
);

it('rejects an empty override instead of using the environment key', async () => {
  vi.stubEnv('META_API_KEY', 'shared-key');
  await expect(
    withMetaApiKey('', async () => metaApiKeyFor('META_API_KEY', 'meta')),
  ).rejects.toThrow('unavailable');
});
