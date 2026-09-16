import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Explicit mock-provider mode only. Never an automatic fallback for production Blob errors. */
export function localStorageRoot(): string | null {
  const dir = process.env.SPARKADE_LOCAL_GENERATION_STORAGE_DIR;
  if (!dir) return null;
  if (process.env.SPARKADE_PROVIDER !== 'mock' || !isAbsolute(dir))
    throw new Error(
      'Local generation storage requires the mock provider and an absolute directory',
    );
  return resolve(dir);
}
function localPath(root: string, path: string) {
  const key = path.startsWith('local-mock:') ? path.slice(11) : path;
  if (!key || key.includes('://') || isAbsolute(key)) throw new Error('Invalid local storage key');
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) throw new Error('Invalid local storage key');
  return full;
}
export async function writeLocal(root: string, path: string, value: unknown) {
  const target = localPath(root, path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, target);
  return `local-mock:${path}`;
}
export async function readLocal<T>(root: string, path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(localPath(root, path), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function cleanLocal(root: string, prefix: string) {
  const directory = localPath(root, prefix);
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    for (const entry of entries)
      if (entry.isFile()) {
        const file = join(entry.parentPath, entry.name);
        if (!file.includes(`${sep}final${sep}`)) await rm(file);
      }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
