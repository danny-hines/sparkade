// End-to-end suite at 1024×600 against demo mode (mock provider, fast delays).
// Keyboard-only, like the cabinet with a keyboard-mode encoder.
import { expect, test, type Page } from '@playwright/test';
import { hold, tap, toMenu, trackErrors } from './helpers';
import { checkPlatformerCombat } from '../helpers/platformer-combat.js';

test.describe.configure({ mode: 'serial' });

test('boots to attract; key screens produce no uncaught console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('.attract .logo')).toContainText('SPARK');
  await expect(page.locator('.press-start')).toBeVisible();

  // home: New Game + the six golden games + Settings, all in one list
  await tap(page, 'Enter');
  await expect(page.locator('.home-item.new')).toBeVisible();
  await expect(page.locator('.home-item.game')).toHaveCount(6);
  await expect(page.locator('.badge.golden')).toHaveCount(6);

  // settings is the last list item; Up wraps to it
  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX');
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await tap(page, 'KeyZ'); // settings → home

  expect(errors).toEqual([]);
});

test('Settings rail scrolls with controller navigation at cabinet height', async ({ page }) => {
  await toMenu(page);

  // Settings is last in the launcher; the forced-Pi fixture has all seven tabs.
  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX');
  const rail = page.locator('.settings-tabs');
  await expect(rail.locator('.settings-tab')).toHaveCount(7);
  const cloud = rail.locator('.settings-tab', { hasText: 'Cloud' });
  await expect(cloud).toHaveText('Cloud');
  expect(await cloud.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // Moving to the final tab must scroll the bounded rail and keep focus visible.
  await tap(page, 'ArrowDown', 6);
  const focused = rail.locator('.settings-tab.focused');
  await expect(focused).toHaveText('Model info');
  const metrics = await rail.evaluate((element) => {
    const active = element.querySelector('.settings-tab.focused');
    const railRect = element.getBoundingClientRect();
    const activeRect = active?.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      railTop: railRect.top,
      railBottom: railRect.bottom,
      activeTop: activeRect?.top ?? -1,
      activeBottom: activeRect?.bottom ?? -1,
    };
  });
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.activeTop).toBeGreaterThanOrEqual(metrics.railTop);
  expect(metrics.activeBottom).toBeLessThanOrEqual(metrics.railBottom);
});

test('Settings reports a detached software-update failure', async ({ page }) => {
  await page.route('**/api/system/update/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'failed',
        message: 'Update failed with exit code 1. Details are in /tmp/update.log.',
      }),
    }),
  );
  await toMenu(page);

  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX');
  await expect(page.locator('.settings-tab')).toHaveCount(7);
  await tap(page, 'ArrowDown', 5);

  await expect(page.getByText('Update failed with exit code 1.')).toBeVisible();
});

