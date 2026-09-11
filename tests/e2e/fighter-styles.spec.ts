import { expect, test } from '@playwright/test';
import { checkFighterLadder } from '../helpers/fighter-combat.js';
import { tap, trackErrors } from './helpers';

for (const style of ['rushdown', 'counter', 'rangedControl']) {
  test(`Fighter ${style} controls and complete mixed-profile ladder`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`http://127.0.0.1:5198/?dev=playtest&fighterStyle=${style}`);
    await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
    await expect(page.getByRole('navigation', { name: 'Fighter play styles' })).toBeVisible();
    await page.waitForTimeout(3200);
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('howto');
    for (let i = 0; i < 24; i++) {
      if (
        await page.evaluate(() => {
          const h = (window as any).sparkadePlaytest;
          return h.state === 'game' && !h.engineCtx.cards.active && h.instance.phase === 'fight';
        })
      )
        break;
      await tap(page, 'KeyX');
    }
    await page.waitForFunction(
      () => (window as any).sparkadePlaytest.instance.roundPhase === 'fight',
    );
    const before = await page.evaluate(() => (window as any).sparkadePlaytest.instance.p.x);
    await tap(page, 'ArrowRight');
    expect(
      await page.evaluate(() => (window as any).sparkadePlaytest.instance.p.x),
    ).toBeGreaterThan(before);
    await tap(page, 'Enter');
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('paused');
    await tap(page, 'Enter');
    const report = await page.evaluate(checkFighterLadder);
    expect(report.outcome, JSON.stringify(report)).toBe('won');
    expect(report.bouts).toHaveLength(4);
    expect(new Set(report.bouts.slice(0, 3).map(([, profile]) => profile))).toEqual(
      new Set(['rushdown', 'counter', 'rangedControl']),
    );
    expect(report.rounds).toBeGreaterThanOrEqual(8);
    expect(report.hits).toBeGreaterThan(50);
    expect(report.remainingPulses).toBe(0);
    expect(errors).toEqual([]);
  });
}
