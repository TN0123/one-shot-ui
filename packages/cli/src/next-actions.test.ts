import { describe, it, expect } from "bun:test";

describe("next-actions edit grouping", () => {
  it("groups issues by CSS selector", () => {
    const issues = [
      {
        code: "POSITION_MISMATCH",
        cssSelector: ".header",
        anchorName: "header",
        severity: "high",
        message: "offset",
        reference: { x: 0, y: 0 },
        implementation: { x: 10, y: 5 },
      },
      {
        code: "COLOR_MISMATCH",
        cssSelector: ".header",
        anchorName: "header",
        severity: "medium",
        message: "color wrong",
        reference: { fill: "#FF0000" },
        implementation: { fill: "#00FF00" },
      },
    ];

    const editMap = new Map<string, { selector: string; properties: Record<string, string>; reasons: string[] }>();
    for (const issue of issues) {
      const selector = issue.cssSelector;
      const existing = editMap.get(selector);
      const props: Record<string, string> = {};
      if (issue.code === "POSITION_MISMATCH") {
        props["left"] = `${(issue.implementation as any).x}px -> ${(issue.reference as any).x}px`;
        props["top"] = `${(issue.implementation as any).y}px -> ${(issue.reference as any).y}px`;
      }
      if (issue.code === "COLOR_MISMATCH") {
        props["background-color"] = `${(issue.implementation as any).fill} -> ${(issue.reference as any).fill}`;
      }
      if (existing) {
        Object.assign(existing.properties, props);
        existing.reasons.push(issue.message);
      } else {
        editMap.set(selector, { selector, properties: props, reasons: [issue.message] });
      }
    }

    const edits = [...editMap.values()];
    expect(edits.length).toBe(1);
    expect(edits[0]!.properties).toHaveProperty("left");
    expect(edits[0]!.properties).toHaveProperty("background-color");
    expect(edits[0]!.reasons.length).toBe(2);
  });
});
