import { describe, it, expect } from "bun:test";
import { generateHtmlScaffold, generateTailwindReactScaffold, cssToTailwindClass } from "./scaffold.js";
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

    // Should produce semantic elements from raw nodes (may be clustered)
    expect(result.html).toContain("data-node=");
    expect(result.html).toContain("n1");
    expect(result.css).toContain("display: flex");
    expect(result.css).toContain("#112233");
  });

  it("uses fallback when anchor coverage is below 85%", () => {
    // 10 nodes total, but only 1 is anchored
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode(`n${i}`, i * 50, 0, 40, 40)
    );
    const anchors = [
      makeAnchor("a1", "n0", "header", null, nodes[0]!.bounds)
    ];

    const result = generateHtmlScaffold(makePlan(), anchors, [], nodes, []);

    // Should fall back since only 1/10 nodes are anchored (10% < 85%)
    expect(result.css).toContain("Semantic scaffold from layout detection");
    expect(result.html).toContain("data-node=");
    expect(result.html).toContain("n0");
  });

  it("uses semantic fallback path for moderate anchor coverage (below 85%)", () => {
    // 5 nodes, 2 anchored = 40% coverage - should still use fallback
    const nodes = [
      makeNode("n1", 0, 0, 1000, 80),
      makeNode("n2", 0, 80, 1000, 200),
      makeNode("n3", 0, 280, 1000, 300),
      makeNode("n4", 0, 580, 1000, 200),
      makeNode("n5", 0, 780, 1000, 60),
    ];
    const anchors = [
      makeAnchor("a1", "n1", "header", null, nodes[0]!.bounds),
      makeAnchor("a2", "n2", "hero", null, nodes[1]!.bounds),
    ];

    const result = generateHtmlScaffold(makePlan(), anchors, [], nodes, []);
    // With 40% coverage (below 85% threshold), should use semantic fallback
    expect(result.css).toContain("Semantic scaffold from layout detection");
    expect(result.html).toContain("data-node=");
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

    // All nodes are anchored (100% > 85%), should use structured mode
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
    expect(result.css).not.toContain("Semantic scaffold from layout detection");
  });
});

describe("generateHtmlScaffold fallback", () => {
  const makeNode2 = (id: string, x: number, y: number, w: number, h: number, fill = "#FFFFFF") => ({
    id, bounds: { x, y, width: w, height: h }, fill,
    confidence: 0.8, gradient: null, borderRadius: null, shadow: null, componentId: null
  });

  const makeText = (id: string, text: string, x: number, y: number, w: number, h: number, fontSize = 16) => ({
    id, text, bounds: { x, y, width: w, height: h },
    typography: { fontSize, fontWeight: 400, lineHeight: fontSize * 1.2, fontFamilyCandidates: [] },
    confidence: 0.8
  });

  const emptyPlan = {
    page: { primaryStrategy: "flex" as const, notes: [] },
    nodes: [],
    cssPrimitives: [],
    repeatedPatterns: [],
    typography: { weak: true, confidence: 0, notes: ["no data"] }
  };

  it("produces semantic HTML tags instead of only absolute-positioned divs", () => {
    const nodes = [
      makeNode2("1", 0, 0, 1440, 80, "#1a1a1a"),
      makeNode2("2", 0, 80, 1440, 800, "#FFFFFF"),
      makeNode2("3", 0, 880, 1440, 60, "#333333"),
    ];

    const textBlocks = [
      makeText("t1", "My Website", 20, 20, 200, 40, 28),
      makeText("t2", "Welcome to the homepage", 100, 200, 400, 30, 20),
      makeText("t3", "Copyright 2026", 600, 895, 200, 20, 14),
    ];

    const result = generateHtmlScaffold(emptyPlan, [], [], nodes, textBlocks, "structured");

    // Should use semantic tags
    expect(result.html).toContain("<nav");
    expect(result.html).toContain("<main");
    expect(result.html).toContain("<footer");
    // Should contain OCR text
    expect(result.html).toContain("My Website");
    expect(result.html).toContain("Welcome to the homepage");
    expect(result.html).toContain("Copyright 2026");
    // Should use flexbox, not absolute positioning for the page container
    expect(result.css).toContain("display: flex");
    expect(result.css).toContain("flex-direction: column");
  });

  it("uses heading tags based on font size", () => {
    const nodes = [makeNode2("1", 0, 0, 800, 400, "#FFFFFF")];
    const textBlocks = [
      makeText("t1", "Big Title", 10, 10, 300, 50, 32),
      makeText("t2", "Subtitle", 10, 70, 200, 30, 22),
      makeText("t3", "Body text here", 10, 110, 400, 20, 16),
    ];

    const result = generateHtmlScaffold(emptyPlan, [], [], nodes, textBlocks, "structured");
    expect(result.html).toContain("<h1>Big Title</h1>");
    expect(result.html).toContain("<h2>Subtitle</h2>");
    expect(result.html).toContain("<p>Body text here</p>");
  });
});

