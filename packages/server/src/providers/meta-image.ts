// Meta Muse Image adapter for one-off image generation and image edits.
//
// This module deliberately stays separate from the text Provider interface:
// image calls have different request shapes, fixed per-image billing, and
// binary results. Pipeline/config integration can therefore evolve without
// leaking image-specific concerns into chat completion providers.
import { GENERATION } from '@sparkade/shared';
import { metaApiKeyFor, httpJson } from './base';

export const META_IMAGE_DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
export const META_IMAGE_DEFAULT_MODEL = 'muse-image-1.0';
export const META_IMAGE_DEFAULT_API_KEY_ENV = 'META_API_KEY';

export type MetaImageOutputFormat = 'png' | 'webp' | 'jpeg';
export type MetaImageResponseFormat = 'b64_json';

/** Muse-specific controls are intentionally pass-through until Meta publishes
 * a stable enum/schema for them. Keeping the values JSON-compatible still
 * prevents accidental functions, class instances, or other wire-unsafe data. */
export type MetaImageJsonValue =
  null | boolean | number | string | MetaImageJsonValue[] | { [key: string]: MetaImageJsonValue };

export interface MetaImageAdapterConfig {
  baseUrl?: string;
  model?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  /** Name used in authentication errors. */
  name?: string;
}

export interface MetaImageRequest {
  prompt: string;
  /** The one-off endpoints must return inline bytes, not an expiring URL. */
  responseFormat?: MetaImageResponseFormat;
  outputFormat?: MetaImageOutputFormat;
  size?: string;
  user?: string;
  reasoningStrength?: MetaImageJsonValue;
  toolEnablement?: MetaImageJsonValue;
}

export interface MetaImageEditRequest extends MetaImageRequest {
  image: Buffer;
  imageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  imageFilename?: string;
}

export interface MetaImageCallOptions {
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Preserve the complete usage object because image usage fields may expand. */
export type MetaImageUsage = Readonly<Record<string, unknown>>;

export interface MetaImageResult {
  image: Buffer;
  usage: MetaImageUsage | undefined;
  outputFormat: MetaImageOutputFormat;
  /** Number of entries returned by Meta. Requests always send n=1. */
  imageCount: number;
  revisedPrompt?: string;
}

interface MetaImageWireResponse {
  data?: Array<{
    b64_json?: unknown;
    revised_prompt?: unknown;
  }>;
  usage?: unknown;
}

interface CommonWireRequest {
  model: string;
  prompt: string;
  n: 1;
  response_format: MetaImageResponseFormat;
  output_format: MetaImageOutputFormat;
  size?: string;
  user?: string;
  reasoning_strength?: MetaImageJsonValue;
  tool_enablement?: MetaImageJsonValue;
}

export class MetaImageAdapter {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKeyEnv: string;
  private readonly defaultTimeoutMs: number;
  private readonly name: string;

  constructor(config: MetaImageAdapterConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.model = nonEmptyOrDefault(config.model, META_IMAGE_DEFAULT_MODEL);
    this.apiKeyEnv = nonEmptyOrDefault(config.apiKeyEnv, META_IMAGE_DEFAULT_API_KEY_ENV);
    this.defaultTimeoutMs = checkedTimeout(config.timeoutMs ?? GENERATION.perCallTimeoutMs);
    this.name = nonEmptyOrDefault(config.name, 'meta-image');
  }

