// Dev-only playtest harness (http://localhost:5173/?dev=playtest&arch=hshooter):
// boots a golden game straight into the real GameHost with a keyboard
// InputBroker — no pipeline, no menu. Pass `&game=<id>` to load a saved game,
// or `&auto=1` to skip cards and run the attract AI for a hands-free visual
// check. DEV-gated in app.tsx (stripped from prod).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost, InputBroker } from '@sparkade/engine';
import { archetypes } from '@sparkade/archetypes';
import type { GameSpec } from '@sparkade/shared';
import { api } from '../api';
import { loadLikenessAssets } from '../likeness-assets';
import goldenHshooter from '../../../generation/golden/golden-hshooter.json';
import goldenFighter from '../../../generation/golden/golden-fighter.json';

const GOLDENS: Record<string, unknown> = { hshooter: goldenHshooter, fighter: goldenFighter };

export function PlaytestScreen(): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
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
        const gameId = params.get('game');
        const detail = gameId ? await api.getGame(gameId) : null;
        const arch = params.get('arch') ?? 'hshooter';
        const spec = (detail?.spec ?? GOLDENS[arch]) as GameSpec | undefined;
        if (!spec) throw new Error(`Unknown playtest game or archetype: ${gameId ?? arch}`);
        const likeness = gameId && detail ? await loadLikenessAssets(gameId, detail.assets) : null;
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
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Playtest failed to load.');
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      input.detach(window);
    };
  }, []);
  return (
    <div style="display:flex;justify-content:center;align-items:center;height:600px;background:#000">
      {error ? (
        <div style="color:#ff6170;font:20px monospace">{error}</div>
      ) : (
        <canvas
          ref={ref}
          style="image-rendering:pixelated;width:1024px;height:600px"
          tabIndex={0}
        />
      )}
    </div>
  );
}
