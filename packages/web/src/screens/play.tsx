// Play screen: fullscreen engine canvas. The GameHost owns the loop, pause,
// initials and leaderboard flow; the shell hands over the InputBroker and gets
// it back on quit.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost, type LikenessAssets } from '@sparkade/engine';
import { archetypes } from '@sparkade/archetypes';
import type { GameSpec } from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { shellInput } from '../shell-input';
import { Btn } from '../icons';
import type { Screen } from '../app';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function PlayScreen(props: {
  go: (s: Screen) => void;
  id: string;
  settings: SettingsPayload | null;
  onSettingsChanged: () => void;
}): ComponentChildren {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let host: GameHost | null = null;
    let disposed = false;

    void (async () => {
      try {
        const detail = await api.getGame(props.id);
        const spec = detail.spec as GameSpec | null;
        if (!spec || detail.item.status !== 'ready') {
          setError('This game is not playable yet.');
          return;
        }
        const scores = await api.getScores(props.id).catch(() => []);
        const likeness: LikenessAssets | null = detail.assets.portrait
          ? {
              head12: await loadImage(api.assetUrl(props.id, 'head12.png')),
              head16: await loadImage(api.assetUrl(props.id, 'head16.png')),
              portrait: await loadImage(api.assetUrl(props.id, 'portrait.png')),
            }
          : null;
        if (disposed || !canvasRef.current) return;

        // Hand raw input over to the engine for the duration of play.
        shellInput.setSuspended(true);
        shellInput.setRemapHoldEnabled(false);

        host = new GameHost({
          canvas: canvasRef.current,
          spec,
          archetype: archetypes[spec.archetype],
          input: shellInput.broker,
          likeness,
          volumes: props.settings?.audio ?? { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 },
          callbacks: {
            onQuit: () => {
              shellInput.setSuspended(false);
              props.go({ name: 'home', id: props.id });
            },
            onVolumesChanged: (v) => {
              void api.saveSettings({ audio: v }).then(props.onSettingsChanged);
            },
            initialScores: scores.map((s) => ({ initials: s.initials, score: s.score })),
            submitScore: async (initials, score) => {
              const rows = await api.submitScore(props.id, initials, score);
              return rows.map((s) => ({ initials: s.initials, score: s.score }));
            },
          },
        });
        host.start();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load the game.');
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      shellInput.setSuspended(false);
    };
  }, [props.id]);

  useEffect(() => {
    if (!error) return undefined;
    return shellInput.pushHandler((btn) => {
      if (btn === 'A' || btn === 'B') props.go({ name: 'home', id: props.id });
    });
  }, [error, props.go, props.id]);

  return (
    <div class="screen play-screen">
      {error ? (
        <div class="center-col">
          <div style="color:var(--danger);font-size:22px">{error}</div>
          <div style="color:var(--text-dim)"><Btn>A</Btn> Back</div>
        </div>
      ) : (
        <canvas ref={canvasRef} width={1024} height={600} />
      )}
    </div>
  );
}
