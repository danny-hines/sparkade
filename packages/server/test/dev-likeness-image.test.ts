import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDevLikenessRoutes } from '../src/api/dev-likeness';
import type { MetaImageEditRequest } from '../src/providers/meta-image';
import type { ConfigStore } from '../src/storage/config';

describe('dev likeness Muse Image endpoints', () => {
  let app: ReturnType<typeof Fastify>;
  let request: MetaImageEditRequest | undefined;

  beforeEach(async () => {
    app = Fastify();
    await app.register(multipart);
    const generated = await greenScreenHead();
    registerDevLikenessRoutes(app, {} as ConfigStore, {
      model: 'muse-image-lab-test',
      edit: async (nextRequest) => {
        request = nextRequest;
        return {
          image: generated,
          usage: { generated_images: 1 },
          outputFormat: 'png',
          imageCount: 1,
        };
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses the injected Meta edit seam and returns both engine head sizes', async () => {
    const photo = await sharp({
      create: { width: 60, height: 80, channels: 3, background: '#875a3b' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody(
      { features: JSON.stringify({ hairStyle: 'bald', glasses: true }) },
      'photo',
      'player.jpg',
      'image/jpeg',
      photo,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/dev/likeness/generated-heads?fresh=1',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'muse-image-lab-test',
      cached: false,
      heads: {
        12: expect.stringMatching(/^data:image\/png;base64,/),
        16: expect.stringMatching(/^data:image\/png;base64,/),
      },
    });
    expect(request?.prompt).toContain('isolated front-view pixel-art HEAD sprite');
    expect(request?.prompt).toContain('Strict FRONT-facing view');
    expect(request?.imageMimeType).toBe('image/png');
    await expect(sharp(request!.image).metadata()).resolves.toMatchObject({
      width: 512,
      height: 512,
      format: 'png',
    });
  });
});

function multipartBody(
  fields: Record<string, string>,
  fileField: string,
  filename: string,
  mimeType: string,
  file: Buffer,
): { boundary: string; payload: Buffer } {
  const boundary = 'sparkade-likeness-test-boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { boundary, payload: Buffer.concat(chunks) };
}

async function greenScreenHead(): Promise<Buffer> {
  const width = 96;
  const height = 96;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const inHead = x >= 25 && x <= 70 && y >= 15 && y <= 80;
      raw[offset] = inHead ? 172 : 0;
      raw[offset + 1] = inHead ? 108 : 255;
      raw[offset + 2] = inHead ? 79 : 0;
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
