import { expect, test, type Page } from '@playwright/test';

// The racer's generated-surface rows are painted through a software row
// compositor (one blit) instead of ~3000 per-row canvas calls. Open the same
// race twice under a fake clock — once with the compositor, once forced onto
// the canvas path (no ImageData constructor) — and require the countdown-grid
// frames to match apart from sampling resolution and rounding.

async function advance(page: Page, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) await page.clock.runFor(250);
}

async function press(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await advance(page, 100);
  await page.keyboard.up(code);
  await advance(page, 400);
}

async function raceFrame(page: Page, canvasPath: boolean): Promise<{ w: number; h: number; px: number[] }> {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  if (canvasPath) {
    await page.addInitScript(() => {
      delete (window as unknown as { ImageData?: unknown }).ImageData;
    });
  }
  await page.route('**/api/games', async (route) => {
    const response = await route.fetch();
    const games = (await response.json()) as { archetype: string; builtIn?: boolean }[];
    await route.fulfill({ response, json: games.filter((game) => game.archetype === 'racing') });
  });
  await page.goto('/');
  await expect.poll(async () => { await advance(page, 250); return page.locator('.press-start').isVisible(); }).toBe(true);
  await press(page, 'Enter');
  await expect.poll(async () => { await advance(page, 250); return page.locator('.home-item.game').count(); }).toBe(1);
  await press(page, 'ArrowDown');
  await press(page, 'KeyX');
  await press(page, 'KeyX');
  const canvas = page.locator('.play-screen canvas');
  await expect.poll(async () => { await advance(page, 250); return canvas.isVisible(); }).toBe(true);
  // Let assets decode on the real clock, then start the race and drive a
  // fixed input script on the fake clock.
  await page.waitForTimeout(3000);
  await advance(page, 3000);
  await press(page, 'KeyX'); // title
  await advance(page, 1500);
  await press(page, 'KeyX'); // story card
  // Capture on the countdown grid: the camera is parked, so both runs frame
  // the identical course regardless of input timing.
  await advance(page, 1000);
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    return { w: el.width, h: el.height, px: Array.from(d) };
  });
}

test('racer row compositor matches the canvas path', async ({ browser }) => {
  const shots: { w: number; h: number; px: number[] }[] = [];
  for (const canvasPath of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
    const page = await context.newPage();
    shots.push(await raceFrame(page, canvasPath));
    await page.screenshot({ path: test.info().outputPath(canvasPath ? 'canvas-path.png' : 'row-raster.png') });
    await context.close();
  }
  const [raster, canvas] = shots as [typeof shots[0], typeof shots[0]];
  expect(raster.w).toBe(canvas.w);
  // Compare only the ground band the compositor paints (below the horizon,
  // above the bottom HUD bar); HUD timers and sky layers vary with timing.
  const y0 = 118 * 2; // RACING_HORIZON × DISPLAY_SCALE
  const y1 = raster.h - 50;
  // The compositor samples at logical width (the canvas path rasterizes at
  // display width), so texel choice on minified far rows and edge coverage
  // differ slightly; missing or misplaced ground would differ grossly.
  let sum = 0;
  let large = 0;
  const pixels = (y1 - y0) * raster.w;
  for (let i = y0 * raster.w * 4; i < y1 * raster.w * 4; i += 4) {
    const delta = Math.max(
      Math.abs(raster.px[i]! - canvas.px[i]!),
      Math.abs(raster.px[i + 1]! - canvas.px[i + 1]!),
      Math.abs(raster.px[i + 2]! - canvas.px[i + 2]!),
    );
    sum += delta;
    if (delta > 48) large++;
  }
  const mean = sum / pixels;
  console.log(`row raster parity: mean delta ${mean.toFixed(2)}, ${large}/${pixels} pixels differ by >48`);
  expect(mean).toBeLessThan(2);
  expect(large / pixels).toBeLessThan(0.005);
});
