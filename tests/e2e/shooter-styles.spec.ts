import { expect, test } from '@playwright/test';
import { checkShooterCombat } from '../helpers/shooter-combat.js';
import { trackErrors, tap } from './helpers';

for (const style of ['weaponSwitch', 'chargeSpecialist', 'lockOnStriker']) {
  test(`shooter ${style} controls, combat and lifecycle`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`http://127.0.0.1:5198/?dev=playtest&shooterStyle=${style}`);
    await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
    await expect(page.getByRole('navigation', { name: 'Shooter play styles' })).toBeVisible();
    // Exercise cabinet keyboard routing before controlled collision scenarios.
    await page.waitForTimeout(400);
    for (let i = 0; i < 8; i++) {
      const playing = await page.evaluate(() => {
        const host = (window as any).sparkadePlaytest;
        return host.state === 'game' && !host.engineCtx.cards.active;
      });
      if (playing) break;
      await tap(page, 'KeyX');
    }
    await page.keyboard.down('KeyA'); // physical A maps to the cabinet's X weapon button
    await expect
      .poll(() =>
        page.evaluate((selected) => {
          const g = (window as any).sparkadePlaytest.instance;
          return selected === 'weaponSwitch'
            ? g.weaponMode === 'spread'
            : selected === 'chargeSpecialist'
              ? g.chargeReady
              : g.targeting;
        }, style),
      )
      .toBe(true);
    await page.keyboard.up('KeyA');
    await tap(page, 'Enter');
    expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('paused');
    await tap(page, 'Enter');
    const report = await page.evaluate(checkShooterCombat);
    expect(
      report.results.filter((r) => !r.pass),
      JSON.stringify(report),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
