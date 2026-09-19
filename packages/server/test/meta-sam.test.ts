import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { decodeMaskToRaster } from '@meta-sam/parser';
import { MetaSamAdapter } from '../src/providers/meta-sam';
import { ProviderAuthError, ProviderHttpError } from '../src/providers/base';
import fixture from './fixtures/sam/curly-silhouette.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const source = () =>
  sharp({ create: { width: 24, height: 24, channels: 4, background: '#00ff00' } })
    .png()
    .toBuffer();
const response = (text = fixture.wire, status = 'completed') => ({
  id: 'sam-response-1',
  status,
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
});
function mockResponse(body: unknown, status = 200) {
  vi.stubEnv('META_API_KEY', 'test-key');
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('SAM still-image adapter', () => {
  it('sends one concept and decodes a real one-bit payload with inclusive wire bounds', async () => {
    const fetch = mockResponse(response());
    const result = await new MetaSamAdapter().segmentImage(await source(), 'curly-haired person');
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.meta.ai/v1/responses');
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      model: 'sam-3.1',
      stream: false,
      metadata: { mask_encoding: 'one_bit' },
    });
    expect(body.input[0].content[0]).toEqual({ type: 'input_text', text: 'curly-haired person' });
    expect(body.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/);
    expect(result.masks[0]?.bounds).toEqual({ left: 7, top: 4, right: 17, bottom: 20 });
    expect([...decodeMaskToRaster(result.masks[0]!.mask)]).toEqual(
      [...fixture.rows.join('')].map((value) => (value === '#' ? 1 : 0)),
    );
    expect(result.responseId).toBe('sam-response-1');
  });
  it('keeps zero matches as a valid result', async () => {
    mockResponse(response(''));
    expect((await new MetaSamAdapter().segmentImage(await source(), 'person')).masks).toHaveLength(
      0,
    );
  });
  it.each([
    [response(fixture.wire, 'incomplete'), 'completed'],
    [response(fixture.wire.replace('w=24', 'w=25')), 'dimensions'],
    [response('not a mask'), 'malformed'],
    [response(fixture.wire.slice(0, -4)), 'malformed'],
    [{ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, 'refused'],
  ])('rejects unusable output instead of returning a partial mask', async (body, error) => {
    mockResponse(body);
    await expect(new MetaSamAdapter().segmentImage(await source(), 'person')).rejects.toThrow(
      error,
    );
  });
  it('uses the existing HTTP and authentication errors', async () => {
    mockResponse({}, 429);
    await expect(
      new MetaSamAdapter().segmentImage(await source(), 'person'),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    mockResponse({}, 403);
    await expect(
      new MetaSamAdapter().segmentImage(await source(), 'person'),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });
  it('does not call the provider for an empty concept or an already canceled request', async () => {
    const fetch = mockResponse(response());
    const image = await source();
    await expect(new MetaSamAdapter().segmentImage(image, ' ')).rejects.toThrow('subject');
    await expect(
      new MetaSamAdapter().segmentImage(image, 'person', { signal: AbortSignal.abort() }),
    ).rejects.toThrow('aborted');
    expect(fetch).not.toHaveBeenCalled();
  });
});
