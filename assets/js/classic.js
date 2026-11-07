/*
 * The classic view under the film: a map, the top 10, the "what for" split and
 * a table of all 51 places, for readers who want every number.
 *
 * Map shapes come from us-atlas (pre-projected Albers USA), so d3.geoPath runs
 * with no projection. d3 and topojson-client are loaded as globals by
 * index.html before this module runs.
 */

import { fetchJson } from "./data.js";
import { AVERAGE_INDEX, cssColor, surfaceRgbForIndex } from "./tone.js";

const ATLAS_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json";
const ATLAS_INTEGRITY = "sha384-vyqp+z8MYIFZU8V1K7x8eeS6f4qq+zp2l6YqE81ZLpCykssi+zpvpQSkQNRqIaJb";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const TOP_RANKING_COUNT = 10;
const AVERAGE_PER_100 = 100;
const SHARE_DECIMALS = 2;
const ESTIMATE_DECIMALS = 2;
const PERCENT = 100;

// Legend stops on a ratio scale, as conversations per 100 expected.
const LEGEND_TICKS = [25, 50, 100, 200, 332];
const LEGEND_GRADIENT_STEPS = 24;

// States too small to hover or tap reliably on a phone, listed north to south.
const SMALL_STATE_CODES = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
// States drawn as a dot because their shape is only a few pixels wide.
const DOT_STATE_CODES = ["DC"];

// Map geometry, in the atlas's 975 x 610 coordinate space.
const MAP_PADDING = 6;
const DOT_RADIUS = 5;
const DOT_HIT_RADIUS = 14;
const LOCATOR_RADIUS = 20;

const TOOLTIP_OFFSET_PX = 14;
const MOUSE_POINTER_TYPE = "mouse";
const ESCAPE_KEY = "Escape";

const MAP_LOAD_ERROR_MESSAGE = "The map could not load. Check your connection and refresh the page.";

/**
 * Create an element with a class name and optional text.
 * @param {string} tagName - HTML tag to create.
 * @param {string} className - Class attribute value.
 * @param {string} [textContent] - Text to insert (set as text, never as HTML).
 * @returns {HTMLElement} The new element.
 */
function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  element.className = className;
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

/**
 * Create an SVG element with attributes.
 * @param {string} tagName - SVG tag to create.
 * @param {Record<string, string | number>} attributes - Attributes to set.
 * @returns {SVGElement} The new element.
 */
