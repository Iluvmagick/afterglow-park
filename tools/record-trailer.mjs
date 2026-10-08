// Trailer recorder: serves the game like server.mjs, plus a few local-only endpoints that the
// in-game trailer mode (?trailer) posts to. Video frames (JPEG) are piped straight into ffmpeg;
// the offline-rendered soundtrack (WAV) is muxed in at the end -> trailer.mp4 in the project root.
//
//   npm run trailer   then open http://localhost:5318/?trailer
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 5318;
const work = join(root, '.trailer-tmp');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

let ff = null;
let ffDone = null;
let frames = 0;

const body = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

async function handleRec(req, res, url) {
  const what = url.pathname.slice('/__rec/'.length);
  if (what === 'start') {
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const fps = url.searchParams.get('fps') || '30';
    frames = 0;
    ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '22', '-pix_fmt', 'yuv420p', join(work, 'video.mp4')], {
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    ffDone = new Promise((resolve) => ff.on('exit', resolve));
    return res.end('ok');
  }
  if (what === 'frame') {
    const jpg = await body(req);
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    frames++;
    if (frames % 150 === 0) console.log(`  ${frames} frames`);
    return res.end('ok');
  }
  if (what === 'audio') {
    await writeFile(join(work, 'audio.wav'), await body(req));
    return res.end('ok');
  }
  if (what === 'end') {
    ff.stdin.end();
    await ffDone;
    const out = join(root, 'trailer.mp4');
    await run(['-y', '-i', join(work, 'video.mp4'), '-i', join(work, 'audio.wav'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    await rm(work, { recursive: true, force: true });
    console.log(`wrote ${out} (${frames} frames)`);
    return res.end(out);
  }
  res.writeHead(404).end();
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/__rec/') && req.method === 'POST') return await handleRec(req, res, url);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(String(e.message || e));
  }
}).listen(port, '127.0.0.1', () => console.log(`trailer recorder at http://localhost:${port}/?trailer`));
