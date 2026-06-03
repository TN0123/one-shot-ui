import { describe, it, expect } from "bun:test";
import { assessConvergence } from "./convergence.js";

describe("assessConvergence", () => {
  it("reports converged when structure, hierarchy and pixels are all good", () => {
    const a = assessConvergence({
      adjustedMismatch: 0.02,
      hierarchyScore: 85,
      refNodeCount: 50,
      builtNodeCount: 48,
      topRegionContribution: 0.3,
    });
    expect(a.status).toBe("converged");
    expect(a.reasons).toEqual([]);
    expect(a.completeness.nodeCoverage).toBeCloseTo(0.96, 2);
  });

  it("flags the real-session case (33% coverage, hierarchy 41, low pixel %) as not-converged", () => {
    const a = assessConvergence({
      adjustedMismatch: 0.035,
      hierarchyScore: 41,
      refNodeCount: 51,
      builtNodeCount: 17,
      topRegionContribution: 0.73,
    });
    expect(a.status).toBe("not-converged");
    expect(a.reasons.some((r) => /coverage/i.test(r))).toBe(true);
    expect(a.reasons.some((r) => /hierarchy/i.test(r))).toBe(true);
    expect(a.reasons.some((r) => /region/i.test(r))).toBe(true);
    expect(a.completeness.nodeCoverage).toBeCloseTo(0.333, 2);
  });

  it("flags high pixel mismatch even when structurally complete", () => {
    const a = assessConvergence({
      adjustedMismatch: 0.2,
      hierarchyScore: 80,
      refNodeCount: 40,
      builtNodeCount: 40,
      topRegionContribution: 0.2,
    });
    expect(a.status).toBe("not-converged");
    expect(a.reasons.some((r) => /pixel|mismatch/i.test(r))).toBe(true);
  });

  it("does not flag a dominant region when overall mismatch is already tiny", () => {
    const a = assessConvergence({
      adjustedMismatch: 0.01,
      hierarchyScore: 80,
      refNodeCount: 40,
      builtNodeCount: 40,
      topRegionContribution: 0.9,
    });
    expect(a.status).toBe("converged");
  });

  it("handles zero reference nodes without crashing (nodeCoverage null)", () => {
    const a = assessConvergence({
      adjustedMismatch: 0.01,
      hierarchyScore: 70,
      refNodeCount: 0,
      builtNodeCount: 0,
    });
    expect(a.completeness.nodeCoverage).toBeNull();
    expect(a.status).toBe("converged");
  });
});