function createSvgElement(tagName, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

/**
 * The fill color of a state.
 * @param {object} state - One state record.
 * @returns {string} A CSS color.
 */
function fillOf(state) {
  return cssColor(surfaceRgbForIndex(state.per_capita_index));
}

/**
 * A small color swatch for a state.
 * @param {object} state - One state record.
 * @returns {HTMLElement} A decorative swatch.
 */
function createSwatch(state) {
  const swatch = createElement("span", "swatch");
  swatch.style.setProperty("--swatch", fillOf(state));
  swatch.setAttribute("aria-hidden", "true");
  return swatch;
}

/**
 * Describe a state's place against the average, in plain words.
 * @param {object} state - One state record.
 * @returns {string} For example "above the US average".
 */
function describeSide(state) {
  if (state.per_capita_index > AVERAGE_INDEX) {
    return "above the US average";
  }
  return state.per_capita_index < AVERAGE_INDEX ? "below the US average" : "at the US average";
}

/**
 * Describe a state's rank, for example "5th of 51 (tied)".
 * @param {object} state - One state record.
 * @param {object} lookups - Result of indexDataset.
 * @returns {string} A short description.
 */
function describeRank(state, lookups) {
  const tiedCount = lookups.states.filter(
    (record) => record.rank_per_person === state.rank_per_person,
  ).length;
  const tieNote = tiedCount > 1 ? " (tied)" : "";
  return `Rank ${state.rank_per_person} of ${lookups.states.length}${tieNote}`;
}

/**
 * Format a percentage as published, for example "3.05%".
 * @param {number} value - Percent.
 * @param {number} decimals - Decimal places.
 * @returns {string} The formatted share.
 */
function formatPercent(value, decimals) {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Fill the map key: a ratio-scale color bar with the US average marked.
 * @param {HTMLElement} legendElement - The key container.
 * @param {object} lookups - Result of indexDataset.
 */
function renderLegend(legendElement, lookups) {
  const lowest = Math.min(...lookups.states.map((state) => state.per_100_expected));
  const highest = Math.max(...lookups.states.map((state) => state.per_100_expected));
  const position = (value) => (Math.log(value / lowest) / Math.log(highest / lowest)) * PERCENT;
  const stops = Array.from({ length: LEGEND_GRADIENT_STEPS + 1 }, (_, step) => {
    const value = lowest * (highest / lowest) ** (step / LEGEND_GRADIENT_STEPS);
    return `${cssColor(surfaceRgbForIndex(value / AVERAGE_PER_100))} ${position(value).toFixed(1)}%`;
  });
  const bar = createElement("span", "legend-bar");
  bar.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  const ticks = createElement("span", "legend-ticks");
  for (const tick of LEGEND_TICKS) {
    const tickText = tick === AVERAGE_PER_100 ? "100 US average" : String(tick);
    const label = createElement("span", "legend-tick", tickText);
    label.style.left = `${position(tick)}%`;
    label.classList.toggle("is-average", tick === AVERAGE_PER_100);
    ticks.append(label);
  }
  const scale = createElement("span", "legend-scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(bar, ticks);
  legendElement.replaceChildren(
    createElement("span", "legend-end", "fewer"),
    scale,
    createElement("span", "legend-end", "more"),
  );
}

/**
 * Fill the top 10 list with bars on a shared scale and a line at 100.
 * @param {HTMLElement} rankingElement - Wrapper that holds the axis and the list.
 * @param {object} lookups - Result of indexDataset.
 */
function renderRanking(rankingElement, lookups) {
  const topStates = lookups.states.slice(0, TOP_RANKING_COUNT);
  const maxValue = topStates[0].per_100_expected;
  rankingElement.style.setProperty("--reference-share", String(AVERAGE_PER_100 / maxValue));
  rankingElement.querySelector(".ranking-axis-label").textContent = `${AVERAGE_PER_100} US average`;

  const listElement = rankingElement.querySelector(".ranking-list");
  for (const state of topStates) {
    const row = createElement("li", "ranking-row");
    const track = createElement("span", "ranking-track");
    const bar = createElement("span", "ranking-bar");
    bar.style.setProperty("--bar", fillOf(state));
    bar.style.setProperty("--value-share", String(state.per_100_expected / maxValue));
    track.append(bar, createElement("span", "ranking-value", String(state.per_100_expected)));
    row.append(
      createElement("span", "ranking-rank", String(state.rank_per_person)),
      createElement("span", "ranking-name", state.name),
      track,
    );
    row.classList.toggle("is-focus", state === lookups.focus);
    listElement.append(row);
  }
}

/**
 * Fill the "what for" comparison of the focus state and the whole US.
 * @param {HTMLElement} tableBody - The comparison table's tbody.
 * @param {object} lookups - Result of indexDataset.
 */
function renderUseCases(tableBody, lookups) {
  const rows = [
    ["Work", "work"],
    ["Personal life", "personal"],
    ["Schoolwork", "coursework"],
  ];
  for (const [label, key] of rows) {
    const row = document.createElement("tr");
    row.append(
      createElement("th", "", label),
      createElement("td", "numeric", formatPercent(lookups.focus.use_case_pct[key], SHARE_DECIMALS)),
      createElement("td", "numeric", formatPercent(lookups.us.use_case_pct[key], SHARE_DECIMALS)),
    );
    row.querySelector("th").scope = "row";
    tableBody.append(row);
  }
  const schoolworkRow = document.createElement("tr");
  schoolworkRow.className = "is-total";
  const schoolworkPerPerson = Math.round(lookups.facts.focus_schoolwork_per_person_multiple * PERCENT);
  schoolworkRow.append(
    Object.assign(createElement("th", "", "Schoolwork per person, US = 100"), { scope: "row" }),
    createElement("td", "numeric", String(schoolworkPerPerson)),
    createElement("td", "numeric", String(AVERAGE_PER_100)),
  );
  tableBody.append(schoolworkRow);
}

/**
 * Fill the full table with every state in rank order.
 * @param {HTMLElement} tableBody - The table's tbody element.
 * @param {object} lookups - Result of indexDataset.
 */
function renderTable(tableBody, lookups) {
  for (const state of lookups.states) {
    const row = document.createElement("tr");
    const nameCell = createElement("td", "state-cell");
    nameCell.append(createSwatch(state), document.createTextNode(state.name));
    row.append(
      createElement("td", "numeric", String(state.rank_per_person)),
      nameCell,
      createElement("td", "numeric", String(state.per_100_expected)),
      createElement("td", "numeric", formatPercent(state.usage_share_pct, SHARE_DECIMALS)),
      createElement("td", "numeric", formatPercent(state.working_age_share_pct, ESTIMATE_DECIMALS)),
      createElement("td", "numeric", formatPercent(state.use_case_pct.coursework, SHARE_DECIMALS)),
    );
    row.classList.toggle("is-focus", state === lookups.focus);
    tableBody.append(row);
  }
}

/**
 * Draw the state shapes, borders, dot markers and highlight overlay.
 * @param {SVGSVGElement} svgElement - Target SVG.
 * @param {object} atlas - us-atlas TopoJSON with "states" and "nation" objects.
 * @param {object} lookups - Result of indexDataset.
 * @returns {object} Per-state paths and centroids plus the highlight overlay elements.
 */
function renderMap(svgElement, atlas, lookups) {
  const { geoPath } = globalThis.d3;
  const { feature, mesh } = globalThis.topojson;
  const pathGenerator = geoPath();

  const [[minX, minY], [maxX, maxY]] = pathGenerator.bounds(feature(atlas, atlas.objects.nation));
  const viewBox = [
    minX - MAP_PADDING,
    minY - MAP_PADDING,
    maxX - minX + 2 * MAP_PADDING,
    maxY - minY + 2 * MAP_PADDING,
  ];
  svgElement.setAttribute("viewBox", viewBox.join(" "));

  const stateGroup = createSvgElement("g", {});
  const pathByCode = new Map();
  const centroidByCode = new Map();
  for (const shape of feature(atlas, atlas.objects.states).features) {
    const state = lookups.statesByFips.get(shape.id);
    if (!state) {
      throw new Error(
        `Map shape ${shape.id} (${shape.properties.name}) has no matching row in the data file.`,
      );
    }
    const pathData = pathGenerator(shape);
    const statePath = createSvgElement("path", { d: pathData, class: "map-state", "data-code": state.code });
    statePath.style.fill = fillOf(state);
    stateGroup.append(statePath);
    pathByCode.set(state.code, pathData);
    centroidByCode.set(state.code, pathGenerator.centroid(shape));
  }

  const borders = createSvgElement("path", {
    d: pathGenerator(mesh(atlas, atlas.objects.states, (first, second) => first !== second)),
    class: "map-borders",
  });
  const focusOutline = createSvgElement("path", {
    d: pathByCode.get(lookups.focus.code),
    class: "map-focus",
  });

  const dotGroup = createSvgElement("g", {});
  for (const code of DOT_STATE_CODES) {
    const [centerX, centerY] = centroidByCode.get(code);
    const dot = createSvgElement("circle", { cx: centerX, cy: centerY, r: DOT_RADIUS, class: "map-dot" });
    dot.style.fill = fillOf(lookups.statesByCode.get(code));
    dotGroup.append(
      dot,
      createSvgElement("circle", {
        cx: centerX,
        cy: centerY,
        r: DOT_HIT_RADIUS,
        class: "map-dot-hit",
        "data-code": code,
      }),
    );
  }

  const highlightOutline = createSvgElement("path", { class: "map-highlight" });
  const highlightLayer = createSvgElement("g", { class: "map-overlay", visibility: "hidden" });
  highlightLayer.append(highlightOutline);
  const locatorLayer = createSvgElement("g", { class: "map-overlay", visibility: "hidden" });
  locatorLayer.append(createSvgElement("circle", { r: LOCATOR_RADIUS, class: "map-highlight" }));

  svgElement.replaceChildren(stateGroup, borders, focusOutline, highlightLayer, dotGroup, locatorLayer);
  return { pathByCode, centroidByCode, highlightLayer, highlightOutline, locatorLayer };
}

/**
 * Create the controller that shows one state's tooltip and map highlight.
 * @param {object} mapView - Elements and lookups for the map (frame, svg, tooltip, rendered map).
 * @param {object} lookups - Result of indexDataset.
 * @returns {{showAtPoint: Function, showAtState: Function, hide: Function}} The controller.
 */
function createInspector(mapView, lookups) {
  const { frameElement, svgElement, tooltipElement, renderedMap, buttonsByCode } = mapView;
  let activeCode = null;

  function setHighlight(code) {
    const { highlightLayer, highlightOutline, locatorLayer, pathByCode, centroidByCode } = renderedMap;
    highlightOutline.setAttribute("d", pathByCode.get(code));
    highlightLayer.setAttribute("visibility", "visible");
    const isSmallState = SMALL_STATE_CODES.includes(code);
    if (isSmallState) {
      const [centerX, centerY] = centroidByCode.get(code);
      locatorLayer.setAttribute("transform", `translate(${centerX} ${centerY})`);
    }
    locatorLayer.setAttribute("visibility", isSmallState ? "visible" : "hidden");
    for (const [buttonCode, button] of buttonsByCode) {
      button.classList.toggle("is-active", buttonCode === code);
    }
  }

  function fillTooltip(state) {
    const meta = createElement("p", "tooltip-meta");
    const placeText = `${describeRank(state, lookups)} · ${describeSide(state)}`;
    meta.append(createSwatch(state), document.createTextNode(placeText));
    tooltipElement.replaceChildren(
      createElement("p", "tooltip-name", state.name),
      createElement("p", "tooltip-value", `${state.per_100_expected} per 100 expected`),
      meta,
    );
  }

  // Place the tooltip beside a point (in viewport pixels), flipping and
  // clamping so it stays inside the map frame.
  function positionTooltip(clientX, clientY) {
    const frameBox = frameElement.getBoundingClientRect();
    const pointX = clientX - frameBox.left;
    const pointY = clientY - frameBox.top;
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    let left = pointX + TOOLTIP_OFFSET_PX;
    if (left + tooltipWidth > frameBox.width) {
      left = pointX - TOOLTIP_OFFSET_PX - tooltipWidth;
    }
    left = Math.min(Math.max(left, 0), Math.max(frameBox.width - tooltipWidth, 0));

    let top = pointY - TOOLTIP_OFFSET_PX - tooltipHeight;
    if (top < 0) {
      top = pointY + TOOLTIP_OFFSET_PX;
    }
    tooltipElement.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showAtPoint(code, clientX, clientY) {
    if (code !== activeCode) {
      fillTooltip(lookups.statesByCode.get(code));
      setHighlight(code);
      activeCode = code;
    }
    tooltipElement.hidden = false;
    positionTooltip(clientX, clientY);
  }

  // Anchor the tooltip at a state's centroid, for keyboard focus and buttons.
  function showAtState(code) {
    const [centerX, centerY] = renderedMap.centroidByCode.get(code);
    const screenPoint = new DOMPoint(centerX, centerY).matrixTransform(svgElement.getScreenCTM());
    showAtPoint(code, screenPoint.x, screenPoint.y);
  }

  function hide() {
    activeCode = null;
    tooltipElement.hidden = true;
    renderedMap.highlightLayer.setAttribute("visibility", "hidden");
    renderedMap.locatorLayer.setAttribute("visibility", "hidden");
    for (const button of buttonsByCode.values()) {
      button.classList.remove("is-active");
    }
  }

  return { showAtPoint, showAtState, hide };
}

/**
 * Create one button per small state so it can be inspected on any screen.
 * @param {HTMLElement} containerElement - Where the buttons go.
 * @param {object} lookups - Result of indexDataset.
 * @returns {Map<string, HTMLButtonElement>} Buttons keyed by postal code.
 */
function renderSmallStateButtons(containerElement, lookups) {
  const buttonsByCode = new Map();
  for (const code of SMALL_STATE_CODES) {
    const state = lookups.statesByCode.get(code);
    const button = createElement("button", "state-button");
    button.type = "button";
    button.dataset.code = code;
    const valueText = `${state.name}: ${state.per_100_expected} per 100 expected.`;
    const placeText = `${describeRank(state, lookups)}, ${describeSide(state)}.`;
    button.setAttribute("aria-label", `${valueText} ${placeText}`);
    button.append(createSwatch(state), document.createTextNode(code));
    containerElement.append(button);
    buttonsByCode.set(code, button);
  }
  return buttonsByCode;
}

/**
 * Find the state code of the map element or button under an event.
 * @param {Event} event - A pointer, focus or click event.
 * @returns {string | undefined} Postal code, if the event hit a state.
 */
function codeFromEvent(event) {
  return event.target.closest?.("[data-code]")?.dataset.code;
}

/**
 * Connect hover, tap, focus and keyboard events to the inspector.
 * @param {object} mapView - Elements for the map (svg and small-state container).
 * @param {object} inspector - Result of createInspector.
 */
function wireInteractions(mapView, inspector) {
  const { svgElement, buttonContainer } = mapView;

  svgElement.addEventListener("pointermove", (event) => {
    if (event.pointerType !== MOUSE_POINTER_TYPE) {
      return;
    }
    const code = codeFromEvent(event);
    if (code) {
      inspector.showAtPoint(code, event.clientX, event.clientY);
    } else {
      inspector.hide();
    }
  });
  svgElement.addEventListener("pointerleave", (event) => {
    if (event.pointerType === MOUSE_POINTER_TYPE) {
      inspector.hide();
    }
  });
  // A tap (or click) pins the tooltip until the reader taps elsewhere.
  svgElement.addEventListener("click", (event) => {
    const code = codeFromEvent(event);
    if (code) {
      inspector.showAtPoint(code, event.clientX, event.clientY);
    }
  });

  buttonContainer.addEventListener("pointerover", (event) => {
    const code = codeFromEvent(event);
    if (code && event.pointerType === MOUSE_POINTER_TYPE) {
      inspector.showAtState(code);
    }
  });
  buttonContainer.addEventListener("pointerleave", (event) => {
    if (event.pointerType === MOUSE_POINTER_TYPE && !buttonContainer.contains(document.activeElement)) {
      inspector.hide();
    }
  });
  buttonContainer.addEventListener("focusin", (event) => {
    const code = codeFromEvent(event);
    if (code) {
      inspector.showAtState(code);
    }
  });
  buttonContainer.addEventListener("focusout", (event) => {
    if (!buttonContainer.contains(event.relatedTarget)) {
      inspector.hide();
    }
  });
  buttonContainer.addEventListener("click", (event) => {
    const code = codeFromEvent(event);
    if (code) {
      inspector.showAtState(code);
    }
  });

  // pointerdown rather than click: iOS Safari sends no click event when the
  // reader taps a non-interactive part of the page.
  document.addEventListener("pointerdown", (event) => {
    if (!codeFromEvent(event)) {
      inspector.hide();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === ESCAPE_KEY) {
      inspector.hide();
    }
  });
  window.addEventListener("resize", () => inspector.hide());
}

/**
 * Load the atlas and draw the interactive map. Map failures leave the rest of the view usable.
 * @param {object} lookups - Result of indexDataset.
 */
async function initializeMap(lookups) {
  const frameElement = document.getElementById("map-frame");
  const svgElement = document.getElementById("map");
  try {
    if (!globalThis.d3 || !globalThis.topojson) {
      throw new Error("d3 or topojson-client did not load from the CDN.");
    }
    const atlas = await fetchJson(ATLAS_URL, { integrity: ATLAS_INTEGRITY });
    const renderedMap = renderMap(svgElement, atlas, lookups);
    const buttonContainer = document.getElementById("small-state-buttons");
    const buttonsByCode = renderSmallStateButtons(buttonContainer, lookups);
    const tooltipElement = document.getElementById("tooltip");
    const mapView = { frameElement, svgElement, tooltipElement, renderedMap, buttonsByCode, buttonContainer };
    wireInteractions(mapView, createInspector(mapView, lookups));
  } catch (error) {
    console.error(error);
    svgElement.remove();
    frameElement.append(createElement("p", "map-message", MAP_LOAD_ERROR_MESSAGE));
  }
}

/**
 * Render every part of the classic view.
 * @param {object} lookups - Result of indexDataset.
 */
export async function renderClassicView(lookups) {
  renderLegend(document.getElementById("legend"), lookups);
  renderRanking(document.getElementById("ranking"), lookups);
  renderUseCases(document.getElementById("use-case-body"), lookups);
  renderTable(document.getElementById("state-table-body"), lookups);
  await initializeMap(lookups);
}
