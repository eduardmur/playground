import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // so the built page can be hosted from any folder
  build: { chunkSizeWarningLimit: 1500, target: 'es2022' },
});
