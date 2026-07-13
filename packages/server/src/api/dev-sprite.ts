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
}
