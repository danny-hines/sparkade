import { expect, test, type Page } from '@playwright/test';

// The shell samples keys once per frame. After a clock jump, a quick tap can land
// between frames, so hold each state until the broker has seen it.
async function press(page: Page, key: string): Promise<void> {
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await frames();
  await page.keyboard.down(key);
  await frames();
  await page.keyboard.up(key);
  await frames();
}

test('loads saved kiosk copy, refreshes after idle and in Settings, retains it offline and restores defaults', async ({
  page,
}) => {
  await page.clock.install();
  let copy: unknown = { title: 'Launch Party', tagline: 'Dream up your next game' };
  let offline = false;
  let refreshed = 0;
  await page.route('**/api/cloud/registration*', async (route) => {
    if (!route.request().url().includes('cached=1')) refreshed++;
    if (offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    await route.fulfill({
      json: { state: 'registered', origin: 'https://sparkade.dev', displayCopy: copy },
    });
  });
  // Menus return to attract after five idle minutes; the shell checks every 10 s.
  const idleToAttract = async () => {
    await page.clock.fastForward(5 * 60_000 + 10_100);
    await expect(page.locator('.press-start')).toBeVisible();
  };
  await page.goto('/');
  await expect(page.locator('.attract .logo')).toHaveText('Launch Party');
  await expect(page.locator('.attract-tagline')).toHaveText('Dream up your next game');
  await expect.poll(() => refreshed).toBe(1);

  await press(page, 'Enter');
  await expect(page.locator('.home .kiosk-title')).toHaveText('Launch Party');
  copy = { title: 'Event Day Two', tagline: 'Another day of games' };
  // Registration is never polled: each check wakes the cloud database.
  await page.clock.fastForward(60_100);
  await expect(page.locator('.home .kiosk-title')).toHaveText('Launch Party');
  expect(refreshed).toBe(1);

  // A visitor starting after the idle timeout triggers the next check.
  await idleToAttract();
  await press(page, 'Enter');
  await expect.poll(() => refreshed).toBe(2);
  await expect(page.locator('.home .kiosk-title')).toHaveText('Event Day Two');

  offline = true;
  await idleToAttract();
  await expect(page.locator('.attract .logo')).toHaveText('Event Day Two');
  await press(page, 'Enter');
  await expect.poll(() => refreshed).toBe(3);
  await expect(page.locator('.home .kiosk-title')).toHaveText('Event Day Two');

  // Opening Settings checks immediately.
  offline = false;
  copy = { title: '', tagline: '' };
  await press(page, 'ArrowUp');
  await press(page, 'KeyX');
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await expect.poll(() => refreshed).toBe(4);
  await press(page, 'KeyZ');
  await expect(page.locator('.home .kiosk-title')).toHaveText('SPARKADE');
});

test('saved copy is visible before a cloud request completes and long event copy fits', async ({
  page,
}) => {
  const copy = { title: 'W'.repeat(40), tagline: 'Event adventures await! '.repeat(5).trim() };
  let release!: () => void;
  const cloudGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/cloud/registration*', async (route) => {
    if (!route.request().url().includes('cached=1')) await cloudGate;
    await route.fulfill({ json: { state: 'registered', displayCopy: copy } });
  });
  try {
    await page.goto('/');
    await expect(page.locator('.attract .logo')).toHaveText(copy.title);
    await page.evaluate(() => document.fonts.ready);
    const title = (await page.locator('.attract .logo').boundingBox())!;
    const tagline = (await page.locator('.attract-tagline').boundingBox())!;
    expect(title.x).toBeGreaterThanOrEqual(0);
    expect(title.x + title.width).toBeLessThanOrEqual(1024);
    expect(tagline.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(tagline.x + tagline.width).toBeLessThanOrEqual(1024);
    await page.screenshot({ path: test.info().outputPath('event-attract.png') });
    await page.keyboard.press('Enter');
    await expect(page.locator('.home .kiosk-title')).toHaveText(copy.title);
    const header = (await page.locator('.home .kiosk-title').boundingBox())!;
    const chips = (await page.locator('.home .status-chips').boundingBox())!;
    expect(header.x + header.width).toBeLessThanOrEqual(chips.x);
    await page.screenshot({ path: test.info().outputPath('event-home.png') });
  } finally {
    release();
  }
});

test('uses built-in copy when no saved settings exist and the cloud is unavailable', async ({
  page,
}) => {
  await page.route('**/api/cloud/registration*', (route) =>
    route.fulfill({ status: 503, json: { error: 'offline' } }),
  );
  await page.goto('/');
  await expect(page.locator('.attract .logo')).toHaveText('SPARKADE');
  await expect(page.locator('.attract-tagline')).toHaveText(
    'The arcade that dreams up its own games',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.home .kiosk-title')).toHaveText('SPARKADE');
});
