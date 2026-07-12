// Sparkade server entry point.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { archetypes } from '@sparkade/archetypes';
import { DEFAULT_BIND, DEFAULT_PORT } from '@sparkade/shared';
import { registerRoutes } from './api/routes';
import { GenerationRunner } from './pipeline/runner';
import { SseHub } from './pipeline/sse';
import { ConfigStore } from './storage/config';
import { Db } from './storage/db';
import { GameFiles, reconcileGames, seedGoldenGames } from './storage/files';
import { dataDir, ensureDir, repoRoot } from './util';

// Load .env in dev (tiny parser; no dotenv dependency). Pi uses systemd EnvironmentFile.
function loadDotEnv(): void {
  const path = join(repoRoot(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const dir = ensureDir(dataDir());
  const version = readVersion();
  const port = Number(process.env.SPARKADE_PORT) || DEFAULT_PORT;
  const bind = process.env.SPARKADE_BIND || DEFAULT_BIND;

  const configStore = new ConfigStore(dir);
  const db = new Db(dir);
  const files = new GameFiles(dir);
  const hub = new SseHub();
  const runner = new GenerationRunner(db, files, configStore, hub);

  // Boot-time recovery: seed goldens, reconcile DB<->filesystem, fail interrupted jobs.
  seedGoldenGames(
    files,
    db,
    Object.fromEntries(Object.values(archetypes).map((a) => [a.id, a.version])),
  );
  reconcileGames(files, db);
  runner.reconcile();

  // Log level defaults to warn: request lines (info) never appear, so photos
  // and audio uploads leave no trace in logs.
  const app = Fastify({
    logger: { level: process.env.SPARKADE_LOG ?? 'warn' },
    bodyLimit: 1024 * 1024,
  });
  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 8 },
  });

  registerRoutes(app, { db, files, configStore, runner, hub, version, port });

  // Serve the built shell (production / demo). Vite serves it in dev.
  const webDist = join(repoRoot(), 'packages', 'web', 'dist');
  const serveStatic = process.env.SPARKADE_SERVE_STATIC === '1' || process.env.SPARKADE_DEV !== '1';
  if (serveStatic && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, index: 'index.html' });
    app.addHook('onSend', async (req, reply) => {
      if (!req.url.startsWith('/api/')) {
        reply.header(
          'content-security-policy',
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        reply.header('x-content-type-options', 'nosniff');
      }
    });
  }

  try {
    await app.listen({ port, host: bind });
  } catch (e) {
    if ((e as { code?: string }).code === 'EADDRINUSE') {
      console.error(
        `port ${port} is already in use — another sparkade server is probably running.\n` +
          `Stop it (or set SPARKADE_PORT) and start again.`,
      );
      process.exit(1);
    }
    throw e;
  }
  console.log(`sparkade v${version} listening on http://${bind}:${port}  (data: ${dir})`);

  const shutdown = async () => {
    await app.close().catch(() => {});
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

main().catch((e) => {
  console.error('sparkade server failed to start:', e);
  process.exit(1);
});
