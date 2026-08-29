import Fastify from 'fastify';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDevPlatformerLevelRoutes } from '../src/api/dev-platformer-levels';
import { mockPlatformerLevelLayoutImage } from '../src/assets/platformer-level-lab';
import { ConfigStore } from '../src/storage/config';
import type { MetaImageEditRequest, MetaImageRequest } from '../src/providers/meta-image';
import type { CompleteRequest } from '@sparkade/shared';

describe('dev platformer level design lab', () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  let generationRequests: MetaImageRequest[];
  let editRequests: MetaImageEditRequest[];
  let judgeRequests: CompleteRequest[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-platformer-levels-'));
    generationRequests = [];
    editRequests = [];
    judgeRequests = [];
    app = Fastify();
    registerDevPlatformerLevelRoutes(app, new ConfigStore(dir), dir, {
      imageModel: 'muse-image-level-lab-test',
      imageGenerate: async (request) => {
        generationRequests.push(request);
        const candidateId = request.user?.split('-').at(-1) ?? 'L1';
        return {
          image: await mockPlatformerLevelLayoutImage(candidateId),
          outputFormat: 'png',
          imageCount: 1,
          usage: { generated_images: 1 },
        };
      },
      imageEdit: async (request) => {
        editRequests.push(request);
        return {
          image: request.image,
          outputFormat: 'png',
          imageCount: 1,
          usage: { generated_images: 1 },
        };
      },
      judgeModel: 'muse-spark-level-lab-test',
      judgeProvider: 'meta-test',
      judge: async ({ request }) => {
        judgeRequests.push(request);
        return hydrationJudgeResponse(['H1', 'H2', 'H3'], 'H2');
      },
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams, persists, selects, and hydrates playable candidates', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/platformer-levels/runs',
      payload: { concept: 'Clockwork cliffs above a stormy brass city' },
    });
    expect(started.statusCode).toBe(202);
    const runId = (started.json() as { runId: string }).runId;
    const ready = await waitForStatus(app, runId, (status) => status.status === 'ready');

    expect(generationRequests).toHaveLength(3);
    expect(generationRequests.every((request) => request.size === 'auto')).toBe(true);
    expect(generationRequests[0]?.prompt).toContain('MACHINE-READABLE COLOR-BLOCK MAP');
    expect(generationRequests[0]?.prompt).toContain('96 columns wide by 18 rows high');
    expect(ready.recommendedId).toMatch(/^L[123]$/);
    expect(ready.events.filter((event) => event.type === 'candidate')).toHaveLength(3);
    expect(
      ready.events
        .filter((event) => event.type === 'candidate')
        .every((event) => (event.data?.metrics as { issuesAfter?: unknown[] }).issuesAfter?.length === 0),
    ).toBe(true);

    const experimentDir = join(dir, 'experiments', 'platformer-levels', runId);
    for (const candidateId of ['L1', 'L2', 'L3']) {
      expect(existsSync(join(experimentDir, 'raw', `${candidateId}.png`))).toBe(true);
      expect(existsSync(join(experimentDir, 'parsed', `${candidateId}.png`))).toBe(true);
      expect(existsSync(join(experimentDir, 'repaired', `${candidateId}.png`))).toBe(true);
      expect(existsSync(join(experimentDir, 'levels', `${candidateId}.json`))).toBe(true);
    }

    const candidateId = ready.recommendedId!;
    const hydration = await app.inject({
      method: 'POST',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/hydrate`,
      payload: { candidateId },
    });
    expect(hydration.statusCode).toBe(202);
    const hydrated = await waitForStatus(
      app,
      runId,
      (status) =>
        status.status === 'ready' &&
        status.hydratedId === candidateId &&
        status.events.some(
          (event) => event.type === 'hydration' && event.status === 'complete',
        ),
    );

    expect(editRequests).toHaveLength(3);
    expect(editRequests[0]?.prompt).toContain('machine-registered platformer level guide');
    expect(editRequests[0]?.prompt).toContain('Paint ONLY');
    expect(judgeRequests).toHaveLength(1);
    expect(judgeRequests[0]?.image).toBeInstanceOf(Buffer);
    expect(judgeRequests[0]?.system).toContain('visual quality only');
    expect(hydrated.imageCalls).toBe(6);
    expect(hydrated.judgeCalls).toBe(1);
    expect(hydrated.hydrationWinnerId).toBe('H2');
    expect(
      hydrated.events.filter((event) => event.type === 'hydration-candidate'),
    ).toHaveLength(6);
    expect(
      hydrated.events.some((event) => event.type === 'hydration-judge-response'),
    ).toBe(true);
    expect(
      hydrated.events.some(
        (event) =>
          event.type === 'hydration-selection' && event.data?.hydrationWinnerId === 'H2',
      ),
    ).toBe(true);
    expect(existsSync(join(experimentDir, 'hydrated', `${candidateId}-safe.png`))).toBe(true);
    expect(existsSync(join(experimentDir, 'hydrated', `${candidateId}-exact.png`))).toBe(true);
    expect(existsSync(join(experimentDir, 'hydrated', `${candidateId}-visual-mask.png`))).toBe(
      true,
    );
    expect(existsSync(join(experimentDir, 'hydrated', `${candidateId}-mismatch.png`))).toBe(true);
    for (const hydrationId of ['H1', 'H2', 'H3']) {
      expect(
        existsSync(join(experimentDir, 'hydrated', `${candidateId}-${hydrationId}-raw.png`)),
      ).toBe(true);
      expect(
        existsSync(join(experimentDir, 'hydrated', `${candidateId}-${hydrationId}-safe.png`)),
      ).toBe(true);
    }
    expect(existsSync(join(experimentDir, 'hydrated', `${candidateId}-judge-board.jpg`))).toBe(
      true,
    );
    const reprocessed = await app.inject({
      method: 'POST',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/reprocess`,
      payload: {
        candidateId,
        fringe: { topPx: 7, sidePx: 0, bottomPx: 5 },
      },
    });
    expect(reprocessed.statusCode).toBe(200);
    const remasked = await waitForStatus(
      app,
      runId,
      (status) => status.events.some((event) => event.type === 'mask'),
    );
    expect(editRequests).toHaveLength(3);
    expect(remasked.imageCalls).toBe(6);
    expect(
      [...remasked.events].reverse().find((event) => event.type === 'mask')?.data?.metrics,
    ).toMatchObject({ fringe: { topPx: 7, sidePx: 0, bottomPx: 5 } });
    const manifest = JSON.parse(readFileSync(join(experimentDir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      status: 'ready',
      imageModel: 'muse-image-level-lab-test',
      hydratedId: candidateId,
      hydrationWinnerId: 'H2',
      usage: { imageCalls: 6, judgeCalls: 1 },
      hydrationMetrics: {
        exactCollisionMask: true,
        fringe: { topPx: 7, sidePx: 0, bottomPx: 5 },
      },
    });

    const safeAsset = await app.inject({
      method: 'GET',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/assets/hydrated-safe`,
    });
    expect(safeAsset.statusCode).toBe(200);
    expect(safeAsset.headers['content-type']).toBe('image/png');

    const restoredEdits: MetaImageEditRequest[] = [];
    const restoredApp = Fastify();
    registerDevPlatformerLevelRoutes(restoredApp, new ConfigStore(dir), dir, {
      imageEdit: async (request) => {
        restoredEdits.push(request);
        return {
          image: request.image,
          outputFormat: 'png',
          imageCount: 1,
          usage: { generated_images: 1 },
        };
      },
      judge: async () => hydrationJudgeResponse(['H1', 'H2', 'H3'], 'H1'),
    });
    const restored = await restoredApp.inject({
      method: 'GET',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ status: 'ready', hydratedId: candidateId });
    const rehydration = await restoredApp.inject({
      method: 'POST',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/hydrate`,
      payload: { candidateId },
    });
    expect(rehydration.statusCode).toBe(202);
    await waitForStatus(
      restoredApp,
      runId,
      (status) => status.status === 'ready' && restoredEdits.length === 3,
    );
    await restoredApp.close();
  });
});

