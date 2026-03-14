import type { Bounds, ColorSwatch, ShadowSpec, GradientSpec } from "@one-shot-ui/core";
import { rgbToHex, samplePixel, type ImageAsset } from "@one-shot-ui/image-io";

type Bucket = {
  r: number;
  g: number;
  b: number;
  population: number;
};

export function extractDominantColors(image: ImageAsset, limit = 8): ColorSwatch[] {
  const buckets = new Map<string, Bucket>();
  let sampleCount = 0;

  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const offset = (y * image.width + x) * image.channels;
      const alpha = image.data[offset + 3] ?? 255;
      if (alpha < 16) {
        continue;
      }

      const r = image.data[offset] ?? 0;
      const g = image.data[offset + 1] ?? 0;
      const b = image.data[offset + 2] ?? 0;
      const key = `${quantize(r)}:${quantize(g)}:${quantize(b)}`;
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, population: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.population += 1;
      buckets.set(key, bucket);
      sampleCount += 1;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.population - a.population)
    .slice(0, limit)
    .map((bucket) => {
      const r = Math.round(bucket.r / bucket.population);
      const g = Math.round(bucket.g / bucket.population);
      const b = Math.round(bucket.b / bucket.population);
      return {
        hex: rgbToHex(r, g, b),
        rgb: { r, g, b },
        population: bucket.population,
        ratio: sampleCount === 0 ? 0 : bucket.population / sampleCount
      };
    });
}

function quantize(value: number): number {
  return Math.round(value / 16) * 16;
}

export function estimateNodeFill(image: ImageAsset, bounds: Bounds): string | null {
  const startX = Math.max(bounds.x, Math.floor(bounds.x + bounds.width * 0.25));
  const endX = Math.min(bounds.x + bounds.width, Math.ceil(bounds.x + bounds.width * 0.75));
  const startY = Math.max(bounds.y, Math.floor(bounds.y + bounds.height * 0.25));
  const endY = Math.min(bounds.y + bounds.height, Math.ceil(bounds.y + bounds.height * 0.75));
  const buckets = new Map<string, number>();
  let bestKey: string | null = null;
  let bestCount = 0;

  for (let y = startY; y < endY; y += Math.max(1, Math.floor(bounds.height / 10))) {
    for (let x = startX; x < endX; x += Math.max(1, Math.floor(bounds.width / 10))) {
      const [r, g, b, a] = samplePixel(image, x, y);
      if (a < 16) {
        continue;
      }
      const key = `${quantize(r)}:${quantize(g)}:${quantize(b)}`;
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }
  }

  if (!bestKey) {
    return null;
  }

  const [r, g, b] = bestKey.split(":").map((part) => Number.parseInt(part, 10));
  return rgbToHex(r, g, b);
}

