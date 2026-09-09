import { expect, test } from '@playwright/test';
import { tap, toMenu, trackErrors } from './helpers';

test('update check distinguishes a failed check, a successful retry, and an available update', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const responses = [
    {
      current: '0.1.0',
      latest: null,
      available: false,
      error: 'Could not resolve host: github.com',
    },
    { current: '0.1.0', latest: '0.1.0', available: false },
    { current: '0.1.0', latest: 'main', available: true },
  ];
  let checks = 0;
  await page.route('**/api/system/update/check', (route) => {
    const response = responses[checks++];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.route('**/api/system/update/status', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) }),
  );
  await toMenu(page);
  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX');
  await expect(page.locator('.settings-tab')).toHaveCount(7);
  await tap(page, 'ArrowDown', 5);
  await tap(page, 'KeyX'); // Focus the update action.
  await tap(page, 'KeyX');

  await expect(page.getByText('Update error', { exact: true })).toBeVisible();
  await expect(
    page.getByText("Couldn't check for updates: Could not resolve host: github.com"),
  ).toBeVisible();
  await expect(page.getByText('Up to date', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Check for updates', { exact: true })).toBeVisible();

  await tap(page, 'KeyX'); // Retry after the error.
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  await expect(page.getByText('Update error', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Couldn't check for updates:/)).toHaveCount(0);

  await tap(page, 'KeyX');
  await expect(page.getByText('main available', { exact: true })).toBeVisible();
  await expect(page.getByText('Install update (main)', { exact: true })).toBeVisible();
  expect(checks).toBe(3);
  expect(errors).toEqual([]);
});
