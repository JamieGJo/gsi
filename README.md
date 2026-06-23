# GSI Datasets

A research-grade reference website hosting three datasets on China's Global Security Initiative:

1. **Signings** — 195 countries × support status (bilateral / multilateral / none), 2022–2025
2. **Media sentiment** — 1,530 MFA + Xinhua articles on GSI, 7,734 sentences scored by source group, 2022–2025
3. **Expenditure** — Chinese security & surveillance commitments to recipients, 2000–2023, audited from AidData CLG

Plus a per-country profile combining all three.

## Stack

Plain HTML + CSS + vanilla JS. No build step.

- Chart.js 4.4.0 — curated charts
- Leaflet 1.9.4 — choropleths
- Vega-Lite 5 — chart builder
- Google Fonts: Inter, Noto Serif SC

## Running locally

```bash
cd gsi-site
python3 -m http.server 8765
# open http://localhost:8765/
```

## Rebuilding the data

If any source file is updated, re-run the build script:

```bash
python3 make_data.py
```

It reads from `/Projects/GSI/data/...` and writes JSON to `./data/` and CSVs to `./downloads/`.

Required Python packages: `pandas`, `openpyxl`.

## Citation

> Gruffydd-Jones, J. (2026). *GSI Datasets*. Compiled reference dataset on China's Global Security Initiative. Retrieved from [URL].

Each section has its own per-view citation block at the bottom.

## Deployment

```bash
./publish.sh   # creates the GitHub repo + pushes
```

The site is meant to live at `https://<github-user>.github.io/gsi-datasets/`.

## File map

```
gsi-site/
├── index.html, signings.html, media.html, expenditure.html, methods.html
├── css/styles.css
├── js/
│   ├── shared.js           — nav, country picker, methods drawer, citation helper
│   ├── country-profile.js  — the combined view
│   ├── chart-builder.js    — Vega-Lite "Build your own" tab
│   ├── signings.js
│   ├── media.js
│   └── expenditure.js
├── data/                   — JSON consumed by the site (built by make_data.py)
├── downloads/              — raw CSV exports with citation header
├── make_data.py            — one-shot build script
└── publish.sh              — GitHub Pages deploy
```
