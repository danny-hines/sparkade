import { defineConfig } from 'vite';
import { spawnSync } from 'node:child_process';

const revision = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
const buildCommit = revision.status === 0 ? revision.stdout.trim() : null;

// Bundles the server into one Node ESM file (workspace TS compiled in; native
// and node_modules deps stay external). Keeps the Pi's npm ci lean.
export default defineConfig({
  define: { __SPARKADE_BUILD_COMMIT__: JSON.stringify(buildCommit) },
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    // Bundle workspace packages; leave real deps external.
    noExternal: [/@sparkade\//],
  },
});
