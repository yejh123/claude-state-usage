/*
 * The film's script: nine scenes told as a sequence of beats. Each beat names
 * where every light and dot goes, what the camera frames, where the spark
 * leads, which labels sit on stage and which caption is showing.
 *
 * Durations are in seconds of steady scrolling. Captions live in index.html
 * (data-caption); a beat only says which caption and which of its parts show.
 */

import { RGB, toneForIndex } from "../tone.js";
import { cameraForRect, padRect } from "./camera.js";
import {
  DOT_RGB,
  boundsOfLights,
  bubbleLights,
  expectedBlock,
  extremesPair,
  fadedLight,
  lightRect,
  rankedLights,
  skyLights,
  skylineLights,
  spiralLights,
  tileLights,
  whatForBlocks,
} from "./layouts.js";

export const SCENES = [
  { id: "hook", label: "Hook" },
  { id: "fair", label: "Fair counting" },
  { id: "massachusetts", label: "Massachusetts" },
  { id: "map", label: "The map" },
  { id: "new-england", label: "New England" },
  { id: "skyline", label: "The skyline" },
  { id: "what-for", label: "What for" },
  { id: "limits", label: "Limits" },
  { id: "credits", label: "Credits" },
];

// [motion, hold] in seconds for each beat.
const TIMING = {
  hook: [0, 3.6],
  totals: [3.0, 3.6],
  resize: [2.4, 1.4],
  reorder: [3.2, 3.6],
  expected: [3.4, 0.6],
  extra: [2.4, 3.6],
  map: [3.4, 3.6],
  newEngland: [2.8, 3.6],
  skyline: [3.6, 3.8],
  toHighest: [2.0, 0.4],
  runToLowest: [3.2, 0.3],
  pair: [2.8, 3.6],
  whatFor: [3.4, 3.6],
  schoolPerPerson: [2.6, 3.6],
  limitOne: [2.8, 1.8],
  limitTwo: [0.7, 1.8],
  limitThree: [0.7, 2.4],
  credits: [3.4, 0.8],
};

const DRIFT = { sky: 2.4, bubbles: 1.2, chart: 0.35, dots: 0.25, spiral: 1.8 };
const STAGGER = { gentle: 0.2, sweep: 0.4, stepForward: 0.55, pour: 0.72, gather: 0.5 };
// When the focus light becomes a container, its dots wait until it has arrived:
// their place in the pour is pushed this far along (0 to 1).
const POUR_AFTER_STEP_FORWARD = 0.55;
const POUR_AFTER_SWEEP = 0.7;
const ARC = { none: 0, soft: 0.06, wide: 0.12 };

// Camera framing, in world units.
const FRAME_PADDING = { tight: 18, normal: 34, roomy: 60 };
const HOOK_RECT = {
  landscape: { x: 380, y: 20, width: 640, height: 470 },
  portrait: { x: 500, y: 40, width: 470, height: 400 },
};
const CLOSE_UP_WIDTH = 330;
const CLOSE_UP_HIGHEST_SHIFT = 0.25; // D.C.'s tower sits in the left quarter of the close-up
const CLOSE_UP_LOWEST_SHIFT = 0.15;
const CLOSE_UP_TOP_DROP = 0.3; // the tower's top sits this far above the frame's middle
const CLOSE_UP_RUN_CURVE = 2.6; // the run drops fast past D.C., then glides down the skyline
const LABEL_ROOM = 40; // extra world units around dot blocks for their labels
const CREDITS_SKY_SCALE = 2;
const CREDITS_SKY_FLOOR = 0.5;
const POURED_SIZE = 4; // world size of a light once it has poured into the US block
const SKYLINE_KEY = {
  landscape: "wider = more residents aged 15 to 64   ·   taller = more use per person",
  portrait: "wider = more residents aged 15 to 64\ntaller = more use per person",
};

const NOTE_RGB = [150, 156, 168];
const LABEL_RGB = [226, 229, 235];

