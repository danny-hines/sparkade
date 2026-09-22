import type { PipelineState } from '@sparkade/server/pipeline/job-state';
import { costOf } from '@sparkade/server/pipeline/cost';
import { META_SAM_MODEL, META_SAM_PRICE_PER_IMAGE_USD } from '@sparkade/server/providers/meta-sam';
import { ArcadeError } from './arcade';
export type MetaPricing = Pick<PipelineState, 'config' | 'pricing' | 'imagePricing'>;

const money = (n: number) => Math.ceil(n * 1_000_000) / 1_000_000;
/** Deliberately conservative: UTF-8 bytes bound text tokens; output includes reasoning.
 * Vision bytes over-reserve rather than guessing provider-specific image tokenization. */
export function requestAllowance(
  url: string,
  body: string | FormData | undefined,
  state: MetaPricing,
) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.meta.ai')
    throw new ArcadeError('Website generation requires a priced provider endpoint.');
  const request =
    typeof body === 'string'
      ? (JSON.parse(body) as Record<string, unknown>)
      : Object.fromEntries(body?.entries() ?? []);
  const model = String(request.model ?? '');
  if (
    endpoint.pathname.endsWith('/images/generations') ||
    endpoint.pathname.endsWith('/images/edits')
  ) {
    const rate = state.imagePricing?.perImageUsd;
    if (
      model !== state.config?.imageGeneration.model ||
      Number(request.n) !== 1 ||
      rate == null ||
      !Number.isFinite(rate) ||
      rate <= 0
    )
      throw new ArcadeError('Image pricing is unavailable.');
    return {
      reserved: money(rate),
      actual: (response: unknown) => {
        const images = (response as { data?: unknown[] })?.data;
        return Array.isArray(images) && images.length > 0 ? money(images.length * rate) : null;
      },
    };
  }
  if (!endpoint.pathname.endsWith('/chat/completions') || typeof body !== 'string')
    throw new ArcadeError('This provider operation is not enabled for website games.');
  const price = state.pricing[model];
  if (
    !price ||
    typeof price.inputPerM !== 'number' ||
    typeof price.outputPerM !== 'number' ||
    !Number.isFinite(price.inputPerM) ||
    !Number.isFinite(price.outputPerM) ||
    price.inputPerM <= 0 ||
    price.outputPerM <= 0 ||
    (price.cachedInputPerM !== undefined &&
      (!Number.isFinite(price.cachedInputPerM) || price.cachedInputPerM < 0))
  )
    throw new ArcadeError('Model pricing is unavailable.');
  const output = Number(request.max_completion_tokens ?? request.max_tokens);
  if (!Number.isInteger(output) || output <= 0)
    throw new ArcadeError('Provider output limit is missing.');
  const reserved = money(
    ((Buffer.byteLength(body, 'utf8') + 4096) * price.inputPerM + output * price.outputPerM) /
      1_000_000,
  );
  return {
    reserved,
    actual: (response: unknown) => {
      const data = response as {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const input = data?.usage?.prompt_tokens,
        completion = data?.usage?.completion_tokens;
      if (
        typeof input !== 'number' ||
        typeof completion !== 'number' ||
        !Number.isFinite(input) ||
        !Number.isFinite(completion) ||
        input < 0 ||
        completion < 0
      )
        return null;
      const cached = data.usage?.prompt_tokens_details?.cached_tokens;
      return money(
        costOf(
          model,
          {
            input,
            output: completion,
            cachedInput:
              typeof cached === 'number' && Number.isFinite(cached) ? Math.max(0, cached) : 0,
          },
          state.pricing,
        )!,
      );
    },
  };
}

/** Meta request accounting covers every wire attempt, including voice fallbacks. */
export async function metaRequestAllowance(
  url: string,
  body: string | FormData | undefined,
  state: MetaPricing,
) {
  const path = new URL(url).pathname;
  if (path.endsWith('/asr/transcribe') && body instanceof FormData) {
    const request = body.get('request'),
      audio = body.get('audio');
    if (!(request instanceof Blob) || !(audio instanceof Blob))
      throw new ArcadeError('Voice pricing requires a WAV recording.');
    const model = String(JSON.parse(await request.text()).model ?? '');
    const price = state.pricing[model];
    if (
      !price ||
      typeof price.audioPerHour !== 'number' ||
      !Number.isFinite(price.audioPerHour) ||
      price.audioPerHour <= 0
    )
      throw new ArcadeError('Voice model pricing is unavailable.');
    const rate = price.audioPerHour;
    const seconds = wavSeconds(Buffer.from(await audio.arrayBuffer()));
    if (seconds <= 0) throw new ArcadeError('Voice duration is unavailable.');
    return {
      model,
      operation: 'voice',
      reserved: money((Math.ceil(seconds) / 3600) * rate),
      actual: (response: unknown) => {
        const ms = (response as { audioDurationMs?: number })?.audioDurationMs;
        return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0
          ? money((Math.floor(ms / 1000) / 3600) * rate)
          : null;
      },
    };
  }
  const request =
    typeof body === 'string' ? JSON.parse(body) : Object.fromEntries(body?.entries() ?? []);
  const model = String(request.model ?? '');
  if (path.endsWith('/responses') && model === META_SAM_MODEL) {
    const images = (request.input ?? [])
      .flatMap((item: { content?: { type: string }[] }) => item.content ?? [])
      .filter((item: { type: string }) => item.type === 'input_image').length;
    if (images !== 1) throw new ArcadeError('Segmentation pricing requires one image.');
    return {
      model,
      operation: 'segmentation',
      reserved: META_SAM_PRICE_PER_IMAGE_USD,
      actual: (_response: unknown) => META_SAM_PRICE_PER_IMAGE_USD,
    };
  }
  return {
    ...requestAllowance(url, body, state),
    model,
    operation: path.includes('/images/') ? 'image' : 'text',
  };
}

/** ffmpeg's streamed WAV may use 0xffffffff for its data size; use actual bytes. */
function wavSeconds(audio: Buffer): number {
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE')
    throw new ArcadeError('Voice duration is unavailable.');
  let bytesPerSecond = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const kind = audio.toString('ascii', offset, offset + 4),
      size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (kind === 'fmt ' && size >= 16 && start + 16 <= audio.length) {
      bytesPerSecond = audio.readUInt32LE(start + 8);
    }
    if (kind === 'data' && bytesPerSecond > 0) {
      return Math.min(size, audio.length - start) / bytesPerSecond;
    }
    offset = start + size + (size % 2);
  }
  throw new ArcadeError('Voice duration is unavailable.');
}
