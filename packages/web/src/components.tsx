// Shared shell components: footer legend, game cover canvas, hold-to-confirm
// ring, modal frame, on-screen keyboard.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  GENERATED_GAME_ASSET_FILES,
  type GameListItem,
  type LogicalButton,
} from '@sparkade/shared';
import { containedCoverRect, coveringSourceRect } from './cover-layout';
import { shellInput } from './shell-input';
import { Icon } from './icons';

const CABINET_FALLBACK_URL = '/sparkade-cabinet-fallback.png';
const MAX_CACHED_COVER_IMAGES = 64;
const coverImages = new Map<string, HTMLImageElement>();
const coverImageLoads = new Map<string, Promise<HTMLImageElement>>();

function cachedCoverImage(url: string): HTMLImageElement | null {
  const image = coverImages.get(url);
  if (!image) return null;
  // Refresh insertion order so the cache behaves like a small LRU.
  coverImages.delete(url);
  coverImages.set(url, image);
  return image;
}

function loadCoverImage(url: string): Promise<HTMLImageElement> {
  const cached = cachedCoverImage(url);
  if (cached) return Promise.resolve(cached);
  const pending = coverImageLoads.get(url);
  if (pending) return pending;

  const load = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      coverImageLoads.delete(url);
      coverImages.set(url, image);
      while (coverImages.size > MAX_CACHED_COVER_IMAGES) {
        const oldest = coverImages.keys().next().value as string | undefined;
        if (!oldest) break;
        coverImages.delete(oldest);
      }
      resolve(image);
    };
    image.onerror = () => {
      coverImageLoads.delete(url);
      reject(new Error(`Unable to load cover image: ${url}`));
    };
    image.src = url;
  });
  coverImageLoads.set(url, load);
  return load;
}

export function FooterLegend(props: {
  items: [string, string][];
  chips?: ComponentChildren;
}): ComponentChildren {
  return (
    <div class="footer-legend">
      {props.items.map(([btn, label]) => {
        const buttons = btn.split('/');
        return (
          <span key={btn + label}>
            <span class="footer-button-group">
              {buttons.map((button, index) => (
                <span class="footer-button-part" key={`${button}-${index}`}>
                  {index > 0 ? <span class="footer-button-separator">/</span> : null}
                  <b>{button}</b>
                </span>
              ))}
            </span>
            {label}
          </span>
        );
      })}
      {props.chips ? <span class="status-chips">{props.chips}</span> : null}
    </div>
  );
}

/**
 * Show published image-model-authored key art when it exists. Every other
 * state uses one stable Sparkade cabinet illustration—never legacy sprite art.
 */
export function GameCover(props: {
  cover: GameListItem['cover'];
  gameId?: string;
  /** Stable generation identity used to invalidate cached key art after retry. */
  assetVersion?: string;
  class?: string;
  /** Wide detail banners matte the complete cover over a dim full-bleed copy. */
  presentation?: 'standard' | 'matted';
}): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  const matted = props.presentation === 'matted';
  const keyArtUrl =
    props.cover?.hasKeyArt && props.gameId
      ? '/api/games/' +
        props.gameId +
        '/assets/' +
        GENERATED_GAME_ASSET_FILES.keyArt +
        '?v=' +
        encodeURIComponent(props.assetVersion ?? 'published')
      : null;
  const imageUrl = keyArtUrl ?? CABINET_FALLBACK_URL;

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;

    const clearCanvas = () => {
      canvas.width = matted ? 960 : 512;
      canvas.height = matted ? 360 : 304;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#050814';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const presentMatted = (image: HTMLImageElement, sourceWidth: number, sourceHeight: number) => {
      canvas.width = 960;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const background = coveringSourceRect(sourceWidth, sourceHeight, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        background.x,
        background.y,
        background.width,
        background.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      ctx.fillStyle = 'rgba(4, 7, 18, 0.68)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const foreground = containedCoverRect(sourceWidth, sourceHeight, canvas.width, canvas.height);
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = 22;
      ctx.drawImage(
        image,
        0,
        0,
        sourceWidth,
        sourceHeight,
        foreground.x,
        foreground.y,
        foreground.width,
        foreground.height,
      );
      ctx.restore();
    };

    const drawCoverImage = (image: HTMLImageElement) => {
      if (disposed) return;
      if (matted) {
        presentMatted(image, image.naturalWidth, image.naturalHeight);
        return;
      }

      canvas.width = 512;
      canvas.height = 304;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const source = coveringSourceRect(
        image.naturalWidth,
        image.naturalHeight,
        canvas.width,
        canvas.height,
      );
      ctx.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };

    const showCabinetFallback = () => {
      const cachedFallback = cachedCoverImage(CABINET_FALLBACK_URL);
      if (cachedFallback) {
        drawCoverImage(cachedFallback);
        return;
      }
      clearCanvas();
      void loadCoverImage(CABINET_FALLBACK_URL)
        .then(drawCoverImage)
        .catch(() => {
          if (!disposed) clearCanvas();
        });
    };

    const cached = cachedCoverImage(imageUrl);
    if (cached) {
      drawCoverImage(cached);
    } else {
      clearCanvas();
      void loadCoverImage(imageUrl)
        .then(drawCoverImage)
        .catch(() => {
          if (disposed) return;
          if (imageUrl === CABINET_FALLBACK_URL) {
            clearCanvas();
            return;
          }
          showCabinetFallback();
        });
    }

    return () => {
      disposed = true;
    };
  }, [imageUrl, matted]);

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
