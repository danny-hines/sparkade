import { expect, test } from '@playwright/test';
import { checkAdventureObjectives } from '../helpers/adventure-objectives.js';
import { tap, trackErrors } from './helpers';

for (const style of ['dungeonExpedition', 'puzzleQuest', 'rescueRaid']) {
  test(`Adventure ${style} keyboard controls and complete objective`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`http://127.0.0.1:5198/?dev=playtest&adventureStyle=${style}`);
    await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
    await expect(page.getByRole('navigation', { name: 'Adventure play styles' })).toBeVisible();
    await page.waitForTimeout(style === 'puzzleQuest' ? 3200 : 400);
    if (style === 'puzzleQuest')
      expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('howto');
    for (let i = 0; i < 20; i++) {
      if (
        await page.evaluate(() => {
          const h = (window as any).sparkadePlaytest;
          return h.state === 'game' && !h.engineCtx.cards.active && h.instance.phase === 'play';
        })
      )
        break;
      await tap(page, 'KeyX');
    }
    const before = await page.evaluate(() => (window as any).sparkadePlaytest.instance.px);
    await tap(page, 'ArrowRight');
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.instance.px)).toBeGreaterThan(
      before,
    );
    await tap(page, 'ShiftRight');
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.instance.mapOpen)).toBe(true);
    await tap(page, 'ShiftRight');
    await tap(page, 'Enter');
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('paused');
    await tap(page, 'Enter');
    const report = await page.evaluate(checkAdventureObjectives);
    expect(
      report.results.filter((result) => !result.pass),
      JSON.stringify(report),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
