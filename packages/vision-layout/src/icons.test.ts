import { describe, it, expect } from "bun:test";
import type { ImageAsset } from "@one-shot-ui/image-io";
import { detectIconCandidates } from "./icons.js";

function makeImage(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): ImageAsset {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { path: "synthetic", width, height, channels: 4, trimmedBounds: null, data };
}

describe("detectIconCandidates", () => {
  it("flags a small glyph-sized region but not a large avatar block", () => {
    const img = makeImage(220, 220, (x, y) => {
      // A 20x20 hollow square outline (line-art icon) at (40,40).
      const onIconBorder =
        x >= 40 && x < 60 && y >= 40 && y < 60 &&
        (x < 42 || x >= 58 || y < 42 || y >= 58);
      if (onIconBorder) return [20, 20, 20];
      // A large 80x80 filled avatar block at (110,110) — too big to be an icon.
      if (x >= 110 && x < 190 && y >= 110 && y < 190) return [60, 120, 60];
      return [250, 250, 250];
    });
    const icons = detectIconCandidates(img);
    expect(icons.length).toBe(1);
    expect(Math.abs(icons[0]!.bounds.x - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(icons[0]!.bounds.width - 20)).toBeLessThanOrEqual(2);
  });

  it("excludes regions that overlap provided text bounds (letters are not icons)", () => {
    const img = makeImage(220, 220, (x, y) => {
      // A glyph-sized hollow square (line-art) sitting inside a text run.
      const onBorder =
        x >= 30 && x < 48 && y >= 100 && y < 118 &&
        (x < 32 || x >= 46 || y < 102 || y >= 116);
      if (onBorder) return [20, 20, 20];
      return [250, 250, 250];
    });
    const withoutMask = detectIconCandidates(img);
    expect(withoutMask.length).toBe(1);
    const withMask = detectIconCandidates(img, {
      textBounds: [{ x: 20, y: 96, width: 120, height: 26 }]
    });
    expect(withMask.length).toBe(0);
  });
});
