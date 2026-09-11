import { createGenerationService } from './service';
import { dataDir } from '../util';

process.umask(0o077);
const secret = process.env.SPARKADE_GENERATION_SECRET ?? '';
const portalOrigin = process.env.SPARKADE_PUBLIC_ORIGIN ?? 'https://sparkade.dev';
const { app } = await createGenerationService({ dir: dataDir(), secret, portalOrigin });
await app.listen({
  host: process.env.SPARKADE_BIND ?? '0.0.0.0',
  port: Number(process.env.PORT ?? process.env.SPARKADE_PORT) || 8080,
});
// Jobs and checkpoints are already durable. A restart recovers interrupted work
// with bounded attempts; do not cancel jobs or erase staging on SIGTERM.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
console.log('Sparkade cloud generation worker ready');
