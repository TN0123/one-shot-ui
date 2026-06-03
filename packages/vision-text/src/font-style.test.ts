import { describe, it, expect } from "bun:test";
import { detectMonospace } from "./font-style.js";

/** Build a column-activity array from (inkWidth, gap) glyph cells. */
function cells(pairs: Array<[number, number]>): boolean[] {
  const out: boolean[] = [];
  for (const [ink, gap] of pairs) {
    for (let i = 0; i < ink; i++) out.push(true);
    for (let i = 0; i < gap; i++) out.push(false);
  }
  return out;
}

describe("detectMonospace", () => {
  it("detects monospace when glyph pitch is uniform", () => {
    // 8 glyphs, every cell ink=6 gap=4 → pitch 10, zero variance.
    const activity = cells(Array.from({ length: 8 }, () => [6, 4] as [number, number]));
    const r = detectMonospace(activity);
    expect(r.monospace).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it("rejects monospace when glyph pitch varies (proportional)", () => {
    // Widely varying glyph pitches (12,5,17,6,17,6) — typical of a proportional face.
    const activity = cells([
      [10, 2],
      [3, 2],
      [14, 3],
      [4, 2],
      [9, 8],
      [3, 3],
      [12, 2],
    ]);
    const r = detectMonospace(activity);
    expect(r.monospace).toBe(false);
  });

  it("does not claim monospace with too few glyphs", () => {
    const activity = cells([
      [6, 4],
      [6, 4],
    ]);
    const r = detectMonospace(activity);
    expect(r.monospace).toBe(false);
    expect(r.confidence).toBeLessThan(0.5);
  });
});
