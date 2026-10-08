// Renders the real Electron app (built) against a fresh demo database and saves PNGs.
// Usage: node scripts/screenshot.mjs <outDir>   (needs a display, e.g. xvfb-run)
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const out = resolve(process.argv[2] ?? 'screenshots');
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'antibiome-shot-'));
await build({ entryPoints: ['scripts/make-demo-db.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['node:sqlite'], outfile: join(dataDir, 'seed.mjs'), logLevel: 'error' });
execFileSync(process.execPath, [join(dataDir, 'seed.mjs'), join(dataDir, 'antibiome.db')], { stdio: 'inherit' });

const { DatabaseSync } = await import('node:sqlite');
const sdb = new DatabaseSync(join(dataDir, 'antibiome.db'));
const sick = sdb.prepare("SELECT a.id FROM admissions a JOIN episodes e ON e.admission_id = a.id WHERE a.discharge_at IS NULL AND e.kind = 'abx' ORDER BY a.admit_at LIMIT 1").get();
// "dx:CODE" in PAGES opens the most recent admission with that primary diagnosis (e.g. dx:GBS).
const byDx = code => sdb.prepare("SELECT a.id FROM admissions a JOIN diagnoses d ON d.admission_id = a.id AND d.role = 'primary' WHERE d.code = ? ORDER BY a.discharge_at IS NULL DESC, a.admit_at DESC LIMIT 1").get(code)?.id;
const resolvePage = p => { const [page, scroll] = p.split('@'); const r = page.startsWith('dx:') ? `patient/${byDx(page.slice(3))}` : page; return scroll ? `${r}@${scroll}` : r; };
const pages = (process.env.PAGES ?? `home,census,patient/${sick?.id},reconcile,micro,stewardship,report,quality,activity`).split(",").map(resolvePage);
sdb.close();
// "page@600" scrolls the main panel 600px before capturing.
const safeName = page => page.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
const shots = pages.flatMap((p, i) => { const [page, scroll] = p.split('@'); return [{ hash: `#/${page}`, file: join(out, `${String(i + 1).padStart(2, '0')}-${safeName(page)}${scroll ? `-${scroll}` : ''}-dark.png`), theme: 'dark', scroll: Number(scroll) || 0 }]; })
  .concat((process.env.LIGHT ?? 'home,census').split(',').filter(Boolean).map(p => ({ hash: `#/${p}`, file: join(out, `${p}-light.png`), theme: 'light' })));
const electron = (await import('electron')).default;
const r = spawnSync(electron, ['.', '--no-sandbox', '--force-device-scale-factor=1'], {
  stdio: 'inherit',
  env: { ...process.env, ANTIBIOME_DATA_DIR: dataDir, ANTIBIOME_SCREENSHOT: JSON.stringify(shots), ANTIBIOME_SCREENSHOT_LOGIN: 'demo:demo-password' },
});
rmSync(dataDir, { recursive: true, force: true });
process.exit(r.status ?? 0);
