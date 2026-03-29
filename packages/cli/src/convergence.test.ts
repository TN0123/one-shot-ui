import { describe, it, expect } from "bun:test";

function buildConvergenceSummary(
  log: Array<{ phase: string; result?: { mismatchRatio?: number } }>,
  threshold: number
) {
  const comparePasses = log.filter((e) => e.phase === "compare" && e.result?.mismatchRatio != null);
  const ratios = comparePasses.map((e) => e.result!.mismatchRatio as number);

  if (ratios.length < 2) {
    return {
      trend: "insufficient-data" as const,
      improvementRate: 0,
      stalled: false,
      message: ratios.length === 0
        ? "No comparison data available."
        : `Only one pass completed. Mismatch: ${(ratios[0]! * 100).toFixed(2)}%.`,
    };
  }

  const firstRatio = ratios[0]!;
  const lastRatio = ratios[ratios.length - 1]!;
  const totalImprovement = firstRatio - lastRatio;
  const improvementRate = totalImprovement / firstRatio;
  const lastTwo = ratios.slice(-2);
  const stalled = Math.abs(lastTwo[0]! - lastTwo[1]!) < 0.005;

  const trend = lastRatio <= threshold
    ? "converged"
    : stalled
    ? "stalled"
    : totalImprovement > 0
    ? "improving"
    : "regressing";

  return { trend, improvementRate: Math.round(improvementRate * 100) / 100, stalled };
}

describe("buildConvergenceSummary", () => {
  it("detects convergence when below threshold", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.15 } },
      { phase: "compare", result: { mismatchRatio: 0.05 } },
      { phase: "compare", result: { mismatchRatio: 0.01 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("converged");
  });

  it("detects stalled progress", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.15 } },
      { phase: "compare", result: { mismatchRatio: 0.10 } },
      { phase: "compare", result: { mismatchRatio: 0.098 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("stalled");
    expect(result.stalled).toBe(true);
  });

  it("detects improving trend", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.30 } },
      { phase: "compare", result: { mismatchRatio: 0.20 } },
      { phase: "compare", result: { mismatchRatio: 0.10 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("improving");
    expect(result.improvementRate).toBeCloseTo(0.67, 1);
  });

  it("detects regression", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.05 } },
      { phase: "compare", result: { mismatchRatio: 0.08 } },
      { phase: "compare", result: { mismatchRatio: 0.12 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("regressing");
  });

  it("returns insufficient-data for single pass", () => {
    const log = [{ phase: "compare", result: { mismatchRatio: 0.15 } }];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("insufficient-data");
  });
});
