import { describe, it, expect } from "bun:test";
import { buildStyleSystem } from "./style-system.js";
import type { ColorSwatch, ExtractReport, LayoutNode, SpacingMeasurement, TextBlock } from "./index.js";

function swatch(hex: string, population = 100): ColorSwatch {
  const rgb = {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
  return { hex, rgb, population, ratio: 0.1 };
}

function spacing(distance: number, i: number): SpacingMeasurement {
  return { id: `s${i}`, fromId: "a", toId: "b", axis: "horizontal", distance, alignment: "start" };
}

function region(id: string, opts: Partial<LayoutNode> = {}): LayoutNode {
  return {
    id,
    kind: "region",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    fill: "#FFFFFF",
    borderRadius: null,
    componentId: null,
    confidence: 0.9,
    ...opts,
  };
}

function textBlock(id: string, fontSize: number | null, opts: { monospace?: boolean; fontWeight?: number; family?: string } = {}): TextBlock {
  return {
    id,
    text: "x",
    confidence: 0.9,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    typography: fontSize === null ? null : {
      fontSize,
      fontWeight: opts.fontWeight ?? 400,
      lineHeight: null,
      letterSpacing: null,
      monospace: opts.monospace,
      fontFamilyCandidates: opts.family ? [{ family: opts.family, confidence: 0.4 }] : undefined,
      confidence: 0.8,
    },
  };
}

function makeReport(p: Partial<ExtractReport> = {}): ExtractReport {
  return {
    version: "test",
    image: { path: "x.png", width: 100, height: 100, channels: 4, trimmedBounds: null },
    colors: [],
    layout: [],
    text: [],
    spacing: [],
    components: [],
    diagnostics: { background: "#FFFFFF", activePixelRatio: 0.5 },
    ...p,
  };
}

describe("buildStyleSystem — colors", () => {
  it("splits neutrals (low saturation) from accents (high saturation)", () => {
    const sys = buildStyleSystem(makeReport({
      colors: [swatch("#FFFFFF", 500), swatch("#888888", 200), swatch("#111111", 150), swatch("#3B82F6", 80), swatch("#22C55E", 40)],
    }));
    const neutralHexes = sys.colors.neutrals.map((c) => c.hex);
    const accentHexes = sys.colors.accents.map((c) => c.hex);
    expect(neutralHexes).toContain("#FFFFFF");
    expect(neutralHexes).toContain("#888888");
    expect(neutralHexes).toContain("#111111");
    expect(accentHexes).toContain("#3B82F6");
    expect(accentHexes).toContain("#22C55E");
  });

  it("leaves color roles unassigned (the agent's job)", () => {
    const sys = buildStyleSystem(makeReport({ colors: [swatch("#3B82F6")] }));
    expect(sys.colors.accents[0]!.role).toBeNull();
  });

  it("classifies a dark tinted surface as a neutral, not an accent", () => {
    // #1C1D26 is a dark surface with a faint blue tint (saturation ~0.15) — it must
    // read as a neutral, while a vivid brand color reads as an accent.
    const sys = buildStyleSystem(makeReport({ colors: [swatch("#1C1D26", 500), swatch("#A78BFA", 50)] }));
    expect(sys.colors.neutrals.map((c) => c.hex)).toContain("#1C1D26");
    expect(sys.colors.accents.map((c) => c.hex)).toContain("#A78BFA");
  });

  it("orders neutrals by lightness ascending", () => {
    const sys = buildStyleSystem(makeReport({ colors: [swatch("#FFFFFF"), swatch("#111111"), swatch("#888888")] }));
    const ls = sys.colors.neutrals.map((c) => c.hsl.l);
    expect(ls[0]!).toBeLessThan(ls[1]!);
    expect(ls[1]!).toBeLessThan(ls[2]!);
  });
});

describe("buildStyleSystem — spacing base unit", () => {
  it("detects an 8px base when values are multiples of 8", () => {
    const sys = buildStyleSystem(makeReport({ spacing: [8, 16, 16, 24, 32, 8].map(spacing) }));
    expect(sys.spacing.baseUnit).toBe(8);
  });

  it("detects a 4px base when values include non-8 multiples", () => {
    const sys = buildStyleSystem(makeReport({ spacing: [4, 8, 12, 16, 4].map(spacing) }));
    expect(sys.spacing.baseUnit).toBe(4);
  });

  it("returns null base with no spacing data", () => {
    const sys = buildStyleSystem(makeReport());
    expect(sys.spacing.baseUnit).toBeNull();
    expect(sys.spacing.confidence).toBe(0);
  });
});

describe("buildStyleSystem — typography", () => {
  it("builds a sorted size scale and a modular ratio", () => {
    const sys = buildStyleSystem(makeReport({
      text: [textBlock("t1", 12), textBlock("t2", 16), textBlock("t3", 16), textBlock("t4", 24)],
    }));
    expect(sys.typography.sizes).toEqual([12, 16, 24]);
    expect(sys.typography.ratio).toBeGreaterThan(1.3);
    expect(sys.typography.ratio).toBeLessThan(1.6);
  });

  it("reports monospace when the majority of text is monospaced", () => {
    const sys = buildStyleSystem(makeReport({
      text: [textBlock("t1", 14, { monospace: true }), textBlock("t2", 14, { monospace: true }), textBlock("t3", 14, { monospace: false })],
    }));
    expect(sys.typography.monospace).toBe(true);
  });

  it("aggregates low-confidence font family candidates", () => {
    const sys = buildStyleSystem(makeReport({
      text: [textBlock("t1", 14, { family: "Inter" }), textBlock("t2", 16, { family: "Inter" })],
    }));
    expect(sys.typography.families[0]!.family).toBe("Inter");
    expect(sys.typography.families[0]!.confidence).toBeLessThan(1);
  });
});

describe("buildStyleSystem — radius + elevation", () => {
  it("builds a named radius scale and maps large radii to full", () => {
    const sys = buildStyleSystem(makeReport({
      layout: [
        region("r1", { borderRadius: 4 }),
        region("r2", { borderRadius: 8 }),
        region("r3", { borderRadius: 16 }),
        region("r4", { borderRadius: 9999 }),
      ],
    }));
    const values = sys.radius.scale.map((r) => r.value);
    expect(values).toContain(4);
    expect(values).toContain(8);
    expect(values).toContain(16);
    const full = sys.radius.scale.find((r) => r.name === "full");
    expect(full).toBeDefined();
    expect(full!.value).toBe(9999);
  });

  it("orders elevation tiers by blur radius", () => {
    const shadow = (blur: number) => ({ xOffset: 0, yOffset: 2, blurRadius: blur, spread: 0, color: "rgba(0,0,0,0.1)", confidence: 0.7 });
    const sys = buildStyleSystem(makeReport({
      layout: [region("r1", { shadow: shadow(12) }), region("r2", { shadow: shadow(4) })],
    }));
    expect(sys.elevation.tiers.length).toBe(2);
    expect(sys.elevation.tiers[0]!.name).toBe("sm");
    expect(sys.elevation.tiers[0]!.shadow).toContain("4px");
  });
});

describe("buildStyleSystem — meta", () => {
  it("tags source as screenshot by default", () => {
    const sys = buildStyleSystem(makeReport({ colors: [swatch("#3B82F6")] }));
    expect(sys.source).toBe("screenshot");
  });

  it("scales screenshot measurements to CSS px when a dpr is given", () => {
    // Raw 2x: 16/32/48px gaps -> 8/16/24 css; base unit 8 not 16.
    const sys = buildStyleSystem(makeReport({ spacing: [16, 32, 48, 16].map(spacing) }), { dpr: 2 });
    expect(sys.spacing.baseUnit).toBe(8);
    expect(sys.spacing.scale).toContain(8);
  });

  it("honors an explicit dom source", () => {
    const sys = buildStyleSystem(makeReport(), { source: "dom" });
    expect(sys.source).toBe("dom");
  });
});
