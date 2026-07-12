import { expect, type Page } from '@playwright/test';

/**
 * Tap a key long enough to span at least one 60 Hz input poll.
 * Default keyboard map: arrows = d-pad, X=A, Z=B, Enter=START, RShift=SELECT.
 */
export async function tap(page: Page, code: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(code);
    await page.waitForTimeout(70);
    await page.keyboard.up(code);
    await page.waitForTimeout(90);
  }
}

export async function hold(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
  await page.waitForTimeout(100);
}

/** Attract → main menu. */
export async function toMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.press-start')).toBeVisible({ timeout: 15_000 });
  await tap(page, 'Enter');
  await expect(page.locator('.menu-item', { hasText: 'New Game' })).toBeVisible();
}

/** Collect uncaught console errors / page errors for a page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('favicon')) return; // benign missing icon
      errors.push(`console: ${text}`);
    }
  });
  return errors;
}
