/*
 * Every shape the film's lights and dots move into, in world units.
 *
 * A light is one state's glowing shape. Its state is a plain object:
 *   x, y      center in world units
 *   w, h      width and height in world units
 *   round     0 = sharp corners, 1 = fully round (circle or pill)
 *   alpha     overall visibility
 *   fill      how bright the inside is (low for a container around dots)
 *   tone      -1 (far below average) to 1 (far above); see tone.js
 *   toneMix   0 = neutral starlight, 1 = full above/below color
 *   glow      halo strength
 *   ring      the focus state's bright outline (0 for every other state)
 *
 * A dot is one conversation in a block of 100 (or 142). Its state is
 * { x, y, r, alpha, rgb, glow }, or { atLight, alpha: 0 } while it is folded
 * into a light.
 *
 * Layouts that depend on the screen's shape take `stage` ({ frame, isPortrait }).
 */

import { AVERAGE_INDEX, RGB, toneForIndex } from "../tone.js";
import { SKY_POSITIONS, TILE_COLUMNS, TILE_POSITIONS, TILE_ROWS } from "./geometry.js";

const WORLD_CENTER = [460, 320];

const SKY_RADIUS_MIN = 3.4;
const SKY_RADIUS_RANGE = 3.2;
const SKY_ALPHA_MIN = 0.24;
const SKY_GLOW_MIN = 0.25;
const SKY_GLOW_RANGE = 1.9;

const BUBBLE_TOTAL_RADIUS = 100; // radius of the state with the most conversations
const BUBBLE_PER_PERSON_RADIUS = 40; // radius of a state exactly at the US average
const BUBBLE_PADDING = 4;
const BUBBLE_RELAX_STEPS = 420;
const BUBBLE_HOME_PULL = 0.018;

const RANK_SPACING = 20;
const RANK_RADIUS = 7.4;
const RANK_HEIGHT_SHARE = 0.9;
// The camera frames the top of the ranking, where Massachusetts and Texas are;
// the rest of the line runs on past the edge of the frame.
const RANK_FOCUS_COUNT = 30;
const RANK_PORTRAIT_FOCUS_COUNT = 22;

const DOT_CELL = 12;
const DOT_RADIUS = 4.1;
const DOTS_PER_ROW = 10;
const CONTAINER_PADDING = 10;
const CONTAINER_ROUND = 0.24;
const CONTAINER_FILL = 0.05;
const CONTAINER_GLOW = 0.3;

const TILE_PITCH = 80;
const TILE_SIZE = 70;
const TILE_ROUND = 0.18;

const SKYLINE_WIDTH = 1000;
const SKYLINE_HEIGHT_SHARE = 0.82;
const SKYLINE_MIN_HEIGHT = 360;
const SKYLINE_MAX_HEIGHT = 1250;
const COLUMN_GAP = 1.6;
const COLUMN_MIN_FILL = 0.55;
const COLUMN_ROUND = 0.08;
const GHOST_ALPHA = 0.12;
const PAIR_COLUMN_WIDTH = 64;
const PAIR_GAP = 34;
const PAIR_POSITION = 0.64; // how far along the skyline the D.C. and West Virginia pair stands

const BLOCK_GAP = 96;
const BLOCK_BASELINE_OFFSET = 96;

const SPIRAL_SPACING = 23;
const SPIRAL_ANGLE = Math.PI * (3 - Math.sqrt(5)); // the golden angle
const SPIRAL_RADIUS = 5;
const DIM_ALPHA = 0.32;
const DIM_GLOW = 0.45;

export const DOT_RGB = {
  expected: RGB.cool,
  extra: RGB.warm,
  work: [204, 209, 218],
  personal: [112, 119, 132],
  coursework: RGB.warm,
  usCoursework: [222, 164, 98],
};
const DOT_GLOW = { expected: 0.55, extra: 1, work: 0.5, personal: 0.3, coursework: 1, usCoursework: 0.6 };

