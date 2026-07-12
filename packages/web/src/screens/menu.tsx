// Main menu: Play, New Game, Settings — plus the active-generation card and
// WiFi/disk chips.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { GameListItem, SystemInfo } from '@sparkade/shared';
import { api } from '../api';
import { FooterLegend, fmtElapsed, useNow } from '../components';
import { shellInput } from '../shell-input';
import { Icon, type IconName } from '../icons';
import type { Screen } from '../app';

const ITEMS: { icon: IconName; label: string; hint: string }[] = [
  { icon: 'play', label: 'Play', hint: 'Browse the library' },
  { icon: 'sparkle', label: 'New Game', hint: 'Dream one up' },
  { icon: 'gear', label: 'Settings', hint: 'System Configuration' },
];

export function MainMenuScreen(props: { go: (s: Screen) => void }): ComponentChildren {
  const [cursor, setCursor] = useState(0);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [activeGen, setActiveGen] = useState<GameListItem | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    const load = () => {
      void api.systemInfo().then(setInfo).catch(() => {});
      void api
        .listGames()
        .then((games) => {
          setActiveGen(games.find((g) => g.status === 'generating' || g.status === 'queued') ?? null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        if (btn === 'UP') {
          setCursor((c) => (c + ITEMS.length - 1) % ITEMS.length);
          shellInput.blip('move');
        } else if (btn === 'DOWN') {
          setCursor((c) => (c + 1) % ITEMS.length);
          shellInput.blip('move');
        } else if (btn === 'A' || btn === 'START') {
          shellInput.blip('select');
          setCursor((c) => {
            if (c === 0) props.go({ name: 'library' });
            else if (c === 1) props.go({ name: 'wizard' });
            else props.go({ name: 'settings' });
            return c;
          });
        } else if (btn === 'B') {
          shellInput.blip('back');
          props.go({ name: 'attract' });
        }
      }),
    [props.go],
  );

  const diskFreeGb = info ? (info.diskFreeBytes / 1e9).toFixed(1) : '…';

  return (
    <div class="screen">
      <div class="screen-title">
        <h1 class="pixel">
          SPARK<span style="color:var(--spark)">ADE</span>
        </h1>
        <span class="status-chips">
          {info?.isPi && (
            <span class="chip">
              <span class={`dot ${info ? '' : 'off'}`} /> WiFi
            </span>
          )}
          <span class="chip"><Icon name="disk" /> {diskFreeGb} GB free</span>
        </span>
      </div>
      <div class="screen-body" style="display:flex;flex-direction:column;justify-content:center;gap:22px">
        {activeGen && (
          <div class="focusable gen-card" style="max-width:560px;margin:0 auto;width:100%">
            <span class="spin" style="color:var(--cyan);font-size:24px">
              <Icon name="sparkle" />
            </span>
            <div>
              <div style="font-size:20px">
                Generating <b>{activeGen.title}</b>
              </div>
              <div class="stage">
                {activeGen.status === 'queued' ? 'Queued' : 'In progress'} ·{' '}
                {fmtElapsed(now - Date.parse(activeGen.createdAt))}
              </div>
            </div>
          </div>
        )}
        <div class="menu-list">
          {ITEMS.map((item, i) => (
            <div key={item.label} class={`focusable menu-item ${i === cursor ? 'focused' : ''}`}>
              <span class="icon"><Icon name={item.icon} /></span>
              {item.label}
              <span class="hint">{item.hint}</span>
            </div>
          ))}
        </div>
      </div>
      <FooterLegend
        items={[
          ['A', 'Select'],
          ['B', 'Back'],
        ]}
      />
    </div>
  );
}
