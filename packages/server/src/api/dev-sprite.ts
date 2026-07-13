// Dev-only sprite pixel editor backend (SPARKADE_DEV=1 only). Saves a hand-edited
// library sprite frame straight back into its source .ts file: locate the file
// that defines the sprite id, find the exact original `rows` block (unique
// pixel-art fingerprint), and swap in the new rows, preserving indentation. No
// TS parsing — an exact line-by-line match keeps it robust. Same-height edits
// only (pixel tweaks), which is all the editor produces.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { repoRoot } from '../util';

const LIB_REL = 'packages/engine/src/library';

interface Frame {
  w: number;
  h: number;
  rows: string[];
}
interface Entry {
  frames: Frame[];
  anims: Record<string, number[]>;
  headSlots?: { x: number; y: number; size: number }[] | null;
}

/** Re-serialize a LibraryEntry in the exact hand-authored style of the .ts files
 *  (2/4/6/8/10-space indent), so an unchanged entry round-trips byte-for-byte. */
function serializeEntry(id: string, e: Entry, base: string): string {
  const i2 = base + '  ';
  const i3 = base + '    ';
  const i4 = base + '      ';
  const i5 = base + '        ';
  const frames = e.frames
    .map(
      (f) =>
        `${i3}{\n${i4}w: ${f.w},\n${i4}h: ${f.h},\n${i4}rows: [\n${f.rows.map((r) => `${i5}'${r}',`).join('\n')}\n${i4}],\n${i3}},`,
    )
    .join('\n');
  const anims = `{ ${Object.entries(e.anims)
    .map(([k, v]) => `${k}: [${v.join(', ')}]`)
    .join(', ')} }`;
  let out = `${base}${id}: {\n${i2}frames: [\n${frames}\n${i2}],\n${i2}anims: ${anims},\n`;
  if (e.headSlots && e.headSlots.length) {
    out += `${i2}headSlots: [\n${e.headSlots.map((h) => `${i3}{ x: ${h.x}, y: ${h.y}, size: ${h.size} },`).join('\n')}\n${i2}],\n`;
  }
  return out + `${base}},`;
}

/** Find the [start, end] line range of the `id: { … }` object (brace-matched,
 *  skipping single-quoted row strings). */
function objectSpan(lines: string[], sidx: number): number {
  let depth = 0;
  let started = false;
  for (let i = sidx; i < lines.length; i++) {
    let inStr = false;
    for (const ch of lines[i]!) {
      if (inStr) {
        if (ch === "'") inStr = false;
      } else if (ch === "'") inStr = true;
      else if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth === 0) return i;
      }
    }
  }
  return -1;
}

function validateEntry(e: Entry): string | null {
  if (!Array.isArray(e.frames) || e.frames.length === 0) return 'frames must be a non-empty array';
  for (const f of e.frames) {
    if (!Number.isInteger(f.w) || !Number.isInteger(f.h) || f.w < 1 || f.w > 64 || f.h < 1 || f.h > 64) return 'bad frame size';
    if (!Array.isArray(f.rows) || f.rows.length !== f.h) return 'rows length must equal h';
    if (!f.rows.every((r) => typeof r === 'string' && r.length === f.w && /^[0-9a-f.]+$/.test(r))) return 'rows must be w wide and use 0-f or .';
  }
  for (const list of Object.values(e.anims)) {
    if (!Array.isArray(list) || !list.every((n) => Number.isInteger(n) && n >= 0 && n < e.frames.length)) return 'anim references an out-of-range frame';
  }
  if (e.headSlots && e.headSlots.length && e.headSlots.length !== e.frames.length) return 'headSlots length must equal frames length';
  return null;
}

