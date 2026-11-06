/*
 * Renders the Claude.ai usage per capita map, its key, the top 10 ranking and
 * the full table from data/usage-per-capita-2026-05.json.
 *
 * Map shapes come from us-atlas (pre-projected Albers USA), so d3.geoPath runs
 * with no projection. d3 and topojson-client are loaded as globals by
 * index.html before this module runs.
 */

const DATA_URL = "data/usage-per-capita-2026-05.json";
const ATLAS_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json";
const ATLAS_INTEGRITY = "sha384-vyqp+z8MYIFZU8V1K7x8eeS6f4qq+zp2l6YqE81ZLpCykssi+zpvpQSkQNRqIaJb";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const TOP_RANKING_COUNT = 10;
const REFERENCE_INDEX = 1;
const VALUE_DECIMALS = 2;
const REFERENCE_DECIMALS = 1;

// States too small to hover or tap reliably on a phone, listed north to south.
const SMALL_STATE_CODES = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
// States drawn as a dot because their shape is only a few pixels wide.
const DOT_STATE_CODES = ["DC"];

// Map geometry, in the atlas's 975 x 610 coordinate space.
const MAP_PADDING = 4;
const DOT_RADIUS = 5;
const DOT_HIT_RADIUS = 14;
const LOCATOR_RADIUS = 20;
const HIGHLIGHT_STROKE_CLASSES = ["map-highlight-outer", "map-highlight-inner"];

const TOOLTIP_OFFSET_PX = 14;
const MOUSE_POINTER_TYPE = "mouse";
const ESCAPE_KEY = "Escape";

const MAP_LOAD_ERROR_MESSAGE = "The map could not load. Check your connection and refresh the page.";
const DATA_LOAD_ERROR_MESSAGE = "The data for this page could not load. Refresh the page to try again.";

/**
 * Fetch a URL and parse it as JSON, failing loudly on HTTP errors.
 * @param {string} url - Address to fetch.
 * @param {RequestInit} [requestOptions] - Extra fetch options, such as an integrity hash.
 * @returns {Promise<any>} The parsed JSON document.
 */
async function fetchJson(url, requestOptions = {}) {
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  return response.json();
}

/**
 * Format an index value with a fixed number of decimals.
 * @param {number} indexValue - Usage per capita index.
 * @returns {string} The value as shown on the page, for example "1.62".
 */
function formatIndex(indexValue) {
  return indexValue.toFixed(VALUE_DECIMALS);
}

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
 * Create a color swatch for a rank group.
 * @param {string} tierId - Group id, for example "leading".
 * @returns {HTMLElement} A decorative swatch element.
 */
