// Development-only comparison. Saved specs and scores are never written here.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { archetypes } from '@sparkade/archetypes';
import {
  GameHost,
  InputBroker,
  ScoreTally,
  InitialsEntry,
  LeaderboardView,
  type EngineContext,
  type GameInstance,
  type InputSnapshot,
  type PauseOverlay,
} from '@sparkade/engine';
import {
  PRESENTATION_FAMILIES,
  PRESENTATION_CATALOG,
  type PresentationFamily,
  type GameListItem,
} from '@sparkade/shared';
import { api } from '../api';
import { loadLikenessAssets } from '../likeness-assets';
import './presentation-lab.css';

const SCENES = [
  'play',
  'hud',
  'controls',
  'opening',
  'chapter',
  'boss-card',
  'boss-hud',
  'pause',
  'audio',
  'victory',
  'defeat',
  'initials',
  'records',
] as const;
type Scene = (typeof SCENES)[number];
type PreviewHost = {
  state: string;
  playT: number;
  loop: { stop(): void };
  render(): void;
  engineCtx: EngineContext;
  instance: GameInstance & { enterBoss(withCard: boolean): void };
  pause: PauseOverlay;
  tally: ScoreTally;
  initials: InitialsEntry;
  board: LeaderboardView;
};
const idle = Object.fromEntries(
  ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'START', 'SELECT', 'L', 'R'].map((k) => [
    k,
    { held: false, pressed: false, released: false },
  ]),
) as InputSnapshot;

