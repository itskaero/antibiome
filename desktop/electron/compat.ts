// Web globals missing from Node 16 — the Windows 7 edition runs on Electron 22. Imported first by
// main.ts; a no-op on current Electron, where all of these already exist.
import { webcrypto } from 'node:crypto';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';

const g = globalThis as any;
if (typeof g.fetch !== 'function') {
  const undici = require('undici');
  Object.assign(g, { fetch: undici.fetch, Headers: undici.Headers, Request: undici.Request, Response: undici.Response, FormData: undici.FormData });
  g.File ??= undici.File;
}
g.ReadableStream ??= ReadableStream;
g.TransformStream ??= TransformStream;
g.WritableStream ??= WritableStream;
g.crypto ??= webcrypto;