// Fill order inside a "what for" block, from the bottom row up.
const USE_CASE_ORDER = ["coursework", "personal", "work"];

/**
 * A light state with defaults for every field.
 * @param {object} overrides - Fields to set.
 * @returns {object} The light state.
 */
function lightState(overrides) {
  return {
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    round: 1,
    alpha: 1,
    fill: 1,
    tone: 0,
    toneMix: 1,
    glow: 1,
    ring: 0,
    ...overrides,
  };
}

/**
 * A light that keeps its place and shape but fades out.
 * @param {object} state - The light's state in the layout it fades from.
 * @param {number} [alpha] - How much is left; 0 by default.
 * @returns {object} The faded light state.
 */
export function fadedLight(state, alpha = 0) {
  return { ...state, alpha, glow: state.glow * alpha };
}

/**
 * The rectangle a light covers.
 * @param {object} state - A light state.
 * @returns {{x: number, y: number, width: number, height: number}} Its bounds.
 */
export function lightRect(state) {
  return { x: state.x - state.w / 2, y: state.y - state.h / 2, width: state.w, height: state.h };
}

/**
 * The rectangle that holds every given light.
 * @param {object[]} states - Light states.
 * @returns {{x: number, y: number, width: number, height: number}} Their bounds.
 */
export function boundsOfLights(states) {
  const left = Math.min(...states.map((state) => state.x - state.w / 2));
  const top = Math.min(...states.map((state) => state.y - state.h / 2));
  const right = Math.max(...states.map((state) => state.x + state.w / 2));
  const bottom = Math.max(...states.map((state) => state.y + state.h / 2));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Brightness of a state relative to the others: 0 for the lowest index, 1 for the highest.
 * @param {object} state - One state record.
 * @param {object} lookups - Result of indexDataset.
 * @returns {number} Relative brightness, linear in the index.
 */
function relativeBrightness(state, lookups) {
  const indexes = lookups.states.map((record) => record.per_capita_index);
  const lowest = Math.min(...indexes);
  const highest = Math.max(...indexes);
  return (state.per_capita_index - lowest) / (highest - lowest);
}

/**
 * The night sky: every light at its state's place on the map.
 * @param {object} lookups - Result of indexDataset.
 * @param {{toneMix: number, sizeScale: number}} options - toneMix 0 gives neutral starlight lit
 *   by use per person, 1 gives full color; sizeScale enlarges every light (default 1).
 * @returns {object[]} Light states in lookups.states order.
 */
export function skyLights(lookups, { toneMix, sizeScale = 1 }) {
  return lookups.states.map((state) => {
    const brightness = relativeBrightness(state, lookups);
    const radius = (SKY_RADIUS_MIN + SKY_RADIUS_RANGE * Math.sqrt(brightness)) * sizeScale;
    const [skyX, skyY] = SKY_POSITIONS[state.code];
    return lightState({
      x: skyX,
      y: skyY,
      w: radius * 2,
      h: radius * 2,
      alpha: SKY_ALPHA_MIN + (1 - SKY_ALPHA_MIN) * brightness,
      tone: toneForIndex(state.per_capita_index),
      toneMix,
      glow: SKY_GLOW_MIN + SKY_GLOW_RANGE * brightness,
    });
  });
}

/**
 * Push overlapping circles apart while pulling each gently back toward home.
 * @param {Array<{x: number, y: number, homeX: number, homeY: number, radius: number}>} circles - The
 *   circles to move; changed in place.
 */
function relaxCircles(circles) {
  for (let step = 0; step < BUBBLE_RELAX_STEPS; step += 1) {
    for (let first = 0; first < circles.length; first += 1) {
      for (let second = first + 1; second < circles.length; second += 1) {
        const circleA = circles[first];
        const circleB = circles[second];
        const deltaX = circleB.x - circleA.x || 0.01;
        const deltaY = circleB.y - circleA.y;
        const distance = Math.hypot(deltaX, deltaY);
        const minimum = circleA.radius + circleB.radius + BUBBLE_PADDING;
        if (distance >= minimum) {
          continue;
        }
        // Smaller circles give way more than bigger ones.
        const weightA = circleB.radius ** 2 / (circleA.radius ** 2 + circleB.radius ** 2);
        const push = (minimum - distance) / distance;
        circleA.x -= deltaX * push * weightA;
        circleA.y -= deltaY * push * weightA;
        circleB.x += deltaX * push * (1 - weightA);
        circleB.y += deltaY * push * (1 - weightA);
      }
    }
    for (const circle of circles) {
      circle.x += (circle.homeX - circle.x) * BUBBLE_HOME_PULL;
      circle.y += (circle.homeY - circle.y) * BUBBLE_HOME_PULL;
    }
  }
}

/**
 * Bubbles on the map, sized first by total conversations and then by
 * conversations per person. Both sizes share one set of positions, with room
 * for the larger of the two, so the lights can resize without moving.
 * @param {object} lookups - Result of indexDataset.
 * @returns {{totals: object[], perPerson: object[]}} Light states for each sizing.
 */
export function bubbleLights(lookups) {
  const largestShare = Math.max(...lookups.states.map((state) => state.usage_share_pct));
  const circles = lookups.states.map((state) => {
    const totalRadius = BUBBLE_TOTAL_RADIUS * Math.sqrt(state.usage_share_pct / largestShare);
    const perPersonRadius = BUBBLE_PER_PERSON_RADIUS * Math.sqrt(state.per_capita_index);
    const [skyX, skyY] = SKY_POSITIONS[state.code];
    return {
      x: skyX,
      y: skyY,
      homeX: skyX,
      homeY: skyY,
      radius: Math.max(totalRadius, perPersonRadius),
      totalRadius,
      perPersonRadius,
      tone: toneForIndex(state.per_capita_index),
    };
  });
  relaxCircles(circles);
  const bubbleAt = (circle, radius, toneMix) =>
    lightState({ x: circle.x, y: circle.y, w: radius * 2, h: radius * 2, tone: circle.tone, toneMix });
  return {
    totals: circles.map((circle) => bubbleAt(circle, circle.totalRadius, 0)),
    perPerson: circles.map((circle) => bubbleAt(circle, circle.perPersonRadius, 1)),
  };
}

/**
 * Every light lined up by conversations per person: rank across, use per person up.
 * @param {object} lookups - Result of indexDataset.
 * @param {{frame: object, isPortrait: boolean}} stage - The screen's shape.
 * @returns {{lights: object[], averageLine: object, focusRect: object}} Lights, the
 *   US average line and the part of the chart the camera frames.
 */
export function rankedLights(lookups, stage) {
  const frameAspect = stage.frame.width / stage.frame.height;
  const plotWidth = (lookups.states.length - 1) * RANK_SPACING;
  const maxIndex = lookups.states[0].per_capita_index;
  const focusCount = stage.isPortrait ? RANK_PORTRAIT_FOCUS_COUNT : RANK_FOCUS_COUNT;
  const plotHeight = ((focusCount * RANK_SPACING) / frameAspect) * RANK_HEIGHT_SHARE;
  const unit = plotHeight / maxIndex;
  const left = WORLD_CENTER[0] - plotWidth / 2;
  const baseline = WORLD_CENTER[1] + plotHeight / 2;

  const lights = lookups.states.map((state, position) => {
    const radius = RANK_RADIUS * Math.sqrt(state.per_capita_index);
    return lightState({
      x: left + position * RANK_SPACING,
      y: baseline - state.per_capita_index * unit,
      w: radius * 2,
      h: radius * 2,
      tone: toneForIndex(state.per_capita_index),
    });
  });
  const focusLights = lights.slice(0, focusCount);
  const focusRight = Math.max(...focusLights.map((light) => light.x)) + RANK_SPACING;
  const focusRect = {
    x: left - RANK_SPACING,
    y: baseline - maxIndex * unit - RANK_SPACING,
    width: focusRight - left + RANK_SPACING,
    height: maxIndex * unit + 2 * RANK_SPACING,
  };
  return {
    lights,
    averageLine: {
      x0: left - RANK_SPACING / 2,
      x1: left + plotWidth + RANK_SPACING / 2,
      y: baseline - unit,
      alpha: 1,
    },
    focusRect,
  };
}

/**
 * Where a dot sits in a grid that fills from the bottom row up, left to right.
 * @param {{left: number, bottom: number}} origin - Bottom-left corner of the grid.
 * @param {number} slot - Cell number, 0 at the bottom left.
 * @returns {number[]} The cell's center.
 */
function gridCell(origin, slot) {
  const column = slot % DOTS_PER_ROW;
  const row = Math.floor(slot / DOTS_PER_ROW);
  return [origin.left + (column + 0.5) * DOT_CELL, origin.bottom - (row + 0.5) * DOT_CELL];
}

/**
 * A visible dot.
 * @param {number[]} position - Center in world units.
 * @param {string} role - Key of DOT_RGB.
 * @returns {object} The dot state.
 */
function dotAt(position, role) {
  const [dotX, dotY] = position;
  return { x: dotX, y: dotY, r: DOT_RADIUS, alpha: 1, rgb: DOT_RGB[role], glow: DOT_GLOW[role] };
}

/**
 * The container light that wraps a set of dots.
 * @param {object[]} dots - Visible dot states.
 * @param {object} focusState - The focus state's record.
 * @returns {object} A light state around the dots.
 */
function containerAround(dots, focusState) {
  const xs = dots.map((dot) => dot.x);
  const ys = dots.map((dot) => dot.y);
  const reach = DOT_CELL / 2 + CONTAINER_PADDING;
  const left = Math.min(...xs) - reach;
  const right = Math.max(...xs) + reach;
  const top = Math.min(...ys) - reach;
  const bottom = Math.max(...ys) + reach;
  return lightState({
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    w: right - left,
    h: bottom - top,
    round: CONTAINER_ROUND,
    fill: CONTAINER_FILL,
    glow: CONTAINER_GLOW,
    tone: toneForIndex(focusState.per_capita_index),
  });
}

/**
 * Massachusetts as dots: 100 cool dots for what a state its size would send at
 * the US average rate, then the warm extra dots it actually sends.
 * @param {object} lookups - Result of indexDataset.
 * @param {{isPortrait: boolean}} stage - The screen's shape.
 * @param {{showExtra: boolean}} options - Whether the extra dots are out yet.
 * @returns {{dots: object[], container: object, expectedRect: object, extraRect: object, fullRect: object}}
 *   The focus state's dots (hidden ones fold into its light), its container and key areas.
 */
export function expectedBlock(lookups, stage, { showExtra }) {
  const expectedCount = lookups.facts.average_per_100;
  const totalCount = lookups.facts.focus_per_100_expected;
  const extraRows = Math.ceil((totalCount - expectedCount) / DOTS_PER_ROW);
  const columns = stage.isPortrait ? DOTS_PER_ROW : DOTS_PER_ROW + extraRows;
  const rows = stage.isPortrait ? DOTS_PER_ROW + extraRows : DOTS_PER_ROW;
  const origin = {
    left: WORLD_CENTER[0] - (columns * DOT_CELL) / 2,
    bottom: WORLD_CENTER[1] + (rows * DOT_CELL) / 2,
  };
  const focusIndex = lookups.states.indexOf(lookups.focus);

  const dots = [];
  for (let slot = 0; slot < totalCount; slot += 1) {
    const isExtra = slot >= expectedCount;
    if (isExtra && !showExtra) {
      dots.push({ atLight: focusIndex, alpha: 0 });
      continue;
    }
    if (!isExtra) {
      dots.push(dotAt(gridCell(origin, slot), "expected"));
      continue;
    }
    // Extra dots stack beside the square (landscape) or on top of it (portrait).
    const extraSlot = slot - expectedCount;
    const stackIndex = Math.floor(extraSlot / DOTS_PER_ROW);
    const withinStack = extraSlot % DOTS_PER_ROW;
    const position = stage.isPortrait
      ? gridCell(origin, (DOTS_PER_ROW + stackIndex) * DOTS_PER_ROW + withinStack)
      : [
          origin.left + (DOTS_PER_ROW + stackIndex + 0.5) * DOT_CELL,
          origin.bottom - (withinStack + 0.5) * DOT_CELL,
        ];
    dots.push(dotAt(position, "extra"));
  }
  const visibleDots = dots.filter((dot) => dot.atLight === undefined);
  const expectedDots = dots.slice(0, expectedCount);
  const fullRect = {
    x: origin.left,
    y: origin.bottom - rows * DOT_CELL,
    width: columns * DOT_CELL,
    height: rows * DOT_CELL,
  };
  return {
    dots,
    container: containerAround(visibleDots, lookups.focus),
    expectedRect: boundsOfDotStates(expectedDots),
    extraRect: showExtra ? boundsOfDotStates(dots.slice(expectedCount)) : null,
    fullRect,
  };
}

/**
 * The rectangle around a set of visible dots, including their cells.
 * @param {object[]} dots - Visible dot states.
 * @returns {{x: number, y: number, width: number, height: number}} Their bounds.
 */
function boundsOfDotStates(dots) {
  const xs = dots.map((dot) => dot.x);
  const ys = dots.map((dot) => dot.y);
  const half = DOT_CELL / 2;
  return {
    x: Math.min(...xs) - half,
    y: Math.min(...ys) - half,
    width: Math.max(...xs) - Math.min(...xs) + DOT_CELL,
    height: Math.max(...ys) - Math.min(...ys) + DOT_CELL,
  };
}

/**
 * Give every dot a use case, keeping each dot's use case fixed across scenes.
 * The first 100 focus dots split like the 100-dot block; the extra dots add
 * whatever the per person block needs on top.
 * @param {object} facts - The film facts from the data file.
 * @returns {{focus: string[], us: string[]}} Use case per dot.
 */
function assignUseCases(facts) {
  const { focus_100: focusBlock, focus_per_person: perPersonBlock, us_100: usBlock } = facts.dots;
  const expand = (countsByUseCase) =>
    USE_CASE_ORDER.flatMap((useCase) => Array(countsByUseCase[useCase]).fill(useCase));
  const extraCounts = Object.fromEntries(
    USE_CASE_ORDER.map((useCase) => [useCase, perPersonBlock[useCase] - focusBlock[useCase]]),
  );
  return { focus: [...expand(focusBlock), ...expand(extraCounts)], us: expand(usBlock) };
}

/**
 * Lay out one "what for" block: dots sorted by use case, schoolwork at the bottom.
 * @param {string[]} useCases - Use case of each dot in the pool.
 * @param {number} visibleCount - How many of the pool's dots are in the block.
 * @param {{left: number, bottom: number, isUs: boolean}} placement - Grid corner and which block.
 * @returns {{positions: Array<number[]|null>, groupRows: object}} Per-dot position (null if
 *   hidden) and the vertical middle of each use case's rows.
 */
function sortedBlock(useCases, visibleCount, placement) {
  const positions = Array(useCases.length).fill(null);
  const groupRows = {};
  let slot = 0;
  for (const useCase of USE_CASE_ORDER) {
    const firstSlot = slot;
    useCases.forEach((dotUseCase, dotIndex) => {
      if (dotIndex >= visibleCount || dotUseCase !== useCase) {
        return;
      }
      positions[dotIndex] = gridCell(placement, slot);
      slot += 1;
    });
    const firstRow = Math.floor(firstSlot / DOTS_PER_ROW);
    const lastRow = Math.floor((slot - 1) / DOTS_PER_ROW);
    groupRows[useCase] = placement.bottom - ((firstRow + lastRow + 1) / 2) * DOT_CELL;
  }
  return { positions, groupRows };
}

/**
 * Massachusetts and the whole US side by side, each as dots sorted into work,
 * personal life and schoolwork.
 * @param {object} lookups - Result of indexDataset.
 * @param {{perPerson: boolean}} options - false: 100 dots each; true: Massachusetts grows
 *   to its conversations per 100 expected.
 * @returns {object} Dot states for both pools, the focus container, and anchor points.
 */
export function whatForBlocks(lookups, { perPerson }) {
  const useCases = assignUseCases(lookups.facts);
  const blockWidth = DOTS_PER_ROW * DOT_CELL;
  const bottom = WORLD_CENTER[1] + BLOCK_BASELINE_OFFSET;
  const focusLeft = WORLD_CENTER[0] - BLOCK_GAP / 2 - blockWidth;
  const usLeft = WORLD_CENTER[0] + BLOCK_GAP / 2;
  const focusVisible = perPerson ? useCases.focus.length : lookups.facts.average_per_100;
  const focusIndex = lookups.states.indexOf(lookups.focus);

  const focusBlock = sortedBlock(useCases.focus, focusVisible, { left: focusLeft, bottom });
  const usBlock = sortedBlock(useCases.us, useCases.us.length, { left: usLeft, bottom });
  const focusDots = focusBlock.positions.map((position, dotIndex) =>
    position ? dotAt(position, useCases.focus[dotIndex]) : { atLight: focusIndex, alpha: 0 },
  );
  const usDots = usBlock.positions.map((position, dotIndex) =>
    dotAt(position, useCases.us[dotIndex] === "coursework" ? "usCoursework" : useCases.us[dotIndex]),
  );
  const focusRows = Math.ceil(focusVisible / DOTS_PER_ROW);
  const usRows = Math.ceil(useCases.us.length / DOTS_PER_ROW);
  return {
    focusDots,
    usDots,
    container: containerAround(
      focusDots.filter((dot) => dot.atLight === undefined),
      lookups.focus,
    ),
    focusBlock: {
      left: focusLeft,
      right: focusLeft + blockWidth,
      top: bottom - focusRows * DOT_CELL,
      bottom,
    },
    usBlock: { left: usLeft, right: usLeft + blockWidth, top: bottom - usRows * DOT_CELL, bottom },
    focusGroupY: focusBlock.groupRows,
    usGroupY: usBlock.groupRows,
    usCenter: [usLeft + blockWidth / 2, bottom - (usRows * DOT_CELL) / 2],
  };
}

/**
 * The tile grid map: one square per state.
 * @param {object} lookups - Result of indexDataset.
 * @returns {{lights: object[], tileRect: function(string[]): object}} Light states and a
 *   helper that returns the bounds of a set of tiles.
 */
export function tileLights(lookups) {
  const left = WORLD_CENTER[0] - (TILE_COLUMNS * TILE_PITCH) / 2;
  const top = WORLD_CENTER[1] - (TILE_ROWS * TILE_PITCH) / 2;
  const tileCenter = (code) => {
    const [column, row] = TILE_POSITIONS[code];
    return [left + (column + 0.5) * TILE_PITCH, top + (row + 0.5) * TILE_PITCH];
  };
  const lights = lookups.states.map((state) => {
    const [centerX, centerY] = tileCenter(state.code);
    return lightState({
      x: centerX,
      y: centerY,
      w: TILE_SIZE,
      h: TILE_SIZE,
      round: TILE_ROUND,
      tone: toneForIndex(state.per_capita_index),
    });
  });
  const tileRect = (codes) =>
    boundsOfLights(codes.map((code) => lights[lookups.states.findIndex((state) => state.code === code)]));
  return { lights, tileRect };
}

/**
 * The skyline: one column per state, sorted by height, as wide as its share of
 * residents aged 15 to 64 and as tall as its use per person.
 * @param {object} lookups - Result of indexDataset.
 * @param {{frame: object}} stage - The screen's shape.
 * @returns {object} Light states, the average line, the baseline and a top-edge profile.
 */
export function skylineLights(lookups, stage) {
  const frameAspect = stage.frame.width / stage.frame.height;
  const maxIndex = lookups.states[0].per_capita_index;
  const height = Math.min(
    SKYLINE_MAX_HEIGHT,
    Math.max(SKYLINE_MIN_HEIGHT, (SKYLINE_WIDTH / frameAspect) * SKYLINE_HEIGHT_SHARE),
  );
  const unit = height / maxIndex;
  const left = WORLD_CENTER[0] - SKYLINE_WIDTH / 2;
  const baseline = WORLD_CENTER[1] + height / 2;
  const totalShare = lookups.states.reduce((sum, state) => sum + state.working_age_share_pct, 0);

  let cursor = left;
  const lights = lookups.states.map((state) => {
    const slotWidth = (state.working_age_share_pct / totalShare) * SKYLINE_WIDTH;
    const columnHeight = state.per_capita_index * unit;
    const light = lightState({
      x: cursor + slotWidth / 2,
      y: baseline - columnHeight / 2,
      w: Math.max(slotWidth - COLUMN_GAP, slotWidth * COLUMN_MIN_FILL),
      h: columnHeight,
      round: COLUMN_ROUND,
      tone: toneForIndex(state.per_capita_index),
    });
    cursor += slotWidth;
    return light;
  });
  return {
    lights,
    unit,
    baseline,
    left,
    right: left + SKYLINE_WIDTH,
    averageLine: { x0: left, x1: left + SKYLINE_WIDTH, y: baseline - AVERAGE_INDEX * unit, alpha: 1 },
  };
}

/**
 * The two extremes pulled out of the skyline to stand side by side, equal in
 * width, while the rest of the skyline stays behind as a faint ghost.
 * @param {object} lookups - Result of indexDataset.
 * @param {object} skyline - Result of skylineLights.
 * @returns {{lights: object[], pairRect: object}} Light states and the pair's bounds.
 */
export function extremesPair(lookups, skyline) {
  const { highest_code: highestCode, lowest_code: lowestCode } = lookups.facts;
  const pairCenter = skyline.left + (skyline.right - skyline.left) * PAIR_POSITION;
  const offset = (PAIR_COLUMN_WIDTH + PAIR_GAP) / 2;
  const centerByCode = { [highestCode]: pairCenter - offset, [lowestCode]: pairCenter + offset };
  const lights = lookups.states.map((state, position) => {
    const column = skyline.lights[position];
    if (!(state.code in centerByCode)) {
      return fadedLight(column, GHOST_ALPHA);
    }
    return { ...column, x: centerByCode[state.code], w: PAIR_COLUMN_WIDTH };
  });
  const pairLights = lookups.states
    .map((state, position) => (state.code in centerByCode ? lights[position] : null))
    .filter(Boolean);
  return { lights, pairRect: boundsOfLights(pairLights) };
}

/**
 * Dim lights resting in a sunflower spiral, the focus state at its heart.
 * @param {object} lookups - Result of indexDataset.
 * @returns {object[]} Light states in lookups.states order.
 */
export function spiralLights(lookups) {
  const order = [lookups.focus, ...lookups.states.filter((state) => state !== lookups.focus)];
  const lightsByCode = new Map(
    order.map((state, step) => {
      const distance = SPIRAL_SPACING * Math.sqrt(step + 0.5);
      const angle = step * SPIRAL_ANGLE;
      return [
        state.code,
        lightState({
          x: WORLD_CENTER[0] + distance * Math.cos(angle),
          y: WORLD_CENTER[1] + distance * Math.sin(angle),
          w: SPIRAL_RADIUS * 2,
          h: SPIRAL_RADIUS * 2,
          alpha: DIM_ALPHA,
          glow: DIM_GLOW,
          tone: toneForIndex(state.per_capita_index),
        }),
      ];
    }),
  );
  return lookups.states.map((state) => lightsByCode.get(state.code));
}
