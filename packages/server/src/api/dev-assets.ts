// Dev-only convenience redirect: the asset gallery lives in the web app
// (it needs real engine code — decodeSprite, makeBackdrop — which only the
// browser bundle has). Anyone visiting the API port gets pointed at Vite.
import type { FastifyInstance } from 'fastify';

export function registerDevAssetRoutes(app: FastifyInstance): void {
  app.get('/dev/assets', async (_req, reply) =>
    reply.redirect('http://localhost:5173/?dev=assets'),
  );
}