function createSwatch(tierId) {
  const swatch = createElement("span", "swatch");
  swatch.dataset.tier = tierId;
  swatch.setAttribute("aria-hidden", "true");
  return swatch;
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
 * Index the dataset for lookups and derive per-group value ranges.
 * @param {object} dataset - Parsed JSON data file.
 * @returns {object} Lookups by code, FIPS and tier, plus rank tie counts.
 */
function indexDataset(dataset) {
  const statesByCode = new Map(dataset.states.map((state) => [state.code, state]));
  const statesByFips = new Map(dataset.states.map((state) => [state.fips, state]));
  const tiersById = new Map(dataset.tiers.map((tier) => [tier.id, tier]));
  const stateCountByRank = new Map();
  for (const state of dataset.states) {
    stateCountByRank.set(state.rank, (stateCountByRank.get(state.rank) ?? 0) + 1);
  }
  return {
    states: dataset.states,
    tiers: dataset.tiers,
    statesByCode,
    statesByFips,
    tiersById,
    stateCountByRank,
  };
}

/**
 * Describe a state's rank and group, for example "Rank 12 of 51 (tied) · Leading".
 * @param {object} state - One state record.
 * @param {object} lookups - Result of indexDataset.
 * @returns {string} A short description.
 */
function describeRank(state, lookups) {
  const isTied = lookups.stateCountByRank.get(state.rank) > 1;
  const tieNote = isTied ? " (tied)" : "";
  const tierLabel = lookups.tiersById.get(state.tier).label;
  return `Rank ${state.rank} of ${lookups.states.length}${tieNote} · ${tierLabel}`;
}

/**
 * Fill the map key with each group's name, share and value range.
 * @param {HTMLElement} legendElement - The list element for the key.
 * @param {object} lookups - Result of indexDataset.
 */
function renderLegend(legendElement, lookups) {
  for (const tier of lookups.tiers) {
    const tierValues = lookups.states.filter((state) => state.tier === tier.id).map((state) => state.index);
    const rangeText = `${formatIndex(Math.min(...tierValues))} to ${formatIndex(Math.max(...tierValues))}`;

    const item = createElement("li", "legend-item");
    const text = createElement("span", "legend-text");
    text.append(
      createElement("span", "legend-label", tier.label),
      createElement("span", "legend-detail", tier.note),
      createElement("span", "legend-detail", rangeText),
    );
    item.append(createSwatch(tier.id), text);
    legendElement.append(item);
  }
}

/**
 * Fill the top 10 list with bars on a shared scale and a 1.0 reference line.
 * @param {HTMLElement} rankingElement - Wrapper that holds the axis and the list.
 * @param {object} lookups - Result of indexDataset.
 */
function renderRanking(rankingElement, lookups) {
  const topStates = lookups.states.slice(0, TOP_RANKING_COUNT);
  const maxIndex = topStates[0].index;
  rankingElement.style.setProperty("--reference-share", String(REFERENCE_INDEX / maxIndex));
  rankingElement.querySelector(".ranking-axis-label").textContent =
    REFERENCE_INDEX.toFixed(REFERENCE_DECIMALS);

  const listElement = rankingElement.querySelector(".ranking-list");
  for (const state of topStates) {
    const row = createElement("li", "ranking-row");
    const track = createElement("span", "ranking-track");
    const bar = createElement("span", "ranking-bar");
    bar.dataset.tier = state.tier;
    bar.style.setProperty("--value-share", String(state.index / maxIndex));
    track.append(bar, createElement("span", "ranking-value", formatIndex(state.index)));
    row.append(
      createElement("span", "ranking-rank", String(state.rank)),
      createElement("span", "ranking-name", state.name),
      track,
    );
    listElement.append(row);
  }
}

/**
 * Fill the full table with every state in rank order.
 * @param {HTMLElement} tableBody - The table's tbody element.
 * @param {object} lookups - Result of indexDataset.
 */
function renderTable(tableBody, lookups) {
  for (const state of lookups.states) {
    const row = document.createElement("tr");
    const groupCell = createElement("span", "group-cell");
    groupCell.append(
      createSwatch(state.tier),
      document.createTextNode(lookups.tiersById.get(state.tier).label),
    );
    const groupColumn = document.createElement("td");
    groupColumn.append(groupCell);
    row.append(
      createElement("td", "numeric", String(state.rank)),
      createElement("td", "", state.name),
      createElement("td", "numeric", formatIndex(state.index)),
      groupColumn,
    );
    tableBody.append(row);
  }
}

/**
 * Draw the state shapes, borders, dot markers and highlight overlay.
 * @param {SVGSVGElement} svgElement - Target SVG.
 * @param {object} atlas - us-atlas TopoJSON with "states" and "nation" objects.
 * @param {object} lookups - Result of indexDataset.
 * @returns {object} Per-state centroids plus the highlight overlay elements.
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
      throw new Error(`Map shape ${shape.id} (${shape.properties.name}) has no matching row in ${DATA_URL}.`);
    }
    const pathData = pathGenerator(shape);
    const statePath = createSvgElement("path", {
      d: pathData,
      class: "map-state",
      "data-code": state.code,
      "data-tier": state.tier,
    });
    stateGroup.append(statePath);
    pathByCode.set(state.code, pathData);
    centroidByCode.set(state.code, pathGenerator.centroid(shape));
  }

  const borders = createSvgElement("path", {
    d: pathGenerator(mesh(atlas, atlas.objects.states, (first, second) => first !== second)),
    class: "map-borders",
  });

  const dotGroup = createSvgElement("g", {});
  for (const code of DOT_STATE_CODES) {
    const [centerX, centerY] = centroidByCode.get(code);
    const tier = lookups.statesByCode.get(code).tier;
    dotGroup.append(
      createSvgElement("circle", {
        cx: centerX,
        cy: centerY,
        r: DOT_RADIUS,
        class: "map-dot",
        "data-tier": tier,
      }),
      createSvgElement("circle", {
        cx: centerX,
        cy: centerY,
        r: DOT_HIT_RADIUS,
        class: "map-dot-hit",
        "data-code": code,
      }),
    );
  }

  // Highlights are a dark outline with a light line inside it, so they stay
  // visible on both the lightest and the darkest fills.
  const highlightOutlines = HIGHLIGHT_STROKE_CLASSES.map((className) =>
    createSvgElement("path", { class: className }),
  );
  const highlightLayer = createSvgElement("g", { class: "map-overlay", visibility: "hidden" });
  highlightLayer.append(...highlightOutlines);

  const locatorLayer = createSvgElement("g", { class: "map-overlay", visibility: "hidden" });
  locatorLayer.append(
    ...HIGHLIGHT_STROKE_CLASSES.map((className) =>
      createSvgElement("circle", { r: LOCATOR_RADIUS, class: className }),
    ),
  );

  svgElement.replaceChildren(stateGroup, borders, highlightLayer, dotGroup, locatorLayer);
  return { pathByCode, centroidByCode, highlightLayer, highlightOutlines, locatorLayer };
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
    const { highlightLayer, highlightOutlines, locatorLayer, pathByCode, centroidByCode } = renderedMap;
    for (const outline of highlightOutlines) {
      outline.setAttribute("d", pathByCode.get(code));
    }
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
    meta.append(createSwatch(state.tier), document.createTextNode(describeRank(state, lookups)));
    tooltipElement.replaceChildren(
      createElement("p", "tooltip-name", state.name),
      createElement("p", "tooltip-value", formatIndex(state.index)),
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
    button.setAttribute(
      "aria-label",
      `${state.name}: ${formatIndex(state.index)}. ${describeRank(state, lookups)}`,
    );
    button.append(createSwatch(state.tier), document.createTextNode(code));
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
 * Show a page-level error message.
 * @param {string} message - Text for the reader.
 */
function showLoadError(message) {
  const errorElement = document.getElementById("load-error");
  errorElement.textContent = message;
  errorElement.hidden = false;
}

/**
 * Load the atlas and draw the interactive map. Map failures leave the rest of the page usable.
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
 * Load the data and render every part of the page.
 */
async function initializePage() {
  let lookups;
  try {
    lookups = indexDataset(await fetchJson(DATA_URL));
  } catch (error) {
    console.error(error);
    showLoadError(DATA_LOAD_ERROR_MESSAGE);
    return;
  }
  renderLegend(document.getElementById("legend"), lookups);
  renderRanking(document.getElementById("ranking"), lookups);
  renderTable(document.getElementById("state-table-body"), lookups);
  await initializeMap(lookups);
}

initializePage();
