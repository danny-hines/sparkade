// DEV-only racing harness (http://localhost:5173/?dev=racing): boots the
// hover-cup core straight into a Renderer + InputBroker + GameLoop with no
// pipeline, no menu, no GameHost. Keyboard: arrows steer, Z (B) accelerate,
// S (Y) brake, X (A) boost, Q/W (L/R) drift, Enter (START) advance/results.
// Stripped from production builds via the import.meta.env.DEV gate in app.tsx.
//
// Diagnostics panel (DEV only, never production): read-only snapshot polled
// from game.racingDev (cup race/track/phase, race clock, render fps, player
// s/x/speed/lap/pos, boost, cup points) plus Reset, Next-race, and Autopilot
// toggle. No window/global handle is installed.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameLoop, InputBroker, Renderer } from '@sparkade/engine';
import { createRacingGame } from '@sparkade/archetypes';
import type { EngineContext, GameInstance } from '@sparkade/engine';
import type { RacingDevHandle, RacingDevSnapshot } from '@sparkade/archetypes';

type DevGame = GameInstance & RacingDevHandle;

export function RacingDevScreen(): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<DevGame | null>(null);
  const [snap, setSnap] = useState<RacingDevSnapshot | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    const input = new InputBroker();
    input.attach(window);
    // The racing core only needs engine.renderer; the rest is unused in DEV
    // (sound hooks degrade gracefully without engine.sfx).
    const engine = { renderer } as unknown as EngineContext;
    const game = createRacingGame(engine) as DevGame;
    gameRef.current = game;
    game.start();
    const loop = new GameLoop({
      update: (dt: number) => game.update(dt, input.poll()),
      render: () => {
        game.render();
        game.renderHud?.();
        renderer.present();
      },
    });
    loop.start();
    const poll = window.setInterval(() => {
      setSnap(game.racingDev.snapshot());
    }, 250);
    return () => {
      window.clearInterval(poll);
      gameRef.current = null;
      loop.stop();
      game.dispose();
      input.detach(window);
    };
  }, []);
  const onReset = (): void => {
    gameRef.current?.racingDev.reset();
  };
  const onAdvance = (): void => {
    gameRef.current?.racingDev.advance();
  };
  const onAutopilot = (e: Event): void => {
    const on = (e.target as HTMLInputElement).checked;
    setAutopilot(on);
    gameRef.current?.racingDev.setAutopilot(on);
  };
  const p = snap?.player;
  return (
    <div style="display:flex;flex-direction:column;align-items:center;background:#000;height:100vh;overflow:hidden">
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;width:100%">
        <canvas
          ref={ref}
          style="max-width:100%;max-height:100%;aspect-ratio:1024/600;width:auto;height:auto;image-rendering:pixelated"
        />
      </div>
      <div style="color:#aee9f1;font:11px monospace;padding:2px 8px;white-space:nowrap">
        Arrows steer · Z accel · S brake · X boost · Q/W drift · X advances
      </div>
      <div style="color:#ffd94d;font:11px monospace;padding:0 8px;white-space:pre">
        {snap && p
          ? `R${snap.cup.raceIndex + 1}/${snap.cup.raceCount} ${snap.trackName} [${snap.phase}] pts=[${snap.cup.points.join(',')}] t=${snap.t.toFixed(0)}s fps=${snap.fps} lap=${p.lap + 1} pos=${p.pos}/5 v=${p.speed.toFixed(0)} b=${Math.round(p.boost * 100)}%${snap.over ? ' FIN' : ''}`
          : 'snapshot…'}
      </div>
      <div style="display:flex;gap:12px;align-items:center;padding:2px 8px 6px">
        <button type="button" onClick={onReset} style="font:11px monospace;padding:2px 10px">
          Reset race
        </button>
        <button type="button" onClick={onAdvance} style="font:11px monospace;padding:2px 10px">
          Next race
        </button>
        <label style="color:#aee9f1;font:11px monospace">
          <input type="checkbox" checked={autopilot} onChange={onAutopilot} /> Autopilot (AI drives player)
        </label>
      </div>
    </div>
  );
}
