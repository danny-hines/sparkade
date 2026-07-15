import { defineConfig } from 'vite';

// Plain Preact via esbuild's automatic JSX — no plugin needed (the allowed
// dependency list is strict). Dev proxies /api to the Fastify server (override
// the target with SPARKADE_API_TARGET to point at a non-default API port).
const API_TARGET = process.env.SPARKADE_API_TARGET ?? 'http://127.0.0.1:8080';
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        // A dead API server otherwise surfaces as a bare 500 from the proxy —
        // turn it into an actionable message for the shell's error banners.
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res) {
              if (!res.headersSent) {
                res.writeHead(503, { 'content-type': 'application/json' });
              }
              res.end(
                JSON.stringify({
                  error:
                    'API server is not running on :8080 — restart `npm run dev` (it starts both the shell and the API).',
                }),
              );
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // The Pi loads this once at boot; a single chunk keeps kiosk startup simple.
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
