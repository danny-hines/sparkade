// RFC 6902 JSON Patch application with repair-loop guards: patches from the
// repair model may never touch /archetype, /seed, /meta/title or /specVersion.
// Hand-rolled (no dependency) and unit-tested.

export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

const FORBIDDEN_PREFIXES = ['/archetype', '/seed', '/meta/title', '/specVersion'];

export class PatchError extends Error {}

function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PatchError(`invalid pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAt(doc: unknown, segs: string[]): unknown {
  let cur = doc;
  for (const seg of segs) {
    if (Array.isArray(cur)) {
      const ix = seg === '-' ? cur.length : Number(seg);
      if (!Number.isInteger(ix) || ix < 0 || ix >= cur.length) throw new PatchError(`path not found at "${seg}"`);
      cur = cur[ix];
    } else if (cur && typeof cur === 'object') {
      if (!(seg in (cur as Record<string, unknown>))) throw new PatchError(`path not found at "${seg}"`);
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      throw new PatchError(`cannot descend into non-object at "${seg}"`);
    }
  }
  return cur;
}

function parentAndKey(doc: unknown, segs: string[]): { parent: unknown; key: string } {
  if (segs.length === 0) throw new PatchError('operations on the document root are not allowed');
  const parent = getAt(doc, segs.slice(0, -1));
  return { parent, key: segs[segs.length - 1]! };
}

function addAt(doc: unknown, segs: string[], value: unknown): void {
  const { parent, key } = parentAndKey(doc, segs);
  if (Array.isArray(parent)) {
    const ix = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(ix) || ix < 0 || ix > parent.length) throw new PatchError(`bad array index "${key}"`);
    parent.splice(ix, 0, value);
  } else if (parent && typeof parent === 'object') {
    (parent as Record<string, unknown>)[key] = value;
  } else {
    throw new PatchError('add target is not a container');
  }
}

function removeAt(doc: unknown, segs: string[]): unknown {
  const { parent, key } = parentAndKey(doc, segs);
  if (Array.isArray(parent)) {
    const ix = Number(key);
    if (!Number.isInteger(ix) || ix < 0 || ix >= parent.length) throw new PatchError(`bad array index "${key}"`);
    return parent.splice(ix, 1)[0];
  }
  if (parent && typeof parent === 'object') {
    const rec = parent as Record<string, unknown>;
    if (!(key in rec)) throw new PatchError(`remove: "${key}" not present`);
    const v = rec[key];
    delete rec[key];
    return v;
  }
  throw new PatchError('remove target is not a container');
}

function replaceAt(doc: unknown, segs: string[], value: unknown): void {
  const { parent, key } = parentAndKey(doc, segs);
  if (Array.isArray(parent)) {
    const ix = Number(key);
    if (!Number.isInteger(ix) || ix < 0 || ix >= parent.length) throw new PatchError(`bad array index "${key}"`);
    parent[ix] = value;
  } else if (parent && typeof parent === 'object') {
    const rec = parent as Record<string, unknown>;
    if (!(key in rec)) throw new PatchError(`replace: "${key}" not present`);
    rec[key] = value;
  } else {
    throw new PatchError('replace target is not a container');
  }
}

function guard(op: JsonPatchOp, enforceGuards: boolean): void {
  if (!enforceGuards) return;
  for (const banned of FORBIDDEN_PREFIXES) {
    for (const p of [op.path, op.from]) {
      if (p !== undefined && (p === banned || p.startsWith(banned + '/'))) {
        throw new PatchError(`patch may not touch ${banned}`);
      }
    }
  }
}

/**
 * Applies a patch array to a deep clone; the original is never mutated.
 * Throws PatchError on malformed ops, missing paths, failed tests, or guard hits.
 */
export function applyPatch<T>(doc: T, patch: JsonPatchOp[], opts: { enforceGuards?: boolean } = {}): T {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array of operations');
  if (patch.length > 200) throw new PatchError('patch too large (max 200 operations)');
  const enforceGuards = opts.enforceGuards ?? true;
  const clone = structuredClone(doc);
  for (const op of patch) {
    if (!op || typeof op !== 'object' || typeof op.path !== 'string') {
      throw new PatchError(`malformed operation: ${JSON.stringify(op).slice(0, 80)}`);
    }
    guard(op, enforceGuards);
    const segs = parsePointer(op.path);
    switch (op.op) {
      case 'add':
        if (!('value' in op)) throw new PatchError('add needs a value');
        addAt(clone, segs, structuredClone(op.value));
        break;
      case 'remove':
        removeAt(clone, segs);
        break;
      case 'replace':
        if (!('value' in op)) throw new PatchError('replace needs a value');
        replaceAt(clone, segs, structuredClone(op.value));
        break;
      case 'move': {
        if (typeof op.from !== 'string') throw new PatchError('move needs "from"');
        const fromSegs = parsePointer(op.from);
        const value = removeAt(clone, fromSegs);
        addAt(clone, segs, value);
        break;
      }
      case 'copy': {
        if (typeof op.from !== 'string') throw new PatchError('copy needs "from"');
        const value = getAt(clone, parsePointer(op.from));
        addAt(clone, segs, structuredClone(value));
        break;
      }
      case 'test': {
        const actual = getAt(clone, segs);
        if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
          throw new PatchError(`test failed at ${op.path}`);
        }
        break;
      }
      default:
        throw new PatchError(`unknown op "${(op as { op: string }).op}"`);
    }
  }
  return clone;
}