const ORDINAL_SUFFIXES = { one: "st", two: "nd", few: "rd", other: "th" };
const ORDINAL_RULES = new Intl.PluralRules("en-US", { type: "ordinal" });
// Multiplier for a stable, scattered order of the lights (Knuth's multiplicative hash).
const SCATTER_HASH = 2654435761;
const SCATTER_RANGE = 1000;

/**
 * Write a rank as an English ordinal.
 * @param {number} rank - For example 5.
 * @returns {string} For example "5th".
 */
function ordinal(rank) {
  return `${rank}${ORDINAL_SUFFIXES[ORDINAL_RULES.select(rank)]}`;
}

/**
 * A stable pseudo-random sort key for a state, so lights scatter evenly.
 * @param {string} code - Postal code.
 * @returns {number} A number from 0 to SCATTER_RANGE.
 */
function scatterKey(code) {
  const seed = code.charCodeAt(0) * 31 + code.charCodeAt(1);
  return (seed * SCATTER_HASH) % SCATTER_RANGE;
}

/**
 * Points on a rectangle's edges.
 * @param {{x: number, y: number, width: number, height: number}} rect - The rectangle.
 * @returns {{center: number[], top: number[], bottom: number[], topLeft: number[]}} Named points.
 */
function rectPoints(rect) {
  const middleX = rect.x + rect.width / 2;
  return {
    center: [middleX, rect.y + rect.height / 2],
    top: [middleX, rect.y],
    bottom: [middleX, rect.y + rect.height],
    topLeft: [rect.x, rect.y],
  };
}

/**
 * Stage labels for the "what for" blocks: names under each block, schoolwork
 * counts beside the schoolwork rows, totals on top (per person version) and
 * the use case legend centered underneath.
 * @param {object} blocks - Result of whatForBlocks.
 * @param {object} lookups - Result of indexDataset.
 * @param {{perPerson: boolean, makeLabel: function, legend: object[]}} options - Which version
 *   of the blocks, the world-label factory and the use case legend items.
 * @returns {object[]} Label specs.
 */
function whatForLabels(blocks, lookups, { perPerson, makeLabel, legend }) {
  const { facts, focus } = lookups;
  const focusSplit = perPerson ? facts.dots.focus_per_person : facts.dots.focus_100;
  const middle = (block) => (block.left + block.right) / 2;
  const { container } = blocks;
  const reach = container.h / 2 - (blocks.focusBlock.bottom - blocks.focusBlock.top) / 2;
  const focusBottom = container.y + container.h / 2;
  const usBottom = blocks.usBlock.bottom + reach;
  const labels = [
    makeLabel("wf-focus-name", focus.name, [middle(blocks.focusBlock), focusBottom], {
      side: "below",
      style: "code",
      rgb: RGB.white,
    }),
    makeLabel("wf-us-name", "Whole US", [middle(blocks.usBlock), usBottom], {
      side: "below",
      style: "code",
      rgb: LABEL_RGB,
    }),
    makeLabel(
      `wf-focus-school-${focusSplit.coursework}`,
      String(focusSplit.coursework),
      [container.x - container.w / 2, blocks.focusGroupY.coursework],
      { side: "left", style: "value", rgb: DOT_RGB.coursework },
    ),
    makeLabel(
      "wf-us-school",
      String(facts.dots.us_100.coursework),
      [blocks.usBlock.right + reach, blocks.usGroupY.coursework],
      { side: "right", style: "value", rgb: DOT_RGB.usCoursework },
    ),
    ...legend.map((item) => ({
      ...item,
      anchor: {
        legend: true,
        world: [(blocks.focusBlock.left + blocks.usBlock.right) / 2, Math.max(focusBottom, usBottom)],
      },
    })),
  ];
  if (!perPerson) {
    return labels;
  }
  return [
    ...labels,
    makeLabel(
      "wf-focus-total",
      String(focus.per_100_expected),
      [middle(blocks.focusBlock), container.y - container.h / 2],
      { side: "above", style: "value", rgb: RGB.warm },
    ),
    makeLabel(
      "wf-us-total",
      String(facts.average_per_100),
      [middle(blocks.usBlock), blocks.usBlock.top - reach],
      { side: "above", style: "value", rgb: LABEL_RGB },
    ),
  ];
}

