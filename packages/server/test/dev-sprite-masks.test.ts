import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { formats, recordsOfKind } from '@meta-sam/parser';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpriteMaskComparison } from '@sparkade/shared';
import { registerDevSpriteMaskRoutes } from '../src/api/dev-sprite-masks';
import { ConfigStore } from '../src/storage/config';
import fixture from './fixtures/sam/curly-silhouette.json';

const ROOT = '/api/dev/platformer-poses/mask-comparisons';
describe('saved sprite mask comparisons', () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  let zeroMatches: boolean;
  let captured: Buffer[];
  let source: Buffer;
  const makeApp = async () => {
    const server = Fastify();
    await server.register(multipart);
    registerDevSpriteMaskRoutes(server, new ConfigStore(dir), dir, {
      segmentImage: async (image, concept) => {
        captured.push(image);
        expect(concept).toBe('person');
        const parser = formats.segmentation.image().createParser();
        parser.push(zeroMatches ? '' : fixture.wire);
        return {
          model: 'sam-3.1',
          responseId: 'response-test',
          rawOutput: zeroMatches ? '' : fixture.wire,
          masks: recordsOfKind(parser.finish({ status: 'completed' }).result.records, 'mask'),
        };
      },
    });
    return server;
  };
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-mask-test-'));
    captured = [];
    zeroMatches = false;
    const data = Buffer.alloc(24 * 24 * 4);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        data.set(
          fixture.rows[y - 4]?.[x - 7] === '#' ? [60, 30, 10, 255] : [0, 255, 0, 255],
          (y * 24 + x) * 4,
        );
      }
    source = await sharp(data, { raw: { width: 24, height: 24, channels: 4 } })
      .png()
      .toBuffer();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });
  const submit = () =>
    app.inject({
      method: 'POST',
      url: ROOT,
      headers: { 'content-type': 'multipart/form-data; boundary=mask-test' },
      payload: Buffer.concat([
        Buffer.from(
          '--mask-test\r\nContent-Disposition: form-data; name="concept"\r\n\r\nperson\r\n--mask-test\r\nContent-Disposition: form-data; name="image"; filename="curly.png"\r\nContent-Type: image/png\r\n\r\n',
        ),
        source,
        Buffer.from('\r\n--mask-test--\r\n'),
      ]),
    });
  async function completed(id: string): Promise<SpriteMaskComparison> {
    let run: SpriteMaskComparison | undefined;
    await vi.waitFor(async () => {
      run = (await app.inject({ url: `${ROOT}/${id}` })).json();
      expect(run?.status).not.toBe('running');
    });
    return run!;
  }
  it('uses one identical source, saves all variants and review, and reloads after restart', async () => {
    const response = await submit();
    expect(response.statusCode).toBe(202);
    const run = await completed(response.json().id);
    expect(run.status).toBe('complete');
    expect(run.variants.map((variant) => variant.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
    expect(captured).toHaveLength(1);
    expect(run.variants.find((v) => v.strategy === 'sam-hybrid')?.hybrid?.radius).toBe(1);
    const savedSource = await app.inject({ url: run.sourceUrl });
    expect(savedSource.rawPayload).toEqual(captured[0]);
    for (const variant of run.variants) {
      for (const url of [variant.maskUrl, variant.cutoutUrl, variant.spriteUrl]) {
        expect((await app.inject({ url: url! })).statusCode).toBe(200);
      }
    }
    const verdict = await app.inject({
      method: 'POST',
      url: `${ROOT}/${run.id}/verdict`,
      payload: {
        preferred: 'sam',
        notes: 'Fine curls retained; no green halo.',
      },
    });
    expect(verdict.json().verdict.preferred).toBe('sam');
    const manifest = JSON.parse(
      readFileSync(join(dir, 'experiments', 'sprite-masks', run.id, 'manifest.json'), 'utf8'),
    );
    expect(manifest.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.responseId).toBe('response-test');
    await app.close();
    app = await makeApp();
    expect((await app.inject({ url: `${ROOT}/${run.id}` })).json().verdict.notes).toContain(
      'curls',
    );
    expect((await app.inject({ url: run.variants[1]!.spriteUrl! })).statusCode).toBe(200);
    expect(captured).toHaveLength(1);
  });
  it('reprocesses the saved response without a model call and preserves the original review', async () => {
    const original = await completed((await submit()).json().id);
    await app.inject({
      method: 'POST',
      url: `${ROOT}/${original.id}/verdict`,
      payload: { preferred: 'sam', notes: 'Original review' },
    });
    const response = await app.inject({ method: 'POST', url: `${ROOT}/${original.id}/reprocess` });
    expect(response.statusCode).toBe(202);
    const replay = await completed(response.json().id);
    expect(replay.id).not.toBe(original.id);
    expect(replay.reusedFrom).toBe(original.id);
    expect(replay.sourceSha256).toBe(original.sourceSha256);
    expect(replay.responseId).toBe(original.responseId);
    expect(replay.segmentationCalls).toBe(0);
    expect(replay.estimatedCostUsd).toBe(0);
    expect(replay.verdict).toBeUndefined();
    expect(replay.variants).toHaveLength(4);
    expect(replay.variants.every((v) => v.status === 'complete')).toBe(true);
    expect(captured).toHaveLength(1);
    expect((await app.inject({ url: `${ROOT}/${original.id}` })).json().verdict.notes).toBe(
      'Original review',
    );
  });
  it('retains the baseline when SAM finds no subject and refuses a verdict for a missing result', async () => {
    zeroMatches = true;
    const run = await completed((await submit()).json().id);
    expect(run.status).toBe('failed');
    expect(run.variants[0]?.status).toBe('complete');
    expect(run.error).toContain('no matching subject');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${ROOT}/${run.id}/verdict`,
          payload: { preferred: 'sam', notes: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${ROOT}/${run.id}/verdict`,
          payload: { preferred: 'chroma', notes: '' },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('rejects bad image input before making a model call and restricts artifact paths', async () => {
    source = Buffer.from('not an image');
    expect((await submit()).statusCode).toBe(400);
    expect(captured).toHaveLength(0);
    expect((await app.inject({ url: `${ROOT}/not-a-run/assets/source.png` })).statusCode).toBe(404);
  });
});
