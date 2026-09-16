import sharp from 'sharp';
import { MAX_PHOTO_DIM } from '@sparkade/shared';
import { ArcadeError, ensureArcadeSchema, env } from './arcade';
import { getSql } from './db';
import { prefix } from './generation/store';
import { readOptionalPrivate } from './generation/storage';
import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { MAX_WEBSITE_PHOTO_BYTES } from './website-photo-limits';

/** Decode untrusted bytes, limit pixels, apply orientation and strip metadata. */
export async function normalizeWebsitePhoto(upload?: FormDataEntryValue | null) {
  if (upload == null) return undefined;
  if (!(upload instanceof File)) throw new ArcadeError('Choose a photo file.');
  if (!upload.size || upload.size > MAX_WEBSITE_PHOTO_BYTES)
    throw new ArcadeError('That photo could not be submitted. Please choose it again.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.type))
    throw new ArcadeError('Choose a JPEG, PNG, or WebP photo.');
  try {
    const image = sharp(Buffer.from(await upload.arrayBuffer()), {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
    });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
      throw new Error('Unsupported image');
    return await image
      .rotate()
      .resize(MAX_PHOTO_DIM, MAX_PHOTO_DIM, { fit: 'cover', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ArcadeError('Could not read that photo. Choose another JPEG, PNG, or WebP image.');
  }
}

/** Source images never go through the public game asset endpoint. */
export async function readWebsitePhoto(gameId: string, userId: string, admin = false) {
  await ensureArcadeSchema();
  const [row] = await getSql()`SELECT g.job_id FROM arcade_generations g
    JOIN public_games p ON p.id=g.game_id JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.game_id=${gameId} AND g.environment=${env()} AND p.environment=g.environment
      AND (g.user_id=${userId} OR ${admin}) AND p.deleted_at IS NULL
      AND j.state->'job'->>'hasPhoto'='true' AND j.checkpoint<>'' AND NOT j.cleanup_pending
      AND j.status NOT IN ('done','canceled') AND g.input_review<>'rejected'`;
  if (!row) return null;
  const checkpoint = await readOptionalPrivate<PassCheckpoint>(
    `${prefix(row.job_id)}checkpoints/initial.json`,
  );
  const photo = checkpoint?.files[`staging/${row.job_id}/photo.jpg`];
  return photo ? Buffer.from(photo, 'base64') : null;
}
