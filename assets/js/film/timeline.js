/*
 * Turns the film's beats into a frame for any film time.
 *
 * A beat is one move plus a short hold: during `motion` seconds every light,
 * dot, line and the camera travel from the previous beat's targets to this
 * beat's, then they rest for `hold` seconds while the camera pushes in a
 * little. Everything here is a pure function of film time, so scrolling up
 * plays the film backward exactly.
 */

import { interpolateCamera, trackCamera } from "./camera.js";

const CAMERA_RHO = 1.1;
const HOLD_PUSH_IN = 0.035; // how much closer the camera drifts during a hold
const CAPTION_SWITCH_SHARE = 0.3; // captions change this far into a move
const LABEL_IN_START_SHARE = 0.55;
const LABEL_OUT_SHARE = 0.35;
const SPARK_LEAD_SHARE = 0.62; // the spark arrives before the lights do
const SPARK_CURVE = 0.22;
const SPARK_TRAIL_SAMPLES = 14;
const SPARK_TRAIL_STEP_SECONDS = 0.035;
const SPARK_REST_INTENSITY = 0.45;
const DOT_START_RADIUS = 0.6;
const NUMERIC_LIGHT_FIELDS = [
  "x",
  "y",
  "w",
  "h",
  "round",
  "alpha",
  "fill",
  "tone",
  "toneMix",
  "glow",
  "ring",
];

/**
 * Clamp a number to the 0 to 1 range.
 * @param {number} value - Any number.
 * @returns {number} The clamped value.
 */
export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Ease in and out (cubic).
 * @param {number} progress - 0 to 1.
 * @returns {number} Eased progress.
 */
export function easeInOut(progress) {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

/**
 * Ease out (cubic).
 * @param {number} progress - 0 to 1.
 * @returns {number} Eased progress.
 */
export function easeOut(progress) {
  return 1 - (1 - progress) ** 3;
}

/**
 * Linear interpolation.
 * @param {number} from - Start value.
 * @param {number} to - End value.
 * @param {number} progress - 0 to 1.
 * @returns {number} The value in between.
 */
function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

/**
 * Give each beat its start and end time and its camera moves.
 * @param {object[]} beats - Beats in order, each with motion and hold in seconds.
 * @returns {{beats: object[], duration: number}} The compiled film.
 */
export function compileBeats(beats) {
  let start = 0;
  beats.forEach((beat, position) => {
    beat.index = position;
    beat.start = start;
    beat.end = start + beat.motion + beat.hold;
    beat.cameraEnd = beat.hold > 0 ? { ...beat.camera, w: beat.camera.w * (1 - HOLD_PUSH_IN) } : beat.camera;
    const previous = beats[Math.max(0, position - 1)];
    beat.cameraMove = beat.cameraTrack
      ? trackCamera(previous.cameraEnd, beat.camera, beat.cameraTrack)
      : interpolateCamera(previous.cameraEnd, beat.camera, CAMERA_RHO);
    start = beat.end;
  });
  return { beats, duration: start };
}

/**
 * Find the beat playing at a film time.
 * @param {object[]} beats - Compiled beats.
 * @param {number} time - Film time in seconds.
 * @returns {number} Index of the beat.
 */
export function beatIndexAt(beats, time) {
  let found = 0;
  for (let position = 0; position < beats.length; position += 1) {
    if (beats[position].start <= time) {
      found = position;
    }
  }
  return found;
}

/**
 * How far one element is through a staggered move.
 * @param {number} local - Seconds since the beat started.
 * @param {object} beat - The beat.
 * @param {number} order - The element's place in the stagger, 0 to 1.
 * @param {number} staggerShare - Share of the move spent staggering starts.
 * @returns {number} Progress from 0 to 1, not yet eased.
 */
function staggeredProgress(local, beat, order, staggerShare) {
  if (beat.motion <= 0) {
    return 1;
  }
  const delay = order * staggerShare * beat.motion;
  const span = beat.motion * (1 - staggerShare);
  return clamp01((local - delay) / span);
}

/**
 * Interpolate every numeric field of a light, bending its path into a gentle arc.
 * @param {object} from - Start state.
 * @param {object} to - End state.
 * @param {{progress: number, arc: number, arcSign: number}} motion - Eased progress and arc settings.
 * @returns {object} The light state in between.
 */
function interpolateLight(from, to, { progress, arc, arcSign }) {
  const state = {};
  for (const field of NUMERIC_LIGHT_FIELDS) {
    state[field] = lerp(from[field], to[field], progress);
  }
  if (arc && progress > 0 && progress < 1) {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const bend = Math.sin(Math.PI * progress) * arc * arcSign;
    state.x += -deltaY * bend;
    state.y += deltaX * bend;
  }
  return state;
}

/**
 * Turn a dot folded into a light into a concrete position.
 * @param {object} dot - A dot state, possibly { atLight, alpha: 0 }.
 * @param {object[]} lights - Current light states.
 * @param {object} counterpart - The dot's state at the other end of the move.
 * @returns {object} A dot state with a position.
 */
function resolveDot(dot, lights, counterpart) {
  if (dot.atLight === undefined) {
    return dot;
  }
  const light = lights[dot.atLight];
  const rgb = counterpart.rgb ?? [255, 255, 255];
  return { x: light.x, y: light.y, r: DOT_START_RADIUS, alpha: 0, rgb, glow: counterpart.glow ?? 0 };
}

/**
 * Interpolate a dot.
 * @param {object} from - Start state (resolved).
 * @param {object} to - End state (resolved).
 * @param {number} progress - Eased progress.
 * @returns {object} The dot state in between.
 */
function interpolateDot(from, to, progress) {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    r: lerp(from.r, to.r, progress),
    alpha: lerp(from.alpha, to.alpha, progress),
    glow: lerp(from.glow, to.glow, progress),
    rgb: from.rgb.map((channel, position) => lerp(channel, to.rgb[position], progress)),
  };
}

