// ---------------------------------------------------------------------------
// Meta Model API adapter — EVERY wire-format detail of this API lives in THIS
// file so a human can correct request/response shapes in one place.
//
// Originally verified LIVE against api.meta.ai with a real key on 2026-07-10
// using Muse Spark 1.1; Muse Spark 1.2 retains this protocol:
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
// REASONING: Muse Spark is a reasoning model. Internal reasoning tokens
// count against max_completion_tokens and bill as output; with a tight budget
// the reply comes back content:null + finish_reason:"length". So this adapter
//   (a) sends reasoning_effort (default "low"; config providers.meta.reasoningEffort)
//   (b) adds effort-scaled reasoning headroom on top of the caller's output budget.
//
// AUDIO (verified live): /audio/transcriptions is not a reliable supported
// route on the preview (it has returned both 404 and 5xx). An OpenAI-style
// `input_audio` chat content part DOES work and transcribes accurately.
// transcribe() probes the endpoint, treats an absent/transient response as a
// fallback signal, then retries transient chat-audio failures with backoff.
// If Meta changes shapes, fix it HERE only.
// ---------------------------------------------------------------------------
import type {
  CompleteRequest,
  CompleteResponse,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderUsage,
  TranscriptionResult,
} from '@sparkade/shared';
import { DEFAULT_MODEL, GENERATION } from '@sparkade/shared';
import { sleep } from '../util';
import { needsWavTranscode, transcodeToWav } from './audio';
import { apiKeyFor, httpJson, ProviderHttpError, ProviderNetworkError } from './base';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface TranscriptionEndpointResponse {
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

const DEFAULT_REASONING_EFFORT = 'low';
const VISION_PRIMARY_MODEL = 'muse-spark-1.2-contributor';
const VISION_FALLBACK_MODEL = 'muse-spark-1.1';
const TRANSCRIPTION_PRIMARY_MODEL = 'muse-spark-1.2-contributor';
const TRANSCRIPTION_FALLBACK_MODEL = 'muse-spark-1.1';
const TRANSCRIPTION_LEGACY_PROBE_TIMEOUT_MS = 3_000;
const TRANSCRIPTION_PRIMARY_TIMEOUT_MS = 12_000;
const TRANSCRIPTION_FALLBACK_TIMEOUT_MS = 20_000;
const TRANSCRIPTION_TOTAL_BUDGET_MS = 35_000;
const TRANSCRIPTION_RETRY_DELAYS_MS = [750, 2_000] as const;
const MAX_TRANSCRIPTION_RETRY_AFTER_MS = 5_000;
/** Internal reasoning bills as completion tokens. A fixed 4k surcharge made a
 * tiny minimal-effort repair as expensive as a generation pass, so reserve
 * headroom in proportion to the requested effort. */
const REASONING_HEADROOM_TOKENS = {
  minimal: 1500,
  low: 3000,
  medium: 5000,
  high: 8000,
} as const;

export class MetaProvider implements Provider {
  readonly kind = 'meta' as const;
  readonly capabilities: ProviderCapabilities;
  private baseUrl: string;
  /** Contributor currently returns model_not_found for image-bearing chat
   * requests even while text requests remain healthy. Remember the first
   * authoritative rejection so later art-director calls avoid a doomed probe. */
  private visionFallbackRequired = false;

  constructor(
    readonly name: string,
    private cfg: ProviderConfig,
  ) {
    this.baseUrl = (cfg.baseUrl && cfg.baseUrl.length > 0 ? cfg.baseUrl : DEFAULT_BASE_URL).replace(
      /\/$/,
      '',
    );
    this.capabilities = cfg.capabilities ?? {
      structuredOutput: true,
      audioIn: true,
      imageIn: true,
    };
  }

  private key(): string {
    return apiKeyFor(this.cfg.apiKeyEnv ?? 'META_API_KEY', this.name);
  }

  async complete(
    req: CompleteRequest,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<CompleteResponse> {
    const requestedModel = opts.model ?? DEFAULT_MODEL;

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

    const completeWithModel = async (model: string): Promise<CompleteResponse> => {
      const reasoningEffort = req.effort ?? this.cfg.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userContent },
        ],
        max_completion_tokens: req.maxTokens + REASONING_HEADROOM_TOKENS[reasoningEffort],
        temperature: req.temperature ?? 1,
        reasoning_effort: reasoningEffort,
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
        model,
      };
    };

    const model =
      req.image && requestedModel === VISION_PRIMARY_MODEL && this.visionFallbackRequired
        ? VISION_FALLBACK_MODEL
        : requestedModel;
    try {
      return await completeWithModel(model);
    } catch (error) {
      const missingContributorVision =
        req.image &&
        model === VISION_PRIMARY_MODEL &&
        error instanceof ProviderHttpError &&
        error.status === 404 &&
        /model_not_found/i.test(error.body);
      if (!missingContributorVision) throw error;
      this.visionFallbackRequired = true;
      return completeWithModel(VISION_FALLBACK_MODEL);
    }
  }

  async transcribe(
    audio: Buffer,
    mime: string,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    const model = opts.model ?? DEFAULT_MODEL;
    const startedAt = Date.now();

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
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `recording.${ext}`);
      const res = await httpJson<TranscriptionEndpointResponse>(
        `${this.baseUrl}/audio/transcriptions`,
        {
          headers: { Authorization: `Bearer ${this.key()}` },
          body: form,
          timeoutMs: TRANSCRIPTION_LEGACY_PROBE_TIMEOUT_MS,
          signal: opts.signal,
        },
      );
      if (typeof res.text === 'string') {
        return {
          text: res.text.trim(),
          usage: {
            input: res.usage?.prompt_tokens ?? Math.ceil(audio.length / 320),
            output: res.usage?.completion_tokens ?? Math.ceil((res.text.length + 3) / 4),
          },
          model,
        };
      }
      // fall through to strategy 2 on an unexpected shape
    } catch (e) {
      // The preview has returned both 404 and 5xx for this unsupported route.
      // A transient probe failure must not prevent the supported chat-audio
      // route from getting its own chance.
      const canFallBack =
        e instanceof ProviderHttpError && (e.status === 404 || e.status === 405 || e.transient);
      if (!canFallBack) throw e;
    }

    // Strategy 2: audio as an OpenAI-style input_audio chat content part.
    const format = mime.includes('wav') ? 'wav' : 'mp3';
    const reasoningEffort = this.cfg.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    const buildBody = (candidateModel: string) =>
      JSON.stringify({
        model: candidateModel,
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
        max_completion_tokens: 500 + REASONING_HEADROOM_TOKENS[reasoningEffort],
        temperature: 0,
        reasoning_effort: reasoningEffort,
      });
    const candidateModels =
      model === TRANSCRIPTION_PRIMARY_MODEL ? [model, TRANSCRIPTION_FALLBACK_MODEL] : [model];
    let lastTransientError: unknown;
    for (const [candidateIndex, candidateModel] of candidateModels.entries()) {
      const hasNextCandidate = candidateIndex < candidateModels.length - 1;
      const perCallCapMs = hasNextCandidate
        ? TRANSCRIPTION_PRIMARY_TIMEOUT_MS
        : TRANSCRIPTION_FALLBACK_TIMEOUT_MS;

      for (let attempt = 0; attempt <= GENERATION.maxTransientRetriesPerCall; attempt++) {
        const remainingMs = TRANSCRIPTION_TOTAL_BUDGET_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) throw lastTransientError ?? transcriptionBudgetError();

        try {
          const res = await httpJson<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, {
            headers: {
              Authorization: `Bearer ${this.key()}`,
              'Content-Type': 'application/json',
            },
            body: buildBody(candidateModel),
            timeoutMs: Math.min(perCallCapMs, remainingMs),
            signal: opts.signal,
          });
          return {
            text: (res.choices?.[0]?.message?.content ?? '').trim(),
            usage: normalizeUsage(res.usage),
            model: candidateModel,
          };
        } catch (e) {
          if (!isTransientTranscriptionError(e)) throw e;
          lastTransientError = e;

          // Do not spend the interactive voice budget retrying an unhealthy
          // preferred model when the known-good fallback is still available.
          if (hasNextCandidate) break;
          if (attempt >= GENERATION.maxTransientRetriesPerCall) throw e;

          const retryAfterMs =
            e instanceof ProviderHttpError && e.retryAfterS
              ? Math.min(e.retryAfterS * 1_000, MAX_TRANSCRIPTION_RETRY_AFTER_MS)
              : 0;
          const delayMs = Math.max(retryAfterMs, TRANSCRIPTION_RETRY_DELAYS_MS[attempt] ?? 2_000);
          const remainingAfterCall = TRANSCRIPTION_TOTAL_BUDGET_MS - (Date.now() - startedAt);
          if (remainingAfterCall <= delayMs + 1_000) throw e;
          await sleep(delayMs, opts.signal);
        }
      }
    }
    throw lastTransientError ?? transcriptionBudgetError();
  }
}

function isTransientTranscriptionError(error: unknown): boolean {
  return (
    (error instanceof ProviderHttpError && error.transient) || error instanceof ProviderNetworkError
  );
}

function transcriptionBudgetError(): ProviderHttpError {
  return new ProviderHttpError('transcription timed out', 408, null, '');
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
