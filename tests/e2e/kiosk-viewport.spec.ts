import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test('adaptive kiosk fits landscape and portrait without changing the game aspect ratio', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/?kiosk=adaptive&touch=0');
  await expect(page.locator('.press-start')).toBeVisible();
  for (const viewport of [
    { width: 1920, height: 1080 }, // Connected Portal+, full display.
    { width: 1280, height: 800 },
    { width: 1080, height: 1920 },
    { width: 800, height: 1280 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const box = await page.locator('.kiosk-stage').boundingBox();
        return (
          box !== null &&
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1 &&
          (Math.abs(box.width - viewport.width) < 1 || Math.abs(box.height - viewport.height) < 1)
        );
      })
      .toBe(true);
    const box = (await page.locator('.kiosk-stage').boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(1024 / 600, 3);
  }
  await expect(page.locator('.kiosk-controls')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('touch controls navigate to a game and a canceled direction stops repeating', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 736 });
  await page.goto('/?kiosk=adaptive&touch=1');
  await expect(page.locator('.press-start')).toBeVisible();
  const key = (button: string) => page.locator(`.kiosk-controls [data-control="${button}"]`);
  await key('START').click();
  await expect(page.locator('.home-item.new.focused')).toBeVisible();
  await key('DOWN').dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch' });
  await expect(page.locator('.home-item.game.focused')).toBeVisible();
  await key('DOWN').dispatchEvent('pointercancel', { pointerId: 9, pointerType: 'touch' });
  const selected = await page.locator('.home-item.game.focused').innerText();
  await page.waitForTimeout(650); // Longer than the menu's repeat delay.
  await expect(page.locator('.home-item.game.focused')).toHaveText(selected, {
    useInnerText: true,
  });
  await key('A').click();
  await expect(page.locator('.home-action.focused')).toBeVisible();
  await key('A').click();
  await expect(page.locator('.play-screen canvas')).toBeVisible();
  // Narrow/portrait gameplay has separate mobile CSS; it must still use the fitted stage.
  await page.setViewportSize({ width: 800, height: 1216 });
  await expect
    .poll(async () => {
      const screen = await page.locator('.play-screen').boundingBox();
      return screen ? screen.width / screen.height : 0;
    })
    .toBeCloseTo(1024 / 600, 3);
  const stage = (await page.locator('.kiosk-stage').boundingBox())!;
  const controls = (await page.locator('.kiosk-controls').boundingBox())!;
  expect(stage.y + stage.height).toBeLessThanOrEqual(controls.y);
  expect(errors).toEqual([]);
});

test('Pi layout stays at 1024 by 600 without adaptive mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.press-start')).toBeVisible();
  const box = (await page.locator('.screen').boundingBox())!;
  expect(box.width).toBe(1024);
  expect(box.height).toBe(600);
  await expect(page.locator('.kiosk-controls')).toHaveCount(0);
});
