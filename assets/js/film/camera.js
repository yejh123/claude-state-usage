/*
 * The film's camera. A camera is { x, y, w }: the world point at the center of
 * the frame and how many world units fit across the frame's width. Moves
 * between cameras follow van Wijk and Nuij's smooth zoom path (the same math
 * as d3.interpolateZoom), which eases out a little on long moves and glides
 * back in, like a camera on a crane.
 */

const EPSILON_SQUARED = 1e-12;

/**
 * A rectangle in world units, padded on every side.
 * @param {{x: number, y: number, width: number, height: number}} rect - The rectangle.
 * @param {number} padding - World units to add on each side.
 * @returns {{x: number, y: number, width: number, height: number}} The padded rectangle.
 */
export function padRect(rect, padding) {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + 2 * padding,
    height: rect.height + 2 * padding,
  };
}

/**
 * The camera that fits a world rectangle inside the frame.
 * @param {{x: number, y: number, width: number, height: number}} rect - What must be in view.
 * @param {{width: number, height: number}} frame - The on-screen area the graphics use.
 * @returns {{x: number, y: number, w: number}} The camera.
 */
export function cameraForRect(rect, frame) {
  const scale = Math.min(frame.width / rect.width, frame.height / rect.height);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: frame.width / scale };
}

/**
 * Build the function that maps world points to screen pixels for one camera.
 * @param {{x: number, y: number, w: number}} camera - The camera.
 * @param {{x: number, y: number, width: number, height: number}} frame - The on-screen frame.
 * @returns {{scale: number, toScreen: function(number, number): number[]}} The projection.
 */
export function createProjection(camera, frame) {
  const scale = frame.width / camera.w;
  const originX = frame.x + frame.width / 2;
  const originY = frame.y + frame.height / 2;
  return {
    scale,
    toScreen: (worldX, worldY) => [
      originX + (worldX - camera.x) * scale,
      originY + (worldY - camera.y) * scale,
    ],
  };
}

/**
 * Smooth zoom-and-pan between two cameras.
 * @param {{x: number, y: number, w: number}} fromCamera - Where the move starts.
 * @param {{x: number, y: number, w: number}} toCamera - Where it ends.
 * @param {number} rho - Curvature; higher values zoom out further on long moves.
 * @returns {function(number): {x: number, y: number, w: number}} Camera for progress 0 to 1.
 */
export function interpolateCamera(fromCamera, toCamera, rho) {
  const { x: startX, y: startY, w: startWidth } = fromCamera;
  const { x: endX, y: endY, w: endWidth } = toCamera;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;
  const rhoSquared = rho * rho;

  if (distanceSquared < EPSILON_SQUARED) {
    const zoomSpan = Math.log(endWidth / startWidth);
    return (progress) => ({
      x: startX + progress * deltaX,
      y: startY + progress * deltaY,
      w: startWidth * Math.exp(progress * zoomSpan),
    });
  }

  const distance = Math.sqrt(distanceSquared);
  const startTerm =
    (endWidth * endWidth - startWidth * startWidth + rhoSquared * rhoSquared * distanceSquared) /
    (2 * startWidth * rhoSquared * distance);
  const endTerm =
    (endWidth * endWidth - startWidth * startWidth - rhoSquared * rhoSquared * distanceSquared) /
    (2 * endWidth * rhoSquared * distance);
  const startRatio = Math.log(Math.sqrt(startTerm * startTerm + 1) - startTerm);
  const endRatio = Math.log(Math.sqrt(endTerm * endTerm + 1) - endTerm);
  const pathLength = (endRatio - startRatio) / rho;

  return (progress) => {
    const pathPosition = progress * pathLength;
    const coshStart = Math.cosh(startRatio);
    const travel =
      (startWidth / (rhoSquared * distance)) *
      (coshStart * Math.tanh(rho * pathPosition + startRatio) - Math.sinh(startRatio));
    return {
      x: startX + travel * deltaX,
      y: startY + travel * deltaY,
      w: (startWidth * coshStart) / Math.cosh(rho * pathPosition + startRatio),
    };
  };
}

/**
 * Straight pan with an even zoom, for tracking shots along a row of things.
 * @param {{x: number, y: number, w: number}} fromCamera - Where the move starts.
 * @param {{x: number, y: number, w: number}} toCamera - Where it ends.
 * @param {function(number): number} [pathY] - Optional camera height for each x along the way.
 * @returns {function(number): {x: number, y: number, w: number}} Camera for progress 0 to 1.
 */
export function trackCamera(fromCamera, toCamera, pathY) {
  return (progress) => {
    const cameraX = fromCamera.x + (toCamera.x - fromCamera.x) * progress;
    const straightY = fromCamera.y + (toCamera.y - fromCamera.y) * progress;
    return {
      x: cameraX,
      y: pathY ? pathY(cameraX) : straightY,
      w: fromCamera.w * Math.exp(progress * Math.log(toCamera.w / fromCamera.w)),
    };
  };
}
