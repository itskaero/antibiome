<div align="center">

# 🧬 Antibiome

### Clinical Culture Analytics for the NICU

A real-time antibiogram and culture surveillance dashboard built with vanilla JavaScript, Chart.js, and Firebase Firestore — deployable as a zero-dependency static web app.

[![Deploy](https://github.com/YOUR_USERNAME/antibiome/actions/workflows/deploy.yml/badge.svg)](https://github.com/itskaero/antibiome/actions/workflows/deploy.yml)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)

</div>

---

## Overview

Antibiome is a clinical-grade NICU culture surveillance tool that lets microbiology and infectious disease teams log, visualise, and analyse antibiotic resistance patterns across patient populations. It generates an EUCAST-style antibiogram, tracks multi-drug-resistant (MDR) organisms, and visualises resistance trends over time — all without a backend server.

Data is persisted to **Firebase Firestore** when configured, or falls back to `localStorage` for local-only use, making the app fully operational even before a Firebase project is attached.

---

## Features

| Module | Description |
|---|---|
| **Clinical Overview** | KPI cards (total cultures, MDR count, MDR %, unique organisms) + 4 live charts |
| **Trends** | Monthly organism frequency, resistance rate per antibiotic over time |
| **Add Culture** | Structured entry form — organism, specimen type, age group, antibiotic panel with S/I/R results |
| **Antibiogram** | Auto-generated cumulative antibiogram table, filterable by specimen and year |
| **MDR Tracker** | Flags isolates resistant to ≥ 3 antibiotic classes; organism breakdown, top MDR organisms |
| **Records** | Full audit log of all culture entries with delete capability |

### Antibiotic Coverage

20 antibiotic classes, 60+ drugs:

`Penicillins` · `Cephalosporins` · `Carbapenems` · `Aminoglycosides` · `Fluoroquinolones` · `Glycopeptides` · `Macrolides` · `Tetracyclines` · `Polymyxins` · `Oxazolidinones` · `Sulfonamides` · `Lipopeptides` · `Monobactams` · `Nitrofurans` · `Rifamycins` · `Nitroimidazoles` · and more

### Organism Library

Covers **gram-negative**, **gram-positive**, and **fungal** pathogens including *ESKAPE* organisms, *Candida auris*, and all clinically relevant NICU isolates.

---

## Getting Started

### 1 — Clone & open

```bash
git clone https://github.com/itskaero/antibiome.git
cd antibiome
```

Open `index.html` in any modern browser. The app runs immediately using `localStorage` as its data store — no build step, no npm.

> **Note:** Because `firebase-config.js` uses ES module imports from the Firebase CDN, open the app through a local web server rather than the `file://` protocol.
> A simple option: `npx serve .` or the VS Code **Live Server** extension.

### 2 — Connect Firebase (optional)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore** in Native mode.
3. Copy your project credentials into `firebase-config.js`:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

The connection status indicator in the sidebar shows **Live** when Firestore is active.

---

## Deployment (GitHub Pages)

The included GitHub Actions workflow automatically injects Firebase credentials from repository secrets and deploys the app to GitHub Pages on every push to `main`.

### Step 1 — Add secrets

In your repository go to **Settings → Secrets and variables → Actions** and create the following secrets:

| Secret | Value |
|---|---|
| `FIREBASE_API_KEY` | Firebase API key |
| `FIREBASE_AUTH_DOMAIN` | `yourproject.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | Firestore project ID |
| `FIREBASE_STORAGE_BUCKET` | `yourproject.appspot.com` |
| `FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID |
| `FIREBASE_APP_ID` | App ID |

### Step 2 — Enable GitHub Pages

Go to **Settings → Pages** and set the source to **GitHub Actions**.

### Step 3 — Push

```bash
git push origin main
```

The workflow runs, replaces all placeholder values with the secrets, and publishes the site. The live URL appears in the **Actions** tab under the deployment step.

> The `firebase-config.js` file committed to the repository always contains **placeholder strings only** — real credentials are injected ephemerally at deploy time and never written to git history.

---

## Project Structure

```
antibiome/
├── index.html            # App shell, sidebar navigation, all page templates
├── app.js                # All application logic (charts, MDR, forms, state)
├── firebase-config.js    # Firebase init + Firestore CRUD + localStorage fallback
├── styles.css            # Dark-mode UI, animated background, responsive layout
└── .github/
    └── workflows/
        └── deploy.yml    # CI/CD — inject secrets → deploy to GitHub Pages
```

---

## Data Model

Each culture entry stored in Firestore (or `localStorage`) follows this shape:

```json
{
  "id":         "uuid-v4",
  "date":       "2026-04-14",
  "organism":   "Klebsiella pneumoniae",
  "specimen":   "Blood",
  "age_group":  "Neonate",
  "ward":       "NICU",
  "notes":      "...",
  "antibiotics": [
    { "name": "Meropenem",   "result": "S" },
    { "name": "Gentamicin",  "result": "R" },
    { "name": "Colistin",    "result": "S" }
  ]
}
```

**MDR definition:** An isolate is flagged as multi-drug resistant when it shows resistance (R or I) to agents from **≥ 3 distinct antibiotic classes**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | Vanilla JavaScript (ES Modules) |
| Charts | [Chart.js 4](https://www.chartjs.org/) |
| Database | [Firebase Firestore](https://firebase.google.com/docs/firestore) |
| Fonts | Inter · JetBrains Mono (Google Fonts) |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

---

## Security

- Credentials are **never committed** to version control — only placeholder strings live in the repository.
- Firebase credentials in the browser are restricted by **Firestore Security Rules** — configure your rules in the Firebase Console to lock down read/write access appropriately.
- The GitHub Actions workflow uses **repository secrets** exclusively; they are masked in all log output.

---

<div align="center">
<sub>Built for clinical use · Not a substitute for professional medical judgment</sub>
</div>
