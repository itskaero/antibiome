// Dev loop: Vite dev server for the UI + Electron pointed at it.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;

await import('./build-electron.mjs');
const electronBin = (await import('electron')).default;
const child = spawn(electronBin, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