export function estimateBorderRadius(image: ImageAsset, bounds: Bounds, fillHex: string | null): number | null {
  if (!fillHex || bounds.width < 8 || bounds.height < 8) {
    return null;
  }

  const fill = hexToRgb(fillHex);
  const maxRadius = Math.max(1, Math.floor(Math.min(bounds.width, bounds.height) / 2));
  const corners: Array<{ x: number; y: number; xDir: number; yDir: number }> = [
    { x: bounds.x, y: bounds.y, xDir: 1, yDir: 1 },
    { x: bounds.x + bounds.width - 1, y: bounds.y, xDir: -1, yDir: 1 },
    { x: bounds.x, y: bounds.y + bounds.height - 1, xDir: 1, yDir: -1 },
    { x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1, xDir: -1, yDir: -1 }
  ];

  const estimates = corners
    .map((corner) => {
      for (let radius = 0; radius < maxRadius; radius++) {
        const edgeA = samplePixel(image, corner.x + corner.xDir * radius, corner.y);
        const edgeB = samplePixel(image, corner.x, corner.y + corner.yDir * radius);
        if (isSimilar(edgeA, fill) && isSimilar(edgeB, fill)) {
          return radius;
        }
      }
      return 0;
    })
    .filter((value) => Number.isFinite(value));

  if (estimates.length === 0) {
    return null;
  }

  const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  return Math.max(0, Math.round(average));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function isSimilar(pixel: [number, number, number, number], target: { r: number; g: number; b: number }, tolerance = 36) {
  return (
    Math.abs(pixel[0] - target.r) +
      Math.abs(pixel[1] - target.g) +
      Math.abs(pixel[2] - target.b) <=
    tolerance
  );
}

export function detectShadow(
  image: ImageAsset,
  bounds: Bounds,
  fillHex: string | null,
  backgroundHex: string
): ShadowSpec | null {
  if (!fillHex || bounds.width < 12 || bounds.height < 12) {
    return null;
  }

  const bg = hexToRgb(backgroundHex);
  const fill = hexToRgb(fillHex);
  const probeDistance = Math.min(24, Math.floor(Math.min(bounds.width, bounds.height) * 0.3));

  const directions = [
    { name: "bottom", dx: 0, dy: 1, startX: bounds.x + Math.floor(bounds.width / 2), startY: bounds.y + bounds.height },
    { name: "right", dx: 1, dy: 0, startX: bounds.x + bounds.width, startY: bounds.y + Math.floor(bounds.height / 2) },
    { name: "top", dx: 0, dy: -1, startX: bounds.x + Math.floor(bounds.width / 2), startY: bounds.y - 1 },
    { name: "left", dx: -1, dy: 0, startX: bounds.x - 1, startY: bounds.y + Math.floor(bounds.height / 2) }
  ];

  let shadowPixelsTotal = 0;
  let shadowR = 0;
  let shadowG = 0;
  let shadowB = 0;
  let shadowA = 0;
  let maxExtentBottom = 0;
  let maxExtentRight = 0;
  let maxExtentTop = 0;
  let maxExtentLeft = 0;

  for (const dir of directions) {
    let extent = 0;
    for (let step = 1; step <= probeDistance; step++) {
      const px = dir.startX + dir.dx * step;
      const py = dir.startY + dir.dy * step;
      if (px < 0 || px >= image.width || py < 0 || py >= image.height) break;

      const [r, g, b, a] = samplePixel(image, px, py);
      if (a < 8) break;

      const distToBg = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      const distToFill = Math.abs(r - fill.r) + Math.abs(g - fill.g) + Math.abs(b - fill.b);

      if (distToBg < 12) break;
      if (distToFill < 18) continue;

      // Pixel is between fill and background — likely shadow
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const bgLuminance = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
      if (Math.abs(luminance - bgLuminance) < 6) break;

      extent = step;
      shadowPixelsTotal++;
      shadowR += r;
      shadowG += g;
      shadowB += b;
      // Estimate alpha from how far the shadow color is from background
      const maxDist = Math.max(1, Math.abs(fill.r - bg.r) + Math.abs(fill.g - bg.g) + Math.abs(fill.b - bg.b));
      shadowA += Math.min(1, distToBg / maxDist);
    }

    if (dir.name === "bottom") maxExtentBottom = extent;
    else if (dir.name === "right") maxExtentRight = extent;
    else if (dir.name === "top") maxExtentTop = extent;
    else maxExtentLeft = extent;
  }

  if (shadowPixelsTotal < 3) {
    return null;
  }

  const xOffset = Math.round(maxExtentRight - maxExtentLeft);
  const yOffset = Math.round(maxExtentBottom - maxExtentTop);
  const blurRadius = Math.max(maxExtentBottom, maxExtentRight, maxExtentTop, maxExtentLeft);
  const spread = 0;

  if (blurRadius < 2) {
    return null;
  }

  const avgR = Math.round(shadowR / shadowPixelsTotal);
  const avgG = Math.round(shadowG / shadowPixelsTotal);
  const avgB = Math.round(shadowB / shadowPixelsTotal);
  const avgA = Math.round((shadowA / shadowPixelsTotal) * 100) / 100;

  return {
    xOffset,
    yOffset,
    blurRadius,
    spread,
    color: `rgba(${avgR}, ${avgG}, ${avgB}, ${Math.min(1, Math.max(0.05, avgA))})`,
    confidence: Math.min(0.85, 0.3 + shadowPixelsTotal * 0.03)
  };
}

export function detectGradient(image: ImageAsset, bounds: Bounds): GradientSpec | null {
  if (bounds.width < 8 || bounds.height < 8) {
    return null;
  }

  const sampleCount = 8;
  const midY = bounds.y + Math.floor(bounds.height / 2);
  const midX = bounds.x + Math.floor(bounds.width / 2);

  // Sample horizontal line through center
  const hSamples: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < sampleCount; i++) {
    const x = bounds.x + Math.floor((bounds.width * (i + 0.5)) / sampleCount);
    const [r, g, b] = samplePixel(image, x, midY);
    hSamples.push({ r, g, b });
  }

  // Sample vertical line through center
  const vSamples: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < sampleCount; i++) {
    const y = bounds.y + Math.floor((bounds.height * (i + 0.5)) / sampleCount);
    const [r, g, b] = samplePixel(image, midX, y);
    vSamples.push({ r, g, b });
  }

  const hVariance = colorVariance(hSamples);
  const vVariance = colorVariance(vSamples);

  // Need meaningful variance to call it a gradient, but it should also be monotonic
  const hMonotonic = isMonotonicGradient(hSamples);
  const vMonotonic = isMonotonicGradient(vSamples);

  const minVariance = 30;
  const isHorizontalGradient = hVariance > minVariance && hMonotonic;
  const isVerticalGradient = vVariance > minVariance && vMonotonic;

  if (!isHorizontalGradient && !isVerticalGradient) {
    // Check for radial gradient: center vs edges
    const center = samplePixel(image, midX, midY);
    const edgeSamples = [
      samplePixel(image, bounds.x + 2, bounds.y + 2),
      samplePixel(image, bounds.x + bounds.width - 3, bounds.y + 2),
      samplePixel(image, bounds.x + 2, bounds.y + bounds.height - 3),
      samplePixel(image, bounds.x + bounds.width - 3, bounds.y + bounds.height - 3)
    ];

    const edgeDistances = edgeSamples.map(
      (e) => Math.abs(e[0] - center[0]) + Math.abs(e[1] - center[1]) + Math.abs(e[2] - center[2])
    );
    const avgEdgeDist = edgeDistances.reduce((s, d) => s + d, 0) / edgeDistances.length;
    const edgeConsistency = Math.max(...edgeDistances) - Math.min(...edgeDistances);

    if (avgEdgeDist > 40 && edgeConsistency < avgEdgeDist * 0.6) {
      const avgEdge = {
        r: Math.round(edgeSamples.reduce((s, e) => s + e[0], 0) / 4),
        g: Math.round(edgeSamples.reduce((s, e) => s + e[1], 0) / 4),
        b: Math.round(edgeSamples.reduce((s, e) => s + e[2], 0) / 4)
      };
      return {
        type: "radial",
        angle: null,
        stops: [
          { color: rgbToHex(center[0], center[1], center[2]), position: 0 },
          { color: rgbToHex(avgEdge.r, avgEdge.g, avgEdge.b), position: 1 }
        ],
        confidence: Math.min(0.8, 0.35 + avgEdgeDist * 0.005)
      };
    }

    return null;
  }

  // Pick the dominant gradient direction
  const isHorizontal = isHorizontalGradient && (!isVerticalGradient || hVariance > vVariance);
  const samples = isHorizontal ? hSamples : vSamples;
  const angle = isHorizontal ? 90 : 180;

  const startColor = samples[0]!;
  const endColor = samples[samples.length - 1]!;
  const variance = isHorizontal ? hVariance : vVariance;

  return {
    type: "linear",
    angle,
    stops: [
      { color: rgbToHex(startColor.r, startColor.g, startColor.b), position: 0 },
      { color: rgbToHex(endColor.r, endColor.g, endColor.b), position: 1 }
    ],
    confidence: Math.min(0.85, 0.3 + variance * 0.003)
  };
}

