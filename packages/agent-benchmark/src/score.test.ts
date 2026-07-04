import { describe, it, expect } from "bun:test";
import { scoreCompareReport } from "./score.js";

describe("scoreCompareReport", () => {
  it("computes visualScore from mismatchRatio and clamps to 0-100", () => {
    const s = scoreCompareReport({ summary: { mismatchRatio: 0.1 }, issues: [] });
    expect(s.visualScore).toBeCloseTo(90, 5);
    expect(s.mismatchRatio).toBe(0.1);
  });
  it("buckets issues by category, splitting layout into position vs size", () => {
    const s = scoreCompareReport({
      summary: { mismatchRatio: 0.05 },
      issues: [
        { category: "color" },
        { category: "typography" },
        { category: "content" },
        { category: "layout", deltaX: 12, deltaY: 3, deltaWidth: 0, deltaHeight: 0 }, // position
        { category: "layout", deltaX: 0, deltaY: 0, deltaWidth: 40, deltaHeight: 8 }, // size
      ],
    });
    expect(s.scorecard).toEqual({ color: 1, typography: 1, content: 1, position: 1, size: 1 });
  });
  it("treats a category-less layout issue as position by default", () => {
    const s = scoreCompareReport({ summary: { mismatchRatio: 0 }, issues: [{}] });
    expect(s.scorecard.position).toBe(1);
    expect(s.visualScore).toBe(100);
  });
});
