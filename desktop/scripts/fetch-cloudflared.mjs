// Downloads the Cloudflare Tunnel connector (cloudflared, Apache-2.0) that the Windows installers ship in
// resources/cloudflared/, so "Access from home" works without installing anything.
//
//   node scripts/fetch-cloudflared.mjs win7      → 2023.10.0, the last release built with Go 1.20 (runs on Windows 7); checksum pinned
//   node scripts/fetch-cloudflared.mjs current   → the latest release (Windows 10/11); its checksum is printed for the build log
//
// The 32-bit build is used for both editions: it runs on 32- and 64-bit Windows.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
const PINNED = { win7: { version: '2023.10.0', sha256: '2fb6c04c4f95fb8d158af94c137f90ac820716deaf88d8ebec956254e046cb29' } };
if (!['win7', 'current'].includes(target)) { console.error('usage: fetch-cloudflared.mjs win7|current'); process.exit(2); }

const dir = 'build/bin', out = `${dir}/cloudflared.exe`, marker = `${dir}/cloudflared.version`;
mkdirSync(dir, { recursive: true });
const pin = PINNED[target];
const sha = buf => createHash('sha256').update(buf).digest('hex');
if (pin && existsSync(out) && sha(readFileSync(out)) === pin.sha256) { console.log(`cloudflared ${pin.version} already present`); process.exit(0); }

const url = pin
  ? `https://github.com/cloudflare/cloudflared/releases/download/${pin.version}/cloudflared-windows-386.exe`
  : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe';
let buf = null, lastErr = null;
for (let attempt = 1; attempt <= 5 && !buf; attempt++) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000_000) throw new Error(`unexpectedly small download (${buf.length} bytes)`);
  } catch (e) {
    buf = null; lastErr = e;
    console.warn(`cloudflared download failed (attempt ${attempt}): ${e.message}`);
    await new Promise(r => setTimeout(r, attempt * 15_000));
  }
}
if (!buf) { console.error(`Could not download cloudflared: ${lastErr?.message}`); process.exit(1); }
const got = sha(buf);
if (pin && got !== pin.sha256) { console.error(`cloudflared checksum mismatch: expected ${pin.sha256}, got ${got}`); process.exit(1); }
writeFileSync(out, buf);
writeFileSync(marker, `${pin?.version ?? 'latest'} ${got}\n`);
console.log(`cloudflared ${pin?.version ?? 'latest'} saved (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${got})`);
