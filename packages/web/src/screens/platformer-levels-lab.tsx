// Dev-only, paid-call Platformer Level Design Lab
// (http://localhost:5173/?dev=platformer-levels). Muse Image proposes spatial
// block maps; local code parses, repairs, playtests, hydrates, and collision-locks them.
import { isTextEntryTarget, moveAABB } from '@sparkade/engine';
import {
  GENERATED_GAME_ASSET_FILES,
  type PlatformerLevel,
  type PlatformerTileType,
} from '@sparkade/shared';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  api,
  subscribePlatformerLevelLab,
  type PlatformerLevelLabEvent,
  type PlatformerLevelLabMetrics,
  type PlatformerLevelLabStage,
} from '../api';

interface CandidateView {
  id: string;
  status: PlatformerLevelLabEvent['status'];
  rawUrl?: string;
  parsedUrl?: string;
  repairedUrl?: string;
  level?: PlatformerLevel;
  metrics?: PlatformerLevelLabMetrics;
  error?: string;
  elapsedMs?: number;
}

interface HydrationView {
  candidateId: string;
  rawUrl?: string;
  normalizedUrl?: string;
  exactUrl?: string;
  safeUrl?: string;
  visualMaskUrl?: string;
  darkOutlineUrl?: string;
  lightOutlineUrl?: string;
  mismatchUrl?: string;
  metrics?: {
    falsePositiveRatio?: number;
    paintOutsideCollisionRatio?: number;
    paintOutsideVisualMaskRatio?: number;
    missingTerrainRatio?: number;
    fringeUsageRatio?: number;
    rejectedPaintRatio?: number;
    acceptedPaintRatio?: number;
    collisionCoverageRatio?: number;
    surfaceAlignment?: {
      runsDetected?: number;
      runsShifted?: number;
      meanShiftPx?: number;
    };
    exactCollisionMask?: boolean;
    fringe?: { topPx?: number; sidePx?: number; bottomPx?: number };
  };
  elapsedMs?: number;
}

interface HydrationCandidateView {
  id: string;
  status: PlatformerLevelLabEvent['status'];
  rawUrl?: string;
  safeUrl?: string;
  mismatchUrl?: string;
  geometry?: {
    score?: number;
    viable?: boolean;
    reasons?: string[];
  };
  metrics?: HydrationView['metrics'];
  elapsedMs?: number;
}

interface BackdropOption {
  id: string;
  label: string;
  url: string;
}

const DEFAULT_CONCEPT =
  'A storm-lashed clockwork city level with brass rooftops, turbine towers, optional upper routes, and electrical hazards.';
const TILE = 16;
const PLAYER_W = 12;
const PLAYER_H = 28;

const STAGES: Array<{ id: PlatformerLevelLabStage; label: string; note: string }> = [
  { id: 'layouts', label: '3 block maps', note: 'Muse Image · parallel' },
  { id: 'parse', label: 'Grid parse', note: 'registration + quantization' },
  { id: 'repair', label: 'Rules', note: 'reachability + deterministic fixes' },
  { id: 'selection', label: 'Playtest', note: 'compare valid candidates' },
  { id: 'hydrate', label: 'Hydrate', note: '3× Muse + Spark pick' },
];

const BACKDROP_ROLES = [
  ['platformerBackdropLevel1', 'Level 1'],
  ['platformerBackdropLevel2', 'Level 2'],
  ['platformerBackdropLevel3', 'Level 3'],
  ['platformerBackdropBoss', 'Boss'],
] as const;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function latestEvent(
  events: readonly PlatformerLevelLabEvent[],
  predicate: (event: PlatformerLevelLabEvent) => boolean,
): PlatformerLevelLabEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (predicate(events[index]!)) return events[index];
  }
  return undefined;
}

function candidateFrom(event: PlatformerLevelLabEvent): CandidateView | null {
  if (event.type !== 'candidate') return null;
  const id = stringValue(event.data?.candidateId);
  if (!id) return null;
  return {
    id,
    status: event.status,
    rawUrl: stringValue(event.data?.rawUrl),
    parsedUrl: stringValue(event.data?.parsedUrl),
    repairedUrl: stringValue(event.data?.repairedUrl),
    level:
      event.data?.level && typeof event.data.level === 'object'
        ? (event.data.level as unknown as PlatformerLevel)
        : undefined,
    metrics:
      event.data?.metrics && typeof event.data.metrics === 'object'
        ? (event.data.metrics as unknown as PlatformerLevelLabMetrics)
        : undefined,
    error: stringValue(event.data?.error),
    elapsedMs: event.elapsedMs,
  };
}

function hydrationFrom(event: PlatformerLevelLabEvent | undefined): HydrationView | null {
  if (
    !event ||
    (event.type !== 'hydration' && event.type !== 'mask') ||
    event.status !== 'complete'
  ) {
    return null;
  }
  const candidateId = stringValue(event.data?.candidateId);
  if (!candidateId) return null;
  return {
    candidateId,
    rawUrl: stringValue(event.data?.rawUrl),
    normalizedUrl: stringValue(event.data?.normalizedUrl),
    exactUrl: stringValue(event.data?.exactUrl),
    safeUrl: stringValue(event.data?.safeUrl),
    visualMaskUrl: stringValue(event.data?.visualMaskUrl),
    darkOutlineUrl: stringValue(event.data?.darkOutlineUrl),
    lightOutlineUrl: stringValue(event.data?.lightOutlineUrl),
    mismatchUrl: stringValue(event.data?.mismatchUrl),
    metrics:
      event.data?.metrics && typeof event.data.metrics === 'object'
        ? (event.data.metrics as HydrationView['metrics'])
        : undefined,
    elapsedMs: event.elapsedMs,
  };
}

