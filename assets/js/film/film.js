/*
 * Runs the scroll-driven film: scrolling sets the film time, and a render
 * loop eases toward it so every move plays smoothly forward or backward.
 *
 * The page structure (index.html): a .film section holds a sticky full-screen
 * stage, an empty track whose height is the film's scroll length, and the
 * credits, which roll up over the stage at the end.
 *
 * With reduced motion turned on, each beat is shown as a still that
 * cross-fades to the next, with no camera moves, spark or counting.
 */

import { cameraForRect, interpolateCamera } from "./camera.js";
import { createCaptions, createProgress } from "./captions.js";
import { createRenderer } from "./renderer.js";
import { SCENES, writeScript } from "./script.js";
import { beatIndexAt, clamp01, compileBeats, easeInOut, easeOut, evaluateFrame } from "./timeline.js";

const VIEWPORTS_PER_FILM_SECOND = 0.5;
const SMOOTHING_SECONDS = 0.11;
const SETTLE_EPSILON = 0.0005;
const MAX_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.1;

const INTRO_SECONDS = 4.6;
const INTRO_FAST_FORWARD = 7;
const INTRO_CAPTION_AT = 0.62;
const INTRO_FADE_SHARE = 0.3;
const INTRO_RECT = { x: -90, y: 120, width: 420, height: 320 };
const INTRO_CAMERA_RHO = 0.9;

const LABEL_COUNT_SECONDS = 1.0;
const CREDITS_FADE_SHARE = 0.16; // credit lines fade over this share of the screen at its top and bottom
const CREDIT_LINE_SELECTOR = ".credits-label, .credits-item, .credits-next";
const CREDITS_TIME_SHARE = 0.35; // share of the credits segment filled by the lights' return
const STILL_FADE_CLASS = "is-fading";
const STAGE_LAYOUT_PROPERTY = "--stage-layout";
const SIDE_LAYOUT = "side";
const FRAME_GAP = {
  side: 40,
  top: 56,
  right: 48,
  bottom: 36,
  portraitTop: 20,
  portraitGap: 18,
  portraitSide: 18,
};
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Find the film's elements in the page.
 * @returns {object} The elements, keyed by role.
 */
function findElements() {
  const ids = {
    film: "film",
    stage: "stage",
    canvas: "stage-canvas",
    still: "stage-still",
    captions: "captions",
    progress: "progress",
    track: "film-track",
    credits: "credits",
  };
  const elements = {};
  for (const [role, id] of Object.entries(ids)) {
    elements[role] = document.getElementById(id);
    if (!elements[role]) {
      throw new Error(`index.html is missing #${id}, which the film needs.`);
    }
  }
  return elements;
}

/**
 * Measure the stage and work out where the graphics go (beside or above the captions).
 * @param {object} elements - Result of findElements.
 * @returns {{width: number, height: number, frame: object, isPortrait: boolean}} The stage.
 */
function measureStage(elements) {
  const stageBox = elements.stage.getBoundingClientRect();
  const captionsBox = elements.captions.getBoundingClientRect();
  const progressBox = elements.progress.getBoundingClientRect();
  const layout = getComputedStyle(elements.stage).getPropertyValue(STAGE_LAYOUT_PROPERTY).trim();
  const isPortrait = layout !== SIDE_LAYOUT;
  const width = stageBox.width;
  const height = stageBox.height;
  if (!isPortrait) {
    const left = captionsBox.right - stageBox.left + FRAME_GAP.side;
    const bottom = progressBox.top - stageBox.top - FRAME_GAP.bottom;
    return {
      width,
      height,
      isPortrait,
      frame: {
        x: left,
        y: FRAME_GAP.top,
        width: width - left - FRAME_GAP.right,
        height: bottom - FRAME_GAP.top,
      },
    };
  }
  const bottom = captionsBox.top - stageBox.top - FRAME_GAP.portraitGap;
  return {
    width,
    height,
    isPortrait,
    frame: {
      x: FRAME_GAP.portraitSide,
      y: FRAME_GAP.portraitTop,
      width: width - FRAME_GAP.portraitSide * 2,
      height: bottom - FRAME_GAP.portraitTop,
    },
  };
}

/**
 * The film time span of each scene.
 * @param {object[]} beats - Compiled beats.
 * @returns {Map<string, {start: number, end: number, settled: number}>} Span per scene id.
 */
function sceneSpans(beats) {
  const spans = new Map();
  for (const beat of beats) {
    const span = spans.get(beat.scene);
    if (span) {
      span.end = beat.end;
    } else {
      spans.set(beat.scene, { start: beat.start, end: beat.end, settled: beat.start + beat.motion });
    }
  }
  return spans;
}

