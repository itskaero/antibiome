// Windows 7 edition: the same app on Electron 22 — the last release that runs on Windows 7 —
// with the renderer built for Chromium 108 and the main process for Node 16. 32- and 64-bit.
import { execSync } from 'node:child_process';
import { Arch, build, Platform } from 'electron-builder';

process.env.ANTIBIOME_WIN7 = '1';
const run = cmd => execSync(cmd, { stdio: 'inherit' });
run('npm run typecheck');
run('npx vite build');
run('node scripts/win7-css.mjs');
run('node scripts/build-electron.mjs');

await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.ia32, Arch.x64),
  config: {
    electronVersion: '22.3.27',
    nsis: { artifactName: '${productName} Setup ${version} Windows 7.${ext}' },
    portable: { artifactName: '${productName} ${version} Portable ${arch} Windows 7.${ext}' },
  },
});