function hydrationCandidateFrom(
  event: PlatformerLevelLabEvent,
): HydrationCandidateView | null {
  if (event.type !== 'hydration-candidate') return null;
  const id = stringValue(event.data?.hydrationId);
  if (!id) return null;
  return {
    id,
    status: event.status,
    rawUrl: stringValue(event.data?.rawUrl),
    safeUrl: stringValue(event.data?.safeUrl),
    mismatchUrl: stringValue(event.data?.mismatchUrl),
    geometry:
      event.data?.geometry && typeof event.data.geometry === 'object'
        ? (event.data.geometry as HydrationCandidateView['geometry'])
        : undefined,
    metrics:
      event.data?.metrics && typeof event.data.metrics === 'object'
        ? (event.data.metrics as HydrationView['metrics'])
        : undefined,
    elapsedMs: event.elapsedMs,
  };
}

function stageStatus(
  stage: PlatformerLevelLabStage,
  events: readonly PlatformerLevelLabEvent[],
): 'waiting' | 'active' | 'complete' | 'failed' {
  const matching = events.filter((event) => event.stage === stage);
  if (matching.some((event) => event.status === 'failed')) {
    if (stage !== 'hydrate' || !matching.some((event) => event.status === 'complete')) return 'failed';
  }
  if (stage === 'layouts') {
    if (events.some((event) => event.type === 'candidate')) return 'complete';
  }
  if (stage === 'parse' || stage === 'repair') {
    if (events.some((event) => event.type === 'candidate' && event.status === 'complete')) {
      return 'complete';
    }
  }
  if (stage === 'selection' && events.some((event) => event.type === 'selection')) {
    return 'complete';
  }
  if (
    stage === 'hydrate' &&
    matching.some((event) => event.type === 'hydration' && event.status === 'complete')
  ) {
    return 'complete';
  }
  if (matching.some((event) => event.status === 'started')) return 'active';
  return 'waiting';
}

function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function PromptDisclosure(props: { title: string; prompt?: string }): ComponentChildren {
  if (!props.prompt) return null;
  return (
    <details class="ldl-disclosure">
      <summary>{props.title}</summary>
      <pre>{props.prompt}</pre>
    </details>
  );
}

