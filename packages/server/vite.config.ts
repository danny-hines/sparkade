import { defineConfig } from 'vite';

// Bundles the server into one Node ESM file (workspace TS compiled in; native
// and node_modules deps stay external). Keeps the Pi's npm ci lean.
export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    // Bundle workspace packages; leave real deps external.
    noExternal: [/@sparkade\//],
  },
});
