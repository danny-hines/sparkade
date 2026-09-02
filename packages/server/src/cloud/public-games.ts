import type { JobEvent, PublicGameLink } from '@sparkade/shared';
import type { SseHub } from '../pipeline/sse';
import type { Db } from '../storage/db';

const PUBLIC_ID_PATTERN = /^[2-9bcdfghjkmnpqrstvwxyz]{7}$/;
const REQUEST_TIMEOUT_MS = 4_000;
const PROGRESS_UPDATE_INTERVAL_MS = 5_000;
const DEFAULT_KIOSK_NAME = 'Sparkade Cabinet';
const PUBLIC_GAME_LINKS_SETTING = 'public-game-links-v1';

type GameLookup = Pick<Db, 'getGame'> & Partial<Pick<Db, 'getSetting' | 'setSetting'>>;
type Fetch = typeof fetch;

type PublicStatusUpdate = {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  stage: string;
  message: string;
  title?: string;
};

export class PublicGamePublisher {
  private readonly linksByGameId = new Map<string, PublicGameLink>();
  private readonly trackedJobs = new Set<string>();

  constructor(
    private readonly origin: string,
    private readonly apiKey: string,
    private readonly kioskName: string,
    private readonly db: GameLookup,
    private readonly hub: SseHub,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const persisted = this.db.getSetting
      ? this.db.getSetting<unknown>(PUBLIC_GAME_LINKS_SETTING)
      : null;
    if (typeof persisted !== 'object' || persisted === null || Array.isArray(persisted)) return;
    for (const [gameId, publicId] of Object.entries(persisted)) {
      if (typeof publicId === 'string' && PUBLIC_ID_PATTERN.test(publicId)) {
        this.linksByGameId.set(gameId, this.linkForId(publicId));
      }
    }
  }

  linkForGame(gameId: string): PublicGameLink | null {
    return this.linksByGameId.get(gameId) ?? null;
  }

  async reserveAndTrack(jobId: string, gameId: string): Promise<PublicGameLink | null> {
    const existing = this.linkForGame(gameId);
    if (existing) {
      this.track(jobId, gameId, existing.id);
      return existing;
    }

    try {
      const response = await this.request('/api/kiosk/games', {
        method: 'POST',
        body: JSON.stringify({ sourceId: gameId, kioskName: this.kioskName }),
      });
      if (!response.ok) throw new Error(`reservation returned HTTP ${response.status}`);
      const payload = (await response.json()) as { game?: { id?: unknown } };
      const id = typeof payload.game?.id === 'string' ? payload.game.id.toLowerCase() : '';
      if (!PUBLIC_ID_PATTERN.test(id)) throw new Error('reservation returned an invalid game ID');
      const link = this.linkForId(id);
      this.linksByGameId.set(gameId, link);
      this.db.setSetting?.(
        PUBLIC_GAME_LINKS_SETTING,
        Object.fromEntries(
          [...this.linksByGameId].map(([sourceId, publicGame]) => [sourceId, publicGame.id]),
        ),
      );
      this.track(jobId, gameId, id);
      return link;
    } catch (error) {
      console.warn(
        'could not reserve public game link; local generation will continue:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  private linkForId(id: string): PublicGameLink {
    return { id, url: new URL(`/p/${id}`, this.origin).toString() };
  }

  private track(jobId: string, gameId: string, publicId: string): void {
    if (this.trackedJobs.has(jobId)) return;
    this.trackedJobs.add(jobId);
    let pending = Promise.resolve();
    let unsubscribe = () => {};
    let subscribed = false;
    let terminalBeforeSubscribe = false;
    let lastProgressSentAt = 0;
    let latestProgress: PublicStatusUpdate | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    const enqueue = (update: PublicStatusUpdate, attempts: number, terminal: boolean) => {
      pending = pending
        .then(() => this.publishUpdate(publicId, gameId, update, attempts))
        .catch((error) => {
          console.warn(
            `could not publish ${terminal ? 'terminal ' : ''}game status for ${publicId}:`,
            error instanceof Error ? error.message : error,
          );
        });
    };
    const listener = (event: JobEvent) => {
      const update = this.updateForEvent(event, gameId);
      if (!update) return;
      const terminal = update.status === 'ready' || update.status === 'failed';
      if (terminal) {
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = null;
        latestProgress = null;
        enqueue(update, 3, true);
        if (subscribed) unsubscribe();
        else terminalBeforeSubscribe = true;
        this.trackedJobs.delete(jobId);
        return;
      }

      latestProgress = update;
      const remaining = PROGRESS_UPDATE_INTERVAL_MS - (Date.now() - lastProgressSentAt);
      if (remaining <= 0) {
        lastProgressSentAt = Date.now();
        latestProgress = null;
        enqueue(update, 1, false);
      } else if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (!latestProgress) return;
          const next = latestProgress;
          latestProgress = null;
          lastProgressSentAt = Date.now();
          enqueue(next, 1, false);
        }, remaining);
        progressTimer.unref?.();
      }
    };
    unsubscribe = this.hub.subscribe(jobId, listener);
    subscribed = true;
    if (terminalBeforeSubscribe) unsubscribe();
  }

  private updateForEvent(event: JobEvent, gameId: string): PublicStatusUpdate | null {
    if (event.type === 'feed') return null;
    if (event.type === 'done') {
      const title = this.db.getGame(gameId)?.title;
      return {
        status: 'ready',
        stage: 'done',
        message: title ? `${title} is ready to play` : 'Your game is ready to play',
        ...(title ? { title } : {}),
      };
    }
    if (event.type === 'failed') {
      return {
        status: 'failed',
        stage: event.stage,
        message: 'Generation paused on the cabinet. This link will update after a retry.',
      };
    }
    return {
      status: event.stage === 'queued' ? 'queued' : 'generating',
      stage: event.stage,
      message: event.detail,
    };
  }

  private async publishUpdate(
    publicId: string,
    gameId: string,
    update: PublicStatusUpdate,
    attempts: number,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.request(`/api/kiosk/games/${publicId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            sourceId: gameId,
            status: update.status,
            stage: update.stage.slice(0, 80),
            message: update.message.slice(0, 500),
            ...(update.title ? { title: update.title.slice(0, 120) } : {}),
          }),
        });
        if (!response.ok) throw new Error(`status update returned HTTP ${response.status}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 350));
        }
      }
    }
    throw lastError;
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(new URL(path, this.origin), {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

export function createPublicGamePublisher(db: Db, hub: SseHub): PublicGamePublisher | null {
  const configuredOrigin = process.env.SPARKADE_PUBLIC_ORIGIN?.trim();
  const apiKey = process.env.SPARKADE_KIOSK_API_KEY?.trim();
  const kioskName =
    process.env.SPARKADE_KIOSK_NAME?.trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_KIOSK_NAME;
  if (!configuredOrigin || !apiKey) return null;
  try {
    const origin = new URL(configuredOrigin);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return null;
    origin.pathname = '/';
    origin.search = '';
    origin.hash = '';
    return new PublicGamePublisher(origin.toString(), apiKey, kioskName, db, hub);
  } catch {
    console.warn('SPARKADE_PUBLIC_ORIGIN is invalid; public game links are disabled');
    return null;
  }
}
