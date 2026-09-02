'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameHost, InputBroker } from '@sparkade/engine';
import { GENERATED_GAME_ASSET_FILES, type GameSpec } from '@sparkade/shared';
import type {
  RuntimeGameAssetAvailability,
  RuntimeGameAssetFilename,
} from '@sparkade/web/likeness-assets';

type PlayerState = 'idle' | 'playing' | 'exited' | 'error';

const TOUCH_CONTROLS = {
  up: { code: 'ArrowUp', label: '▲', action: 'Move up' },
  down: { code: 'ArrowDown', label: '▼', action: 'Move down' },
  left: { code: 'ArrowLeft', label: '◀', action: 'Move left' },
  right: { code: 'ArrowRight', label: '▶', action: 'Move right' },
  a: { code: 'KeyX', label: 'A', action: 'A button' },
  b: { code: 'KeyZ', label: 'B', action: 'B button' },
  x: { code: 'KeyA', label: 'X', action: 'X button' },
  y: { code: 'KeyS', label: 'Y', action: 'Y button' },
  l: { code: 'KeyQ', label: 'L', action: 'Left shoulder button' },
  r: { code: 'KeyW', label: 'R', action: 'Right shoulder button' },
  start: { code: 'Enter', label: 'Start', action: 'Start button' },
  select: { code: 'ShiftRight', label: 'Select', action: 'Select button' },
} as const;

function dispatchKey(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function TouchButton({
  control,
  className = '',
}: {
  control: (typeof TOUCH_CONTROLS)[keyof typeof TOUCH_CONTROLS];
  className?: string;
}) {
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dispatchKey('keyup', control.code);
  };

  return (
    <button
      type="button"
      className={`public-control ${className}`}
      aria-label={control.action}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatchKey('keydown', control.code);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {control.label}
    </button>
  );
}

function assetAvailability(assets: Record<string, string>): RuntimeGameAssetAvailability {
  const generated = Object.fromEntries(
    Object.entries(GENERATED_GAME_ASSET_FILES).map(([role, filename]) => [
      role,
      Boolean(assets[filename]),
    ]),
  ) as Record<keyof typeof GENERATED_GAME_ASSET_FILES, boolean>;
  return {
    head12: Boolean(assets['head12.png']),
    head12Side: Boolean(assets['head12-side.png']),
    head12Back: Boolean(assets['head12-back.png']),
    head16: Boolean(assets['head16.png']),
    head16Side: Boolean(assets['head16-side.png']),
    head16Back: Boolean(assets['head16-back.png']),
    portrait: Boolean(assets['portrait.png']),
    ...generated,
  };
}

export function PublicGamePlayer({
  id,
  spec,
  assets,
}: {
  id: string;
  spec: GameSpec;
  assets: Record<string, string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoresRef = useRef<Array<{ initials: string; score: number }>>([]);
  const [state, setState] = useState<PlayerState>('idle');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state !== 'playing' || !canvasRef.current) return;

    let input: InputBroker | null = null;
    let host: GameHost | null = null;
    let disposed = false;

    setLoading(true);
    void (async () => {
      try {
        const [{ archetypes }, { GameHost, InputBroker }, { loadLikenessAssets }] =
          await Promise.all([
            import('@sparkade/archetypes'),
            import('@sparkade/engine'),
            import('@sparkade/web/likeness-assets'),
          ]);
        const archetype = archetypes[spec.archetype];
        if (!archetype) {
          throw new Error('This game uses an engine that is not available in the browser yet.');
        }
        const likeness = await loadLikenessAssets(
          id,
          assetAvailability(assets),
          (filename: RuntimeGameAssetFilename) => assets[filename] ?? '',
        );
        if (disposed || !canvasRef.current) return;

        input = new InputBroker();
        input.attach(window);
        host = new GameHost({
          canvas: canvasRef.current,
          spec,
          archetype,
          input,
          likeness,
          volumes: { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 },
          callbacks: {
            onQuit: () => setState('exited'),
            onVolumesChanged: () => {},
            initialScores: scoresRef.current,
            submitScore: async (initials, score) => {
              scoresRef.current = [...scoresRef.current, { initials, score }]
                .sort((left, right) => right.score - left.score)
                .slice(0, 10);
              return scoresRef.current;
            },
          },
        });
        host.start();
        setLoading(false);
      } catch (cause) {
        if (disposed) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'The game could not start.');
        setState('error');
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      input?.detach(window);
    };
  }, [assets, id, spec, state]);

  const inactive = state !== 'playing' || loading;

  return (
    <section className="public-player" aria-label={`Play ${spec.meta.title}`}>
      <div className="public-player-stage">
        <div className="public-control-rail" aria-label="Directional controls">
          <TouchButton control={TOUCH_CONTROLS.l} className="public-control-shoulder" />
          <div className="public-dpad">
            <TouchButton control={TOUCH_CONTROLS.up} className="public-control-up" />
            <TouchButton control={TOUCH_CONTROLS.left} className="public-control-left" />
            <TouchButton control={TOUCH_CONTROLS.right} className="public-control-right" />
            <TouchButton control={TOUCH_CONTROLS.down} className="public-control-down" />
          </div>
          <TouchButton control={TOUCH_CONTROLS.select} className="public-control-system" />
        </div>

        <div className="public-game-frame">
          <canvas ref={canvasRef} width={1024} height={600} />
          {inactive ? (
            <div className="public-player-curtain">
              {loading ? (
                <p>Loading game artwork…</p>
              ) : state === 'error' ? (
                <>
                  <p>{error}</p>
                  <button type="button" onClick={() => setState('playing')}>
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <p>{state === 'exited' ? 'Thanks for playing.' : 'Your arcade is ready.'}</p>
                  <button type="button" onClick={() => setState('playing')}>
                    {state === 'exited' ? 'Play again' : 'Play now'}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="public-control-rail" aria-label="Action controls">
          <TouchButton control={TOUCH_CONTROLS.r} className="public-control-shoulder" />
          <div className="public-actions">
            <TouchButton control={TOUCH_CONTROLS.x} className="public-control-x" />
            <TouchButton control={TOUCH_CONTROLS.y} className="public-control-y" />
            <TouchButton control={TOUCH_CONTROLS.a} className="public-control-a" />
            <TouchButton control={TOUCH_CONTROLS.b} className="public-control-b" />
          </div>
          <TouchButton control={TOUCH_CONTROLS.start} className="public-control-system" />
        </div>
      </div>

      <p className="public-player-help">
        Arrow keys to move <span>·</span> X = A <span>·</span> Z = B <span>·</span> Enter = Start
      </p>
    </section>
  );
}
