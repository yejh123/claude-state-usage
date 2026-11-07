# Claude.ai use by state

A short data story about how much each US state uses Claude.ai, and what for.

Live page: https://yejh123.github.io/claude-state-usage/

The page uses Anthropic's usage per capita index for the 50 states and D.C. in May 2026. An index of 1.0 means a state's share of US Claude.ai use equals its share of US working-age people (ages 15 to 64). The story runs in this order:

1. The gap: D.C. uses Claude.ai at 3.3 times the expected rate, West Virginia at a quarter of it.
2. A map colored by where each state sits relative to 1.0, with labels on D.C., California and West Virginia, then the top 10.
3. What people use it for: in states above and below 1.0 alike, about 4 in 10 conversations are for work.
4. A box on what the data can't tell us, then a table of all 51 places.

## How the map bands work

Blue means below 1.0, red means above, and gray means exactly 1.0. The bands split at half (0.5), even (1.0) and double (2.0):

| Band             | Index     | Places                  |
| :--------------- | :-------- | :---------------------- |
| Less than half   | Under 0.5 | 12 states, 0.25 to 0.49 |
| Below 1.0        | 0.5 to 1  | 22 states, 0.51 to 0.96 |
| At 1.0           | 1.0       | Illinois                |
| Above 1.0        | 1 to 2    | 15 states, 1.02 to 1.62 |
| More than double | Over 2    | D.C., 3.32              |

The published values are rounded to two decimals. Illinois is published as exactly 1.00, so its unrounded value could sit just above or just below 1.0. Every other state is far enough from a band edge that rounding can't move it.

The use-case chart averages the state values in each group, counting each state equally. Illinois, at exactly 1.0, belongs to neither group.

## Files

| Path                                   | What it is                                       |
| :------------------------------------- | :----------------------------------------------- |
| `index.html`, `assets/`                | The page, its styles and its script              |
| `data/claude-ai-by-state-2026-05.json` | The values the page uses (13 KB)                 |
| `data/AEI_DATA_README.md`              | Anthropic's documentation for the source dataset |
| `scripts/build_data.py`                | Builds the JSON file from the full CSV           |

The full source CSV (`aei_claude_ai_2026-06-26.csv`, about 220 MB) is too big for GitHub, so `.gitignore` keeps it out of the repository.

## Rebuild the data

Put the CSV in the repository root and run:

```bash
python3 scripts/build_data.py
```

The script uses only the Python standard library. For each US state in the `overall` category for May 2026 it keeps four values: `usage_per_capita_index`, `use_case_work_pct`, `use_case_personal_pct` and `use_case_coursework_pct`. Puerto Rico appears in the CSV with use-case shares but no index, so the script skips it.

The script stops with an error if:

- any state is missing, or an unknown code appears;
- a state has a metric twice, or is missing one of the four;
- a state's work, personal and coursework shares don't add up to 100, within rounding.

Use `--csv` and `--output` to point it somewhere else.

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
