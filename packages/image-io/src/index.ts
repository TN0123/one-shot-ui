import sharp from "sharp";
import type { Bounds, ImageMeta } from "@one-shot-ui/core";

export type ImageAsset = ImageMeta & {
  data: Uint8ClampedArray;
};

export async function loadImage(imagePath: string): Promise<ImageAsset> {
  const instance = sharp(imagePath, { failOn: "none" }).ensureAlpha();
  const metadata = await instance.metadata();

  if (!metadata.width || !metadata.height || !metadata.channels) {
    throw new Error(`Unable to read image metadata for ${imagePath}`);
  }

  const { data, info } = await instance.raw().toBuffer({ resolveWithObject: true });
  const trimmedBounds = detectTrimmedBounds(data, info.width, info.height, info.channels);

  return {
    path: imagePath,
    width: info.width,
    height: info.height,
    channels: info.channels,
    trimmedBounds,
    data: new Uint8ClampedArray(data)
  };
}

export function samplePixel(image: ImageAsset, x: number, y: number): [number, number, number, number] {
  const clampedX = Math.max(0, Math.min(image.width - 1, x));
  const clampedY = Math.max(0, Math.min(image.height - 1, y));
  const offset = (clampedY * image.width + clampedX) * image.channels;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 255
  ];
}

export function detectBackgroundColor(image: ImageAsset): string {
  const corners = [
    samplePixel(image, 0, 0),
    samplePixel(image, image.width - 1, 0),
    samplePixel(image, 0, image.height - 1),
    samplePixel(image, image.width - 1, image.height - 1)
  ];

  const avg = corners.reduce(
    (acc, pixel) => {
      acc[0] += pixel[0];
      acc[1] += pixel[1];
      acc[2] += pixel[2];
      return acc;
    },
    [0, 0, 0]
  );

  return rgbToHex(
    Math.round(avg[0] / corners.length),
    Math.round(avg[1] / corners.length),
    Math.round(avg[2] / corners.length)
  );
}

export function calculateActivePixelRatio(image: ImageAsset, tolerance = 18): number {
  const background = hexToRgb(detectBackgroundColor(image));
  let active = 0;

  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const [r, g, b, a] = samplePixel(image, x, y);
      if (a < 8 || colorDistance(r, g, b, background.r, background.g, background.b) > tolerance) {
        active += 1;
      }
    }
  }

  const sampledPixels = Math.ceil(image.width / 2) * Math.ceil(image.height / 2);
  return sampledPixels === 0 ? 0 : active / sampledPixels;
}

function detectTrimmedBounds(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  tolerance = 18
): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const [bgR, bgG, bgB] = [data[0] ?? 255, data[1] ?? 255, data[2] ?? 255];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const a = data[offset + 3] ?? 255;
      if (a < 8) {
        continue;
      }
      if (colorDistance(r, g, b, bgR, bgG, bgB) <= tolerance) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => clampChannel(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: clampChannel(Number.parseInt(normalized.slice(0, 2), 16) || 0),
    g: clampChannel(Number.parseInt(normalized.slice(2, 4), 16) || 0),
    b: clampChannel(Number.parseInt(normalized.slice(4, 6), 16) || 0)
  };
}

export function normalizeHex(hex: string): string {
  const match = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    // Attempt recovery: clamp any rgb-like hex
    const raw = hex.replace("#", "").slice(0, 6).padEnd(6, "0");
    const r = clampChannel(Number.parseInt(raw.slice(0, 2), 16) || 0);
    const g = clampChannel(Number.parseInt(raw.slice(2, 4), 16) || 0);
    const b = clampChannel(Number.parseInt(raw.slice(4, 6), 16) || 0);
    return rgbToHex(r, g, b);
  }
  return `#${match[1]!.toUpperCase()}`;
}

export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
