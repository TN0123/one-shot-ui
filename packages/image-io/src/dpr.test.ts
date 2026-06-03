import { describe, it, expect } from "bun:test";
import { estimateDpr, resolveDpr, applyDpr, type DprSample } from "./dpr.js";

/** Build a vertically-striped grayscale image with the given stripe width (px). */
function striped(width: number, height: number, stripeW: number): DprSample {
  const channels = 4;
  const data = new Uint8ClampedArray(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = Math.floor(x / stripeW) % 2 === 0;
      const v = on ? 0 : 255;
      const o = (y * width + x) * channels;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { data, width, height, channels };
}

function flat(width: number, height: number): DprSample {
  const channels = 4;
  const data = new Uint8ClampedArray(width * height * channels).fill(200);
  for (let i = 3; i < data.length; i += channels) data[i] = 255;
  return { data, width, height, channels };
}

describe("estimateDpr", () => {
  it("estimates 1x for 1px-granular detail", () => {
    const e = estimateDpr(striped(400, 300, 1));
    expect(e.dpr).toBe(1);
    expect(e.confidence).toBeGreaterThan(0.7);
  });

  it("estimates 2x for 2px-granular detail on a large even canvas", () => {
    const e = estimateDpr(striped(1600, 1200, 2));
    expect(e.dpr).toBe(2);
    expect(e.confidence).toBeGreaterThan(0.7);
  });

  it("returns low confidence when there is not enough edge detail to tell", () => {
    const e = estimateDpr(flat(1600, 1200));
    expect(e.confidence).toBeLessThan(0.4);
  });
});

describe("resolveDpr", () => {
  it("uses an explicit dpr over any estimate", () => {
    const r = resolveDpr(2, { dpr: 1, confidence: 0.9, reason: "x" });
    expect(r.dpr).toBe(2);
    expect(r.source).toBe("explicit");
  });

  it("auto-applies a high-confidence 2x estimate", () => {
    const r = resolveDpr(undefined, { dpr: 2, confidence: 0.9, reason: "x" });
    expect(r.dpr).toBe(2);
    expect(r.source).toBe("auto");
  });

  it("defaults to dpr 1 (raw px) when the estimate is not confident, but hints Retina", () => {
    const r = resolveDpr(undefined, { dpr: 2, confidence: 0.5, reason: "maybe" });
    expect(r.dpr).toBe(1);
    expect(r.source).toBe("default");
    expect(r.scaleHint).toBeTruthy();
  });
});

describe("applyDpr", () => {
  it("divides a value by the dpr and rounds", () => {
    expect(applyDpr(70, 2)).toBe(35);
    expect(applyDpr(151, 2)).toBe(76);
    expect(applyDpr(70, 1)).toBe(70);
  });
});
