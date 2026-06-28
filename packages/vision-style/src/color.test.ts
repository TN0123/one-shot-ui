import { describe, it, expect } from "bun:test";
import { rgbToHex, normalizeHex, hexToRgb, type ImageAsset } from "@one-shot-ui/image-io";
import { extractDominantColors, estimateNodeFill, extractAccentColors } from "../src/index.js";

/** Build a synthetic RGBA image filled with `bg`, with an optional rectangular patch. */
function makeImage(width: number, height: number, bg: [number, number, number], patch?: { x: number; y: number; w: number; h: number; color: [number, number, number] }): ImageAsset {
  const channels = 4;
  const data = new Uint8Array(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  if (patch) {
    for (let y = patch.y; y < patch.y + patch.h; y++) {
      for (let x = patch.x; x < patch.x + patch.w; x++) {
        const o = (y * width + x) * 4;
        data[o] = patch.color[0]; data[o + 1] = patch.color[1]; data[o + 2] = patch.color[2]; data[o + 3] = 255;
      }
    }
  }
  return { path: "synthetic", width, height, channels, data } as unknown as ImageAsset;
}

describe("color normalization", () => {
  it("clamps RGB values above 255", () => {
    expect(rgbToHex(300, 256, 260)).toBe("#FFFFFF");
  });

  it("clamps RGB values below 0", () => {
    expect(rgbToHex(-10, -1, -5)).toBe("#000000");
  });

  it("produces valid hex for near-white values", () => {
    const hex = rgbToHex(254, 255, 253);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("normalizeHex handles valid hex", () => {
    expect(normalizeHex("#FF00AA")).toBe("#FF00AA");
    expect(normalizeHex("ff00aa")).toBe("#FF00AA");
  });

  it("normalizeHex recovers from malformed hex", () => {
    const result = normalizeHex("#GG00ZZ");
    expect(result).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("hexToRgb handles malformed input defensively", () => {
    const rgb = hexToRgb("invalid");
    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.r).toBeLessThanOrEqual(255);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.g).toBeLessThanOrEqual(255);
  });

  it("hexToRgb roundtrips with rgbToHex", () => {
    const hex = rgbToHex(128, 64, 200);
    const rgb = hexToRgb(hex);
    expect(rgb).toEqual({ r: 128, g: 64, b: 200 });
  });
});

describe("extractAccentColors", () => {
  it("surfaces a small high-chroma accent that dominant-color extraction misses", () => {
    // A dark page (low saturation) with a small vivid violet patch (~4% of the area).
    const img = makeImage(100, 100, [32, 32, 36], { x: 0, y: 0, w: 20, h: 20, color: [167, 139, 250] });

    // Dominant extraction (area-weighted) returns the dark background, not the accent.
    expect(extractDominantColors(img, 1)[0]!.hex).toBe(rgbToHex(32, 32, 36));

    // Accent extraction finds the violet.
    const accents = extractAccentColors(img);
    expect(accents.length).toBeGreaterThan(0);
    expect(accents[0]!.hex).toBe(rgbToHex(167, 139, 250));
    // …and never returns the low-saturation surface.
    expect(accents.map((a) => a.hex)).not.toContain(rgbToHex(32, 32, 36));
  });

  it("returns nothing for a fully neutral image", () => {
    const img = makeImage(60, 60, [240, 240, 240]);
    expect(extractAccentColors(img)).toEqual([]);
  });
});
