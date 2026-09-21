import { formats, recordsOfKind, type SegmentationMaskRecord } from '@meta-sam/parser';
import { metaApiKeyFor, httpJson } from './base';
import sharp from 'sharp';

export const META_SAM_MODEL = 'sam-3.1';
export const META_SAM_PRICE_PER_IMAGE_USD = 0.0025;

export interface MetaSamConfig {
  baseUrl?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
}

export interface SpriteSegmentation {
  model: string;
  responseId?: string;
  rawOutput: string;
  masks: readonly SegmentationMaskRecord[];
}

/** Still-image adapter. Non-streaming keeps the existing timeout/auth/request policy
 * plumbing; a completed response is required before any mask can be used. */
export class MetaSamAdapter {
  constructor(private readonly config: MetaSamConfig = {}) {}

  async segmentImage(
    image: Buffer,
    concept: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SpriteSegmentation> {
    if (!image.length) throw new TypeError('SAM requires a non-empty PNG');
    const prompt = concept.trim();
    if (!prompt || prompt.length > 160 || /[\r\n]/.test(prompt)) {
      throw new TypeError('Use one short subject concept (1–160 characters)');
    }
    const source = await sharp(image, { limitInputPixels: 4096 * 4096 }).metadata();
    if (source.format !== 'png' || !source.width || !source.height) {
      throw new TypeError('SAM requires an oriented PNG');
    }
    const timeoutMs = this.config.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid SAM timeout');
    const base = (this.config.baseUrl ?? 'https://api.meta.ai/v1').replace(/\/+$/, '');
    const response = await httpJson<{
      id?: string;
      status?: string;
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    }>(`${base}/responses`, {
      headers: {
        Authorization: `Bearer ${metaApiKeyFor(this.config.apiKeyEnv ?? 'META_API_KEY', 'meta-sam')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: META_SAM_MODEL,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${image.toString('base64')}`,
              },
            ],
          },
        ],
        stream: false,
        metadata: { mask_encoding: 'one_bit' },
      }),
      timeoutMs,
      signal: options.signal,
    });
    if (response.status !== 'completed' || !Array.isArray(response.output)) {
      throw new Error('SAM did not return a completed response');
    }
    const content = response.output.flatMap((item) => item.content ?? []);
    if (content.some((part) => part.type === 'refusal')) throw new Error('SAM refused this image');
    const lanes = content.filter((part) => part.type === 'output_text');
    if (lanes.length > 1 || lanes.some((part) => typeof part.text !== 'string')) {
      throw new Error('SAM returned an invalid output-text lane');
    }
    const rawOutput = lanes[0]?.text ?? '';
    for (const match of rawOutput.matchAll(/;w=(\d+);h=(\d+)\|>/g)) {
      if (Number(match[1]) !== source.width || Number(match[2]) !== source.height) {
        throw new Error('SAM returned masks for different source dimensions');
      }
    }
    for (const match of rawOutput.matchAll(/data=(\d+),(\d+),/g)) {
      const area = Number(match[1]) * Number(match[2]);
      if (!Number.isSafeInteger(area) || area > 4096 * 4096)
        throw new Error('SAM mask is too large');
    }
    const parser = formats.segmentation.image().createParser();
    parser.push(rawOutput);
    const { result } = parser.finish({ status: 'completed' });
    if (result.diagnostics.length || recordsOfKind(result.records, 'text').length) {
      throw new Error('SAM returned malformed segmentation output');
    }
    return {
      model: META_SAM_MODEL,
      responseId: response.id,
      rawOutput,
      masks: recordsOfKind(result.records, 'mask'),
    };
  }
}
