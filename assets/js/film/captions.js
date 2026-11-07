/*
 * The film's words: captions in the left column (bottom on phones) and the
 * slim progress line that names the scenes.
 *
 * Caption copy lives in index.html. Each caption is an element with
 * data-caption; its parts (data-part) fade in as the film reaches them.
 * Numbers marked .num take their value from the data file (data-fact) and
 * count up from data-from when their part appears. They keep the same number
 * of digits while counting and use tabular figures, so the words around them
 * never move.
 */

import { easeOut } from "./timeline.js";

const COUNT_SECONDS = 1.1;
const SHOWN_CLASS = "is-shown";
const ACTIVE_CLASS = "is-active";
const CURRENT_CLASS = "is-current";

/**
 * Animate one number from its data-from value to its final value.
 * @param {HTMLElement} element - A .num element with data-to.
 * @param {boolean} isInstant - Skip the animation (reduced motion).
 * @returns {function(): void} Cancels the animation and shows the final value.
 */
function countUp(element, isInstant) {
  const target = Number(element.dataset.to);
  const start = Number(element.dataset.from ?? target);
  if (isInstant || start === target) {
    element.textContent = String(target);
    return () => {};
  }
  let frameRequest = 0;
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / (COUNT_SECONDS * 1000));
    element.textContent = String(Math.round(start + (target - start) * easeOut(progress)));
    if (progress < 1) {
      frameRequest = requestAnimationFrame(step);
    }
  };
  element.textContent = String(start);
  frameRequest = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frameRequest);
    element.textContent = String(target);
  };
}

/**
 * Create the caption controller.
 * @param {HTMLElement} captionsElement - The container of all captions.
 * @param {Array<{id: string, label: string}>} scenes - The film's scenes in order.
 * @returns {{show: function(object|null, boolean): void}} The controller.
 */
export function createCaptions(captionsElement, scenes) {
  const captionElements = [...captionsElement.querySelectorAll("[data-caption]")];
  const captionsById = new Map(captionElements.map((element) => [element.dataset.caption, element]));
  const sceneNumber = new Map(scenes.map((scene, position) => [scene.id, position + 1]));
  for (const element of captionsById.values()) {
    const scene = scenes.find((candidate) => candidate.id === element.dataset.scene);
    const label = element.querySelector(".caption-label");
    label.replaceChildren(
      Object.assign(document.createElement("span"), {
        className: "caption-number",
        textContent: String(sceneNumber.get(scene.id)).padStart(2, "0"),
      }),
      document.createTextNode(scene.label),
    );
  }

  let activeId = null;
  const shownParts = new Set();
  const cancelers = [];

  function stopCounting() {
    while (cancelers.length) {
      cancelers.pop()();
    }
  }

  /**
   * Show a caption and some of its parts.
   * @param {{id: string, parts: string[]}|null} caption - What to show; null hides all captions.
   * @param {boolean} isInstant - Show numbers at their final value without counting.
   */
  function show(caption, isInstant) {
    const nextId = caption ? caption.id : null;
    if (nextId !== activeId) {
      stopCounting();
      shownParts.clear();
      for (const [id, element] of captionsById) {
        const isActive = id === nextId;
        element.classList.toggle(ACTIVE_CLASS, isActive);
        element.setAttribute("aria-hidden", String(!isActive));
      }
      activeId = nextId;
    }
    if (!caption) {
      return;
    }
    const element = captionsById.get(caption.id);
    if (!element) {
      throw new Error(`The film asks for caption "${caption.id}", which is not in index.html.`);
    }
    for (const part of element.querySelectorAll("[data-part]")) {
      const isShown = caption.parts.includes(part.dataset.part);
      part.classList.toggle(SHOWN_CLASS, isShown);
      if (isShown && !shownParts.has(part.dataset.part)) {
        shownParts.add(part.dataset.part);
        for (const number of part.querySelectorAll(".num[data-to]")) {
          cancelers.push(countUp(number, isInstant));
        }
      }
      if (!isShown) {
        shownParts.delete(part.dataset.part);
      }
    }
  }

  return { show };
}

/**
 * Build the progress line: one slim segment per scene, each named.
 * @param {HTMLElement} navElement - The progress nav element.
 * @param {Array<{id: string, label: string}>} scenes - The film's scenes in order.
 * @param {function(string): void} onSelect - Called with a scene id when the reader picks it.
 * @returns {{update: function(Map<string, number>, string): void}} Sets each scene's fill.
 */
export function createProgress(navElement, scenes, onSelect) {
  const list = document.createElement("ol");
  list.className = "progress-list";
  const segments = new Map();
  for (const scene of scenes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "progress-scene";
    button.dataset.scene = scene.id;
    const track = Object.assign(document.createElement("span"), { className: "progress-track" });
    const fill = Object.assign(document.createElement("span"), { className: "progress-fill" });
    track.append(fill);
    const name = Object.assign(document.createElement("span"), {
      className: "progress-name",
      textContent: scene.label,
    });
    button.append(track, name);
    button.addEventListener("click", () => onSelect(scene.id));
    item.append(button);
    list.append(item);
    segments.set(scene.id, { button, fill });
  }
  navElement.replaceChildren(list);

  let currentId = null;
  return {
    update(fillByScene, sceneId) {
      for (const [id, { fill }] of segments) {
        fill.style.transform = `scaleX(${fillByScene.get(id) ?? 0})`;
      }
      if (sceneId !== currentId) {
        for (const [id, { button }] of segments) {
          button.classList.toggle(CURRENT_CLASS, id === sceneId);
          if (id === sceneId) {
            button.setAttribute("aria-current", "step");
          } else {
            button.removeAttribute("aria-current");
          }
        }
        currentId = sceneId;
      }
    },
  };
}
