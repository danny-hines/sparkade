import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MetaImageAdapter,
  META_IMAGE_DEFAULT_BASE_URL,
  META_IMAGE_DEFAULT_MODEL,
} from '../src/providers/meta-image';
import { ProviderAuthError, ProviderHttpError } from '../src/providers/base';

const originalMetaApiKey = process.env.META_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMetaApiKey === undefined) delete process.env.META_API_KEY;
  else process.env.META_API_KEY = originalMetaApiKey;
});

describe('MetaImageAdapter', () => {
  it('sends a one-off generation request and decodes its base64 image', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const expectedImage = Buffer.from('generated-webp-bytes');
    const usage = { total_tokens: 77, generated_images: 1, nested: { text_tokens: 12 } };
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse({
          data: [
            {
              b64_json: expectedImage.toString('base64'),
              revised_prompt: 'A refined arcade cabinet',
            },
          ],
          usage,
        });
      }),
    );

    const result = await new MetaImageAdapter().generate({
      prompt: 'An arcade cabinet in a neon forest',
      outputFormat: 'webp',
      size: '1536x1024',
      user: 'game-123',
      reasoningStrength: { level: 'high', budget: 4 },
      toolEnablement: ['reference_images'],
    });

    expect(capturedUrl).toBe(`${META_IMAGE_DEFAULT_BASE_URL}/images/generations`);
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({
      Authorization: 'Bearer meta-test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      model: META_IMAGE_DEFAULT_MODEL,
      prompt: 'An arcade cabinet in a neon forest',
      n: 1,
      response_format: 'b64_json',
      output_format: 'webp',
      size: '1536x1024',
      user: 'game-123',
      reasoning_strength: { level: 'high', budget: 4 },
      tool_enablement: ['reference_images'],
    });
    expect(result.image.equals(expectedImage)).toBe(true);
    expect(result).toMatchObject({
      usage,
      outputFormat: 'webp',
      imageCount: 1,
      revisedPrompt: 'A refined arcade cabinet',
    });
  });

  it('sends multipart edits without overriding the fetch boundary', async () => {
    process.env.MUSE_TEST_KEY = 'custom-key';
    const sourceImage = Buffer.from('source-png-bytes');
    const outputImage = Buffer.from('edited-png-bytes');
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse({ data: [{ b64_json: outputImage.toString('base64') }] });
      }),
    );

    const adapter = new MetaImageAdapter({
      baseUrl: 'https://example.test/meta/v1///',
      model: 'muse-image-test',
      apiKeyEnv: 'MUSE_TEST_KEY',
      name: 'test-image-provider',
    });
    const result = await adapter.edit({
      prompt: 'Turn this person into a pixel-art hero',
      image: sourceImage,
      imageMimeType: 'image/webp',
      imageFilename: 'player.webp',
      responseFormat: 'b64_json',
      reasoningStrength: 0.75,
      toolEnablement: false,
    });

    expect(capturedUrl).toBe('https://example.test/meta/v1/images/edits');
    expect(capturedInit?.headers).toEqual({ Authorization: 'Bearer custom-key' });
    const form = capturedInit?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'image'))).toEqual({
      model: 'muse-image-test',
      prompt: 'Turn this person into a pixel-art hero',
      n: '1',
      response_format: 'b64_json',
      output_format: 'png',
      reasoning_strength: '0.75',
      tool_enablement: 'false',
    });
    const submittedImage = form.get('image');
    expect(submittedImage).toBeInstanceOf(Blob);
    expect((submittedImage as Blob).type).toBe('image/webp');
    expect(Buffer.from(await (submittedImage as Blob).arrayBuffer()).equals(sourceImage)).toBe(
      true,
    );
    expect(result.image.equals(outputImage)).toBe(true);
    expect(result).toMatchObject({ outputFormat: 'png', imageCount: 1, usage: undefined });
    delete process.env.MUSE_TEST_KEY;
  });

  it('uses the configured per-call model and timeout overrides', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return jsonResponse({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
      }),
    );

    await new MetaImageAdapter({ timeoutMs: 5_000 }).generate(
      { prompt: 'A tiny dragon' },
      { model: 'muse-image-canary', timeoutMs: 1_000 },
    );

    expect(capturedBody?.model).toBe('muse-image-canary');
  });

  it('maps missing and rejected credentials to ProviderAuthError', async () => {
    delete process.env.META_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new MetaImageAdapter().generate({ prompt: 'A hero' })).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.META_API_KEY = 'rejected-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid token', { status: 401 })),
    );
    await expect(new MetaImageAdapter().generate({ prompt: 'A hero' })).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it('preserves HTTP status, retry hints, and transient classification', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('capacity exhausted', {
            status: 429,
            headers: { 'retry-after': '7' },
          }),
      ),
    );

    const error = await new MetaImageAdapter()
      .generate({ prompt: 'A boss arena' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 429, retryAfterS: 7, transient: true });
  });

  it('propagates caller aborts using the existing provider convention', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => pendingFetch(init)),
    );
    const controller = new AbortController();

    const pending = new MetaImageAdapter().generate(
      { prompt: 'An elaborate arcade panorama' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
  });

  it('classifies its own timeout as a transient HTTP 408', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => pendingFetch(init)),
    );

    const error = await new MetaImageAdapter()
      .generate({ prompt: 'A slow image' }, { timeoutMs: 5 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 408, transient: true });
  });

  it('rejects response bodies without usable base64 image data', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ b64_json: '%%%bad' }] })),
    );

    await expect(new MetaImageAdapter().generate({ prompt: 'A hero' })).rejects.toThrow(
      'invalid base64 image data',
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function pendingFetch(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true,
    });
  });
}
