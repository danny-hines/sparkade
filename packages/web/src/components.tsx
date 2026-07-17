// Shared shell components: footer legend, game cover canvas, hold-to-confirm
// ring, modal frame, on-screen keyboard.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { decodeSprite, LIBRARY, makeTallHumanoidEntry } from '@sparkade/engine';
import { LIB_HEROES_PLATFORMER, type GameListItem, type LogicalButton } from '@sparkade/shared';
import { shellInput } from './shell-input';
import { Icon } from './icons';

const TALL_COVER_HERO_IDS = new Set<string>(LIB_HEROES_PLATFORMER);

export function FooterLegend(props: {
  items: [string, string][];
  chips?: ComponentChildren;
}): ComponentChildren {
  return (
    <div class="footer-legend">
      {props.items.map(([btn, label]) => (
        <span key={btn + label}>
          <b>{btn}</b>
          {label}
        </span>
      ))}
      {props.chips ? <span class="status-chips">{props.chips}</span> : null}
    </div>
  );
}

/**
 * Live cover render — a mini-scene of the game's actual art: hero (wearing the
 * player's likeness head when the game has one), its most distinctive enemy,
 * and the boss looming dim behind. No stored images; everything is decoded
 * from the spec's pixel data against the game's own palette.
 */
export function GameCover(props: {
  cover: GameListItem['cover'];
  archetype: GameListItem['archetype'];
  gameId?: string;
  seedText: string;
  class?: string;
  pending?: boolean;
}): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;

    // Where the baked likeness head lands on the hero: hand-authored for a
    // library hero, or the custom hero's own headSlot. Recent games use custom
    // heroes (signature-sprite prompt), which the cover previously ignored —
    // dropping their head — so fall back to the custom sprite's slot.
    const cov = props.cover;
    const heroLibId = cov?.heroRef?.startsWith('lib:') ? cov.heroRef.slice(4) : null;
    const nativeHeadSlot = heroLibId ? LIBRARY[heroLibId]?.headSlots?.[0] : cov?.hero?.headSlot;
    const sourceHeroEntry = heroLibId ? LIBRARY[heroLibId] : undefined;
    const canUseTallHero =
      props.archetype === 'platformer' &&
      cov?.hasLikeness &&
      heroLibId !== null &&
      TALL_COVER_HERO_IDS.has(heroLibId) &&
      sourceHeroEntry;
    const candidateTallEntry = canUseTallHero ? makeTallHumanoidEntry(sourceHeroEntry) : undefined;
    const tallHeroEntry =
      candidateTallEntry && candidateTallEntry !== sourceHeroEntry ? candidateTallEntry : undefined;
    const likenessHeadSlot = tallHeroEntry?.headSlots?.[0] ?? nativeHeadSlot;

    const draw = (head: HTMLImageElement | null) => {
      if (disposed) return;
      canvas.width = 128;
      canvas.height = 76;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const cover = props.cover;
      const pal = cover?.palette ?? ['#000', '#111', '#1c2242', '#2a3060', '#3b4a8c'];
      ctx.fillStyle = pal[2] ?? '#1c2242';
      ctx.fillRect(0, 0, 128, 76);
      ctx.fillStyle = pal[3] ?? '#2a3060';
      ctx.fillRect(0, 26, 128, 50);
      ctx.fillStyle = pal[4] ?? '#3b4a8c';
      ctx.fillRect(0, 52, 128, 24);
      // deterministic sparkles from the title
      let h = 0;
      for (const c of props.seedText) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      for (let i = 0; i < 14; i++) {
        h = (h * 1103515245 + 12345) >>> 0;
        const x = h % 128;
        const y = (h >> 8) % 60;
        ctx.fillStyle = i % 3 === 0 ? (pal[13] ?? '#ffd75e') : (pal[15] ?? '#fff');
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
      if (!cover) {
        if (props.pending) {
          // Queued/generating games have no cover art yet — a centered gem
          // outline reads as "cover incoming" rather than a broken empty box.
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = pal[13] ?? '#ffd75e';
          ctx.lineWidth = 1;
          const cx = 64;
          const cy = 36;
          const r = 8;
          ctx.beginPath();
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r);
          ctx.lineTo(cx - r, cy);
          ctx.closePath();
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        return;
      }
      const baseline = 68;

      // Boss: large, dim, stage-right — every game's boss differs.
      if (cover.boss) {
        try {
          const boss = decodeSprite(cover.boss, cover.palette);
          const scale = boss.width > 32 ? 1.4 : 1.8;
          ctx.globalAlpha = 0.32;
          ctx.drawImage(
            boss,
            Math.round(122 - boss.width * scale),
            Math.round(baseline + 4 - boss.height * scale),
            Math.round(boss.width * scale),
            Math.round(boss.height * scale),
          );
          ctx.globalAlpha = 1;
        } catch {
          /* bad sprite data — skip layer */
        }
      }

      // Showcase enemy: front-right, facing the hero.
      if (cover.enemy) {
        try {
          const enemy = decodeSprite(cover.enemy, cover.palette);
          ctx.drawImage(enemy, 86, baseline - enemy.height * 2, enemy.width * 2, enemy.height * 2);
        } catch {
          /* skip layer */
        }
      }

      // Hero: front-left, with the baked likeness head when this game has one.
      const heroData = head && tallHeroEntry ? tallHeroEntry.frames[0] : cover.hero;
      if (heroData) {
        try {
          let heroCanvas = decodeSprite(heroData, cover.palette);
          const slot = head && tallHeroEntry ? tallHeroEntry.headSlots?.[0] : nativeHeadSlot;
          if (head && slot) {
            const composed = document.createElement('canvas');
            composed.width = heroCanvas.width;
            composed.height = heroCanvas.height;
            const cctx = composed.getContext('2d')!;
            cctx.imageSmoothingEnabled = false;
            cctx.drawImage(heroCanvas, 0, 0);
            cctx.clearRect(slot.x, slot.y, slot.size, slot.size);
            cctx.drawImage(head, slot.x, slot.y, slot.size, slot.size);
            const overlay = tallHeroEntry?.likenessOverlays?.[0];
            if (overlay) cctx.drawImage(decodeSprite(overlay, cover.palette), 0, 0);
            heroCanvas = composed;
          }
          const scale = Math.max(1, Math.min(3, Math.floor((baseline - 4) / heroCanvas.height)));
          ctx.drawImage(
            heroCanvas,
            Math.round(40 - (heroCanvas.width * scale) / 2),
            Math.round(baseline - heroCanvas.height * scale),
            heroCanvas.width * scale,
            heroCanvas.height * scale,
          );
        } catch {
          /* skip layer */
        }
      }
    };

    draw(null);
    if (props.cover?.hasLikeness && props.gameId) {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = `/api/games/${props.gameId}/assets/head${likenessHeadSlot?.size ?? 12}.png`;
    }
    return () => {
      disposed = true;
    };
  }, [props.cover, props.archetype, props.gameId, props.seedText, props.pending]);
  return <canvas ref={ref} class={props.class} />;
}