interface LabStatus {
  status: string;
  recommendedId?: string;
  hydratedId?: string;
  hydrationWinnerId?: string;
  imageCalls: number;
  judgeCalls: number;
  events: Array<{
    type: string;
    status: string;
    data?: Record<string, unknown>;
  }>;
}

function hydrationJudgeResponse(candidateIds: string[], selected: string) {
  return {
    text: JSON.stringify({
      candidateReviews: candidateIds.map((id) => ({
        id,
        scores: {
          craftsmanship: id === selected ? 5 : 4,
          materialRichness: id === selected ? 5 : 4,
          visualCohesion: id === selected ? 5 : 4,
          gameplayReadability: id === selected ? 5 : 4,
        },
        issues: [],
        summary: `${id} is usable.`,
      })),
      selection: {
        candidateId: selected,
        confidence: 0.92,
        rationale: `${selected} has the strongest visual hierarchy.`,
      },
    }),
    usage: { input: 1200, output: 400 },
  };
}

async function waitForStatus(
  app: ReturnType<typeof Fastify>,
  runId: string,
  predicate: (status: LabStatus) => boolean,
): Promise<LabStatus> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}`,
    });
    const status = response.json() as LabStatus;
    if (predicate(status)) return status;
    if (status.status === 'failed') throw new Error('level lab failed during test');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('level lab did not reach the expected status');
}
