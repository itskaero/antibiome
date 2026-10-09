import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db';

// The Windows 7 edition (Electron 22 / Node 16) has no node:sqlite and uses the WebAssembly driver.
describe('WebAssembly SQLite driver', () => {
  it('persists to a file and backs up with VACUUM INTO after reads', () => {
    process.env.ANTIBIOME_SQLITE = 'wasm';
    try {
      const dir = mkdtempSync(join(tmpdir(), 'antibiome-wasm-'));
      let db = openDatabase(join(dir, 'a.db'));
      expect(db.driver).toBe('wasm');
      db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('k', 'v');
      expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('k')).toEqual({ value: 'v' });
      expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('missing')).toBeUndefined();
      db.exec(`VACUUM INTO '${join(dir, 'b.db')}'`);
      expect(existsSync(join(dir, 'b.db'))).toBe(true);
      db.close();
      db = openDatabase(join(dir, 'a.db'));
      expect(db.prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?').get('k')).toEqual({ n: 1 });
      db.close();
    } finally {
      delete process.env.ANTIBIOME_SQLITE;
    }
  });

  it('opens a cleanly closed WAL-mode database from the regular edition', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'antibiome-wal-')), 'a.db');
    let db = openDatabase(file); // native driver, WAL
    expect(db.driver).toBe('native');
    db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('k', 'v');
    db.close();
    process.env.ANTIBIOME_SQLITE = 'wasm';
    try {
      db = openDatabase(file);
      expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('k')).toEqual({ value: 'v' });
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
      db.close();
      expect(existsSync(`${file}.wal-mode.bak`)).toBe(true);
    } finally {
      delete process.env.ANTIBIOME_SQLITE;
    }
  });

  it('refuses a WAL-mode database with pending WAL content instead of losing it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'antibiome-wal-')), 'a.db');
    openDatabase(file).close();
    writeFileSync(`${file}-wal`, 'pending');
    process.env.ANTIBIOME_SQLITE = 'wasm';
    try {
      expect(() => openDatabase(file)).toThrow(/not closed cleanly/);
    } finally {
      delete process.env.ANTIBIOME_SQLITE;
    }
  });
});
