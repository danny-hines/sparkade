import type {
  GameSpec,
  JobEvent,
  KioskRegistrationStatus,
  PublicGameLink,
  PublicGamePublication,
  PublicGamePublicationStatus,
} from '@sparkade/shared';
import type { SseHub } from '../pipeline/sse';
import type { Db } from '../storage/db';
import type { PublicGameAsset } from '../storage/files';
import { KioskRegistration } from './kiosk-registration';
import { preparePublicGameAsset } from './public-game-assets';

const PUBLIC_ID_PATTERN = /^[2-9bcdfghjkmnpqrstvwxyz]{7}$/;
const REQUEST_TIMEOUT_MS = 4_000;
const ASSET_UPLOAD_TIMEOUT_MS = 60_000;
const ASSET_UPLOAD_CONCURRENCY = 4;
const PROGRESS_UPDATE_INTERVAL_MS = 5_000;
const DEFAULT_KIOSK_NAME = 'Sparkade Cabinet';
const PUBLIC_GAME_LINKS_SETTING = 'public-game-links-v1';
const PUBLIC_GAME_PUBLICATIONS_SETTING = 'public-game-publications-v2';

type GameLookup = Pick<Db, 'getGame'> & Partial<Pick<Db, 'getSetting' | 'setSetting'>>;
type Fetch = typeof fetch;

type PublicStatusUpdate = {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  stage: string;
  message: string;
  title?: string;
  spec?: GameSpec;
  assets?: PublicGameAsset[];
};

export class PublicGamePublisher {
  private readonly publicationsByGameId = new Map<string, PublicGamePublication>();
  private readonly existingPublishTasks = new Map<string, Promise<void>>();
  private readonly trackedJobs = new Set<string>();

  constructor(
    private readonly origin: string,
    private readonly apiKey: string | (() => string | null),
    private readonly kioskName: string | (() => string | null),
    private readonly db: GameLookup,
    private readonly hub: SseHub,
    private readonly fetchImpl: Fetch = fetch,
    private readonly specForGame: (gameId: string) => GameSpec | null = () => null,
    private readonly assetsForGame: (gameId: string) => PublicGameAsset[] = () => [],
    private readonly registration?: KioskRegistration,
  ) {
    if (!this.restorePublications()) this.restoreLegacyLinks();
  }

  linkForGame(gameId: string): PublicGameLink | null {
    return this.publicationsByGameId.get(gameId)?.link ?? null;
  }

  publicationForGame(gameId: string): PublicGamePublication | null {
    return this.publicationsByGameId.get(gameId) ?? null;
  }

  registrationStatus(): KioskRegistrationStatus {
    return (
      this.registration?.status() ?? {
        state: this.resolveApiKey() ? 'registered' : 'unregistered',
        origin: this.origin,
        name: this.resolveKioskName() ?? undefined,
      }
    );
  }

  refreshRegistration(): Promise<KioskRegistrationStatus> {
    return this.registration?.refresh() ?? Promise.resolve(this.registrationStatus());
  }

  startPairing(forceNewCredential = false): Promise<KioskRegistrationStatus> {
    return (
      this.registration?.startPairing(forceNewCredential) ??
      Promise.resolve(this.registrationStatus())
    );
  }

