import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMER_ACTION_ASSET_ROLES, PLATFORMER_PLAY_STYLES } from '@sparkade/shared';
import { generatedAssetForRole } from '../assets/manifest';

/** Read-only playback of isolated CLI experiments. Registered only with the dev pose lab. */
export function registerDevPlatformerActionRoutes(app: FastifyInstance, dataDir: string): void {
  const directory = (run: string) =>
    /^[a-zA-Z0-9_-]{1,100}$/.test(run)
      ? join(dataDir, 'experiments', 'platformer-actions', run)
      : null;
  app.get<{ Params: { run: string } }>(
    '/api/dev/platformer-actions/:run',
    async (request, reply) => {
      const dir = directory(request.params.run);
      if (!dir || !existsSync(join(dir, 'result.json')))
        return reply.code(404).send({ error: 'Action experiment not found' });
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
      if (!PLATFORMER_PLAY_STYLES.includes(result.style))
        return reply.code(400).send({ error: 'Unknown experiment style' });
      const poses = Object.fromEntries(
        Object.entries(PLATFORMER_ACTION_ASSET_ROLES).flatMap(([pose, role]) => {
          const asset = generatedAssetForRole(dir, role);
          return asset
            ? [[pose, `/api/dev/platformer-actions/${request.params.run}/assets/${asset.filename}`]]
            : [];
        }),
      );
      return { style: result.style, mode: result.mode, error: result.error, poses };
    },
  );
  app.get<{ Params: { run: string; filename: string } }>(
    '/api/dev/platformer-actions/:run/assets/:filename',
    async (request, reply) => {
      const dir = directory(request.params.run);
      const asset =
        dir &&
        Object.values(PLATFORMER_ACTION_ASSET_ROLES)
          .map((role) => generatedAssetForRole(dir, role))
          .find((asset) => asset?.filename === request.params.filename);
      if (!asset || !dir) return reply.code(404).send({ error: 'Action asset not found' });
      return reply.type('image/png').send(createReadStream(join(dir, asset.filename)));
    },
  );
}
