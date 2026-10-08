# Antibiome → PICU Intelligence Layer
## Architecture assessment & migration plan

> Status: planning document. **Update:** the MVP has since been built as a standalone desktop app. See the addendum at the end and [`desktop/README.md`](../desktop/README.md).
> Audit baseline: `main` @ `c837727` (PR #4, sidebar PWA install + guideline coverage).
> Scope: how to evolve Antibiome from NICU culture surveillance into a PICU clinical, operational, QI and research intelligence layer **without breaking the existing microbiology functionality**.

---

## 0. Executive summary

- **Today, Antibiome is a well-scoped microbiology surveillance PWA.** It is one ~2,000-line `app.js`, plain `index.html`, Chart.js, and Firebase Firestore with a localStorage fallback. It has no build step, tests, authentication or backend. Its core asset is the domain logic: the organism/antibiotic dictionaries, organism-aware MDR classification, the cumulative antibiogram, trends, and guideline-vs-local-susceptibility analysis. **All of that should be kept.**
- **The main structural gap is that there is no patient or admission.** Each culture is a standalone document with a free-text name, a 3-bucket age group and a free-text ward. Nothing can be linked longitudinally, so every PICU question ("what happens to these patients?") is currently unanswerable.
- **The main non-structural gap is security.** There is no authentication. Patient names are stored and exported in plain text. Deletes are hard deletes with no audit trail. A real Firebase config is committed even though the README says only placeholders are. Fix this *before* any PICU admission data goes in.
- **Recommendation:** add a **pseudonymised Admission spine**: admission → diagnoses → episodes (respiratory, vasoactive, antibiotic) → events → outcome. Existing cultures attach to it as an optional link. Put analytics behind a single **metric registry**, add **schema-driven disease modules**, and make data entry **event-driven around a live census board**. Do not build daily forms.
- **MVP:** an authenticated census board with admit, daily one-tap support reconciliation, antibiotic courses, culture linkage and discharge. On top of that: a monthly PICU intelligence report, data-quality warnings, and the existing microbiology pages unchanged. Then pilot it in one PICU for about 3 months before building disease modules, the Research Explorer or AI.

---

## 1. Current architecture

| Layer | What exists | Notes |
|---|---|---|
| Hosting | GitHub Pages via `.github/workflows/deploy.yml` | Workflow `sed`-replaces placeholder strings in `firebase-config.js`. The committed file already holds real values, so the substitution does nothing. |
| Frontend | Vanilla JS ES modules: `app.js` (1,974 lines), `index.html` (847), `styles.css` (1,468) | Single-page app with hash routing (`VALID_PAGES`, `navigateToPage`). All pages are pre-rendered `<div class="page">` blocks. |
| Charts | Chart.js 4.4.0 (jsDelivr CDN) | `makeChart()` helper destroys and recreates each chart. |
| Data access | `firebase-config.js` exposes `saveCulture / loadCultures / updateCulture / deleteCulture / subscribeCultures` plus guideline CRUD | Firestore when it initialises, otherwise localStorage (`nicu-cultures`, `antibiome-guidelines`). This is already a small repository layer, which is useful. |
| State | Module-level globals: `allCultures`, `allGuidelines`, `chartInstances`, … | `onSnapshot` loads the **entire** `cultures` collection into memory, and every page filters it client-side. |
| Offline | `service-worker.js` (cache-first for local files, `antibiome-v4`) + manifest | Fully installable PWA. |
| Auth / roles | **None** | Optional client-side `GUIDELINES_PASSCODE` (empty). The tenant is `localStorage['antibiome-hospital-id']`, which the client controls. |
| Tests / lint / types | **None** | |
| Backend | **None** (no Cloud Functions, no rules file in the repo) | Security depends entirely on Firestore rules configured in the console, which are not versioned. |

### Pages (navigation)
`home` (Clinical Overview) · `trends` · `entry` (Add Culture) · `antibiogram` · `mdr` · `records` · `insights` · `guidelines`.

---

## 2. Existing data model

### `cultures` (Firestore collection / `nicu-cultures` in localStorage)
```json
{
  "id": "culture-<uuid>",
  "patient_name": "Baby Doe",          // free text, identifiable, optional
  "date": "2026-04-14",                // date only
  "age_group": "Neonate|Infant|Child", // NICU-centric buckets
  "ward": "NICU Bed 3",                // free text, mixes unit + bed
  "specimen": "Blood|CSF|ETT|Peritoneal Fluid|Stool|Urine|Wound|Other",
  "organism": "Klebsiella pneumoniae", // picklist or free text via "Other"
  "antibiotics": [{ "name": "Meropenem", "result": "S|I|R" }],
  "_createdAt": "<serverTimestamp>"    // Firestore only
}
```

### `hospitals/{hospitalId}/guidelines` (plus legacy root `guidelines`)
Two document shapes share one collection:
- **Ward record:** `{ id, ward, entry_type: "ward" }`
- **Protocol:** `{ id, ward, infection_type, organism_target, line1, line2, line3, exceptions }`. Each `lineN` is a free-text drug list that is parsed by splitting on `, + /`.

### In-code reference data (`app.js`)
- `ANTIBIOTIC_CLASSES`: 20 classes and about 70 drugs, plus a derived `DRUG_TO_CLASS`.
- `ORGANISMS`: 36 organisms plus "Other".
- `GRAM_POSITIVE_SET / GRAM_NEGATIVE_SET / FUNGAL_SET` drive `getOrganismGroup()`.
- `MDR_RELEVANT_CATEGORIES`: per-group category lists (WHO/ECDC 2012-inspired).

**Missing entirely:** patient identity, admission, diagnosis, severity, treatment, timing within a day, outcome, users, audit.

---

## 3. Existing functionality to preserve (unchanged in behaviour)

| Feature | Location | Why keep it |
|---|---|---|
| Culture entry with S/I/R panel | `handleFormSubmit`, `addABRow` | Becomes the "culture result" step of the PICU timeline. |
| Cumulative antibiogram (organism × drug %S, filterable by specimen/year/ward) | `renderAntibiogram` | Core value; NICU users depend on it. |
| Organism-aware MDR flag | `relevantResistantClasses`, `isMDR` | Core value. See §5 for correctness issues to fix *with versioning*, not silently. |
| MDR tracker, trends, overview KPIs | `renderMDR`, `renderTrends`, `renderHome` | Become the **Microbiology** section. |
| Insights / stewardship briefing | `buildStewardshipBriefing`, `renderInsights` | Prototype of the "surface meaningful changes" idea. Its language needs softening (§5). |
| Ward guidelines + local-coverage analysis | `analyseGuidelineCoverage`, `localSusceptibility` | Seed of the Protocol/QI layer and of compliant CDS ("current antibiogram shows X% susceptibility"). |
| PWA install and offline shell | `service-worker.js`, `initPwaInstallPrompt` | Ward devices and patchy connectivity. |
| XSS escaping helper | `escHtml` | Keep it, and apply it everywhere (it is not applied everywhere today; see §5). |
| Existing Firestore data | `cultures`, `guidelines` | **Must be migrated forward, never dropped.** |

## 4. Existing functionality that can be reused

- **Data-access shim** (`firebase-config.js`): extend the same pattern into a repository interface (`repo.admissions.save()`, …) so storage can change later.
- **Domain dictionaries** (antibiotic classes, organisms, specimen types): move them into a `reference/` module and reuse them for antibiotic *therapy* entry, so the same drug names serve both susceptibility and prescribing. That makes "culture-directed therapy" computable by matching names.
- **`localSusceptibility()`**: becomes the CDS primitive "local %S for drug X against target Y in unit Z, n=…".
- **`buildStewardshipBriefing()` tone model** (`good/info/warn/neutral`): becomes the output format of the change-detection engine (§11).
- **`countBy`, `sortedMonths`, `fmtMonth`, `makeChart`**: the start of an analytics utility module.
- **Guidelines ward/protocol model**: protocols gain measurable rules (§8 Protocol engine), and current empiric-regimen entries remain as-is.
- **Dark "command centre" visual language** (`styles.css`): already fits the requested UX direction.

---

## 5. Technical limitations & debt (found in the audit)

### Security / privacy (fix first, Phase 0)
1. **No authentication or authorisation.** Anyone who has the app URL and whatever the Firestore rules allow can read and write. The rules are not in the repo, so they cannot be reviewed.
2. **Identifiable data:** `patient_name` is stored in plain text, shown in Records and MDR tables, searchable, and included in the **CSV export** with no access control.
3. **Hard deletes with no audit trail** (`deleteCulture`). There is no record of who changed what.
4. **Committed Firebase config** for project `pediatric-opd` contradicts the README ("placeholder strings only"), and the deploy workflow's `sed` is now a no-op. Firebase web keys are not secrets in themselves, but this means **Firestore rules are the only control**. Review them immediately and restrict the API key to the deployed origin.
5. **Remaining unescaped `innerHTML`:** `renderRecords` inserts `patient_name`, `organism`, `date` and antibiotic names without `escHtml`. `renderAntibiogram` inserts organism and drug names raw into `<th>`/`<td>`. Free-text "Other" organisms make this a stored-XSS path.
6. **Client-controlled tenancy:** the hospital ID comes from localStorage.

### Analytical correctness (fix with versioned definitions, never silently)
7. **No patient linkage means no first-isolate deduplication.** CLSI M39 cumulative antibiograms count the first isolate per patient per organism per period. Repeat cultures from one colonised baby currently inflate both %R and MDR counts.
8. **Inconsistent minimum-n thresholds:** the briefing uses ≥5, guideline coverage ≥3, and the antibiogram table has none. CLSI M39 recommends ≥30 isolates, or a visible "interpret with caution" below that.
9. **The MDR implementation diverges from Magiorakos 2012:**
   - It does not exclude **intrinsic resistance**. For example, *Klebsiella* is intrinsically ampicillin-R, so every *Klebsiella* tested against ampicillin gets a "Penicillins" resistant class, which inflates MDR.
   - Cephalosporins are lumped into one category. Magiorakos separates non-extended-spectrum, extended-spectrum, anti-MRSA and cephamycins, so lumping *under*-counts in other cases.
   - MRSA (oxacillin-R *S. aureus*) is MDR by definition and is not treated as such.
   - There is no XDR/PDR.
   - **Action:** introduce `mdr_definition_version`, keep v1 for continuity, and show which version a chart uses.
10. **Date-only timestamps:** time-to-antibiotic and similar metrics are impossible today.
11. **NICU-centric age buckets.** PICU needs age in months (derived from DOB or entered directly).
12. **Free-text `ward` mixes unit and bed.** There is no unit dimension.

### Engineering
13. **Monolith with computation coupled to the DOM.** Analytics functions read `document.getElementById(...).value`, so nothing can be unit-tested or reused by a report, research or AI layer.
14. **No build, tests, lint or types,** so every change is a regression risk to clinical numbers.
15. **The whole collection is loaded into memory through one `onSnapshot`.** This is fine for thousands of cultures, but not for longitudinal PICU data spread over several collections without scoping by date range or unit.
16. **Service worker is cache-first for `app.js`** with a manual `CACHE_NAME` bump, so clinicians can run stale logic after a deploy.
17. **Full-screen O(n²) canvas background animation** costs CPU and battery on low-end ward tablets. Make it optional or remove it in the PICU views.
18. **Prescriptive or causal copy** that conflicts with the new CDS principles:
    - "✅ Likely effective / 🚫 Avoid" in Insights.
    - "extended-spectrum coverage may be warranted".
    - "**current protocols appear effective**" (a causal claim from a trend).
    - "keep it out of default empiric pathways".
    - **Action:** reword to descriptive local-data statements.

---

## 6. Proposed PICU Intelligence architecture

```
┌──────────────────────────────── PWA (offline-capable) ─────────────────────────────────┐
│  Census board · Admit/Discharge · Daily reconcile · Timeline · Microbiology (existing)  │
│  Dashboards · Monthly report · Data Quality · Research Explorer · Ask (NL, later)       │
└───────────────▲────────────────────────────────────────────────────────────────────────┘
                │ repository interface (repo.*) — storage-agnostic
┌───────────────┴──────────────── DOMAIN CORE (pure JS, unit-tested) ────────────────────┐
│ reference/   dictionaries: drugs, organisms, diagnoses (ICD-mapped), units              │
│ model/       admission, episode, event, culture, module-response validators             │
│ derive/      LOS, vent-days, DOT, patient-days, age, MDR(versioned), first-isolate      │
│ quality/     data-quality rules → warnings                                              │
│ metrics/     METRIC REGISTRY (one definition per metric: numerator/denominator/min-n)  │
│ change/      period comparison + significance gate → "meaningful change" cards         │
│ protocols/   rule engine (time-to, exists, within-window) → adherence                   │
│ stats/       descriptive, CI, chi²/Fisher, t/MWU, RR/OR                                 │
│ cohort/      Query DSL (JSON) → executor → result + provenance                          │
└───────────────▲─────────────────────────────────────────────────────────▲──────────────┘
                │                                                         │ aggregates only
┌───────────────┴──────────── STORAGE ────────────┐        ┌──────────────┴─────────────┐
│ Phase 0–5: Firebase Auth + Firestore + Rules    │        │ AI interpretation (Phase 8) │
│   (flat, relational-shaped collections)         │        │ NL → Query DSL (validated)  │
│ Phase 6+: PostgreSQL (e.g. Supabase/self-host)  │        │ results → narrative (checked)│
│   when cohort queries / server-side de-id needed│        └────────────────────────────┘
└─────────────────────────────────────────────────┘
```

### Key decisions (recommended)

1. **Keep Firebase for the MVP.** Add Firebase Auth with role claims, versioned `firestore.rules`, and audit writes enforced by rules. Reasons: the app is already deployed, Firestore gives offline persistence (important on a ward), there is nothing to operate, and PICU volume is small. Roughly 1–2k admissions a year with ~20 events each is comfortably computable in the browser for several years.
2. **Design the schema relationally anyway.** Use flat top-level collections with foreign-key IDs and no deep nesting, so migrating to PostgreSQL later is a script and not a rewrite.
   - **Migration trigger:** Research Explorer needs server-side cohort queries, *or* ethics/IT requires server-side de-identification, *or* multiple hospitals join.
3. **Extract a pure-function domain core** from `app.js`, behind characterisation tests, **before** adding PICU logic. Existing page renderers then call the same functions, so behaviour does not change.
4. **Use one metric registry.** Dashboards, monthly reports, protocol scores, research outputs and AI answers all read the same metric definitions, so a number cannot differ between screens.
5. **Tooling:** add Vite (bundling, cache-busted filenames that fix the stale service worker) and Vitest. Build new, stateful PICU screens (census board, schema-driven module forms) with **Preact** mounted per page, alongside the existing vanilla pages. Do **not** rewrite the existing pages.

---

## 7. Proposed database / schema

Storage-agnostic logical model. Each entity maps to one Firestore collection now and one Postgres table later. `*` = required. All records carry `unit_id`, `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at` (soft delete) and `schema_version`.

### Identity (split for privacy)
| Entity | Key fields | Access |
|---|---|---|
| `patient_identifiers` | `patient_id*`, `mrn*`, `name`, `dob` | **Clinical roles only.** Never read by analytics. |
| `patients` | `patient_id*` (random pseudonym), `sex*`, `birth_year_month` (or age derived per admission) | All authenticated roles. |

### Encounter spine
| Entity | Key fields |
|---|---|
| `units` | `unit_id`, `name` (PICU, NICU, …), `beds`, `hospital_id` |
| `admissions` | `admission_id*`, `patient_id*`, `unit_id*`, `admit_at*`, `age_months_at_admit*` (derived), `weight_kg*`, `source*` (ED / ward / OT / other hospital / NICU), `admission_type*` (emergency / elective), `readmission_48h` (derived), `severity` (embedded snapshot, see §9), `pim3` (optional object), `discharge_at`, `outcome` (see below), `bed` (optional) |
| `diagnoses` | `diagnosis_id`, `admission_id*`, `code*` (local dx list → ICD-10/11), `role*` (primary / secondary / complication), `status` (working / final), `onset_at` |
| `outcomes` (embedded in admission) | `disposition*` (ward / home / transfer / LAMA / died), `discharge_at*`, `death_at`, `final_primary_dx_confirmed` |

### Longitudinal layer
| Entity | Purpose / key fields |
|---|---|
| `episodes` | **Interval** data: `episode_id`, `admission_id*`, `kind*` (`resp_support`, `vasoactive`, `antimicrobial`, `rrt`, `cvc`, `other_device`), `detail*` (e.g. `{level:"MV"}`, `{agent:"Adrenaline"}`, `{drug:"Meropenem", intent:"empiric|targeted|prophylaxis"}`), `start_at*`, `end_at`, `start_precision` (`datetime` / `date`), `end_reason` (e.g. extubation planned/unplanned, de-escalation, completed, death) |
| `clinical_events` | **Point** events: `event_id`, `admission_id*`, `type*` (from a registry: `deterioration`, `sepsis_recognised`, `intubation`, `reintubation`, `cardiac_arrest`, `lp_done`, `transfusion`, `complication`, `culture_sent`, `culture_resulted`, …), `at*`, `params` (JSON, validated per type), `source` (user / derived / import), `note` |
| `cultures` | **Existing collection, extended:** add `admission_id` (nullable for legacy), `unit_id`, `collected_at`, `resulted_at`, `isolate_seq` (first-isolate flag derived), `patient_id` (nullable for legacy); `patient_name` deprecated → moved to identifiers. Embedded `antibiotics[]` S/I/R stays (optional `mic`). |
| `investigations` | Only module-required labs/imaging: `admission_id`, `code` (lactate, CRP, CSF profile, …), `at`, `value`, `unit`. **Not** a lab feed. |
| `module_responses` | `admission_id*`, `module_id*`, `module_version*`, `data` (JSON validated by module schema), `completed_at` |

The timeline view is derived as `episodes` (start + end) ∪ `clinical_events` ∪ `cultures` (sent / resulted) ∪ admission / discharge. Episodes are stored as intervals rather than pairs of events because durations (vent-days, DOT, vasoactive hours) are the main analytic need, and an unmatched start/stop pair is a common data-quality failure.

### Configuration
| Entity | Purpose |
|---|---|
| `dx_catalogue` | Local diagnosis list: `code`, `label`, `synonyms[]`, `icd10`, `icd11`, `category` (resp / neuro / infection / …), `module_ids[]` |
| `disease_modules` | Versioned JSON module definitions (§10) |
| `protocols` | Existing guideline docs **plus** `rules[]` (§8 QI) |
| `event_types` | Registry: `type`, `label`, `params_schema`, `allowed_units` |
| `metric_definitions` | Optional overrides of the code registry (targets, thresholds) |

### Governance
| Entity | Purpose |
|---|---|
| `users` | `uid`, `display_name`, `roles[]`, `unit_ids[]`, `active` |
| `audit_logs` | Append-only: `at`, `uid`, `action` (create / update / delete / export / view-identifiers / query), `entity`, `entity_id`, `diff` (field names; values omitted for identifiers), `reason` |
| `saved_cohorts` | Research Explorer specs (§12) with `spec`, `created_by`, `data_as_of` |
| `exports` | Export register: who, when, spec, de-id level, row count |

**Normalisation rule:** disease modules never duplicate core data. "Mechanical ventilation" in the GBS module is **derived** from `episodes(kind=resp_support, level=MV)`, not entered again.

---

## 8. Proposed UI / navigation

```
COMMAND CENTRE  (default for leadership)   — census, KPIs, "what changed" cards, alerts
PATIENTS        (default for bedside)
  ├ Census board        — live list of admitted patients, one row each, inline one-tap actions
  ├ Admit               — 30-second admission sheet
  ├ Daily reconcile     — grid: patients × {O₂, HFNC, NIV/CPAP, MV, vasoactive, antibiotics}
  └ Patient timeline    — events/episodes, module card, discharge
MICROBIOLOGY    (existing pages, regrouped, behaviour unchanged)
  ├ Overview · Trends · Antibiogram · MDR · Culture records · Add culture
STEWARDSHIP     — DOT/1000 patient-days, broad-spectrum & reserve agents, empiric→targeted, durations
QUALITY         — Protocols (existing Guidelines + measurable rules), adherence, HAI indicators
REPORTS         — Monthly/weekly PICU Intelligence (printable)
RESEARCH        — Explorer · Saved cohorts · Opportunities · De-identified export
DATA QUALITY    — warnings queue, completeness by field/month
ADMIN           — users/roles, units, diagnosis catalogue, modules, protocols, audit log
```

Role-based landing: nurses and residents land on the **Census board**, consultants and leadership on the **Command Centre**, researchers on **Research** (de-identified data only).

---

## 9. Minimum viable PICU dataset

Each field must name the analysis it enables. Fields without one are excluded.

### A. At admission (target ≤ 30 s)
| Field | Input | Enables |
|---|---|---|
| MRN | scan / type; auto-match existing patient | linkage, readmissions, first-isolate dedup |
| Sex | 1 tap | stratification |
| Age | DOB *or* years + months | age distribution, PIM3, weight-for-age |
| Weight (kg) | numeric | malnutrition flag (derived WHO z-score), dosing context, PIM3-adjacent risk |
| Admit date/time | default *now* | LOS, census, time-to-X anchors |
| Source | 1 tap (ED / Ward / OT / Other hospital / NICU) | referral patterns, emergency vs elective |
| Primary diagnosis | autocomplete (unit top-10 + recents first) | disease burden, LOS/mortality by dx, module trigger |
| Secondary dx | 0–3, optional | comorbidity, case-mix |
| Chronic condition / SAM | 1 tap each | case-mix adjustment (important in LMIC PICUs) |
| Support on arrival | 1 tap: None / O₂ / HFNC / CPAP-NIV / MV | intubation rate, opens a resp episode automatically |
| Shock on arrival | yes/no (if yes → opens vasoactive or fluid-refractory flag) | shock burden, severity |
| Coma (GCS ≤ 8) | yes/no | severity |
| **PIM3** | optional panel (~10 items), **strongly recommended by Phase 2** | standardised mortality ratio (SMR): the single most useful benchmarking metric |

### B. During stay (event-driven, each ≤ 5–10 s, no daily forms)
| Field | How | Enables |
|---|---|---|
| Respiratory support changes | change chip on census row / daily reconcile | vent-days, NIV failure, intubation/extubation, reintubation < 48 h |
| Vasoactive start/stop | toggle | shock duration, vasoactive-days |
| Antimicrobial start/stop/switch | drug autocomplete (same dictionary as antibiogram) + intent (empiric/targeted/prophylaxis) | DOT, broad-spectrum %, escalation/de-escalation, culture-directed therapy |
| Culture sent | specimen chip (result entered via existing culture form, pre-linked) | culture-before-antibiotic, positivity, links microbiology to outcome |
| Key procedures | chips: intubation, CVC, RRT/PD, chest drain | device-days, HAI denominators |
| Complications | chips: VAP, CLABSI, CAUTI, unplanned extubation, pressure injury, cardiac arrest | QI indicators |

### C. At discharge (target ≤ 20 s)
| Field | Input | Enables |
|---|---|---|
| Disposition | 1 tap: Ward / Home / Transfer / LAMA / Died | mortality, LAMA rate |
| Discharge date/time | default now | LOS, census |
| Confirm final primary dx | 1 tap (pre-filled) | accurate disease burden |
| Close open episodes | auto-proposed with discharge time | prevents dangling vent/antibiotic intervals |
| Disease module | ≤ 6 fields, only if dx has a module | disease-specific outcomes |

### Deliberately **excluded** from MVP
Vital-sign series, full lab panels, fluid balance, nursing scores, medication doses/frequencies, non-antimicrobial drugs (except module-specific ones such as IVIG), free-text histories, imaging reports.

---

## 10. Disease-module architecture

A module is **data, not code**: a versioned JSON definition stored in `disease_modules`, rendered by one generic form engine and validated by one generic validator.

```json
{
  "id": "gbs",
  "version": 1,
  "label": "Guillain–Barré syndrome",
  "trigger": { "dx_codes": ["G61.0"] },
  "capture_at": ["admission", "discharge"],
  "fields": [
    { "key": "hughes_admit", "label": "Hughes disability score (admission)", "type": "int", "min": 0, "max": 6, "at": "admission" },
    { "key": "immunotherapy", "label": "Immunotherapy", "type": "multi",
      "options": ["IVIG", "Methylprednisolone", "Plasmapheresis", "None"], "at": "discharge" },
    { "key": "ivig_start", "label": "IVIG start", "type": "date", "show_if": { "immunotherapy": { "includes": "IVIG" } } },
    { "key": "autonomic_dysfunction", "label": "Autonomic dysfunction", "type": "bool" },
    { "key": "hughes_discharge", "label": "Hughes score (discharge)", "type": "int", "min": 0, "max": 6, "at": "discharge" }
  ],
  "derived": [
    { "key": "mv_required",  "from": "episodes", "expr": "any(kind='resp_support' and level='MV')" },
    { "key": "mv_days",      "from": "episodes", "expr": "sum_days(kind='resp_support' and level='MV')" },
    { "key": "hughes_improvement", "expr": "hughes_admit - hughes_discharge" }
  ],
  "outcomes": ["hughes_improvement", "mv_required", "mv_days", "los_days", "died"],
  "exposures": ["immunotherapy"],
  "quality_rules": [
    { "if": "ivig_start < admit_date - 14d", "warn": "IVIG start >14 days before admission" }
  ]
}
```

**Principles**
- `derived` reads from core episodes and events, so a module never re-asks something core already captures.
- `outcomes` and `exposures` declare the module's research semantics, so the Research Explorer can build "IVIG vs methylprednisolone → outcomes" with **no extra code**.
- **Versioning:** published versions are immutable. Responses store `module_version`, and analytics either map across versions or restrict to one.
- `derived.expr` uses a **small whitelisted expression language** (no `eval`). It is the same evaluator used by protocol rules and data-quality rules.
- Authoring: admins edit JSON (with a live preview) in Phase 5. A visual builder comes later, if ever.
- **Start with 3 modules** (Sepsis/septic shock, Pneumonia, GBS) to prove the engine. Add the rest (DKA, meningitis/encephalitis/TBM, status epilepticus, bronchiolitis, dengue, asthma, AKI, ALF, nephrotic, HIE) based on observed volume.

---

## 11. Analytics architecture

1. **Derivation layer** (pure functions) computes canonical per-admission facts once: `los_days`, `vent_days`, `vasoactive_days`, `dot_by_drug`, `patient_days_by_month` (split across months correctly), `first_isolate`, `mdr_v1`, `mdr_v2`, `culture_before_abx`, `time_to_first_abx`.
2. **Metric registry:** every metric is declared once.
   ```js
   { id: 'mv_rate', label: 'Mechanically ventilated', population: 'admissions',
     numerator: a => a.vent_days > 0, unit: '%', minN: 10, direction: 'neutral' }
   { id: 'dot_meropenem', label: 'Meropenem DOT / 1000 patient-days', rate: true,
     numerator: 'dot.Meropenem', denominator: 'patient_days', per: 1000 }
   ```
3. **Change detection** turns "a chart for everything" into "only what changed":
   - Compare the current period with the previous period and with the same period last year.
   - Show a card **only** when (a) both periods meet `minN`, (b) the change is larger than a relative threshold (e.g. ≥ 20%), and (c) a simple test supports it (Fisher/χ² for proportions, a Poisson rate test for rates).
   - Otherwise the change goes into a "possibly noise" drawer.
   - This prevents misleading headlines such as "↑ 100% (1 → 2)".
4. **Monthly PICU Intelligence report** is a fixed template filled from the registry: admissions Δ, top diagnoses Δ, ventilated n and vent-days, mortality (crude, and SMR once PIM3 exists), median LOS (IQR), top antimicrobials by DOT Δ, organisms and MDR Δ, data completeness. It can be printed or exported to PDF.
5. **Standard stewardship denominators:** DOT per 1000 patient-days and the % of admissions exposed. Broad-spectrum / reserve lists are configurable (a WHO AWaRe mapping is a good default).
6. **Antibiogram upgrades (opt-in toggles, defaults preserved):** first-isolate-per-patient dedup (once linkage exists), an n<30 caution badge, and a unit filter (PICU vs NICU).

---

## 12. Research Explorer architecture

### Cohort Query DSL (JSON)
This is the only thing the engine executes, and it is also what the AI layer must produce.
```json
{
  "population": "admissions",
  "unit": ["PICU"],
  "date": { "field": "admit_at", "from": "2026-01-01", "to": "2026-09-30" },
  "include": [{ "dx": { "code": ["G61.0"], "role": ["primary", "secondary"] } }],
  "exclude": [{ "field": "disposition", "op": "eq", "value": "transfer_in_<24h" }],
  "groupBy": { "module": "gbs", "field": "immunotherapy",
               "buckets": { "IVIG": ["IVIG"], "Methylpred": ["Methylprednisolone"],
                            "Combination": ["IVIG+Methylprednisolone"], "Other/supportive": "*" } },
  "outcomes": ["gbs.hughes_improvement>=1", "mv_required", "mv_days", "los_days", "died"]
}
```

### Execution and output
- The engine returns a **result object with provenance**: the resolved spec, `data_as_of`, n per group, excluded counts with reasons, missing-data counts per variable, the statistic used and why (e.g. "Fisher exact: expected cell count < 5"), effect estimates with 95% CI, and **claim level**.
- **Claim-level labelling** is enforced by the engine, not the UI:
  - `DESCRIPTIVE`: counts, percentages, medians ("12/14 in the IVIG group improved").
  - `ASSOCIATION`: a test or effect size was computed ("Improvement was observed more frequently in the IVIG group; OR 3.2, 95% CI 0.9–11.4, p=0.08").
  - `CAUSAL`: **never emitted.** Every association result carries fixed caveats: retrospective observational data, confounding by indication (sicker children receive different treatment), small n, multiple comparisons.

### Statistics plan
| Stage | Methods |
|---|---|
| Phase 6 | n/%, Wilson CI, mean ± SD, median (IQR); cross-tabs; χ² / Fisher (auto-selected); Welch t / Mann–Whitney U (auto-selected by distribution and n, defaulting to MWU for LOS and vent-days); RR/OR with CI |
| Later | logistic/linear regression with a guard of ≥10 events per variable, otherwise refused with an explanation. Run in a validated library (server-side R/Python, or webR) rather than hand-rolled JS. |

### Other features
- **Small-cell protection:** counts < 5 are shown as "<5" in exports and shared reports.
- **Saved cohorts** are reproducible: the stored spec plus `data_as_of`, with re-run diff.
- **Research Opportunities** (Phase 6b) are the change-detection engine's significant findings, phrased as **questions** ("Is MDR infection associated with longer PICU LOS in sepsis?"). Each links to a pre-built cohort spec and carries a "hypothesis-generating only" label.
- **De-identified export:** pseudonymous ID re-keyed per export; dates shifted per patient *or* converted to day offsets from admission; age in months; free text dropped; written to the export register.

---

## 13. AI architecture

```
User question ──► LLM (NL → Query DSL JSON) ──► Validator (schema, whitelist, limits)
                                                   │ invalid → ask user to rephrase
                                                   ▼
                              Show interpreted criteria; user confirms/edits  ◄── never silently altered
                                                   ▼
                              Cohort/metric engine executes (deterministic)
                                                   ▼
                              Result object (aggregates + provenance, no identifiers)
                                                   ▼
             LLM writes narrative from result object only ──► Number-grounding check
                                                   │  every number in text must exist in result
                                                   ▼
             Answer card: narrative + cohort + filters + dates + n + variables + method + limitations
```

- **The LLM never sees identifiers or row-level data.** It sees the DSL schema, the metric registry and the diagnosis catalogue to translate questions, and later only aggregate result objects. This keeps PHI out of third-party processing.
- **The LLM never produces SQL.** It produces the same DSL a human builds in the Explorer, so every AI answer can be reproduced by hand.
- **Refusal set:** treatment recommendations for a specific patient, causal questions (answered as association with caveats), queries returning fewer than 5 patients at the identifiable level, and anything outside the DSL.
- **Audit:** prompt, DSL, user confirmation and result hash go to `audit_logs`.
- **CDS phrasing contract** (applies to the whole app, not only the AI):
  - Allowed: "Current PICU antibiogram (2026, n=42): Klebsiella 61% susceptible to amikacin" and "Local protocol (Sepsis v2) lists…".
  - Never: "Give meropenem."

---

## 14. Security & privacy requirements

| Requirement | Implementation (MVP on Firebase) |
|---|---|
| Authentication | Firebase Auth (Google Workspace or email link) with an allow-list of hospital accounts only. |
| Roles | Custom claims: `admin`, `clinician` (enter/view identifiers for own unit), `viewer` (dashboards, no identifiers), `researcher` (de-identified explorer/export only), `auditor` (read audit log). |
| Authorisation | `firestore.rules` **in the repo**, reviewed and tested with the emulator. Rules check role and `unit_id`, and deny `patient_identifiers` to non-clinical roles. |
| Audit | Every write is a batched write that includes an `audit_logs` doc. Rules require it (`existsAfter`) and make `audit_logs` create-only. |
| Minimum necessary | Names and MRNs only in `patient_identifiers`. Analytics, dashboards and reports render pseudonyms. A "reveal identity" action is logged. |
| Pseudonymisation | Random `patient_id`. Never derive it from the MRN (a hash of a short MRN is reversible). |
| Soft delete | `deleted_at` with a reason; hard delete only by admin with an audit entry. |
| Export controls | CSV export by role. Identifiable export for clinicians is logged with a reason. Researcher export is always de-identified with small-cell suppression. |
| Device risk | Firestore offline cache holds data on the device. Allow persistence only on managed or registered devices, use auto-logout on idle, and do not cache `patient_identifiers` offline. |
| Secrets / config | Move the Firebase config back to placeholders as the README claims (or accept it as public and restrict the API key by HTTP referrer). Rules are the real control. |
| Governance | Get ethics committee approval before research use of retrospective data, and follow hospital data-protection policy. Check whether Google-hosted storage is permitted; if not, the Postgres migration path moves forward to a self-hosted deployment. |
| XSS | Use `escHtml` (or Preact's escaping) for all user-supplied strings, starting with `renderRecords` and `renderAntibiogram`. |

---

## 15. Migration strategy (non-destructive)

1. **Freeze behaviour:** write characterisation tests that pin today's outputs (antibiogram %S, MDR flags, coverage analysis) on a fixture dataset *before* moving any code.
2. **Extract:** move the pure logic out of `app.js` into `src/core/*`. Existing renderers call it, and the tests must stay green.
3. **Harden** (auth, rules, audit, escaping) before any new data type is collected.
4. **Additive schema:** new collections only. `cultures` gains *nullable* `admission_id`, `patient_id`, `unit_id`, `collected_at`. Legacy cultures stay valid and keep contributing to unit-level antibiograms.
5. **Legacy backfill** (optional, assisted): a one-off tool to
   - map free-text `ward` → `unit_id` + `bed`,
   - move `patient_name` → `patient_identifiers` (creating pseudonymous patients),
   - optionally suggest culture → admission matches by date window for a human to confirm.

   No automatic merging.
6. **Versioned definitions:** add `mdr_v2` (intrinsic-resistance exclusions, split cephalosporins, MRSA rule, XDR/PDR) **alongside** v1. Show both for one review cycle, then switch the default with a release note.
7. **Navigation regroup:** existing pages move under "Microbiology" with the same IDs and hash routes kept as aliases, so bookmarks and manifest shortcuts still work.
8. **Postgres migration** (Phase 6+, only when triggered): the repository interface gets a Postgres adapter, data is exported once, a dual-read period runs, then cut-over. Possible because the Firestore model is already flat and relational.

---

## 16. Phased roadmap

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0. Foundation & hardening** | Vite + Vitest; core extraction with characterisation tests; Auth + roles; versioned rules; audit; XSS fixes; soft delete; de-prescriptive copy; units dimension | All existing pages identical on fixtures; no unauthenticated read possible |
| **1. PICU core** | Patients/identifiers split, admissions, census board, admit/discharge, daily reconcile grid, respiratory/vasoactive/antimicrobial episodes, data-quality engine v1 | Real admission end-to-end in < 60 s median (measured in-app) |
| **2. Diagnosis + outcome analytics** | Dx catalogue (ICD-mapped), Command Centre, metric registry, change detection, monthly report; PIM3 panel (optional) | Monthly report matches the manual admissions register within ±2% |
| **3. Microbiology integration** | Culture ↔ admission link, "culture sent" event, first-isolate dedup toggle, n<30 badges, PICU vs NICU antibiogram, MDR v2 alongside v1 | Linked-culture rate ≥ 80% of new PICU cultures |
| **4. Stewardship** | DOT/1000 PD, AWaRe groups, empiric→targeted, de-escalation after result, duration, culture-before-antibiotic | Stewardship dashboard reviewed in one stewardship meeting |
| **5. Disease modules** | Module engine + validator + expression evaluator; Sepsis, Pneumonia, GBS | New module added by JSON only, no code change |
| **6. Research Explorer** | Query DSL, cohort builder, stats v1, claim levels, saved cohorts, de-id export; Opportunities; Postgres decision point | One real QI/research question answered and reproduced by a second user |
| **7. Protocol / QI engine** | Rule DSL on events (exists / time-to / within-window / sequence), adherence dashboards, run charts | Sepsis bundle adherence reported monthly |
| **8. AI NL analytics** | NL → DSL, confirmation step, grounded narrative, audit | ≥ 90% of a 50-question test set translated correctly; 0 ungrounded numbers |

---

## 17. Risks & failure points

| Risk | Mitigation |
|---|---|
| **Incomplete capture** (admissions missed on busy nights), which silently biases every metric | Census reconciliation against the unit admission register; "expected vs captured" completeness KPI on the Command Centre; named data steward per shift |
| **Data entry creep** (every stakeholder adds "just one field") | Field-justification rule in the admin UI: each field must name its metric or research use. Quarterly pruning of fields with < 50% completion or no consumer. |
| **Timestamp unreliability** (retrospective guesses for time-zero) | `start_precision` flag; time-sensitive metrics computed only on `datetime` precision records, with % excluded shown |
| **Misinterpreting observational data** (e.g. "IVIG works") | Claim levels enforced by the engine; confounding-by-indication caveat; no causal language anywhere |
| **Small-number noise** (a 15-bed PICU sees few GBS cases) | minN gates, CIs everywhere, change-detection significance gate, multi-period pooling |
| **Privacy incident** (exported names, open Firestore rules, shared device cache) | Phase 0 before Phase 1, versioned rules, identifier split, export register |
| **Breaking NICU users** during the refactor | Characterisation tests, additive schema, route aliases |
| **Definition drift** (MDR, LOS rules change and trends become incomparable) | Versioned definitions recorded in every result object |
| **Firestore limits** for complex cohorts | Flat schema + repository interface; Postgres trigger defined in advance |
| **Single-developer maintenance burden** | Small dependency set, tests on core logic, modules as data |
| **Over-trust in AI answers** | AI last (Phase 8), DSL-only, confirmation, grounding check |

---

## 18. What NOT to build initially

- No EMR features: notes, orders, MAR, nursing charts, vitals series, fluid balance.
- No lab/HIS integrations (manual entry plus later CSV import first). Integrations come after the data model has proven itself.
- No predictive models or risk scores beyond validated ones (PIM3).
- No AI of any kind before Phase 8; no LLM-generated statistics ever.
- No visual module builder (JSON + preview suffices).
- No regression or multivariable statistics before the descriptive layer is trusted.
- No multi-hospital tenancy beyond a `hospital_id` field.
- No real-time alerts or push notifications to clinicians (alert fatigue, liability); dashboard surfacing only.
- No dose capture for antibiotics (DOT does not need it; DDDs are unsuitable for paediatrics).
- No more than 3 disease modules before the pilot finishes.
- No migration off Firebase until a Phase 6 trigger is actually hit.

---

## How do we make PICU data entry take < 60 seconds per patient?

The key is to **record state changes when they happen, never fill a daily form, and derive everything else.**

1. **The census board is the home screen.** Every admitted patient is one row showing current support level, vasoactive status and active antimicrobials as chips. Most entries are a single tap on a chip in that row, not navigation into a form.
2. **Split the work across three short moments:**
   - **Admit:** about 30 s, 9–12 fields, mostly one-tap.
   - **Changes:** about 5 s each, a chip tap with time defaulting to *now* (editable).
   - **Discharge:** about 20 s, disposition plus confirming pre-filled values and closing open episodes in one tap.

   Each touchpoint stays under 60 s. A typical 4-day stay totals about 2–3 minutes, spread across the team.
3. **Daily reconcile grid (about 1 minute for the whole unit, not per patient).** One screen shows all patients × {O₂, HFNC, NIV/CPAP, MV, vasoactive, antibiotics}. A nurse or resident toggles what is true *today*, and the system opens and closes day-resolution episodes. This alone produces vent-days, vasoactive-days, DOT and patient-days with no per-patient form.
4. **Episodes stay open until closed.** Nobody re-enters "still ventilated". Duration is computed.
5. **Derive, don't ask:**
   - LOS, age in months, age band, malnutrition z-score, patient-days, vent-days, DOT
   - MDR, first isolate, readmission < 48 h, death < 24 h of admission
   - culture-before-antibiotic, empiric → targeted switch, culture-directed therapy (drug %S on the linked isolate)
6. **Smart defaults and recency:**
   - Time defaults to now.
   - Source defaults to ED.
   - Diagnosis autocomplete ranks the unit's top-10 and the user's recent choices first, with synonyms ("pneumonia", "LRTI", "CAP" → one code).
   - Antibiotic chips show the unit's 8 most-used drugs.
   - MRN auto-recognises returning patients and pre-fills sex and DOB.
7. **Conditional fields only.** Module fields appear only when the diagnosis triggers them, are capped at about 6, and mostly sit at discharge. Fields hidden by `show_if` never appear.
8. **Warn, don't block.** Data-quality issues go to a warnings queue fixed later by the data steward. Only physically impossible values (discharge before admission) block saving.
9. **Keyboard and tablet ergonomics:**
   - Large tap targets.
   - `/` opens patient search, `A` admits, `D` discharges, and numbers select chips.
   - Works offline and syncs later.
10. **Measure it.** The app logs open-to-save duration per form (no content). If median admit time exceeds 60 s, remove or default fields. This turns the target into a monitored KPI rather than an aspiration.
11. **Time precision only where a metric needs it.** Most episodes are date-resolution through the daily grid. Exact clock times are asked only for things like the first antibiotic dose in suspected sepsis, and only when the Sepsis module is active.

Longitudinal analytics still work because the timeline is built from **intervals and point events**, which is all temporal analytics needs: time-to-X, durations and sequences. A daily form would not add that information.

---

## Recommended MVP (deployable pilot)

**"PICU Census + Outcomes + Microbiology link"** = Phases 0, 1, 2 (without PIM3 if staff push back), and the culture-link part of Phase 3.

### In scope
1. **Hardening:** Auth with 4 roles, versioned Firestore rules, audit log, XSS fixes, soft delete, identifier split, softened CDS language.
2. **Census board:** admit (≤ 30 s), live chips for respiratory support, vasoactive and antimicrobials, discharge (≤ 20 s).
3. **Daily reconcile grid** for the whole unit.
4. **Diagnosis catalogue:** about 60 common PICU diagnoses, ICD-mapped, with synonyms.
5. **Culture linkage:** "culture sent" chip → existing culture form pre-linked to the admission. Existing antibiogram, MDR, trends and guidelines pages unchanged and grouped under Microbiology, with a PICU/NICU unit filter.
6. **Command Centre:**
   - census, occupancy, admissions (Δ vs previous month)
   - top diagnoses, ventilated n and vent-days
   - crude mortality, median LOS (IQR)
   - top antimicrobials by DOT/1000 patient-days
   - MDR trend
   - only "meaningful change" cards
7. **Monthly PICU Intelligence report** (printable), in the format from the brief.
8. **Data-quality panel:** impossible age/weight, discharge before admit, episode end before start, open episodes after discharge, missing outcome > 48 h after discharge, duplicate cultures (same patient/specimen/organism within 3 days), and completeness vs the admission register.

### Out of the MVP
Disease modules, Research Explorer, protocol engine, AI, Postgres.

### Pilot plan (about 3 months, one PICU)
| Measure | Target |
|---|---|
| Capture completeness vs admission register | ≥ 95% of admissions |
| Median admit entry time (in-app telemetry) | ≤ 30 s; discharge ≤ 20 s |
| Accuracy: 10% random chart audit of 10 core fields | ≥ 95% agreement |
| Outcome missing at 48 h post-discharge | ≤ 5% |
| Linked PICU cultures | ≥ 80% |
| Leadership use | Monthly report used in ≥ 2 unit meetings |
| Staff feedback (short survey) | Field-level "remove / keep / add" list feeds Phase 2 pruning |

After the pilot, choose the first disease modules from the **observed** diagnosis volume, then build the Research Explorer on data that is known to be complete and accurate.


---

## Addendum: decision to build a standalone desktop MVP with a local database

After this assessment, the unit decided that the app will run on the **PICU's own PC as a standalone
application with a local database**. That replaces the "stay on Firebase for the MVP" recommendation
in §6. The rest of the plan stands.

| Plan element | How the desktop MVP implements it |
|---|---|
| Storage (§6, §7) | SQLite file via Node's built-in `node:sqlite` inside Electron, using the same relational schema as §7 (patients / patient_identifiers / admissions / diagnoses / episodes / clinical_events / cultures / susceptibility_results / users / audit_log / settings). Versioned migrations. |
| Security (§14) | Local accounts with scrypt-hashed passwords and four roles. Identifiers sit in a separate table the analytics layer never reads. The audit log is append-only, enforced by triggers. 15-minute idle lock. Sandboxed renderer. |
| Minimum dataset (§9) | Admission sheet, one-tap census changes, daily reconcile grid and discharge, as specified, with an entry timer. |
| Analytics (§11) | One `monthSummary()` metric source and change detection with size and exact-test gates. Monthly report. DOT per 1,000 patient-days and AWaRe. |
| Microbiology (§3, §4) | MDR v1 ported verbatim, with tests pinning parity. Antibiogram adds first-isolate de-duplication and n < 30 flags. Legacy CSV/JSON import keeps NICU history. |
| Data quality (§14 of the brief) | Rule engine with warnings that are never auto-corrected. |
| Disease modules (§10) | Built: modules and fields are database records edited in-app. Each has diagnosis triggers, typed fields with ranges and options, conditional display, required flags and capture stage (including repeated measurements). Derived values come from a safe registry. Each field has an introduction date (`NC` for earlier admissions) and a version history. Four built-ins: sepsis, pneumonia, GBS, DKA. |
| Severity (§9) | PIM3 per admission, with a rolling 12-month SMR on the dashboard and SMR in the monthly report. |
| Research Explorer (§12) | Validated JSON cohort DSL across all fields. Comparison tests, risk ratio, logistic regression with an events-per-variable guard. Claim labels, saved cohorts, a deterministic plain-language summary, audit of every query. |
| Protocol / QI engine (§8 QI) | Condition, time-window and if/then elements over Explorer fields. Adherence vs target, bundle, run chart, case review. Five editable built-in protocols. |
| Phone access (§7 entry speed) | Optional HTTPS server in the desktop app for staff phones on the hospital Wi-Fi: QR pairing (single use, 10 min), revocable devices, per-device sessions with a 5-minute lock, bedside-only allow-list, names hidden on phones by default, device named in the audit trail, live refresh across PC and phones. |
| Vital signs (§9, §12) | Recorded at key moments (admission, event, routine); IPSCC age-specific flags; derived admission set, worst first-24 h values, S/F ratio and shock index. Feeds PIM3 pre-fill, Explorer, AI catalogue, protocols ("Admission vital signs"), export and data quality. |
| AI layer (§13) | NL → validated DSL only. Catalogue and question sent, never data; identifiers blocked; user confirms; results and summary computed locally; key encrypted with the OS keychain. |
| Research (§12, module view) | Per-module cohort view: completeness, distributions, and outcomes compared by an exposure. Exact or rank tests run only for two groups, and every result carries a DESCRIPTIVE or ASSOCIATION label with caveats. The export has module columns and a data dictionary. |

**Trade-offs of local storage**
- **Single machine.** There is no simultaneous multi-PC entry.
- **Backups are on the unit.** The app takes a daily automatic snapshot plus manual backups, but
  storing a copy off the machine is an operational duty.
- **No encryption by the app.** The database file is not encrypted by the app, so the PC needs
  BitLocker and per-user Windows accounts.

The repository layer keeps the PostgreSQL path from §15 open if the unit later needs multi-user
network access.
