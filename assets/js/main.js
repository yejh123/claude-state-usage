/*
 * Entry point: loads the data, binds the numbers in the copy, starts the film
 * and renders the classic view below it.
 */

import { bindDataText } from "./bindings.js";
import { renderClassicView } from "./classic.js";
import { loadLookups } from "./data.js";
import { startFilm } from "./film/film.js";

const DATA_LOAD_ERROR_MESSAGE = "The data for this page could not load. Refresh the page to try again.";
const FILM_ERROR_MESSAGE =
  "The film could not start in this browser. Every number is in the classic view below.";

/**
 * Show a message in place of something that failed to load.
 * @param {string} elementId - The alert element to fill.
 * @param {string} message - Text for the reader.
 */
function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.hidden = false;
}

/**
 * Load the data and start every part of the page.
 */
async function initializePage() {
  let lookups;
  try {
    const loadedLookups = await loadLookups();
    bindDataText(document, loadedLookups);
    lookups = loadedLookups;
  } catch (error) {
    console.error(error);
    showError("stage-error", DATA_LOAD_ERROR_MESSAGE);
    showError("load-error", DATA_LOAD_ERROR_MESSAGE);
    return;
  }
  try {
    startFilm(lookups);
  } catch (error) {
    console.error(error);
    showError("stage-error", FILM_ERROR_MESSAGE);
  }
  await renderClassicView(lookups);
}

initializePage();
