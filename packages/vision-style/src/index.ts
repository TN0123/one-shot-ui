import type { Bounds, ColorSwatch } from "@one-shot-ui/core";
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
