import type { GenerationFeedEvent, JobRecord, PriceRow, SparkadeConfig } from '@sparkade/shared';
import type { Db, GameRow, RepairEvent } from '../storage/db';
import type { PipelineStore } from './durable';

export interface PipelineState {
  config?: SparkadeConfig;
  job: JobRecord | null;
  game: GameRow | null;
  pricing: Record<string, PriceRow>;
  imagePricing: { model: string; perImageUsd: number | null } | null;
  usage: Array<Parameters<Db['insertUsage']>[0] & { at: string; cachedTokens: number }>;
  repairs: RepairEvent[];
  events: GenerationFeedEvent[];
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Serializable per-job state. Neon owns its durable copy; no SQLite in cloud steps. */
export class JobState implements PipelineStore {
  constructor(
    readonly state: PipelineState = {
      job: null,
      game: null,
      pricing: {},
      imagePricing: null,
      usage: [],
      repairs: [],
      events: [],
    },
  ) {}
  getJob = (id: string) =>
    this.state.job?.id === id ? { ...this.state.job, costSoFarUsd: this.gameCost() } : null;
  getJobForGame = (id: string) =>
    this.state.job?.gameId === id ? this.getJob(this.state.job.id) : null;
  getJobByIdempotencyKey = (key: string) =>
    this.state.job?.idempotencyKey === key ? this.getJob(this.state.job.id) : null;
  listJobs = () => (this.state.job ? [this.getJob(this.state.job.id)!] : []);
  getGame = (id: string) => (this.state.game?.id === id ? { ...this.state.game } : null);
  listGames = () => (this.state.game ? [{ ...this.state.game }] : []);
  insertJob: Db['insertJob'] = (job, prices, imagePrices) => {
    this.state.job = { ...job };
    this.state.pricing = prices as Record<string, PriceRow>;
    this.state.imagePricing = imagePrices ?? null;
  };
  updateJob: Db['updateJob'] = (id, fields) => {
    if (this.state.job?.id === id) Object.assign(this.state.job, fields);
  };
  upsertGame: Db['upsertGame'] = (game) => {
    this.state.game = { ...game };
  };
  setGameStatus: Db['setGameStatus'] = (id, status, failure) => {
    if (this.state.game?.id === id)
      Object.assign(this.state.game, { status, failure: failure ?? null });
  };
  setGameCost: Db['setGameCost'] = (id, costUsd) => {
    if (this.state.game?.id === id) this.state.game.costUsd = costUsd;
  };
  resetGameForRetry: Db['resetGameForRetry'] = (id, title) => {
    if (this.state.game?.id === id)
      Object.assign(this.state.game, { title, status: 'queued', failure: null, cover: null });
  };
  reconcileInterruptedJobs = () => [];
  jobPriceSnapshot = () => this.state.pricing;
  jobImagePriceSnapshot = () => this.state.imagePricing;
  insertUsage: Db['insertUsage'] = (event) => {
    if (event.requestId && this.state.usage.some((u) => u.requestId === event.requestId)) return;
    this.state.usage.push({
      ...event,
      cachedTokens: event.cachedTokens ?? 0,
      at: new Date().toISOString(),
    });
  };
  gameCost = () =>
    this.state.usage.some((u) => u.costUsd === null)
      ? null
      : this.state.usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
  usageForGame = () => this.state.usage;
  repairEventsForJob = () => this.state.repairs;
  insertRepairEvent: Db['insertRepairEvent'] = (event) => {
    this.state.repairs.push({
      ...event,
      patch: event.patch ?? null,
      id: this.state.repairs.length + 1,
      at: new Date().toISOString(),
    });
  };
  appendGenerationEvent: Db['appendGenerationEvent'] = (event) => {
    // Replaying completed deterministic work must not duplicate the progress feed.
    // Stored events come back from Postgres JSONB with reordered payload keys.
    const payload = canonicalJson(event.payload);
    const prior = this.state.events.find(
      (e) =>
        e.attempt === event.attempt &&
        e.kind === event.kind &&
        e.stage === event.stage &&
        e.message === event.message &&
        canonicalJson(e.payload) === payload,
    );
    if (prior) return prior;
    const added = { ...event, id: this.state.events.length + 1, at: new Date().toISOString() };
    this.state.events.push(added);
    return added;
  };
}
