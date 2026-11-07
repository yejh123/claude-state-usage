/*
 * Draws one frame of the film on a 2D canvas. Everything is light on a
 * near-black night: shapes are added together ("lighter" blending), each with
 * a soft halo, a faint glassy fill and a bright rim.
 *
 * Halos come from small pre-rendered sprites (a radial glow for round shapes,
 * a nine-slice soft rectangle for squares and columns), cached per color.
 */

import { RGB, cssColor, rgbForTone } from "../tone.js";
import { createProjection } from "./camera.js";

const NIGHT_RGB = [4, 6, 11];
const VIGNETTE_INNER_RGB = [12, 17, 28];
const SPRITE_SIZE = 96;
const SOFT_RECT_CELL = 32;
const SPRITE_CACHE_LIMIT = 400;
const COLOR_STEP = 6;

// Small round lights are glowing points; large ones are glass with a rim. In
// between, the two looks blend, so a light that grows never pops from one to the other.
const POINT_FULL_PX = 8;
const GLASS_FULL_PX = 36;
const POINT_CORE_ALPHA = 0.92;
const POINT_HOT_SHARE = 0.42; // white-hot center, as a share of the point's size
const POINT_HOT_ALPHA = 0.55;
const GLASS_FILL_ALPHA = 0.3;
const INNER_GLOW_ALPHA = 0.38;
const RIM_ALPHA = 0.9;
const SQUARE_RIM_ALPHA = 0.45; // squares and columns get a softer edge so they never read as UI boxes
const RIM_WIDTH_PX = 1.1;
const CONTAINER_FILL_MAX = 0.2; // a light this dim inside is a container around dots: halo only, no rim
// Once color is on, lights near the US average burn dimmer than those far from it.
const NEAR_AVERAGE_BRIGHTNESS = 0.42;
const HALO_MIN_PX = 9;
const HALO_SHARE = 0.34;
const HALO_MAX_PX = 56;
const HALO_BASE = 0.28;
const HALO_TONE = 0.72;

const RING_GAP_PX = 4;
const RING_WIDTH_PX = 1.5;
const RING_HALO_WIDTH_PX = 6;
const RING_MIN_ALPHA = 0.45;

const BREATH_SPEED = 1.3;
const BREATH_DEPTH = 0.12;
const DRIFT_SPEEDS = [0.37, 0.83, 0.29, 0.61];
const PULSE_PERIOD_SECONDS = 2.4;
const PULSE_DEPTH = 0.9;

const DOT_HALO_SCALE = 2.6;
const DOT_HALO_ALPHA = 0.3;

const LINE_HALO_WIDTH_PX = 7;
const LINE_HALO_ALPHA = 0.12;
const LINE_CORE_WIDTH_PX = 1.2;
const LINE_CORE_ALPHA = 0.85;

const SPARK_HALO_PX = 38;
const SPARK_CORE_PX = 2.3;
const SPARK_TRAIL_WIDTH_PX = 2.6;
const SPARK_TWINKLE_SPEED = 5;

const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SERIF = '"Newsreader", Georgia, serif';
const LABEL_GAP_PX = 9;
const LEGEND_SWATCH_PX = 4;
const LEGEND_ITEM_GAP_PX = 22;
const LEGEND_LINE_PX = 18;
const LEGEND_BELOW_PX = 52; // a legend under a chart sits below that chart's own labels
const TILE_LABEL_INSET_PX = 7;
const TILE_CODE_MIN_TILE_PX = 30; // tiles smaller than this on screen show no state code
const STAGE_EDGE_PX = 10;
const LINE_HEIGHT_SHARE = 1.45;
const TILE_CODE_SHARE = 0.15;
const TILE_VALUE_SHARE = 0.36;
const LABEL_STYLES = {
  code: { font: (size) => `600 ${size}px ${MONO}`, size: 11, glow: 0 },
  tileCode: { font: (size) => `500 ${size}px ${MONO}`, size: 10, minSize: 8, maxSize: 13, glow: 0 },
  note: { font: (size) => `400 ${size}px ${MONO}`, size: 11.5, glow: 0 },
  value: { font: (size) => `500 ${size}px ${MONO}`, size: 15, glow: 10 },
  tileValue: { font: (size) => `400 ${size}px ${SERIF}`, size: 28, minSize: 16, maxSize: 58, glow: 16 },
};

