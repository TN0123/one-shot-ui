import { describe, it, expect } from "bun:test";
import { generateHtmlScaffold } from "./scaffold.js";
import type { ImplementationPlan, SemanticAnchor, DesignToken, LayoutNode, TextBlock } from "./index.js";

function makePlan(overrides?: Partial<ImplementationPlan>): ImplementationPlan {
  return {
    page: { primaryStrategy: "flex", notes: [] },
    nodes: [],
    repeatedPatterns: [],
    cssPrimitives: [],
    typography: { confidence: 0.5, weak: false, notes: [] },
    ...overrides
  };
}

function makeNode(id: string, x: number, y: number, w: number, h: number, fill: string | null = "#FF0000"): LayoutNode {
  return {
    id, kind: "region", bounds: { x, y, width: w, height: h },
    fill, gradient: null, borderRadius: 0, shadow: null,
    componentId: null, confidence: 0.8
  };
}

function makeAnchor(id: string, nodeId: string | null, name: string, parentId: string | null, bounds: { x: number; y: number; width: number; height: number }): SemanticAnchor {
  return { id, nodeId, name, role: "section", parentId, bounds, confidence: 0.72 };
}

describe("scaffold fallback", () => {
  it("uses fallback when no anchors are provided", () => {
    const nodes = [
      makeNode("n1", 0, 0, 200, 100, "#112233"),
      makeNode("n2", 0, 120, 200, 80, "#445566")
    ];
    const result = generateHtmlScaffold(makePlan(), [], [], nodes, []);

    // Should produce absolute-positioned divs from raw nodes
    expect(result.html).toContain("node-n1");
    expect(result.html).toContain("node-n2");
    expect(result.css).toContain("position: absolute");
    expect(result.css).toContain("#112233");
    expect(result.css).toContain("#445566");
  });

  it("uses fallback when anchor coverage is below 35%", () => {
    // 10 nodes total, but only 1 is anchored
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode(`n${i}`, i * 50, 0, 40, 40)
    );
    const anchors = [
      makeAnchor("a1", "n0", "header", null, nodes[0]!.bounds)
    ];

    const result = generateHtmlScaffold(makePlan(), anchors, [], nodes, []);

    // Should fall back since only 1/10 nodes are anchored (10% < 35%)
    expect(result.css).toContain("Fallback scaffold");
    expect(result.html).toContain("node-n0");
    expect(result.html).toContain("node-n5");
  });

  it("uses structured scaffold when anchor coverage is sufficient", () => {
    const nodes = [
      makeNode("n1", 0, 0, 1000, 80),
      makeNode("n2", 0, 80, 1000, 600)
    ];
    const anchors = [
      makeAnchor("a1", "n1", "header", null, nodes[0]!.bounds),
      makeAnchor("a2", "n2", "main", null, nodes[1]!.bounds)
    ];

    const result = generateHtmlScaffold(makePlan(), anchors, [], nodes, []);

    // All nodes are anchored (100% > 35%), should use structured mode
    expect(result.css).not.toContain("Fallback scaffold");
    expect(result.html).toContain('data-anchor="header"');
    expect(result.html).toContain('data-anchor="main"');
  });

  it("fallback includes text content from text blocks", () => {
    const nodes = [makeNode("n1", 0, 0, 400, 200)];
    const textBlocks: TextBlock[] = [{
      id: "t1", text: "Hello World", confidence: 0.9,
      bounds: { x: 10, y: 10, width: 100, height: 20 },
      typography: { fontSize: 32, fontWeight: 700, lineHeight: 40, letterSpacing: 0, confidence: 0.8 }
    }];

    const result = generateHtmlScaffold(makePlan(), [], [], nodes, textBlocks);

    expect(result.html).toContain("Hello World");
    expect(result.html).toContain("<h1>");
  });

  it("fallback preserves border-radius and shadow", () => {
    const nodes: LayoutNode[] = [{
      id: "n1", kind: "region",
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      fill: "#AABBCC", gradient: null, borderRadius: 12,
      shadow: { xOffset: 0, yOffset: 4, blurRadius: 8, spread: 0, color: "rgba(0,0,0,0.2)", confidence: 0.7 },
      componentId: null, confidence: 0.8
    }];

    const result = generateHtmlScaffold(makePlan(), [], [], nodes, []);

    expect(result.css).toContain("border-radius: 12px");
    expect(result.css).toContain("box-shadow:");
  });

  it("does not use fallback when nodes array is empty", () => {
    const result = generateHtmlScaffold(makePlan(), [], [], [], []);

    // No nodes, no fallback — just empty page
    expect(result.css).not.toContain("Fallback scaffold");
  });
});
