/*
 * Loads data/usage-per-capita-2026-05.json (built by scripts/build_data.py)
 * and indexes it for the film and the classic view.
 */

const DATA_URL = "data/usage-per-capita-2026-05.json";

/**
 * Fetch a URL and parse it as JSON, failing loudly on HTTP errors.
 * @param {string} url - Address to fetch.
 * @param {RequestInit} [requestOptions] - Extra fetch options, such as an integrity hash.
 * @returns {Promise<any>} The parsed JSON document.
 */
export async function fetchJson(url, requestOptions = {}) {
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  return response.json();
}

/**
 * Index the dataset for lookups by postal code and FIPS code.
 * @param {object} dataset - Parsed JSON data file.
 * @returns {object} The states (in per person rank order), lookups, US figures and film facts.
 */
function indexDataset(dataset) {
  const statesByCode = new Map(dataset.states.map((state) => [state.code, state]));
  const focusCode = dataset.film.focus_code;
  if (!statesByCode.has(focusCode)) {
    throw new Error(`The film's focus state ${focusCode} is missing from ${DATA_URL}.`);
  }
  return {
    states: dataset.states,
    statesByCode,
    statesByFips: new Map(dataset.states.map((state) => [state.fips, state])),
    focus: statesByCode.get(focusCode),
    facts: dataset.film,
    us: dataset.us,
    period: dataset.period,
    source: dataset.source,
  };
}

/**
 * Load and index the page's data file.
 * @returns {Promise<object>} Result of indexDataset.
 */
export async function loadLookups() {
  return indexDataset(await fetchJson(DATA_URL));
}
