// ═══════════════════════════════════════════════════════════
//  Electron main process — owns the database. The renderer is sandboxed
//  (no Node, context isolation) and can only reach the whitelisted API.
// ═══════════════════════════════════════════════════════════
import './compat';
import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, safeStorage, shell } from 'electron';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, getSetting, setSetting } from '../server/db';
import { ApiError, createApi, type SecretStore } from '../server/api';
import type { Role } from '../shared/types';
import { seedDemo } from '../server/demo';
import { importLegacy, parseLegacy } from '../server/legacy';
import { nowLocal, toDateStr } from '../shared/time';
import { lanAddresses, startMobileServer, type MobileServer } from '../server/mobileServer';
import { generateCertificate, serverFingerprint } from '../server/tls';
import { QUIET_METHODS, isRead } from '../shared/apiMethods';

const dataDir = process.env.ANTIBIOME_DATA_DIR || join(app.getPath('userData'), 'data');
mkdirSync(dataDir, { recursive: true });
const dbFile = join(dataDir, 'antibiome.db');
const backupDir = join(dataDir, 'backups');
const BACKUPS_KEPT = 14;

if (!app.requestSingleInstanceLock()) app.quit();

const db = openDatabase(dbFile);
/** API keys are encrypted with the OS keychain (DPAPI on Windows); never stored in clear text. */
const secrets: SecretStore = {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  load: key => {
    const v = getSetting(db, `secret:${key}`);
    if (!v || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { return null; }
  },
  save: (key, value) => {
    if (value == null) { db.prepare('DELETE FROM settings WHERE key = ?').run(`secret:${key}`); return; }
    setSetting(db, `secret:${key}`, safeStorage.encryptString(value).toString('base64'));
  },
};
const api = createApi(db, Date.now, { secrets });
let win: BrowserWindow | null = null;

/** One automatic snapshot per day (VACUUM INTO is a consistent online copy); keep the last 14. */
function dailyBackup() {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `antibiome-${toDateStr(new Date())}.db`);
  if (!existsSync(target)) db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  readdirSync(backupDir).filter(f => /^antibiome-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(BACKUPS_KEPT)
    .forEach(f => rmSync(join(backupDir, f)));
}

const requireRole = (...roles: Role[]) => api.authorize(roles);
const auditDesktop = (action: string, entity: string, summary: string) =>
  db.prepare('INSERT INTO audit_log(at, user_id, username, action, entity, summary) VALUES (?,?,?,?,?,?)').run(nowLocal(), api.session.user?.id ?? null, api.session.user?.displayName ?? 'system', action, entity, summary);

// ── Phone access over the hospital Wi-Fi (off by default) ──────────
const tlsDir = join(dataDir, 'tls');
const DEFAULT_PORT = 8443;
let mobile: MobileServer | null = null;
let mobileError: string | null = null;
let mobileFingerprint: string | null = null;
let blocker: number | null = null;

/** IT-issued PFX if loaded (passphrase in the OS keychain), else the generated certificate (created once). */
async function tlsOptions() {
  mkdirSync(tlsDir, { recursive: true });
  const pfx = join(tlsDir, 'hospital.pfx');
  if (existsSync(pfx)) return { pfx: readFileSync(pfx), passphrase: secrets.load('mobile-pfx-passphrase') ?? undefined };
  const keyFile = join(tlsDir, 'key.pem'), certFile = join(tlsDir, 'cert.pem');
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    const g = await generateCertificate(lanAddresses());
    writeFileSync(keyFile, g.key, { mode: 0o600 }); try { chmodSync(keyFile, 0o600); } catch { /* Windows: ACLs of the data folder apply */ }
    writeFileSync(certFile, g.cert);
  }
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}

