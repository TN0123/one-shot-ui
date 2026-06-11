import { describe, it, expect } from "bun:test";
import { bestOffset } from "./offset.js";

function image(w: number, h: number, bg: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}

function drawRect(d: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const off = (y * w + x) * 4;
      d[off] = rgb[0];
      d[off + 1] = rgb[1];
      d[off + 2] = rgb[2];
    }
  }
}

describe("bestOffset", () => {
  it("finds the translation that aligns a shifted block", () => {
    const W = 100, H = 100;
    const ref = image(W, H, [20, 20, 25]);
    const shot = image(W, H, [20, 20, 25]);
    drawRect(ref, W, 20, 30, 30, 20, [230, 230, 235]);
    drawRect(shot, W, 28, 38, 30, 20, [230, 230, 235]); // build is +8,+8 off

    const r = bestOffset(ref, shot, W, H, { x: 10, y: 20, width: 70, height: 60 }, { range: 12, step: 2 });
    expect(r).not.toBeNull();
    expect(r!.dx).toBe(-8);
    expect(r!.dy).toBe(-8);
    expect(r!.improvement).toBeGreaterThan(0.05);
  });

  it("returns zero offset for aligned content", () => {
    const W = 60, H = 60;
    const ref = image(W, H, [20, 20, 25]);
    const shot = image(W, H, [20, 20, 25]);
    drawRect(ref, W, 10, 10, 20, 20, [200, 200, 200]);
    drawRect(shot, W, 10, 10, 20, 20, [200, 200, 200]);
    const r = bestOffset(ref, shot, W, H, { x: 0, y: 0, width: 60, height: 60 }, { range: 8, step: 2 });
    expect(r === null || (r.dx === 0 && r.dy === 0) || r.improvement < 0.02).toBe(true);
  });
});
