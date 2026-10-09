// Renders film/index.html frame by frame with headless Chromium, then encodes with ffmpeg.
//   node film/render.mjs preview 2.8,6.6,10.8 out/        → PNG stills at those times
//   node film/render.mjs full out/                        → out/frames/*.jpg, then out/film.mp4 (with film/score.wav if present)
//   add --vertical for the 1080×1920 portrait cut (vertical.html, score-vertical.wav) → out/film-vertical.mp4,
//   encoded for WhatsApp (H.264 High, capped bitrate so the 50 s file stays under 16 MB)
// Needs Playwright (set PLAYWRIGHT_DIR to a folder whose node_modules has it) and ffmpeg on PATH.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, 'x.js') : import.meta.url);
const { chromium } = require('playwright');
const VERTICAL = process.argv.includes('--vertical');
const [mode = 'preview', a1, a2] = process.argv.slice(2).filter(a => a !== '--vertical');
const FPS = 30, DURATION = VERTICAL ? 50 : 45;
const [VW, VH] = VERTICAL ? [1080, 1920] : [1920, 1080];
const url = pathToFileURL(join(here, VERTICAL ? 'vertical.html' : 'index.html')).href;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page;
}
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text'] });

if (mode === 'preview') {
  const out = resolve(a2 ?? join(here, 'preview')); mkdirSync(out, { recursive: true });
  const page = await openPage(browser);
  for (const t of (a1 ?? '1').split(',').map(Number)) {
    await page.evaluate(x => window.seek(x), t);
    await page.screenshot({ path: join(out, `t${t.toFixed(2)}.png`) });
  }
  console.log(`preview → ${out}`);
} else {
  const out = resolve(a1 ?? join(here, 'out')), frames = join(out, 'frames');
  if (existsSync(frames)) rmSync(frames, { recursive: true });
  mkdirSync(frames, { recursive: true });
  const total = FPS * DURATION, workers = 6, started = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage(browser);
    for (let f = w; f < total; f += workers) {
      await page.evaluate(x => window.seek(x), f / FPS);
      await page.screenshot({ path: join(frames, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
      if (++done % 90 === 0) console.log(`${done}/${total} frames · ${Math.round((Date.now() - started) / 1000)} s`);
    }
  }));
  const audio = join(here, VERTICAL ? 'score-vertical.wav' : 'score.wav');
  const args = ['-y', '-v', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%05d.jpg')];
  if (existsSync(audio)) args.push('-i', audio);
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (VERTICAL) args.push('-profile:v', 'high', '-level', '4.1', '-maxrate', '2300k', '-bufsize', '4600k');
  if (existsSync(audio)) args.push('-c:a', 'aac', '-b:a', VERTICAL ? '160k' : '256k', '-shortest');
  const file = join(out, VERTICAL ? 'film-vertical.mp4' : 'film.mp4');
  args.push(file);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`film → ${file}`);
}
await browser.close();
