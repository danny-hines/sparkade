// Home: the combined launcher. Left panel is one navigable list — New Game, the
// game library, then Settings; the right panel shows a live detail of the
// selected item. Selecting a game moves focus into the detail panel, where
// up/down scroll the full preview/details and left/right pick the available actions in a docked
// footer. Replaces the old menu + library + detail screens.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  DELETE_HOLD_MS,
  type ArchetypeId,
  type GameListItem,
  type ScoreRow,
  type SystemInfo,
} from '@sparkade/shared';
import { api, type GameDetail } from '../api';
import { FooterLegend, GameCover, HoldRing, Modal, usd } from '../components';
import { shellInput } from '../shell-input';
import { Icon, Btn, type IconName } from '../icons';
import { LibraryDemo } from './library-demo';
import type { Screen } from '../app';

type Action = { key: string; label: ComponentChildren; danger?: boolean };

const GAME_TYPE_LABELS: Record<ArchetypeId, string> = {
  platformer: 'Platformer',
  shooter: 'V-Shooter',
  adventure: 'Adventure',
  hshooter: 'H-Shooter',
  fighter: 'Fighter',
};

function statusLabel(s: GameListItem['status']): string {
  switch (s) {
    case 'ready':
      return 'Ready';
    case 'queued':
      return 'Queued';
    case 'generating':
      return 'Generating';
    case 'failed':
      return 'Failed';
    case 'needs-migration':
      return 'Migrate';
  }
}

export function actionsFor(game: GameListItem | null): Action[] {
  if (!game) return [];
  const a: Action[] = [];
  if (game.status === 'ready') a.push({ key: 'play', label: <><Icon name="play" /> Play</> });
  if (game.status === 'generating' || game.status === 'queued')
    a.push({ key: 'progress', label: <><Icon name="sparkle" /> Progress</> });
  if (game.status === 'failed') a.push({ key: 'retry', label: <><Icon name="refresh" /> Retry</> });
  if (!game.golden)
    a.push({ key: 'delete', label: <><Icon name="close" /> Delete</>, danger: true });
  return a;
}

