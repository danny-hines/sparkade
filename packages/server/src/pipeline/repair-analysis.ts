/**
 * Read-only repair reliability analysis. This module never opens the primary
 * database writable and never rewrites a game or checkpoint. It is shared by
 * the CLI and tests so the offline report remains a repeatable evaluation,
 * rather than an ad-hoc query against one developer's library.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { archetypes } from '@sparkade/archetypes';
import type { ArchetypeId, DesignDoc, GameSpec, LintError } from '@sparkade/shared';
import type { RepairEvent } from '../storage/db';
import type { RawStageCheckpoint, RawStageName } from '../storage/files';
import { compileTileRunsStage } from './tile-runs';
import * as validation from './validate';

export interface CountEntry {
  key: string;
  count: number;
}

export interface NormalizationFix {
  code: string;
  path: string;
  message: string;
}

export type GeneratedSpecNormalizer = (spec: GameSpec) => {
  spec: GameSpec;
  fixes: NormalizationFix[];
};

export interface NormalizationComparison {
  source: 'published' | 'checkpoint';
  gameId: string;
  archetype: string;
  jobId?: string;
  attempt?: number;
  checkpointRevisions?: Partial<Record<RawStageName, number>>;
  diagnosticsBefore: LintError[];
  diagnosticsAfter: LintError[];
  fixes: NormalizationFix[];
  changed: boolean;
  error?: string;
}

export interface RepairAnalysisReport {
  generatedAt: string;
  dataDir: string;
  sources: {
    publishedGames: number;
    checkpointSnapshots: number;
    repairEvents: number;
  };
  repairs: {
    jobs: number;
    games: number;
    events: number;
    diagnosticsBefore: number;
    diagnosticsAfter: number;
    byArchetype: CountEntry[];
    byOwner: CountEntry[];
    byCode: CountEntry[];
    unresolvedByCode: CountEntry[];
    byAction: CountEntry[];
    byOutcome: CountEntry[];
  };
  normalization: {
    enabled: boolean;
    evaluatedSpecs: number;
    changedSpecs: number;
    erroredSpecs: number;
    totalFixes: number;
    diagnosticsBefore: number;
    diagnosticsAfter: number;
    byFixCode: CountEntry[];
    comparisons: NormalizationComparison[];
  };
}

export interface RepairAnalysisOptions {
  /** Omit to use normalizeGeneratedSpec when that export is available. */
  normalizer?: GeneratedSpecNormalizer | null;
  includePublished?: boolean;
  includeCheckpoints?: boolean;
  now?: () => string;
}

interface JobAnalysisRow {
  id: string;
  gameId: string;
  status: string;
  seed: number;
  requestedArchetype: ArchetypeId | null;
}

interface AnalysisDataset {
  events: RepairEvent[];
  jobs: Map<string, JobAnalysisRow>;
  gameArchetypes: Map<string, string>;
  published: { gameId: string; spec: GameSpec }[];
  checkpoints: {
    gameId: string;
    jobId: string;
    attempt: number;
    revisions: Partial<Record<RawStageName, number>>;
    spec: GameSpec;
  }[];
}

const bundledNormalizer = (
  validation as unknown as { normalizeGeneratedSpec?: GeneratedSpecNormalizer }
).normalizeGeneratedSpec;

