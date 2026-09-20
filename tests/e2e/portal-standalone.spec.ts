import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { trackErrors } from './helpers';

// Exercises the exact packaged shell without either the Node API or production.
// Native storage/network is replaced at the same narrow message boundary used on Android.
test('packaged Portal shell starts, saves settings and plays a starter without a server', async ({
  page,
}) => {
  const root = resolve('apps/portal/app/build/generated/portal-assets/www');
  const errors = trackErrors(page);
  const press = async (key: string) => {
    await page.keyboard.press(key, { delay: 50 });
    // The input broker must observe release before a second tap across a menu transition.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('https://appassets.androidplatform.net/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(root + sep)) return route.fulfill({ status: 404 });
    try {
      const type =
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        }[extname(file)] ?? 'application/octet-stream';
      await route.fulfill({ status: 200, contentType: type, body: readFileSync(file) });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.addInitScript(() => {
    const host = {
      onmessage: null as ((event: { data: string }) => void) | null,
      postMessage(text: string) {
        const request = JSON.parse(text);
        let value: unknown = {};
        switch (request.operation) {
          case 'state.load':
            value = JSON.parse(localStorage.getItem('test-native-state') ?? 'null');
            break;
          case 'state.save':
            localStorage.setItem('test-native-state', JSON.stringify(request.args.state));
            break;
          case 'registration.status':
            value = { state: 'unregistered', origin: 'https://sparkade.dev' };
            break;
          case 'device.info':
            value = { version: '0.2.0', diskFreeBytes: 15e9, diskTotalBytes: 32e9 };
            break;
          default:
            throw new Error('Unexpected native operation: ' + request.operation);
        }
        queueMicrotask(() => host.onmessage?.({ data: JSON.stringify({ id: request.id, value }) }));
      },
    };
    window.SparkadePortalNative = host;
  });
  await page.goto('https://appassets.androidplatform.net/?kiosk=adaptive&touch=1');
  await expect(page.locator('.press-start')).toBeVisible();
  await press('Enter');
  await expect(page.locator('.home-item.game')).toHaveCount(6);
  await press('ArrowUp');
  await press('x');
  await expect(page.getByText('Remap controls', { exact: true })).toBeVisible();
  await press('ArrowDown');
  await press('x');
  await press('ArrowLeft');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('test-native-state') ?? '{}').settings?.audio?.musicVol,
      ),
    )
    .toBeLessThan(0.7);
  await page.reload();
  await expect(page.locator('.press-start')).toBeVisible();
  await press('Enter');
  await press('ArrowDown');
  await press('x');
  await expect(page.locator('.home-action.focused')).toBeVisible();
  await press('x');
  await expect(page.locator('.play-screen canvas')).toBeVisible();
  expect(
    requests.every((url) => new URL(url).origin === 'https://appassets.androidplatform.net'),
  ).toBe(true);
  expect(requests.some((url) => url.includes('/api/games/') && url.endsWith('.png'))).toBe(true);
  expect(errors).toEqual([]);
});