export function HomeScreen(props: { go: (s: Screen) => void; initialId?: string }): ComponentChildren {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [sel, setSel] = useState(0);
  const [zone, setZone] = useState<'list' | 'detail'>('list');
  const [actionCursor, setActionCursor] = useState(0);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const didInit = useRef(false);

  // Combined list: 0 = New Game, 1..N = games, N+1 = Settings.
  const SETTINGS = games.length + 1;
  const total = games.length + 2;
  const selectedGame = sel >= 1 && sel <= games.length ? games[sel - 1]! : null;
  const actions = actionsFor(selectedGame);

  useEffect(() => {
    const load = () => {
      void api
        .listGames()
        .then((g) => {
          setGames(g);
          if (!didInit.current && props.initialId) {
            const ix = g.findIndex((x) => x.id === props.initialId);
            if (ix >= 0) setSel(ix + 1);
          }
          didInit.current = true;
        })
        .catch(() => {});
      void api.systemInfo().then(setInfo).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [props.initialId]);

  useEffect(() => {
    if (sel >= total) setSel(total - 1);
  }, [total, sel]);

  // Load detail + scores whenever the selected game changes.
  useEffect(() => {
    setActionCursor(0);
    scrollRef.current?.scrollTo({ top: 0 });
    if (!selectedGame) {
      setDetail(null);
      setScores([]);
      return;
    }
    let live = true;
    setDetail(null);
    void api.getGame(selectedGame.id).then((d) => live && setDetail(d)).catch(() => {});
    void api.getScores(selectedGame.id).then((s) => live && setScores(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [selectedGame?.id, selectedGame?.status]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const stateRef = useRef({ sel, zone, actionCursor, total, selectedGame, actions, confirmDelete });
  stateRef.current = { sel, zone, actionCursor, total, selectedGame, actions, confirmDelete };

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        const s = stateRef.current;
        if (s.confirmDelete) return; // delete modal owns input
        if (s.zone === 'list') {
          if (btn === 'UP') {
            setSel((c) => (c + s.total - 1) % s.total);
            shellInput.blip('move');
          } else if (btn === 'DOWN') {
            setSel((c) => (c + 1) % s.total);
            shellInput.blip('move');
          } else if (btn === 'A') {
            shellInput.blip('select');
            if (s.sel === 0) props.go({ name: 'wizard' });
            else if (s.selectedGame) {
              setZone('detail');
              setActionCursor(0);
            } else props.go({ name: 'settings' });
          } else if (btn === 'B') {
            shellInput.blip('back');
            props.go({ name: 'attract' });
          }
          return;
        }
        // zone === 'detail'
        if (btn === 'UP') scrollRef.current?.scrollBy({ top: -44 });
        else if (btn === 'DOWN') scrollRef.current?.scrollBy({ top: 44 });
        else if (btn === 'LEFT') {
          setActionCursor((c) => Math.max(0, c - 1));
          shellInput.blip('move');
        } else if (btn === 'RIGHT') {
          setActionCursor((c) => Math.min(s.actions.length - 1, c + 1));
          shellInput.blip('move');
        } else if (btn === 'A') {
          const g = s.selectedGame;
          const key = s.actions[s.actionCursor]?.key;
          if (!g) return;
          shellInput.blip('select');
          if (key === 'play') props.go({ name: 'play', id: g.id });
          else if (key === 'retry')
            void api
              .retryGame(g.id)
              .then((r) => props.go({ name: 'generation', jobId: r.jobId, gameId: g.id }))
              .catch(() => shellInput.blip('error'));
          else if (key === 'progress' && detail?.job)
            props.go({ name: 'generation', jobId: detail.job.id, gameId: g.id });
          else if (key === 'delete') setConfirmDelete(true);
        } else if (btn === 'B') {
          shellInput.blip('back');
          setZone('list');
        }
      }),
    [props.go, detail],
  );

  const footer: [string, string][] =
    zone === 'detail'
      ? [
          ['A', 'Go'],
          ['B', 'Back'],
        ]
      : [
          ['A', 'Open'],
          ['B', 'Exit'],
        ];

  const diskFreeGb = info ? (info.diskFreeBytes / 1e9).toFixed(0) : '…';

  return (
    <div class="screen home">
      <div class="screen-title">
        <h1 class="pixel">
          SPARK<span style="color:var(--spark)">ADE</span>
        </h1>
        <span class="status-chips">
          {info?.isPi && (
            <span class="chip">
              <span class="dot" /> WiFi
            </span>
          )}
          <span class="chip">
            <Icon name="disk" /> {diskFreeGb} GB
          </span>
        </span>
      </div>

      <div class="home-body">
        <div class="home-list">
          <div
            ref={sel === 0 ? focusRef : undefined}
            class={`home-item new ${zone === 'list' && sel === 0 ? 'focused' : ''}`}
          >
            <span class="home-ic">
              <Icon name="sparkle" />
            </span>
            New Game
          </div>

          {games.map((g, i) => (
            <div
              key={g.id}
              ref={sel === i + 1 ? focusRef : undefined}
              class={`home-item game ${zone === 'list' && sel === i + 1 ? 'focused' : ''} ${
                sel === i + 1 ? 'sel' : ''
              }`}
            >
              <GameCover
                cover={g.cover}
                gameId={g.id}
                assetVersion={g.jobId ?? g.createdAt}
                class="home-thumb"
              />
              <div class="home-item-text">
                <div class="home-item-title">{g.title}</div>
                <div class="home-item-sub">
                  <span class="badge type">{GAME_TYPE_LABELS[g.archetype]}</span>
                  <span class={`badge ${g.golden ? 'golden' : g.status}`}>
                    {g.golden ? 'Built-in' : statusLabel(g.status)}
                  </span>
                  {!g.golden && g.status !== 'queued' && g.status !== 'generating' && (
                    <span class="home-item-cost">{usd(g.costUsd)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          <div
            ref={sel === SETTINGS ? focusRef : undefined}
            class={`home-item settings ${zone === 'list' && sel === SETTINGS ? 'focused' : ''}`}
          >
            <span class="home-ic">
              <Icon name="gear" />
            </span>
            Settings
          </div>
        </div>

        <div class={`home-detail ${zone === 'detail' ? 'active' : ''}`}>
          {sel === 0 ? (
            <Cta
              icon="sparkle"
              title="Dream up a new game"
              sub="Take a photo or skip it, then choose the details you care about. Leave anything blank and Spark will decide."
              hint="Start"
            />
          ) : selectedGame ? (
            <DetailPanel
              game={selectedGame}
              detail={detail}
              scores={scores}
              actions={actions}
              actionCursor={actionCursor}
              zone={zone}
              scrollRef={scrollRef}
            />
          ) : (
            <Cta
              icon="gear"
              title="Settings"
              sub="Controls & remap, audio levels, camera & mic, WiFi, and system info."
              hint="Open"
            />
          )}
        </div>
      </div>

      <FooterLegend items={footer} />

      {confirmDelete && selectedGame && !selectedGame.golden && (
        <DeleteModal
          title={selectedGame.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirmed={() =>
            void api.deleteGame(selectedGame.id).then(() => {
              shellInput.blip('success');
              setConfirmDelete(false);
              setZone('list');
            })
          }
        />
      )}
    </div>
  );
}

function Cta(props: { icon: IconName; title: string; sub: string; hint: string }): ComponentChildren {
  return (
    <div class="home-cta">
      <span class="home-cta-ic">
        <Icon name={props.icon} />
      </span>
      <div class="home-cta-title">{props.title}</div>
      <div class="home-cta-sub">{props.sub}</div>
      <div class="home-cta-hint">
        <Btn>A</Btn> {props.hint}
      </div>
    </div>
  );
}

function DetailPanel(props: {
  game: GameListItem;
  detail: GameDetail | null;
  scores: ScoreRow[];
  actions: Action[];
  actionCursor: number;
  zone: 'list' | 'detail';
  scrollRef: { current: HTMLDivElement | null };
}): ComponentChildren {
  // The four-second list poll is the freshest source of status + cover data.
  // Keeping it authoritative lets a selected generating game turn ready in
  // place, even before the detail request refresh finishes.
  const item = props.game;
  const spec = props.detail?.spec;
  const pending = item.status === 'queued' || item.status === 'generating';
  const [scroll, setScroll] = useState({ atTop: true, atBottom: true });
  const recompute = (): void => {
    const el = props.scrollRef.current;
    if (!el) return;
    setScroll({
      atTop: el.scrollTop <= 1,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    });
  };
  useEffect(() => recompute(), [props.game.id, props.detail, props.scores]);
  const scrollable = !(scroll.atTop && scroll.atBottom);
  return (
    <div class="home-detail-inner">
      <div class="home-detail-scroll" ref={props.scrollRef} onScroll={recompute}>
        <div class="home-detail-stage">
          <LibraryDemo
            key={item.id}
            gameId={item.id}
            ready={item.status === 'ready'}
            archetype={item.archetype}
            fallback={
              pending ? (
                <GenerationCover
                  title={item.title}
                  status={item.status === 'queued' ? 'queued' : 'generating'}
                />
              ) : (
                <GameCover
                  cover={item.cover}
                  gameId={item.id}
                  assetVersion={item.jobId ?? item.createdAt}
                  class="home-detail-cover-full"
                  presentation="matted"
                />
              )
            }
          />
        </div>
        <div class="home-detail-meta">
          <div class="home-detail-title">{item.title}</div>
          {item.tagline && <div class="home-detail-tag">{item.tagline}</div>}
          <div class="home-detail-badges">
            <span class="badge type">{GAME_TYPE_LABELS[item.archetype]}</span>
            <span class={`badge ${item.golden ? 'golden' : item.status}`}>
              {item.golden ? 'Built-in' : statusLabel(item.status)}
            </span>
          </div>
        </div>

        <div class="home-synopsis">
          {spec ? (
            <p>{spec.story.intro.join(' ')}</p>
          ) : (
            <p style="color:var(--text-dim)">
              <Icon name="sparkle" class={pending ? 'spin' : ''} />{' '}
              {pending ? 'Story and details are still taking shape…' : 'Loading…'}
            </p>
          )}
          {item.status === 'failed' && item.failure && (
            <p style="color:var(--danger)">{item.failure.message}</p>
          )}
          {!item.golden && props.detail && (
            <p style="color:var(--text-dim);font-size:13px">
              Cost <b style="color:var(--gold)">{usd(item.costUsd)}</b>
              {(props.detail.job?.attempt ?? 1) > 1
                ? ` · ${props.detail.job!.attempt} attempts`
                : ''}
            </p>
          )}
          <div class="home-board-title">LEADERBOARD</div>
          <table class="score-table">
            <tbody>
              {props.scores.length === 0 ? (
                <tr>
                  <td style="color:var(--text-dim)">No scores yet — be the first!</td>
                </tr>
              ) : (
                props.scores.slice(0, 5).map((s, i) => (
                  <tr key={i}>
                    <td style="width:30px;color:var(--text-dim)">{i + 1}.</td>
                    <td class="initials">{s.initials}</td>
                    <td style="text-align:right">{s.score}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div class="home-actions">
        {props.actions.map((a, i) => (
          <div
            key={a.key}
            class={`home-action ${a.danger ? 'danger' : ''} ${
              props.zone === 'detail' && props.actionCursor === i ? 'focused' : ''
            }`}
          >
            {a.label}
          </div>
        ))}
        {scrollable && (
          <div class="home-scroll-hint" title="scroll">
            <span class={scroll.atTop ? 'off' : ''}>
              <Icon name="pixUp" />
            </span>
            <span class={scroll.atBottom ? 'off' : ''}>
              <Icon name="pixDown" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerationCover(props: {
  title: string;
  status: 'queued' | 'generating';
}): ComponentChildren {
  return (
    <div class="home-generation-cover" aria-label={`${props.title} is being generated`}>
      <img class="home-generation-backdrop" src="/generation-placeholder.png" alt="" />
      <img
        class="home-generation-art"
        src="/generation-placeholder.png"
        alt="Hero and boss silhouettes in a game world being assembled"
      />
      <div class="home-generation-scan" />
      <div class="home-generation-status pixel">
        <Icon name="sparkle" />{' '}
        {props.status === 'queued' ? 'WAITING TO BUILD' : 'SPARK IS BUILDING'}
      </div>
    </div>
  );
}

/** Cancel focused by default; deleting = focus Delete then HOLD A for 3s. */
function DeleteModal(props: {
  title: string;
  onCancel: () => void;
  onConfirmed: () => void;
}): ComponentChildren {
  const [cursor, setCursor] = useState(0);
  const [holdT, setHoldT] = useState(0);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const fired = useRef(false);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  useEffect(
    () =>
      shellInput.pushHandler(
        (btn) => {
          if (btn === 'LEFT' || btn === 'RIGHT') {
            setCursor((c) => 1 - c);
            shellInput.blip('move');
          } else if (btn === 'B') {
            shellInput.blip('back');
            callbacksRef.current.onCancel();
          } else if (btn === 'A' && cursorRef.current === 0) {
            shellInput.blip('back');
            callbacksRef.current.onCancel();
          }
        },
        { modal: true },
      ),
    [],
  );

  useEffect(() => {
    const t = setInterval(() => {
      const held = shellInput.broker.state().A.held;
      if (cursorRef.current === 1 && held) {
        setHoldT((v) => {
          const next = v + 50;
          if (next >= DELETE_HOLD_MS && !fired.current) {
            fired.current = true;
            // A is still physically held as the modal closes — swallow it so the
            // continuing hold can't seed the 5s remap trigger once this modal's
            // input suppression lifts (release + re-press starts a fresh hold).
            shellInput.swallow();
            callbacksRef.current.onConfirmed();
          }
          return next;
        });
      } else {
        setHoldT(0);
      }
    }, 50);
    return () => clearInterval(t);
  }, []);

  return (
    <Modal>
      <h3>Delete “{props.title}”?</h3>
      <p>This removes the game, its artwork, its likeness sprites and its entire leaderboard.</p>
      <p style="font-size:17px">This cannot be undone.</p>
      <div class="choices">
        <div class={`focusable ${cursor === 0 ? 'focused' : ''}`}>Cancel</div>
        <div class={`focusable danger ${cursor === 1 ? 'focused' : ''}`}>Delete</div>
      </div>
      {cursor === 1 ? (
        <>
          <HoldRing t={holdT / DELETE_HOLD_MS} />
          <p style="font-size:16px;margin-top:8px">
            Hold <Btn>A</Btn> to delete · release to cancel
          </p>
        </>
      ) : (
        <p style="font-size:16px;margin-top:16px;color:var(--text-dim)">
          <Btn>B</Btn> Cancel
        </p>
      )}
    </Modal>
  );
}
