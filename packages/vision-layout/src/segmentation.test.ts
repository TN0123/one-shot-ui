import { describe, it, expect } from "bun:test";
import type { ImageAsset } from "@one-shot-ui/image-io";
import { detectDominantBackground, detectLayoutBoxes } from "./index.js";

/**
 * Build a synthetic RGBA ImageAsset from a painter callback that returns
 * [r,g,b] (alpha defaults to 255) for each pixel.
 */
function makeImage(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): ImageAsset {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return {
    path: "synthetic",
    width,
    height,
    channels: 4,
    trimmedBounds: null,
    data
  };
}

describe("detectDominantBackground", () => {
  it("returns the interior fill color, not an unrepresentative border/corner color", () => {
    // A dark page whose top strip (and therefore corners) is a lighter header.
    const width = 200;
    const height = 200;
    const img = makeImage(width, height, (_x, y) => {
      if (y < 24) return [161, 157, 238]; // purple header band (covers corners)
      return [26, 28, 38]; // dark page background dominates the frame
    });
    const bg = detectDominantBackground(img);
    // Should pick the dominant dark fill, not the purple header that the
    // old corner-only heuristic would have returned.
    expect(bg.b).toBeLessThan(80);
    expect(bg.r).toBeLessThan(80);
  });

  it("ignores solid padding that surrounds the real content", () => {
    // Simulates an auto-resized screenshot: dark UI padded with white on the
    // right and bottom. Corners are dominated by white padding, but the UI is dark.
    const width = 200;
    const height = 200;
    const contentW = 150;
    const contentH = 150;
    const img = makeImage(width, height, (x, y) => {
      if (x >= contentW || y >= contentH) return [255, 255, 255]; // white padding
      return [26, 28, 38]; // dark UI
    });
    const bg = detectDominantBackground(img);
    // Content (150x150 = 22500) outweighs padding, so dominant should be dark.
    expect(bg.r).toBeLessThan(80);
    expect(bg.g).toBeLessThan(80);
    expect(bg.b).toBeLessThan(80);
  });
});

describe("detectLayoutBoxes collapse resistance", () => {
  it("splits distinct boxes on a non-background-colored frame instead of flooding into one", () => {
    // A frame whose dominant fill is light gray, with two separated dark cards.
    // The old single-corner background could mis-read and flood; the dominant
    // background keeps the gray as background so the two cards segment apart.
    const width = 240;
    const height = 240;
    const img = makeImage(width, height, (x, y) => {
      const inCardA = x >= 24 && x < 96 && y >= 24 && y < 96;
      const inCardB = x >= 144 && x < 216 && y >= 144 && y < 216;
      if (inCardA || inCardB) return [20, 20, 20]; // dark cards
      return [245, 245, 247]; // light-gray page background (dominant)
    });
    const boxes = detectLayoutBoxes(img);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    // Neither box should span the whole frame.
    const wholeFrame = boxes.some((b: { bounds: { width: number; height: number } }) => b.bounds.width >= width * 0.9 && b.bounds.height >= height * 0.9);
    expect(wholeFrame).toBe(false);
  });
});