/** Scan a Sparkade data directory and return aggregate repair evidence. */
export function analyzeRepairData(
  dir: string,
  options: RepairAnalysisOptions = {},
): RepairAnalysisReport {
  const dataset = loadAnalysisDataset(dir, options);
  const normalizer = options.normalizer === undefined ? bundledNormalizer : options.normalizer;
  const archetypeByGame = dataset.gameArchetypes;

  const byArchetype = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const byCode = new Map<string, number>();
  const unresolvedByCode = new Map<string, number>();
  const byAction = new Map<string, number>();
  const byOutcome = new Map<string, number>();
  const lastOwnerState = new Map<string, { jobId: string; diagnostics: LintError[] }>();
  const jobs = new Set<string>();
  const games = new Set<string>();
  let diagnosticsBefore = 0;
  let diagnosticsAfter = 0;

  for (const event of dataset.events) {
    jobs.add(event.jobId);
    games.add(event.gameId);
    increment(byArchetype, archetypeByGame.get(event.gameId) ?? 'unknown');
    increment(byOwner, event.owner || 'unknown');
    increment(byAction, event.action || 'unknown');
    increment(byOutcome, event.outcome || 'unknown');
    diagnosticsBefore += event.diagnosticsBefore.length;
    diagnosticsAfter += event.diagnosticsAfter.length;
    for (const diagnostic of event.diagnosticsBefore)
      increment(byCode, diagnostic.code || 'unknown');
    lastOwnerState.set(`${event.jobId}\u0000${event.owner}`, {
      jobId: event.jobId,
      diagnostics: [...event.diagnosticsAfter],
    });
  }
  for (const state of lastOwnerState.values()) {
    if (dataset.jobs.get(state.jobId)?.status === 'done') continue;
    for (const diagnostic of state.diagnostics) {
      increment(unresolvedByCode, diagnostic.code || 'unknown');
    }
  }

  const comparisons: NormalizationComparison[] = [];
  if (normalizer) {
    for (const game of dataset.published) {
      comparisons.push(
        compareNormalization(game.spec, normalizer, {
          source: 'published',
          gameId: game.gameId,
          archetype: game.spec.archetype,
        }),
      );
    }
    for (const checkpoint of dataset.checkpoints) {
      comparisons.push(
        compareNormalization(checkpoint.spec, normalizer, {
          source: 'checkpoint',
          gameId: checkpoint.gameId,
          jobId: checkpoint.jobId,
          attempt: checkpoint.attempt,
          checkpointRevisions: checkpoint.revisions,
          archetype: checkpoint.spec.archetype,
        }),
      );
    }
  }

  const byFixCode = new Map<string, number>();
  for (const comparison of comparisons) {
    for (const fix of comparison.fixes) increment(byFixCode, fix.code || 'unknown');
  }

  return {
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    dataDir: dir,
    sources: {
      publishedGames: dataset.published.length,
      checkpointSnapshots: dataset.checkpoints.length,
      repairEvents: dataset.events.length,
    },
    repairs: {
      jobs: jobs.size,
      games: games.size,
      events: dataset.events.length,
      diagnosticsBefore,
      diagnosticsAfter,
      byArchetype: sortedCounts(byArchetype),
      byOwner: sortedCounts(byOwner),
      byCode: sortedCounts(byCode),
      unresolvedByCode: sortedCounts(unresolvedByCode),
      byAction: sortedCounts(byAction),
      byOutcome: sortedCounts(byOutcome),
    },
    normalization: {
      enabled: !!normalizer,
      evaluatedSpecs: comparisons.length,
      changedSpecs: comparisons.filter((comparison) => comparison.changed).length,
      erroredSpecs: comparisons.filter((comparison) => comparison.error).length,
      totalFixes: comparisons.reduce((sum, comparison) => sum + comparison.fixes.length, 0),
      diagnosticsBefore: comparisons.reduce(
        (sum, comparison) => sum + comparison.diagnosticsBefore.length,
        0,
      ),
      diagnosticsAfter: comparisons.reduce(
        (sum, comparison) => sum + comparison.diagnosticsAfter.length,
        0,
      ),
      byFixCode: sortedCounts(byFixCode),
      comparisons,
    },
  };
}

