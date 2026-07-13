// Dev-only playtest harness (http://localhost:5173/?dev=playtest&arch=hshooter):
// boots a golden game straight into the real GameHost with a keyboard
// InputBroker — no pipeline, no menu. Lets you exercise/screenshot an
// archetype's gameplay in isolation. DEV-gated in app.tsx (stripped from prod).
import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost, InputBroker } from '@sparkade/engine';
import { archetypes } from '@sparkade/archetypes';
import type { GameSpec } from '@sparkade/shared';
import goldenHshooter from '../../../generation/golden/golden-hshooter.json';
import goldenFighter from '../../../generation/golden/golden-fighter.json';

const GOLDENS: Record<string, unknown> = { hshooter: goldenHshooter, fighter: goldenFighter };

export function PlaytestScreen(): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const arch = new URLSearchParams(location.search).get('arch') ?? 'hshooter';
    const spec = GOLDENS[arch] as GameSpec | undefined;
    if (!spec) return;
    const input = new InputBroker();
    input.attach(window);
    const host = new GameHost({
      canvas,
      spec,
      archetype: archetypes[spec.archetype],
      input,
      likeness: null,
      volumes: { musicVol: 0, sfxVol: 0, uiVol: 0 },
      callbacks: {
        onQuit: () => {},
        onVolumesChanged: () => {},
        initialScores: [],
        submitScore: async () => [],
      },
    });
    host.start();
    return () => {
      host.dispose();
      input.detach(window);
    };
  }, []);
  return (
    <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#000">
      <canvas ref={ref} style="image-rendering:pixelated;width:1024px;height:600px" tabIndex={0} />
    </div>
  );
}
