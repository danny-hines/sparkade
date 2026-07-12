// Anthropic Messages API adapter.
//   endpoint  POST https://api.anthropic.com/v1/messages
//   headers   x-api-key, anthropic-version: 2023-06-01
//   body      { model, max_tokens, system, messages, temperature }
//   images    { type: "image", source: { type: "base64", media_type, data } }
//   response  content[0].text ; usage.input_tokens / output_tokens
// No native JSON-Schema response mode (capabilities.structuredOutput=false →
// the prompt template enforces raw-JSON output) and no STT.
import type {
  CompleteRequest,
  CompleteResponse,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
} from '@sparkade/shared';
import { GENERATION } from '@sparkade/shared';
import { apiKeyFor, httpJson } from './base';

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements Provider {
  readonly kind = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities;
  private baseUrl: string;

  constructor(
    readonly name: string,
    private cfg: ProviderConfig,
  ) {
    this.baseUrl = (cfg.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.capabilities = cfg.capabilities ?? { structuredOutput: false, audioIn: false, imageIn: true };
  }

  async complete(
    req: CompleteRequest,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<CompleteResponse> {
    const content: unknown[] = [{ type: 'text', text: req.user }];
    if (req.image && this.capabilities.imageIn) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: req.image.toString('base64') },
      });
    }
    const res = await httpJson<MessagesResponse>(`${this.baseUrl}/v1/messages`, {
      headers: {
        'x-api-key': apiKeyFor(this.cfg.apiKeyEnv ?? 'ANTHROPIC_API_KEY', this.name),
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model ?? 'claude-sonnet-5',
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content }],
        temperature: req.temperature ?? 1,
      }),
      timeoutMs: GENERATION.perCallTimeoutMs,
      signal: opts.signal,
    });
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    return {
      text,
      usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
    };
  }
}
