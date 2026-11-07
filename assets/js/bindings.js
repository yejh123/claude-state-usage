/*
 * Fills numbers in the page's copy from the data file, so every figure the
 * reader sees comes from data/usage-per-capita-2026-05.json.
 *
 *   data-fact="name"                    a value from the film facts
 *   data-state="MA" data-field="name"   a value from one state's record
 *   data-period                         the data's month, for example "May 2026"
 *
 * The text already in the HTML is a fallback for readers without JavaScript.
 * Bound numbers also get data-to, the value captions count up to.
 */

/**
 * Write one bound value into an element.
 * @param {HTMLElement} element - The element to fill.
 * @param {string|number|undefined} value - The value from the data file.
 * @param {string} description - What was asked for, for the error message.
 */
function fillValue(element, value, description) {
  if (value === undefined) {
    throw new Error(`The page asks for ${description}, which is not in the data file.`);
  }
  element.dataset.to = String(value);
  element.textContent = String(value);
}

/**
 * Fill every data-bound value under a root element.
 * @param {ParentNode} root - Where to look, usually document.
 * @param {object} lookups - Result of indexDataset.
 */
export function bindDataText(root, lookups) {
  for (const element of root.querySelectorAll("[data-fact]")) {
    fillValue(element, lookups.facts[element.dataset.fact], `fact "${element.dataset.fact}"`);
  }
  for (const element of root.querySelectorAll("[data-state][data-field]")) {
    const { state: code, field } = element.dataset;
    fillValue(element, lookups.statesByCode.get(code)?.[field], `${field} for ${code}`);
  }
  for (const element of root.querySelectorAll("[data-period]")) {
    element.textContent = lookups.period.label;
  }
}
