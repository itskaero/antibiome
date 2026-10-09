// Bundles the Electron main + preload processes (and the server/shared code they use) to CommonJS.
// ANTIBIOME_WIN7=1 targets the Windows 7 edition (Electron 22, Node 16).
import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

const common = {
  bundle: true,
  platform: 'node',
  target: process.env.ANTIBIOME_WIN7 ? 'node16' : 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'node:sqlite'],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' });
// SQLite fallback for Node versions without node:sqlite (see server/sqlite.ts).
copyFileSync('node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm', 'dist-electron/node-sqlite3-wasm.wasm');
