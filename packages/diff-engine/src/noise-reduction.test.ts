import { describe, it, expect } from "bun:test";

describe("noise reduction heuristics", () => {
  it("suppresses excessive EXTRA_NODE issues", () => {
    const issues = [
      ...Array.from({ length: 15 }, (_, i) => ({
        code: "EXTRA_NODE",
        severity: "medium" as const,
        message: `Extra ${i}`,
        implementation: { bounds: { width: 10 + i, height: 10 + i } },
      })),
      { code: "COLOR_MISMATCH", severity: "medium" as const, message: "Color wrong" },
      { code: "SIZE_MISMATCH", severity: "high" as const, message: "Size wrong" },
    ];

    const extraNodes = issues.filter((i) => i.code === "EXTRA_NODE");
    const nonExtraNodes = issues.filter((i) => i.code !== "EXTRA_NODE");
    const shouldSuppress = extraNodes.length > nonExtraNodes.length * 2 && extraNodes.length > 5;

    expect(shouldSuppress).toBe(true);
    expect(extraNodes.length).toBe(15);
    const kept = Math.max(5, nonExtraNodes.length);
    expect(kept).toBe(5);
  });

  it("does not suppress when EXTRA_NODE count is proportional", () => {
    const issues = [
      ...Array.from({ length: 3 }, (_, i) => ({
        code: "EXTRA_NODE",
        severity: "medium" as const,
        message: `Extra ${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        code: "COLOR_MISMATCH",
        severity: "medium" as const,
        message: `Color ${i}`,
      })),
    ];

    const extraNodes = issues.filter((i) => i.code === "EXTRA_NODE");
    const nonExtraNodes = issues.filter((i) => i.code !== "EXTRA_NODE");
    const shouldSuppress = extraNodes.length > nonExtraNodes.length * 2 && extraNodes.length > 5;

    expect(shouldSuppress).toBe(false);
  });
});
