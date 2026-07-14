import { describe, it, expect } from "bun:test";
import { humanSeverityRank, sortFixesByHumanSeverity } from "./fix-priority.js";

describe("humanSeverityRank", () => {
  it("ranks missing content and overlap highest (0)", () => {
    expect(humanSeverityRank({ category: "structure" })).toBe(0);
    expect(humanSeverityRank({ issueCode: "MISSING_NODE" })).toBe(0);
    expect(humanSeverityRank({ category: "overlap" })).toBe(0);
  });
  it("ranks layout above color above typography", () => {
    expect(humanSeverityRank({ category: "layout" })).toBeLessThan(humanSeverityRank({ category: "color" }));
    expect(humanSeverityRank({ category: "color" })).toBeLessThan(humanSeverityRank({ category: "typography" }));
  });
});

describe("sortFixesByHumanSeverity", () => {
  it("floats missing content and overlap to the top, even below a high-priority color fix", () => {
    const fixes = [
      { category: "color", priority: "high", id: "color" },
      { category: "typography", priority: "high", id: "type" },
      { issueCode: "MISSING_NODE", category: "structure", priority: "medium", id: "missing" },
      { category: "layout", priority: "low", id: "layout" },
    ];
    const ordered = sortFixesByHumanSeverity(fixes).map((f) => (f as any).id);
    expect(ordered[0]).toBe("missing"); // content beats a high-priority color tweak
    expect(ordered[1]).toBe("layout"); // placement next
    expect(ordered.indexOf("color")).toBeLessThan(ordered.indexOf("type")); // color before typography
  });
  it("is stable within a severity tier (orders by tool priority)", () => {
    const fixes = [
      { category: "layout", priority: "low", id: "lo" },
      { category: "layout", priority: "high", id: "hi" },
    ];
    expect(sortFixesByHumanSeverity(fixes).map((f) => (f as any).id)).toEqual(["hi", "lo"]);
  });
  it("does not add or drop fixes", () => {
    const fixes = [{ category: "color" }, { category: "structure" }, { category: "size" }];
    expect(sortFixesByHumanSeverity(fixes).length).toBe(3);
  });
});