/** Stable human-readable output for terminal use and CI artifacts. */
export function formatRepairAnalysis(report: RepairAnalysisReport): string {
  const lines = [
    'Sparkade repair analysis',
    `Data: ${report.dataDir}`,
    `Sources: ${report.sources.publishedGames} published games, ${report.sources.checkpointSnapshots} checkpoint snapshots, ${report.sources.repairEvents} repair events`,
    '',
    `Repairs: ${report.repairs.events} events across ${report.repairs.jobs} jobs / ${report.repairs.games} games`,
    `Diagnostics: ${report.repairs.diagnosticsBefore} before -> ${report.repairs.diagnosticsAfter} after`,
    formatCounts('By archetype', report.repairs.byArchetype),
    formatCounts('By owner', report.repairs.byOwner),
    formatCounts('By diagnostic code', report.repairs.byCode),
    formatCounts('Unresolved diagnostic code', report.repairs.unresolvedByCode),
    formatCounts('By action', report.repairs.byAction),
    formatCounts('By outcome', report.repairs.byOutcome),
    '',
  ];

  if (!report.normalization.enabled) {
    lines.push('Normalization comparison: unavailable (no normalizer supplied)');
  } else {
    lines.push(
      `Normalization: ${report.normalization.changedSpecs}/${report.normalization.evaluatedSpecs} specs changed, ${report.normalization.totalFixes} deterministic fixes, ${report.normalization.erroredSpecs} errors`,
      `Diagnostics: ${report.normalization.diagnosticsBefore} before -> ${report.normalization.diagnosticsAfter} after`,
      formatCounts('By normalization code', report.normalization.byFixCode),
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function loadAnalysisDataset(dir: string, options: RepairAnalysisOptions): AnalysisDataset {
  const dbRows = loadReadOnlyDatabase(dir);
  const published = options.includePublished === false ? [] : loadPublishedGames(dir);
  const gameArchetypes = new Map(dbRows.gameArchetypes);
  for (const game of published) gameArchetypes.set(game.gameId, game.spec.archetype);
  const checkpoints =
    options.includeCheckpoints === false ? [] : loadCheckpointSnapshots(dir, dbRows.jobs);
  for (const checkpoint of checkpoints)
    gameArchetypes.set(checkpoint.gameId, checkpoint.spec.archetype);
  return { events: dbRows.events, jobs: dbRows.jobs, gameArchetypes, published, checkpoints };
}

function loadReadOnlyDatabase(dir: string): {
  events: RepairEvent[];
  gameArchetypes: Map<string, string>;
  jobs: Map<string, JobAnalysisRow>;
} {
  const path = join(dir, 'sparkade.db');
  const empty = {
    events: [] as RepairEvent[],
    gameArchetypes: new Map<string, string>(),
    jobs: new Map<string, JobAnalysisRow>(),
  };
  if (!existsSync(path)) return empty;

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as unknown as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    if (tables.has('games')) {
      const rows = db.prepare(`SELECT id, archetype FROM games`).all() as unknown as {
        id: string;
        archetype: string;
      }[];
      for (const row of rows) empty.gameArchetypes.set(String(row.id), String(row.archetype));
    }
    if (tables.has('jobs')) {
      const columns = new Set(
        (db.prepare(`PRAGMA table_info(jobs)`).all() as unknown as { name: string }[]).map(
          (row) => row.name,
        ),
      );
      const requested = columns.has('requested_archetype')
        ? 'requested_archetype'
        : 'NULL AS requested_archetype';
      const rows = db
        .prepare(`SELECT id, game_id, status, seed, ${requested} FROM jobs`)
        .all() as unknown as {
        id: string;
        game_id: string;
        status: string;
        seed: number;
        requested_archetype: string | null;
      }[];
      for (const row of rows) {
        empty.jobs.set(String(row.id), {
          id: String(row.id),
          gameId: String(row.game_id),
          status: String(row.status),
          seed: Number(row.seed),
          requestedArchetype: isArchetypeId(row.requested_archetype)
            ? row.requested_archetype
            : null,
        });
      }
    }
    if (tables.has('repair_events')) {
      const rows = db.prepare(`SELECT * FROM repair_events ORDER BY id`).all() as unknown as Record<
        string,
        unknown
      >[];
      empty.events.push(...rows.map(toRepairEventSafe));
    }
    return empty;
  } finally {
    db.close();
  }
}

function loadPublishedGames(dir: string): { gameId: string; spec: GameSpec }[] {
  const gamesDir = join(dir, 'games');
  if (!existsSync(gamesDir)) return [];
  const games: { gameId: string; spec: GameSpec }[] = [];
  for (const entry of readdirSync(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const spec = readJson<GameSpec>(join(gamesDir, entry.name, 'game.json'));
    if (spec && isArchetypeId(spec.archetype)) games.push({ gameId: entry.name, spec });
  }
  return games.sort((a, b) => a.gameId.localeCompare(b.gameId));
}

function loadCheckpointSnapshots(
  dir: string,
  jobs: Map<string, JobAnalysisRow>,
): AnalysisDataset['checkpoints'] {
  const checkpointsDir = join(dir, 'checkpoints');
  if (!existsSync(checkpointsDir)) return [];
  const snapshots: AnalysisDataset['checkpoints'] = [];
  for (const jobEntry of readdirSync(checkpointsDir, { withFileTypes: true })) {
    if (!jobEntry.isDirectory()) continue;
    const job = jobs.get(jobEntry.name);
    if (!job) continue;
    const jobDir = join(checkpointsDir, jobEntry.name);
    for (const attemptEntry of readdirSync(jobDir, { withFileTypes: true })) {
      const match = attemptEntry.isDirectory() ? /^attempt-(\d+)$/.exec(attemptEntry.name) : null;
      if (!match) continue;
      const attempt = Number(match[1]);
      const raw = loadCheckpointFiles(join(jobDir, attemptEntry.name), job.id, attempt);
      snapshots.push(...checkpointSnapshots(job, attempt, raw));
    }
  }
  return snapshots;
}

function loadCheckpointFiles(dir: string, jobId: string, attempt: number): RawStageCheckpoint[] {
  const checkpoints: RawStageCheckpoint[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(design|levels|entities|music)-\d+\.json$/.test(entry.name)) continue;
    const checkpoint = readJson<RawStageCheckpoint>(join(dir, entry.name));
    if (
      checkpoint &&
      checkpoint.jobId === jobId &&
      checkpoint.attempt === attempt &&
      isRawStageName(checkpoint.stage) &&
      Number.isInteger(checkpoint.revision)
    ) {
      checkpoints.push(checkpoint);
    }
  }
  return checkpoints.sort(
    (a, b) => a.at.localeCompare(b.at) || a.stage.localeCompare(b.stage) || a.revision - b.revision,
  );
}

/** Emit a candidate each time a new response changes a complete four-stage set. */
function checkpointSnapshots(
  job: JobAnalysisRow,
  attempt: number,
  checkpoints: RawStageCheckpoint[],
): AnalysisDataset['checkpoints'] {
  const latest: Partial<Record<RawStageName, RawStageCheckpoint>> = {};
  const snapshots: AnalysisDataset['checkpoints'] = [];
  for (const checkpoint of checkpoints) {
    // Single-level regeneration responses are intentionally checkpointed for
    // evidence, then followed by a complete canonical levels checkpoint. They
    // cannot independently reconstruct a GameSpec.
    if (
      checkpoint.stage === 'levels' &&
      isRecord(checkpoint.document) &&
      Object.prototype.hasOwnProperty.call(checkpoint.document, 'level') &&
      !Array.isArray(checkpoint.document['levels'])
    ) {
      continue;
    }
    latest[checkpoint.stage] = checkpoint;
    if (!latest.design || !latest.levels || !latest.entities || !latest.music) continue;
    const complete: Record<RawStageName, RawStageCheckpoint> = {
      design: latest.design,
      levels: latest.levels,
      entities: latest.entities,
      music: latest.music,
    };
    const spec = assembleCheckpointSpec(job, complete);
    if (!spec) continue;
    snapshots.push({
      gameId: job.gameId,
      jobId: job.id,
      attempt,
      revisions: {
        design: latest.design.revision,
        levels: latest.levels.revision,
        entities: latest.entities.revision,
        music: latest.music.revision,
      },
      spec,
    });
  }
  return snapshots;
}

function assembleCheckpointSpec(
  job: JobAnalysisRow,
  checkpoints: Record<RawStageName, RawStageCheckpoint>,
): GameSpec | null {
  if (!isRecord(checkpoints.design.document) || !isRecord(checkpoints.entities.document))
    return null;
  const design = checkpoints.design.document as unknown as DesignDoc;
  const entities = checkpoints.entities.document;
  let rawLevels = checkpoints.levels.document;
  const rawMusic = checkpoints.music.document;
  const musicRoster = isRecord(rawMusic) ? rawMusic : null;
  const archetype =
    job.requestedArchetype ?? (isArchetypeId(design.archetype) ? design.archetype : null);
  if (!archetype) return null;
  if (archetype === 'platformer' || archetype === 'hshooter') {
    try {
      rawLevels = compileTileRunsStage(archetype, rawLevels, { normalizeWidths: true });
    } catch {
      return null;
    }
  }
  const levelsRoster = isRecord(rawLevels) ? rawLevels : null;

  return {
    specVersion: 1,
    archetype,
    seed: job.seed,
    meta: { title: design.title, tagline: design.tagline },
    palette: design.palette,
    story: design.story,
    sprites: (entities.sprites ?? { custom: {}, assign: {} }) as GameSpec['sprites'],
    ...(archetype === 'fighter' && levelsRoster?.player ? { player: levelsRoster.player } : {}),
    levels: (levelsRoster?.levels ?? rawLevels) as never,
    boss: (entities.boss ?? {}) as never,
    music: (musicRoster?.music ?? rawMusic) as never,
    ...(entities.sfx ? { sfx: entities.sfx as GameSpec['sfx'] } : {}),
    ...(entities.backdrop ? { backdrop: entities.backdrop as GameSpec['backdrop'] } : {}),
    ...(entities.weather ? { weather: entities.weather as GameSpec['weather'] } : {}),
    ...(entities.lighting ? { lighting: entities.lighting as GameSpec['lighting'] } : {}),
    ...(entities.juice !== undefined ? { juice: entities.juice as GameSpec['juice'] } : {}),
    ...(design.difficulty ? { difficulty: design.difficulty } : {}),
    ...(archetype === 'platformer' ? { playerHeightTiles: 2 as const } : {}),
    ...(archetype === 'platformer' && design.feel ? { feel: design.feel } : {}),
    scoring: design.scoring,
  } as GameSpec;
}

function compareNormalization(
  original: GameSpec,
  normalizer: GeneratedSpecNormalizer,
  identity: Omit<
    NormalizationComparison,
    'diagnosticsBefore' | 'diagnosticsAfter' | 'fixes' | 'changed'
  >,
): NormalizationComparison {
  const diagnosticsBefore = diagnosticsForSpec(original);
  try {
    const result = normalizer(structuredClone(original));
    const diagnosticsAfter = diagnosticsForSpec(result.spec);
    return {
      ...identity,
      diagnosticsBefore,
      diagnosticsAfter,
      fixes: result.fixes,
      changed: JSON.stringify(original) !== JSON.stringify(result.spec),
    };
  } catch (error) {
    return {
      ...identity,
      diagnosticsBefore,
      diagnosticsAfter: diagnosticsBefore,
      fixes: [],
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function diagnosticsForSpec(spec: GameSpec): LintError[] {
  if (!isArchetypeId(spec.archetype)) {
    return [{ code: 'ARCHETYPE', path: '/archetype', message: 'unknown archetype' }];
  }
  try {
    const schema = validation.validateGameSchema(spec.archetype, spec);
    const security = validation.securityScan(spec);
    if (schema.length) return dedupeDiagnostics([...schema, ...security]);
    const sprites = validation.customBossSpriteDiagnostics(spec);
    return dedupeDiagnostics([
      ...security,
      ...sprites,
      ...archetypes[spec.archetype].lint(spec),
    ]);
  } catch (error) {
    return [
      {
        code: 'ANALYSIS_ERROR',
        path: '',
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

function toRepairEventSafe(row: Record<string, unknown>): RepairEvent {
  return {
    id: Number(row.id),
    jobId: String(row.job_id),
    gameId: String(row.game_id),
    attempt: Number(row.attempt),
    pass: Number(row.pass),
    owner: String(row.owner),
    action: String(row.action),
    diagnosticsBefore: parseDiagnostics(row.diagnostics_before_json),
    diagnosticsAfter: parseDiagnostics(row.diagnostics_after_json),
    patch: parseJson(row.patch_json),
    elapsedMs: Number(row.elapsed_ms),
    outcome: String(row.outcome),
    at: String(row.at),
  };
}

function parseDiagnostics(value: unknown): LintError[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter(
        (item): item is LintError =>
          isRecord(item) &&
          typeof item.code === 'string' &&
          typeof item.path === 'string' &&
          typeof item.message === 'string',
      )
    : [];
}

function parseJson(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return null;
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function dedupeDiagnostics(diagnostics: readonly LintError[]): LintError[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedCounts(map: Map<string, number>): CountEntry[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function formatCounts(label: string, counts: CountEntry[]): string {
  return `${label}: ${counts.length ? counts.map((entry) => `${entry.key}=${entry.count}`).join(', ') : 'none'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArchetypeId(value: unknown): value is ArchetypeId {
  return (
    value === 'platformer' ||
    value === 'shooter' ||
    value === 'adventure' ||
    value === 'hshooter' ||
    value === 'fighter'
  );
}

function isRawStageName(value: unknown): value is RawStageName {
  return value === 'design' || value === 'levels' || value === 'entities' || value === 'music';
}
