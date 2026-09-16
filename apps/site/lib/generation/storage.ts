import { localStorageRoot, writeLocal, readLocal, cleanLocal } from './local-storage';
import { get, put, del, list } from '@vercel/blob';

function options() {
  const token = process.env.GENERATION_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Private generation storage is not configured');
  return { token };
}
export async function writePrivate(path: string, value: unknown): Promise<string> {
  const local = localStorageRoot();
  if (local) return writeLocal(local, path, value);
  const blob = await put(path, JSON.stringify(value), {
    ...options(),
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}
export async function readOptionalPrivate<T>(path: string): Promise<T | null> {
  const local = localStorageRoot();
  if (local) return readLocal<T>(local, path);
  const blob = await get(path, { ...options(), access: 'private', useCache: false });
  if (!blob) return null;
  if (blob.statusCode !== 200) throw new Error('Generation checkpoint unavailable');
  return (await new Response(blob.stream).json()) as T;
}
export async function cleanPrivate(prefix: string) {
  const local = localStorageRoot();
  if (local) return cleanLocal(local, prefix);
  let cursor: string | undefined;
  do {
    const page = await list({ ...options(), prefix, cursor, limit: 1000 });
    const urls = page.blobs.filter((b) => !b.pathname.includes('/final/')).map((b) => b.url);
    if (urls.length) await del(urls, options());
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function readPrivate<T>(path: string): Promise<T> {
  const result = await readOptionalPrivate<T>(path);
  if (result === null) throw new Error('Generation checkpoint unavailable');
  return result;
}
