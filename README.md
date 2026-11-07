# Massachusetts and Claude.ai, person for person

A short data film that plays as you scroll. Person for person, Massachusetts uses Claude.ai more than 46 other states, and more of that use is for school. Under the film, a classic view lists every number.

Live page: https://yejh123.github.io/claude-state-usage/

The data is Anthropic's Economic Index for May 2026. The film's main measure is conversations per 100 expected: Anthropic's usage per capita index times 100. A state at the US average rate sends 100 conversations for every 100 you would expect from its residents aged 15 to 64. Massachusetts sends 142.

## The film

One full-screen stage stays pinned while the page scrolls. The same 51 lights (50 states and D.C.) move through nine scenes:

| Scene         | What the lights do                                                                                       |
| :------------ | :------------------------------------------------------------------------------------------------------- |
| Hook          | Sit on a map of the night sky; the camera drifts east and settles on Massachusetts                       |
| Fair counting | Swell to total conversations, resize to conversations per person, then line up by rank                  |
| Massachusetts | Massachusetts fills 100 cool dots (expected at the US average), then 42 warm ones                        |
| The map       | Fly into a tile map, one square per state                                                                |
| New England   | The camera moves in on the six New England states and their numbers                                     |
| The skyline   | Rise into columns as wide as each state's working-age population and as tall as its use per person       |
| What for      | Massachusetts and the whole US pour into dots sorted into work, personal life and schoolwork             |
| Limits        | Dim while three short caveats appear                                                                     |
| Credits       | Return to the sky as the credits roll                                                                    |

Warm amber means above the US average and cool blue-gray means below it. The further a state is from average, the stronger its color and glow. Massachusetts always has a thin white ring.

The film runs about 91 seconds at a steady scroll, plus the credits. Every frame is a pure function of film time, so scrolling up plays it backward. Readers who turn on reduced motion get each beat as a still that cross-fades to the next, with no camera moves, spark or counting.

## How the numbers are made

`scripts/build_data.py` reads the May 2026 `overall` rows for the 50 states, D.C. and the USA from the CSV and writes `data/usage-per-capita-2026-05.json`. For each state it keeps:

- the per capita index, and the same value as conversations per 100 expected;
- the share of all US conversations, and the rank by that share;
- the share of conversations about work, personal life and schoolwork;
- an estimated share of US residents aged 15 to 64, computed as usage share divided by index.

The CSV has no population column, so the residents share is derived. Both inputs are rounded to two decimals, which makes the estimate approximate for the smallest states. The 51 estimates add up to 99.98%.

US-wide work, personal and schoolwork shares come from the USA country rows. The 100-dot and 142-dot blocks split those shares with the largest remainder method, so each block adds up exactly. The 42 extra Massachusetts dots only add to each group; no dot changes color between scenes.

Puerto Rico appears in the CSV with a usage share but no per capita index, so the film leaves it out.

The build also checks the captions. Numbers in the copy (46, 142, 15, 13 and so on) are read from the JSON by the page. Claims made in words are checked by the script, which stops with a message naming the caption if the data no longer supports it. Those claims are: Massachusetts ranks fifth per person and lower in total, Texas is third in total and below average, California sends the most conversations, Connecticut is the only other New England state above average, Massachusetts leads New England by at least 25 points, most residents live in below-average states, D.C. and West Virginia are the extremes, D.C. is more than double the next place, and Massachusetts does about twice the US schoolwork per person.

## Files

| Path                                 | What it is                                                               |
| :----------------------------------- | :----------------------------------------------------------------------- |
| `index.html`                         | The page: film stage, captions, credits and the classic view             |
| `assets/style.css`                   | Styles for the film and the classic view                                 |
| `assets/js/main.js`                  | Loads the data, binds numbers into the copy, starts the film and the classic view |
| `assets/js/film/script.js`           | The film's beats: durations, layouts, camera, spark, labels and captions |
| `assets/js/film/layouts.js`          | Every shape the lights and dots move into                                |
| `assets/js/film/timeline.js`         | Turns film time into one frame                                           |
| `assets/js/film/renderer.js`         | Draws a frame on the canvas                                              |
| `assets/js/film/film.js`             | Maps scroll to film time; handles the opening shot, resizing and reduced motion |
| `assets/js/film/captions.js`         | Captions, counting numbers and the progress line                         |
| `assets/js/film/camera.js`           | Camera fitting and smooth zoom paths                                     |
| `assets/js/film/geometry.js`         | Sky positions (state centroids) and the tile grid                        |
| `assets/js/classic.js`               | The classic view's map, top 10 and tables                                |
| `assets/js/tone.js`                  | The shared above/below color rule                                        |
| `data/usage-per-capita-2026-05.json` | The numbers the page uses                                                |
| `data/AEI_DATA_README.md`            | Anthropic's documentation for the source dataset                         |
| `scripts/build_data.py`              | Builds the JSON file from the full CSV and checks the captions           |

The full source CSV (`aei_claude_ai_2026-06-26.csv`, about 220 MB) is too big for GitHub, so `.gitignore` keeps it out of the repository.

## Rebuild the data

Put the CSV in the repository root and run:

```bash
python3 scripts/build_data.py
```

The script uses only the Python standard library. Use `--csv` and `--output` to point it somewhere else.

## Run it locally

The page fetches its data file, so it needs a web server rather than a `file://` URL:

```bash
python3 -m http.server 4317
```

Then open http://localhost:4317/.

The film draws on a 2D canvas and needs no libraries. The classic view's map loads d3, topojson-client and the us-atlas state shapes from jsDelivr at pinned versions, with integrity hashes. The fonts (Newsreader and JetBrains Mono) come from Google Fonts.

## Publishing

GitHub Pages serves the `main` branch from the repository root. `.nojekyll` turns off Jekyll so files are served as they are.

## Credits

Data: [Anthropic Economic Index](https://www.anthropic.com/research/economic-index-june-2026-report), Claude.ai data released June 26, 2026, under CC BY. Map shapes: US Census Bureau, via [us-atlas](https://github.com/topojson/us-atlas). Built with Claude Code.
