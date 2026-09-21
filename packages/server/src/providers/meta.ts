// ---------------------------------------------------------------------------
// Meta Model API adapter — EVERY wire-format detail of this API lives in THIS
// file so a human can correct request/response shapes in one place.
//
// Originally verified LIVE against api.meta.ai with a real key on 2026-07-10
// using Muse Spark 1.1; Muse Spark 1.2 and 1.3 retain this protocol:
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
// AUDIO (verified live): Muse Voice Transcribe accepts 16/24 kHz mono PCM WAV
// at POST /asr/transcribe. Sparkade uses PUSH_TO_TALK because the cabinet UI
// already delimits each recording. Public-preview endpoint/rate/transient
// failures fall back to the proven `input_audio` chat path; authoritative bad
// audio and authentication errors do not. If Meta changes shapes, fix it HERE.
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
import { DEFAULT_MODEL, DEFAULT_STT_MODEL, GENERATION } from '@sparkade/shared';
import { sleep } from '../util';
import { needsWavTranscode, transcodeToWav } from './audio';
import { metaApiKeyFor, httpJson, ProviderHttpError, ProviderNetworkError } from './base';

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

interface VoiceTranscriptionResponse {
  transcript?: string;
  audioDurationMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

const DEFAULT_REASONING_EFFORT = 'low';
const CONTRIBUTOR_FALLBACK_MODEL = 'muse-spark-1.2-contributor';
const LEGACY_FALLBACK_MODEL = 'muse-spark-1.1';
const MODEL_UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1_000;
const VOICE_TRANSCRIPTION_MODEL = DEFAULT_STT_MODEL;
const TRANSCRIPTION_PRIMARY_MODEL = DEFAULT_MODEL;
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
  /** Spark 1.2 Contributor currently returns model_not_found for image-bearing chat
   * requests even while text requests remain healthy. Remember the first
   * authoritative rejection so later art-director calls avoid a doomed probe. */
  private visionFallbackRequired = false;
  /** A newly rolled-out default can briefly be absent in one serving region.
   * Avoid probing it on every generation call, but retry it without requiring
   * a cabinet restart once the short rollout cooldown expires. */
  private primaryUnavailableUntil = 0;

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
    return metaApiKeyFor(this.cfg.apiKeyEnv ?? 'META_API_KEY', this.name);
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

    const primaryAvailable = Date.now() >= this.primaryUnavailableUntil;
    const candidateModels =
      requestedModel === DEFAULT_MODEL
        ? primaryAvailable
          ? [requestedModel, req.image ? LEGACY_FALLBACK_MODEL : CONTRIBUTOR_FALLBACK_MODEL]
          : [req.image ? LEGACY_FALLBACK_MODEL : CONTRIBUTOR_FALLBACK_MODEL]
        : req.image && requestedModel === CONTRIBUTOR_FALLBACK_MODEL
          ? this.visionFallbackRequired
            ? [LEGACY_FALLBACK_MODEL]
            : [requestedModel, LEGACY_FALLBACK_MODEL]
          : [requestedModel];