  async generate(
    request: MetaImageRequest,
    options: MetaImageCallOptions = {},
  ): Promise<MetaImageResult> {
    assertCallable(request, options.signal);
    const outputFormat = request.outputFormat ?? 'png';
    const body = commonWireRequest(request, options.model ?? this.model, outputFormat);
    const response = await httpJson<MetaImageWireResponse>(`${this.baseUrl}/images/generations`, {
      headers: {
        Authorization: `Bearer ${this.key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: checkedTimeout(options.timeoutMs ?? this.defaultTimeoutMs),
      signal: options.signal,
    });
    return parseImageResponse(response, outputFormat);
  }

  async edit(
    request: MetaImageEditRequest,
    options: MetaImageCallOptions = {},
  ): Promise<MetaImageResult> {
    assertCallable(request, options.signal);
    if (request.image.length === 0)
      throw new TypeError('Meta image edit requires a non-empty image');

    const outputFormat = request.outputFormat ?? 'png';
    const body = commonWireRequest(request, options.model ?? this.model, outputFormat);
    const form = new FormData();
    appendCommonFormFields(form, body);

    const mimeType = request.imageMimeType ?? 'image/png';
    const filename = request.imageFilename ?? `image.${extensionForMimeType(mimeType)}`;
    form.append('image', new Blob([new Uint8Array(request.image)], { type: mimeType }), filename);

    const response = await httpJson<MetaImageWireResponse>(`${this.baseUrl}/images/edits`, {
      // Deliberately omit Content-Type so fetch supplies the multipart boundary.
      headers: { Authorization: `Bearer ${this.key()}` },
      body: form,
      timeoutMs: checkedTimeout(options.timeoutMs ?? this.defaultTimeoutMs),
      signal: options.signal,
    });
    return parseImageResponse(response, outputFormat);
  }

  private key(): string {
    return metaApiKeyFor(this.apiKeyEnv, this.name);
  }
}

function commonWireRequest(
  request: MetaImageRequest,
  model: string,
  outputFormat: MetaImageOutputFormat,
): CommonWireRequest {
  const body: CommonWireRequest = {
    model: nonEmptyOrDefault(model, META_IMAGE_DEFAULT_MODEL),
    prompt: request.prompt,
    n: 1,
    response_format: request.responseFormat ?? 'b64_json',
    output_format: outputFormat,
  };
  if (request.size !== undefined) body.size = request.size;
  if (request.user !== undefined) body.user = request.user;
  if (request.reasoningStrength !== undefined) {
    body.reasoning_strength = request.reasoningStrength;
  }
  if (request.toolEnablement !== undefined) body.tool_enablement = request.toolEnablement;
  return body;
}

function appendCommonFormFields(form: FormData, body: CommonWireRequest): void {
  form.append('model', body.model);
  form.append('prompt', body.prompt);
  form.append('n', String(body.n));
  form.append('response_format', body.response_format);
  form.append('output_format', body.output_format);
  if (body.size !== undefined) form.append('size', body.size);
  if (body.user !== undefined) form.append('user', body.user);
  if (body.reasoning_strength !== undefined) {
    form.append('reasoning_strength', formJsonValue(body.reasoning_strength));
  }
  if (body.tool_enablement !== undefined) {
    form.append('tool_enablement', formJsonValue(body.tool_enablement));
  }
}

function parseImageResponse(
  response: MetaImageWireResponse,
  outputFormat: MetaImageOutputFormat,
): MetaImageResult {
  const data = Array.isArray(response.data) ? response.data : [];
  const encoded = data[0]?.b64_json;
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Meta image response did not include data[0].b64_json');
  }

  const image = decodeBase64Image(encoded);
  const revisedPrompt = data[0]?.revised_prompt;
  return {
    image,
    usage: isRecord(response.usage) ? response.usage : undefined,
    outputFormat,
    imageCount: data.length,
    ...(typeof revisedPrompt === 'string' ? { revisedPrompt } : {}),
  };
}

function decodeBase64Image(value: string): Buffer {
  const compact = value.replace(/\s/g, '');
  if (compact.length === 0 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error('Meta image response contained invalid base64 image data');
  }
  const image = Buffer.from(compact, 'base64');
  if (image.length === 0) {
    throw new Error('Meta image response decoded to an empty image');
  }
  return image;
}

function assertCallable(request: MetaImageRequest, signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('aborted');
  if (request.prompt.trim().length === 0) {
    throw new TypeError('Meta image request requires a non-empty prompt');
  }
}

function checkedTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Meta image timeoutMs must be a positive finite number');
  }
  return timeoutMs;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return nonEmptyOrDefault(baseUrl, META_IMAGE_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function nonEmptyOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function formJsonValue(value: MetaImageJsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function extensionForMimeType(mimeType: MetaImageEditRequest['imageMimeType']): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
