// Dev-only playtest harness (http://localhost:5173/?dev=playtest&arch=hshooter):
// boots a golden game straight into the real GameHost with a keyboard
// InputBroker — no pipeline, no menu. Pass `&game=<id>` to load a saved game,
// or `&auto=1` to skip cards and run the attract AI for a hands-free visual
// check. DEV-gated in app.tsx (stripped from prod).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost, InputBroker } from '@sparkade/engine';
import { archetypes, platformerStyleExample } from '@sparkade/archetypes';
import {
  PLATFORMER_PLAY_STYLES,
  PLATFORMER_STYLE_CATALOG,
  type GameSpec,
  type PlatformerPlayStyle,
} from '@sparkade/shared';
import { api } from '../api';
import { loadLikenessAssets } from '../likeness-assets';
import goldenHshooter from '../../../generation/golden/golden-hshooter.json';

const GOLDENS: Record<string, unknown> = { hshooter: goldenHshooter };

export function PlaytestScreen(): ComponentChildren {
  const comparison = new URLSearchParams(location.search).has('style');
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [artNote, setArtNote] = useState('');
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const params = new URLSearchParams(location.search);
    let disposed = false;
    let host: GameHost | null = null;
    const input = new InputBroker();
    input.attach(window);

    void (async () => {
      try {
        const style = params.get('style');
        if (style && !PLATFORMER_PLAY_STYLES.includes(style as PlatformerPlayStyle))
          throw new Error('Unknown platformer play style');
        const gameId = params.get('game') ?? (style ? 'golden-platformer' : null);
        const detail = gameId ? await api.getGame(gameId) : null;
        const arch = params.get('arch') ?? 'hshooter';
        let spec = (detail?.spec ?? GOLDENS[arch]) as GameSpec | undefined;
        if (!spec) throw new Error(`Unknown playtest game or archetype: ${gameId ?? arch}`);
        if (style && spec.archetype === 'platformer')
          spec = platformerStyleExample(spec, style as PlatformerPlayStyle);
        const likeness = gameId && detail ? await loadLikenessAssets(gameId, detail.assets) : null;
        const actionRun = params.get('actionRun');
        if (actionRun && spec.archetype === 'platformer' && likeness) {
          const response = await fetch(
            `/api/dev/platformer-actions/${encodeURIComponent(actionRun)}`,
          );
          if (!response.ok) throw new Error('Action experiment could not be loaded');
          const experiment = (await response.json()) as {
            style: string;
            mode: string;
            error: string | null;
            poses: Record<string, string>;
          };
          if (experiment.style === spec.playStyle) {
            if (experiment.error) throw new Error(experiment.error);
            const actions = await Promise.all(
              Object.entries(experiment.poses).map(async ([pose, src]) => {
                const image = new Image();
                image.src = src;
                await image.decode();
                return [pose, image] as const;
              }),
            );
            likeness.platformerPoses = {
              ...likeness.platformerPoses,
              ...Object.fromEntries(actions),
            };
            spec.actionPoseVersion = 1;
            setArtNote(
              `${experiment.mode === 'live' ? 'Live generated' : 'Mock'} action poses · ${actionRun}`,
            );
          }
        } else if (comparison)
          setArtNote(
            'Controller comparison with legacy base artwork. New games generate mechanic-specific action poses.',
          );
        if (disposed) return;
        host = new GameHost({
          canvas,
          spec,
          archetype: archetypes[spec.archetype],
          input,
          likeness,
          attract: params.get('auto') === '1',
          volumes: { musicVol: 0, sfxVol: 0, uiVol: 0 },
          callbacks: {
            onQuit: () => {},
            onVolumesChanged: () => {},
            initialScores: [],
            submitScore: async () => [],
          },
        });
        host.start();
        // Dev-only inspection point for deterministic input replay and canvas diagnostics.
        (window as Window & { sparkadePlaytest?: GameHost }).sparkadePlaytest = host;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Playtest failed to load.');
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      delete (window as Window & { sparkadePlaytest?: GameHost }).sparkadePlaytest;
      input.detach(window);
    };
  }, []);
  return (
    <div style="display:flex;flex-direction:column;align-items:center;min-height:600px;background:#000">
      {comparison && (
        <nav
          style="display:flex;gap:20px;padding:12px;color:white;font:14px monospace"
          aria-label="Platformer play styles"
        >
          {PLATFORMER_PLAY_STYLES.map((style) => (
            <a
              key={style}
              style="color:#aee9f1"
              href={`/?dev=playtest&style=${style}${new URLSearchParams(location.search).has('actionRun') ? `&actionRun=${encodeURIComponent(new URLSearchParams(location.search).get('actionRun')!)}` : ''}`}
            >
              {PLATFORMER_STYLE_CATALOG[style].name}
            </a>
          ))}
        </nav>
      )}
      {artNote && <div style="color:#aab3d5;font:12px monospace;padding-bottom:6px">{artNote}</div>}
      {error ? (
        <div style="color:#ff6170;font:20px monospace">{error}</div>
      ) : (
        <canvas
          ref={ref}
          style={
            comparison
              ? 'image-rendering:pixelated;width:min(1024px,100vw,calc((100vh - 64px) * 1.706667));height:auto;aspect-ratio:1024/600'
              : 'image-rendering:pixelated;width:1024px;height:600px'
          }
          tabIndex={0}
        />
      )}
    </div>
  );
}
