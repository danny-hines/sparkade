import { expect, test } from '@playwright/test';
import { tap, trackErrors } from './helpers';

test.use({ hasTouch: true });

for (const mode of [
  { name: 'Portal gamepad mode', query: '?kiosk=adaptive&touch=0', kiosk: 0, racing: 0 },
  { name: 'Portal touch mode', query: '?kiosk=adaptive&touch=1', kiosk: 1, racing: 0 },
  { name: 'ordinary touch browser', query: '', kiosk: 0, racing: 1 },
]) {
  test(`${mode.name} shows only its intended racing controls`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.route('**/api/games', async (route) => {
      const response = await route.fetch();
      const games = (await response.json()) as { archetype: string }[];
      await route.fulfill({ response, json: games.filter((game) => game.archetype === 'racing') });
    });
    await page.goto(`/${mode.query}`);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    await expect(page.locator('.press-start')).toBeVisible();
    await tap(page, 'Enter');
    await expect(page.locator('.home-item.game')).toHaveCount(1);
    await tap(page, 'ArrowDown');
    await tap(page, 'KeyX');
    await expect(page.locator('.home-action.focused')).toHaveText('Play');
    await tap(page, 'KeyX');
    const canvas = page.locator('.play-screen canvas');
    await expect(canvas).toBeVisible();
    // The canvas mounts before the game loads. Wait for GameHost's first frame
    // so an absent overlay cannot pass just because its host is still loading.
    await expect
      .poll(() =>
        canvas.evaluate(
          (element: HTMLCanvasElement) =>
            element.getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
        ),
      )
      .toBe(255);
    await expect(page.locator('.kiosk-controls')).toHaveCount(mode.kiosk);
    await expect(page.locator('.racing-touch')).toHaveCount(mode.racing);
    expect(errors).toEqual([]);
  });
}
