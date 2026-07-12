// End-to-end suite at 1024×600 against demo mode (mock provider, fast delays).
// Keyboard-only, like the cabinet with a keyboard-mode encoder.
import { expect, test, type Page } from '@playwright/test';
import { hold, tap, toMenu, trackErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

test('boots to attract; key screens produce no uncaught console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('.attract .logo')).toContainText('SPARK');
  await expect(page.locator('.press-start')).toBeVisible();

  // menu
  await tap(page, 'Enter');
  await expect(page.locator('.menu-item', { hasText: 'Play' })).toBeVisible();

  // library shows the three golden games, Ready
  await tap(page, 'KeyX'); // A on "Play"
  await expect(page.locator('.game-card')).toHaveCount(3);
  await expect(page.locator('.badge.golden')).toHaveCount(3);

  // settings
  await tap(page, 'KeyZ'); // back to menu
  await tap(page, 'ArrowDown', 2);
  await tap(page, 'KeyX');
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await tap(page, 'KeyZ');

  expect(errors).toEqual([]);
});

test('keyboard-only: create via preset → honest progress → ready → play boots and responds', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await toMenu(page);

  // New Game
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await expect(page.locator('.screen-title', { hasText: 'NEW GAME' })).toBeVisible();

  // Step 1: Skip photo
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');

  // Step 2: idea cards
  await expect(page.getByText('What should this game be?')).toBeVisible();
  await tap(page, 'ArrowDown'); // to "Pick an idea card"
  await tap(page, 'KeyX');
  await expect(page.locator('.idea-card').first()).toBeVisible();
  await tap(page, 'KeyX'); // pick the first card

  // Step 3: review shows the idea text + labeled estimate BEFORE generating
  await expect(page.locator('.transcript-box')).toContainText(/Gearheart|Marshmallow|Museum|Tidepool|Static|Garden/);
  await expect(page.getByText(/estimate|cost unavailable/)).toBeVisible();

  // Generate
  await tap(page, 'KeyX');

  // Honest stage checklist + cost ticker
  await expect(page.locator('.screen-title', { hasText: 'GENERATING' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.genstage.active')).toBeVisible();
  await expect(page.locator('.cost-ticker')).toBeVisible();

  // Done → play
  await expect(page.getByText('GAME READY!')).toBeVisible({ timeout: 120_000 });
  await tap(page, 'KeyX');
  const canvas = page.locator('.play-screen canvas');
  await expect(canvas).toBeVisible();

  // canvas is actually rendering (frames differ)
  await page.waitForTimeout(600);
  const frameA = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512));
  await tap(page, 'KeyX'); // skip how-to card (input responds)
  await page.waitForTimeout(900);
  const frameB = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512));
  expect(frameB).not.toBe(frameA);

  // guaranteed shell escape: hold START ~2.3s → back to detail screen
  await hold(page, 'Enter', 2400);
  await expect(page.locator('.screen-title')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.badge.ready, .badge.golden').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('score entry persists across a full page reload', async ({ page }) => {
  await toMenu(page);
  await tap(page, 'KeyX'); // library
  await expect(page.locator('.game-card').first()).toBeVisible();
  // find the generated (non-golden) game; fall back to first golden otherwise
  await tap(page, 'KeyX'); // open first card
  await expect(page.locator('.score-table')).toBeVisible();
  const gameId = await page.evaluate(async () => {
    const games = (await (await fetch('/api/games')).json()) as { id: string }[];
    return games[0]!.id;
  });
  // submit through the same API the initials screen uses
  await page.evaluate(async (id) => {
    await fetch(`/api/games/${id}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initials: 'DAN', score: 4321 }),
    });
  }, gameId);
  await page.reload();
  await expect(page.locator('.press-start')).toBeVisible();
  await tap(page, 'Enter');
  await expect(page.locator('.menu-item', { hasText: 'Play' })).toBeVisible(); // menu mounted
  await tap(page, 'KeyX'); // library
  await expect(page.locator('.game-card').first()).toBeVisible(); // wait for the async load
  await tap(page, 'KeyX'); // first card
  await expect(page.locator('.score-table')).toContainText('DAN');
  await expect(page.locator('.score-table')).toContainText('4321');
});

test('generation progress survives a page reload (durable jobs)', async ({ page }) => {
  test.setTimeout(240_000);
  await toMenu(page);
  // start another preset generation
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX'); // skip photo
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX'); // idea cards
  await tap(page, 'ArrowRight');
  await tap(page, 'KeyX'); // second card
  await expect(page.locator('.transcript-box')).toBeVisible();
  await tap(page, 'KeyX'); // generate
  await expect(page.locator('.screen-title', { hasText: 'GENERATING' })).toBeVisible();

  // reload mid-generation: the shell restores real job state from the server
  await page.reload();
  await expect(page.locator('.press-start')).toBeVisible();
  await tap(page, 'Enter');
  await expect(page.locator('.menu-item', { hasText: 'Play' })).toBeVisible(); // menu mounted
  // main menu shows the live active-generation card OR the job already finished —
  // either way the library must reflect it truthfully
  await tap(page, 'KeyX'); // library
  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const games = (await (await fetch('/api/games')).json()) as { status: string }[];
          return games.filter((g) => g.status === 'ready').length;
        }),
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(5); // 3 goldens + 2 generated
});

test('delete flow: Cancel is the default; hold-A deletes', async ({ page }) => {
  await toMenu(page);
  await tap(page, 'KeyX'); // library
  await expect(page.locator('.game-card').first()).toBeVisible();
  const countBefore = await page.locator('.game-card').count();
  expect(countBefore).toBeGreaterThanOrEqual(4);
  await tap(page, 'KeyX'); // open newest (generated) game

  // open delete modal (last action row)
  await tap(page, 'ArrowUp'); // wrap to last item = Delete
  await tap(page, 'KeyX');
  await expect(page.locator('.modal')).toContainText('Delete');

  // default is Cancel: pressing A closes without deleting
  await tap(page, 'KeyX');
  await expect(page.locator('.modal')).toHaveCount(0);
  await tap(page, 'KeyZ'); // back to library
  await expect(page.locator('.game-card')).toHaveCount(countBefore);

  // now really delete: focus Delete, hold A for 3s+
  await expect(page.locator('.game-card').first()).toBeVisible();
  await tap(page, 'KeyX'); // open again
  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX'); // modal
  await tap(page, 'ArrowRight'); // move to Delete
  await expect(page.locator('.modal')).toContainText('Hold');
  // releasing early cancels
  await hold(page, 'KeyX', 800);
  await expect(page.locator('.modal')).toBeVisible();
  // full hold deletes
  await hold(page, 'KeyX', 3600);
  await expect(page.locator('.screen-title', { hasText: 'LIBRARY' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.game-card')).toHaveCount(countBefore - 1);
});

test('remap wizard completes and saves; defaults restored afterwards', async ({ page }) => {
  await toMenu(page);
  // hold one input steady for 5s → wizard (hint appears at 2s)
  await page.keyboard.down('KeyQ');
  await expect(page.getByText('Keep holding to remap controls')).toBeVisible({ timeout: 4000 });
  await expect(page.getByText('CONTROL SETUP')).toBeVisible({ timeout: 6000 });
  await page.keyboard.up('KeyQ');

  // any key begins capture
  await tap(page, 'Space');
  await expect(page.getByText('D-pad UP')).toBeVisible();

  const sequence = ['KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyX', 'KeyZ', 'KeyC', 'KeyV', 'KeyQ', 'KeyW', 'Enter', 'ShiftRight'];
  for (const code of sequence) {
    await tap(page, code);
    await page.waitForTimeout(120);
  }
  // test screen: pressed inputs light up
  await expect(page.getByText('TEST YOUR CONTROLS')).toBeVisible();
  await page.keyboard.down('KeyI');
  await page.waitForTimeout(200);
  await expect(page.locator('.remap-cell.lit', { hasText: 'UP' })).toBeVisible();
  await page.keyboard.up('KeyI');
  // START (newly mapped to Enter) saves
  await hold(page, 'Enter', 300);
  await expect(page.locator('.menu-item', { hasText: 'New Game' })).toBeVisible({ timeout: 10_000 });

  // the new map is live: KeyI now navigates up. Verify via saved settings, then restore defaults.
  const saved = await page.evaluate(async () => (await (await fetch('/api/settings')).json()) as { input: { keyboard: Record<string, string> } });
  expect(saved.input.keyboard['KeyI']).toBe('UP');
  expect(saved.input.keyboard['Enter']).toBe('START');
  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: {
          keyboard: {
            ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
            KeyX: 'A', KeyZ: 'B', KeyA: 'X', KeyS: 'Y', KeyQ: 'L', KeyW: 'R',
            Enter: 'START', ShiftRight: 'SELECT',
          },
        },
      }),
    });
  });
});

/** Regression guard: viewport is the cabinet's exact panel. */
test('everything fits 1024×600 with no page scrolling', async ({ page }: { page: Page }) => {
  await toMenu(page);
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > 1024,
    y: document.documentElement.scrollHeight > 600,
  }));
  expect(overflow).toEqual({ x: false, y: false });
});
