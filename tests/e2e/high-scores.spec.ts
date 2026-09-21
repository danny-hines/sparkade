import { expect, test } from '@playwright/test';
import { tap, toMenu, trackErrors } from './helpers';

test('kiosk high scores open beside Play, show the top 10, and return to the same action', async ({
  page,
  request,
}) => {
  const errors = trackErrors(page);
  const games = await (await request.get('/api/games')).json();
  const game = games[0];
  for (let score = 100; score <= 1200; score += 100) {
    expect(
      (
        await request.post(`/api/games/${game.id}/scores`, { data: { initials: 'ABC', score } })
      ).ok(),
    ).toBe(true);
  }
  await toMenu(page);
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await expect(page.locator('.home-action.focused')).toHaveText('Play');
  await tap(page, 'ArrowRight');
  await expect(page.locator('.home-action.focused')).toHaveText('High Scores');
  await tap(page, 'KeyX');
  const dialog = page.getByRole('dialog', { name: 'High Scores' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(game.title);
  await expect(dialog.locator('tbody tr')).toHaveCount(10);
  await expect(dialog.locator('tbody tr').first()).toContainText('1,200');
  await expect(dialog.locator('tbody tr').last()).toContainText('300');
  const bounds = (await page.locator('.modal').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  await tap(page, 'ArrowRight'); // Modal consumes navigation; Play/Delete cannot activate underneath.
  await tap(page, 'KeyZ');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.home-action.focused')).toHaveText('High Scores');
  await tap(page, 'ArrowLeft');
  await tap(page, 'KeyX');
  await expect(page.locator('.play-screen canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('kiosk score dialog handles empty boards and retries a failed request', async ({ page }) => {
  let fail = true;
  await page.route('**/api/games/*/scores', (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      contentType: 'application/json',
      body: fail ? JSON.stringify({ error: 'Offline' }) : '[]',
    }),
  );
  await toMenu(page);
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await tap(page, 'ArrowRight');
  await tap(page, 'KeyX');
  const dialog = page.getByRole('dialog', { name: 'High Scores' });
  await expect(dialog.getByRole('alert')).toHaveText('Could not load high scores.');
  fail = false;
  await tap(page, 'KeyX');
  await expect(dialog).toContainText('No scores yet');
  await tap(page, 'KeyX');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.home-action.focused')).toHaveText('High Scores');
});