function CandidateCard(props: {
  candidate: CandidateView;
  selected: boolean;
  recommended: boolean;
  prompt?: string;
  onSelect: () => void;
}): ComponentChildren {
  const metrics = props.candidate.metrics;
  return (
    <article
      class={`ldl-candidate${props.selected ? ' selected' : ''}${props.candidate.status === 'rejected' ? ' rejected' : ''}`}
    >
      <header>
        <div>
          <strong>{props.candidate.id}</strong>
          <span>{props.recommended ? 'LOCAL PICK' : props.candidate.status.toUpperCase()}</span>
        </div>
        <b>{metrics ? `${metrics.score}/100` : '—'}</b>
      </header>
      <div class="ldl-map-pair">
        <figure>
          {props.candidate.rawUrl ? (
            <img src={props.candidate.rawUrl} alt={`${props.candidate.id} raw block-map output`} />
          ) : (
            <span>waiting…</span>
          )}
          <figcaption>RAW MUSE OUTPUT</figcaption>
        </figure>
        <figure>
          {props.candidate.repairedUrl ? (
            <img
              src={props.candidate.repairedUrl}
              alt={`${props.candidate.id} repaired canonical map`}
            />
          ) : (
            <span>not parsed</span>
          )}
          <figcaption>CANONICAL MAP</figcaption>
        </figure>
      </div>
      {metrics && (
        <div class="ldl-metrics">
          <span>
            <small>GRID CONFIDENCE</small>
            <b>{percent(metrics.confidentCellRatio)}</b>
          </span>
          <span>
            <small>REPAIRED CELLS</small>
            <b>{metrics.changedCells}</b>
          </span>
          <span>
            <small>REACHABLE STANDS</small>
            <b>{metrics.reachableStandingCells}</b>
          </span>
          <span>
            <small>REGISTRATION / ΔRGB</small>
            <b>{metrics.registration} · {metrics.meanColorDistance.toFixed(1)}</b>
          </span>
        </div>
      )}
      {metrics?.repairs.length ? (
        <details class="ldl-repairs">
          <summary>{metrics.repairs.length} parser / repair note(s)</summary>
          <ul>
            {metrics.repairs.map((repair) => (
              <li key={repair}>{repair}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {metrics?.issuesAfter.length ? (
        <ul class="ldl-issues">
          {metrics.issuesAfter.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {props.candidate.error && <p class="ldl-issues">{props.candidate.error}</p>}
      <footer>
        <button
          type="button"
          disabled={!props.candidate.level || Boolean(metrics?.issuesAfter.length)}
          onClick={props.onSelect}
        >
          {props.selected ? 'Selected for playtest' : 'Select & play'}
        </button>
        <span>{formatTime(props.candidate.elapsedMs)}</span>
      </footer>
      <PromptDisclosure title="Exact Muse Image layout prompt" prompt={props.prompt} />
      {props.candidate.parsedUrl && props.candidate.parsedUrl !== props.candidate.repairedUrl && (
        <details class="ldl-disclosure">
          <summary>Before deterministic repair</summary>
          <img src={props.candidate.parsedUrl} alt="Parsed map before repair" />
        </details>
      )}
    </article>
  );
}

function HydrationCandidateCard(props: {
  candidate: HydrationCandidateView;
  winner: boolean;
}): ComponentChildren {
  const geometry = props.candidate.geometry;
  const metrics = props.candidate.metrics;
  return (
    <article
      class={`ldl-hydration-candidate${props.winner ? ' selected' : ''}${geometry?.viable === false ? ' rejected' : ''}`}
    >
      <header>
        <div>
          <strong>{props.candidate.id}</strong>
          <span>
            {props.winner
              ? 'SPARK PICK'
              : geometry?.viable
                ? 'GEOMETRY PASS'
                : props.candidate.status.toUpperCase()}
          </span>
        </div>
        <b>{geometry?.score === undefined ? '—' : `${geometry.score}/100`}</b>
      </header>
      <div class="ldl-map-pair">
        <figure>
          {props.candidate.rawUrl ? (
            <img src={props.candidate.rawUrl} alt={`${props.candidate.id} raw hydration`} />
          ) : (
            <span>generating…</span>
          )}
          <figcaption>RAW MUSE OUTPUT</figcaption>
        </figure>
        <figure class="checker">
          {props.candidate.safeUrl ? (
            <img src={props.candidate.safeUrl} alt={`${props.candidate.id} processed terrain`} />
          ) : (
            <span>waiting…</span>
          )}
          <figcaption>COLLISION-SAFE RESULT</figcaption>
        </figure>
      </div>
      <div class="ldl-hydration-candidate-metrics">
        <span>
          <small>ACCEPTED PAINT</small>
          <b>{percent(metrics?.acceptedPaintRatio)}</b>
        </span>
        <span>
          <small>REJECTED PAINT</small>
          <b>{percent(metrics?.rejectedPaintRatio)}</b>
        </span>
        <span>
          <small>COLLISION COVERAGE</small>
          <b>{percent(metrics?.collisionCoverageRatio)}</b>
        </span>
        <span>
          <small>OUTSIDE MASK</small>
          <b>{percent(metrics?.paintOutsideVisualMaskRatio)}</b>
        </span>
      </div>
      {geometry?.reasons?.length ? (
        <ul class="ldl-issues">
          {geometry.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <footer>
        <span>{formatTime(props.candidate.elapsedMs)}</span>
      </footer>
    </article>
  );
}

function PlayableLevel(props: {
  level: PlatformerLevel;
  terrainUrl?: string;
  darkOutlineUrl?: string;
  lightOutlineUrl?: string;
  backdropUrl?: string;
}): ComponentChildren {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCollision, setShowCollision] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [backdropDim, setBackdropDim] = useState(22);
  const [outlineMode, setOutlineMode] = useState<'auto' | 'dark' | 'light' | 'off'>('auto');
  const [status, setStatus] = useState('ARROWS / A-D MOVE · SPACE JUMPS');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const level = props.level;
    const widthTiles = level.tiles[0]?.length ?? 0;
    const heightTiles = level.tiles.length;
    const keyDown = new Set<string>();
    const consumedCoins = new Set<string>();
    let animation = 0;
    let previous = performance.now();
    let won = false;
    let outlineSampleFrame = 0;
    const player = {
      x: level.playerSpawn.x * TILE + (TILE - PLAYER_W) / 2,
      y: (level.playerSpawn.y + 1) * TILE - PLAYER_H,
      w: PLAYER_W,
      h: PLAYER_H,
      vx: 0,
      vy: 0,
      onGround: false,
    };
    const terrain = props.terrainUrl ? new Image() : null;
    if (terrain && props.terrainUrl) terrain.src = props.terrainUrl;
    const backdrop = props.backdropUrl ? new Image() : null;
    if (backdrop && props.backdropUrl) backdrop.src = props.backdropUrl;
    const darkOutline = props.darkOutlineUrl ? new Image() : null;
    if (darkOutline && props.darkOutlineUrl) darkOutline.src = props.darkOutlineUrl;
    const lightOutline = props.lightOutlineUrl ? new Image() : null;
    if (lightOutline && props.lightOutlineUrl) lightOutline.src = props.lightOutlineUrl;
    let automaticOutline: HTMLImageElement | null = lightOutline;
    const kind = (x: number, y: number): PlatformerTileType => {
      if (x < 0 || y < 0 || y >= heightTiles || x >= widthTiles) return 'empty';
      const char = level.tiles[y]![x]!;
      return char === '.' ? 'empty' : (level.legend[char] ?? 'empty');
    };
    const reset = (message = 'RESET TO CHECKPOINT'): void => {
      player.x = level.playerSpawn.x * TILE + (TILE - PLAYER_W) / 2;
      player.y = (level.playerSpawn.y + 1) * TILE - PLAYER_H;
      player.vx = 0;
      player.vy = 0;
      player.onGround = false;
      won = false;
      setStatus(message);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntryTarget(event.target)) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW'].includes(event.code)) {
        event.preventDefault();
        keyDown.add(event.code);
      }
      if (event.code === 'KeyR') reset();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      keyDown.delete(event.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const draw = (now: number): void => {
      const dt = Math.min(1 / 30, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!won) {
        const direction =
          (keyDown.has('ArrowRight') || keyDown.has('KeyD') ? 1 : 0) -
          (keyDown.has('ArrowLeft') || keyDown.has('KeyA') ? 1 : 0);
        const target = direction * 118;
        player.vx += Math.max(-760 * dt, Math.min(760 * dt, target - player.vx));
        if (direction === 0) player.vx *= Math.pow(0.002, dt);
        if (
          (keyDown.has('Space') || keyDown.has('KeyW')) &&
          player.onGround
        ) {
          player.vy = -302;
          player.onGround = false;
          keyDown.delete('Space');
          keyDown.delete('KeyW');
        }
        player.vy = Math.min(330, player.vy + 860 * dt);
        const moved = moveAABB(
          {
            cols: widthTiles,
            rows: heightTiles,
            tileSize: TILE,
            solidityAt: (x, y) => {
              const tile = kind(x, y);
              return tile === 'solid' ? 'solid' : tile === 'platform' ? 'platform' : 'empty';
            },
          },
          player,
          player.vx * dt,
          player.vy * dt,
          { dropThrough: keyDown.has('ArrowDown') },
        );
        player.x = moved.x;
        player.y = moved.y;
        player.onGround = moved.onGround;
        if (moved.hitX) player.vx = 0;
        if (moved.hitY) player.vy = 0;
        const tx0 = Math.floor(player.x / TILE);
        const tx1 = Math.floor((player.x + player.w - 0.01) / TILE);
        const ty0 = Math.floor(player.y / TILE);
        const ty1 = Math.floor((player.y + player.h - 0.01) / TILE);
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            if (kind(tx, ty) === 'hazard') reset('HAZARD HIT · RESET');
          }
        }
        for (const entity of level.entities) {
          if (entity.type !== 'coin' && entity.type !== 'powerup') continue;
          if (Math.abs(player.x / TILE - entity.x) < 1 && Math.abs(player.y / TILE - entity.y) < 2) {
            consumedCoins.add(`${entity.x},${entity.y}`);
          }
        }
        if (player.y > heightTiles * TILE + 48) reset('FELL OUT · RESET');
        if (
          Math.abs(player.x / TILE - level.exit.x) < 1 &&
          Math.abs((player.y + player.h) / TILE - (level.exit.y + 1)) < 2
        ) {
          won = true;
          setStatus('EXIT REACHED · LEVEL IS PLAYABLE');
        }
      }

      const cameraX = Math.max(
        0,
        Math.min(widthTiles * TILE - canvas.width, player.x + player.w / 2 - canvas.width * 0.38),
      );
      if (backdrop?.complete && backdrop.naturalWidth > 0) {
        const parallax = 0.35;
        const backdropWidth = canvas.width + (widthTiles * TILE - canvas.width) * parallax;
        context.drawImage(backdrop, -cameraX * parallax, 0, backdropWidth, canvas.height);
      } else {
        const sky = context.createLinearGradient(0, 0, 0, canvas.height);
        sky.addColorStop(0, '#151b3d');
        sky.addColorStop(1, '#38284d');
        context.fillStyle = sky;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'rgba(137,173,255,.16)';
        for (let x = 0; x < canvas.width; x += 80) context.fillRect(x, 52 + (x % 37), 42, 2);
      }
      context.fillStyle = `rgba(5,7,19,${backdropDim / 100})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

      let outline = outlineMode === 'dark' ? darkOutline : outlineMode === 'light' ? lightOutline : null;
      if (outlineMode === 'auto') {
        if (outlineSampleFrame++ % 12 === 0) {
          const sample = context.getImageData(
            0,
            Math.floor(canvas.height * 0.34),
            canvas.width,
            Math.ceil(canvas.height * 0.66),
          ).data;
          let luminance = 0;
          let samples = 0;
          for (let index = 0; index < sample.length; index += 4 * 32) {
            luminance +=
              sample[index]! * 0.2126 +
              sample[index + 1]! * 0.7152 +
              sample[index + 2]! * 0.0722;
            samples++;
          }
          automaticOutline = samples && luminance / samples < 105 ? lightOutline : darkOutline;
        }
        outline = automaticOutline;
      }
      if (outline?.complete && outline.naturalWidth > 0) {
        context.drawImage(outline, -cameraX, 0, widthTiles * TILE, heightTiles * TILE);
      }

      if (terrain?.complete && terrain.naturalWidth > 0) {
        context.drawImage(terrain, -cameraX, 0, widthTiles * TILE, heightTiles * TILE);
      } else {
        for (let y = 0; y < heightTiles; y++) {
          for (let x = 0; x < widthTiles; x++) {
            const tile = kind(x, y);
            if (tile === 'empty') continue;
            context.fillStyle =
              tile === 'solid'
                ? '#634a39'
                : tile === 'platform'
                  ? '#3d70d8'
                  : tile === 'hazard'
                    ? '#ff405d'
                    : '#9a62d7';
            context.fillRect(x * TILE - cameraX, y * TILE, TILE, TILE);
            if (tile === 'solid' || tile === 'platform') {
              context.fillStyle = '#d59b59';
              context.fillRect(x * TILE - cameraX, y * TILE, TILE, 2);
            }
          }
        }
      }

      if (showCollision) {
        context.globalAlpha = 0.33;
        for (let y = 0; y < heightTiles; y++) {
          for (let x = 0; x < widthTiles; x++) {
            const tile = kind(x, y);
            if (tile === 'empty') continue;
            context.fillStyle =
              tile === 'solid'
                ? '#000000'
                : tile === 'platform'
                  ? '#0055ff'
                  : tile === 'hazard'
                    ? '#ff2020'
                    : '#a855f7';
            context.fillRect(x * TILE - cameraX, y * TILE, TILE, TILE);
            context.strokeStyle = 'rgba(255,255,255,.5)';
            context.strokeRect(x * TILE - cameraX + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
          }
        }
        context.globalAlpha = 1;
      }

      for (const entity of level.entities) {
        if ((entity.type !== 'coin' && entity.type !== 'powerup') || consumedCoins.has(`${entity.x},${entity.y}`)) continue;
        context.fillStyle = entity.type === 'coin' ? '#47e06f' : '#3ce6ed';
        context.beginPath();
        context.arc(entity.x * TILE + 8 - cameraX, entity.y * TILE + 8, entity.type === 'coin' ? 5 : 7, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = '#ff8a31';
      context.fillRect(level.exit.x * TILE + 2 - cameraX, (level.exit.y - 1) * TILE, 12, 32);
      context.fillStyle = won ? '#5cff9a' : '#ffd84d';
      context.fillRect(player.x - cameraX, player.y, player.w, player.h);
      context.fillStyle = '#15172d';
      context.fillRect(player.x + 7 - cameraX, player.y + 6, 2, 2);
      context.fillStyle = 'rgba(5,7,19,.82)';
      context.fillRect(8, 8, 246, 18);
      context.fillStyle = '#eef1ff';
      context.font = '10px monospace';
      context.fillText(status, 14, 21);
      animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    backdropDim,
    outlineMode,
    props.backdropUrl,
    props.darkOutlineUrl,
    props.level,
    props.lightOutlineUrl,
    props.terrainUrl,
    resetNonce,
    showCollision,
  ]);

  return (
    <div class="ldl-playable">
      <canvas ref={canvasRef} width={768} height={288} tabIndex={0} />
      <div>
        <button type="button" onClick={() => setResetNonce((value) => value + 1)}>
          Restart
        </button>
        <label>
          <input
            type="checkbox"
            checked={showCollision}
            onChange={(event) =>
              setShowCollision((event.target as HTMLInputElement).checked)
            }
          />
          Collision overlay
        </label>
        <label>
          Backdrop dim
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={backdropDim}
            onInput={(event) =>
              setBackdropDim(Number((event.target as HTMLInputElement).value))
            }
          />
          <output>{backdropDim}%</output>
        </label>
        <label>
          Edge
          <select
            value={outlineMode}
            onChange={(event) =>
              setOutlineMode(
                (event.target as HTMLSelectElement).value as typeof outlineMode,
              )
            }
          >
            <option value="auto">Adaptive</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function PlatformerLevelsLabScreen(): ComponentChildren {
  const [concept, setConcept] = useState(DEFAULT_CONCEPT);
  const [runId, setRunId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('run') || null;
  });
  const [events, setEvents] = useState<PlatformerLevelLabEvent[]>([]);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'ready' | 'hydrating' | 'failed'>(
    'idle',
  );
  const [selectedId, setSelectedId] = useState('');
  const [backdropOptions, setBackdropOptions] = useState<BackdropOption[]>([]);
  const [backdropUrl, setBackdropUrl] = useState('');
  const [fringe, setFringe] = useState({ topPx: 4, sidePx: 1, bottomPx: 2 });
  const [remasking, setRemasking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .listGames()
      .then(async (games) => {
        const details = await Promise.all(
          games
            .filter((game) => game.archetype === 'platformer' && game.status === 'ready')
            .map((game) => api.getGame(game.id).catch(() => null)),
        );
        if (cancelled) return;
        const options: BackdropOption[] = [];
        for (const detail of details) {
          if (!detail) continue;
          for (const [role, label] of BACKDROP_ROLES) {
            if (!detail.assets[role]) continue;
            options.push({
              id: `${detail.item.id}-${role}`,
              label: `${detail.item.title} · ${label}`,
              url: api.assetUrl(detail.item.id, GENERATED_GAME_ASSET_FILES[role]),
            });
          }
        }
        setBackdropOptions(options);
        if (options[0]) setBackdropUrl((current) => current || options[0]!.url);
      })
      .catch(() => {
        // Backdrop comparison is optional; the synthetic lab sky remains available.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void api
      .platformerLevelLabStatus(runId)
      .then((status) => {
        if (cancelled) return;
        setConcept(status.concept || DEFAULT_CONCEPT);
        setEvents(status.events);
        setRunStatus(status.status);
        if (status.recommendedId) setSelectedId((current) => current || status.recommendedId!);
        if (status.status === 'failed') {
          setError(status.error ?? 'Level-design lab failed');
          return;
        }
        unsubscribe = subscribePlatformerLevelLab(
          runId,
          (event) => {
            setEvents((current) =>
              current.some(({ seq }) => seq === event.seq)
                ? current
                : [...current, event].sort((a, b) => a.seq - b.seq),
            );
            if (event.type === 'selection' || event.type === 'ready') setRunStatus('ready');
            if (event.type === 'hydration' && event.status === 'started') setRunStatus('hydrating');
            if (event.type === 'hydration' && event.status !== 'started') setRunStatus('ready');
            if (event.type === 'failed') {
              setRunStatus('failed');
              setError(event.message);
            }
          },
          () => {
            if (!cancelled) setError('Lost the live level-lab connection');
          },
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [runId]);

  const candidates = useMemo(() => {
    const map = new Map<string, CandidateView>();
    for (const event of events) {
      const candidate = candidateFrom(event);
      if (candidate) map.set(candidate.id, candidate);
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [events]);
  const promptByCandidate = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (event.stage !== 'layouts') continue;
      const id = stringValue(event.data?.candidateId);
      const prompt = stringValue(event.data?.prompt);
      if (id && prompt) map.set(id, prompt);
    }
    return map;
  }, [events]);
  const selectionEvent = latestEvent(events, (event) => event.type === 'selection');
  const recommendedId = stringValue(selectionEvent?.data?.recommendedId) ?? '';
  useEffect(() => {
    if (!selectedId && recommendedId) setSelectedId(recommendedId);
  }, [recommendedId, selectedId]);
  const selected = candidates.find(({ id }) => id === selectedId);
  const hydrationEvent = latestEvent(
    events,
    (event) =>
      (event.type === 'hydration' || event.type === 'mask') && event.status === 'complete',
  );
  const hydration = hydrationFrom(hydrationEvent);
  const hydrationCandidates = useMemo(() => {
    const map = new Map<string, HydrationCandidateView>();
    for (const event of events) {
      const candidate = hydrationCandidateFrom(event);
      if (candidate) map.set(candidate.id, { ...map.get(candidate.id), ...candidate });
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [events]);
  const hydrationSelection = latestEvent(
    events,
    (event) => event.type === 'hydration-selection' && event.status === 'complete',
  );
  const hydrationJudgeStart = latestEvent(
    events,
    (event) => event.type === 'hydration-selection' && event.status === 'started',
  );
  const hydrationJudgeResponse = latestEvent(
    events,
    (event) => event.type === 'hydration-judge-response' && event.status === 'complete',
  );
  const hydrationWinnerId =
    stringValue(hydrationSelection?.data?.hydrationWinnerId) ??
    stringValue(hydrationEvent?.data?.hydrationWinnerId);
  const hydrationDecision =
    hydrationSelection?.data?.decision && typeof hydrationSelection.data.decision === 'object'
      ? hydrationSelection.data.decision
      : undefined;
  const judgeBoardUrl =
    stringValue(hydrationSelection?.data?.judgeBoardUrl) ??
    stringValue(hydrationJudgeStart?.data?.judgeBoardUrl);
  useEffect(() => {
    const next = hydration?.metrics?.fringe;
    if (!next) return;
    setFringe({
      topPx: next.topPx ?? 4,
      sidePx: next.sidePx ?? 1,
      bottomPx: next.bottomPx ?? 2,
    });
  }, [hydrationEvent?.seq]);
  const hydrationStart = latestEvent(
    events,
    (event) => event.type === 'hydration' && event.status === 'started',
  );
  const hydrationPrompt = stringValue(hydrationStart?.data?.prompt);
  const safeTerrainUrl = hydration?.candidateId === selectedId ? hydration.safeUrl : undefined;
  const latestUsage = latestEvent(
    events,
    (event) => event.type === 'ready' || (event.type === 'hydration' && event.status === 'complete'),
  );
  const imageCalls = numberValue(latestUsage?.data?.imageCalls) ?? 0;
  const imageCost = numberValue(latestUsage?.data?.imageCostUsd) ?? 0;
  const judgeCalls = numberValue(latestUsage?.data?.judgeCalls) ?? 0;
  const judgeCost = numberValue(latestUsage?.data?.judgeCostUsd);
  const totalCost = numberValue(latestUsage?.data?.totalCostUsd);

  const start = async (): Promise<void> => {
    if (!concept.trim() || starting || runStatus === 'running' || runStatus === 'hydrating') return;
    setStarting(true);
    setError(null);
    setEvents([]);
    setSelectedId('');
    setRunId(null);
    setRunStatus('running');
    try {
      const result = await api.startPlatformerLevelLab(concept);
      setRunId(result.runId);
      const url = new URL(window.location.href);
      url.searchParams.set('run', result.runId);
      window.history.replaceState(null, '', url);
    } catch (caught) {
      setRunStatus('idle');
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStarting(false);
    }
  };

  const hydrate = async (): Promise<void> => {
    if (!runId || !selected?.level || runStatus === 'hydrating') return;
    setError(null);
    setRunStatus('hydrating');
    try {
      await api.hydratePlatformerLevelLab(runId, selected.id);
    } catch (caught) {
      setRunStatus('ready');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const reprocess = async (): Promise<void> => {
    if (!runId || !hydration || remasking) return;
    setRemasking(true);
    setError(null);
    try {
      await api.reprocessPlatformerLevelLab(runId, hydration.candidateId, fringe);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRemasking(false);
    }
  };

  return (
    <main class="ldl-page">
      <header class="ldl-header">
        <div>
          <h1>Platformer Level Design Lab</h1>
          <p>Muse layout proposals → deterministic game rules → collision-locked hydration</p>
        </div>
        <nav>
          <a href="/?dev=platformer-poses">Pose lab</a>
          <a href="/?dev=assets">Asset gallery</a>
        </nav>
      </header>

      <section class="ldl-launch">
        <div class="ldl-form">
          <label>
            <span>Level concept</span>
            <textarea
              value={concept}
              disabled={runStatus === 'running' || runStatus === 'hydrating'}
              onInput={(event) => setConcept((event.target as HTMLTextAreaElement).value)}
            />
          </label>
          <button
            type="button"
            disabled={!concept.trim() || starting || runStatus === 'running' || runStatus === 'hydrating'}
            onClick={() => void start()}
          >
            {starting || runStatus === 'running' ? 'Generating candidates…' : 'Run 3-map experiment'}
          </button>
          <p>
            The first pass costs approximately $0.03. Hydration launches three parallel image
            candidates (approximately $0.03 total), applies the local geometry gate, then asks
            Spark to pick the best viable result. Runs persist under the gitignored
            data/experiments directory.
          </p>
        </div>
        <div class="ldl-timeline">
          {STAGES.map((stage, index) => {
            const status = stageStatus(stage.id, events);
            return (
              <div class={`ldl-stage ${status}`} key={stage.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <small>{stage.note}</small>
                </div>
                <em>{status}</em>
              </div>
            );
          })}
        </div>
      </section>

      {error && <div class="ldl-error">{error}</div>}

      {(runId || events.length > 0) && (
        <>
          <section class="ldl-section">
            <div class="ldl-heading">
              <div>
                <h2>Layout candidates</h2>
                <p>Raw model output beside the exact grid the engine will use.</p>
              </div>
              {runId && <code>{runId}</code>}
            </div>
            {candidates.length ? (
              <div class="ldl-candidates">
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={candidate.id === selectedId}
                    recommended={candidate.id === recommendedId}
                    prompt={promptByCandidate.get(candidate.id)}
                    onSelect={() => setSelectedId(candidate.id)}
                  />
                ))}
              </div>
            ) : (
              <div class="ldl-waiting">Muse Image candidates will appear here as they finish.</div>
            )}
          </section>

          {selected?.level && (
            <section class="ldl-section">
              <div class="ldl-heading">
                <div>
                  <h2>Playable repaired map · {selected.id}</h2>
                  <p>
                    This preview runs the real swept tile-collision primitive against the parsed
                    PlatformerLevel—not against the picture.
                  </p>
                </div>
                <div class="ldl-play-actions">
                  <label>
                    <span>Scene backdrop</span>
                    <select
                      value={backdropUrl}
                      onChange={(event) =>
                        setBackdropUrl((event.target as HTMLSelectElement).value)
                      }
                    >
                      <option value="">Synthetic lab sky</option>
                      {backdropOptions.map((option) => (
                        <option key={option.id} value={option.url}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    class="ldl-hydrate"
                    type="button"
                    disabled={runStatus === 'hydrating'}
                    onClick={() => void hydrate()}
                  >
                    {runStatus === 'hydrating'
                      ? 'Hydrating…'
                      : `Hydrate ${selected.id} · 3 candidates`}
                  </button>
                </div>
              </div>
              <PlayableLevel
                level={selected.level}
                terrainUrl={safeTerrainUrl}
                darkOutlineUrl={hydration?.candidateId === selectedId ? hydration.darkOutlineUrl : undefined}
                lightOutlineUrl={hydration?.candidateId === selectedId ? hydration.lightOutlineUrl : undefined}
                backdropUrl={backdropUrl || undefined}
              />
            </section>
          )}

          {hydrationCandidates.length > 0 && (
            <section class="ldl-section">
              <div class="ldl-heading">
                <div>
                  <h2>Hydration candidates</h2>
                  <p>
                    Geometry is scored locally first. Spark sees only passing candidates—or the
                    two least-bad fallbacks when every candidate misses a threshold—and judges
                    visual quality.
                  </p>
                </div>
                {hydrationWinnerId && <strong>WINNER · {hydrationWinnerId}</strong>}
              </div>
              <div class="ldl-hydration-candidates">
                {hydrationCandidates.map((candidate) => (
                  <HydrationCandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    winner={candidate.id === hydrationWinnerId}
                  />
                ))}
              </div>
              {(judgeBoardUrl || hydrationJudgeResponse || hydrationDecision) && (
                <div class="ldl-judge-review">
                  {judgeBoardUrl && (
                    <figure>
                      <img src={judgeBoardUrl} alt="Labeled Spark hydration review board" />
                      <figcaption>EXACT BOARD SENT TO SPARK</figcaption>
                    </figure>
                  )}
                  <div>
                    <PromptDisclosure
                      title="Spark aesthetic judge system prompt"
                      prompt={stringValue(hydrationJudgeStart?.data?.systemPrompt)}
                    />
                    <PromptDisclosure
                      title="Spark aesthetic judge request"
                      prompt={stringValue(hydrationJudgeStart?.data?.userPrompt)}
                    />
                    <PromptDisclosure
                      title="Complete Spark scoring response"
                      prompt={stringValue(hydrationJudgeResponse?.data?.raw)}
                    />
                    {hydrationDecision && (
                      <details class="ldl-disclosure" open>
                        <summary>Normalized selection</summary>
                        <pre>{JSON.stringify(hydrationDecision, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {hydration && (
            <section class="ldl-section">
              <div class="ldl-heading">
                <div>
                  <h2>Hydration diagnostics · {hydration.candidateId}</h2>
                  <p>
                    Collision remains exact while the render layer permits a thin directional
                    fringe for grass, snow, sparks, moss, and dangling detail. In the diagnostics,
                    blue is hard collision, gold is allowed fringe, cyan is used fringe, red is
                    paint beyond both masks, and gold heatmap pixels are unpainted hard terrain.
                  </p>
                </div>
                <div class="ldl-fringe-controls">
                  <label>
                    <span>Top {fringe.topPx}px</span>
                    <input
                      type="range"
                      min="0"
                      max="8"
                      value={fringe.topPx}
                      onInput={(event) =>
                        setFringe((current) => ({
                          ...current,
                          topPx: Number((event.target as HTMLInputElement).value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Side {fringe.sidePx}px</span>
                    <input
                      type="range"
                      min="0"
                      max="4"
                      value={fringe.sidePx}
                      onInput={(event) =>
                        setFringe((current) => ({
                          ...current,
                          sidePx: Number((event.target as HTMLInputElement).value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Below {fringe.bottomPx}px</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      value={fringe.bottomPx}
                      onInput={(event) =>
                        setFringe((current) => ({
                          ...current,
                          bottomPx: Number((event.target as HTMLInputElement).value),
                        }))
                      }
                    />
                  </label>
                  <button type="button" disabled={remasking} onClick={() => void reprocess()}>
                    {remasking ? 'Applying…' : 'Apply mask · $0'}
                  </button>
                  <small>{formatTime(hydration.elapsedMs)}</small>
                </div>
              </div>
              <div class="ldl-hydration-grid">
                <figure>
                  {hydration.normalizedUrl && (
                    <img src={hydration.normalizedUrl} alt="Normalized raw hydration" />
                  )}
                  <figcaption>RAW HYDRATION · UNTRUSTED</figcaption>
                </figure>
                <figure class="checker">
                  {hydration.exactUrl && (
                    <img src={hydration.exactUrl} alt="Terrain clipped to exact collision" />
                  )}
                  <figcaption>EXACT COLLISION CLIP</figcaption>
                </figure>
                <figure class="checker">
                  {hydration.safeUrl && (
                    <img src={hydration.safeUrl} alt="Terrain with bounded decorative fringe" />
                  )}
                  <figcaption>FRINGE-SAFE TERRAIN</figcaption>
                </figure>
                <figure class="heatmap">
                  {hydration.visualMaskUrl && (
                    <img src={hydration.visualMaskUrl} alt="Hard collision and visual fringe mask" />
                  )}
                  <figcaption>RENDER MASK</figcaption>
                </figure>
                <figure class="heatmap">
                  {hydration.mismatchUrl && (
                    <img src={hydration.mismatchUrl} alt="Hydration mismatch heatmap" />
                  )}
                  <figcaption>MISMATCH HEATMAP</figcaption>
                </figure>
              </div>
              <div class="ldl-hydration-metrics">
                <span>
                  <small>ACCEPTED SOURCE PAINT</small>
                  <b>{percent(hydration.metrics?.acceptedPaintRatio)}</b>
                </span>
                <span>
                  <small>REJECTED SOURCE PAINT</small>
                  <b>{percent(hydration.metrics?.rejectedPaintRatio)}</b>
                </span>
                <span>
                  <small>COLLISION COVERAGE</small>
                  <b>{percent(hydration.metrics?.collisionCoverageRatio)}</b>
                </span>
                <span>
                  <small>PAINTED AIR OUTSIDE MASK</small>
                  <b>{percent(hydration.metrics?.paintOutsideVisualMaskRatio)}</b>
                </span>
                <span>
                  <small>AUTO-FILLED GAPS</small>
                  <b>{percent(hydration.metrics?.missingTerrainRatio)}</b>
                </span>
                <span>
                  <small>FRINGE UTILIZATION</small>
                  <b>{percent(hydration.metrics?.fringeUsageRatio)}</b>
                </span>
                <span>
                  <small>SURFACES REALIGNED</small>
                  <b>
                    {hydration.metrics?.surfaceAlignment
                      ? `${hydration.metrics.surfaceAlignment.runsShifted ?? 0}/${hydration.metrics.surfaceAlignment.runsDetected ?? 0} · ${(hydration.metrics.surfaceAlignment.meanShiftPx ?? 0).toFixed(1)}px`
                      : '—'}
                  </b>
                </span>
                <span>
                  <small>VISUAL BUFFER</small>
                  <b>
                    {hydration.metrics?.fringe
                      ? `${hydration.metrics.fringe.topPx ?? 0}↑ ${hydration.metrics.fringe.sidePx ?? 0}↔ ${hydration.metrics.fringe.bottomPx ?? 0}↓`
                      : '—'}
                  </b>
                </span>
                <span>
                  <small>RUNTIME COLLISION</small>
                  <b>{hydration.metrics?.exactCollisionMask ? 'EXACT' : 'CHECK'}</b>
                </span>
              </div>
              <PromptDisclosure title="Exact Muse Image hydration prompt" prompt={hydrationPrompt} />
              {hydration.rawUrl && (
                <details class="ldl-disclosure">
                  <summary>Original provider output</summary>
                  <img src={hydration.rawUrl} alt="Original Muse Image hydration output" />
                </details>
              )}
            </section>
          )}

          <section class="ldl-section">
            <div class="ldl-heading">
              <div>
                <h2>Realtime pipeline log</h2>
                <p>Every model call, parser decision, repair, and paid hydration action.</p>
              </div>
              {imageCalls > 0 && (
                <span>
                  {imageCalls} image calls · {judgeCalls} Spark call{judgeCalls === 1 ? '' : 's'} · $
                  {(totalCost ?? imageCost + (judgeCost ?? 0)).toFixed(3)}
                </span>
              )}
            </div>
            <ol class="ldl-log">
              {events.map((event) => (
                <li class={event.status} key={event.seq}>
                  <time>{new Date(event.at).toLocaleTimeString()}</time>
                  <span>{event.stage}</span>
                  <p>{event.message}</p>
                  <em>{formatTime(event.elapsedMs)}</em>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
