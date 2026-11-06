# Claude.ai use by state

A one-page site that answers one question: which US states use Claude.ai more than their population predicts?

Live page: https://yejh123.github.io/claude-state-usage/

The page maps Anthropic's usage per capita index for the 50 states and D.C. in May 2026. An index of 1.0 means a state's share of US Claude.ai use equals its share of US working-age people (ages 15 to 64). The map puts states into four groups by rank, the chart below it shows the top 10, and a table lists all 51.

## How the groups work

States are ranked from highest to lowest index. The 51 places are split into four groups that are as equal as possible, with the extra places going to the top groups:

| Group                 | States | Index range  |
| :-------------------- | -----: | :----------- |
| Leading (top 25%)     |     13 | 1.07 to 3.32 |
| Upper middle          |     13 | 0.80 to 1.05 |
| Lower middle          |     13 | 0.51 to 0.70 |
| Emerging (bottom 25%) |     12 | 0.25 to 0.49 |

The published values are rounded to two decimals, so some states tie. Tied states share a rank and always land in the same group. In the May 2026 data no tie falls on a group boundary.

## Files

| Path                                 | What it is                                       |
| :----------------------------------- | :----------------------------------------------- |
| `index.html`, `assets/`              | The page, its styles and its script              |
| `data/usage-per-capita-2026-05.json` | The 51 values the page uses (8 KB)               |
| `data/AEI_DATA_README.md`            | Anthropic's documentation for the source dataset |
| `scripts/build_data.py`              | Builds the JSON file from the full CSV           |
| `prompt.md`                          | The assignment brief                             |

The full source CSV (`aei_claude_ai_2026-06-26.csv`, about 220 MB) is too big for GitHub, so `.gitignore` keeps it out of the repository.

## Rebuild the data

Put the CSV in the repository root and run:

```bash
python3 scripts/build_data.py
```

The script uses only the Python standard library. It keeps the `usage_per_capita_index` rows for US subregions in the `overall` category for May 2026. It stops with an error if any state is missing, an unknown code appears, or a state shows up twice. Use `--csv` and `--output` to point it somewhere else.

## Run it locally

The page fetches its data file, so it needs a web server rather than a `file://` URL:

```bash
python3 -m http.server 4317
```

Then open http://localhost:4317/.

d3, topojson-client and the us-atlas state shapes load from jsDelivr at pinned versions, with integrity hashes.

## Publishing

GitHub Pages serves the `main` branch from the repository root. `.nojekyll` turns off Jekyll so files are served as they are.

## Credits

Data: [Anthropic Economic Index](https://www.anthropic.com/research/economic-index-june-2026-report), Claude.ai data released June 26, 2026, under CC BY. Map shapes: US Census Bureau, via [us-atlas](https://github.com/topojson/us-atlas).
