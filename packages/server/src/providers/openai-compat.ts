// Generic OpenAI-compatible adapter (chat completions + Whisper-style STT).
// Point providers.compat.baseUrl at any compatible server (vLLM, llama.cpp,
// LM Studio, a proxy, …). Capabilities come from config — structured output is
// only sent when capabilities.structuredOutput is set.
import type {
  CompleteRequest,
  CompleteResponse,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderUsage,
} from '@sparkade/shared';
import { GENERATION } from '@sparkade/shared';
import { transcodeToWav } from './audio';
import { apiKeyFor, httpJson, ProviderHttpError } from './base';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatProvider implements Provider {
  readonly kind = 'openai-compatible' as const;
  readonly capabilities: ProviderCapabilities;
  private baseUrl: string;

  constructor(
    readonly name: string,
    private cfg: ProviderConfig,
  ) {
    if (!cfg.baseUrl) {
      // Constructed lazily only when a stage actually selects this provider;
      // failing loudly here beats a confusing fetch error later.
      throw new Error(`provider "${name}" (openai-compatible) needs a baseUrl in config.json`);
    }
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.capabilities = cfg.capabilities ?? { structuredOutput: false, audioIn: false, imageIn: false };
  }

  private key(): string {
    return apiKeyFor(this.cfg.apiKeyEnv ?? 'COMPAT_API_KEY', this.name);
  }

  async complete(
    req: CompleteRequest,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<CompleteResponse> {
    let userContent: unknown = req.user;
    if (req.image && this.capabilities.imageIn) {
      userContent = [
        { type: 'text', text: req.user },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.image.toString('base64')}` } },
      ];
    }
    const body: Record<string, unknown> = {
      model: opts.model ?? 'default',
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 1,
    };
    if (req.jsonSchema && this.capabilities.structuredOutput) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'sparkade_output', schema: req.jsonSchema, strict: false },
      };
    }
    const res = await httpJson<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, {
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: req.timeoutMs ?? GENERATION.perCallTimeoutMs,
      signal: opts.signal,
    });
    return {
      text: res.choices?.[0]?.message?.content ?? '',
      usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
    };
  }

  /** Whisper-style /audio/transcriptions; converts webm→wav via ffmpeg on 4xx format rejections. */
  async transcribe(
    audio: Buffer,
    mime: string,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<{ text: string; usage: ProviderUsage }> {
    try {
      return await this.postTranscription(audio, mime, opts);
    } catch (e) {
      const formatRejected =
        e instanceof ProviderHttpError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 429;
      if (!formatRejected || mime.includes('wav')) throw e;
      const wav = await transcodeToWav(audio);
      return await this.postTranscription(wav, 'audio/wav', opts);
    }
  }

  private async postTranscription(
    audio: Buffer,
    mime: string,
    opts: { model?: string; signal?: AbortSignal },
  ): Promise<{ text: string; usage: ProviderUsage }> {
    const form = new FormData();
    const ext = mime.includes('wav') ? 'wav' : 'webm';
    form.append('model', opts.model ?? 'whisper-1');
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `recording.${ext}`);
    const res = await httpJson<{ text?: string }>(`${this.baseUrl}/audio/transcriptions`, {
      headers: { Authorization: `Bearer ${this.key()}` },
      body: form,
      timeoutMs: GENERATION.perCallTimeoutMs,
      signal: opts.signal,
    });
    const text = (res.text ?? '').trim();
    // STT APIs rarely report token usage; estimate for the ledger (marked cheap).
    return { text, usage: { input: Math.ceil(audio.length / 320), output: Math.ceil((text.length + 3) / 4) } };
  }
}
