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

| ![GBS module on a patient](docs/screenshots/patient-gbs-module.png) | ![GBS outcomes by immunotherapy](docs/screenshots/research-gbs.png) |
| ![Modules & fields](docs/screenshots/modules-admin.png) | |

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
| **Research** | Per-module cohort: what was recorded and how completely, and outcomes compared by an exposure (e.g. GBS immunotherapy). Labelled *descriptive* or *association*, never causal. Exports the dataset and a data dictionary. |
| **Modules & fields** | Build disease modules and fields without code: triggers, types, ranges, options, conditional fields, required flags, versions |
| **Data quality** | Impossible / implausible / incomplete records, grouped by rule; nothing auto-corrected |
| **Activity** | The audit trail (who did what, when), grouped by day |
| **Settings** | Unit name and beds, users and roles, backup, import legacy Antibiome cultures, demo data |

Shortcuts: `Ctrl K` or `/` opens the command palette (patients, pages, actions), `A` admits, `B` opens the
census board, `R` opens the reconcile grid, and `Ctrl L` locks the app.

## Parameters & disease modules

The core record stays small. Disease-specific fields live in **modules**, and each module is data, not code.

### Defining a module

- **Trigger.** A module switches on when a patient's primary or secondary diagnosis matches its trigger
  list. A module with no trigger applies to every admission, which suits unit-wide QI fields.
- **Field types.** number (unit, range, decimals), yes/no, single choice, multiple choice, date,
  date & time, or short text.
- **When each field is asked.**
  - At admission: shown in the admission sheet.
  - At discharge: shown in the discharge dialog.
  - During the stay: shown on the patient page.
  - Repeated: a time series, e.g. MRC sum score or lactate.
- **Conditional fields.** A field can be shown only when another field has a given value, e.g.
  "IVIG started" only when immunotherapy includes IVIG.
- **Required fields.** A required field that is still missing at discharge goes to the data-quality page.
- **Derived values.** Ventilation, ventilation days, NIV failure, vasoactive days, days of therapy,
  culture positivity, culture-before-antibiotic, time-to-antibiotic, Hughes improvement, length of stay
  and death are computed from the core record, so a module never asks again for what core already
  captures. They come from a fixed registry; no user formula is ever executed.

### Adding a field later (the research-safety rules)

- **Introduction date.** Every field records when it was introduced. Patients admitted earlier are
  exported as `NC` (*not collected*), never as "no" or 0, so an analysis can be restricted to the
  period when the field existed. Those earlier admissions can still be back-filled from the patient
  page.
- **Versioning.** Changing a field's unit, range or decimals, or removing an option, creates a **new
  version** once data exists. Each value keeps the version it was entered under, and every version's
  definition is stored. Adding an option is safe and does not create a new version.
- **Type changes.** A field's type cannot change once it holds data. Retire it and add a new one.
- **Retiring.** A retired field is no longer asked; its data is kept and still exported.
- **History.** Replacing a single value keeps the old row (soft-deleted), and every change is in the
  audit log.

### Built-in modules

Admins can edit or extend these four.

| Module | Example fields |
|---|---|
| **Sepsis & septic shock** | Time zero, source, lactate (initial + repeated), first-hour fluid, pSOFA, source control |
| **Pneumonia** | SpO₂ on arrival, chest X-ray, viral tests, final aetiology |
| **GBS** | Onset-to-admission, Hughes grade (admission/discharge), bulbar and autonomic involvement, MRC sum score (repeated), variant, immunotherapy, IVIG start |
| **DKA** | New onset, pH, bicarbonate, severity, hours to resolution, cerebral oedema |

### Research export and data dictionary

The de-identified export adds a column per module field: `module__field`. Repeated fields produce
`_n`, `_first`, `_last` and `_max` columns, and selected derived values are added as columns too.

Cell codes:

- a value
- blank: not recorded
- `NC`: field not yet introduced when the patient was admitted
- `NA`: module not applicable to this admission

Dates become days from admission. A **data dictionary** CSV (labels, types, units, codes, introduction
date, versions) is saved alongside the dataset.

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
npm test             # 41 unit + integration tests (analytics, MDR parity, SQLite API, roles, import, modules)
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

Not built:

- Multi-variable cohort building across modules (the full Research Explorer)
- Regression
- The protocol/QI engine
- PIM3/SMR
- AI natural-language queries

The module system, versioned values and time-stamped episodes are the foundation those features need.
