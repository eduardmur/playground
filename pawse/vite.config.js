import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;

/**
 * Tells the game which audio files exist, so it can use the real recordings in
 * public/audio/ where there are any and its built-in synth everywhere else,
 * without probing the server for files that are not there.
 *
 *   import files from 'virtual:audio-index';   // ['sfx/door_open.mp3', ...]
 */
function audioIndex() {
  const VID = 'virtual:audio-index';
  const RID = '\0' + VID;
  let dir = '';
  const scan = () => {
    const out = [];
    const walk = (d) => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (AUDIO_EXT.test(e.name)) out.push(relative(dir, p).split(sep).join('/'));
      }
    };
    walk(dir);
    return out.sort();
  };
  return {
    name: 'audio-index',
    configResolved(config) {
      dir = join(config.root, 'public', 'audio');
    },
    resolveId(id) {
      if (id === VID) return RID;
    },
    load(id) {
      if (id === RID) return `export default ${JSON.stringify(scan())};`;
    },
    configureServer(server) {
      const refresh = (file) => {
        if (!file.startsWith(dir) || !AUDIO_EXT.test(file)) return;
        const mod = server.moduleGraph.getModuleById(RID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(dir);
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

export default defineConfig({
  base: './', // so the built game can be hosted from any folder
  plugins: [audioIndex()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
