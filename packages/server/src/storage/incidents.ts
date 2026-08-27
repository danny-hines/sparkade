// Human-reviewable generation incident catalog. Structured evidence is copied
// from the durable DB/checkpoint telemetry; photos, prompts and API credentials
// are deliberately never written here.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchetypeId, JobRecord, JobStage } from '@sparkade/shared';
import type { RepairEvent } from './db';
import type { RawStageCheckpoint } from './files';
import { atomicWriteFile, ensureDir, nowIso, readJson, repoRoot } from '../util';

export const INCIDENT_STATUSES = [
  'open',
  'candidate-fixed',
  'resolved',
  'obsolete',
  'accepted',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentOutcome = 'failed' | 'recovered';
export type IncidentRetryOutcome = 'running' | 'succeeded' | 'failed';

export interface IncidentRuntime {
  engineVersion: string;
  archetypeVersion: string;
  provider: string;
  textModel: string;
  imageModel: string;
  git: { commit: string; dirty: boolean } | null;
}

export interface IncidentRepairStep {
  pass: number;
  owner: string;
  action: string;
  outcome: string;
  diagnosticsBefore: string[];
  diagnosticsAfter: string[];
  elapsedMs: number;
  at: string;
}

export interface GenerationIncident {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  outcome: IncidentOutcome;
  fingerprint: string;
  job: {
    id: string;
    gameId: string;
    attempt: number;
    sourceKind: JobRecord['sourceKind'];
    requestedArchetype?: ArchetypeId;
    hasPhoto: boolean;
  };
  game: {
    title: string;
    archetype: ArchetypeId;
  };
  trigger: {
    code: string;
    message: string;
    stage: JobStage;
  };
  diagnosticCodes: string[];
  repairs: IncidentRepairStep[];
  evidence: {
    database: 'sparkade.db';
    checkpointDir: string;
    checkpoints: Array<{
      stage: RawStageCheckpoint['stage'];
      revision: number;
      at: string;
      file: string;
    }>;
  };
  runtime: IncidentRuntime;
  cost: { cumulativeUsd: number | null };
  retry?: {
    attempt: number;
    outcome: IncidentRetryOutcome;
    updatedAt: string;
    incidentId?: string;
  };
}

export interface IncidentCaptureInput {
  outcome: IncidentOutcome;
  job: JobRecord;
  game: { title: string; archetype: ArchetypeId };
  trigger: GenerationIncident['trigger'];
  repairs: RepairEvent[];
  checkpoints: RawStageCheckpoint[];
  runtime: IncidentRuntime;
  cumulativeCostUsd: number | null;
  at?: string;
}

export interface IncidentLifecycle {
  status: IncidentStatus;
  fixedBy: string;
  verifiedBy: string;
  supersededBy: string;
}

export interface IncidentRecord {
  incident: GenerationIncident;
  lifecycle: IncidentLifecycle;
  directory: string;
}

const SUBSTANTIVE_REPAIR_ACTIONS = new Set([
  'compile-retry',
  'design-collision-redraft',
  'design-redraft',
  'fallback',
  'fighter-art-fallback',
  'model-repair',
  'regenerate',
]);

export function hasSubstantiveRepair(events: readonly RepairEvent[]): boolean {
  return events.some((event) => SUBSTANTIVE_REPAIR_ACTIONS.has(event.action));
}

export function detectIncidentRuntime(input: Omit<IncidentRuntime, 'git'>): IncidentRuntime {
  let git: IncidentRuntime['git'] = null;
  try {
    const root = repoRoot();
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (commit) git = { commit, dirty: status.trim().length > 0 };
  } catch {
    // Installed cabinets may not include repository metadata.
  }
  return { ...input, git };
}

export class IncidentStore {
  readonly incidentsDir: string;

  constructor(readonly dataDir: string) {
    this.incidentsDir = join(dataDir, 'incidents');
  }

  capture(input: IncidentCaptureInput): GenerationIncident {
    const existing = this.find(input.job.id, input.job.attempt);
    const createdAt = existing?.incident.createdAt ?? input.at ?? nowIso();
    const id = existing?.incident.id ?? incidentId(createdAt, input.job.id, input.job.attempt);
    const directory = existing?.directory ?? ensureDir(join(this.incidentsDir, id));
    const diagnosticCodes = allDiagnosticCodes(input.repairs);
    const incident: GenerationIncident = {
      schemaVersion: 1,
      id,
      createdAt,
      updatedAt: input.at ?? nowIso(),
      outcome: input.outcome,
      fingerprint: buildFingerprint(
        input.game.archetype,
        input.trigger.stage,
        input.trigger.code,
        input.repairs,
        input.outcome,
      ),
      job: {
        id: input.job.id,
        gameId: input.job.gameId,
        attempt: input.job.attempt,
        sourceKind: input.job.sourceKind,
        ...(input.job.requestedArchetype
          ? { requestedArchetype: input.job.requestedArchetype }
          : {}),
        hasPhoto: input.job.hasPhoto,
      },
      game: input.game,
      trigger: input.trigger,
      diagnosticCodes,
      repairs: input.repairs.map(toRepairStep),
      evidence: {
        database: 'sparkade.db',
        checkpointDir: `checkpoints/${input.job.id}/attempt-${input.job.attempt}`,
        checkpoints: input.checkpoints.map((checkpoint) => ({
          stage: checkpoint.stage,
          revision: checkpoint.revision,
          at: checkpoint.at,
          file: `checkpoints/${input.job.id}/attempt-${input.job.attempt}/${checkpoint.stage}-${String(checkpoint.revision).padStart(3, '0')}.json`,
        })),
      },
      runtime: input.runtime,
      cost: { cumulativeUsd: input.cumulativeCostUsd },
      ...(existing?.incident.retry ? { retry: existing.incident.retry } : {}),
    };
    atomicWriteFile(join(directory, 'incident.json'), `${JSON.stringify(incident, null, 2)}\n`);
    const notesPath = join(directory, 'notes.md');
    if (!existsSync(notesPath)) atomicWriteFile(notesPath, renderInitialNotes(incident));
    return incident;
  }

  markRetry(
    jobId: string,
    failedAttempt: number,
    retryAttempt: number,
    outcome: IncidentRetryOutcome,
    linkedIncidentId?: string,
  ): GenerationIncident | null {
    const record = this.find(jobId, failedAttempt);
    if (!record) return null;
    const updatedAt = nowIso();
    const incident: GenerationIncident = {
      ...record.incident,
      updatedAt,
      retry: {
        attempt: retryAttempt,
        outcome,
        updatedAt,
        ...(linkedIncidentId ? { incidentId: linkedIncidentId } : {}),
      },
    };
    atomicWriteFile(
      join(record.directory, 'incident.json'),
      `${JSON.stringify(incident, null, 2)}\n`,
    );
    return incident;
  }

  list(): IncidentRecord[] {
    if (!existsSync(this.incidentsDir)) return [];
    const records: IncidentRecord[] = [];
    for (const entry of readdirSync(this.incidentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(this.incidentsDir, entry.name);
      const incident = readJson<GenerationIncident>(join(directory, 'incident.json'));
      if (!validIncident(incident)) continue;
      records.push({
        incident,
        lifecycle: readLifecycle(join(directory, 'notes.md')),
        directory,
      });
    }
    return records.sort(
      (a, b) =>
        a.incident.createdAt.localeCompare(b.incident.createdAt) ||
        a.incident.id.localeCompare(b.incident.id),
    );
  }

  find(jobId: string, attempt: number): IncidentRecord | null {
    return (
      this.list().find(
        ({ incident }) => incident.job.id === jobId && incident.job.attempt === attempt,
      ) ?? null
    );
  }

  updateLifecycle(
    id: string,
    updates: Partial<Omit<IncidentLifecycle, 'status'>> & { status?: IncidentStatus },
    note?: string,
  ): IncidentRecord | null {
    const record = this.list().find(({ incident }) => incident.id === id);
    if (!record) return null;
    const lifecycle = { ...record.lifecycle, ...updates };
    const notesPath = join(record.directory, 'notes.md');
    const current = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
    const body = notesBody(current) || renderNotesBody(record.incident);
    const nextBody = note?.trim()
      ? `${body.trimEnd()}\n\n- ${nowIso()} — ${note.trim()}\n`
      : `${body.trimEnd()}\n`;
    atomicWriteFile(notesPath, `${renderFrontmatter(lifecycle)}\n${nextBody}`);
    return { ...record, lifecycle };
  }
}

function incidentId(at: string, jobId: string, attempt: number): string {
  const timestamp = at.replace(/:/g, '').replace('.', '');
  return `${timestamp}--${safeSegment(jobId)}--attempt-${attempt}`;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function buildFingerprint(
  archetype: ArchetypeId,
  stage: JobStage,
  triggerCode: string,
  repairs: readonly RepairEvent[],
  outcome: IncidentOutcome,
): string {
  const terminalCodes = uniqueSorted(
    repairs
      .filter((event) => event.action === 'terminal')
      .flatMap((event) => event.diagnosticsAfter.map((diagnostic) => diagnostic.code)),
  );
  const repairedCodes = uniqueSorted(
    repairs
      .filter((event) => SUBSTANTIVE_REPAIR_ACTIONS.has(event.action))
      .flatMap((event) => event.diagnosticsBefore.map((diagnostic) => diagnostic.code)),
  );
  const codes = outcome === 'failed' && terminalCodes.length ? terminalCodes : repairedCodes;
  const cause = codes.length ? codes.join('+') : triggerCode;
  return [archetype, stage, cause].map(safeFingerprintSegment).join(':');
}

function safeFingerprintSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_+.-]/g, '_');
}