/**
 * Normalized order (0 to 1) of each item when sorted by a key.
 * @param {Array<number>} keys - One sort key per item; smaller goes first.
 * @returns {number[]} Each item's place in the order, scaled to 0 to 1.
 */
function orderByKeys(keys) {
  const sortedPositions = keys
    .map((key, position) => [key, position])
    .sort((first, second) => first[0] - second[0]);
  const order = Array(keys.length).fill(0);
  const last = Math.max(1, keys.length - 1);
  sortedPositions.forEach(([, position], place) => {
    order[position] = place / last;
  });
  return order;
}

/**
 * Split 100 US dots across the other states by their share of conversations,
 * so each light can pour its own dots into the US block.
 * @param {object} lookups - Result of indexDataset.
 * @param {number} dotCount - Dots in the US block.
 * @returns {number[]} The light index each US dot comes from.
 */
function usDotSources(lookups, dotCount) {
  const others = lookups.states
    .map((state, position) => ({ state, position }))
    .filter(({ state }) => state !== lookups.focus);
  const shareTotal = others.reduce((sum, { state }) => sum + state.usage_share_pct, 0);
  const exact = others.map(({ state }) => (state.usage_share_pct / shareTotal) * dotCount);
  const counts = exact.map(Math.floor);
  const byRemainder = exact
    .map((value, place) => [value - counts[place], place])
    .sort((first, second) => second[0] - first[0]);
  const leftover = dotCount - counts.reduce((sum, count) => sum + count, 0);
  for (const [, place] of byRemainder.slice(0, leftover)) {
    counts[place] += 1;
  }
  return others.flatMap(({ position }, place) => Array(counts[place]).fill(position));
}

/**
 * Build the film's beats for one screen shape.
 * @param {object} lookups - Result of indexDataset.
 * @param {{frame: object, isPortrait: boolean}} stage - The on-screen frame for the graphics.
 * @returns {object[]} Beats in order (not yet compiled).
 */
