// Static build: bundles the game (three.js included, tree-shaken and minified) into dist/ so it can be
// hosted as plain files anywhere, e.g. embedded in a blog. Everything runs in the player's browser.
//
//   npm run build   ->  dist/index.html, dist/style.css, dist/game.js
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: join(out, 'game.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  logLevel: 'warning',
});

let html = await readFile(join(root, 'index.html'), 'utf8');
const importMap = /\s*<script type="importmap">[\s\S]*?<\/script>/;
const entry = '<script type="module" src="./src/main.js"></script>';
if (!importMap.test(html) || !html.includes(entry)) throw new Error('index.html changed shape: update tools/build.mjs');
html = html.replace(importMap, '').replace(entry, '<script type="module" src="./game.js"></script>');
await writeFile(join(out, 'index.html'), html);
await copyFile(join(root, 'style.css'), join(out, 'style.css'));

for (const f of ['index.html', 'style.css', 'game.js']) console.log(`dist/${f}  ${((await stat(join(out, f))).size / 1024).toFixed(0)} KB`);
