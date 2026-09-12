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

test('Fighter projectile themes have distinct animated bodies, real impacts and cabinet inputs', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const appearances = new Set<number>();
  for (const kind of ['energyBlast', 'fireball', 'frostShard', 'arcBolt', 'spiritOrb']) {
    await page.goto(`http://127.0.0.1:5198/?dev=playtest&fighterProjectile=${kind}`);
    await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
    await expect(page.getByRole('navigation', { name: 'Fighter projectiles' })).toBeVisible();
    await page.evaluate(() => {
      const h = (window as any).sparkadePlaytest;
      h.state = 'game';
      const g = h.instance;
      g.start();
      while (h.engineCtx.cards.active) h.engineCtx.cards.skip();
      g.roundPhase = 'fight';
      g.banner = '';
      g.p.x = 100;
      g.o.x = 340;
      g.o.aiRecoveryT = 10;
    });
    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyS');
    await page.waitForFunction(() => (window as any).sparkadePlaytest.instance.pulses.length === 1);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('KeyQ');
    const report = await page.evaluate(() => {
      const h = (window as any).sparkadePlaytest;
      h.loop.stop();
      const g = h.instance,
        r = h.renderer;
      const pulse = g.pulses[0];
      pulse.x = 250;
      const pixels = () => r.ctx.getImageData(410, Math.round(pulse.y - 15) * 2, 140, 60).data;
      g.pulses = [];
      h.render();
      const baseline = pixels();
      g.pulses = [pulse];
      h.render();
      const drawn = pixels();
      let changed = 0,
        hash = 2166136261;
      for (let i = 0; i < drawn.length; i += 4) {
        if (
          drawn[i] !== baseline[i] ||
          drawn[i + 1] !== baseline[i + 1] ||
          drawn[i + 2] !== baseline[i + 2]
        )
          changed++;
        hash = Math.imul(hash ^ (drawn[i]! - baseline[i]!), 16777619);
        hash = Math.imul(hash ^ (drawn[i + 1]! - baseline[i + 1]!), 16777619);
      }
      pulse.life -= 0.08;
      h.render();
      const animated = pixels();
      const animationChanged = animated.some((v: number, i: number) => v !== drawn[i]);
      const hp = g.o.hp;
      for (let i = 0; i < 100 && g.pulses.length; i++) g.updatePulses(1 / 60);
      const impactKind = g.pulseImpacts[0]?.kind;
      const damage = hp - g.o.hp;
      g.startRound(false);
      return {
        kind: g.p.projectile.kind,
        changed,
        hash,
        animationChanged,
        damage,
        impactKind,
        impactsAfterReset: g.pulseImpacts.length,
        pulsesAfterReset: g.pulses.length,
        overflow:
          document.documentElement.scrollWidth > 1024 ||
          document.documentElement.scrollHeight > 600,
      };
    });
    expect(report.kind).toBe(kind);
    expect(report.changed).toBeGreaterThan(200);
    expect(report.animationChanged).toBe(true);
    expect(report.impactKind).toBe(kind);
    expect(report.damage).toBe(10);
    expect(report.impactsAfterReset).toBe(0);
    expect(report.pulsesAfterReset).toBe(0);
    expect(report.overflow).toBe(false);
    appearances.add(report.hash);
  }
  expect(appearances.size).toBe(5);
  expect(errors).toEqual([]);
});
