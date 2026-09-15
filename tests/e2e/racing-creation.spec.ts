// Racing creator flow with a failed first Create: the wizard must show an
// accessible error, keep the whole draft (photo, typed name/details, Racing,
// idempotency key), and the retry must travel the real mock pipeline exactly
// once — no double-create — through GAME READY, reload, and library play.
// Only the first Create POST is failed (HTTP 503); everything else is real.
import { expect, test } from '@playwright/test';
import type { GameDetail } from '../../packages/web/src/api';
import { tap, toMenu, trackErrors } from './helpers';

const HERO_NAME = 'Axel Rider';
const CYCLING_BRIEF =
  'High-speed cycling race through neon streets: rival riders, daring overtakes, and a photo finish.';

/** First small multipart field value for `name`, or null when absent. */
function multipartField(body: string, name: string): string | null {
  const match = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`));
  return match?.[1] ?? null;
}

/** Game id created by this spec file (not a golden): the only id cleanup may delete. */
let ownedGameId: string | null = null;

test.afterEach(async ({ request }) => {
  const id = ownedGameId;
  ownedGameId = null;
  // Owned generated ids look like `g-…`; never touch goldens (`golden-…`).
  if (!id || !id.startsWith('g-')) return;
  const deleted = await request.delete(`/api/games/${id}`);
  expect(deleted.ok()).toBe(true);
});

test('racing creation survives a failed first Create without double-creating', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const errors = trackErrors(page);

  // Desktop wizard surface (typed name/details + file uploader). The real API
  // underneath is untouched — only the Pi flag is masked for this page.
  await page.route('**/api/system/info', async (route) => {
    const res = await route.fetch();
    const payload = (await res.json()) as Record<string, unknown>;
    await route.fulfill({
      status: res.status(),
      contentType: 'application/json',
      body: JSON.stringify({ ...payload, isPi: false }),
    });
  });

  // Fail ONLY the first Create POST with a controlled 503. The retry (and
  // every other request) falls through to the real mock API and pipeline.
  const postedBodies: string[] = [];
  await page.route('**/api/games', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fallback();
      return;
    }
    postedBodies.push(req.postDataBuffer()?.toString('latin1') ?? '');
    if (postedBodies.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Mock outage — please retry.' }),
      });
      return;
    }
    await route.fallback();
  });

  await toMenu(page);

  // New Game is the selected launcher row.
  await tap(page, 'KeyX');
  await expect(page.locator('.screen-title', { hasText: 'NEW GAME' })).toBeVisible();

  // Step 1: upload a fixture photo encoded locally in-memory (no external image).
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#203050';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.ellipse(128, 120, 70, 90, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16202e';
    ctx.fillRect(40, 200, 176, 24);
    const url: string = canvas.toDataURL('image/png');
    return url.split(',')[1] ?? '';
  });
  expect(pngBase64.length).toBeGreaterThan(100);
  await page.setInputFiles('.photo-upload-input', {
    name: 'rider.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBase64, 'base64'),
  });
  await expect(page.getByText('Use photo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText('Use photo', { exact: true }).click();

  // Step 2: typed hero name + cycling brief.
  await expect(page.getByText('TELL SPARK WHAT MATTERS')).toBeVisible();
  await page.fill('#wizard-hero-name', HERO_NAME);
  await page.fill('#wizard-details', CYCLING_BRIEF);

  // Explicit Racing via the normal carousel UI (cursor starts on Platformer).
  await page.locator('.game-detail-row', { hasText: 'Type' }).click();
  await expect(page.locator('.archetype-card').first()).toBeVisible();
  await tap(page, 'ArrowRight', 5); // Platformer → … → Racing
  await tap(page, 'KeyX');
  await expect(page.locator('.game-details-stage')).toContainText('Racing');
  await expect(page.locator('#wizard-hero-name')).toHaveValue(HERO_NAME);
  await expect(page.locator('#wizard-details')).toHaveValue(CYCLING_BRIEF);

  // First Create fails with the injected 503: a visible, accessible error…
  await page.locator('.game-details-create').click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Mock outage');
  await expect(alert).toContainText('try Create again');
  expect(postedBodies).toHaveLength(1);

  // …and the draft is unchanged: typed fields, Racing, and the photo.
  await expect(page.locator('#wizard-hero-name')).toHaveValue(HERO_NAME);
  await expect(page.locator('#wizard-details')).toHaveValue(CYCLING_BRIEF);
  await expect(page.locator('.game-details-stage')).toContainText('Racing');
  await tap(page, 'KeyZ'); // B → back to the photo step
  await expect(page.getByText('Use photo', { exact: true })).toBeVisible();
  await page.getByText('Use photo', { exact: true }).click();
  await expect(page.getByText('TELL SPARK WHAT MATTERS')).toBeVisible();
  await expect(page.locator('#wizard-hero-name')).toHaveValue(HERO_NAME);
  await expect(page.locator('#wizard-details')).toHaveValue(CYCLING_BRIEF);
  await expect(page.locator('.game-details-stage')).toContainText('Racing');

  // Retry against the real server: same draft, same idempotency key, photo kept.
  const [retryResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/games') && res.request().method() === 'POST',
    ),
    page.locator('.game-details-create').click(),
  ]);
  expect(retryResponse.ok()).toBe(true);
  const created = (await retryResponse.json()) as { jobId: string; gameId: string };
  expect(created.gameId).toBeTruthy();
  ownedGameId = created.gameId;
  expect(postedBodies).toHaveLength(2);

  const [firstBody = '', secondBody = ''] = postedBodies;
  const firstKey = multipartField(firstBody, 'idempotencyKey');
  expect(firstKey).toBeTruthy();
  expect(multipartField(secondBody, 'idempotencyKey')).toBe(firstKey);
  expect(multipartField(firstBody, 'requestedArchetype')).toBe('racing');
  expect(multipartField(secondBody, 'requestedArchetype')).toBe('racing');
  expect(multipartField(firstBody, 'heroName')).toBe(HERO_NAME);
  expect(multipartField(secondBody, 'heroName')).toBe(HERO_NAME);
  expect(multipartField(firstBody, 'details')).toBe(CYCLING_BRIEF);
  expect(multipartField(secondBody, 'details')).toBe(CYCLING_BRIEF);
  expect(firstBody).toContain('name="photo"');
  expect(secondBody).toContain('name="photo"');

  // Replaying the same idempotency key against the real API must NOT create
  // a second game (this is what an ambiguous network failure would hit).
  const gamesBefore = (await (await request.get('/api/games')).json()) as { id: string }[];
  const replay = await request.post('/api/games', {
    multipart: {
      promptText: multipartField(secondBody, 'promptText') ?? 'replay',
      sourceKind: 'voice',
      requestedArchetype: 'racing',
      heroName: HERO_NAME,
      details: CYCLING_BRIEF,
      idempotencyKey: firstKey ?? '',
    },
  });
  expect(replay.ok()).toBe(true);
  expect(((await replay.json()) as { gameId: string }).gameId).toBe(created.gameId);
  const gamesAfter = (await (await request.get('/api/games')).json()) as { id: string }[];
  expect(gamesAfter).toHaveLength(gamesBefore.length);

  // Real pipeline to GAME READY.
  await expect(page.locator('.screen-title', { hasText: 'SPARK IS BUILDING' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('GAME READY!')).toBeVisible({ timeout: 180_000 });

  // Ready-pack provenance: the spec carries this draft's exact guided-creation
  // brief (name, Racing, cycling details) and records the uploaded photo; the
  // durable job row agrees. Exact pixel geometry is verified by
  // pipeline/renderer unit tests, not here.
  const detail = (await (await request.get(`/api/games/${created.gameId}`)).json()) as GameDetail;
  const expectedBrief = {
    version: 1,
    heroName: HERO_NAME,
    archetype: 'racing',
    details: CYCLING_BRIEF,
  };
  expect(detail.item.status).toBe('ready');
  expect(detail.item.archetype).toBe('racing');
  expect(detail.spec?.archetype).toBe('racing');
  expect(detail.meta?.requestedArchetype).toBe('racing');
  expect(detail.meta?.sourcePrompt).toContain(HERO_NAME);
  expect(detail.meta?.hadPhoto).toBe(true);
  expect(detail.meta?.creationBrief).toEqual(expectedBrief);
  expect(detail.job?.requestedArchetype).toBe('racing');
  expect(detail.job?.hasPhoto).toBe(true);
  expect(detail.job?.creationBrief).toEqual(expectedBrief);

  // Advertised ten-file racing pack, complete: 3 panoramas, 5 craft strips,
  // scenery + material atlases.
  expect(detail.assets['racingArtRequired']).toBe(true);
  const tenPack = [
    'racingPanorama1',
    'racingPanorama2',
    'racingPanorama3',
    'racingCraftPlayer',
    'racingCraftRival1',
    'racingCraftRival2',
    'racingCraftRival3',
    'racingCraftRival4',
    'racingSceneryAtlas',
    'racingMaterialAtlas',
  ] as const;
  expect(tenPack).toHaveLength(10);
  for (const role of tenPack) expect(detail.assets[role], role).toBe(true);

  // Optional per-racer motion outcome: `animated` publishes the approved
  // six-frame atlas, `neutral` the explicit approved rear — with a reason
  // exactly when neutral.
  expect(detail.meta?.racingArt?.mode).toBe('generated');
  for (const racer of detail.meta?.racingArt?.motion ?? []) {
    expect(['animated', 'neutral']).toContain(racer.status);
    if (racer.status === 'neutral') expect(racer.reason, racer.racer).toBeTruthy();
    else expect(racer.reason, racer.racer).toBeUndefined();
  }

  // Play now: the canvas boots and responds to input.
  await tap(page, 'KeyX');
  const canvas = page.locator('.play-screen canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(600);
  const frameA = await canvas.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  await tap(page, 'KeyX'); // dismiss the how-to card if present (input responds)
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowRight');
  const frameB = await canvas.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  expect(frameB).not.toBe(frameA);

  // Reload, then open the generated game from the library and play it.
  await page.reload();
  await toMenu(page);
  const library = (await (await request.get('/api/games')).json()) as {
    id: string;
    title: string;
  }[];
  const mine = library.find((game) => game.id === created.gameId);
  expect(mine).toBeDefined();
  const position = library.findIndex((game) => game.id === created.gameId);
  expect(position).toBeGreaterThanOrEqual(0);
  await tap(page, 'ArrowDown', position + 1);
  await tap(page, 'KeyX');
  await expect(page.locator('.home-detail-title')).toHaveText(mine!.title);
  await tap(page, 'KeyX');
  const canvasAfterReload = page.locator('.play-screen canvas');
  await expect(canvasAfterReload).toBeVisible();
  // Actual A through the static how-to card first: only the live game behind
  // it animates, so frames must be compared after this press, not before.
  await tap(page, 'KeyX');
  await page.waitForTimeout(600);
  const frameC = await canvasAfterReload.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowRight');
  await tap(page, 'KeyX'); // advance the story/title card through real A input
  const frameD = await canvasAfterReload.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  expect(frameD).not.toBe(frameC);

  // The injected 503 may surface as a browser resource console error; account
  // for exactly that signature when present without masking anything else.
  const unexpected = errors.filter((entry) =>
    entry !== 'console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
  );
  expect(unexpected).toEqual([]);
});
