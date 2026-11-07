/*
 * The film's one color rule, shared by the film and the classic view:
 * warm amber means above the US average, cool blue-gray means below it, and
 * the further a state is from average, the stronger the color and the glow.
 *
 * Distance from average is measured as a ratio (log2), so a state that uses
 * Claude.ai at half the average rate is as far from average as one at twice
 * the rate.
 */

export const AVERAGE_INDEX = 1;

// log2 distance at which the color is fully saturated. D.C. (3.32) sits at
// +1.73 and West Virginia (0.25) at -2, so both read as fully colored.
const TONE_LOG2_CAP = 1.75;
// Below 1, lifts small distances so near-average states still show a hint of color.
const TONE_CURVE = 0.6;

export const RGB = {
  neutral: [214, 218, 226],
  warm: [255, 176, 72],
  cool: [128, 158, 198],
  white: [255, 250, 240],
  spark: [255, 244, 214],
};

/**
 * Turn a per capita index into a signed tone between -1 (far below) and 1 (far above).
 * @param {number} perCapitaIndex - 1.0 is the US average.
 * @returns {number} The tone; 0 for exactly average.
 */
export function toneForIndex(perCapitaIndex) {
  const log2Distance = Math.log2(perCapitaIndex / AVERAGE_INDEX);
  const strength = Math.min(1, Math.abs(log2Distance) / TONE_LOG2_CAP) ** TONE_CURVE;
  return Math.sign(log2Distance) * strength;
}

/**
 * Mix two RGB colors.
 * @param {number[]} fromRgb - Start color.
 * @param {number[]} toRgb - End color.
 * @param {number} amount - 0 returns fromRgb, 1 returns toRgb.
 * @returns {number[]} The mixed color.
 */
function mixRgb(fromRgb, toRgb, amount) {
  return fromRgb.map((channel, position) => channel + (toRgb[position] - channel) * amount);
}

/**
 * The color of a tone: neutral starlight at 0, amber toward 1, blue-gray toward -1.
 * @param {number} tone - Signed tone from toneForIndex.
 * @returns {number[]} An RGB triple.
 */
export function rgbForTone(tone) {
  const poleRgb = tone >= 0 ? RGB.warm : RGB.cool;
  return mixRgb(RGB.neutral, poleRgb, Math.min(1, Math.abs(tone)));
}

/**
 * Format an RGB triple as a CSS color.
 * @param {number[]} rgb - Red, green and blue from 0 to 255.
 * @param {number} [alpha] - Opacity from 0 to 1.
 * @returns {string} An rgba() string.
 */
export function cssColor(rgb, alpha = 1) {
  const [red, green, blue] = rgb.map((channel) => Math.round(channel));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Classic view fills start from this dark surface, so near-average states stay
// quiet and far-from-average states carry the strongest color.
const SURFACE_RGB = [26, 31, 42];
const SURFACE_MIN_STRENGTH = 0.2;

/**
 * The fill for a state on a dark map or bar: dim near average, vivid far from it.
 * @param {number} perCapitaIndex - 1.0 is the US average.
 * @returns {number[]} An RGB triple.
 */
export function surfaceRgbForIndex(perCapitaIndex) {
  const tone = toneForIndex(perCapitaIndex);
  const poleRgb = tone > 0 ? RGB.warm : RGB.cool;
  const strength = SURFACE_MIN_STRENGTH + (1 - SURFACE_MIN_STRENGTH) * Math.abs(tone);
  return mixRgb(SURFACE_RGB, tone === 0 ? RGB.neutral : poleRgb, strength);
}
