// ═══════════════════════════════════════════════════════════
//  Electron main process — owns the database. The renderer is sandboxed
//  (no Node, context isolation) and can only reach the whitelisted API.
// ═══════════════════════════════════════════════════════════
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, getSetting, setSetting } from '../server/db';
import { ApiError, createApi, type SecretStore } from '../server/api';
import type { Role } from '../shared/types';
import { seedDemo } from '../server/demo';
import { importLegacy, parseLegacy } from '../server/legacy';
import { nowLocal, toDateStr } from '../shared/time';

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
  'desktop.print': () => { requireRole('admin', 'clinician', 'viewer', 'researcher'); win?.webContents.print({ printBackground: true }); return true; },
};

ipcMain.handle('api', async (_e, method: string, params: unknown) => {
  try {
    const data = method.startsWith('desktop.') ? await desktopRoutes[method]?.(params) : await api.call(method, params);
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
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { db.close(); app.quit(); });
