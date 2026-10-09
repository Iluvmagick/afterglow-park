// Static build: bundles the game (three.js included, tree-shaken and minified) into dist/ so it can be
// hosted as plain files anywhere, e.g. embedded in a blog. Everything runs in the player's browser.
//
//   npm run build   ->  dist/index.html, dist/style.css, dist/game.js (+ game.js.br and .htaccess for Apache)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as Z } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// three.js ships the GLSL for all its built-in materials (lit, physical, shadows, ...): about 190 KB
// that tree-shaking can't remove, because the renderer refers to the whole library. The game draws
// everything with its own shaders (src/render/ps1.js), which only need the two chunks the renderer
// adds to every custom shader. Everything else is emptied.
const KEEP_CHUNKS = new Set(['colorspace_pars_fragment', 'tonemapping_pars_fragment']);
const dropUnusedShaders = {
  name: 'drop-unused-three-shaders',
  setup(b) {
    b.onLoad({ filter: /three[\\/]build[\\/]three\.module\.js$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      // the chunks and the built-in materials' shaders are all declared just before the ShaderChunk table
      const start = src.indexOf('var alphahash_fragment = ');
      const end = src.indexOf('const ShaderChunk = {');
      if (start < 0 || end < start) throw new Error('three.js changed shape (no shader chunks found): update tools/build.mjs');
      let dropped = 0;
      const shaders = src.slice(start, end).replace(/^(var|const) ([\w$]+) = "(?:[^"\\]|\\.)*";$/gm, (line, kind, name) => {
        if (KEEP_CHUNKS.has(name)) return line;
        dropped++;
        return `${kind} ${name} = "";`;
      });
      if (dropped < 100) throw new Error(`three.js changed shape (${dropped} shaders found): update tools/build.mjs`);
      return { contents: src.slice(0, start) + shaders + src.slice(end), loader: 'js' };
    });
  },
};

await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: join(out, 'game.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  define: { 'globalThis.NO_TRAILER': 'true' }, // drop the trailer recorder, the only code that talks to a server
  plugins: [dropUnusedShaders],
  logLevel: 'warning',
});

let html = await readFile(join(root, 'index.html'), 'utf8');
const importMap = /\s*<script type="importmap">[\s\S]*?<\/script>/;
const entry = '<script type="module" src="./src/main.js"></script>';
if (!importMap.test(html) || !html.includes(entry)) throw new Error('index.html changed shape: update tools/build.mjs');
html = html.replace(importMap, '').replace(entry, '<script type="module" src="./game.js"></script>');
await writeFile(join(out, 'index.html'), html);
await copyFile(join(root, 'style.css'), join(out, 'style.css'));

// game.js squeezed once with Brotli at its highest level: smaller than any server compresses on the
// fly. Apache (the blog's host) serves it to browsers that take Brotli, thanks to this .htaccess;
// other hosts just ignore both files. The rewrite only happens where the headers can be set too.
const js = await readFile(join(out, 'game.js'));
await writeFile(join(out, 'game.js.br'), brotliCompressSync(js, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: js.length } }));
await writeFile(
  join(out, '.htaccess'),
  `# Apache: send game.js pre-compressed with Brotli to browsers that accept it (others get the usual gzip),
# and have browsers check for a new version on every visit (a tiny "not modified" when nothing changed).
<IfModule mod_headers.c>
  <IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{HTTP:Accept-Encoding} br
    RewriteCond %{REQUEST_FILENAME}.br -f
    RewriteRule ^game\\.js$ game.js.br [L]
  </IfModule>
  <Files "game.js.br">
    ForceType "text/javascript; charset=utf-8"
    Header set Content-Encoding br
    Header append Vary Accept-Encoding
    SetEnv no-gzip 1
  </Files>
  <FilesMatch "\\.(html|css|js|br)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`,
);

for (const f of ['index.html', 'style.css', 'game.js', 'game.js.br']) console.log(`dist/${f}  ${((await stat(join(out, f))).size / 1024).toFixed(0)} KB`);
