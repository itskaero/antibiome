# Launch film

A 45-second product film for Antibiome PICU, made entirely from the app's own material:
the real UI components, colours, type and logo, and real (synthetic demo) data produced by the
app's own API. No stock footage, no generated imagery.

| File | What it does |
|---|---|
| `make-data.ts` | Seeds the demo database and calls the app's API (census, antibiogram, cultures, dashboard, stewardship, one patient's stay with vitals and Phoenix) → `data.json` / `data.js` |
| `index.html` | The motion composition, 1920×1080. Every frame is a pure function of time: `window.seek(t)`. Open `index.html?play` to preview in real time, `?t=12.5` for one frame |
| `score.py` | The original soundtrack, synthesised with NumPy/SciPy at 120 BPM and cut to the same timeline (impacts, clicks and whooshes land on the visual events) → `score.wav` |
| `render.mjs` | Renders every frame with headless Chromium (Playwright) and encodes with ffmpeg → `out/film.mp4` |

```bash
cd desktop
npx esbuild film/make-data.ts --bundle --platform=node --format=esm --external:node:sqlite --outfile=film/.make-data.mjs && node film/.make-data.mjs
python film/score.py
PLAYWRIGHT_DIR=<folder with playwright installed> node film/render.mjs full film/out
```

Story: PICU data is everywhere (0–5 s) → it organises itself, patient → culture → organism →
sensitivity → antibiotic (5–12 s) → the app reconstructs itself (12–25 s) → one patient, many
cultures, the whole PICU, the intelligence layer (25–36 s) → brand (36–45 s).
