/*
 * Renders the Claude.ai state story from data/claude-ai-by-state-2026-05.json:
 * the map key, the labeled map, the top 10 ranking, the use-case chart and the
 * full table.
 *
 * Map shapes come from us-atlas (pre-projected Albers USA), so d3.geoPath runs
 * with no projection. d3 and topojson-client are loaded as globals by
 * index.html before this module runs.
 */

const DATA_URL = "data/claude-ai-by-state-2026-05.json";
const ATLAS_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json";
const ATLAS_INTEGRITY = "sha384-vyqp+z8MYIFZU8V1K7x8eeS6f4qq+zp2l6YqE81ZLpCykssi+zpvpQSkQNRqIaJb";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const TOP_RANKING_COUNT = 10;
const REFERENCE_INDEX = 1;
const VALUE_DECIMALS = 2;
const REFERENCE_DECIMALS = 1;
const SHARE_DECIMALS = 1;
const PERCENT_SIGN = "%";

const DC_CODE = "DC";
// Shorter names for labels and the map key, where the full name is too long.
const SHORT_NAMES = new Map([[DC_CODE, "D.C."]]);

// States too small to hover or tap reliably on a phone, listed north to south.
const SMALL_STATE_CODES = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
// States drawn as a dot because their shape is only a few pixels wide.
const DOT_STATE_CODES = [DC_CODE];

// Labels drawn on the map. `offsetPx` moves the label from the state's centroid
// in screen pixels, so labels stay the same distance from their state at any
// map width. `placement` says which way the label extends from that point; a
// leader line joins label and state when the label sits outside the state.
// `compactName` is the AP abbreviation shown when the map is narrow.
const MAP_LABELS = [
  { code: "CA", compactName: "Calif.", offsetPx: [0, 6], placement: "center", hasLeader: false },
  { code: "DC", compactName: "D.C.", offsetPx: [40, 26], placement: "right", hasLeader: true },
  { code: "WV", compactName: "W.Va.", offsetPx: [-28, 28], placement: "left", hasLeader: true },
];
const PLACEMENT_SHIFTS = { right: 0, center: 0.5, left: 1 };
// Space between a state's centroid and the start of its leader line.
const LEADER_START_GAP_PX = 5;

// Map geometry, in the atlas's coordinate space.
const MAP_PADDING = 4;
const DOT_RADIUS = 5;
const DOT_HIT_RADIUS = 14;
const LOCATOR_RADIUS = 20;
const HIGHLIGHT_STROKE_CLASSES = ["map-highlight-outer", "map-highlight-inner"];

// The two groups the use-case chart compares, and the parts of each bar.
const USE_GROUPS = [
  { label: "Above 1.0", isMember: (state) => state.index > REFERENCE_INDEX },
  { label: "Below 1.0", isMember: (state) => state.index < REFERENCE_INDEX },
];
const USE_CASES = [
  { id: "work", field: "work_pct", label: "Work" },
  { id: "personal", field: "personal_pct", label: "Personal" },
  { id: "coursework", field: "coursework_pct", label: "Coursework" },
];
// Room a share label keeps between its text and the right end of its bar part.
const PART_LABEL_END_GAP_PX = 4;

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
 * Format a percentage, rounded to a whole number unless decimals are asked for.
 * @param {number} percentValue - A share from 0 to 100.
 * @param {number} [decimals] - Digits after the point.
 * @returns {string} For example "41%".
 */
function formatPercent(percentValue, decimals = 0) {
  return `${percentValue.toFixed(decimals)}${PERCENT_SIGN}`;
}

/**
 * Give the name used in labels and the map key, for example "D.C.".
 * @param {object} state - One state record.
 * @returns {string} The short name, or the full name when there is none.
 */
function shortName(state) {
  return SHORT_NAMES.get(state.code) ?? state.name;
}

/**
 * Describe a set of places in a few words, for example "15 states and D.C.".
 * @param {object[]} states - State records.
 * @returns {string} The name for one place, otherwise a count.
 */