/**
 * The point on a quadratic curve.
 * @param {number[]} start - Start point.
 * @param {number[]} control - Control point.
 * @param {number[]} end - End point.
 * @param {number} progress - 0 to 1.
 * @returns {number[]} The point.
 */
function quadraticPoint(start, control, end, progress) {
  const inverse = 1 - progress;
  return [0, 1].map(
    (axis) =>
      inverse * inverse * start[axis] +
      2 * inverse * progress * control[axis] +
      progress * progress * end[axis],
  );
}

/**
 * Where the spark is at a film time, and how bright.
 * @param {object[]} beats - Compiled beats.
 * @param {number} time - Film time in seconds.
 * @returns {{x: number, y: number, intensity: number}} The spark.
 */
function sparkAt(beats, time) {
  const index = beatIndexAt(beats, time);
  const beat = beats[index];
  const previous = beats[Math.max(0, index - 1)];
  const local = time - beat.start;
  const travel = beat.motion > 0 ? easeInOut(clamp01(local / (beat.motion * SPARK_LEAD_SHARE))) : 1;
  const [startX, startY] = previous.spark;
  const [endX, endY] = beat.spark;
  const side = index % 2 === 0 ? 1 : -1;
  const control = [
    (startX + endX) / 2 - (endY - startY) * SPARK_CURVE * side,
    (startY + endY) / 2 + (endX - startX) * SPARK_CURVE * side,
  ];
  const [sparkX, sparkY] = quadraticPoint(previous.spark, control, beat.spark, travel);
  const flight = Math.sin(Math.PI * travel);
  return { x: sparkX, y: sparkY, intensity: SPARK_REST_INTENSITY + (1 - SPARK_REST_INTENSITY) * flight };
}

/**
 * The labels on stage, fading in as a move settles and out as the next one starts.
 * @param {object[]} beats - Compiled beats.
 * @param {number} index - Index of the current beat.
 * @param {number} local - Seconds since the beat started.
 * @returns {object[]} Label specs, each with an alpha.
 */
