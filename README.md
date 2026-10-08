<div align="center">

# Antibiome PICU

### The intelligence layer for paediatric intensive care

Admit a child in under a minute on the unit PC or a phone at the bedside, and get risk-adjusted
outcomes, stewardship and research answers from your own unit's data — on your own computer.

[![Deploy](https://github.com/itskaero/antibiome/actions/workflows/deploy.yml/badge.svg)](https://github.com/itskaero/antibiome/actions/workflows/deploy.yml)

</div>

---

![Command centre](desktop/docs/screenshots/home-dark.png)

## What it does

- **Census and fast admission** — defaults everywhere, one-tap chips, MRN recognises returning patients.
- **Support and therapy** — respiratory support, vasoactives and antimicrobials as timed episodes.
- **Vital signs at key moments** — IPSCC 2005 age-specific flags, S/F ratio, shock index, worst first-24 h values.
- **Severity and outcomes** — PIM3 per admission and a rolling 12-month standardised mortality ratio.
- **Stewardship and microbiology** — days of therapy per 1,000 patient-days, WHO AWaRe, MDR isolates, first-isolate antibiogram.
- **Research Explorer** — cohorts, group comparisons and logistic regression, with optional AI questions (Claude or DeepSeek) that you confirm before they run.
- **Protocols and QI** — local protocols as measurable rules, with adherence and run charts.
- **Phones on the hospital Wi-Fi** — paired, revocable phones for bedside entry; the PC stays the only data store.
- **Privacy by design** — local SQLite database, four roles, append-only audit trail, pseudonymous analytics, de-identified research export.

## Where to go

| | |
|---|---|
| **Product page and setup guide** | [`site/index.html`](site/index.html) — published at the root of this repository's GitHub Pages site |
| **Desktop app (source, build, full documentation)** | [`desktop/`](desktop/README.md) |
| **Design and roadmap** | [`docs/PICU_INTELLIGENCE_PLAN.md`](docs/PICU_INTELLIGENCE_PLAN.md) |

Quick start for developers:

```bash
cd desktop
npm install
npm run dev        # Vite + Electron
npm test           # unit + integration tests
npm run dist:win   # Windows installer
```

## Repository layout

```
desktop/   Antibiome PICU desktop app (Electron, React, SQLite)
site/      Product page and setup guide (static; deployed to GitHub Pages)
docs/      Design and roadmap
legacy/    The retired NICU web app (see below)
```

`.github/workflows/deploy.yml` publishes `site/` at the root of the Pages site and `legacy/` under
`/legacy/`. Nothing else in the repository is published.

## Legacy NICU web app

The original Antibiome NICU culture app has been retired. It stays available at `/legacy/` on the
Pages site, unlinked, so units can export their data: **Records → Export CSV**, then in Antibiome PICU
**Settings → Local database → Import Antibiome cultures**. Its code and documentation are in
[`legacy/`](legacy/README.md); it will be removed once the data has been moved.

Visitors who had the old app installed at the root are migrated automatically: `site/service-worker.js`
replaces the old offline worker, clears its caches and reloads the page.
