import { describe, it, expect } from "bun:test";
import type { ImageAsset } from "@one-shot-ui/image-io";
import { measureRulers } from "./rulers.js";

/** Build a synthetic RGBA ImageAsset from a painter callback returning [r,g,b]. */
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
  return { path: "synthetic", width, height, channels: 4, trimmedBounds: null, data };
}

describe("measureRulers — horizontal bands (background zones)", () => {
  it("detects a distinct top chrome band and the page body as separate bands", () => {
    const width = 200;
    const height = 200;
    const headerEnd = 30;
    const img = makeImage(width, height, (x, y) => {
      if (y < headerEnd) return [8, 10, 16]; // dark top chrome strip
      // light page body with a small content box that does not fill the row
      if (x >= 40 && x < 90 && y >= 60 && y < 100) return [40, 40, 40];
      return [245, 245, 247];
    });
    const r = measureRulers(img);
    // A band starting at y=0 should end near the header boundary and read dark.
    const top = r.bands.find(b => b.start === 0);
    expect(top).toBeDefined();
    expect(Math.abs(top!.end - headerEnd)).toBeLessThanOrEqual(3);
    const { r: tr, g: tg, b: tb } = hex(top!.background);
    expect(tr).toBeLessThan(80);
    expect(tg).toBeLessThan(80);
    expect(tb).toBeLessThan(80);
    // A body band should exist that is light and tall.
    const body = r.bands.find(b => b.start >= headerEnd - 3 && b.size > 100);
    expect(body).toBeDefined();
    expect(hex(body!.background).r).toBeGreaterThan(200);
  });

  it("merges same-background bands so one page zone is not split into many", () => {
    // Dark header, then a light body interrupted by a 2px stripe (an absorbed
    // anti-aliased edge). The two light halves must collapse into ONE body band.
    const width = 200;
    const height = 200;
    const img = makeImage(width, height, (_x, y) => {
      if (y < 30) return [8, 10, 16]; // header
      if (y >= 90 && y < 92) return [120, 120, 120]; // 2px stray edge
      return [244, 245, 247]; // light body (both halves identical)
    });
    const r = measureRulers(img);
    expect(r.bands.length).toBe(2);
    expect(r.bands[1]!.start).toBeLessThanOrEqual(33);
    expect(r.bands[1]!.end).toBe(200);
  });

  it("returns a single band for a uniform image (no phantom bands)", () => {
    const img = makeImage(120, 120, () => [13, 17, 23]);
    const r = measureRulers(img);
    expect(r.bands.length).toBe(1);
    expect(r.bands[0]!.start).toBe(0);
    expect(r.bands[0]!.end).toBe(120);
  });
});

describe("measureRulers — vertical columns and gutters", () => {
  it("detects two content columns separated by a gutter, with the gutter width measured", () => {
    const width = 240;
    const height = 160;
    // Two ink columns on a light page: A x[20,90), gutter x[90,140), B x[140,210)
    const img = makeImage(width, height, (x, y) => {
      const inA = x >= 20 && x < 90 && y >= 20 && y < 140;
      const inB = x >= 140 && x < 210 && y >= 20 && y < 140;
      if (inA || inB) return [30, 30, 30];
      return [250, 250, 250];
    });
    const r = measureRulers(img);
    expect(r.columns.length).toBe(2);
    // First column ~[20,90), second ~[140,210)
    expect(Math.abs(r.columns[0]!.start - 20)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.columns[0]!.end - 90)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.columns[1]!.start - 140)).toBeLessThanOrEqual(3);
    // Exactly one interior gutter, ~50px wide between the columns.
    expect(r.gutters.length).toBe(1);
    expect(Math.abs(r.gutters[0]!.size - 50)).toBeLessThanOrEqual(4);
  });
});

function hex(h: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw new Error(`bad hex ${h}`);
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}