/**
 * Dim every light, dot and the spark for the opening fade from black.
 * @param {object} frame - Result of evaluateFrame (mutated).
 * @param {number} exposure - 0 (black) to 1 (full).
 */
function exposeFrame(frame, exposure) {
  if (exposure >= 1) {
    return;
  }
  frame.lights = frame.lights.map((light) => ({
    ...light,
    alpha: light.alpha * exposure,
    glow: light.glow * exposure,
    ring: light.ring * exposure,
  }));
  frame.labels = frame.labels.map((label) => ({ ...label, alpha: label.alpha * exposure }));
  frame.spark.head = { ...frame.spark.head, intensity: frame.spark.head.intensity * exposure };
}

/**
 * Fade each credit line in as it rises from the bottom of the screen and out as it leaves the top.
 * @param {HTMLElement[]} creditLines - The rolling credit lines.
 * @param {HTMLElement} progressElement - The progress line; lines are gone before they reach it.
 */
function fadeCredits(creditLines, progressElement) {
  const fadeHeight = innerHeight * CREDITS_FADE_SHARE;
  const bottomEdge = progressElement.getBoundingClientRect().top;
  for (const line of creditLines) {
    const box = line.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    line.style.opacity = String(clamp01(Math.min(middle, bottomEdge - middle) / fadeHeight));
  }
}

/**
 * Start the film.
 * @param {object} lookups - Result of indexDataset.
 */