function colorVariance(samples: Array<{ r: number; g: number; b: number }>): number {
  if (samples.length < 2) return 0;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return Math.abs(first.r - last.r) + Math.abs(first.g - last.g) + Math.abs(first.b - last.b);
}

// --- Image and asset awareness ---

export type AssetType = "solid" | "gradient" | "image" | "icon" | "decorative" | "unknown";

export interface AssetClassification {
  type: AssetType;
  confidence: number;
  placeholderStrategy: "solid-color" | "gradient" | "placeholder-image" | "svg-placeholder" | "none";
  dominantColor: string;
}

/**
 * Classify a layout region as a solid fill, gradient, photographic image, icon,
 * or decorative element. Suggests a placeholder strategy for each type.
 */
export function classifyAsset(image: ImageAsset, bounds: Bounds): AssetClassification {
  if (bounds.width < 4 || bounds.height < 4) {
    return { type: "unknown", confidence: 0.2, placeholderStrategy: "none", dominantColor: "#000000" };
  }

  const variance = measurePixelVariance(image, bounds);
  const edgeComplexity = measureEdgeComplexity(image, bounds);
  const aspectRatio = bounds.width / Math.max(1, bounds.height);
  const area = bounds.width * bounds.height;
  const dominantColor = estimateNodeFill(image, bounds) ?? "#808080";

  // Small, roughly square, moderate variance → icon
  if (area < 3600 && Math.abs(aspectRatio - 1) < 0.5 && variance > 200 && edgeComplexity < 0.4) {
    return { type: "icon", confidence: 0.65, placeholderStrategy: "svg-placeholder", dominantColor };
  }

  // High pixel variance with complex edges → photographic image
  if (variance > 800 && edgeComplexity > 0.3) {
    return { type: "image", confidence: 0.7, placeholderStrategy: "placeholder-image", dominantColor };
  }

  // Moderate variance → decorative element
  if (variance > 400 && variance <= 800) {
    return { type: "decorative", confidence: 0.5, placeholderStrategy: "gradient", dominantColor };
  }

  // Low variance: check for gradient
  const gradient = detectGradient(image, bounds);
  if (gradient) {
    return { type: "gradient", confidence: gradient.confidence, placeholderStrategy: "gradient", dominantColor };
  }

  return { type: "solid", confidence: 0.8, placeholderStrategy: "solid-color", dominantColor };
}

