// ---------------------------------------------------------------------------
// Meta Model API adapter — EVERY wire-format detail of this API lives in THIS
// file so a human can correct request/response shapes in one place.
//
// Verified LIVE against api.meta.ai with a real key on 2026-07-10 (the day
// after muse-spark-1.1 shipped on the public preview):
//   endpoint   POST {baseUrl}/chat/completions        (baseUrl default https://api.meta.ai/v1)
//   auth       Authorization: Bearer $META_API_KEY
//   body       { model, messages:[{role, content}], max_completion_tokens,
//                temperature, reasoning_effort, response_format? }
//              ("max_tokens" is a deprecated alias — we send max_completion_tokens)
//   structured response_format: { type: "json_schema",
//                json_schema: { name, schema, strict: false } }   → WORKS (valid JSON back)
//   images     OpenAI-style content parts: { type: "image_url",
//                image_url: { url: "data:image/png;base64,..." } } → WORKS
//   response   choices[0].message.content ; usage.prompt_tokens / completion_tokens
//
// REASONING: muse-spark-1.1 is a reasoning model. Internal reasoning tokens
// count against max_completion_tokens and bill as output; with a tight budget
// the reply comes back content:null + finish_reason:"length". So this adapter
//   (a) sends reasoning_effort (default "low"; config providers.meta.reasoningEffort)
//   (b) adds REASONING_HEADROOM_TOKENS on top of the caller's output budget.
//
// AUDIO (verified live): /audio/transcriptions returns 404 — it does not
// exist on the preview. An OpenAI-style `input_audio` chat content part DOES
// work and transcribes accurately. transcribe() still tries the endpoint
// first (cheap 404) so it lights up automatically if Meta ships it, then
// falls back to the chat route. If Meta changes shapes, fix it HERE only.
// ---------------------------------------------------------------------------
import type {
  CompleteRequest,
  CompleteResponse,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderUsage,
} from '@sparkade/shared';
import { GENERATION } from '@sparkade/shared';
import { needsWavTranscode, transcodeToWav } from './audio';
import { apiKeyFor, httpJson, ProviderHttpError } from './base';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface TranscriptionResponse {
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

/** Extra completion budget for the model's internal reasoning (bills as output). */
const REASONING_HEADROOM_TOKENS = 4000;
const DEFAULT_REASONING_EFFORT = 'low';

export class MetaProvider implements Provider {
  readonly kind = 'meta' as const;
  readonly capabilities: ProviderCapabilities;
  private baseUrl: string;

  constructor(
    readonly name: string,
    private cfg: ProviderConfig,
  ) {
    this.baseUrl = (cfg.baseUrl && cfg.baseUrl.length > 0 ? cfg.baseUrl : DEFAULT_BASE_URL).replace(/\/$/, '');
    this.capabilities = cfg.capabilities ?? { structuredOutput: true, audioIn: true, imageIn: true };
  }

  private key(): string {
    return apiKeyFor(this.cfg.apiKeyEnv ?? 'META_API_KEY', this.name);
  }

  async complete(
    req: CompleteRequest,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<CompleteResponse> {
    const model = opts.model ?? 'muse-spark-1.1';

    // User content: plain string, or multi-part when an image rides along.
    let userContent: unknown = req.user;
    if (req.image && this.capabilities.imageIn) {
      userContent = [
        { type: 'text', text: req.user },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${req.image.toString('base64')}` },
        },
      ];
    }

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: req.maxTokens + REASONING_HEADROOM_TOKENS,
      temperature: req.temperature ?? 1,
      reasoning_effort: req.effort ?? this.cfg.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    };
    if (req.jsonSchema && this.capabilities.structuredOutput) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'sparkade_output', schema: req.jsonSchema, strict: false },
      };
    }

    const res = await httpJson<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, {
      headers: {
        Authorization: `Bearer ${this.key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: req.timeoutMs ?? GENERATION.perCallTimeoutMs,
      signal: opts.signal,
    });

    return {
      text: res.choices?.[0]?.message?.content ?? '',
      usage: normalizeUsage(res.usage),
    };
  }

  async transcribe(
    audio: Buffer,
    mime: string,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<{ text: string; usage: ProviderUsage }> {
    const model = opts.model ?? 'muse-spark-1.1';

    // input_audio accepts only wav/mp3 (format:"webm" → 400, verified live).
    // Browsers record webm/opus, so transcode first. Done before strategy 1 too
    // so both paths send a format the API is known to take.
    if (needsWavTranscode(mime)) {
      audio = await transcodeToWav(audio);
      mime = 'audio/wav';
    }

    // Strategy 1: OpenAI-compatible /audio/transcriptions multipart endpoint.
    try {
      const form = new FormData();
      const ext = mime.includes('webm') ? 'webm' : mime.includes('wav') ? 'wav' : 'ogg';
      form.append('model', model);
      form.append(
        'file',
        new Blob([new Uint8Array(audio)], { type: mime }),
        `recording.${ext}`,
      );
      const res = await httpJson<TranscriptionResponse>(`${this.baseUrl}/audio/transcriptions`, {
        headers: { Authorization: `Bearer ${this.key()}` },
        body: form,
        timeoutMs: GENERATION.perCallTimeoutMs,
        signal: opts.signal,
      });
      if (typeof res.text === 'string') {
        return {
          text: res.text.trim(),
          usage: {
            input: res.usage?.prompt_tokens ?? Math.ceil(audio.length / 320),
            output: res.usage?.completion_tokens ?? Math.ceil((res.text.length + 3) / 4),
          },
        };
      }
      // fall through to strategy 2 on an unexpected shape
    } catch (e) {
      // 404/405 → the endpoint doesn't exist (yet); try the chat-content route.
      if (!(e instanceof ProviderHttpError && (e.status === 404 || e.status === 405))) throw e;
    }

    // Strategy 2: audio as an OpenAI-style input_audio chat content part.
    const format = mime.includes('wav') ? 'wav' : 'mp3';
    const res = await httpJson<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, {
      headers: {
        Authorization: `Bearer ${this.key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Transcribe the audio exactly as spoken. Output ONLY the transcript text, no commentary.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: audio.toString('base64'), format },
              },
            ],
          },
        ],
        max_completion_tokens: 500 + REASONING_HEADROOM_TOKENS,
        temperature: 0,
        reasoning_effort: this.cfg.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      }),
      timeoutMs: GENERATION.perCallTimeoutMs,
      signal: opts.signal,
    });
    return {
      text: (res.choices?.[0]?.message?.content ?? '').trim(),
      usage: normalizeUsage(res.usage),
    };
  }
}

function normalizeUsage(u?: ChatCompletionResponse['usage']): ProviderUsage {
  return {
    input: u?.prompt_tokens ?? 0,
    output: u?.completion_tokens ?? 0,
    // Automatic prefix caching: this slice of prompt_tokens bills at $0.15/M
    // instead of $1.25/M (verified live 2026-07-10).
    cachedInput: u?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}