  async reserveAndTrack(jobId: string, gameId: string): Promise<PublicGameLink | null> {
    try {
      const link = await this.reserveLink(gameId);
      this.track(jobId, gameId, link.id);
      return link;
    } catch (error) {
      console.warn(
        'could not reserve public game link; local generation will continue:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /** Begin publishing an already-finished local game and return once its short URL is reserved. */
  async publishExisting(gameId: string): Promise<PublicGamePublication> {
    const row = this.db.getGame(gameId);
    if (!row || row.status !== 'ready') throw new Error('only ready games can be published');
    const spec = this.specForGame(gameId);
    if (!spec) throw new Error('game spec is unavailable');

    const current = this.publicationForGame(gameId);
    if (current?.status === 'published') return current;
    if (this.existingPublishTasks.has(gameId) && current) return current;

    const link = await this.reserveLink(gameId);
    this.setPublication(gameId, link, 'publishing');
    const update: PublicStatusUpdate = {
      status: 'ready',
      stage: 'done',
      message: `${row.title} is ready to play`,
      title: row.title,
      spec,
      assets: this.assetsForGame(gameId),
    };
    const task = this.publishUpdate(link.id, gameId, update, 3)
      .then(() => this.setPublication(gameId, link, 'published'))
      .catch((error) => {
        this.setPublication(gameId, link, 'failed');
        console.warn(
          `could not publish existing game ${link.id}:`,
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => this.existingPublishTasks.delete(gameId));
    this.existingPublishTasks.set(gameId, task);
    return this.publicationForGame(gameId)!;
  }

  private restorePublications(): boolean {
    const persisted = this.db.getSetting
      ? this.db.getSetting<unknown>(PUBLIC_GAME_PUBLICATIONS_SETTING)
      : null;
    if (typeof persisted !== 'object' || persisted === null || Array.isArray(persisted))
      return false;
    let restored = false;
    let interrupted = false;
    for (const [gameId, value] of Object.entries(persisted)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.toLowerCase() : '';
      const status = record.status;
      if (PUBLIC_ID_PATTERN.test(id) && this.isPublicationStatus(status)) {
        // Upload work lives in this process. After a restart, a persisted spinner
        // must become retryable instead of claiming that work is still running.
        this.publicationsByGameId.set(gameId, {
          status: status === 'publishing' ? 'failed' : status,
          link: this.linkForId(id),
        });
        if (status === 'publishing') interrupted = true;
        restored = true;
      }
    }
    if (interrupted) this.persistPublications();
    return restored;
  }

  private restoreLegacyLinks(): void {
    const persisted = this.db.getSetting
      ? this.db.getSetting<unknown>(PUBLIC_GAME_LINKS_SETTING)
      : null;
    if (typeof persisted !== 'object' || persisted === null || Array.isArray(persisted)) return;
    for (const [gameId, publicId] of Object.entries(persisted)) {
      if (typeof publicId !== 'string' || !PUBLIC_ID_PATTERN.test(publicId)) continue;
      const status: PublicGamePublicationStatus =
        this.db.getGame(gameId)?.status === 'ready' ? 'published' : 'publishing';
      this.publicationsByGameId.set(gameId, {
        status,
        link: this.linkForId(publicId),
      });
    }
    if (this.publicationsByGameId.size > 0) this.persistPublications();
  }

  private isPublicationStatus(value: unknown): value is PublicGamePublicationStatus {
    return value === 'publishing' || value === 'published' || value === 'failed';
  }

  private persistPublications(): void {
    this.db.setSetting?.(
      PUBLIC_GAME_PUBLICATIONS_SETTING,
      Object.fromEntries(
        [...this.publicationsByGameId].map(([gameId, publication]) => [
          gameId,
          { id: publication.link.id, status: publication.status },
        ]),
      ),
    );
  }

  private setPublication(
    gameId: string,
    link: PublicGameLink,
    status: PublicGamePublicationStatus,
  ): void {
    this.publicationsByGameId.set(gameId, { status, link });
    this.persistPublications();
  }

  private async reserveLink(gameId: string): Promise<PublicGameLink> {
    const existing = this.linkForGame(gameId);
    if (existing) return existing;
    const response = await this.request('/api/kiosk/games', {
      method: 'POST',
      body: JSON.stringify({ sourceId: gameId, kioskName: this.resolveKioskName() ?? undefined }),
    });
    if (!response.ok) throw new Error(`reservation returned HTTP ${response.status}`);
    const payload = (await response.json()) as { game?: { id?: unknown } };
    const id = typeof payload.game?.id === 'string' ? payload.game.id.toLowerCase() : '';
    if (!PUBLIC_ID_PATTERN.test(id)) throw new Error('reservation returned an invalid game ID');
    const link = this.linkForId(id);
    this.setPublication(gameId, link, 'publishing');
    return link;
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
        .then(() => {
          if (!terminal) return;
          const link = this.linkForId(publicId);
          this.setPublication(gameId, link, update.status === 'ready' ? 'published' : 'failed');
        })
        .catch((error) => {
          if (terminal) this.setPublication(gameId, this.linkForId(publicId), 'failed');
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
      const spec = this.specForGame(gameId);
      const assets = this.assetsForGame(gameId);
      return {
        status: 'ready',
        stage: 'done',
        message: title ? `${title} is ready to play` : 'Your game is ready to play',
        ...(title ? { title } : {}),
        ...(spec ? { spec } : {}),
        ...(assets.length ? { assets } : {}),
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
    const preparedAssets = update.assets
      ? await Promise.all(update.assets.map(preparePublicGameAsset))
      : undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const assets: Record<string, string> = {};
        if (preparedAssets) {
          for (let index = 0; index < preparedAssets.length; index += ASSET_UPLOAD_CONCURRENCY) {
            const batch = preparedAssets.slice(index, index + ASSET_UPLOAD_CONCURRENCY);
            const uploaded = await Promise.all(
              batch.map((asset) => this.uploadAsset(publicId, asset)),
            );
            for (const result of uploaded) assets[result.filename] = result.url;
          }
        }
        const response = await this.request(`/api/kiosk/games/${publicId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            sourceId: gameId,
            status: update.status,
            stage: update.stage.slice(0, 80),
            message: update.message.slice(0, 500),
            ...(update.title ? { title: update.title.slice(0, 120) } : {}),
            ...(update.spec ? { spec: update.spec } : {}),
            ...(Object.keys(assets).length ? { assets } : {}),
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
    const apiKey = this.resolveApiKey();
    if (!apiKey) return Promise.reject(new Error('cabinet is not registered'));
    return this.fetchImpl(new URL(path, this.origin), {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async uploadAsset(
    publicId: string,
    asset: PublicGameAsset,
  ): Promise<{ filename: string; url: string }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) throw new Error('cabinet is not registered');
    const response = await this.fetchImpl(
      new URL(
        `/api/kiosk/games/${publicId}/assets/${encodeURIComponent(asset.filename)}`,
        this.origin,
      ),
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'image/png',
          'content-length': String(asset.content.byteLength),
        },
        body: Uint8Array.from(asset.content),
        signal: AbortSignal.timeout(ASSET_UPLOAD_TIMEOUT_MS),
      },
    );
    if (!response.ok)
      throw new Error(
        `asset upload for ${asset.filename} returned HTTP ${response.status}${response.status === 404 ? ' (the cloud deployment may not support this asset yet)' : ''}`,
      );
    const payload = (await response.json()) as { filename?: unknown; url?: unknown };
    if (payload.filename !== asset.filename || typeof payload.url !== 'string') {
      throw new Error('asset upload returned an invalid response');
    }
    return { filename: asset.filename, url: payload.url };
  }

  private resolveApiKey(): string | null {
    const value = typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey;
    return value?.trim() || null;
  }

  private resolveKioskName(): string | null {
    const value = typeof this.kioskName === 'function' ? this.kioskName() : this.kioskName;
    return value?.trim() || null;
  }
}

export function createPublicGamePublisher(
  db: Db,
  hub: SseHub,
  specForGame: (gameId: string) => GameSpec | null,
  assetsForGame: (gameId: string) => PublicGameAsset[],
  registrationDataDir: string,
): PublicGamePublisher | null {
  const configuredOrigin = process.env.SPARKADE_PUBLIC_ORIGIN;
  const originValue =
    configuredOrigin === undefined ? 'https://sparkade.dev' : configuredOrigin.trim();
  const apiKey = process.env.SPARKADE_KIOSK_API_KEY?.trim() || undefined;
  const kioskName =
    process.env.SPARKADE_KIOSK_NAME?.trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_KIOSK_NAME;
  if (!originValue) return null;
  try {
    const origin = new URL(originValue);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return null;
    origin.pathname = '/';
    origin.search = '';
    origin.hash = '';
    const registration = new KioskRegistration(
      origin.toString(),
      registrationDataDir,
      fetch,
      apiKey ? { apiKey, kioskName } : undefined,
    );
    return new PublicGamePublisher(
      origin.toString(),
      () => registration.authorizationToken(),
      () => registration.kioskName(),
      db,
      hub,
      fetch,
      specForGame,
      assetsForGame,
      registration,
    );
  } catch {
    console.warn('SPARKADE_PUBLIC_ORIGIN is invalid; public game links are disabled');
    return null;
  }
}
