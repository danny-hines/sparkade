import sharp from 'sharp';
import { normalizeKeyArt, prepareImageReference } from '@sparkade/server/assets/game-art';

export async function imageProbeWorkflow() {
  'use workflow';
  return await processProbeImage();
}

async function processProbeImage() {
  'use step';
  const started = performance.now();
  const cpu = process.cpuUsage();
  // Match the largest image request currently used by the generator.
  const input = await sharp({
    create: { width: 1536, height: 1024, channels: 4, background: '#537d9a' },
  })
    .png()
    .toBuffer();
  const [art, reference] = await Promise.all([
    normalizeKeyArt(input),
    prepareImageReference(input),
  ]);
  const metadata = await sharp(art).metadata();
  const used = process.cpuUsage(cpu);
  return {
    ok: true,
    width: metadata.width,
    height: metadata.height,
    outputBytes: art.length,
    referenceBytes: reference.length,
    elapsedMs: Math.round(performance.now() - started),
    cpuMs: (used.user + used.system) / 1000,
    rssBytes: process.memoryUsage().rss,
    sharp: sharp.versions.sharp,
    node: process.version,
  };
}
