// ═══════════════════════════════════════════════════════════
//  Local SQLite database (Node's built-in node:sqlite — no native build).
//  One file on the PICU PC; WAL mode; foreign keys on; versioned migrations.
// ═══════════════════════════════════════════════════════════
import { DatabaseSync } from 'node:sqlite';
import { ensureBuiltInModules } from './modules';

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  // v1 — PICU core
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','clinician','viewer','researcher')),
    pw_hash TEXT NOT NULL,
    pw_salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- Pseudonymous patient. Identifiers live in patient_identifiers (clinical roles only).
  CREATE TABLE patients (
    id TEXT PRIMARY KEY,
    sex TEXT NOT NULL CHECK (sex IN ('M','F')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE patient_identifiers (
    patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    mrn TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    dob TEXT
  );

  CREATE TABLE admissions (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id),
    bed TEXT,
    admit_at TEXT NOT NULL,
    age_months REAL NOT NULL,
    weight_kg REAL,
    source TEXT NOT NULL,
    admission_type TEXT NOT NULL CHECK (admission_type IN ('emergency','elective')),
    chronic_condition INTEGER NOT NULL DEFAULT 0,
    malnutrition INTEGER NOT NULL DEFAULT 0,
    arrival_support TEXT NOT NULL DEFAULT 'RA',
    shock_on_arrival INTEGER NOT NULL DEFAULT 0,
    coma_on_arrival INTEGER NOT NULL DEFAULT 0,
    discharge_at TEXT,
    disposition TEXT,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_adm_patient ON admissions(patient_id);
  CREATE INDEX idx_adm_dates ON admissions(admit_at, discharge_at);

  CREATE TABLE diagnoses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary','secondary'))
  );
  CREATE INDEX idx_dx_adm ON diagnoses(admission_id);

  -- Interval data: respiratory support, vasoactives, antimicrobials.
  CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    admission_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('resp','vaso','abx')),
    detail TEXT NOT NULL,
    intent TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT,
    end_reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_ep_adm ON episodes(admission_id);

  -- Point events: procedures, complications, culture sent, notes.
  CREATE TABLE clinical_events (
    id TEXT PRIMARY KEY,
    admission_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    at TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_ev_adm ON clinical_events(admission_id);

  -- Microbiology (compatible with the original Antibiome culture record).
  CREATE TABLE cultures (
    id TEXT PRIMARY KEY,
    admission_id TEXT REFERENCES admissions(id),
    patient_id TEXT REFERENCES patients(id),
    unit TEXT NOT NULL DEFAULT 'PICU',
    collected_at TEXT NOT NULL,
    specimen TEXT NOT NULL,
    organism TEXT,
    age_group TEXT,
    legacy_label TEXT,
    source TEXT NOT NULL DEFAULT 'picu',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_cult_date ON cultures(collected_at);
  CREATE TABLE susceptibility_results (
    culture_id TEXT NOT NULL REFERENCES cultures(id) ON DELETE CASCADE,
    drug TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('S','I','R')),
    PRIMARY KEY (culture_id, drug)
  );

  -- Append-only audit trail (enforced by triggers below).
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT NOT NULL
  );
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `,
  // v2 — parameter system & disease modules
  `
  CREATE TABLE modules (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    trigger_dx TEXT NOT NULL DEFAULT '[]',   -- JSON array of diagnosis codes; empty = every admission
    derived TEXT NOT NULL DEFAULT '[]',      -- JSON array of derived-value ids
    outcomes TEXT NOT NULL DEFAULT '[]',
    exposures TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    built_in INTEGER NOT NULL DEFAULT 0,
    introduced_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE parameter_definitions (
    id TEXT PRIMARY KEY,                     -- module_id.key
    module_id TEXT NOT NULL REFERENCES modules(id),
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('number','boolean','choice','multi','date','datetime','text')),
    unit TEXT,
    options TEXT NOT NULL DEFAULT '[]',
    min REAL,
    max REAL,
    decimals INTEGER NOT NULL DEFAULT 1,
    capture TEXT NOT NULL CHECK (capture IN ('admission','discharge','daily','any')),
    required INTEGER NOT NULL DEFAULT 0,
    help TEXT,
    show_if TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    introduced_at TEXT NOT NULL,
    retired_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (module_id, key)
  );

  -- Every version of every definition, so old values can always be interpreted.
  CREATE TABLE parameter_versions (
    param_id TEXT NOT NULL REFERENCES parameter_definitions(id),
    version INTEGER NOT NULL,
    definition TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (param_id, version)
  );

  CREATE TABLE parameter_values (
    id TEXT PRIMARY KEY,
    admission_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
    param_id TEXT NOT NULL REFERENCES parameter_definitions(id),
    param_version INTEGER NOT NULL,
    value TEXT NOT NULL,                     -- JSON-encoded
    recorded_at TEXT,                        -- for repeated (daily) parameters
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_pv_adm ON parameter_values(admission_id, param_id);
  `,
];

export function openDatabase(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  ensureBuiltInModules(db);
  return db;
}

export function migrate(db: DB) {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const getSetting = (db: DB, key: string, fallback = '') =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
export const setSetting = (db: DB, key: string, value: string) =>
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
