import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    exclude: ['replicad-opencascadejs']
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    chunkSizeWarningLimit: 1600
  }
});
