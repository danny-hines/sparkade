import { describe, expect, it } from 'vitest';
import { PUBLIC_GAME_ASSET_MAX_BYTES } from '@sparkade/shared';
import { readPublicGamePng } from '../../../apps/site/lib/public-game-upload';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function request(bytes: Uint8Array, length?: string) {
  return new Request('https://sparkade.test/upload', {
    method: 'PUT',
    body: bytes as BodyInit,
    headers: length === undefined ? {} : { 'content-length': length },
  });
}
describe('public PNG body validation', () => {
  it('accepts a valid PNG without Content-Length after a streaming proxy', async () => {
    expect(await readPublicGamePng(request(png))).toEqual(png);
  });
  it('accepts an ordinary length-delimited upload', async () => {
    expect(await readPublicGamePng(request(png, String(png.length)))).toEqual(png);
  });
  it('enforces the real byte limit even if the header is absent or misleading', async () => {
    const large = new Uint8Array(PUBLIC_GAME_ASSET_MAX_BYTES + 1);
    large.set(png);
    await expect(readPublicGamePng(request(large))).rejects.toMatchObject({ status: 413 });
    await expect(readPublicGamePng(request(large, '12'))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects non-PNG and oversized declared bodies', async () => {
    await expect(readPublicGamePng(request(new Uint8Array(12)))).rejects.toMatchObject({
      status: 415,
    });
    await expect(
      readPublicGamePng(request(png, String(PUBLIC_GAME_ASSET_MAX_BYTES + 1))),
    ).rejects.toMatchObject({ status: 413 });
  });
});
