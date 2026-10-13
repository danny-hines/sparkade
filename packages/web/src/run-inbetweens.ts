// Run in-betweens for generated platformer players, made on the device from
// the three run frames every game already ships: a worker computes them in the
// background (seconds on a Pi 3) and IndexedDB caches them per frame set, so a
// game never waits and later loads are instant. Any failure resolves to null
// and the game keeps its original three-frame run.
import {
  RUN_INBETWEEN_VERSION,
  type RgbaFrame,
  type RunInbetweenPose,
} from '@sparkade/shared/run-inbetweens';

export type RunInbetweenImages = Readonly<Record<RunInbetweenPose, CanvasImageSource>>;

const DB_NAME = 'sparkade-run-inbetweens';
const STORE = 'frames';
const WORKER_TIMEOUT_MS = 60_000;
const pending = new Map<string, Promise<RunInbetweenImages | null>>();

type SizedImage = CanvasImageSource & {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number | SVGAnimatedLength;
  height?: number | SVGAnimatedLength;
};

function pixels(image: SizedImage): RgbaFrame {
  const width = image.naturalWidth || Number(image.width);
  const height = image.naturalHeight || Number(image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** FNV-1a over the algorithm version and every frame's size and pixels. */
export function runInbetweenCacheKey(frames: readonly RgbaFrame[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const value of [RUN_INBETWEEN_VERSION, ...frames.flatMap((f) => [f.width, f.height])]) {
    mix(value);
    mix(value >> 8);
  }
  for (const frame of frames) for (let i = 0; i < frame.data.length; i++) mix(frame.data[i]!);
  return `v${RUN_INBETWEEN_VERSION}-${hash.toString(16).padStart(8, '0')}`;
}

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cached(key: string): Promise<RunInbetweenImages | null> {
  const db = await openCache();
  if (!db || typeof createImageBitmap === 'undefined') return null;
  const value = await new Promise<Record<RunInbetweenPose, Blob> | undefined>((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () =>
        resolve(request.result as Record<RunInbetweenPose, Blob> | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  db.close();
  if (!value?.runMid1 || !value.runMid2) return null;
  const [runMid1, runMid2] = await Promise.all([
    createImageBitmap(value.runMid1),
    createImageBitmap(value.runMid2),
  ]);
  return { runMid1, runMid2 };
}

async function store(key: string, canvases: Record<RunInbetweenPose, HTMLCanvasElement>) {
  const blob = (canvas: HTMLCanvasElement) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const [runMid1, runMid2] = await Promise.all([blob(canvases.runMid1), blob(canvases.runMid2)]);
  const db = await openCache();
  if (!db || !runMid1 || !runMid2) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ runMid1, runMid2 }, key);
  } catch {
    // A full or unavailable cache only costs a recompute next time.
  }
  db.close();
}

function compute(frames: { walk1: RgbaFrame; sideIdle: RgbaFrame; walk2: RgbaFrame }) {
  return new Promise<Record<RunInbetweenPose, RgbaFrame>>((resolve, reject) => {
    const worker = new Worker(new URL('./run-inbetweens.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('timed out'));
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const message = event.data as
        { ok: true; runMid1: RgbaFrame; runMid2: RgbaFrame } | { ok: false; error: string };
      if (message.ok) resolve({ runMid1: message.runMid1, runMid2: message.runMid2 });
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || 'worker failed'));
    };
    worker.postMessage(frames);
  });
}

function canvasFor(frame: RgbaFrame): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
      0,
      0,
    );
  return canvas;
}

/** Background in-betweens for a loaded generated pose set, or null when the
 * environment lacks workers, the poses are incomplete, or anything fails. */
export function loadRunInbetweens(
  poses: Readonly<Record<string, CanvasImageSource>>,
): Promise<RunInbetweenImages | null> | null {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return null;
  const { walk1, sideIdle, walk2 } = poses;
  if (!walk1 || !sideIdle || !walk2) return null;
  let frames: { walk1: RgbaFrame; sideIdle: RgbaFrame; walk2: RgbaFrame };
  let key: string;
  try {
    frames = { walk1: pixels(walk1), sideIdle: pixels(sideIdle), walk2: pixels(walk2) };
    key = runInbetweenCacheKey([frames.walk1, frames.sideIdle, frames.walk2]);
  } catch {
    return null;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    const hit = await cached(key).catch(() => null);
    if (hit) return hit;
    const started = performance.now();
    const result = await compute(frames);
    const canvases = { runMid1: canvasFor(result.runMid1), runMid2: canvasFor(result.runMid2) };
    console.info(
      `[sparkade] run in-betweens ready in ${Math.round(performance.now() - started)} ms`,
    );
    void store(key, canvases).catch(() => undefined);
    return canvases;
  })().catch((error: unknown) => {
    console.warn('[sparkade] run in-betweens unavailable:', error);
    pending.delete(key);
    return null;
  });
  pending.set(key, task);
  return task;
}
