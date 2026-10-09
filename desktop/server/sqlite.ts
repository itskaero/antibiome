// ═══════════════════════════════════════════════════════════
//  SQLite driver. Node's built-in node:sqlite where it exists (Node 22.5+);
//  otherwise a WebAssembly build of SQLite with direct file access, for the
//  Windows 7 edition that runs on Electron 22 (Node 16).
// ═══════════════════════════════════════════════════════════
import { closeSync, copyFileSync, existsSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

type Param = null | number | bigint | string | Uint8Array;
export interface RunResult { changes: number | bigint; lastInsertRowid: number | bigint }
export interface Statement {
  run(...params: Param[]): RunResult;
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
}
export interface Database {
  /** 'native' = node:sqlite (WAL-capable); 'wasm' = WebAssembly fallback (rollback journal). */
  readonly driver: 'native' | 'wasm';
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

export function openSqlite(file: string): Database {
  // ANTIBIOME_SQLITE=wasm forces the fallback (used to run the test suite against it).
  const builtin = process.env.ANTIBIOME_SQLITE === 'wasm' ? undefined
    : (process as any).getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
  return builtin ? nativeDb(new builtin.DatabaseSync(file)) : wasmDb(file);
}

function nativeDb(db: DatabaseSync): Database {
  return Object.assign(db as unknown as Omit<Database, 'driver'>, { driver: 'native' as const });
}

function wasmDb(file: string): Database {
  // Loaded lazily: the module reads node-sqlite3-wasm.wasm from next to the bundle.
  // (The bundled app has require; the ESM test runner resolves it from the project.)
  const { Database: WasmDatabase } = (typeof require === 'function'
    ? require('node-sqlite3-wasm')
    : createRequire(process.cwd() + '/')('node-sqlite3-wasm')) as typeof import('node-sqlite3-wasm');
  if (file !== ':memory:') leaveWalMode(file);
  const db = new WasmDatabase(file);
  // One-shot calls prepare and finalize each statement, so none is left open (an open
  // statement would block VACUUM INTO, and the wasm heap is not garbage-collected).
  const bind = (params: Param[]) => (params.length ? (params as any) : undefined);
  return {
    driver: 'wasm',
    exec: sql => db.exec(sql),
    prepare: sql => ({
      run: (...p) => db.run(sql, bind(p)) as RunResult,
      get: (...p) => db.get(sql, bind(p)) ?? undefined,
      all: (...p) => db.all(sql, bind(p)),
    }),
    close: () => db.close(),
  };
}

/**
 * The WebAssembly driver cannot open a WAL-mode database (no shared memory), e.g. one created by
 * the regular edition. A cleanly closed one is switched back to rollback-journal mode by setting
 * the file-format bytes 18–19 from 2 (WAL) to 1 (legacy); the original is kept alongside first.
 */
function leaveWalMode(file: string) {
  if (!existsSync(file)) return;
  const fd = openSync(file, 'r+');
  try {
    const header = Buffer.alloc(20);
    if (readSync(fd, header, 0, 20, 0) < 20 || header.toString('latin1', 0, 15) !== 'SQLite format 3' || header[18] !== 2) return;
    if (existsSync(`${file}-wal`) && statSync(`${file}-wal`).size > 0)
      throw new Error('This database was last used by the regular edition and was not closed cleanly. Open it once in the regular edition (Windows 10 or later), close the app, then copy it here again.');
    copyFileSync(file, `${file}.wal-mode.bak`);
    writeSync(fd, Buffer.from([1, 1]), 0, 2, 18);
  } finally {
    closeSync(fd);
  }
}
