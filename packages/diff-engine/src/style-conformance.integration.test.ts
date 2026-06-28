import { describe, it, expect } from "bun:test";
import { buildStyleSystem, aggregateComputedStyles } from "@one-shot-ui/core/style-system";
import type { ColorSwatch, DomElement, ExtractReport, LayoutNode, SpacingMeasurement, TextBlock } from "@one-shot-ui/core";
import { compareStyleSystems } from "./style-conformance.js";

/**
 * End-to-end (browser-free): extract a style system from a screenshot-shaped report,
 * aggregate a new UI from a DOM tree, and check conformance — the real pipeline minus
 * Playwright. The live-browser path is exercised by the CLI smoke tests.
 */

function swatch(hex: string, population: number): ColorSwatch {
  const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return { hex, rgb, population, ratio: 0.1 };
}
function spacing(distance: number, i: number): SpacingMeasurement {
  return { id: `s${i}`, fromId: "a", toId: "b", axis: "horizontal", distance, alignment: "start" };
}
function region(id: string, borderRadius: number | null): LayoutNode {
  return { id, kind: "region", bounds: { x: 0, y: 0, width: 10, height: 10 }, fill: "#FFFFFF", borderRadius, componentId: null, confidence: 1 };
}
function textBlock(id: string, fontSize: number): TextBlock {
  return { id, text: "x", confidence: 1, bounds: { x: 0, y: 0, width: 10, height: 10 }, typography: { fontSize, fontWeight: 400, lineHeight: null, letterSpacing: null, confidence: 1 } };
}
function el(style: Record<string, string>, children: DomElement[] = []): DomElement {
  return { selector: "div", tagName: "div", bounds: { x: 0, y: 0, width: 10, height: 10 }, computedStyle: style, children };
}

// A dark blue dashboard, 8px grid, ~1.43 type ratio.
const referenceReport: ExtractReport = {
  version: "t",
  image: { path: "ref.png", width: 1280, height: 800, channels: 4, trimmedBounds: null },
  colors: [swatch("#0F1117", 500), swatch("#FFFFFF", 120), swatch("#3B82F6", 200)],
  layout: [region("r1", 8), region("r2", 8)],
  text: [textBlock("t1", 14), textBlock("t2", 14), textBlock("t3", 20)],
  spacing: [8, 16, 24, 32, 8, 16].map(spacing),
  components: [],
  diagnostics: { background: "#0F1117", activePixelRatio: 0.5 },
};

describe("style conformance — end to end", () => {
  const refSystem = buildStyleSystem(referenceReport, { source: "screenshot" });

  it("passes a faithful new UI built in the same design language", () => {
    const tree: DomElement[] = [
      el({ "background-color": "rgb(15, 17, 23)", "gap": "16px", "border-radius": "8px" }, [
        el({ "background-color": "rgb(59, 130, 246)", "gap": "8px", "padding-top": "24px" }),
        el({ "color": "rgb(255, 255, 255)", "font-size": "14px", "font-weight": "400", "font-family": "Inter" }),
        el({ "color": "rgb(255, 255, 255)", "font-size": "20px", "font-weight": "600", "font-family": "Inter" }),
      ]),
    ];
    const report = compareStyleSystems(refSystem, aggregateComputedStyles(tree));
    expect(report.conforms).toBe(true);
    const highDrift = report.dimensions.filter((d) => d.confidence === "high" && d.verdict === "drift");
    expect(highDrift).toEqual([]);
  });

  it("flags a UI that drifts in palette and spacing rhythm", () => {
    const tree: DomElement[] = [
      el({ "background-color": "rgb(232, 81, 58)", "gap": "15px", "padding-top": "25px" }, [ // orange, 5px grid
        el({ "background-color": "rgb(232, 81, 58)", "gap": "5px", "padding-left": "10px" }),
        el({ "color": "rgb(120, 120, 120)", "font-size": "14px", "font-weight": "400" }),
      ]),
    ];
    const report = compareStyleSystems(refSystem, aggregateComputedStyles(tree));
    expect(report.conforms).toBe(false);
    expect(report.dimensions.find((d) => d.name === "palette")!.verdict).toBe("drift");
    expect(report.dimensions.find((d) => d.name === "spacing")!.verdict).toBe("drift");
  });
});