function describePlaces(states) {
  if (states.length === 1) {
    return shortName(states[0]);
  }
  const hasDc = states.some((state) => state.code === DC_CODE);
  const stateCount = hasDc ? states.length - 1 : states.length;
  const stateText = `${stateCount} ${stateCount === 1 ? "state" : "states"}`;
  return hasDc ? `${stateText} and ${SHORT_NAMES.get(DC_CODE)}` : stateText;
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
 * Create a color swatch for a band.
 * @param {string} bandId - Band id, for example "above".
 * @returns {HTMLElement} A decorative swatch element.
 */
function createSwatch(bandId) {
  const swatch = createElement("span", "swatch");
  swatch.dataset.band = bandId;
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
 * Index the dataset for lookups.
 * @param {object} dataset - Parsed JSON data file.
 * @returns {object} Lookups by code, FIPS and band, plus rank tie counts.
 */
function indexDataset(dataset) {
  const stateCountByRank = new Map();
  for (const state of dataset.states) {
    stateCountByRank.set(state.rank, (stateCountByRank.get(state.rank) ?? 0) + 1);
  }
  return {
    states: dataset.states,
    bands: dataset.bands,
    statesByCode: new Map(dataset.states.map((state) => [state.code, state])),
    statesByFips: new Map(dataset.states.map((state) => [state.fips, state])),
    bandsById: new Map(dataset.bands.map((band) => [band.id, band])),
    stateCountByRank,
  };
}

/**
 * Describe a state's band and rank, for example "Above 1.0 · Rank 12 of 51 (tied)".
 * @param {object} state - One state record.
 * @param {object} lookups - Result of indexDataset.
 * @returns {string} A short description.
 */
function describeRank(state, lookups) {
  const isTied = lookups.stateCountByRank.get(state.rank) > 1;
  const tieNote = isTied ? " (tied)" : "";
  const bandLabel = lookups.bandsById.get(state.band).label;
  return `${bandLabel} · Rank ${state.rank} of ${lookups.states.length}${tieNote}`;
}

/**
 * Fill the map key: one cell per band, low to high, with its range and members.
 * @param {HTMLElement} listElement - The list element for the key.
 * @param {object} lookups - Result of indexDataset.
 */
function renderLegend(listElement, lookups) {
  for (const band of lookups.bands) {
    const members = lookups.states.filter((state) => state.band === band.id);
    const item = createElement("li", "legend-item");
    const bar = createElement("span", "legend-bar");
    bar.dataset.band = band.id;
    bar.setAttribute("aria-hidden", "true");
    item.append(
      bar,
      createElement("span", "legend-range", band.range),
      createElement("span", "legend-places", describePlaces(members)),
    );
    item.setAttribute("aria-label", `${band.label} (${band.range}): ${describePlaces(members)}`);
    listElement.append(item);
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
    bar.dataset.band = state.band;
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
 * Average each use-case share over a group of states, each state counted equally.
 * @param {object[]} states - State records in the group.
 * @returns {Map<string, number>} Mean share by use-case id.
 */
function averageUseShares(states) {
  return new Map(
    USE_CASES.map((useCase) => [
      useCase.id,
      states.reduce((total, state) => total + state[useCase.field], 0) / states.length,
    ]),
  );
}

/**
 * Fill the use-case key with one swatch per part, in bar order.
 * @param {HTMLElement} legendElement - The list element for the key.
 */
function renderUseLegend(legendElement) {
  for (const useCase of USE_CASES) {
    const item = createElement("li", "use-legend-item");
    const swatch = createElement("span", "use-swatch");
    swatch.dataset.use = useCase.id;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(useCase.label));
    legendElement.append(item);
  }
}

/**
 * Draw one segmented bar per group, split into work, personal and coursework.
 * @param {HTMLElement} rowsElement - Container for the bars.
 * @param {object} lookups - Result of indexDataset.
 */
function renderUseRows(rowsElement, lookups) {
  for (const group of USE_GROUPS) {
    const members = lookups.states.filter(group.isMember);
    const placesText = describePlaces(members);
    const shareById = averageUseShares(members);

    const label = createElement("p", "use-row-label");
    label.append(
      createElement("span", "use-row-name", group.label),
      createElement("span", "use-row-places", placesText),
    );

    const bar = createElement("div", "use-bar");
    bar.setAttribute("role", "img");
    const partDescriptions = USE_CASES.map(
      (useCase) => `${useCase.label.toLowerCase()} ${formatPercent(shareById.get(useCase.id))}`,
    );
    bar.setAttribute("aria-label", `${group.label}, ${placesText}: ${partDescriptions.join(", ")}`);
    bar.style.gridTemplateColumns = USE_CASES.map((useCase) => `${shareById.get(useCase.id)}fr`).join(" ");
    for (const useCase of USE_CASES) {
      const share = shareById.get(useCase.id);
      const part = createElement("span", "use-part");
      part.dataset.use = useCase.id;
      part.dataset.share = formatPercent(share, SHARE_DECIMALS);
      part.dataset.description = `${useCase.label} · ${group.label}, ${placesText}`;
      part.append(createElement("span", "use-part-value", formatPercent(share)));
      bar.append(part);
    }

    const row = createElement("div", "use-row");
    row.append(label, bar);
    rowsElement.append(row);
  }
}

/**
 * Show each part's share label only where it fits inside the part.
 * @param {HTMLElement} rowsElement - Container for the bars.
 */
function fitUseLabels(rowsElement) {
  for (const part of rowsElement.querySelectorAll(".use-part")) {
    const valueElement = part.querySelector(".use-part-value");
    valueElement.hidden = false;
    const leftPadding = Number.parseFloat(getComputedStyle(part).paddingLeft);
    valueElement.hidden = leftPadding + valueElement.offsetWidth + PART_LABEL_END_GAP_PX > part.clientWidth;
  }
}

/**
 * Fill the full table with every state in rank order.
 * @param {HTMLElement} tableBody - The table's tbody element.
 * @param {object} lookups - Result of indexDataset.
 */
function renderTable(tableBody, lookups) {
  for (const state of lookups.states) {
    const bandCell = createElement("span", "band-cell");
    const bandLabel = lookups.bandsById.get(state.band).label;
    bandCell.append(createSwatch(state.band), document.createTextNode(bandLabel));
    const bandColumn = document.createElement("td");
    bandColumn.append(bandCell);
    const row = document.createElement("tr");
    row.append(
      createElement("td", "numeric", String(state.rank)),
      createElement("td", "", state.name),
      createElement("td", "numeric", formatIndex(state.index)),
      bandColumn,
      createElement("td", "numeric", formatPercent(state.work_pct)),
    );
    tableBody.append(row);
  }
}

/**
 * Create a tooltip that sits beside a point and stays inside its frame.
 * @param {HTMLElement} frameElement - Positioned container the tooltip is clamped to.
 * @param {HTMLElement} tooltipElement - The tooltip element inside the frame.
 * @returns {{show: Function, hide: Function}} Show it at a viewport point, or hide it.
 */
function createTooltip(frameElement, tooltipElement) {
  function place(clientX, clientY) {
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

  function show(contentElements, clientX, clientY) {
    if (contentElements) {
      tooltipElement.replaceChildren(...contentElements);
    }
    tooltipElement.hidden = false;
    place(clientX, clientY);
  }

  function hide() {
    tooltipElement.hidden = true;
  }

  return { show, hide };
}

/**
 * Draw the state shapes, borders, dot markers, label leaders and highlight overlay.
 * @param {SVGSVGElement} svgElement - Target SVG.
 * @param {object} atlas - us-atlas TopoJSON with "states" and "nation" objects.
 * @param {object} lookups - Result of indexDataset.
 * @returns {object} The view box, per-state paths and centroids, and the highlight overlay.
 */
function renderMap(svgElement, atlas, lookups) {
  const { geoPath } = globalThis.d3;
  const { feature, mesh } = globalThis.topojson;
  const pathGenerator = geoPath();

  const [[minX, minY], [maxX, maxY]] = pathGenerator.bounds(feature(atlas, atlas.objects.nation));
  const viewBox = {
    x: minX - MAP_PADDING,
    y: minY - MAP_PADDING,
    width: maxX - minX + 2 * MAP_PADDING,
    height: maxY - minY + 2 * MAP_PADDING,
  };
  svgElement.setAttribute("viewBox", [viewBox.x, viewBox.y, viewBox.width, viewBox.height].join(" "));

  const stateGroup = createSvgElement("g", {});
  const pathByCode = new Map();
  const centroidByCode = new Map();
  for (const shape of feature(atlas, atlas.objects.states).features) {
    const state = lookups.statesByFips.get(shape.id);
    if (!state) {
      throw new Error(`Map shape ${shape.id} (${shape.properties.name}) has no matching row in ${DATA_URL}.`);
    }
    const pathData = pathGenerator(shape);
    stateGroup.append(
      createSvgElement("path", {
        d: pathData,
        class: "map-state",
        "data-code": state.code,
        "data-band": state.band,
      }),
    );
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
    dotGroup.append(
      createSvgElement("circle", {
        cx: centerX,
        cy: centerY,
        r: DOT_RADIUS,
        class: "map-dot",
        "data-band": lookups.statesByCode.get(code).band,
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
  return { viewBox, pathByCode, centroidByCode, highlightLayer, highlightOutlines, locatorLayer };
}

/**
 * Create the name-and-value labels and their leader lines. Positions are set by layoutMapLabels.
 * @param {HTMLElement} labelsElement - HTML overlay that holds the labels.
 * @param {SVGSVGElement} leadersElement - SVG overlay, in screen pixels, that holds the leader lines.
 * @param {object} lookups - Result of indexDataset.
 * @returns {object[]} One entry per label: its settings, element and leader line (or null).
 */
function renderMapLabels(labelsElement, leadersElement, lookups) {
  return MAP_LABELS.map((mapLabel) => {
    const state = lookups.statesByCode.get(mapLabel.code);
    const label = createElement("span", "map-label");
    label.dataset.placement = mapLabel.placement;
    label.append(
      createElement("span", "map-label-name map-label-name-full", shortName(state)),
      createElement("span", "map-label-name map-label-name-compact", mapLabel.compactName),
      createElement("span", "map-label-value", formatIndex(state.index)),
    );
    labelsElement.append(label);

    const leader = mapLabel.hasLeader ? createSvgElement("line", {}) : null;
    if (leader) {
      leadersElement.append(leader);
    }
    return { mapLabel, label, leader };
  });
}

/**
 * Work out where a label's box goes, kept inside the map frame.
 * @param {{x: number, y: number}} anchor - The state's centroid, in frame pixels.
 * @param {object} mapLabel - One entry of MAP_LABELS.
 * @param {object} sizes - The label's and the frame's width and height, in pixels.
 * @returns {{left: number, top: number, right: number, bottom: number}} The box, in frame pixels.
 */
function placeLabelBox(anchor, mapLabel, sizes) {
  const [offsetX, offsetY] = mapLabel.offsetPx;
  const preferredLeft = anchor.x + offsetX - sizes.labelWidth * PLACEMENT_SHIFTS[mapLabel.placement];
  const preferredTop = anchor.y + offsetY - sizes.labelHeight / 2;
  const left = Math.min(Math.max(preferredLeft, 0), sizes.frameWidth - sizes.labelWidth);
  const top = Math.min(Math.max(preferredTop, 0), sizes.frameHeight - sizes.labelHeight);
  return { left, top, right: left + sizes.labelWidth, bottom: top + sizes.labelHeight };
}

/**
 * Draw a leader from just outside a state's centroid to the nearest point of its label.
 * @param {SVGLineElement} leader - The line to move.
 * @param {{x: number, y: number}} anchor - The state's centroid, in frame pixels.
 * @param {object} box - The label's box from placeLabelBox.
 */
function drawLeader(leader, anchor, box) {
  const endX = Math.min(Math.max(anchor.x, box.left), box.right);
  const endY = Math.min(Math.max(anchor.y, box.top), box.bottom);
  const length = Math.hypot(endX - anchor.x, endY - anchor.y);
  const isTooShort = length <= LEADER_START_GAP_PX;
  leader.setAttribute("visibility", isTooShort ? "hidden" : "visible");
  if (isTooShort) {
    return;
  }
  const gapShare = LEADER_START_GAP_PX / length;
  leader.setAttribute("x1", String(anchor.x + (endX - anchor.x) * gapShare));
  leader.setAttribute("y1", String(anchor.y + (endY - anchor.y) * gapShare));
  leader.setAttribute("x2", String(endX));
  leader.setAttribute("y2", String(endY));
}

/**
 * Position every map label and leader for the map's current size.
 * @param {object[]} labelEntries - Result of renderMapLabels.
 * @param {object} renderedMap - Result of renderMap.
 * @param {HTMLElement} frameElement - The map frame the labels are positioned in.
 */
function layoutMapLabels(labelEntries, renderedMap, frameElement) {
  const { viewBox, centroidByCode } = renderedMap;
  const frameWidth = frameElement.clientWidth;
  const frameHeight = frameElement.clientHeight;
  const pixelsPerUnit = frameWidth / viewBox.width;
  for (const { mapLabel, label, leader } of labelEntries) {
    const [centerX, centerY] = centroidByCode.get(mapLabel.code);
    const anchor = { x: (centerX - viewBox.x) * pixelsPerUnit, y: (centerY - viewBox.y) * pixelsPerUnit };
    const sizes = { labelWidth: label.offsetWidth, labelHeight: label.offsetHeight, frameWidth, frameHeight };
    const box = placeLabelBox(anchor, mapLabel, sizes);
    label.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
    if (leader) {
      drawLeader(leader, anchor, box);
    }
  }
}

/**
 * Build the tooltip content for one state.
 * @param {object} state - One state record.
 * @param {object} lookups - Result of indexDataset.
 * @returns {HTMLElement[]} Elements for the tooltip.
 */
function describeStateForTooltip(state, lookups) {
  const meta = createElement("p", "tooltip-meta");
  meta.append(createSwatch(state.band), document.createTextNode(describeRank(state, lookups)));
  return [
    createElement("p", "tooltip-name", state.name),
    createElement("p", "tooltip-value", formatIndex(state.index)),
    meta,
    createElement("p", "tooltip-note", `${formatPercent(state.work_pct)} of conversations for work`),
  ];
}

/**
 * Create the controller that shows one state's tooltip and map highlight.
 * @param {object} mapView - Elements for the map (svg, tooltip, rendered map, buttons).
 * @param {object} lookups - Result of indexDataset.
 * @returns {{showAtPoint: Function, showAtState: Function, hide: Function}} The controller.
 */
function createInspector(mapView, lookups) {
  const { svgElement, tooltip, renderedMap, buttonsByCode } = mapView;
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

  function showAtPoint(code, clientX, clientY) {
    const isNewState = code !== activeCode;
    if (isNewState) {
      setHighlight(code);
      activeCode = code;
    }
    const content = isNewState ? describeStateForTooltip(lookups.statesByCode.get(code), lookups) : null;
    tooltip.show(content, clientX, clientY);
  }

  // Anchor the tooltip at a state's centroid, for keyboard focus and buttons.
  function showAtState(code) {
    const [centerX, centerY] = renderedMap.centroidByCode.get(code);
    const screenPoint = new DOMPoint(centerX, centerY).matrixTransform(svgElement.getScreenCTM());
    showAtPoint(code, screenPoint.x, screenPoint.y);
  }

  function hide() {
    activeCode = null;
    tooltip.hide();
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
    button.append(createSwatch(state.band), document.createTextNode(code));
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
 * Connect hover, tap, focus and keyboard events on the map to the inspector.
 * @param {object} mapView - Elements for the map (svg and small-state container).
 * @param {object} inspector - Result of createInspector.
 */
function wireMapInteractions(mapView, inspector) {
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
 * Show a tooltip with the exact share when the reader hovers over or taps a bar part.
 * @param {HTMLElement} rowsElement - Container for the bars.
 * @param {object} tooltip - Result of createTooltip.
 */
function wireUseInteractions(rowsElement, tooltip) {
  function showForEvent(event) {
    const part = event.target.closest(".use-part");
    if (!part) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      [
        createElement("p", "tooltip-value", part.dataset.share),
        createElement("p", "tooltip-meta", part.dataset.description),
      ],
      event.clientX,
      event.clientY,
    );
  }

  rowsElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === MOUSE_POINTER_TYPE) {
      showForEvent(event);
    }
  });
  rowsElement.addEventListener("pointerleave", (event) => {
    if (event.pointerType === MOUSE_POINTER_TYPE) {
      tooltip.hide();
    }
  });
  rowsElement.addEventListener("click", showForEvent);
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".use-part")) {
      tooltip.hide();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === ESCAPE_KEY) {
      tooltip.hide();
    }
  });
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
 * Draw the use-case chart and keep its share labels fitted as the page resizes.
 * @param {object} lookups - Result of indexDataset.
 */
function initializeUseChart(lookups) {
  const rowsElement = document.getElementById("use-rows");
  renderUseLegend(document.getElementById("use-legend"));
  renderUseRows(rowsElement, lookups);
  new ResizeObserver(() => fitUseLabels(rowsElement)).observe(rowsElement);
  const tooltip = createTooltip(document.getElementById("use-frame"), document.getElementById("use-tooltip"));
  wireUseInteractions(rowsElement, tooltip);
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
    const labelEntries = renderMapLabels(
      document.getElementById("map-labels"),
      document.getElementById("map-leaders"),
      lookups,
    );
    new ResizeObserver(() => layoutMapLabels(labelEntries, renderedMap, frameElement)).observe(frameElement);
    const buttonContainer = document.getElementById("small-state-buttons");
    const buttonsByCode = renderSmallStateButtons(buttonContainer, lookups);
    const tooltip = createTooltip(frameElement, document.getElementById("map-tooltip"));
    const mapView = { svgElement, tooltip, renderedMap, buttonsByCode, buttonContainer };
    wireMapInteractions(mapView, createInspector(mapView, lookups));
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
  renderLegend(document.getElementById("legend-list"), lookups);
  renderRanking(document.getElementById("ranking"), lookups);
  initializeUseChart(lookups);
  renderTable(document.getElementById("state-table-body"), lookups);
  await initializeMap(lookups);
}

initializePage();
