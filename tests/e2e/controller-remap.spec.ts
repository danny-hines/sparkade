import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test.use({ userAgent: 'SparkadePortal/0.1' });

test('an unmapped gamepad button opens control setup from Press Start', async ({ page }) => {
  const errors = trackErrors(page);
  // A saved profile suppresses first-boot setup. A different controller still
  // needs a way to remap when none of its buttons can dismiss the attract screen.
  await page.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const settings = await response.json();
    settings.input.gamepad = { b9: 'START' };
    await route.fulfill({ response, json: settings });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [
        {
          id: 'Unmapped test controller',
          connected: true,
          index: 0,
          mapping: '',
          axes: [0, 0],
          buttons: Array.from({ length: 18 }, (_, index) => ({
            pressed: index === 17 && document.documentElement.dataset.controllerHeld === '1',
            value: index === 17 && document.documentElement.dataset.controllerHeld === '1' ? 1 : 0,
          })),
        },
      ],
    });
  });
  await page.goto('/?kiosk=adaptive&touch=0');
  await expect(page.locator('.press-start')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.controllerHeld = '1';
  });
  await expect(page.getByText('Keep holding to remap controls')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.press-start')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CONTROL SETUP' })).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => {
    delete document.documentElement.dataset.controllerHeld;
  });
  // The held trigger is swallowed; setup waits for a fresh press.
  await expect(page.getByText('Press any button or key to begin')).toBeVisible();
  expect(errors).toEqual([]);
});

test('native USB reports drive menus and disconnect releases a held direction', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const settings = await response.json();
    settings.input.gamepad = { b9: 'START', b1: 'A', 'a1+': 'DOWN' };
    await route.fulfill({ response, json: settings });
  });
  await page.goto('/?kiosk=adaptive&touch=0');
  await expect(page.locator('.press-start')).toBeVisible();
  const report = async (buttons: number[], axes = [0, 0]) =>
    page.evaluate(
      ({ buttons, axes }) => {
        window.dispatchEvent(
          new CustomEvent('sparkade:usb-gamepad', {
            detail: { buttons: Array.from({ length: 10 }, (_, i) => buttons.includes(i)), axes },
          }),
        );
      },
      { buttons, axes },
    );
  await report([9]);
  await expect(page.locator('.home-item.new.focused')).toBeVisible();
  await report([]);
  await report([], [0, 1]);
  await expect(page.locator('.home-item.game.focused')).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sparkade:usb-gamepad', { detail: null })),
  );
  const selected = await page.locator('.home-item.game.focused').innerText();
  await page.waitForTimeout(650);
  await expect(page.locator('.home-item.game.focused')).toHaveText(selected, {
    useInnerText: true,
  });
  await report([1]);
  await expect(page.locator('.home-action.focused')).toBeVisible();
  await report([]);
  await page.waitForTimeout(50); // One released input frame between presses.
  await report([1]);
  await expect(page.locator('.play-screen canvas')).toBeVisible();
  await report([]);
  expect(errors).toEqual([]);
});

test('a twelve-button Zero Delay report opens remapping from Press Start', async ({ page }) => {
  const errors = trackErrors(page);
  await page.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const settings = await response.json();
    settings.input.gamepad = { b9: 'START' };
    await route.fulfill({ response, json: settings });
  });
  await page.goto('/?kiosk=adaptive&touch=0');
  await expect(page.locator('.press-start')).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('sparkade:usb-gamepad', {
        detail: { buttons: Array.from({ length: 12 }, (_, i) => i === 11), axes: [0, 0] },
      }),
    );
  });
  await expect(page.getByText('Keep holding to remap controls')).toBeVisible({ timeout: 4000 });
  await expect(page.getByRole('heading', { name: 'CONTROL SETUP' })).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('sparkade:usb-gamepad', {
        detail: { buttons: Array(12).fill(false), axes: [0, 0] },
      }),
    );
  });
  await expect(page.getByText('Press any button or key to begin')).toBeVisible();
  expect(errors).toEqual([]);
});
