import type { ColorSwatch } from "@one-shot-ui/core";
import { rgbToHex, type ImageAsset } from "@one-shot-ui/image-io";

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

