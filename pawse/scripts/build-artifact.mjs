// Packs the whole game into one HTML file for publishing as a claude.ai Artifact
// (or anywhere else that wants a single page).
//
//   node scripts/build-artifact.mjs [out.html] [preview.html]
//
// The output is a page *fragment* (no <html>/<head>/<body>): Artifacts wrap the
// file in their own skeleton. Our own code and CSS are inlined; three.js is the
// only thing loaded from outside, from a CDN the Artifact sandbox allows.
// The optional second file wraps the fragment the way the host does, with a
// similar content-security policy, so it can be checked locally.
import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [outArg, previewArg] = process.argv.slice(2);
const out = resolve(outArg || join(root, 'dist', 'pawse-artifact.html'));

const three = JSON.parse(await readFile(join(root, 'node_modules/three/package.json'), 'utf8')).version;
const THREE_CDN = `https://cdnjs.cloudflare.com/ajax/libs/three.js/${three}/three.module.min.js`;

const result = await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    modulePreload: false,
    rollupOptions: {
      input: join(root, 'src/main.js'),
      external: ['three'],
      output: { format: 'es', paths: { three: THREE_CDN }, inlineDynamicImports: true },
    },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const entry = outputs.find((o) => o.type === 'chunk' && o.isEntry);
if (!entry) throw new Error('no entry chunk in the build output');
let js = entry.code;
// these two sequences change how an inline <script> is parsed
if (js.includes('<!--')) throw new Error('bundle contains "<!--", which is not safe inside an inline script');
js = js.replace(/<\/script/gi, '<\\/script');

const css = await readFile(join(root, 'src/style.css'), 'utf8');
if (/<\/style/i.test(css)) throw new Error('stylesheet contains "</style"');

const html = await readFile(join(root, 'index.html'), 'utf8');
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .replace(/\s*<script type="module" src="\/src\/main\.js"><\/script>\s*/, '\n')
  .trim();

const page = `<title>Pawse Dog Park</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`artifact page: ${out} (${(page.length / 1024).toFixed(0)} kB, three.js ${three} from cdnjs)`);

if (previewArg) {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'img-src data: blob:',
    'media-src data: blob:',
    "connect-src 'none'",
    'worker-src blob:',
  ].join('; ');
  const preview = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${page}</body>
</html>
`;
  const previewOut = resolve(previewArg);
  await mkdir(dirname(previewOut), { recursive: true });
  await writeFile(previewOut, preview);
  console.log(`local preview: ${previewOut}`);
}
