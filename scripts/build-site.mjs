// Builds the GitHub Pages site for the whole playground.
//
//   node scripts/build-site.mjs
//
// Every top-level folder is one experiment:
//   - with a package.json that has a "build" script: installed, built, and its dist/ published
//   - with an index.html and no build step: published as it is
//   - anything else: listed with a link to its code only
// A cover image is taken from <project>/cover.(jpg|png|webp), or else the first file
// (by name) in <project>/screenshots/.
// Optional metadata lives in the project's package.json under "playground":
//   { "title": "My Idea", "tags": ["game"], "date": "2026-12-01" }
// The result goes to _site/, with an index page that lists every experiment.
import { execSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '_site');
const SKIP = new Set(['scripts', 'node_modules', '_site', 'dist']);
const REPO = process.env.GITHUB_REPOSITORY || 'eduardmur/playground';
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const only = process.argv[2]; // build a single project while testing

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** First paragraph of a README, as a fallback description. */
async function readmeBlurb(dir) {
  try {
    const text = await readFile(join(dir, 'README.md'), 'utf8');
    const para = text.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#'));
    return para ? para.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

const IMG = /\.(jpe?g|png|webp|gif)$/i;
async function findCover(dir) {
  for (const f of (await readdir(dir)).sort()) if (/^cover\./i.test(f) && IMG.test(f)) return join(dir, f);
  const shots = join(dir, 'screenshots');
  if (existsSync(shots)) {
    const f = (await readdir(shots)).sort().find((x) => IMG.test(x));
    if (f) return join(shots, f);
  }
  return null;
}

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

const projects = [];
for (const name of (await readdir(root)).sort()) {
  if (name.startsWith('.') || name.startsWith('_') || SKIP.has(name)) continue;
  const dir = join(root, name);
  if (!(await stat(dir)).isDirectory()) continue;
  if (only && name !== only) continue;

  const pkg = await readJson(join(dir, 'package.json'));
  const meta = pkg?.playground || {};
  const project = {
    name,
    title: meta.title || name,
    description: pkg?.description || (await readmeBlurb(dir)),
    tags: meta.tags || [],
    date: meta.date || '',
    live: false,
    cover: null,
  };
  const cover = await findCover(dir);
  if (cover) {
    const ext = cover.slice(cover.lastIndexOf('.')).toLowerCase();
    await mkdir(join(site, '_covers'), { recursive: true });
    await cp(cover, join(site, '_covers', name + ext));
    project.cover = `./_covers/${name}${ext}`;
  }

  if (pkg?.scripts?.build) {
    console.log(`\n▸ ${name}: npm install + build`);
    const install = existsSync(join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install';
    execSync(`${install} --no-audit --no-fund`, { cwd: dir, stdio: 'inherit' });
    execSync('npm run build', { cwd: dir, stdio: 'inherit' });
    const out = join(dir, 'dist');
    if (!existsSync(join(out, 'index.html'))) throw new Error(`${name}: the build did not produce dist/index.html`);
    await cp(out, join(site, name), { recursive: true });
    project.live = true;
  } else if (existsSync(join(dir, 'index.html'))) {
    console.log(`\n▸ ${name}: static, copied as is`);
    await cp(dir, join(site, name), { recursive: true, filter: (src) => !src.includes('node_modules') });
    project.live = true;
  } else {
    console.log(`\n▸ ${name}: code only`);
  }
  projects.push(project);
}

projects.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));

const card = (p) => `
      <li class="item">
        ${p.cover ? `${p.live ? `<a class="cover" href="./${esc(p.name)}/" tabindex="-1">` : '<span class="cover">'}<img src="${esc(p.cover)}" alt="" loading="lazy">${p.live ? '</a>' : '</span>'}` : ''}
        <div class="head">
          <h2>${p.live ? `<a href="./${esc(p.name)}/">${esc(p.title)}</a>` : esc(p.title)}</h2>
          ${p.date ? `<time datetime="${esc(p.date)}">${esc(p.date)}</time>` : ''}
        </div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <div class="foot">
          ${p.tags.length ? `<ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<span></span>'}
          <span class="links">
            ${p.live ? `<a class="open" href="./${esc(p.name)}/">Open</a>` : ''}
            <a href="https://github.com/${REPO}/tree/${BRANCH}/${encodeURIComponent(p.name)}">Code</a>
          </span>
        </div>
      </li>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Playground</title>
<meta name="description" content="Small experiments: games, toys and prototypes.">
${projects[0]?.cover ? `<meta property="og:image" content="https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/${projects[0].cover.slice(2)}">` : ''}
<style>
  :root {
    --bg: #f6f5f1; --fg: #1d211f; --muted: #66706a; --line: #dfddd5; --card: #ffffff; --accent: #2f7a52;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141716; --fg: #e9ece9; --muted: #98a29c; --line: #2a2f2c; --card: #1a1e1c; --accent: #7cc79c; color-scheme: dark; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 var(--sans); }
  main { max-width: 760px; margin: 0 auto; padding: 56px 20px 72px; }
  header { margin-bottom: 36px; }
  h1 { margin: 0; font-size: 32px; letter-spacing: -0.02em; }
  header p { margin: 6px 0 0; color: var(--muted); }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .item { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; overflow: hidden; }
  .cover { display: block; margin: -18px -20px 16px; aspect-ratio: 16 / 9; background: var(--line); }
  .cover img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .4s ease; }
  a.cover:hover img { transform: scale(1.02); }
  @media (prefers-reduced-motion: reduce) { .cover img { transition: none; } }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  h2 { margin: 0; font-size: 19px; }
  h2 a { color: inherit; text-decoration: none; }
  h2 a:hover { color: var(--accent); }
  time { font: 13px var(--mono); color: var(--muted); white-space: nowrap; }
  .item p { margin: 6px 0 14px; color: var(--muted); }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .tags { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  .tags li { font: 12px var(--mono); color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; }
  .links { display: flex; gap: 16px; font-size: 14px; }
  .links a { color: var(--muted); }
  .links a.open { color: var(--accent); font-weight: 600; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
  footer { margin-top: 40px; font-size: 14px; color: var(--muted); }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Playground</h1>
    <p>Small experiments: games, toys and prototypes. Each one opens in the browser.</p>
  </header>
  <ol>${projects.map(card).join('')}
  </ol>
  <footer>Source on <a href="https://github.com/${REPO}">GitHub</a>.</footer>
</main>
</body>
</html>
`;

await writeFile(join(site, 'index.html'), page);
await writeFile(join(site, '.nojekyll'), '');
console.log(`\nSite ready in _site/ with ${projects.length} project(s): ${projects.map((p) => p.name).join(', ')}`);
