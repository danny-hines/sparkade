import { expect, test, type Page } from '@playwright/test';
import { tap, hold, trackErrors } from './helpers';

const base = 'http://127.0.0.1:5198/?dev=presentation&game=golden-platformer';

async function state(page: Page) {
  return page.evaluate(() => {
    const preview = (
      window as unknown as {
        sparkadePresentation: {
          family: string;
          host: {
            state: string;
            disposed: boolean;
            howto: { t: number };
            pause: { screen: string };
            instance: { px: number };
            playT: number;
            engineCtx: { cards: { active: boolean } };
            audio: { getVolumes(): { musicVol: number } };
          };
        };
      }
    ).sparkadePresentation;
    const h = preview.host;
    return {
      family: preview.family,
      state: h.state,
      howtoT: h.howto.t,
      pause: h.pause.screen,
      x: h.instance.px,
      playT: h.playT,
      cards: h.engineCtx.cards.active,
      musicVol: h.audio.getVolumes().musicVol,
    };
  });
}

for (const family of ['storybook', 'tech', 'arcade']) {
  test(`${family} controls, play and pause work through cabinet input`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`${base}&family=${family}&scene=controls&clean=1`);
    await expect(page.locator('.presentation-lab')).toHaveAttribute('data-ready', 'true');
    expect(await page.locator('canvas').boundingBox()).toMatchObject({ width: 1024, height: 600 });
    expect((await state(page)).musicVol).toBe(0);
    await expect.poll(async () => (await state(page)).howtoT).toBeGreaterThan(0.35);
    await tap(page, 'KeyX');
    for (let i = 0; i < 12 && (await state(page)).cards; i++) await tap(page, 'KeyX');
    expect(await state(page)).toMatchObject({ state: 'game', cards: false, family });
    const x = (await state(page)).x;
    await hold(page, 'ArrowRight', 200);
    expect((await state(page)).x).toBeGreaterThan(x);
    await tap(page, 'Enter');
    expect((await state(page)).state).toBe('paused');
    const pausedTime = (await state(page)).playT;
    await tap(page, 'ArrowDown', 2);
    await tap(page, 'KeyX');
    expect((await state(page)).pause).toBe('controls');
    await tap(page, 'KeyZ');
    await tap(page, 'ArrowDown');
    await tap(page, 'KeyX');
    expect((await state(page)).pause).toBe('audio');
    await tap(page, 'ArrowRight');
    expect((await state(page)).musicVol).toBeCloseTo(0.1);
    expect((await state(page)).playT).toBe(pausedTime);
    await tap(page, 'KeyZ', 2);
    expect((await state(page)).state).toBe('game');
    // Exiting a session launched from Controls must recreate that same scene.
    await hold(page, 'Enter', 2200);
    await page.waitForFunction(
      () =>
        (window as unknown as { sparkadePresentation?: { host: { state: string } } })
          .sparkadePresentation?.host.state === 'howto',
    );
    expect(errors).toEqual([]);
  });
}

test('family switching disposes the previous host and recovery keeps the preview usable', async ({
  page,
}) => {
  await page.goto(`${base}&family=storybook&scene=hud`);
  await expect(page.locator('.presentation-lab')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const w = window as unknown as {
      sparkadePresentation: { host: unknown };
      previousPresentationHost: unknown;
    };
    w.previousPresentationHost = w.sparkadePresentation.host;
  });
  await page.getByRole('button', { name: 'Tech mission', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { sparkadePresentation?: { family: string } }).sparkadePresentation
            ?.family,
      ),
    )
    .toBe('tech');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { previousPresentationHost: { disposed: boolean } })
          .previousPresentationHost.disposed,
    ),
  ).toBe(true);

  // A failed game fetch must not permanently remove the canvas ref needed to retry.
  await page.route('**/api/games/golden-platformer', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporarily unavailable' }),
    }),
  );
  await page.getByRole('button', { name: 'Arcade action', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/games/golden-platformer');
  await page.getByRole('button', { name: 'Storybook adventure', exact: true }).click();
  await expect(page.locator('.presentation-lab')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('canvas')).toBeVisible();
});

test('sample results can be inspected without writing scores or generating assets', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`${base}&family=tech&scene=victory`);
  await expect(page.locator('.presentation-lab')).toHaveAttribute('data-ready', 'true');
  await tap(page, 'KeyX');
  await expect.poll(async () => (await state(page)).state).toBe('initials');
  await tap(page, 'KeyX', 3);
  await expect.poll(async () => (await state(page)).state).toBe('board');
  expect(writes).toEqual([]);
});