function labelsAt(beats, index, local) {
  const beat = beats[index];
  const previous = index > 0 ? beats[index - 1] : null;
  const currentIds = new Set(beat.labels.map((label) => label.id));
  const previousIds = new Set(previous ? previous.labels.map((label) => label.id) : []);
  const fadeInStart = beat.motion * LABEL_IN_START_SHARE;
  const fadeInSpan = beat.motion * (1 - LABEL_IN_START_SHARE);
  const fadeIn = beat.motion > 0 ? easeInOut(clamp01((local - fadeInStart) / fadeInSpan)) : 1;
  const fadeOut = beat.motion > 0 ? 1 - easeInOut(clamp01(local / (beat.motion * LABEL_OUT_SHARE))) : 0;
  const labels = beat.labels.map((label) => ({ ...label, alpha: previousIds.has(label.id) ? 1 : fadeIn }));
  if (previous && fadeOut > 0) {
    for (const label of previous.labels) {
      if (!currentIds.has(label.id)) {
        labels.push({ ...label, alpha: fadeOut });
      }
    }
  }
  return labels;
}

/**
 * Everything on stage at one film time.
 * @param {{beats: object[]}} film - The compiled film.
 * @param {number} time - Film time in seconds.
 * @returns {object} The frame: lights, dots, line, camera, spark, labels, caption and ambience.
 */
export function evaluateFrame(film, time) {
  const { beats } = film;
  const index = beatIndexAt(beats, time);
  const beat = beats[index];
  const previous = beats[Math.max(0, index - 1)];
  const local = time - beat.start;
  const isMoving = local < beat.motion;
  const moveProgress = beat.motion > 0 ? easeInOut(clamp01(local / beat.motion)) : 1;

  const lights = beat.lights.map((target, position) =>
    interpolateLight(previous.lights[position], target, {
      progress: easeInOut(staggeredProgress(local, beat, beat.lightOrder[position], beat.lightStagger)),
      arc: beat.arc,
      arcSign: position % 2 === 0 ? 1 : -1,
    }),
  );
  const dots = beat.dots.map((target, position) => {
    const from = resolveDot(previous.dots[position], lights, target);
    const to = resolveDot(target, lights, from);
    const progress = staggeredProgress(local, beat, beat.dotOrder[position], beat.dotStagger);
    return interpolateDot(from, to, easeInOut(progress));
  });

  const holdProgress = beat.hold > 0 ? clamp01((local - beat.motion) / beat.hold) : 0;
  const camera = isMoving
    ? beat.cameraMove(moveProgress)
    : { ...beat.camera, w: lerp(beat.camera.w, beat.cameraEnd.w, easeInOut(holdProgress)) };

  const trail = [];
  for (let sample = 0; sample <= SPARK_TRAIL_SAMPLES; sample += 1) {
    trail.push(sparkAt(beats, Math.max(0, time - sample * SPARK_TRAIL_STEP_SECONDS)));
  }

  const showsCurrentCaption = !isMoving || local >= beat.motion * CAPTION_SWITCH_SHARE;
  return {
    beatIndex: index,
    scene: beat.scene,
    lights,
    dots,
    line: {
      x0: lerp(previous.line.x0, beat.line.x0, moveProgress),
      x1: lerp(previous.line.x1, beat.line.x1, moveProgress),
      y: lerp(previous.line.y, beat.line.y, moveProgress),
      alpha: lerp(previous.line.alpha, beat.line.alpha, moveProgress),
    },
    camera,
    spark: { head: trail[0], trail },
    labels: labelsAt(beats, index, local),
    caption: showsCurrentCaption ? beat.caption : previous.caption,
    drift: lerp(previous.drift, beat.drift, moveProgress),
    pulse: lerp(previous.pulse, beat.pulse, moveProgress),
  };
}
