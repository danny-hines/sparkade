// A self-playing preview of a game, shown in the library's detail panel. After a
// short dwell (so scrolling the list doesn't spin games up and down) it boots a
// GameHost in attract mode driven by a PilotBroker: the game plays itself, loops
// forever, and runs with soft music and no SFX. Falls back to the static cover
// while dwelling/loading or for games that aren't ready.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost } from '@sparkade/engine';
import { archetypes } from '@sparkade/archetypes';
import type { ArchetypeId } from '@sparkade/shared';
import { api } from '../api';
import { PilotBroker } from '../demo-pilot';
import { loadLikenessAssets } from '../likeness-assets';

const DWELL_MS = 550; // settle time before a highlighted game starts playing
const DEMO_VOLUMES = { musicVol: 0.3, sfxVol: 0, uiVol: 0 }; // soft theme, no SFX

// The banner is wider-than-tall, so `cover` crops the game vertically. Choose
// which slice survives per archetype — for side-view games the FLOOR/hero at the
// bottom is what matters, so pin to the bottom and let the HUD/sky at the top go.
const CROP: Record<ArchetypeId, string> = {
  platformer: '50% 100%',
  fighter: '50% 100%',
  shooter: '50% 88%', // player sits low; keep a little sky for incoming enemies
  hshooter: '50% 55%',
  adventure: '50% 50%', // top-down: hero roams, no privileged edge
};

export function LibraryDemo(props: {
  gameId: string;
  ready: boolean;
  archetype: ArchetypeId;
  fallback: ComponentChildren;
}): ComponentChildren {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    setLive(false);
    if (!props.ready) return undefined;
    let host: GameHost | null = null;
    let disposed = false;

    const dwell = setTimeout(() => {
      void (async () => {
        try {
          const detail = await api.getGame(props.gameId);
          const spec = detail.spec;
          if (disposed || !spec || detail.item.status !== 'ready' || !canvasRef.current) return;
          // Load the baked likeness so the demo hero wears the SAME face as the
          // real game (photo games composite it onto the hero head — without it
          // the demo would show a different, faceless sprite).
          const likeness = await loadLikenessAssets(props.gameId, detail.assets);
          if (disposed || !canvasRef.current) return;
          host = new GameHost({
            canvas: canvasRef.current,
            spec,
            archetype: archetypes[spec.archetype],
            input: new PilotBroker(spec.archetype),
            likeness,
            volumes: DEMO_VOLUMES,
            attract: true,
            callbacks: {
              onQuit: () => {},
              onVolumesChanged: () => {},
              initialScores: [],
              submitScore: async () => [],
            },
          });
          host.start();
          if (!disposed) setLive(true);
        } catch {
          /* demo is optional — leave the static cover in place */
        }
      })();
    }, DWELL_MS);

    return () => {
      disposed = true;
      clearTimeout(dwell);
      host?.dispose();
    };
  }, [props.gameId, props.ready]);

  return (
    <div class="lib-demo">
      <canvas
        ref={canvasRef}
        class={`lib-demo-canvas ${live ? 'on' : ''}`}
        style={`object-position:${CROP[props.archetype] ?? '50% 88%'}`}
      />
      {!live && <div class="lib-demo-fallback">{props.fallback}</div>}
    </div>
  );
}