test('WiFi flow can always cancel, retry a wrong password, and connect', async ({ page }) => {
  const errors = trackErrors(page);
  await toMenu(page);

  // Settings is last in the launcher. WiFi is the fourth settings tab.
  await tap(page, 'ArrowUp');
  await tap(page, 'KeyX');
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await tap(page, 'ArrowDown', 3);
  await tap(page, 'KeyX');
  await expect(page.locator('.wifi-row')).toHaveCount(6); // five mock networks + Rescan

  // Current network is safe to select and reports its state.
  await tap(page, 'KeyX');
  await expect(page.getByText('Already connected to MOCK-HomeNet')).toBeVisible();

  // Select the secured workshop network. B cancels an empty field.
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await expect(page.locator('.modal')).toContainText('Password for MOCK-Workshop');
  const modalBox = await page.locator('.modal').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.x).toBeGreaterThanOrEqual(0);
  expect(modalBox!.y).toBeGreaterThanOrEqual(0);
  expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(1024);
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(600);
  await tap(page, 'KeyZ');
  await expect(page.locator('.modal')).toHaveCount(0);

  // Once text exists, X remains an immediate, explicit escape hatch.
  await tap(page, 'KeyX');
  await tap(page, 'KeyX'); // type the initially focused "q"
  await tap(page, 'KeyA'); // logical X = Cancel
  await expect(page.locator('.modal')).toHaveCount(0);

  // Enter the mock's known bad password using only cabinet controls.
  await tap(page, 'KeyX');
  await tap(page, 'ArrowRight');
  await tap(page, 'KeyX'); // w
  await tap(page, 'ArrowRight', 2);
  await tap(page, 'KeyX'); // r
  await tap(page, 'ArrowRight', 5);
  await tap(page, 'KeyX'); // o
  await tap(page, 'ArrowDown', 2);
  await tap(page, 'ArrowLeft', 3);
  await tap(page, 'KeyX'); // n
  await tap(page, 'ArrowUp');
  await tap(page, 'ArrowLeft');
  await tap(page, 'KeyX'); // g
  await tap(page, 'Enter'); // START = Connect

  // Failure is visible and returns to the editable password instead of trapping
  // the player or silently discarding their input.
  await expect(page.locator('.modal')).toContainText('Wrong password');
  await expect(page.locator('.osk-display')).toHaveText('•••••');
  await tap(page, 'KeyA'); // cancel retry
  await expect(page.locator('.modal')).toHaveCount(0);

  // Passwordless networks use the same connection result path.
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');
  await expect(page.getByText('Connected to MOCK-CoffeeShop')).toBeVisible();

  // Returning home reflects the actual active SSID instead of an always-green
  // generic WiFi badge.
  await tap(page, 'KeyZ');
  await tap(page, 'KeyZ');
  await expect(page.locator('.status-chips')).toContainText('MOCK-CoffeeShop');

  expect(errors).toEqual([]);
});

