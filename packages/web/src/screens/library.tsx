// Library: paginated grid of game cards (4 per row, 2 rows per page).
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { GameListItem } from '@sparkade/shared';
import { api } from '../api';
import { FooterLegend, GameCover, usd } from '../components';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

const COLS = 4;
const ROWS = 2;
const PAGE = COLS * ROWS;

export function LibraryScreen(props: { go: (s: Screen) => void }): ComponentChildren {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const load = () => void api.listGames().then(setGames).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        const count = games.length;
        if (count === 0) {
          if (btn === 'B') {
            shellInput.blip('back');
            props.go({ name: 'menu' });
          }
          if (btn === 'A') {
            shellInput.blip('select');
            props.go({ name: 'wizard' });
          }
          return;
        }
        const move = (delta: number) => {
          setCursor((c) => {
            const next = c + delta;
            if (next < 0 || next >= count) return c;
            shellInput.blip('move');
            return next;
          });
        };
        if (btn === 'LEFT') move(-1);
        else if (btn === 'RIGHT') move(1);
        else if (btn === 'UP') move(-COLS);
        else if (btn === 'DOWN') move(COLS);
        else if (btn === 'L') move(-PAGE);
        else if (btn === 'R') move(PAGE);
        else if (btn === 'A') {
          shellInput.blip('select');
          setCursor((c) => {
            const g = games[c];
            if (g) props.go({ name: 'detail', id: g.id });
            return c;
          });
        } else if (btn === 'B') {
          shellInput.blip('back');
          props.go({ name: 'menu' });
        }
      }),
    [games, props.go],
  );

  const page = Math.floor(cursor / PAGE);
  const pages = Math.max(1, Math.ceil(games.length / PAGE));
  const view = games.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">LIBRARY</h2>
        <span class="status-chips">
          {pages > 1 && (
            <span class="chip">
              Page {page + 1}/{pages}
            </span>
          )}
          <span class="chip">{games.length} games</span>
        </span>
      </div>
      <div class="screen-body">
        {games.length === 0 ? (
          <div class="center-col">
            <div style="font-size:24px">No games yet</div>
            <div style="color:var(--text-dim)">Press A to dream one up</div>
          </div>
        ) : (
          <div class="card-grid">
            {view.map((g, i) => {
              const ix = page * PAGE + i;
              return (
                <div key={g.id} class={`focusable game-card ${ix === cursor ? 'focused' : ''}`}>
                  <GameCover
                    cover={g.cover}
                    gameId={g.id}
                    seedText={g.title}
                    pending={g.status === 'queued' || g.status === 'generating'}
                  />
                  <div class="title">{g.title}</div>
                  <div class="sub">
                    <span class={`badge ${g.golden ? 'golden' : g.status}`}>
                      {g.golden ? 'Built-in' : statusLabel(g.status)}
                    </span>
                    <span>
                      {g.topScore
                        ? `${g.topScore.initials} ${g.topScore.score}`
                        : g.golden
                          ? ''
                          : usd(g.costUsd)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <FooterLegend
        items={[
          ['A', 'Open'],
          ['B', 'Back'],
          ...(pages > 1 ? ([['L·R', 'Page']] as [string, string][]) : []),
        ]}
      />
    </div>
  );
}

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
      return 'Needs migration';
  }
}
