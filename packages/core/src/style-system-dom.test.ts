import { describe, it, expect } from "bun:test";
import { aggregateComputedStyles } from "./style-system.js";
import type { DomElement } from "./index.js";

function el(tagName: string, style: Record<string, string>, children: DomElement[] = []): DomElement {
  return { selector: tagName, tagName, bounds: { x: 0, y: 0, width: 10, height: 10 }, computedStyle: style, children };
}

describe("aggregateComputedStyles", () => {
  it("builds a dom-sourced style system from computed CSS", () => {
    const tree: DomElement[] = [
      el("div", {
        "background-color": "rgb(59, 130, 246)",
        "border-radius": "8px",
        "box-shadow": "rgba(0, 0, 0, 0.1) 0px 2px 4px 0px",
        "gap": "16px",
      }, [
        el("p", { "color": "rgb(17, 17, 17)", "font-size": "16px", "font-weight": "700", "font-family": "Inter, sans-serif" }),
        el("span", { "color": "rgb(17, 17, 17)", "font-size": "24px", "font-weight": "400", "font-family": "Inter, sans-serif" }),
      ]),
    ];
    const sys = aggregateComputedStyles(tree);

    expect(sys.source).toBe("dom");
    expect(sys.colors.accents.map((c) => c.hex)).toContain("#3B82F6");
    expect(sys.colors.neutrals.map((c) => c.hex)).toContain("#111111");
    expect(sys.radius.scale.map((r) => r.value)).toContain(8);
    expect(sys.elevation.tiers[0]!.shadow).toContain("4px");
    expect(sys.typography.sizes).toContain(16);
    expect(sys.typography.sizes).toContain(24);
    expect(sys.spacing.scale).toContain(16);
    expect(sys.typography.families[0]!.family).toBe("Inter");
  });

  it("skips fully transparent colors", () => {
    const tree = [el("div", { "background-color": "rgba(0, 0, 0, 0)" })];
    const sys = aggregateComputedStyles(tree);
    expect(sys.colors.neutrals.length + sys.colors.accents.length).toBe(0);
  });

  it("skips low-alpha decorative tints (a faint ghost overlay isn't a real surface color)", () => {
    const tree = [el("div", { "background-color": "rgba(167, 139, 250, 0.1)" })];
    const sys = aggregateComputedStyles(tree);
    expect(sys.colors.neutrals.length + sys.colors.accents.length).toBe(0);
  });

  it("weights DOM colors by element area, so many tiny glyphs can't outweigh the page background", () => {
    const bg = el("div", { "background-color": "rgb(15, 17, 23)" });
    bg.bounds = { x: 0, y: 0, width: 1000, height: 1000 };
    const checks = Array.from({ length: 13 }, () => {
      const e = el("span", { color: "rgb(167, 139, 250)" });
      e.bounds = { x: 0, y: 0, width: 10, height: 10 };
      return e;
    });
    const sys = aggregateComputedStyles([bg, ...checks]);
    const all = [...sys.colors.neutrals, ...sys.colors.accents];
    const bgSwatch = all.find((c) => c.hex === "#0F1117")!;
    const violet = all.find((c) => c.hex === "#A78BFA")!;
    expect(bgSwatch.count).toBeGreaterThan(violet.count);
  });

  it("maps named font weights and detects monospace", () => {
    const tree = [el("code", { "font-size": "13px", "font-weight": "bold", "font-family": "ui-monospace, monospace" })];
    const sys = aggregateComputedStyles(tree);
    expect(sys.typography.weights).toContain(700);
    expect(sys.typography.monospace).toBe(true);
  });
});
