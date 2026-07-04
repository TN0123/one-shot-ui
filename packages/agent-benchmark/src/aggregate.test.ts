import { describe, it, expect } from "bun:test";
import { statsByAgentTier, liftByAgent, type TierResult } from "./aggregate.js";

const R = (agentId: string, tier: 0 | 1 | 2, caseId: string, visualScore: number): TierResult => ({
  agentId, tier, caseId, cohort: "provable", visualScore, floor: 100,
});

describe("statsByAgentTier", () => {
  it("computes mean and median per agent+tier over the provable cohort", () => {
    const results = [R("a", 0, "c1", 80), R("a", 0, "c2", 90), R("a", 0, "c3", 70)];
    const stats = statsByAgentTier(results);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.mean).toBeCloseTo(80, 5);
    expect(stats[0]!.median).toBe(80);
    expect(stats[0]!.n).toBe(3);
  });
  it("excludes the unknown cohort by default", () => {
    const results: TierResult[] = [
      R("a", 0, "c1", 80),
      { ...R("a", 0, "c2", 10), cohort: "unknown" },
    ];
    expect(statsByAgentTier(results)[0]!.mean).toBe(80);
  });
});

describe("liftByAgent", () => {
  it("computes absolute lift and fraction of remaining gap closed", () => {
    const results = [R("a", 0, "c1", 60), R("a", 2, "c1", 90)];
    const [lift] = liftByAgent(results);
    expect(lift!.tier0).toBe(60);
    expect(lift!.tier2).toBe(90);
    expect(lift!.absoluteLift).toBe(30);
    expect(lift!.gapClosed).toBeCloseTo(0.75, 5); // (90-60)/(100-60)
  });
});