function measurePixelVariance(image: ImageAsset, bounds: Bounds): number {
  const samples: Array<{ r: number; g: number; b: number }> = [];
  const stepX = Math.max(1, Math.floor(bounds.width / 16));
  const stepY = Math.max(1, Math.floor(bounds.height / 16));

  for (let y = bounds.y; y < bounds.y + bounds.height; y += stepY) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += stepX) {
      const [r, g, b] = samplePixel(image, x, y);
      samples.push({ r, g, b });
    }
  }

  if (samples.length < 4) return 0;

  const meanR = samples.reduce((s, p) => s + p.r, 0) / samples.length;
  const meanG = samples.reduce((s, p) => s + p.g, 0) / samples.length;
  const meanB = samples.reduce((s, p) => s + p.b, 0) / samples.length;

  return samples.reduce((s, p) =>
    s + (p.r - meanR) ** 2 + (p.g - meanG) ** 2 + (p.b - meanB) ** 2, 0
  ) / samples.length;
}

function measureEdgeComplexity(image: ImageAsset, bounds: Bounds): number {
  let edgeCount = 0;
  let totalPairs = 0;
  const stepX = Math.max(1, Math.floor(bounds.width / 20));
  const stepY = Math.max(1, Math.floor(bounds.height / 20));
  const threshold = 30;

  for (let y = bounds.y; y < bounds.y + bounds.height - stepY; y += stepY) {
    for (let x = bounds.x; x < bounds.x + bounds.width - stepX; x += stepX) {
      const [r1, g1, b1] = samplePixel(image, x, y);
      const [r2, g2, b2] = samplePixel(image, x + stepX, y);
      const [r3, g3, b3] = samplePixel(image, x, y + stepY);

      const hDiff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      const vDiff = Math.abs(r1 - r3) + Math.abs(g1 - g3) + Math.abs(b1 - b3);

      if (hDiff > threshold) edgeCount++;
      if (vDiff > threshold) edgeCount++;
      totalPairs += 2;
    }
  }

  return totalPairs === 0 ? 0 : edgeCount / totalPairs;
}

function isMonotonicGradient(samples: Array<{ r: number; g: number; b: number }>): boolean {
  if (samples.length < 3) return true;

  // Check if luminance is generally monotonic (allowing small reversals)
  const luminances = samples.map((s) => 0.299 * s.r + 0.587 * s.g + 0.114 * s.b);
  let increasing = 0;
  let decreasing = 0;

  for (let i = 1; i < luminances.length; i++) {
    const diff = luminances[i]! - luminances[i - 1]!;
    if (diff > 2) increasing++;
    else if (diff < -2) decreasing++;
  }

  const total = increasing + decreasing;
  if (total === 0) return false;
  return increasing / total > 0.7 || decreasing / total > 0.7;
}
