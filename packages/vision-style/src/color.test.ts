import { describe, it, expect } from "bun:test";
import { rgbToHex, normalizeHex, hexToRgb } from "@one-shot-ui/image-io";
import { extractDominantColors, estimateNodeFill } from "../src/index.js";

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
