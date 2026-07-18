import type { LintError } from '@sparkade/shared';
import { PatchError, type JsonPatchOp } from './patch';
import type { RepairOwner } from './prompts';

const ENTITY_ROOTS = new Set([
  'sprites',
  'boss',
  'sfx',
  'backdrop',
  'weather',
  'lighting',
  'juice',
]);
const LEVEL_ROOTS = new Set(['levels', 'player']);

export function diagnosticOwner(diagnostic: LintError): RepairOwner {
  const root = pointerRoot(diagnostic.path);
  if (root === 'music') return 'music';
  if (root && ENTITY_ROOTS.has(root)) return 'entities';
  if (root && LEVEL_ROOTS.has(root)) return 'levels';
  return 'document';
}

export function groupDiagnostics(diagnostics: readonly LintError[]): Map<RepairOwner, LintError[]> {
  const groups = new Map<RepairOwner, LintError[]>();
  for (const diagnostic of diagnostics) {
    const owner = diagnosticOwner(diagnostic);
    const group = groups.get(owner) ?? [];
    group.push(diagnostic);
    groups.set(owner, group);
  }
  return groups;
}

export function diagnosticsForOwner(
  diagnostics: readonly LintError[],
  owner: RepairOwner,
): LintError[] {
  return diagnostics.filter((diagnostic) => diagnosticOwner(diagnostic) === owner);
}

export function diagnosticSignature(diagnostics: readonly LintError[]): string {
  return diagnostics
    .map((diagnostic) => `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}`)
    .sort()
    .join('\u0001');
}

export function repairMadeProgress(
  before: readonly LintError[],
  after: readonly LintError[],
): boolean {
  if (after.length < before.length) return true;
  return (
    after.length === before.length && diagnosticSignature(after) !== diagnosticSignature(before)
  );
}

/** A surgical owner repair may not use a seemingly-valid patch to rewrite a
 * healthy stage. This is enforced server-side, independently of prompting. */
export function assertPatchTargetsOwner(
  patch: readonly JsonPatchOp[],
  owner: RepairOwner,
  diagnostics: readonly LintError[],
): void {
  if (!Array.isArray(patch)) throw new PatchError('repair output must be a JSON Patch array');
  if (patch.length > 60) throw new PatchError('repair output exceeds the 60-operation limit');
  const documentRoots = new Set(
    diagnostics.map((diagnostic) => pointerRoot(diagnostic.path)).filter(Boolean),
  );
  const failingIndexes = failingLevelIndexes(diagnostics);
  const indexedLevelOnly =
    owner === 'levels' &&
    failingIndexes.length > 0 &&
    diagnostics.every((diagnostic) =>
      failingIndexes.some(
        (index) =>
          diagnostic.path === `/levels/${index}` ||
          diagnostic.path.startsWith(`/levels/${index}/`),
      ),
    );
  for (const operation of patch) {
    if (
      !operation ||
      typeof operation !== 'object' ||
      typeof operation.op !== 'string' ||
      typeof operation.path !== 'string'
    ) {
      throw new PatchError('repair output contains a malformed operation');
    }
    if (!['add', 'remove', 'replace'].includes(operation.op)) {
      throw new PatchError(`repair operation ${operation.op} is not allowed`);
    }
    const root = pointerRoot(operation.path);
    let allowed =
      owner === 'levels'
        ? !!root && LEVEL_ROOTS.has(root)
        : owner === 'entities'
          ? !!root && ENTITY_ROOTS.has(root)
          : owner === 'music'
            ? root === 'music'
            : !!root && documentRoots.has(root);
    if (allowed && indexedLevelOnly) {
      allowed = failingIndexes.some(
        (index) =>
          operation.path === `/levels/${index}` ||
          operation.path.startsWith(`/levels/${index}/`),
      );
    }
    if (!allowed) {
      throw new PatchError(
        `repair for ${owner} may not touch ${operation.path || 'the document root'}`,
      );
    }
  }
}

export function failingLevelIndexes(diagnostics: readonly LintError[]): number[] {
  const indexes = new Set<number>();
  for (const diagnostic of diagnostics) {
    const match = /^\/levels\/(\d+)(?:\/|$)/.exec(diagnostic.path);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b);
}

function pointerRoot(path: string): string | null {
  if (!path.startsWith('/')) return null;
  const root = path.slice(1).split('/', 1)[0];
  return root ? root.replace(/~1/g, '/').replace(/~0/g, '~') : null;
}