describe("generateTailwindReactScaffold", () => {
  it("generates a React component with Tailwind classes", () => {
    const nodes = [
      makeNode("n1", 0, 0, 1440, 80, "#1a1a1a"),
      makeNode("n2", 0, 80, 1440, 800, "#FFFFFF"),
    ];
    const textBlocks: TextBlock[] = [{
      id: "t1", text: "Hello World", confidence: 0.9,
      bounds: { x: 10, y: 10, width: 100, height: 20 },
      typography: { fontSize: 32, fontWeight: 700, lineHeight: 40, letterSpacing: 0, confidence: 0.8 }
    }];

    const result = generateTailwindReactScaffold(makePlan(), [], [], nodes, textBlocks, []);

    expect(result.tsx).toContain("export default function Page()");
    expect(result.tsx).toContain("className=");
    expect(result.tsx).toContain("Hello World");
    expect(result.tsx).toContain("min-h-screen");
    expect(result.filePath).toBe("Page.tsx");
  });

  it("uses Tailwind color classes for fills", () => {
    const nodes = [makeNode("n1", 0, 0, 500, 200, "#FF5500")];
    const result = generateTailwindReactScaffold(makePlan(), [], [], nodes, [], []);

    expect(result.tsx).toContain("bg-[#ff5500]");
  });

  it("uses Tailwind border-radius classes", () => {
    const nodes: LayoutNode[] = [{
      id: "n1", kind: "region",
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      fill: "#AABBCC", gradient: null, borderRadius: 8,
      shadow: null, componentId: null, confidence: 0.8
    }];

    const result = generateTailwindReactScaffold(makePlan(), [], [], nodes, [], []);
    expect(result.tsx).toContain("rounded-lg");
  });

  it("generates layout classes for anchored content", () => {
    const nodes = [
      makeNode("n1", 0, 0, 1000, 80),
      makeNode("n2", 0, 80, 1000, 600),
    ];
    const anchors: SemanticAnchor[] = [
      { id: "a1", nodeId: "n1", name: "header", role: "header", parentId: null, bounds: nodes[0]!.bounds, confidence: 0.72 },
      { id: "a2", nodeId: "n2", name: "main", role: "main", parentId: null, bounds: nodes[1]!.bounds, confidence: 0.72 },
    ];

    const result = generateTailwindReactScaffold(makePlan(), anchors, [], nodes, [], []);

    expect(result.tsx).toContain("<header");
    expect(result.tsx).toContain("<main");
    expect(result.tsx).toContain("className=");
  });

  it("produces semantic tags in Tailwind fallback for typical pages", () => {
    const nodes = [
      makeNode("n1", 0, 0, 1440, 80, "#1a1a2e"),
      makeNode("n2", 0, 80, 1440, 700, "#ffffff"),
      makeNode("n3", 0, 780, 1440, 60, "#333333"),
    ];
    const result = generateTailwindReactScaffold(makePlan(), [], [], nodes, [], []);
    // Should contain semantic tags, not just divs
    expect(result.tsx).toMatch(/<(nav|header|main|section|footer)/);
  });

  it("outputs a single .tsx file path", () => {
    const result = generateTailwindReactScaffold(makePlan(), [], [], [], [], []);
    expect(result.filePath).toBe("Page.tsx");
    expect(result.tsx).toContain("import React");
  });
});

describe("cssToTailwindClass", () => {
  it("converts background-color", () => {
    expect(cssToTailwindClass("background-color", "#ff0000")).toBe("bg-[#ff0000]");
  });

  it("converts width in px", () => {
    expect(cssToTailwindClass("width", "200px")).toBe("w-[200px]");
  });

  it("converts border-radius", () => {
    expect(cssToTailwindClass("border-radius", "8px")).toBe("rounded-lg");
  });

  it("converts font-weight to named class", () => {
    expect(cssToTailwindClass("font-weight", "700")).toBe("font-bold");
    expect(cssToTailwindClass("font-weight", "500")).toBe("font-medium");
  });

  it("converts font-size", () => {
    expect(cssToTailwindClass("font-size", "16px")).toBe("text-[16px]");
  });

  it("converts box-shadow none", () => {
    expect(cssToTailwindClass("box-shadow", "none")).toBe("shadow-none");
  });
});