export function registerDevSpriteRoutes(app: FastifyInstance): void {
  app.post('/api/dev/sprite/save', async (req, reply) => {
    const body = req.body as { spriteId?: string; originalRows?: string[]; newRows?: string[] } | null;
    const { spriteId, originalRows, newRows } = body ?? {};
    if (!spriteId || !Array.isArray(originalRows) || !Array.isArray(newRows)) {
      return reply.code(400).send({ error: 'spriteId, originalRows, newRows required' });
    }
    if (!/^[a-z][a-z0-9_]*$/.test(spriteId)) return reply.code(400).send({ error: 'bad spriteId' });
    if (newRows.length !== originalRows.length) return reply.code(400).send({ error: 'row count changed (resize unsupported)' });
    const width = originalRows[0]?.length ?? 0;
    if (!newRows.every((r) => typeof r === 'string' && r.length === width && /^[0-9a-f.]+$/.test(r))) {
      return reply.code(400).send({ error: 'new rows must be same width and use only 0-f or .' });
    }

    const dir = join(repoRoot(), LIB_REL);
    const idRe = new RegExp(`^\\s*${spriteId}:\\s*\\{`, 'm');
    const file = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .find((f) => idRe.test(readFileSync(join(dir, f), 'utf8')));
    if (!file) return reply.code(404).send({ error: `sprite ${spriteId} not defined in any library file` });

    const path = join(dir, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    const needle = originalRows.map((r) => `'${r}',`);
    const sidx = lines.findIndex((l) => idRe.test(l)); // scope the search to this sprite
    let start = -1;
    for (let i = Math.max(0, sidx); i + needle.length <= lines.length; i++) {
      if (needle.every((n, j) => lines[i + j]!.trim() === n)) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      return reply.code(409).send({ error: 'original rows not found (source changed since load) — reload the editor' });
    }
    const indent = lines[start]!.slice(0, lines[start]!.length - lines[start]!.trimStart().length);
    lines.splice(start, needle.length, ...newRows.map((r) => `${indent}'${r}',`));
    writeFileSync(path, lines.join('\n'));
    return { ok: true, file: `${LIB_REL}/${file}` };
  });

  // Structural save: rewrite the whole sprite object (frame add/remove, anim
  // changes). Round-trips the ORIGINAL entry first and only writes if that
  // exactly reproduces the source object, so unusual formatting/comments are
  // never clobbered.
  app.post('/api/dev/sprite/save-entry', async (req, reply) => {
    const body = req.body as { spriteId?: string; originalEntry?: Entry; newEntry?: Entry } | null;
    const { spriteId, originalEntry, newEntry } = body ?? {};
    if (!spriteId || !originalEntry || !newEntry) return reply.code(400).send({ error: 'spriteId, originalEntry, newEntry required' });
    if (!/^[a-z][a-z0-9_]*$/.test(spriteId)) return reply.code(400).send({ error: 'bad spriteId' });
    const bad = validateEntry(newEntry);
    if (bad) return reply.code(400).send({ error: bad });

    const dir = join(repoRoot(), LIB_REL);
    const idRe = new RegExp(`^\\s*${spriteId}:\\s*\\{`, 'm');
    const file = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .find((f) => idRe.test(readFileSync(join(dir, f), 'utf8')));
    if (!file) return reply.code(404).send({ error: `sprite ${spriteId} not defined in any library file` });

    const path = join(dir, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    const sidx = lines.findIndex((l) => idRe.test(l));
    const eidx = objectSpan(lines, sidx);
    if (sidx < 0 || eidx < 0) return reply.code(409).send({ error: 'could not locate the sprite object' });
    const base = lines[sidx]!.slice(0, lines[sidx]!.length - lines[sidx]!.trimStart().length);
    const norm = (t: string): string => t.split('\n').map((l) => l.replace(/\r$/, '').trimEnd()).join('\n');
    const sourceSpan = lines.slice(sidx, eidx + 1).join('\n');
    if (norm(serializeEntry(spriteId, originalEntry, base)) !== norm(sourceSpan)) {
      return reply.code(409).send({ error: "this sprite's source isn't round-trippable (unusual formatting/comments) — edit frames by hand" });
    }
    lines.splice(sidx, eidx - sidx + 1, ...serializeEntry(spriteId, newEntry, base).split('\n'));
    writeFileSync(path, lines.join('\n'));
    return { ok: true, file: `${LIB_REL}/${file}` };
  });
}
