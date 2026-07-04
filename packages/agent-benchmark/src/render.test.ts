import { describe, it, expect } from "bun:test";
import { renderLeaderboard } from "./render.js";
import type { AgentLift } from "./aggregate.js";

describe("renderLeaderboard", () => {
  it("emits a self-contained page with a row per agent and the lift columns", () => {
    const lifts: AgentLift[] = [
      { agentId: "claude-opus-4-8", tier0: 72, tier2: 94, absoluteLift: 22, gapClosed: 0.786 },
      { agentId: "gpt-5.4-mini", tier0: 61, tier2: 88, absoluteLift: 27, gapClosed: 0.692 },
    ];
    const html = renderLeaderboard(lifts, { caseCount: 30, generatedNote: "Design2Code / 30 cases" });
    expect(html.startsWith("<!doctype html")).toBe(true);
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("gpt-5.4-mini");
    expect(html).toContain("Lift");
    expect(html).toContain("30");
  });
});