test('keyboard-only: create via guided details → honest progress → ready → play boots and responds', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await toMenu(page);

  // New Game is the first (selected) list item
  await tap(page, 'KeyX');
  await expect(page.locator('.screen-title', { hasText: 'NEW GAME' })).toBeVisible();

  // Step 1: Skip photo
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX');

  // Step 2: choose a game type, then return to the compact details form.
  await expect(page.getByText('TELL SPARK WHAT MATTERS')).toBeVisible();
  await tap(page, 'ArrowDown'); // Type
  await tap(page, 'KeyX');
  await expect(page.locator('.archetype-card').first()).toBeVisible();
  await tap(page, 'KeyX'); // Platformer
  await expect(page.locator('.game-details-stage')).toContainText('Platformer');
  await expect(page.getByText(/estimate|Checking cost/)).toBeVisible();

  // Generate
  await tap(page, 'ArrowDown', 2); // Create Game
  await tap(page, 'KeyX');

  // Honest stage checklist + cost ticker
  await expect(page.locator('.screen-title', { hasText: 'SPARK IS BUILDING' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.gen-state')).toBeVisible();
  await expect(page.locator('.cost-ticker')).toBeVisible();

  // Done → play
  await expect(page.getByText('GAME READY!')).toBeVisible({ timeout: 120_000 });
  await tap(page, 'KeyX');
  const canvas = page.locator('.play-screen canvas');
  await expect(canvas).toBeVisible();

  // canvas is actually rendering (frames differ)
  await page.waitForTimeout(600);
  const frameA = await canvas.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  await tap(page, 'KeyX'); // skip how-to card (input responds)
  await page.waitForTimeout(900);
  const frameB = await canvas.evaluate(
    (c: HTMLCanvasElement) => c.toDataURL().length + c.toDataURL().slice(0, 512),
  );
  expect(frameB).not.toBe(frameA);

  // guaranteed shell escape: hold START ~2.3s → back to the home launcher
  await hold(page, 'Enter', 2400);
  await expect(page.locator('.home-list')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.badge.ready, .badge.golden').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('score entry persists across a full page reload', async ({ page }) => {
  await toMenu(page);
  await tap(page, 'ArrowDown'); // select the first game → its detail loads
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
  await expect(page.locator('.home-item.new')).toBeVisible(); // home mounted
  await tap(page, 'ArrowDown'); // first game → detail
  await expect(page.locator('.score-table')).toContainText('DAN');
  await expect(page.locator('.score-table')).toContainText('4321');
});

test('generation progress survives a page reload (durable jobs)', async ({ page }) => {
  test.setTimeout(240_000);
  await toMenu(page);
  // start another preset generation
  await tap(page, 'KeyX'); // New Game
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX'); // skip photo
  await tap(page, 'ArrowDown'); // Type
  await tap(page, 'KeyX'); // archetype carousel
  await tap(page, 'ArrowRight');
  await tap(page, 'KeyX'); // second archetype
  await expect(page.locator('.game-details-stage')).toContainText('Vertical Shooter');
  await tap(page, 'ArrowDown', 2); // Create Game
  await tap(page, 'KeyX'); // generate
  await expect(page.locator('.screen-title', { hasText: 'SPARK IS BUILDING' })).toBeVisible();

  // reload mid-generation: the shell restores real job state from the server
  await page.reload();
  await expect(page.locator('.press-start')).toBeVisible();
  await tap(page, 'Enter');
  await expect(page.locator('.home-item.new')).toBeVisible(); // home mounted
  // the library (home list) must reflect the job truthfully once it finishes
  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const games = (await (await fetch('/api/games')).json()) as { status: string }[];
          return games.filter((g) => g.status === 'ready').length;
        }),
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(8); // 6 goldens + 2 generated
});

test('delete flow: Cancel is the default; hold-A deletes', async ({ page }) => {
  await toMenu(page);
  const countBefore = await page.locator('.home-item.game').count();
  expect(countBefore).toBeGreaterThanOrEqual(7);
  await tap(page, 'ArrowDown'); // first game (newest generated)
  await tap(page, 'KeyX'); // focus into the detail panel (actions: Play | Cloud | Delete)

  // open delete modal: move to Delete, A
  await tap(page, 'ArrowRight', 2); // → Delete action
  await tap(page, 'KeyX');
  await expect(page.locator('.modal')).toContainText('Delete');

  // default is Cancel: pressing A closes without deleting
  await tap(page, 'KeyX');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.home-item.game')).toHaveCount(countBefore);

  // now really delete: reopen, focus Delete, hold A for 3s+
  await tap(page, 'KeyX'); // A on the Delete action → modal
  await tap(page, 'ArrowRight'); // move to Delete inside the modal
  await expect(page.locator('.modal')).toContainText('Hold');
  // releasing early cancels
  await hold(page, 'KeyX', 800);
  await expect(page.locator('.modal')).toBeVisible();
  // full hold deletes
  await hold(page, 'KeyX', 3600);
  await expect(page.locator('.modal')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.home-item.game')).toHaveCount(countBefore - 1, { timeout: 10_000 });
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

  const sequence = [
    'KeyI',
    'KeyK',
    'KeyJ',
    'KeyL',
    'KeyX',
    'KeyZ',
    'KeyC',
    'KeyV',
    'KeyQ',
    'KeyW',
    'Enter',
    'ShiftRight',
  ];
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
  await expect(page.locator('.home-item.new')).toBeVisible({ timeout: 10_000 });

  // the new map is live: KeyI now navigates up. Verify via saved settings, then restore defaults.
  const saved = await page.evaluate(
    async () =>
      (await (await fetch('/api/settings')).json()) as {
        input: { keyboard: Record<string, string> };
      },
  );
  expect(saved.input.keyboard['KeyI']).toBe('UP');
  expect(saved.input.keyboard['Enter']).toBe('START');
  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: {
          keyboard: {
            ArrowUp: 'UP',
            ArrowDown: 'DOWN',
            ArrowLeft: 'LEFT',
            ArrowRight: 'RIGHT',
            KeyX: 'A',
            KeyZ: 'B',
            KeyA: 'X',
            KeyS: 'Y',
            KeyQ: 'L',
            KeyW: 'R',
            Enter: 'START',
            ShiftRight: 'SELECT',
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

test('generates and plays an armed climber with the complete action sprite set', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  const response = await request.post('/api/games', {
    multipart: {
      promptText:
        'A platformer with a blaster and wall jumping, mixing horizontal stages and a tower climb',
      sourceKind: 'surprise',
      requestedArchetype: 'platformer',
      idempotencyKey: 'e2e-armed-climber',
    },
  });
  expect(response.ok()).toBe(true);
  const { gameId } = await response.json();
  await expect
    .poll(
      async () => {
        const game = await (await request.get(`/api/games/${gameId}`)).json();
        if (game.job?.status === 'failed') throw new Error(JSON.stringify(game.job.error));
        return game.item.status;
      },
      { timeout: 180_000, intervals: [1000] },
    )
    .toBe('ready');
  const game = await (await request.get(`/api/games/${gameId}`)).json();
  expect(game.spec).toMatchObject({
    playStyle: 'armedClimber',
    actionPoseVersion: 1,
    mechanics: { traversal: 'wallJump', combat: 'blaster', structure: 'mixed' },
  });
  for (const role of [
    'platformerShoot',
    'platformerShootUp',
    'platformerRunShoot1',
    'platformerRunShoot2',
    'platformerRunShootUp1',
    'platformerRunShootUp2',
    'platformerJumpShoot',
    'platformerJumpShootUp',
    'platformerWallSlide',
    'platformerWallShoot',
    'platformerWallShootUp',
  ])
    expect(game.assets[role], role).toBe(true);
  const loaded = new Set<string>();
  page.on('response', (response) => {
    if (response.url().includes(`/api/games/${gameId}/assets/platformer-player-`) && response.ok())
      loaded.add(response.url());
  });
  await toMenu(page);
  await tap(page, 'ArrowDown');
  await tap(page, 'KeyX', 2);
  const canvas = page.locator('.play-screen canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => loaded.size).toBe(16);
  await tap(page, 'KeyX', 6);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyS');
  await hold(page, 'KeyX', 500);
  await page.keyboard.up('KeyS');
  await hold(page, 'KeyA', 900);
  await page.keyboard.up('ArrowRight');
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
  await page.goto(`http://127.0.0.1:5198/?dev=playtest&game=${gameId}`);
  await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
  const combat = await page.evaluate(checkPlatformerCombat);
  expect(
    combat.results.filter((result) => !result.pass),
    JSON.stringify(combat),
  ).toEqual([]);
});
test('golden racing cup: fast deterministic full cup under GameHost', async ({
  page,
}) => {
  // Fast-forwarded: the rAF loop stops and the test steps host.update
  // directly in batches, so a full cup takes ~1 minute, not ~9.
  test.setTimeout(300_000);
  const errors = trackErrors(page);
  await page.goto('http://127.0.0.1:5198/?dev=playtest&game=golden-racing');
  await page.waitForFunction(() => !!(window as any).sparkadePlaytest?.instance);
  await page.evaluate(() => (window as any).sparkadePlaytest.loop.stop());
  // Test-local press: the key stays physically down across real updates
  // (held polls), then releases across more updates (edge resets). The
  // broker latches ultra-fast taps, but one held press yields exactly one
  // consumed edge, so each press advances exactly one card/phase.
  const press = async (code: 'KeyX' | 'Enter', holdSteps = 30, restSteps = 30) => {
    await page.keyboard.down(code);
    await page.evaluate((n: number) => {
      const h = (window as any).sparkadePlaytest;
      for (let i = 0; i < n; i++) h.update(1 / 60);
    }, holdSteps);
    await page.keyboard.up(code);
    await page.evaluate((n: number) => {
      const h = (window as any).sparkadePlaytest;
      for (let i = 0; i < n; i++) h.update(1 / 60);
    }, restSteps);
  };
  // Explicit A through the host how-to card (how-to is host state, not engine cards).
  for (let i = 0; i < 10; i++) {
    const st = await page.evaluate(() => (window as any).sparkadePlaytest.state);
    if (st === 'game') break;
    await press('KeyX');
  }
  // One batch: up to 600 fixed steps plus a periodic render, stopping
  // immediately at results/cards/cupEnd so the test answers promptly.
  // Autopilot is owned inside the batch: on for title/countdown driving,
  // off the moment results/cupEnd appear, so no batch ever skips a manual
  // confirmation.
  const step = () =>
    page.evaluate(() => {
      const h = (window as any).sparkadePlaytest;
      const dev = h.instance.racingDev;
      const atStart = dev.snapshot().phase as string;
      if (atStart === 'title' || atStart === 'countdown') dev.setAutopilot(true);
      if (atStart === 'results' || atStart === 'cupEnd') dev.setAutopilot(false);
      let stop = '';
      for (let i = 0; i < 600; i++) {
        h.update(1 / 60);
        if (i % 200 === 0) h.render();
        const ph = dev.snapshot().phase as string;
        if (ph === 'results' || ph === 'cupEnd') {
          // Stop automatic confirmation before the caller's press helper
          // advances any more frames through this new phase.
          dev.setAutopilot(false);
          stop = ph;
          break;
        }
        if (h.engineCtx.cards.active) {
          stop = 'cards';
          break;
        }
      }
      const s = dev.snapshot();
      return {
        stop,
        phase: s.phase as string,
        trackId: s.trackId as string,
        raceIndex: s.cup.raceIndex as number,
        complete: s.cup.complete as boolean,
        points: s.cup.points as number[],
        speed: s.player.speed as number,
        lap: s.player.lap as number,
        t: s.t as number,
        cards: !!h.engineCtx.cards.active,
        hostState: h.state as string,
        resultNull: h.instance.result === null,
      };
    });
  const visited: string[] = [];
  const laps: Record<string, number> = {};
  const trail: string[] = [];
  let pauseChecked = false;
  let confirmedNull = false;
  for (let b = 0; b < 300; b++) {
    const st = await step();
    if (!visited.includes(st.trackId)) visited.push(st.trackId);
    if (st.phase === 'results') laps[st.trackId] = Math.max(laps[st.trackId] ?? 0, st.lap);
    const mark = `${b}:${st.hostState}/${st.phase}${st.cards ? '+cards' : ''}`;
    if (trail[trail.length - 1] !== mark) trail.push(mark);
    // Tally exits first: once the host takes over, phase snapshots lag the
    // confirmed result and must not be re-asserted as null.
    if (st.hostState === 'tally') break;
    if (st.cards) {
      await press('KeyX'); // actual A through story cards
      continue;
    }
    // Real acceleration on real physics, no teleports.
    if (st.phase === 'race' && !pauseChecked) {
      expect(st.speed).toBeGreaterThan(5);
      await press('Enter', 5, 5); // START pauses via the real host path
      expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('paused');
      const t1 = (
        await page.evaluate(() => (window as any).sparkadePlaytest.instance.racingDev.snapshot())
      ).t;
      await page.evaluate(() => {
        const h = (window as any).sparkadePlaytest;
        for (let i = 0; i < 60; i++) h.update(1 / 60);
      });
      expect(
        (
          await page.evaluate(
            () => (window as any).sparkadePlaytest.instance.racingDev.snapshot(),
          )
        ).t,
      ).toBe(t1);
      await press('Enter', 5, 5);
      expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('game');
      pauseChecked = true;
      continue;
    }
    if (st.phase === 'results') {
      await press('KeyX'); // manual A through every results screen
      continue;
    }
    if (st.phase === 'cupEnd') {
      // Null exactly before the manual confirmation, non-null after the
      // narrative plays out (asserted below at tally).
      if (!confirmedNull) {
        expect(st.resultNull).toBe(true);
        confirmedNull = true;
      }
      await press('KeyX'); // actual A confirms the standings
      continue;
    }
  }
  console.log(`racing-e2e trail: ${trail.join(' ')}`);
  expect(pauseChecked).toBe(true);
  expect(confirmedNull).toBe(true);
  expect(visited).toEqual(['ember', 'coral', 'ratchet']);
  // Actual physics laps on all three — a timeout DNF banks points too, but
  // only real driving banks laps.
  expect(laps).toEqual({ ember: 3, coral: 3, ratchet: 3 });
  const end = await page.evaluate(
    () => (window as any).sparkadePlaytest.instance.racingDev.snapshot(),
  );
  expect(end.cup.complete).toBe(true);
  expect((end.cup.points as number[]).reduce((a, b) => a + b, 0)).toBe(66);
  expect(await page.evaluate(() => (window as any).sparkadePlaytest.state)).toBe('tally');

  expect(errors).toEqual([]);
});