export function writeScript(lookups, stage) {
  const { states, facts, focus } = lookups;
  const focusIndex = states.indexOf(focus);
  const indexOfCode = (code) => states.findIndex((state) => state.code === code);
  const withRing = (lights) =>
    lights.map((light, position) => (position === focusIndex ? { ...light, ring: 1 } : light));
  const cameraFor = (rect, padding) => cameraForRect(padRect(rect, padding), stage.frame);

  const sources = usDotSources(lookups, facts.average_per_100);
  const focusDotCount = facts.focus_per_100_expected;
  const foldedDots = () => [
    ...Array.from({ length: focusDotCount }, () => ({ atLight: focusIndex, alpha: 0 })),
    ...sources.map((source) => ({ atLight: source, alpha: 0 })),
  ];
  const focusDotOrder = (start, count) =>
    Array.from({ length: focusDotCount }, (_, slot) => Math.min(1, Math.max(0, (slot - start) / count)));
  const usDotOrder = sources.map((_, slot) => slot / Math.max(1, sources.length - 1));
  const sequentialDots = [...focusDotOrder(0, focusDotCount), ...usDotOrder];
  const focusPourAfter = (lead) => [
    ...focusDotOrder(0, focusDotCount).map((order) => lead + (1 - lead) * order),
    ...usDotOrder,
  ];
  const lightsSky = skyLights(lookups, { toneMix: 0 });
  const flatOrder = Array(states.length).fill(0);
  const rankOrder = orderByKeys(states.map((_, position) => position));
  const totalOrder = orderByKeys(states.map((state) => -state.usage_share_pct));
  const westToEastOrder = orderByKeys(lightsSky.map((light) => light.x));
  // The closing sky is brighter than the opening one: every light comes back at least half lit.
  const lightsSkyColor = skyLights(lookups, { toneMix: 1, sizeScale: CREDITS_SKY_SCALE }).map((light) => ({
    ...light,
    alpha: CREDITS_SKY_FLOOR + (1 - CREDITS_SKY_FLOOR) * light.alpha,
    glow: light.glow + CREDITS_SKY_FLOOR,
  }));
  const bubbles = bubbleLights(lookups);
  const ranked = rankedLights(lookups, stage);
  const blockWaiting = expectedBlock(lookups, stage, { showExtra: false });
  const blockFull = expectedBlock(lookups, stage, { showExtra: true });
  const tiles = tileLights(lookups);
  const skyline = skylineLights(lookups, stage);
  const pair = extremesPair(lookups, skyline);
  const whatFor = whatForBlocks(lookups, { perPerson: false });
  const whatForPerPerson = whatForBlocks(lookups, { perPerson: true });
  const spiral = spiralLights(lookups);
  const hiddenLine = { ...ranked.averageLine, alpha: 0 };
  const extraDotCount = focusDotCount - facts.average_per_100;
  const extraDotsOrder = [...focusDotOrder(facts.average_per_100, extraDotCount), ...usDotOrder];
  // Every light but the focus state flows into the US block and fades as its dots pour out.
  const [usBlockX, usBlockY] = whatFor.usCenter;
  const pourIntoUsBlock = (focusContainer) =>
    pair.lights.map((light, position) =>
      position === focusIndex
        ? focusContainer
        : { ...light, x: usBlockX, y: usBlockY, w: POURED_SIZE, h: POURED_SIZE, round: 1, alpha: 0, glow: 0 },
    );

  const lightLabel = (id, code, text, options = {}) => ({
    id,
    text,
    anchor: { light: indexOfCode(code), side: options.side ?? "top" },
    style: options.style ?? "code",
    rgb: options.rgb ?? LABEL_RGB,
    glowRgb: options.glowRgb,
    count: options.count,
  });
  const worldLabel = (id, text, point, options = {}) => ({
    id,
    text,
    anchor: { world: point, side: options.side ?? "center" },
    style: options.style ?? "note",
    rgb: options.rgb ?? NOTE_RGB,
    count: options.count,
    swatch: options.swatch,
  });
  const frameLabel = (id, text, point, options = {}) => ({
    id,
    text,
    anchor: { frame: point, side: options.side ?? "center" },
    style: options.style ?? "note",
    rgb: options.rgb ?? NOTE_RGB,
    swatch: options.swatch,
  });
  const toneRgbOf = (code) => {
    const tone = toneForIndex(states[indexOfCode(code)].per_capita_index);
    return tone >= 0 ? RGB.warm : RGB.cool;
  };

  const focusName = lightLabel("focus-name", focus.code, focus.name, { side: "right" });
  const legendItem = (id, text, swatch) => ({
    id,
    text,
    anchor: { legend: true },
    style: "note",
    rgb: NOTE_RGB,
    swatch,
  });
  const legendLabels = [
    legendItem("legend-above", "above the US average", RGB.warm),
    legendItem("legend-below", "below the US average", RGB.cool),
  ];
  const useCaseLegend = [
    legendItem("legend-work", "work", DOT_RGB.work),
    legendItem("legend-personal", "personal life", DOT_RGB.personal),
    legendItem("legend-coursework", "schoolwork", DOT_RGB.coursework),
  ];
  const personNote = frameLabel("person-note", "A person here means a resident aged 15 to 64.", [1, 1], {
    side: "noteRight",
  });
  const totalsLabels = ["CA", "TX", "NY", "FL"].map((code) =>
    lightLabel(`bubble-${code}`, code, states[indexOfCode(code)].name, { side: "center" }),
  );
  const highest = states[indexOfCode(facts.highest_code)];
  const lowest = states[indexOfCode(facts.lowest_code)];
  const columnTop = (lights, code) => [lights[indexOfCode(code)].x, lightRect(lights[indexOfCode(code)]).y];
  const highestTop = (lights) => columnTop(lights, highest.code);
  const lowestTop = (lights) => columnTop(lights, lowest.code);
  const skylineCodes = [highest.code, "CA", "NY", focus.code, "TX", "FL", lowest.code];
  const skylineLabels = skylineCodes.map((code) =>
    lightLabel(`skyline-${code}`, code, code, { rgb: code === focus.code ? RGB.white : LABEL_RGB }),
  );
  const averageLabel = (line) =>
    worldLabel("average-label", "US average", [line.x1, line.y], { side: "lineEnd", rgb: LABEL_RGB });
  const valueText = (state) => String(state.per_100_expected);
  const highestLabel = lightLabel("pair-highest", highest.code, `D.C.  ${valueText(highest)}`, {
    rgb: RGB.warm,
  });
  const lowestLabel = lightLabel("run-lowest", lowest.code, `${lowest.name}  ${valueText(lowest)}`, {
    side: "right",
    rgb: RGB.cool,
  });

  const frameHeightInWorld = (width) => (width * stage.frame.height) / stage.frame.width;
  const [highestX, highestY] = highestTop(skyline.lights);
  const [lowestX, lowestY] = lowestTop(skyline.lights);
  const closeUpHeight = frameHeightInWorld(CLOSE_UP_WIDTH);
  const runStart = {
    x: highestX + CLOSE_UP_WIDTH * CLOSE_UP_HIGHEST_SHIFT,
    y: highestY + closeUpHeight * CLOSE_UP_TOP_DROP,
    w: CLOSE_UP_WIDTH,
  };
  const runEnd = {
    x: lowestX - CLOSE_UP_WIDTH * CLOSE_UP_LOWEST_SHIFT,
    y: Math.min(lowestY, skyline.baseline - closeUpHeight * 0.4),
    w: CLOSE_UP_WIDTH,
  };
  const runPath = (cameraX) => {
    const progress = Math.min(1, Math.max(0, (cameraX - runStart.x) / (runEnd.x - runStart.x)));
    return runStart.y + (runEnd.y - runStart.y) * (1 - (1 - progress) ** CLOSE_UP_RUN_CURVE);
  };

  const blockLabelRect = (rect) => padRect(rect, LABEL_ROOM);
  const containerEdge = (container) => ({
    top: container.y - container.h / 2,
    bottom: container.y + container.h / 2,
  });
  const expectedNote = worldLabel(
    "expected-note",
    "100 expected at the US average rate",
    [rectPoints(blockWaiting.expectedRect).center[0], containerEdge(blockFull.container).bottom],
    { side: "below", rgb: RGB.cool },
  );
  const blockName = lightLabel("block-name", focus.code, focus.name, { side: "aboveLeft", rgb: RGB.white });
  const whatForRect = {
    x: whatForPerPerson.focusBlock.left,
    y: whatForPerPerson.focusBlock.top,
    width: whatForPerPerson.usBlock.right - whatForPerPerson.focusBlock.left,
    height: whatForPerPerson.focusBlock.bottom - whatForPerPerson.focusBlock.top,
  };

  const newEnglandRect = tiles.tileRect(facts.new_england_codes);
  const newEnglandLabels = facts.new_england_codes.flatMap((code) => {
    const state = states[indexOfCode(code)];
    return [
      lightLabel(`ne-value-${code}`, code, valueText(state), {
        side: "center",
        style: "tileValue",
        rgb: RGB.white,
        glowRgb: toneRgbOf(code),
        count: { from: 0, to: state.per_100_expected },
      }),
      lightLabel(`tile-${code}`, code, code, { side: "insideTopLeft", style: "tileCode" }),
    ];
  });

  const beats = [
    {
      id: "hook",
      scene: "hook",
      timing: TIMING.hook,
      lights: lightsSky,
      dots: foldedDots(),
      line: hiddenLine,
      camera: cameraForRect(HOOK_RECT[stage.isPortrait ? "portrait" : "landscape"], stage.frame),
      spark: [lightsSky[focusIndex].x, lightsSky[focusIndex].y],
      labels: [focusName],
      caption: { id: "hook", parts: ["title", "line"] },
      drift: DRIFT.sky,
      pulse: 1,
    },
    {
      id: "totals",
      scene: "fair",
      timing: TIMING.totals,
      lights: bubbles.totals,
      lightOrder: totalOrder,
      lightStagger: STAGGER.sweep,
      arc: ARC.soft,
      dots: foldedDots(),
      line: hiddenLine,
      camera: cameraFor(boundsOfLights([...bubbles.perPerson, ...bubbles.totals]), FRAME_PADDING.normal),
      spark: [bubbles.totals[indexOfCode("CA")].x, bubbles.totals[indexOfCode("CA")].y],
      labels: [...totalsLabels, lightLabel("focus-code", focus.code, focus.code, { rgb: RGB.white })],
      caption: { id: "totals", parts: ["title", "line"] },
      drift: DRIFT.bubbles,
      pulse: 0,
    },
    {
      id: "resize",
      scene: "fair",
      timing: TIMING.resize,
      lights: bubbles.perPerson,
      lightOrder: rankOrder,
      lightStagger: STAGGER.gentle,
      dots: foldedDots(),
      line: hiddenLine,
      camera: cameraFor(boundsOfLights([...bubbles.perPerson, ...bubbles.totals]), FRAME_PADDING.normal),
      spark: [bubbles.perPerson[indexOfCode("TX")].x, bubbles.perPerson[indexOfCode("TX")].y],
      labels: [
        ...totalsLabels,
        lightLabel("focus-code", focus.code, focus.code, { rgb: RGB.white }),
        ...legendLabels,
        personNote,
      ],
      caption: { id: "per-person", parts: ["title"] },
      drift: DRIFT.bubbles,
      pulse: 0,
    },
    {
      id: "reorder",
      scene: "fair",
      timing: TIMING.reorder,
      lights: ranked.lights,
      lightOrder: rankOrder,
      lightStagger: STAGGER.sweep,
      arc: ARC.wide,
      dots: foldedDots(),
      line: ranked.averageLine,
      camera: cameraFor(ranked.focusRect, FRAME_PADDING.roomy),
      spark: [ranked.lights[focusIndex].x, ranked.lights[focusIndex].y],
      labels: [
        lightLabel("focus-rank", focus.code, `${focus.code} · ${ordinal(focus.rank_per_person)}`, {
          side: "belowLeft",
          rgb: RGB.white,
        }),
        lightLabel("rank-TX", "TX", "TX", { side: "bottom", rgb: RGB.cool }),
        lightLabel("rank-CA", "CA", "CA"),
        lightLabel("rank-DC", highest.code, "D.C.", { side: "right" }),
        averageLabel(ranked.averageLine),
        ...legendLabels,
        personNote,
      ],
      caption: { id: "per-person", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "expected",
      scene: "massachusetts",
      timing: TIMING.expected,
      lights: ranked.lights.map((light, position) =>
        position === focusIndex ? blockWaiting.container : fadedLight(light),
      ),
      lightStagger: STAGGER.stepForward,
      dots: [...blockWaiting.dots, ...foldedDots().slice(focusDotCount)],
      dotOrder: focusPourAfter(POUR_AFTER_STEP_FORWARD),
      dotStagger: STAGGER.pour,
      line: { ...ranked.averageLine, alpha: 0 },
      camera: cameraFor(blockLabelRect(blockFull.fullRect), FRAME_PADDING.tight),
      spark: rectPoints(blockWaiting.expectedRect).center,
      labels: [expectedNote, blockName],
      caption: { id: "massachusetts", parts: [] },
      drift: DRIFT.dots,
      pulse: 0,
    },
    {
      id: "extra",
      scene: "massachusetts",
      timing: TIMING.extra,
      lights: ranked.lights.map((light, position) =>
        position === focusIndex ? blockFull.container : fadedLight(light),
      ),
      dots: [...blockFull.dots, ...foldedDots().slice(focusDotCount)],
      dotOrder: extraDotsOrder,
      dotStagger: STAGGER.pour,
      line: { ...ranked.averageLine, alpha: 0 },
      camera: cameraFor(blockLabelRect(blockFull.fullRect), FRAME_PADDING.tight),
      spark: rectPoints(blockFull.extraRect).center,
      labels: [
        expectedNote,
        blockName,
        lightLabel("extra-value", focus.code, `+${facts.focus_extra_pct}`, {
          side: "aboveRight",
          style: "value",
          rgb: RGB.warm,
        }),
      ],
      caption: { id: "massachusetts", parts: ["title", "line"] },
      drift: DRIFT.dots,
      pulse: 0,
    },
    {
      id: "map",
      scene: "map",
      timing: TIMING.map,
      lights: tiles.lights,
      lightOrder: westToEastOrder,
      lightStagger: STAGGER.sweep,
      arc: ARC.soft,
      dots: foldedDots(),
      dotOrder: sequentialDots.map((order) => 1 - order),
      dotStagger: STAGGER.gather,
      line: { ...ranked.averageLine, alpha: 0 },
      camera: cameraFor(boundsOfLights(tiles.lights), FRAME_PADDING.normal),
      spark: [tiles.lights[focusIndex].x, tiles.lights[focusIndex].y],
      labels: [
        ...states.map((state) =>
          lightLabel(`tile-${state.code}`, state.code, state.code, {
            side: "insideTopLeft",
            style: "tileCode",
            rgb: state === focus ? RGB.white : LABEL_RGB,
          }),
        ),
        ...legendLabels,
      ],
      caption: { id: "map", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "new-england",
      scene: "new-england",
      timing: TIMING.newEngland,
      lights: tiles.lights.map((light, position) =>
        facts.new_england_codes.includes(states[position].code) ? light : fadedLight(light),
      ),
      lightOrder: flatOrder,
      lightStagger: 0,
      dots: foldedDots(),
      line: { ...ranked.averageLine, alpha: 0 },
      camera: cameraFor(padRect(newEnglandRect, 0), FRAME_PADDING.roomy),
      spark: [tiles.lights[indexOfCode("CT")].x, tiles.lights[indexOfCode("CT")].y],
      labels: [
        ...newEnglandLabels,
        worldLabel("ne-note", "conversations per 100 expected", rectPoints(newEnglandRect).bottom, {
          side: "below",
        }),
      ],
      caption: { id: "new-england", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "skyline",
      scene: "skyline",
      timing: TIMING.skyline,
      lights: skyline.lights,
      lightOrder: rankOrder,
      lightStagger: STAGGER.sweep,
      dots: foldedDots(),
      line: skyline.averageLine,
      camera: cameraFor(boundsOfLights(skyline.lights), FRAME_PADDING.normal),
      spark: [skyline.lights[indexOfCode("CA")].x, lightRect(skyline.lights[indexOfCode("CA")]).y],
      labels: [
        ...skylineLabels,
        averageLabel(skyline.averageLine),
        worldLabel("skyline-key", SKYLINE_KEY[stage.isPortrait ? "portrait" : "landscape"], [
          (skyline.left + skyline.right) / 2,
          skyline.baseline,
        ], { side: "below" }),
      ],
      caption: { id: "skyline", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "to-highest",
      scene: "skyline",
      timing: TIMING.toHighest,
      lights: skyline.lights,
      dots: foldedDots(),
      line: skyline.averageLine,
      camera: runStart,
      spark: highestTop(skyline.lights),
      labels: [
        highestLabel,
        averageLabel(skyline.averageLine),
      ],
      caption: { id: "gap", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "run-to-lowest",
      scene: "skyline",
      timing: TIMING.runToLowest,
      lights: skyline.lights,
      dots: foldedDots(),
      line: skyline.averageLine,
      camera: runEnd,
      cameraTrack: runPath,
      spark: lowestTop(skyline.lights),
      labels: [
        highestLabel,
        lowestLabel,
        lightLabel("skyline-MA", focus.code, focus.code, { rgb: RGB.white }),
      ],
      caption: { id: "gap", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "pair",
      scene: "skyline",
      timing: TIMING.pair,
      lights: pair.lights,
      lightOrder: flatOrder,
      lightStagger: 0,
      arc: ARC.none,
      dots: foldedDots(),
      line: { ...skyline.averageLine, alpha: 0.55 },
      camera: cameraFor(pair.pairRect, FRAME_PADDING.roomy),
      spark: highestTop(pair.lights),
      labels: [
        highestLabel,
        lowestLabel,
        worldLabel("pair-note", "conversations per 100 expected", rectPoints(pair.pairRect).bottom, {
          side: "below",
        }),
      ],
      caption: { id: "gap", parts: ["title", "line"] },
      drift: DRIFT.chart,
      pulse: 0,
    },
    {
      id: "what-for",
      scene: "what-for",
      timing: TIMING.whatFor,
      lights: pourIntoUsBlock(whatFor.container),
      lightOrder: rankOrder,
      lightStagger: STAGGER.sweep,
      arc: ARC.soft,
      dots: [...whatFor.focusDots, ...whatFor.usDots],
      dotOrder: focusPourAfter(POUR_AFTER_SWEEP),
      dotStagger: STAGGER.pour,
      line: { ...skyline.averageLine, alpha: 0 },
      camera: cameraFor(blockLabelRect(whatForRect), FRAME_PADDING.tight),
      spark: [whatFor.focusBlock.left, whatFor.focusGroupY.coursework],
      labels: whatForLabels(whatFor, lookups, {
        perPerson: false,
        makeLabel: worldLabel,
        legend: useCaseLegend,
      }),
      caption: { id: "what-for", parts: ["title", "line"] },
      drift: DRIFT.dots,
      pulse: 0,
    },
    {
      id: "school-per-person",
      scene: "what-for",
      timing: TIMING.schoolPerPerson,
      lights: pourIntoUsBlock(whatForPerPerson.container),
      dots: [...whatForPerPerson.focusDots, ...whatForPerPerson.usDots],
      dotOrder: extraDotsOrder,
      dotStagger: STAGGER.gather,
      line: { ...skyline.averageLine, alpha: 0 },
      camera: cameraFor(blockLabelRect(whatForRect), FRAME_PADDING.tight),
      spark: [whatForPerPerson.focusBlock.left, whatForPerPerson.focusGroupY.coursework],
      labels: whatForLabels(whatForPerPerson, lookups, {
        perPerson: true,
        makeLabel: worldLabel,
        legend: useCaseLegend,
      }),
      caption: { id: "school-per-person", parts: ["title", "line"] },
      drift: DRIFT.dots,
      pulse: 0,
    },
    ...["limit-one", "limit-two", "limit-three"].map((id, step) => ({
      id,
      scene: "limits",
      timing: [TIMING.limitOne, TIMING.limitTwo, TIMING.limitThree][step],
      lights: spiral,
      lightOrder: rankOrder,
      lightStagger: STAGGER.sweep,
      arc: ARC.wide,
      dots: foldedDots(),
      dotOrder: sequentialDots.map((order) => 1 - order),
      dotStagger: STAGGER.gather,
      line: { ...skyline.averageLine, alpha: 0 },
      camera: cameraFor(boundsOfLights(spiral), FRAME_PADDING.roomy * 2),
      spark: [spiral[focusIndex].x, spiral[focusIndex].y],
      labels: [],
      caption: { id: "limits", parts: ["one", "two", "three"].slice(0, step + 1) },
      drift: DRIFT.spiral,
      pulse: 0,
    })),
    {
      id: "credits",
      scene: "credits",
      timing: TIMING.credits,
      lights: lightsSkyColor,
      lightOrder: orderByKeys(states.map((state) => scatterKey(state.code))),
      lightStagger: STAGGER.sweep,
      arc: ARC.wide,
      dots: foldedDots(),
      line: { ...skyline.averageLine, alpha: 0 },
      camera: cameraFor(boundsOfLights(lightsSkyColor), FRAME_PADDING.roomy),
      spark: [lightsSkyColor[focusIndex].x, lightsSkyColor[focusIndex].y],
      labels: [],
      caption: null,
      drift: DRIFT.sky,
      pulse: 0.5,
    },
  ];

  return beats.map((beat) => ({
    ...beat,
    motion: beat.timing[0],
    hold: beat.timing[1],
    lights: withRing(beat.lights),
    lightOrder: beat.lightOrder ?? flatOrder,
    lightStagger: beat.lightStagger ?? 0,
    arc: beat.arc ?? ARC.none,
    dotOrder: beat.dotOrder ?? sequentialDots,
    dotStagger: beat.dotStagger ?? STAGGER.gather,
  }));
}
