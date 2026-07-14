import { describe, it, expect } from "bun:test";
import { deltaE2000, rgbToLab, parseCssColor, colorDelta, type Lab } from "./color.js";

describe("deltaE2000 — canonical Sharma test vectors", () => {
  // From Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula".
  const cases: Array<[Lab, Lab, number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
  ];
  for (const [a, b, expected] of cases) {
    it(`ΔE00(${a}, ${b}) ≈ ${expected}`, () => {
      expect(deltaE2000(a, b)).toBeCloseTo(expected, 3);
    });
  }
  it("is zero for identical colors", () => {
    expect(deltaE2000([40, 10, -5], [40, 10, -5])).toBe(0);
  });
});

describe("rgbToLab", () => {
  it("maps white to L≈100, a≈0, b≈0", () => {
    const [L, a, b] = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(L).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });
  it("maps black to L≈0", () => {
    expect(rgbToLab({ r: 0, g: 0, b: 0 })[0]).toBeCloseTo(0, 3);
  });
});

describe("parseCssColor", () => {
  it("parses hex, rgb, and rgba", () => {
    expect(parseCssColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseCssColor("rgba(1,2,3,0.5)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseCssColor("#f80")).toEqual({ r: 255, g: 136, b: 0 });
  });
  it("returns null for junk", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

describe("colorDelta", () => {
  it("returns 0 for identical strings and Infinity for unparseable", () => {
    expect(colorDelta("#ffffff", "rgb(255,255,255)")).toBeCloseTo(0, 3);
    expect(colorDelta("#ffffff", "transparent")).toBe(Infinity);
  });
});