    let lastError: unknown;
    for (const [index, model] of candidateModels.entries()) {
      try {
        return await completeWithModel(model);
      } catch (error) {
        lastError = error;
        const hasFallback = index < candidateModels.length - 1;
        const primaryFallback = model === DEFAULT_MODEL && isModelAvailabilityError(error);
        const missingContributorVision =
          req.image && model === CONTRIBUTOR_FALLBACK_MODEL && isModelNotFoundError(error);
        if (!hasFallback || (!primaryFallback && !missingContributorVision)) throw error;
        if (model === DEFAULT_MODEL && isModelNotFoundError(error)) {
          this.primaryUnavailableUntil = Date.now() + MODEL_UNAVAILABLE_COOLDOWN_MS;
        }
        if (missingContributorVision) this.visionFallbackRequired = true;
      }
    }
    throw lastError;
  }

  async transcribe(
    audio: Buffer,
    mime: string,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    const requestedModel = opts.model ?? DEFAULT_MODEL;
    const startedAt = Date.now();

    // input_audio accepts only wav/mp3 (format:"webm" → 400, verified live).
    // Browsers record webm/opus, so transcode first. Done before strategy 1 too
    // so both paths send a format the API is known to take.
    if (needsWavTranscode(mime)) {
      audio = await transcodeToWav(audio);
      mime = 'audio/wav';
    }

    const dedicatedVoiceRequested = requestedModel === VOICE_TRANSCRIPTION_MODEL;
    if (dedicatedVoiceRequested) {
      try {
        const form = new FormData();
        form.append(
          'request',
          new Blob(
            [
              JSON.stringify({
                mode: 'PUSH_TO_TALK',
                model: requestedModel,
                audioEncoding: 'WAV',
              }),
            ],
            { type: 'application/json' },
          ),
        );
        form.append(
          'audio',
          new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
          'recording.wav',
        );
        const res = await httpJson<VoiceTranscriptionResponse>(`${this.baseUrl}/asr/transcribe`, {
          headers: { Authorization: `Bearer ${this.key()}` },
          body: form,
          timeoutMs: TRANSCRIPTION_PRIMARY_TIMEOUT_MS,
          signal: opts.signal,
        });
        return {
          text: (res.transcript ?? '').trim(),
          usage: {
            input: 0,
            output: 0,
            ...(Number.isFinite(res.audioDurationMs)
              ? { audioSeconds: Math.floor(Math.max(0, res.audioDurationMs ?? 0) / 1_000) }
              : {}),
          },
          model: requestedModel,
        };
      } catch (e) {
        // The voice API is a public preview. Preserve the proven chat-audio
        // path for endpoint/rate/transient failures, while surfacing bad audio,
        // authentication, and other authoritative request errors immediately.
        if (!isTransientVoiceError(e)) throw e;
      }
    }

    const model = dedicatedVoiceRequested ? TRANSCRIPTION_PRIMARY_MODEL : requestedModel;

    // Strategy 1: OpenAI-compatible /audio/transcriptions multipart endpoint.
    if (!dedicatedVoiceRequested) {
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
      model === TRANSCRIPTION_PRIMARY_MODEL
        ? [
            ...(Date.now() >= this.primaryUnavailableUntil ? [model] : []),
            CONTRIBUTOR_FALLBACK_MODEL,
            LEGACY_FALLBACK_MODEL,
          ]
        : model === CONTRIBUTOR_FALLBACK_MODEL
          ? [model, LEGACY_FALLBACK_MODEL]
          : [model];
    let lastRetryableError: unknown;
    for (const [candidateIndex, candidateModel] of candidateModels.entries()) {
      const hasNextCandidate = candidateIndex < candidateModels.length - 1;
      const perCallCapMs = hasNextCandidate
        ? TRANSCRIPTION_PRIMARY_TIMEOUT_MS
        : TRANSCRIPTION_FALLBACK_TIMEOUT_MS;

      for (let attempt = 0; attempt <= GENERATION.maxTransientRetriesPerCall; attempt++) {
        const remainingMs = TRANSCRIPTION_TOTAL_BUDGET_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) throw lastRetryableError ?? transcriptionBudgetError();

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
          const retryable = isTransientTranscriptionError(e);
          const modelUnavailable = isModelNotFoundError(e);
          if (!retryable && !modelUnavailable) throw e;
          lastRetryableError = e;

          if (candidateModel === TRANSCRIPTION_PRIMARY_MODEL && modelUnavailable) {
            this.primaryUnavailableUntil = Date.now() + MODEL_UNAVAILABLE_COOLDOWN_MS;
          }

          // Do not spend the interactive voice budget retrying an unhealthy
          // preferred model when the known-good fallback is still available.
          if (hasNextCandidate && isModelAvailabilityError(e)) break;
          if (modelUnavailable) throw e;
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
    throw lastRetryableError ?? transcriptionBudgetError();
  }
}

function isModelNotFoundError(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError &&
    error.status === 404 &&
    /model_not_found/i.test(error.body)
  );
}

/** Switch models only when the selected model is missing, timed out, or its
 * serving backend is unhealthy. Authentication, invalid requests, ordinary
 * 404s, and shared rate limits must surface through their normal retry path. */
function isModelAvailabilityError(error: unknown): boolean {
  return (
    isModelNotFoundError(error) ||
    (error instanceof ProviderHttpError && (error.status === 408 || error.status >= 500))
  );
}

function isTransientTranscriptionError(error: unknown): boolean {
  return (
    (error instanceof ProviderHttpError && error.transient) || error instanceof ProviderNetworkError
  );
}

function isTransientVoiceError(error: unknown): boolean {
  return (
    isTransientTranscriptionError(error) ||
    (error instanceof ProviderHttpError && (error.status === 404 || error.status === 405))
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