export function PresentationLabScreen(): ComponentChildren {
  const params = new URLSearchParams(location.search);
  const clean = params.get('clean') === '1';
  const [family, setFamily] = useState<PresentationFamily>(
    PRESENTATION_FAMILIES.find((f) => f === params.get('family')) ?? 'storybook',
  );
  const [scene, setScene] = useState<Scene>(SCENES.find((s) => s === params.get('scene')) ?? 'hud');
  const [gameId, setGameId] = useState(params.get('game') ?? '');
  const [games, setGames] = useState<GameListItem[]>([]);
  const [sound, setSound] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    void api
      .listGames()
      .then((items) => {
        if (disposed) return;
        const available = items.filter((g) => g.archetype === 'platformer' && g.status === 'ready');
        setGames(available);
        setGameId((id) => id || available[0]?.id || 'golden-platformer');
      })
      .catch(() => {
        if (!disposed) setGameId((id) => id || 'golden-platformer');
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!canvas.current || !gameId) return;
    let disposed = false;
    let host: GameHost | null = null;
    const input = new InputBroker();
    input.attach(window);
    setReady(false);
    setError('');
    const query = new URLSearchParams({
      dev: 'presentation',
      game: gameId,
      family,
      scene,
      ...(clean ? { clean: '1' } : {}),
    });
    history.replaceState(null, '', `/?${query}`);
    void (async () => {
      try {
        const detail = await api.getGame(gameId);
        if (detail.spec?.archetype !== 'platformer') throw new Error('Choose a ready platformer.');
        const spec = { ...structuredClone(detail.spec), presentationFamily: family };
        const likeness = await loadLikenessAssets(gameId, detail.assets);
        if (disposed) return;
        host = new GameHost({
          canvas: canvas.current!,
          spec,
          archetype: archetypes.platformer,
          likeness,
          input,
          volumes: { musicVol: sound ? 0.3 : 0, sfxVol: sound ? 0.3 : 0, uiVol: sound ? 0.4 : 0 },
          callbacks: {
            onQuit: () => {
              setScene('controls');
              setRevision((value) => value + 1);
            },
            onVolumesChanged: () => {},
            initialScores: [],
            submitScore: async () => [],
          },
        });
        const h = host as unknown as PreviewHost;
        host.start();
        if (scene !== 'controls') {
          h.instance.start();
          h.engineCtx.cards.skip();
          h.engineCtx.cards.skip();
          for (let i = 0; i < 30; i++) h.instance.update(1 / 60, idle);
          h.state = 'game';
        }
        if (scene === 'opening' || scene === 'chapter' || scene === 'boss-card') {
          h.engineCtx.cards.show([
            scene === 'opening'
              ? {
                  title: spec.meta.title,
                  lines: spec.story.intro,
                  artRole: 'intro',
                  portrait: h.engineCtx.portrait,
                }
              : scene === 'chapter'
                ? {
                    title: spec.levels[0]!.name,
                    lines: [spec.story.levelIntros[0]!],
                    stage: { index: 1, total: spec.levels.length },
                    illustration: h.engineCtx.platformerBackdrops?.level1,
                  }
                : {
                    title: spec.boss.name,
                    lines: [spec.story.bossIntro],
                    artRole: 'boss',
                    portrait: h.engineCtx.portrait,
                  },
          ]);
          h.engineCtx.cards.update(30, idle);
        }
        if (scene === 'boss-hud') {
          h.instance.enterBoss(false);
          h.instance.update(1 / 60, idle);
        }
        if (scene === 'pause' || scene === 'audio') {
          h.state = 'paused';
          // This inspection bridge exists only in the DEV-gated comparison module.
          (h.pause as unknown as { screen: string }).screen = scene === 'audio' ? 'audio' : 'menu';
        }
        if (scene === 'victory' || scene === 'defeat') {
          h.state = 'tally';
          h.tally = new ScoreTally(
            123450,
            scene === 'victory' ? 85 : 0,
            spec.scoring.timeBonusPerSecond,
            scene === 'victory',
            312,
          );
          h.tally.update(3, idle);
          // Hold the sample totals for inspection; A still takes the real result path.
          const updateTally = h.tally.update.bind(h.tally);
          h.tally.update = (_dt, input) => updateTally(0, input);
        }
        if (scene === 'initials') {
          h.state = 'initials';
          h.tally = new ScoreTally(123450, 0, 0, true, 312);
          h.initials = new InitialsEntry((k) =>
            h.engineCtx.sfx.play(k === 'move' ? 'uiMove' : k === 'back' ? 'uiBack' : 'uiSelect'),
          );
        }
        if (scene === 'records') {
          h.state = 'board';
          h.board = new LeaderboardView(
            [
              { initials: 'ACE', score: 123450 },
              { initials: 'YOU', score: 98000 },
            ],
            1,
            (k) =>
              h.engineCtx.sfx.play(k === 'move' ? 'uiMove' : k === 'back' ? 'uiBack' : 'uiSelect'),
          );
        }
        // Static comparisons share the exact initial game state; interactive
        // play/menus use the real host input path and never save sample scores.
        if (scene === 'hud' || scene === 'boss-hud') h.loop.stop();
        h.render();
        (window as unknown as { sparkadePresentation: unknown }).sparkadePresentation = {
          host,
          gameId,
          family,
          scene,
        };
        setReady(true);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Preview failed.');
      }
    })();
    return () => {
      disposed = true;
      host?.dispose();
      input.detach(window);
      delete (window as unknown as { sparkadePresentation?: unknown }).sparkadePresentation;
    };
  }, [family, scene, gameId, sound, clean, revision]);
  return (
    <main
      class={`presentation-lab${clean ? ' clean' : ''}`}
      data-ready={ready}
      data-family={family}
      data-scene={scene}
    >
      {!clean && (
        <header onKeyDown={(event) => event.stopPropagation()}>
          <div class="presentation-families" aria-label="Presentation family">
            {PRESENTATION_FAMILIES.map((f) => (
              <button
                type="button"
                key={f}
                aria-pressed={f === family}
                onClick={() => setFamily(f)}
              >
                {PRESENTATION_CATALOG[f].name}
              </button>
            ))}
          </div>
          <div class="presentation-options">
            <label>
              Game{' '}
              <select value={gameId} onChange={(e) => setGameId(e.currentTarget.value)}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Screen{' '}
              <select value={scene} onChange={(e) => setScene(e.currentTarget.value as Scene)}>
                {SCENES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('-', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setSound((v) => !v)}>
              {sound ? 'Mute' : 'Enable sound'}
            </button>
          </div>
          <p>
            Same game and artwork. Choose play for live gameplay. Results use sample numbers. Arrows
            navigate; X confirms, Z backs, Enter pauses. See Controls for gameplay bindings.
          </p>
        </header>
      )}
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        style={error ? { display: 'none' } : undefined}
        tabIndex={0}
        aria-label={`${PRESENTATION_CATALOG[family].name} ${scene} preview`}
      />
    </main>
  );
}
