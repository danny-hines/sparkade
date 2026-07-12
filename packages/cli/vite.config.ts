import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: { entryFileNames: 'index.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: {
    noExternal: [/@sparkade\//],
  },
});
