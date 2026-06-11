import { describe, it, expect } from "bun:test";
import { dominantColor } from "./sample.js";

function solidImage(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("dominantColor", () => {
  it("returns the exact solid color of a region", () => {
    const img = solidImage(10, 10, [28, 29, 38]);
    expect(dominantColor(img, 10, 10, 4, { x: 0, y: 0, width: 10, height: 10 })).toBe("#1C1D26");
  });

  it("returns the majority color when text ink overlays a surface", () => {
    const img = solidImage(20, 10, [28, 29, 38]);
    // simulate ink on ~20% of pixels
    for (let i = 0; i < 40; i++) {
      img[i * 4] = 228;
      img[i * 4 + 1] = 228;
      img[i * 4 + 2] = 231;
    }
    expect(dominantColor(img, 20, 10, 4, { x: 0, y: 0, width: 20, height: 10 })).toBe("#1C1D26");
  });

  it("returns null for empty bounds", () => {
    const img = solidImage(4, 4, [0, 0, 0]);
    expect(dominantColor(img, 4, 4, 4, { x: 10, y: 10, width: 5, height: 5 })).toBeNull();
  });

  it("averages within the dominant quantization bucket (exact hex, not quantized)", () => {
    const img = solidImage(10, 10, [34, 35, 46]);
    expect(dominantColor(img, 10, 10, 4, { x: 0, y: 0, width: 10, height: 10 })).toBe("#22232E");
  });
});
