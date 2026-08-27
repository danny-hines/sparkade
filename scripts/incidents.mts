// Manage the local, gitignored generation incident catalog.
// Usage:
//   npm run incidents -- list [--status open]
//   npm run incidents -- set <id> <status> [--fixed-by ref] [--verified-by ref]
//   npm run incidents -- backfill
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archetypes } from '@sparkade/archetypes';
import { ENGINE_VERSION, type ArchetypeId, type LintError } from '@sparkade/shared';
import { ConfigStore } from '../packages/server/src/storage/config';
import { Db, type RepairEvent } from '../packages/server/src/storage/db';
import { GameFiles } from '../packages/server/src/storage/files';
import {
  detectIncidentRuntime,
  hasSubstantiveRepair,
  INCIDENT_STATUSES,
  IncidentStore,
  isIncidentStatus,
  type GenerationIncident,
  type IncidentOutcome,
} from '../packages/server/src/storage/incidents';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rawArgs = process.argv.slice(2);
let selectedDir = process.env.SPARKADE_DATA ?? join(root, 'data');
const args: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--data') {
    const value = rawArgs[++i];
    if (!value) throw new Error('--data requires a path');
    selectedDir = value;
  } else {
    args.push(rawArgs[i]!);
  }
}

const dataDir = isAbsolute(selectedDir) ? selectedDir : resolve(root, selectedDir);
const command = args.shift() ?? 'list';

if (command === 'help' || command === '--help' || command === '-h') {
  usage();
} else if (command === 'list') {
  listIncidents(dataDir, args);
} else if (command === 'set') {
  setIncident(dataDir, args);
} else if (command === 'backfill') {
  backfill(dataDir);
} else {
  throw new Error(`unknown command: ${command}`);
}

function usage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  npm run incidents -- list [--status open] [--data path]',
      `  npm run incidents -- set <id> <${INCIDENT_STATUSES.join('|')}> [--fixed-by ref] [--verified-by ref] [--superseded-by id] [--note text] [--data path]`,
      '  npm run incidents -- backfill [--data path]',
      '',
    ].join('\n'),
  );
}

function listIncidents(dir: string, listArgs: string[]): void {
  const statusIndex = listArgs.indexOf('--status');
  const requestedStatus = statusIndex >= 0 ? listArgs[statusIndex + 1] : undefined;
  if (requestedStatus && !isIncidentStatus(requestedStatus)) {
    throw new Error(`invalid status: ${requestedStatus}`);
  }
  const records = new IncidentStore(dir)
    .list()
    .filter((record) => !requestedStatus || record.lifecycle.status === requestedStatus);
  if (!records.length) {
    process.stdout.write('No generation incidents found.\n');
    return;
  }
  for (const { incident, lifecycle } of records) {
    const retry = incident.retry
      ? ` retry-${incident.retry.attempt}:${incident.retry.outcome}`
      : '';
    process.stdout.write(
      `${incident.id}\n  ${lifecycle.status} · ${incident.outcome} · ${incident.fingerprint}${retry}\n`,
    );
  }
}

function setIncident(dir: string, setArgs: string[]): void {
  const id = setArgs.shift();
  const status = setArgs.shift();
  if (!id || !isIncidentStatus(status)) {
    throw new Error(`set requires an incident id and status (${INCIDENT_STATUSES.join(', ')})`);
  }
  const options = parseOptions(setArgs);
  const updated = new IncidentStore(dir).updateLifecycle(
    id,
    {
      status,
      ...(options['fixed-by'] !== undefined ? { fixedBy: options['fixed-by'] } : {}),
      ...(options['verified-by'] !== undefined ? { verifiedBy: options['verified-by'] } : {}),
      ...(options['superseded-by'] !== undefined ? { supersededBy: options['superseded-by'] } : {}),
    },
    options.note,
  );
  if (!updated) throw new Error(`unknown incident: ${id}`);
  process.stdout.write(`${id}: ${updated.lifecycle.status}\n`);
}

function parseOptions(optionArgs: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < optionArgs.length; i++) {
    const match = /^--(.+)$/.exec(optionArgs[i]!);
    if (!match) throw new Error(`unexpected argument: ${optionArgs[i]}`);
    const value = optionArgs[++i];
    if (value === undefined) throw new Error(`${optionArgs[i - 1]} requires a value`);
    options[match[1]!] = value;
  }
  return options;
}

