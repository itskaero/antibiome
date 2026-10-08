// End-to-end check of phone access: runs the real (built) desktop app with phone access on,
// then drives a phone-sized Chromium against it over HTTPS and watches the PC window update live.
// Usage: xvfb-run -a node scripts/mobile-e2e.mjs <outDir>     (needs `playwright` resolvable, e.g. NODE_PATH)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _electron, chromium, devices } = require('playwright');
const out = resolve(process.argv[2] ?? 'mobile-e2e');
mkdirSync(out, { recursive: true });
const PORT = 18443, CODE = 'TEST2345';
const dataDir = mkdtempSync(join(tmpdir(), 'antibiome-e2e-'));
await build({ entryPoints: ['scripts/make-demo-db.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['node:sqlite'], outfile: join(dataDir, 'seed.mjs'), logLevel: 'error' });
execFileSync(process.execPath, [join(dataDir, 'seed.mjs'), join(dataDir, 'antibiome.db')], { stdio: 'inherit' });
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(join(dataDir, 'antibiome.db'));
db.prepare("INSERT INTO settings(key, value) VALUES ('mobileEnabled', '1'), ('mobilePort', ?)").run(String(PORT));
db.prepare('INSERT INTO pairing_codes(code_hash, created_by, expires_at) VALUES (?, 1, ?)').run(createHash('sha256').update(CODE).digest('hex'), Date.now() + 600_000);
const target = db.prepare("SELECT a.id, a.bed FROM admissions a JOIN episodes e ON e.admission_id = a.id AND e.kind = 'resp' AND e.end_at IS NULL AND e.detail = 'O2' WHERE a.discharge_at IS NULL ORDER BY CAST(a.bed AS INTEGER) LIMIT 1").get();
db.close();

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const step = msg => console.log(`✓ ${msg}`);
let app, browser, failed = false;
try {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox', '--force-device-scale-factor=1'], env: { ...process.env, ANTIBIOME_DATA_DIR: dataDir } });
  const pc = await app.firstWindow();
  pc.on('dialog', d => d.accept());
  await pc.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await pc.fill('input[autocomplete=username]', 'demo');
  await pc.fill('input[autocomplete=current-password]', 'demo-password');
  await pc.click('button:has-text("Sign in")');
  await pc.waitForSelector('text=Command centre');
  await pc.evaluate(id => { location.hash = `/patient/${id}`; }, target.id);
  await pc.waitForSelector('text=Vital signs');
  step('PC signed in, patient page open');

  // Wait for the HTTPS server.
  browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
  const phone = await ctx.newPage();
  phone.on('dialog', d => d.accept());
  if (process.env.E2E_DEBUG) phone.on('response', async r => { if (r.url().endsWith('/api')) { const b = r.request().postDataJSON(); const j = await r.json().catch(() => ({})); console.log('[phone]', b?.method, j.ok, j.error ?? ''); } });
  for (let i = 0; i < 40; i++) { try { await phone.goto(`https://127.0.0.1:${PORT}/#/pair/${CODE}`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  await phone.waitForSelector('text=Pair this phone');
  await phone.fill('input >> nth=1', "Dr Test's phone");
  await shot(phone, '01-phone-pair');
  await phone.click('button:has-text("Pair phone")');
  await phone.waitForSelector('text=Sign in to');
  step('Phone paired');
  await phone.fill('input[autocomplete=username]', 'nurse');
  await phone.fill('input[autocomplete=current-password]', 'nurse-password');
  await shot(phone, '02-phone-login');
  await phone.click('button:has-text("Sign in")');
  await phone.waitForSelector('text=Names are hidden on phones');
  await shot(phone, '03-phone-census');
  step('Phone signed in; census shows without names');

  // Change support on the target bed (one tap + confirm) and check the PC census sees it.
  const card = phone.locator('.card', { hasText: `` }).filter({ has: phone.locator(`span.tnum:text-is("${target.bed}")`) }).first();
  await card.locator('button:text-is("HFNC")').click();
  await phone.waitForTimeout(800);
  const level = await pc.evaluate(async id => (await window.antibiome.call('census.list')).data.rows.find(r => r.admission.id === id).resp.level, target.id);
  if (level !== 'HFNC') throw new Error(`PC did not record the support change (got ${level})`);
  step(`Support change from phone recorded on the PC (bed ${target.bed} → HFNC)`);

  // Open the patient and record vitals; the PC's open patient page must refresh by itself.
  await card.locator('button').first().click();
  await phone.waitForSelector('text=Vital signs');
  await phone.click('button:has-text("Record")');
  await phone.fill('[aria-label="Heart rate"]', '177');
  await phone.fill('[aria-label="Respiratory rate"]', '48');
  await phone.fill('[aria-label="SpO₂"]', '91');
  await phone.fill('[aria-label="Systolic BP"]', '72');
  await phone.fill('[aria-label="Diastolic BP"]', '40');
  await phone.fill('[aria-label="Temperature"]', '38.9');
  await phone.waitForTimeout(300);
  await shot(phone, '04-phone-record-vitals');
  await phone.click('button:has-text("Save vitals")');
  await phone.waitForSelector('text=Vital signs recorded');
  await phone.waitForSelector(`text=Latest · ${new Date().toISOString().slice(0, 10)}`, { timeout: 10000 });
  await phone.locator('text=Vital signs').first().scrollIntoViewIfNeeded();
  await phone.waitForTimeout(400);
  await shot(phone, '05-phone-patient');
  await pc.waitForSelector('text=HR 177', { timeout: 8000 });
  await shot(pc, '06-pc-live-update');
  step('Vitals from phone appeared on the PC without a reload');

  // Admission sheet, summary and "Me" on the phone.
  await phone.click('nav button:has-text("Admit")');
  await phone.waitForSelector('text=New admission');
  await phone.waitForTimeout(500);
  await shot(phone, '07-phone-admit');
  await phone.click('[aria-label=Close]');
  await phone.click('nav button:has-text("Summary")');
  await phone.waitForSelector('text=Unit summary');
  await phone.waitForTimeout(500);
  await shot(phone, '08-phone-summary');
  await phone.click('nav button:has-text("Me")');
  await phone.waitForSelector("text=Dr Test's phone");
  await shot(phone, '09-phone-me');

  // PC-only methods are refused from the phone.
  const denied = await phone.evaluate(async () => {
    const dev = JSON.parse(localStorage.getItem('antibiome-device'));
    const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev.deviceId, 'X-Device-Secret': dev.secret }, body: JSON.stringify({ method: 'export.deidentified', params: {} }) });
    return (await r.json()).error;
  });
  if (!/PC only/.test(denied)) throw new Error(`Export was not refused: ${denied}`);
  step('Research export refused from the phone');

  // PC settings card and pairing QR.
  await pc.evaluate(() => { location.hash = '/settings'; });
  await pc.waitForSelector('text=Phone access over the hospital Wi-Fi');
  await pc.waitForSelector("text=Dr Test's phone");
  await pc.evaluate(() => { const h = [...document.querySelectorAll('h2,h3,span')].find(e => e.textContent === 'Phone access over the hospital Wi-Fi'); h?.closest('.card')?.scrollIntoView({ block: 'start' }); });
  await pc.waitForTimeout(400);
  await shot(pc, '10-pc-settings-phone-access');
  await pc.click('button:has-text("Pair a phone")');
  await pc.waitForSelector('img[alt="Pairing QR code"]');
  await shot(pc, '11-pc-pair-qr');
  step('PC settings show the paired phone and a pairing QR code');

  // Revoking the phone signs it out on its next request.
  await pc.click('[role=dialog] button:has-text("Done")');
  await pc.waitForSelector('[role=dialog]', { state: 'detached' });
  const revoke = pc.locator(`[data-device="Dr Test's phone"] button`);
  await revoke.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await revoke.click();
  // The revoke is broadcast, so the open phone notices on its own (no tap needed).
  await phone.waitForSelector('text=Pair this phone', { timeout: 8000 });
  await shot(phone, '12-phone-revoked');
  step('Revoked phone is sent back to pairing');
} catch (e) {
  failed = true;
  console.error('✗', e);
} finally {
  await browser?.close();
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
