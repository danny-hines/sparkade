'use client';
import { usePlayTracking } from './use-play-tracking';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameHost, InputBroker } from '@sparkade/engine';
import { GENERATED_GAME_ASSET_FILES, type GameSpec } from '@sparkade/shared';
import type {
  RuntimeGameAssetAvailability,
  RuntimeGameAssetFilename,
} from '@sparkade/web/likeness-assets';
import { dpadKeysAtPoint, type DpadKey } from './dpad-direction';
import { fetchHighScores, submitHighScore } from '@/lib/score-client';

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

function TouchDpad() {
  const activePointer = useRef<number | null>(null);
  const heldKeys = useRef<Set<DpadKey>>(new Set());
  const [activeKeys, setActiveKeys] = useState<Set<DpadKey>>(() => new Set());

  const setDirection = (nextKeys: DpadKey[]) => {
    const next = new Set(nextKeys);
    for (const code of heldKeys.current) {
      if (!next.has(code)) dispatchKey('keyup', code);
    }
    for (const code of next) {
      if (!heldKeys.current.has(code)) dispatchKey('keydown', code);
    }
    heldKeys.current = next;
    setActiveKeys(next);
  };

  const release = () => {
    activePointer.current = null;
    setDirection([]);
  };

  useEffect(() => {
    const handleBlur = () => release();
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      for (const code of heldKeys.current) dispatchKey('keyup', code);
      heldKeys.current.clear();
    };
  }, []);

  const updateDirection = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDirection(
      dpadKeysAtPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
      ),
    );
  };

  const directionalButton = (
    direction: 'up' | 'down' | 'left' | 'right',
    code: DpadKey,
  ) => (
    <button
      type="button"
      className={`public-control public-control-${direction}`}
      aria-label={TOUCH_CONTROLS[direction].action}
      data-active={activeKeys.has(code)}
      tabIndex={-1}
    >
      {TOUCH_CONTROLS[direction].label}
    </button>
  );

  return (
    <div
      className="public-dpad"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (activePointer.current !== null) return;
        event.preventDefault();
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateDirection(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== activePointer.current) return;
        event.preventDefault();
        updateDirection(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== activePointer.current) return;
        event.preventDefault();
        release();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === activePointer.current) release();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === activePointer.current) release();
      }}
    >
      {directionalButton('up', 'ArrowUp')}
      {directionalButton('left', 'ArrowLeft')}
      {directionalButton('right', 'ArrowRight')}
      {directionalButton('down', 'ArrowDown')}
    </div>
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
  trackPlays = true,
}: {
  id: string;
  spec: GameSpec;
  assets: Record<string, string>;
  trackPlays?: boolean;
}) {
  const playerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoresRef = useRef<Array<{ initials: string; score: number }>>([]);
  const [state, setState] = useState<PlayerState>('idle');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [scoreError, setScoreError] = useState('');

  useEffect(() => {
    scoresRef.current = [];
  }, [id]);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setFullscreenAvailable(
      Boolean(document.fullscreenEnabled && playerRef.current?.requestFullscreen),
    );
    setShowInstallHint(/iPhone/i.test(navigator.userAgent) && !standalone);

    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (state !== 'playing' || !canvasRef.current) return;

    let input: InputBroker | null = null;
    let host: GameHost | null = null;
    let disposed = false;

    setLoading(true);
    setScoreError('');
    void (async () => {
      try {
        const [{ archetypes }, { GameHost, InputBroker }, { loadLikenessAssets }, initialScores] =
          await Promise.all([
            import('@sparkade/archetypes'),
            import('@sparkade/engine'),
            import('@sparkade/web/likeness-assets'),
            trackPlays
              ? fetchHighScores(id).catch(() => {
                  if (!disposed)
                    setScoreError('High scores are unavailable right now. You can still play.');
                  return scoresRef.current;
                })
              : Promise.resolve(scoresRef.current),
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
        scoresRef.current = initialScores;

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
              if (trackPlays) {
                try {
                  const rows = await submitHighScore(id, initials, score);
                  if (!disposed) {
                    scoresRef.current = rows;
                    setScoreError('');
                  }
                  return rows;
                } catch {
                  if (!disposed)
                    setScoreError('Your score could not be saved. Please check your connection.');
                }
                return scoresRef.current;
              }
              // Admin previews keep their scores in this session only.
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
  }, [assets, id, spec, state, trackPlays]);

  const inactive = state !== 'playing' || loading;
  usePlayTracking(id, !inactive, trackPlays);

  const enterFullscreen = () => {
    if (!document.fullscreenEnabled || !playerRef.current?.requestFullscreen) return;
    void playerRef.current.requestFullscreen().catch(() => {
      // Fullscreen is an enhancement; playback should still begin if the browser refuses it.
    });
  };

  const startPlaying = () => {
    enterFullscreen();
    setState('playing');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    enterFullscreen();
  };

  return (
    <section ref={playerRef} className="public-player" aria-label={`Play ${spec.meta.title}`}>
      <div className="public-player-stage">
        <div className="public-control-rail" aria-label="Directional controls">
          <TouchButton control={TOUCH_CONTROLS.l} className="public-control-shoulder" />
          <TouchDpad />
          <TouchButton control={TOUCH_CONTROLS.select} className="public-control-system" />
        </div>

        <div className="public-game-frame">
          <canvas ref={canvasRef} width={1024} height={600} />
          {fullscreenAvailable && (state === 'playing' || isFullscreen) ? (
            <button
              type="button"
              className="public-fullscreen-toggle"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={toggleFullscreen}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {isFullscreen ? (
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4m11 5v-5h5" />
                ) : (
                  <path d="M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5" />
                )}
              </svg>
            </button>
          ) : null}
          {inactive ? (
            <div className="public-player-curtain">
              {loading ? (
                <p>Loading game artwork…</p>
              ) : state === 'error' ? (
                <>
                  <p>{error}</p>
                  <button type="button" onClick={startPlaying}>
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <p>{state === 'exited' ? 'Thanks for playing.' : 'Your arcade is ready.'}</p>
                  <button type="button" onClick={startPlaying}>
                    {state === 'exited' ? 'Play again' : 'Play now'}
                  </button>
                  {showInstallHint ? (
                    <p className="public-install-hint">
                      For fullscreen on iPhone, tap Share, then Add to Home Screen.
                    </p>
                  ) : null}
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
      {scoreError && (
        <p role="status" className="public-player-help">
          {scoreError}
        </p>
      )}
    </section>
  );
}