function allDiagnosticCodes(repairs: readonly RepairEvent[]): string[] {
  return uniqueSorted(
    repairs.flatMap((event) => [
      ...event.diagnosticsBefore.map((diagnostic) => diagnostic.code),
      ...event.diagnosticsAfter.map((diagnostic) => diagnostic.code),
    ]),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function toRepairStep(event: RepairEvent): IncidentRepairStep {
  return {
    pass: event.pass,
    owner: event.owner,
    action: event.action,
    outcome: event.outcome,
    diagnosticsBefore: uniqueSorted(event.diagnosticsBefore.map((diagnostic) => diagnostic.code)),
    diagnosticsAfter: uniqueSorted(event.diagnosticsAfter.map((diagnostic) => diagnostic.code)),
    elapsedMs: event.elapsedMs,
    at: event.at,
  };
}

function validIncident(value: GenerationIncident | null): value is GenerationIncident {
  return (
    value?.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.fingerprint === 'string' &&
    (value.outcome === 'failed' || value.outcome === 'recovered') &&
    typeof value.job?.id === 'string' &&
    Number.isInteger(value.job?.attempt)
  );
}

function renderInitialNotes(incident: GenerationIncident): string {
  return `${renderFrontmatter({
    status: 'open',
    fixedBy: '',
    verifiedBy: '',
    supersededBy: '',
  })}\n${renderNotesBody(incident)}\n`;
}

function renderFrontmatter(lifecycle: IncidentLifecycle): string {
  return [
    '---',
    `status: ${lifecycle.status}`,
    `fixedBy: ${frontmatterValue(lifecycle.fixedBy)}`,
    `verifiedBy: ${frontmatterValue(lifecycle.verifiedBy)}`,
    `supersededBy: ${frontmatterValue(lifecycle.supersededBy)}`,
    '---',
  ].join('\n');
}

function frontmatterValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim();
}

function renderNotesBody(incident: GenerationIncident): string {
  const label = incident.outcome === 'failed' ? 'Failed generation' : 'Recovered generation';
  return [
    `# ${label}: ${incident.trigger.code}`,
    '',
    `- Incident: \`${incident.id}\``,
    `- Fingerprint: \`${incident.fingerprint}\``,
    `- Game: ${incident.game.title} (${incident.game.archetype})`,
    `- Job: \`${incident.job.id}\`, attempt ${incident.job.attempt}`,
    `- Evidence: \`${incident.evidence.checkpointDir}\``,
    '',
    '## Diagnosis',
    '',
    '_Add the concrete cause and contributing conditions._',
    '',
    '## Improvement opportunity',
    '',
    '_Describe a pipeline, prompt, validator, fallback, or observability improvement._',
    '',
    '## Resolution and verification',
    '',
    '_Link the change and the generation or test that proves it._',
  ].join('\n');
}

function readLifecycle(path: string): IncidentLifecycle {
  const fallback: IncidentLifecycle = {
    status: 'open',
    fixedBy: '',
    verifiedBy: '',
    supersededBy: '',
  };
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return fallback;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (field) fields.set(field[1]!, field[2]!.trim());
  }
  const status = fields.get('status');
  return {
    status: isIncidentStatus(status) ? status : 'open',
    fixedBy: fields.get('fixedBy') ?? '',
    verifiedBy: fields.get('verifiedBy') ?? '',
    supersededBy: fields.get('supersededBy') ?? '',
  };
}

function notesBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly unknown[]).includes(value);
}