function backfill(dir: string): void {
  if (!existsSync(join(dir, 'sparkade.db'))) {
    throw new Error(`Sparkade database does not exist: ${join(dir, 'sparkade.db')}`);
  }
  const db = new Db(dir);
  const files = new GameFiles(dir);
  const incidents = new IncidentStore(dir);
  const config = new ConfigStore(dir).get();
  let captured = 0;
  try {
    for (const job of db.listJobs()) {
      const allRepairs = db.repairEventsForJob(job.id);
      const attempts = new Set<number>();
      for (const event of allRepairs) {
        if (event.action === 'terminal') attempts.add(event.attempt);
      }
      if (job.status === 'failed') attempts.add(job.attempt);
      if (
        job.status === 'done' &&
        hasSubstantiveRepair(allRepairs.filter((event) => event.attempt === job.attempt))
      ) {
        attempts.add(job.attempt);
      }

      const capturedByAttempt = new Map<number, GenerationIncident>();
      for (const attempt of [...attempts].sort((a, b) => a - b)) {
        const repairs = allRepairs.filter((event) => event.attempt === attempt);
        const terminal = repairs.filter((event) => event.action === 'terminal');
        const outcome: IncidentOutcome =
          terminal.length || (job.status === 'failed' && attempt === job.attempt)
            ? 'failed'
            : 'recovered';
        if (outcome === 'recovered' && !hasSubstantiveRepair(repairs)) continue;
        const checkpoints = files.listRawStageCheckpoints(job.id, attempt);
        const design = [...checkpoints]
          .reverse()
          .find((checkpoint) => checkpoint.stage === 'design')?.document;
        const designRecord = isRecord(design) ? design : {};
        const gameRow = db.getGame(job.gameId);
        const archetype = archetypeFrom(
          designRecord['archetype'],
          gameRow?.archetype ?? job.requestedArchetype ?? 'platformer',
        );
        const title =
          typeof designRecord['title'] === 'string'
            ? designRecord['title']
            : gameRow?.tagline !== 'Generating…'
              ? (gameRow?.title ?? 'Untitled generation')
              : 'Untitled generation';
        const trigger =
          outcome === 'failed'
            ? failureTrigger(job.error, terminal)
            : {
                code: 'repaired-generation',
                message: `generation published after ${repairs.filter((event) => event.action !== 'normalize').length} repair action(s)`,
                stage: 'validating' as const,
              };
        const incident = incidents.capture({
          outcome,
          job: { ...job, attempt },
          game: { title, archetype },
          trigger,
          repairs,
          checkpoints,
          runtime: detectIncidentRuntime({
            engineVersion: gameRow?.engineVersion || ENGINE_VERSION,
            archetypeVersion: gameRow?.archetypeVersion || archetypes[archetype].version,
            provider: process.env.SPARKADE_PROVIDER ?? config.stages.design.provider,
            textModel: config.stages.design.model,
            imageModel: config.imageGeneration.model,
          }),
          cumulativeCostUsd: db.gameCost(job.gameId),
          at: terminal.at(-1)?.at ?? job.finishedAt ?? job.createdAt,
        });
        capturedByAttempt.set(attempt, incident);
        captured++;
      }

      for (const [attempt, incident] of capturedByAttempt) {
        if (incident.outcome !== 'failed' || attempt >= job.attempt) continue;
        const nextAttempt = attempt + 1;
        const nextIncident = capturedByAttempt.get(nextAttempt);
        const retryOutcome = nextIncident?.outcome === 'failed' ? 'failed' : 'succeeded';
        incidents.markRetry(job.id, attempt, nextAttempt, retryOutcome, nextIncident?.id);
      }
    }
  } finally {
    db.close();
  }
  process.stdout.write(
    `Captured or refreshed ${captured} incident(s) in ${incidents.incidentsDir}.\n`,
  );
}

function failureTrigger(
  currentError: { code: string; message: string; stage: string } | undefined,
  terminal: RepairEvent[],
): GenerationIncident['trigger'] {
  if (currentError && isJobStage(currentError.stage)) return currentError;
  const diagnostics = terminal.flatMap((event) => event.diagnosticsAfter);
  return {
    code: terminal.length ? 'validation-failed' : 'generation-failed',
    message: diagnostics.length
      ? diagnostics.map(formatDiagnostic).join('; ').slice(0, 500)
      : 'generation attempt failed; the original current-error field is no longer available',
    stage: terminal.length ? 'validating' : 'failed',
  };
}

function formatDiagnostic(diagnostic: LintError): string {
  return `[${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`;
}

function archetypeFrom(value: unknown, fallback: ArchetypeId): ArchetypeId {
  return typeof value === 'string' && value in archetypes ? (value as ArchetypeId) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJobStage(value: string): value is GenerationIncident['trigger']['stage'] {
  return [
    'queued',
    'designing',
    'writing-spec',
    'repairing',
    'validating',
    'building-assets',
    'publishing',
    'done',
    'failed',
  ].includes(value);
}
