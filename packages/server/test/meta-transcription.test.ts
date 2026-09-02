import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaProvider } from '../src/providers/meta';
import { ProviderHttpError } from '../src/providers/base';

const originalMetaApiKey = process.env.META_API_KEY;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalMetaApiKey === undefined) delete process.env.META_API_KEY;
  else process.env.META_API_KEY = originalMetaApiKey;
});

describe('MetaProvider completion', () => {
  it('falls back from Muse Spark 1.3 Contributor to 1.2 Contributor on a temporary text outage', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(503, 'new model backend unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().complete(textRequest());

    expect(result).toMatchObject({ text: '{"ok":true}', model: 'muse-spark-1.2-contributor' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestModel(fetchMock, 0)).toBe('muse-spark-1.3-contributor');
    expect(requestModel(fetchMock, 1)).toBe('muse-spark-1.2-contributor');
  });

  it('temporarily remembers a missing 1.3 rollout and selects modality-safe fallbacks', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(modelNotFoundResponse())
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const meta = provider();

    const first = await meta.complete(textRequest());
    const second = await meta.complete(textRequest());
    const vision = await meta.complete(visionRequest());

    expect(first.model).toBe('muse-spark-1.2-contributor');
    expect(second.model).toBe('muse-spark-1.2-contributor');
    expect(vision.model).toBe('muse-spark-1.1');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([0, 1, 2, 3].map((index) => requestModel(fetchMock, index))).toEqual([
      'muse-spark-1.3-contributor',
      'muse-spark-1.2-contributor',
      'muse-spark-1.2-contributor',
      'muse-spark-1.1',
    ]);
  });

  it('does not switch models for a shared rate limit', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(errorResponse(429, 'slow down'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await provider()
      .complete(textRequest())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 429, transient: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to Muse Spark 1.1 when Contributor rejects an image-bearing request', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(modelNotFoundResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"visible":true}' } }],
          usage: { prompt_tokens: 22, completion_tokens: 7 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().complete(visionRequest(), {
      model: 'muse-spark-1.2-contributor',
    });

    expect(result).toEqual({
      text: '{"visible":true}',
      usage: { input: 22, output: 7, cachedInput: 0 },
      model: 'muse-spark-1.1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestModel(fetchMock, 0)).toBe('muse-spark-1.2-contributor');
    expect(requestModel(fetchMock, 1)).toBe('muse-spark-1.1');
  });

  it('remembers the vision fallback while leaving later text calls on Contributor', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(modelNotFoundResponse())
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const meta = provider();

    await meta.complete(visionRequest(), { model: 'muse-spark-1.2-contributor' });
    const secondVision = await meta.complete(visionRequest(), {
      model: 'muse-spark-1.2-contributor',
    });
    const text = await meta.complete(
      { system: 'Return JSON.', user: 'Return ok.', maxTokens: 20 },
      { model: 'muse-spark-1.2-contributor' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestModel(fetchMock, 2)).toBe('muse-spark-1.1');
    expect(requestModel(fetchMock, 3)).toBe('muse-spark-1.2-contributor');
    expect(secondVision.model).toBe('muse-spark-1.1');
    expect(text.model).toBe('muse-spark-1.2-contributor');
  });

  it('does not mask unrelated image-request 404s', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(errorResponse(404, 'bad route'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await provider()
      .complete(visionRequest(), { model: 'muse-spark-1.2-contributor' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('MetaProvider transcription', () => {
  it('uses Muse Voice file transcription and records billed audio seconds', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        sessionId: 'session-1',
        transcript: 'a moon rabbit collecting lanterns',
        audioDurationMs: 3_920,
        turns: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(Buffer.from('wav audio'), 'audio/wav', {
      model: 'muse-voice-transcribe-1.0',
    });

    expect(result).toEqual({
      text: 'a moon rabbit collecting lanterns',
      usage: { input: 0, output: 0, audioSeconds: 3 },
      model: 'muse-voice-transcribe-1.0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]).endsWith('/asr/transcribe')).toBe(true);
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(JSON.parse(await (form.get('request') as Blob).text())).toEqual({
      mode: 'PUSH_TO_TALK',
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
    });
    expect((form.get('audio') as Blob).type).toBe('audio/wav');
  });

  it('falls back directly to Muse Spark chat audio when the voice preview is transiently down', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(503, 'voice backend unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'fallback transcript' } }],
          usage: { prompt_tokens: 18, completion_tokens: 5 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(Buffer.from('wav audio'), 'audio/wav', {
      model: 'muse-voice-transcribe-1.0',
    });

    expect(result).toEqual({
      text: 'fallback transcript',
      usage: { input: 18, output: 5, cachedInput: 0 },
      model: 'muse-spark-1.3-contributor',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0]).endsWith('/chat/completions')).toBe(true);
    expect(requestModel(fetchMock, 1)).toBe('muse-spark-1.3-contributor');
  });

  it('does not hide authoritative Muse Voice request errors behind the fallback', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(400, 'unsupported audio'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await provider()
      .transcribe(Buffer.from('wav audio'), 'audio/wav', {
        model: 'muse-voice-transcribe-1.0',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 400, transient: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to chat audio when the legacy endpoint returns a transient 5xx', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(500, 'internal server error'))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'a castle in space' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(Buffer.from('wav audio'), 'audio/wav');

    expect(result).toEqual({
      text: 'a castle in space',
      usage: { input: 12, output: 4, cachedInput: 0 },
      model: 'muse-spark-1.3-contributor',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0]).endsWith('/audio/transcriptions')).toBe(true);
    expect(String(fetchMock.mock.calls[1]?.[0]).endsWith('/chat/completions')).toBe(true);
  });

  it('falls back from 1.3 Contributor to 1.2 Contributor after a transient audio failure', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'not found'))
      .mockResolvedValueOnce(errorResponse(503, 'backend unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'underwater detective' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(Buffer.from('wav audio'), 'audio/wav');

    expect(result).toMatchObject({
      text: 'underwater detective',
      model: 'muse-spark-1.2-contributor',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestModel(fetchMock, 1)).toBe('muse-spark-1.3-contributor');
    expect(requestModel(fetchMock, 2)).toBe('muse-spark-1.2-contributor');
  });

  it('uses 1.1 only after both Contributor models have transient audio failures', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'not found'))
      .mockResolvedValueOnce(errorResponse(503, '1.3 backend unavailable'))
      .mockResolvedValueOnce(errorResponse(503, '1.2 backend unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'underwater detective' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(Buffer.from('wav audio'), 'audio/wav');

    expect(result).toMatchObject({
      text: 'underwater detective',
      model: 'muse-spark-1.1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([1, 2, 3].map((index) => requestModel(fetchMock, index))).toEqual([
      'muse-spark-1.3-contributor',
      'muse-spark-1.2-contributor',
      'muse-spark-1.1',
    ]);
  });

  it('falls back to 1.2 when the preferred audio request reaches its 12 second timeout', async () => {
    vi.useFakeTimers();
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'not found'))
      .mockImplementationOnce((_input, init) => pendingFetch(init))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'fallback transcript' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = provider().transcribe(Buffer.from('wav audio'), 'audio/wav');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      text: 'fallback transcript',
      model: 'muse-spark-1.2-contributor',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries transient 1.1 failures within the remaining total budget', async () => {
    vi.useFakeTimers();
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'not found'))
      .mockResolvedValueOnce(errorResponse(503, 'preferred backend unavailable'))
      .mockResolvedValueOnce(errorResponse(503, 'fallback backend unavailable'))
      .mockResolvedValueOnce(errorResponse(503, 'fallback backend unavailable'))
      .mockResolvedValueOnce(errorResponse(503, 'fallback backend unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'eventual transcript' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = provider().transcribe(Buffer.from('wav audio'), 'audio/wav');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      text: 'eventual transcript',
      model: 'muse-spark-1.1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('stops after the bounded fallback retry budget when all three models are unavailable', async () => {
    vi.useFakeTimers();
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(500, 'legacy route unavailable'))
      .mockResolvedValue(errorResponse(503, 'backend unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = provider().transcribe(Buffer.from('wav audio'), 'audio/wav');
    const rejection = expect(pending).rejects.toMatchObject({ status: 503, transient: true });
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('does not fall back for non-transient chat-audio errors', async () => {
    process.env.META_API_KEY = 'meta-test-key';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'not found'))
      .mockResolvedValueOnce(errorResponse(400, 'invalid audio'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await provider()
      .transcribe(Buffer.from('wav audio'), 'audio/wav')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 400, transient: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function provider(): MetaProvider {
  return new MetaProvider('meta', {
    kind: 'meta',
    apiKeyEnv: 'META_API_KEY',
    capabilities: { structuredOutput: true, audioIn: true, imageIn: true },
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function modelNotFoundResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'model_not_found', message: 'The requested model was not found.' },
    }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
}

function visionRequest() {
  return {
    system: 'Return JSON.',
    user: 'Inspect the image.',
    maxTokens: 20,
    image: Buffer.from('png'),
    jsonSchema: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    },
  };
}

function textRequest() {
  return {
    system: 'Return JSON.',
    user: 'Return ok.',
    maxTokens: 20,
    jsonSchema: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    },
  };
}

function requestModel(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  callIndex: number,
): string {
  const body = fetchMock.mock.calls[callIndex]?.[1]?.body;
  return JSON.parse(String(body)).model as string;
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