export function Modal(props: { children: ComponentChildren }): ComponentChildren {
  return (
    <div class="modal-backdrop">
      <div class="modal">{props.children}</div>
    </div>
  );
}

/** Progress ring for hold-to-confirm (0..1). */
export function HoldRing(props: { t: number }): ComponentChildren {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div class="hold-ring">
      <svg width="58" height="58">
        <circle class="track" cx="29" cy="29" r={r} />
        <circle
          class="fill"
          cx="29"
          cy="29"
          r={r}
          stroke-dasharray={`${c}`}
          stroke-dashoffset={`${c * (1 - Math.max(0, Math.min(1, props.t)))}`}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On-screen keyboard (d-pad navigable) — used for WiFi passwords.
// ---------------------------------------------------------------------------

const OSK_ROWS_LOWER = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_.@'];
const OSK_ROWS_UPPER = ['!"#$%&\'()*', 'QWERTYUIOP', 'ASDFGHJKL+', 'ZXCVBNM,:;'];

export interface OskState {
  value: string;
  row: number;
  col: number;
  shift: boolean;
  masked: boolean;
}

export function newOskState(): OskState {
  return { value: '', row: 1, col: 0, shift: false, masked: true };
}

/** Bottom action row: Shift, Space, Show/Hide, Done. */
const ACTION_ROW = ['SHIFT', 'SPACE', 'SHOW', 'DONE'] as const;

export function oskHandle(
  state: OskState,
  btn: LogicalButton,
  onDone: (value: string) => void,
  onCancel: () => void,
): OskState {
  const rows = state.shift ? OSK_ROWS_UPPER : OSK_ROWS_LOWER;
  const rowLen = (r: number) => (r === 4 ? ACTION_ROW.length : rows[r]!.length);
  const s = { ...state };
  switch (btn) {
    case 'UP':
      s.row = (s.row + 4) % 5;
      s.col = Math.min(s.col, rowLen(s.row) - 1);
      shellInput.blip('move');
      break;
    case 'DOWN':
      s.row = (s.row + 1) % 5;
      s.col = Math.min(s.col, rowLen(s.row) - 1);
      shellInput.blip('move');
      break;
    case 'LEFT':
      s.col = (s.col + rowLen(s.row) - 1) % rowLen(s.row);
      shellInput.blip('move');
      break;
    case 'RIGHT':
      s.col = (s.col + 1) % rowLen(s.row);
      shellInput.blip('move');
      break;
    case 'A': {
      shellInput.blip('select');
      if (s.row === 4) {
        const action = ACTION_ROW[s.col]!;
        if (action === 'SHIFT') s.shift = !s.shift;
        else if (action === 'SPACE') s.value += ' ';
        else if (action === 'SHOW') s.masked = !s.masked;
        else if (action === 'DONE') onDone(s.value);
      } else if (s.value.length < 63) {
        s.value += rows[s.row]![s.col]!;
      }
      break;
    }
    case 'B':
      if (s.value.length > 0) {
        s.value = s.value.slice(0, -1);
        shellInput.blip('back');
      } else {
        shellInput.blip('back');
        onCancel();
      }
      break;
    case 'START':
      onDone(s.value);
      break;
    case 'Y':
      s.shift = !s.shift;
      shellInput.blip('move');
      break;
    default:
      break;
  }
  return s;
}

export function OnScreenKeyboard(props: { state: OskState; label: string }): ComponentChildren {
  const rows = props.state.shift ? OSK_ROWS_UPPER : OSK_ROWS_LOWER;
  const display = props.state.masked ? '•'.repeat(props.state.value.length) : props.state.value;
  return (
    <div class="osk">
      <div class="osk-display">
        {display || <span style="color:var(--text-dim)">{props.label}</span>}
      </div>
      {rows.map((row, r) => (
        <div class="osk-row" key={r}>
          {[...row].map((ch, c) => (
            <div
              key={c}
              class={`osk-key focusable ${props.state.row === r && props.state.col === c ? 'focused' : ''}`}
            >
              {ch}
            </div>
          ))}
        </div>
      ))}
      <div class="osk-row">
        {ACTION_ROW.map((label, c) => (
          <div
            key={label}
            class={`osk-key wide focusable ${props.state.row === 4 && props.state.col === c ? 'focused' : ''}`}
          >
            {label === 'SHOW' ? (props.state.masked ? 'SHOW' : 'HIDE') : label}
            {label === 'SHIFT' && props.state.shift ? <Icon name="dot" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Format a nullable USD amount (null = unknown, never $0.00). */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'cost unavailable';
  return `$${v.toFixed(3)}`;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
