import { PUBLIC_GAME_ASSET_MAX_BYTES } from '@sparkade/shared';

export class PublicAssetUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Content-Length can be absent after a streaming proxy. Enforce the limit on
 * the actual bytes, and stop reading immediately when the cap is exceeded. */
export async function readPublicGamePng(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      Number(declared) < 1 ||
      Number(declared) > PUBLIC_GAME_ASSET_MAX_BYTES)
  ) {
    throw new PublicAssetUploadError('asset size is invalid', 413);
  }
  if (!request.body) throw new PublicAssetUploadError('asset body is required', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PUBLIC_GAME_ASSET_MAX_BYTES) {
        await reader.cancel();
        throw new PublicAssetUploadError('asset exceeds the upload limit', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (size < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    throw new PublicAssetUploadError('asset must be a PNG', 415);
  }
  return bytes;
}
