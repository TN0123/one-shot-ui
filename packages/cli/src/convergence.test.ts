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

  // Plateau: last 3+ passes within 0.5%
  const plateau = ratios.length >= 3 && (() => {
    const recent = ratios.slice(-3);
    return (Math.max(...recent) - Math.min(...recent)) < 0.005;
  })();

  // Oscillation: alternating up/down in last 3 passes
  const oscillating = ratios.length >= 3 && (() => {
    const r = ratios.slice(-3);
    return (r[1]! > r[0]! && r[1]! > r[2]!) || (r[1]! < r[0]! && r[1]! < r[2]!);
  })();

  const trend = lastRatio <= threshold
    ? "converged"
    : oscillating
    ? "oscillating"
    : plateau
    ? "plateau"
    : stalled
    ? "stalled"
    : totalImprovement > 0
    ? "improving"
    : "regressing";

  return { trend, improvementRate: Math.round(improvementRate * 100) / 100, stalled, plateau, oscillating };
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

describe("plateau detection", () => {
  it("detects plateau when last 3 passes improve < 0.5%", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.15 } },
      { phase: "compare", result: { mismatchRatio: 0.082 } },
      { phase: "compare", result: { mismatchRatio: 0.081 } },
      { phase: "compare", result: { mismatchRatio: 0.0805 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.trend).toBe("plateau");
    expect(result.plateau).toBe(true);
  });
});

describe("oscillation detection", () => {
  it("detects oscillation when mismatch alternates up/down", () => {
    const log = [
      { phase: "compare", result: { mismatchRatio: 0.10 } },
      { phase: "compare", result: { mismatchRatio: 0.055 } },
      { phase: "compare", result: { mismatchRatio: 0.056 } },
      { phase: "compare", result: { mismatchRatio: 0.054 } },
      { phase: "compare", result: { mismatchRatio: 0.056 } },
    ];
    const result = buildConvergenceSummary(log, 0.02);
    expect(result.oscillating).toBe(true);
  });
});