export function startFilm(lookups) {
  const elements = findElements();
  const renderer = createRenderer(elements.canvas);
  const captions = createCaptions(elements.captions, SCENES);
  const reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
  const creditLines = [...elements.credits.querySelectorAll(CREDIT_LINE_SELECTOR)];

  let stage = null;
  let film = null;
  let spans = null;
  let introCamera = null;
  let pixelsPerSecond = 1;
  let filmTop = 0;
  let renderTime = 0;
  let lastFrameAt = 0;
  let loopRequest = 0;
  let isFilmVisible = true;
  let introProgress = 1;
  let introSpeed = 1;
  let stillIndex = -1;
  const labelCountStarts = new Map();

  const progress = createProgress(elements.progress, SCENES, (sceneId) => {
    const span = spans.get(sceneId);
    const isCredits = sceneId === "credits";
    const top = isCredits ? elements.credits.offsetTop + filmTop : filmTop + span.settled * pixelsPerSecond;
    scrollTo({ top, behavior: reducedMotion.matches ? "auto" : "smooth" });
  });

  function targetTime() {
    return Math.min(film.duration, Math.max(0, (scrollY - filmTop) / pixelsPerSecond));
  }

  function creditsRollProgress() {
    const rollStart = filmTop + film.duration * pixelsPerSecond;
    return clamp01((scrollY - rollStart) / Math.max(1, elements.credits.offsetHeight));
  }

  function build() {
    stage = measureStage(elements);
    film = compileBeats(writeScript(lookups, stage));
    spans = sceneSpans(film.beats);
    introCamera = cameraForRect(INTRO_RECT, stage.frame);
    pixelsPerSecond = stage.height * VIEWPORTS_PER_FILM_SECOND;
    elements.track.style.height = `${Math.round(film.duration * pixelsPerSecond)}px`;
    filmTop = elements.film.getBoundingClientRect().top + scrollY;
    const pixelRatio = Math.min(MAX_PIXEL_RATIO, devicePixelRatio || 1);
    renderer.resize({ width: stage.width, height: stage.height, pixelRatio });
    stillIndex = -1;
  }

  function textForLabel(label, seconds) {
    if (!label.count || reducedMotion.matches) {
      return label.text;
    }
    if (!labelCountStarts.has(label.id)) {
      labelCountStarts.set(label.id, seconds);
    }
    const countProgress = easeOut(clamp01((seconds - labelCountStarts.get(label.id)) / LABEL_COUNT_SECONDS));
    return String(Math.round(label.count.from + (label.count.to - label.count.from) * countProgress));
  }

  function forgetHiddenCounts(frame) {
    const visibleIds = new Set(frame.labels.filter((label) => label.alpha > 0.01).map((label) => label.id));
    for (const id of labelCountStarts.keys()) {
      if (!visibleIds.has(id)) {
        labelCountStarts.delete(id);
      }
    }
  }

  function updateProgress(frame, time) {
    const fills = new Map();
    for (const [sceneId, span] of spans) {
      fills.set(sceneId, clamp01((time - span.start) / (span.end - span.start)));
    }
    const creditsSpan = spans.get("credits");
    const creditsTime = clamp01((time - creditsSpan.start) / (creditsSpan.end - creditsSpan.start));
    fills.set("credits", creditsTime * CREDITS_TIME_SHARE + creditsRollProgress() * (1 - CREDITS_TIME_SHARE));
    progress.update(fills, frame.scene);
  }

  function drawFrame(time, seconds, isStill) {
    const frame = evaluateFrame(film, time);
    if (introProgress < 1 && frame.beatIndex === 0) {
      const introMove = interpolateCamera(introCamera, film.beats[0].camera, INTRO_CAMERA_RHO);
      frame.camera = introMove(easeInOut(introProgress));
      exposeFrame(frame, easeInOut(clamp01(introProgress / INTRO_FADE_SHARE)));
    }
    forgetHiddenCounts(frame);
    renderer.render(frame, {
      stageFrame: stage.frame,
      seconds,
      isPortrait: stage.isPortrait,
      showSpark: !isStill,
      textFor: (label) => textForLabel(label, seconds),
    });
    const isCaptionHeld = introProgress < INTRO_CAPTION_AT && frame.beatIndex === 0;
    captions.show(isCaptionHeld ? null : frame.caption, isStill);
    updateProgress(frame, time);
  }

  function tick(now) {
    loopRequest = 0;
    const elapsed = Math.min(MAX_FRAME_SECONDS, lastFrameAt ? (now - lastFrameAt) / 1000 : 0);
    lastFrameAt = now;
    const target = targetTime();
    if (introProgress < 1) {
      introSpeed = target > SETTLE_EPSILON ? INTRO_FAST_FORWARD : introSpeed;
      introProgress = Math.min(1, introProgress + (elapsed / INTRO_SECONDS) * introSpeed);
    }
    renderTime += (target - renderTime) * (1 - Math.exp(-elapsed / SMOOTHING_SECONDS));
    if (Math.abs(target - renderTime) < SETTLE_EPSILON) {
      renderTime = target;
    }
    drawFrame(renderTime, now / 1000, false);
    if (isFilmVisible) {
      loopRequest = requestAnimationFrame(tick);
    }
  }

  function showStill() {
    const time = targetTime();
    const index = beatIndexAt(film.beats, time);
    const beat = film.beats[index];
    const isSwitched = time - beat.start >= beat.motion * 0.3;
    const shownIndex = isSwitched ? index : Math.max(0, index - 1);
    const shownBeat = film.beats[shownIndex];
    if (shownIndex === stillIndex) {
      updateProgress(evaluateFrame(film, time), time);
      return;
    }
    const isFirstStill = stillIndex === -1;
    stillIndex = shownIndex;
    if (!isFirstStill) {
      const stillContext = elements.still.getContext("2d");
      elements.still.width = elements.canvas.width;
      elements.still.height = elements.canvas.height;
      stillContext.drawImage(elements.canvas, 0, 0);
      elements.still.classList.remove(STILL_FADE_CLASS);
      void elements.still.offsetWidth;
      elements.still.classList.add(STILL_FADE_CLASS);
    }
    drawFrame(shownBeat.start + shownBeat.motion, 0, true);
  }

  function requestFrame() {
    if (reducedMotion.matches) {
      showStill();
      return;
    }
    if (!loopRequest && isFilmVisible) {
      lastFrameAt = 0;
      loopRequest = requestAnimationFrame(tick);
    }
  }

  function restart() {
    const time = targetTime();
    const wasInFilm = scrollY >= filmTop && scrollY <= filmTop + film.duration * pixelsPerSecond;
    build();
    if (wasInFilm) {
      scrollTo({ top: filmTop + time * pixelsPerSecond, behavior: "auto" });
    }
    renderTime = targetTime();
    requestFrame();
  }

  build();
  renderTime = targetTime();
  introProgress = reducedMotion.matches || renderTime > SETTLE_EPSILON ? 1 : 0;

  addEventListener("scroll", requestFrame, { passive: true });
  addEventListener("scroll", () => fadeCredits(creditLines, elements.progress), { passive: true });
  fadeCredits(creditLines, elements.progress);
  let lastSize = `${stage.width}x${stage.height}`;
  new ResizeObserver(() => {
    const box = elements.stage.getBoundingClientRect();
    const size = `${box.width}x${box.height}`;
    if (size !== lastSize) {
      lastSize = size;
      restart();
    }
  }).observe(elements.stage);
  reducedMotion.addEventListener("change", () => {
    introProgress = 1;
    stillIndex = -1;
    requestFrame();
  });
  new IntersectionObserver(([entry]) => {
    isFilmVisible = entry.isIntersecting;
    requestFrame();
  }).observe(elements.film);
  document.fonts?.ready.then(requestFrame);
  requestFrame();
}