/**
 * Smooth 0-to-1 step between two edges.
 * @param {number} lower - Where the step starts.
 * @param {number} upper - Where it ends.
 * @param {number} value - The input.
 * @returns {number} 0 below lower, 1 above upper, smooth in between.
 */
function smoothstep(lower, upper, value) {
  const progress = Math.min(1, Math.max(0, (value - lower) / (upper - lower)));
  return progress * progress * (3 - 2 * progress);
}

/**
 * Round a color to a coarse grid so sprite caches stay small.
 * @param {number[]} rgb - Color.
 * @returns {number[]} The rounded color.
 */
function quantize(rgb) {
  return rgb.map((channel) => Math.min(255, Math.round(channel / COLOR_STEP) * COLOR_STEP));
}

/**
 * Create a canvas of a given size.
 * @param {number} width - Pixels.
 * @param {number} height - Pixels.
 * @returns {HTMLCanvasElement} The canvas.
 */
function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A soft radial glow in one color.
 * @param {number[]} rgb - Color.
 * @returns {HTMLCanvasElement} The sprite.
 */
function paintRadialSprite(rgb) {
  const sprite = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const context = sprite.getContext("2d");
  const half = SPRITE_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, cssColor(rgb, 1));
  gradient.addColorStop(0.18, cssColor(rgb, 0.55));
  gradient.addColorStop(0.42, cssColor(rgb, 0.18));
  gradient.addColorStop(0.7, cssColor(rgb, 0.05));
  gradient.addColorStop(1, cssColor(rgb, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return sprite;
}

/**
 * A blurred square laid out as a 3 x 3 grid of cells for nine-slice drawing.
 * @param {number[]} rgb - Color.
 * @returns {HTMLCanvasElement} The sprite.
 */
function paintSoftRectSprite(rgb) {
  const cell = SOFT_RECT_CELL;
  const sprite = createCanvas(cell * 3, cell * 3);
  const context = sprite.getContext("2d");
  // The square is drawn off-canvas; only its blurred shadow lands in the sprite.
  const offset = cell * 10;
  context.shadowColor = cssColor(rgb, 1);
  context.shadowBlur = cell * 0.8;
  context.shadowOffsetX = offset;
  context.fillStyle = cssColor(rgb, 1);
  context.fillRect(cell - offset, cell, cell, cell);
  return sprite;
}

/**
 * Creates the canvas renderer.
 * @param {HTMLCanvasElement} canvas - The stage canvas.
 * @returns {{resize: Function, render: Function}} The renderer.
 */
export function createRenderer(canvas) {
  const context = canvas.getContext("2d");
  const spriteCache = new Map();
  let viewport = { width: 1, height: 1, pixelRatio: 1 };
  let vignette = null;

  function cachedSprite(kind, rgb) {
    const color = quantize(rgb);
    const key = `${kind}:${color.join(",")}`;
    if (!spriteCache.has(key)) {
      if (spriteCache.size > SPRITE_CACHE_LIMIT) {
        spriteCache.clear();
      }
      spriteCache.set(key, kind === "radial" ? paintRadialSprite(color) : paintSoftRectSprite(color));
    }
    return spriteCache.get(key);
  }

  function paintVignette() {
    const { width, height } = viewport;
    const layer = createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const layerContext = layer.getContext("2d");
    const gradient = layerContext.createRadialGradient(
      width * 0.62,
      height * 0.45,
      0,
      width * 0.62,
      height * 0.45,
      Math.hypot(width, height) * 0.62,
    );
    gradient.addColorStop(0, cssColor(VIGNETTE_INNER_RGB, 1));
    gradient.addColorStop(1, cssColor(NIGHT_RGB, 1));
    layerContext.fillStyle = gradient;
    layerContext.fillRect(0, 0, width, height);
    return layer;
  }

  /**
   * Match the canvas to the stage size.
   * @param {{width: number, height: number, pixelRatio: number}} size - CSS size and device pixel ratio.
   */
  function resize(size) {
    viewport = size;
    canvas.width = Math.round(size.width * size.pixelRatio);
    canvas.height = Math.round(size.height * size.pixelRatio);
    vignette = paintVignette();
  }

  function drawSoftRect(rgb, rect, halo, alpha) {
    const sprite = cachedSprite("rect", rgb);
    const cell = SOFT_RECT_CELL;
    const columns = [
      [0, rect.x - halo, halo],
      [cell, rect.x, rect.width],
      [cell * 2, rect.x + rect.width, halo],
    ];
    const rows = [
      [0, rect.y - halo, halo],
      [cell, rect.y, rect.height],
      [cell * 2, rect.y + rect.height, halo],
    ];
    context.globalAlpha = alpha;
    for (const [sourceY, targetY, targetHeight] of rows) {
      for (const [sourceX, targetX, targetWidth] of columns) {
        if (targetWidth > 0 && targetHeight > 0) {
          context.drawImage(
            sprite,
            sourceX,
            sourceY,
            cell,
            cell,
            targetX,
            targetY,
            targetWidth,
            targetHeight,
          );
        }
      }
    }
  }

  function drawRadial(rgb, centerX, centerY, width, height, alpha) {
    context.globalAlpha = alpha;
    context.drawImage(cachedSprite("radial", rgb), centerX - width / 2, centerY - height / 2, width, height);
  }

  function traceShape(rect, corner) {
    context.beginPath();
    context.roundRect(rect.x, rect.y, rect.width, rect.height, Math.max(0, corner));
  }

  function ambientOffset(position, drift, seconds) {
    const phase = position * 1.7;
    const [speedA, speedB, speedC, speedD] = DRIFT_SPEEDS;
    return [
      (drift * (Math.sin(seconds * speedA + phase) + 0.5 * Math.sin(seconds * speedB + phase * 2))) / 1.5,
      (drift * (Math.cos(seconds * speedC + phase) + 0.5 * Math.sin(seconds * speedD + phase * 3))) / 1.5,
    ];
  }

  function screenRectOf(light, projection, offset) {
    const [centerX, centerY] = projection.toScreen(light.x, light.y);
    const width = light.w * projection.scale;
    const height = light.h * projection.scale;
    return { x: centerX - width / 2 + offset[0], y: centerY - height / 2 + offset[1], width, height };
  }

  function drawLight(light, rect, ambience) {
    const tone = light.tone * light.toneMix;
    const rgb = rgbForTone(tone);
    const emphasis = 1 - light.toneMix * (1 - NEAR_AVERAGE_BRIGHTNESS) * (1 - Math.abs(light.tone));
    const smallest = Math.min(rect.width, rect.height);
    const corner = (light.round * smallest) / 2;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const halo = Math.min(HALO_MAX_PX, HALO_MIN_PX + smallest * HALO_SHARE);
    const haloAlpha = light.alpha * light.glow * (HALO_BASE + HALO_TONE * Math.abs(tone)) * ambience.breath;

    if (haloAlpha > 0.003) {
      if (light.round > 0.5) {
        drawRadial(rgb, centerX, centerY, rect.width + halo * 3, rect.height + halo * 3, haloAlpha);
      } else {
        drawSoftRect(rgb, rect, halo, haloAlpha);
      }
    }
    if (light.alpha < 0.004) {
      return;
    }
    const pointness = light.round > 0.5 ? 1 - smoothstep(POINT_FULL_PX, GLASS_FULL_PX, smallest) : 0;
    const coreAlpha = light.alpha * light.fill * emphasis;
    traceShape(rect, corner);
    context.globalAlpha = coreAlpha * (GLASS_FILL_ALPHA + (POINT_CORE_ALPHA - GLASS_FILL_ALPHA) * pointness);
    context.fillStyle = cssColor(rgb);
    context.fill();
    if (pointness > 0.01) {
      const hotSize = smallest * POINT_HOT_SHARE * 2;
      drawRadial(RGB.white, centerX, centerY, hotSize, hotSize, coreAlpha * POINT_HOT_ALPHA * pointness);
    }
    if (light.fill < CONTAINER_FILL_MAX || pointness > 0.99) {
      return;
    }
    const glassness = 1 - pointness;
    const innerGlowAlpha = coreAlpha * INNER_GLOW_ALPHA * glassness;
    drawRadial(rgb, centerX, centerY, rect.width * 0.92, rect.height * 0.92, innerGlowAlpha);
    traceShape(rect, corner);
    const rimAlpha = light.round > 0.5 ? RIM_ALPHA : SQUARE_RIM_ALPHA;
    context.globalAlpha = light.alpha * emphasis * glassness * rimAlpha;
    context.strokeStyle = cssColor(rgb);
    context.lineWidth = RIM_WIDTH_PX;
    context.stroke();
  }

  function drawRing(light, rect, ambience) {
    const visibility = RING_MIN_ALPHA + (1 - RING_MIN_ALPHA) * Math.min(1, light.alpha);
    const strength = light.ring * visibility * ambience.ringBoost;
    if (strength < 0.01) {
      return;
    }
    const ringRect = {
      x: rect.x - RING_GAP_PX,
      y: rect.y - RING_GAP_PX,
      width: rect.width + RING_GAP_PX * 2,
      height: rect.height + RING_GAP_PX * 2,
    };
    const corner = (light.round * Math.min(rect.width, rect.height)) / 2 + RING_GAP_PX;
    traceShape(ringRect, corner);
    context.strokeStyle = cssColor(RGB.white);
    context.globalAlpha = Math.min(1, strength) * 0.16;
    context.lineWidth = RING_HALO_WIDTH_PX;
    context.stroke();
    context.globalAlpha = Math.min(1, strength);
    context.lineWidth = RING_WIDTH_PX;
    context.stroke();
  }

  function drawDots(dots, projection) {
    for (const dot of dots) {
      if (dot.alpha < 0.01) {
        continue;
      }
      const [centerX, centerY] = projection.toScreen(dot.x, dot.y);
      const radius = Math.max(0.6, dot.r * projection.scale);
      const halo = radius * DOT_HALO_SCALE * 2;
      drawRadial(dot.rgb, centerX, centerY, halo, halo, dot.alpha * dot.glow * DOT_HALO_ALPHA);
      context.globalAlpha = dot.alpha;
      context.fillStyle = cssColor(dot.rgb);
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawAverageLine(line, projection) {
    if (line.alpha < 0.01) {
      return;
    }
    const [startX, lineY] = projection.toScreen(line.x0, line.y);
    const [endX] = projection.toScreen(line.x1, line.y);
    context.beginPath();
    context.moveTo(startX, lineY);
    context.lineTo(endX, lineY);
    context.strokeStyle = cssColor(RGB.white);
    context.globalAlpha = line.alpha * LINE_HALO_ALPHA;
    context.lineWidth = LINE_HALO_WIDTH_PX;
    context.stroke();
    context.globalAlpha = line.alpha * LINE_CORE_ALPHA;
    context.lineWidth = LINE_CORE_WIDTH_PX;
    context.stroke();
  }

  function drawSpark(spark, projection, seconds) {
    const points = spark.trail.map((sample) => projection.toScreen(sample.x, sample.y));
    for (let step = 1; step < points.length; step += 1) {
      const fade = 1 - step / points.length;
      context.beginPath();
      context.moveTo(...points[step - 1]);
      context.lineTo(...points[step]);
      context.strokeStyle = cssColor(RGB.spark);
      context.globalAlpha = fade * fade * spark.trail[step - 1].intensity * 0.9;
      context.lineWidth = SPARK_TRAIL_WIDTH_PX * fade + 0.4;
      context.lineCap = "round";
      context.stroke();
    }
    const twinkle = 0.85 + 0.15 * Math.sin(seconds * SPARK_TWINKLE_SPEED);
    const intensity = spark.head.intensity * twinkle;
    const [headX, headY] = points[0];
    drawRadial(RGB.spark, headX, headY, SPARK_HALO_PX, SPARK_HALO_PX, intensity);
    context.globalAlpha = intensity;
    context.fillStyle = cssColor(RGB.white);
    context.beginPath();
    context.arc(headX, headY, SPARK_CORE_PX, 0, Math.PI * 2);
    context.fill();
  }

  function labelFontSize(style, lightRect) {
    if (!lightRect || style.minSize === undefined) {
      return style.size;
    }
    const share = style === LABEL_STYLES.tileValue ? TILE_VALUE_SHARE : TILE_CODE_SHARE;
    const scaledSize = Math.min(lightRect.width, lightRect.height) * share;
    return Math.min(style.maxSize, Math.max(style.minSize, scaledSize));
  }

  function labelPlacement(label, scene) {
    const { anchor } = label;
    if (anchor.light !== undefined) {
      const rect = scene.lightRects[anchor.light];
      const placements = {
        top: [rect.x + rect.width / 2, rect.y - LABEL_GAP_PX, "center", "bottom"],
        aboveLeft: [rect.x, rect.y - LABEL_GAP_PX - RING_GAP_PX, "left", "bottom"],
        aboveRight: [rect.x + rect.width, rect.y - LABEL_GAP_PX - RING_GAP_PX, "right", "bottom"],
        bottom: [rect.x + rect.width / 2, rect.y + rect.height + LABEL_GAP_PX, "center", "top"],
        belowLeft: [rect.x + rect.width / 2, rect.y + rect.height + LABEL_GAP_PX, "right", "top"],
        left: [rect.x - LABEL_GAP_PX, rect.y + rect.height / 2, "right", "middle"],
        right: [rect.x + rect.width + LABEL_GAP_PX, rect.y + rect.height / 2, "left", "middle"],
        center: [rect.x + rect.width / 2, rect.y + rect.height / 2, "center", "middle"],
        insideTopLeft: [rect.x + TILE_LABEL_INSET_PX, rect.y + TILE_LABEL_INSET_PX, "left", "top"],
      };
      return {
        position: placements[anchor.side],
        lightRect: rect,
        flipLeftX: anchor.side === "right" ? rect.x - LABEL_GAP_PX : undefined,
      };
    }
    if (anchor.world) {
      const [pointX, pointY] = scene.projection.toScreen(...anchor.world);
      const placements = {
        center: [pointX, pointY, "center", "middle"],
        below: [pointX, pointY + LABEL_GAP_PX * 1.6, "center", "top"],
        above: [pointX, pointY - LABEL_GAP_PX, "center", "bottom"],
        aboveLeft: [pointX, pointY - LABEL_GAP_PX, "left", "bottom"],
        left: [pointX - LABEL_GAP_PX * 1.4, pointY, "right", "middle"],
        right: [pointX + LABEL_GAP_PX * 1.4, pointY, "left", "middle"],
        lineEnd: [pointX, pointY - LABEL_GAP_PX * 0.8, "right", "bottom"],
      };
      return { position: placements[anchor.side] };
    }
    const { frame } = scene;
    const [fractionX, fractionY] = anchor.frame;
    const frameX = frame.x + frame.width * fractionX;
    const frameY = frame.y + frame.height * fractionY;
    // On phones the note sits on its own line above the legend, at the left.
    if (scene.isPortrait) {
      return { position: [frame.x, frameY - LEGEND_LINE_PX, "left", "bottom"] };
    }
    return { position: [frameX, frameY, "right", "bottom"] };
  }

  // Keep a label on screen: a label that would run off the right edge flips to
  // the left of its light, and any label is nudged inside the stage's edges.
  function fitPlacement(placement, width, flipLeftX) {
    let [textX, textY, align, baseline] = placement.position;
    const right = () => (align === "left" ? textX + width : align === "center" ? textX + width / 2 : textX);
    if (right() > viewport.width - STAGE_EDGE_PX && flipLeftX !== undefined) {
      textX = flipLeftX;
      align = "right";
    }
    const overflowRight = right() - (viewport.width - STAGE_EDGE_PX);
    if (overflowRight > 0) {
      textX -= overflowRight;
    }
    const left = right() - width;
    if (left < STAGE_EDGE_PX) {
      textX += STAGE_EDGE_PX - left;
    }
    return [textX, textY, align, baseline];
  }

  function drawLabelText(label, placement, text) {
    const style = LABEL_STYLES[label.style];
    const fontSize = labelFontSize(style, placement.lightRect);
    context.font = style.font(fontSize);
    const lines = text.split("\n");
    const width = Math.max(...lines.map((line) => context.measureText(line).width));
    const [textX, textY, align, baseline] = fitPlacement(placement, width, placement.flipLeftX);
    context.textAlign = align;
    context.textBaseline = baseline;
    context.globalAlpha = label.alpha;
    context.fillStyle = cssColor(label.rgb);
    context.shadowColor = style.glow ? cssColor(label.glowRgb ?? label.rgb, 0.7) : "transparent";
    context.shadowBlur = style.glow;
    lines.forEach((line, lineIndex) => {
      context.fillText(line, textX, textY + lineIndex * fontSize * LINE_HEIGHT_SHARE);
    });
    context.shadowBlur = 0;
  }

  function legendOrigin(labels, scene) {
    const anchorPoint = labels[0].anchor.world;
    if (!anchorPoint) {
      return [scene.frame.x, scene.frame.y + scene.frame.height];
    }
    const widths = labels.map((label) => {
      context.font = LABEL_STYLES[label.style].font(LABEL_STYLES[label.style].size);
      return LEGEND_SWATCH_PX * 2 + 8 + context.measureText(label.text).width;
    });
    const rowWidth = widths.reduce((sum, width) => sum + width, 0) + LEGEND_ITEM_GAP_PX * (labels.length - 1);
    const [pointX, pointY] = scene.projection.toScreen(...anchorPoint);
    return [pointX - rowWidth / 2, pointY + LEGEND_BELOW_PX];
  }

  function drawLegend(labels, scene) {
    if (!labels.length) {
      return;
    }
    let [cursorX, legendY] = legendOrigin(labels, scene);
    for (const label of labels) {
      context.globalAlpha = label.alpha;
      const haloSize = LEGEND_SWATCH_PX * 6;
      drawRadial(label.swatch, cursorX + LEGEND_SWATCH_PX, legendY - 6, haloSize, haloSize, label.alpha);
      context.fillStyle = cssColor(label.swatch);
      context.beginPath();
      context.arc(cursorX + LEGEND_SWATCH_PX, legendY - 6, LEGEND_SWATCH_PX, 0, Math.PI * 2);
      context.fill();
      const textX = cursorX + LEGEND_SWATCH_PX * 2 + 8;
      drawLabelText(label, { position: [textX, legendY, "left", "bottom"] }, label.text);
      cursorX = textX + context.measureText(label.text).width + LEGEND_ITEM_GAP_PX;
    }
  }

  function isOnStage(rect) {
    const isAcross = rect.x < viewport.width && rect.x + rect.width > 0;
    return isAcross && rect.y < viewport.height && rect.y + rect.height > 0;
  }

  function drawLabels(labels, scene, textFor) {
    context.globalCompositeOperation = "source-over";
    const legend = labels.filter((label) => label.anchor.legend && label.alpha > 0.01);
    for (const label of labels) {
      if (label.anchor.legend || label.alpha < 0.01) {
        continue;
      }
      const placement = labelPlacement(label, scene);
      if (placement.lightRect && !isOnStage(placement.lightRect)) {
        continue;
      }
      const isCrampedTileCode =
        label.style === "tileCode" &&
        Math.min(placement.lightRect.width, placement.lightRect.height) < TILE_CODE_MIN_TILE_PX;
      if (isCrampedTileCode) {
        continue;
      }
      drawLabelText(label, placement, textFor(label));
    }
    drawLegend(legend, scene);
  }

  /**
   * Draw one frame.
   * @param {object} frame - Result of evaluateFrame.
   * @param {object} environment - Stage frame, wall-clock seconds, label text and spark visibility.
   */
  function render(frame, environment) {
    const { stageFrame, seconds, textFor, showSpark, isPortrait } = environment;
    const { pixelRatio, width, height } = viewport;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.drawImage(vignette, 0, 0, width, height);

    const projection = createProjection(frame.camera, stageFrame);
    const pulse = frame.pulse * (0.5 + 0.5 * Math.sin((seconds * Math.PI * 2) / PULSE_PERIOD_SECONDS));
    const lightRects = frame.lights.map((light, position) =>
      screenRectOf(light, projection, ambientOffset(position, frame.drift, seconds)),
    );

    context.globalCompositeOperation = "lighter";
    drawAverageLine(frame.line, projection);
    frame.lights.forEach((light, position) => {
      const breath = 1 + BREATH_DEPTH * Math.sin(seconds * BREATH_SPEED + position * 2.3);
      const focusPulse = light.ring > 0 ? 1 + PULSE_DEPTH * pulse : 1;
      drawLight(light, lightRects[position], { breath: breath * focusPulse });
    });
    drawDots(frame.dots, projection);
    frame.lights.forEach((light, position) => {
      drawRing(light, lightRects[position], { ringBoost: 1 + 0.3 * pulse });
    });
    if (showSpark) {
      drawSpark(frame.spark, projection, seconds);
    }
    drawLabels(frame.labels, { lightRects, projection, frame: stageFrame, isPortrait }, textFor);
    context.globalAlpha = 1;
  }

  return { resize, render };
}
