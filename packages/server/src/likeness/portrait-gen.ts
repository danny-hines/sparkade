// Generated likeness portrait (experimental, OFF by default). An image model
// redraws the player's photo as a stylised arcade portrait for the story card
// (the large 64px slot). Uses an OpenAI-style images/edits endpoint as the
// placeholder; when Meta's Muse Image API ships it should drop in by changing
// only baseUrl/model/apiKeyEnv in config.likeness.portraitGen. Falls back to the
// pixel-photo bake on any failure (caller catches), so it never breaks a game.
import sharp from 'sharp';
import { PORTRAIT_SIZE } from '@sparkade/shared';
import { apiKeyFor, ProviderHttpError } from '../providers/base';
import type { FaceFeatures } from './features';

export interface PortraitGenConfig {
  enabled?: boolean;
  baseUrl: string; // e.g. https://api.openai.com/v1
  model: string; // e.g. gpt-image-1
  apiKeyEnv: string; // env var holding the key
  size?: string; // generation size, e.g. 1024x1024
}

function traitPhrase(feat: FaceFeatures): string {
  const bits: string[] = [];
  bits.push((feat.hairColor ?? '').trim().toLowerCase() === 'none' ? 'bald' : 'their hairstyle');
  if (feat.facialHair && feat.facialHair !== 'none') bits.push(`a ${feat.facialHair}`);
  if (feat.glasses) bits.push('glasses');
  if (feat.headwear) bits.push('their headwear');
  return bits.join(', ');
}

/** Generate one stylised portrait from the photo; returns a PORTRAIT_SIZE PNG. */
export async function generatePortrait(photo: Buffer, feat: FaceFeatures, cfg: PortraitGenConfig): Promise<Buffer> {
  const key = apiKeyFor(cfg.apiKeyEnv, 'portraitGen');
  // Normalize the input to a square PNG the edit endpoint will accept.
  const png = await sharp(photo).rotate().resize(512, 512, { fit: 'cover' }).png().toBuffer();
  const prompt = [
    'Redraw the person in this photo as a friendly 16-bit pixel-art arcade video-game character —',
    'a front-facing head-and-shoulders portrait bust.',
    `Preserve their likeness: ${traitPhrase(feat)}, their skin tone, and their expression.`,
    'Clean flat colours, a bold dark outline, a simple plain dark background.',
    'Cheerful retro SNES game art, stylised and characterful, NOT photorealistic.',
  ].join(' ');

  const form = new FormData();
  form.append('model', cfg.model);
  form.append('prompt', prompt);
  form.append('size', cfg.size ?? '1024x1024');
  form.append('n', '1');
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'photo.png');

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new Error(`portrait gen rejected the API key (HTTP ${res.status})`);
    throw new ProviderHttpError(`portrait gen HTTP ${res.status}: ${body.slice(0, 200)}`, res.status, null, body);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('portrait gen: no image in the response');
  // Into the retro portrait slot the story card already renders (pixelated).
  return sharp(Buffer.from(b64, 'base64'))
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}
