# Antibiome PICU — desktop app

A standalone **PICU intelligence** app for the unit's own PC. It wraps the original Antibiome
microbiology module (antibiogram, MDR, trends) in a longitudinal PICU layer: admissions → diagnoses →
respiratory / vasoactive / antimicrobial episodes → events → cultures → outcomes.

- **Runs offline.** Electron app; no server, no internet needed.
- **Local database.** A single SQLite file (Node's built-in `node:sqlite`, so nothing needs compiling),
  in WAL mode with an append-only audit log enforced by database triggers.
- **Fast entry.** Admission takes about 30 s with a visible timer. Bedside changes are one tap on the
  census board. A daily reconcile grid covers the whole unit in about a minute. Discharge takes about 20 s.

See [`../docs/PICU_INTELLIGENCE_PLAN.md`](../docs/PICU_INTELLIGENCE_PLAN.md) for the architecture assessment and roadmap.

## Screens

![Command centre (dark)](docs/screenshots/home-dark.png)

| | |
|---|---|
| ![Command centre (light)](docs/screenshots/home-light.png) | ![Census board](docs/screenshots/census-dark.png) |
| ![Antibiogram](docs/screenshots/micro-dark.png) | ![Stewardship](docs/screenshots/stewardship-dark.png) |

*Screenshots use the built-in synthetic demo data.*


| Screen | What it does |
|---|---|
| **Command centre** | KPI tiles (census/occupancy, admissions, ventilated, crude mortality, median LOS); census this month vs last; **“Antibiome noticed”** change cards; disease burden; respiratory & haemodynamic; antimicrobial DOT; MDR trend |
| **Census board** | Bed grid or list; one-tap respiratory support per bed; vasoactive / antimicrobial chips; data-quality and pending-culture flags |
| **Patient** | Current support & therapy, quick events (procedures, complications, culture sent), linked cultures, day-grouped timeline, discharge, edit |
| **Daily reconcile** | Whole-unit grid; only edited rows are saved, at a chosen time |
| **Microbiology** | Antibiogram (first-isolate de-duplication, n < 30 flagged), culture records, MDR isolates; PICU/NICU unit filter |
| **Stewardship** | DOT per 1,000 patient-days (12 months), AWaRe mix, empiric vs targeted, per-agent heat table |
| **Monthly report** | Printable one-page summary for leadership; de-identified research export (admin/researcher) |
| **Data quality** | Impossible / implausible / incomplete records, grouped by rule; nothing auto-corrected |
| **Activity** | The audit trail (who did what, when), grouped by day |
| **Settings** | Unit name and beds, users and roles, backup, import legacy Antibiome cultures, demo data |

Shortcuts: `Ctrl K` or `/` opens the command palette (patients, pages, actions), `A` admits, `B` opens the
census board, `R` opens the reconcile grid, and `Ctrl L` locks the app.

## Change detection (“Antibiome noticed”)

A change versus last month is headlined only if it is large (≥ 20% relative) **and** passes an exact
test at p < 0.05:

- Counts use a Poisson rate test per day, which handles a partial current month fairly.
- Proportions use Fisher's exact test.
- Days of therapy use a Poisson rate test per patient-day.

Large changes that fail the test are listed separately as "may be noise". LOS medians are shown as
descriptive only. All wording is descriptive, never causal.

## Roles

| Role | Can |
|---|---|
| Administrator | Everything, including users, settings, backup, import and export |
| Clinician | Record and edit clinical data; sees names and MRNs |
| Viewer | Dashboards and census with pseudonymous IDs (e.g. `P-7F3A2`), read-only |
| Researcher | Aggregate analytics and the de-identified export only (no census, no identifiers) |

Identifiers (MRN, name, DOB) live in a separate table that the analytics layer never reads. The
session locks after 15 minutes of inactivity. Every mutation, sign-in, export and record view is
written to the audit log.

## Run it

```bash
cd desktop
npm install
npm run dev          # Vite + Electron with hot reload
npm test             # 27 unit + integration tests (analytics, MDR parity, SQLite API, roles, import)
npm run build && npm start
```

On first launch you create the unit (name and beds) and the administrator account. From an empty
database you can **import cultures from the original Antibiome web app** (its CSV export or JSON
backup), or **load clearly-labelled synthetic demo data** to explore.

## Install on the PICU PC (Windows)

Build on a Windows machine (or CI) with:

```bash
npm run dist:win     # → release/Antibiome PICU Setup x.y.z.exe  and a portable .exe
```

Data is stored at `%APPDATA%\Antibiome PICU\data\antibiome.db`. Set `ANTIBIOME_DATA_DIR` to put it
elsewhere, for example an encrypted drive. A consistent snapshot is written to `data\backups\` once a
day (last 14 kept), and **Settings → Back up now** saves one wherever you choose.

Recommended PC hygiene:

- A Windows account per user
- BitLocker
- Screen lock
- One backup copy kept off the machine in a locked location

The SQLite file is **not** encrypted by the app itself.

## Project layout

```
desktop/
├── electron/      main process (owns the DB, IPC, dialogs, backups) + preload bridge
├── server/        SQLite schema & migrations, API with role checks + audit, demo seeder, legacy import
├── shared/        pure TS: reference data, MDR v1 (ported verbatim), antibiogram, analytics, stats, data quality
├── src/           React renderer: pages, components, charts
│   └── vendor/    WatermelonUI + ReactBits components (see vendor/README.md)
├── tests/         vitest
└── scripts/       build, dev, screenshot + demo-DB helpers
```

The renderer is sandboxed: context isolation is on, Node is off, a strict CSP applies, and navigation
and new windows are blocked. Its only access to data is one whitelisted IPC call.

## Not built yet (by design — see the plan)

Disease-specific modules, the Research Explorer with cohort statistics, the protocol/QI engine,
PIM3/SMR, and AI natural-language queries. The data model already supports them, since episodes and
events carry the timestamps those features need.