async function startMobile() {
  await stopMobile();
  mobileError = null;
  try {
    const port = Number(getSetting(db, 'mobilePort', String(DEFAULT_PORT)));
    mobile = await startMobileServer({ api, db, distDir: join(__dirname, '../dist'), tls: await tlsOptions(), port, onPhoneMutation: () => win?.webContents.send('changed') });
    mobileFingerprint = await serverFingerprint(mobile.port);
    if (blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e: any) {
    mobile = null;
    mobileError = e?.code === 'EADDRINUSE' ? 'That port is already in use — choose another.' : e?.message ?? String(e);
    console.error('[mobile]', e);
  }
}
async function stopMobile() {
  if (mobile) { await mobile.close(); mobile = null; }
  if (blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
}
function mobileStatus() {
  const port = mobile?.port ?? Number(getSetting(db, 'mobilePort', String(DEFAULT_PORT)));
  const addresses = lanAddresses();
  return {
    enabled: getSetting(db, 'mobileEnabled') === '1', running: !!mobile, error: mobileError, port, addresses,
    urls: addresses.map(a => `https://${a}:${port}`), fingerprint: mobile ? mobileFingerprint : null,
    certificate: existsSync(join(tlsDir, 'hospital.pfx')) ? 'hospital' : 'generated', clients: mobile?.clients() ?? 0,
    secureStorage: secrets.available(),
  };
}

// Desktop-only operations that need native dialogs.
const desktopRoutes: Record<string, (p: any) => unknown> = {
  'desktop.info': () => {
    requireRole('admin', 'clinician', 'viewer', 'researcher');
    return { dataDir, dbFile, version: app.getVersion(), demo: getSetting(db, 'demoData') === '1' };
  },
  'desktop.backupNow': async () => {
    requireRole('admin');
    const res = await dialog.showSaveDialog(win!, { title: 'Save database backup', defaultPath: `antibiome-backup-${toDateStr(new Date())}.db`, filters: [{ name: 'SQLite database', extensions: ['db'] }] });
    if (res.canceled || !res.filePath) return null;
    if (existsSync(res.filePath)) rmSync(res.filePath);
    db.exec(`VACUUM INTO '${res.filePath.replace(/'/g, "''")}'`);
    db.prepare("INSERT INTO audit_log(at, user_id, username, action, entity, summary) VALUES (?, ?, ?, 'backup', 'system', ?)")
      .run(nowLocal(), api.session.user!.id, api.session.user!.displayName, 'Manual database backup saved');
    return res.filePath;
  },
  'desktop.openDataFolder': () => { requireRole('admin'); return shell.openPath(dataDir); },
  'desktop.saveCsv': async (p: { csv: string; name: string }) => {
    requireRole('admin', 'researcher');
    const res = await dialog.showSaveDialog(win!, { title: 'Save export', defaultPath: p.name, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, p.csv, 'utf8');
    return res.filePath;
  },
  'desktop.importLegacy': async () => {
    requireRole('admin');
    const res = await dialog.showOpenDialog(win!, { title: 'Import Antibiome cultures', properties: ['openFile'], filters: [{ name: 'Antibiome export', extensions: ['csv', 'json'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return importLegacy(db, parseLegacy(readFileSync(res.filePaths[0], 'utf8')), api.session.user!.id);
  },
  'desktop.loadDemo': () => {
    requireRole('admin');
    const n = (db.prepare('SELECT COUNT(*) n FROM admissions').get() as any).n;
    if (n > 0) throw new ApiError('Demo data can only be loaded into an empty database');
    return seedDemo(db);
  },
  'desktop.mobileStatus': () => { requireRole('admin'); return mobileStatus(); },
  'desktop.mobileEnable': async (p: { on: boolean; port?: number }) => {
    requireRole('admin');
    if (p.port != null) {
      const port = Number(p.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ApiError('Port must be between 1024 and 65535');
      setSetting(db, 'mobilePort', String(port));
    }
    setSetting(db, 'mobileEnabled', p.on ? '1' : '0');
    if (p.on) await startMobile(); else { await stopMobile(); mobileError = null; }
    auditDesktop('update', 'settings', p.on ? `Phone access turned on (port ${mobileStatus().port})${mobileError ? ` — failed: ${mobileError}` : ''}` : 'Phone access turned off');
    return mobileStatus();
  },
  'desktop.mobileLoadPfx': async (p: { passphrase?: string }) => {
    requireRole('admin');
    if (p.passphrase && !secrets.available()) throw new ApiError('Secure storage is not available on this computer, so a certificate passphrase cannot be stored safely.');
    const res = await dialog.showOpenDialog(win!, { title: 'Hospital certificate (PFX / PKCS#12)', properties: ['openFile'], filters: [{ name: 'Certificate', extensions: ['pfx', 'p12'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const buf = readFileSync(res.filePaths[0]);
    try { (await import('node:tls')).createSecureContext({ pfx: buf, passphrase: p.passphrase || undefined }); } catch { throw new ApiError('Could not open that certificate — check the file and passphrase.'); }
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(join(tlsDir, 'hospital.pfx'), buf, { mode: 0o600 });
    secrets.save('mobile-pfx-passphrase', p.passphrase || null);
    auditDesktop('update', 'settings', 'Hospital TLS certificate loaded for phone access');
    if (mobile) await startMobile();
    return mobileStatus();
  },
  'desktop.mobileResetCert': async () => {
    requireRole('admin');
    ['hospital.pfx', 'key.pem', 'cert.pem'].forEach(f => rmSync(join(tlsDir, f), { force: true }));
    secrets.save('mobile-pfx-passphrase', null);
    auditDesktop('update', 'settings', 'Phone-access certificate reset (new self-signed certificate)');
    if (mobile) await startMobile();
    return mobileStatus();
  },
  'desktop.print': () => { requireRole('admin', 'clinician', 'viewer', 'researcher'); win?.webContents.print({ printBackground: true }); return true; },
};

ipcMain.handle('api', async (_e, method: string, params: unknown) => {
  try {
    const data = method.startsWith('desktop.') ? await desktopRoutes[method]?.(params) : await api.call(method, params);
    // Tell open phones to refresh after a change made on the PC.
    if (mobile && !isRead(method) && !QUIET_METHODS.has(method) && !method.startsWith('desktop.')) mobile.broadcast();
    return { ok: true, data };
  } catch (err) {
    const known = err instanceof ApiError;
    if (!known) console.error(`[api] ${method}`, err);
    return { ok: false, error: known ? err.message : 'Something went wrong. The error has been logged.' };
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0e0e0e', title: 'Antibiome PICU', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win?.show());
  // No navigation away from the app, no new windows.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(join(__dirname, '../dist/index.html'));

  // Headless screenshot hook used by scripts/screenshot.mjs (never set in normal use).
  if (process.env.ANTIBIOME_SCREENSHOT) {
    const shots = JSON.parse(process.env.ANTIBIOME_SCREENSHOT) as { hash: string; file: string; theme?: string; scroll?: number }[];
    win.webContents.once('did-finish-load', async () => {
      // Signs in with real credentials supplied by the script — there is no auth bypass.
      const [username, password] = (process.env.ANTIBIOME_SCREENSHOT_LOGIN ?? ':').split(':');
      await api.call('auth.login', { username, password });
      await win!.webContents.executeJavaScript(`localStorage.setItem('antibiome-theme', ${JSON.stringify(shots[0]?.theme ?? 'dark')})`);
      win!.webContents.reload();
      await new Promise<void>(r => win!.webContents.once('did-finish-load', () => r()));
      for (const s of shots) {
        await win!.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(s.theme ?? 'dark')}; location.hash=${JSON.stringify(s.hash)};`);
        await new Promise(r => setTimeout(r, 2600));
        if (s.scroll) {
          await win!.webContents.executeJavaScript(`document.querySelector('main .overflow-y-auto').scrollTop = ${Number(s.scroll)};`);
          await new Promise(r => setTimeout(r, 400));
        }
        writeFileSync(s.file, (await win!.webContents.capturePage()).toPNG());
      }
      app.quit();
    });
  }
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'File', submenu: [{ role: 'quit' }] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
]));

app.whenReady().then(() => {
  try { dailyBackup(); } catch (e) { console.error('[backup]', e); }
  createWindow();
  if (getSetting(db, 'mobileEnabled') === '1') startMobile();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', async () => { await stopMobile(); db.close(); app.quit(); });
