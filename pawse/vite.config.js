import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // so the built game can be hosted from any folder
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
